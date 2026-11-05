"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Aran: () => Aran,
  AranAuthError: () => AranAuthError,
  AranError: () => AranError,
  AranNetworkError: () => AranNetworkError,
  AranRateLimitError: () => AranRateLimitError,
  AranScopeError: () => AranScopeError,
  AranUnprotectedError: () => AranUnprotectedError
});
module.exports = __toCommonJS(index_exports);

// src/errors.ts
var AranError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
};
var AranAuthError = class extends AranError {
  constructor(message, body) {
    super(message, 401, body);
  }
};
var AranScopeError = class extends AranError {
  constructor(message, body) {
    super(message, 403, body);
  }
};
var AranRateLimitError = class extends AranError {
  constructor(message, retryAfter, body) {
    super(message, 429, body);
    this.retryAfter = retryAfter;
  }
};
var AranNetworkError = class extends AranError {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
};
var AranUnprotectedError = class extends AranError {
  constructor(field, reason) {
    super(`Aran did not protect field "${field}": ${reason}`);
    this.field = field;
  }
};

// src/fields.ts
var TEMPLATES = {
  name: { prefix: "Account holder ", suffix: " opened an account" },
  mobile: { prefix: "Mobile number: ", suffix: "" },
  aadhaar: { prefix: "Aadhaar number: ", suffix: "" },
  card: { prefix: "Card number: ", suffix: "" },
  pan: { prefix: "PAN number: ", suffix: "" },
  upi: { prefix: "UPI ID ", suffix: "" }
};
var ALIASES = {
  name: "name",
  fullname: "name",
  full_name: "name",
  customername: "name",
  accountholder: "name",
  mobile: "mobile",
  phone: "mobile",
  mobilenumber: "mobile",
  mobile_number: "mobile",
  phonenumber: "mobile",
  aadhaar: "aadhaar",
  aadhar: "aadhaar",
  uid: "aadhaar",
  aadhaarnumber: "aadhaar",
  card: "card",
  cardnumber: "card",
  card_number: "card",
  pan: "pan",
  pannumber: "pan",
  pan_number: "pan",
  upi: "upi",
  upiid: "upi",
  upi_id: "upi",
  vpa: "upi"
};
function kindOf(field) {
  return ALIASES[field.toLowerCase().replace(/[\s-]/g, "")] ?? ALIASES[field.toLowerCase()];
}
var FINDING_TYPE = {
  name: "PER",
  mobile: "MOBILE",
  aadhaar: "AADHAAR",
  card: "CARD",
  pan: "PAN",
  upi: "UPI"
};

// src/client.ts
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([502, 503, 504]);
var MAX_RETRIES = 2;
var Aran = class _Aran {
  constructor(opts) {
    if (!opts || !opts.apiKey) throw new AranError("Aran: apiKey is required");
    if (!opts.baseUrl) throw new AranError("Aran: baseUrl is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 4e3;
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new AranError("Aran: no fetch available; use Node 18+ or pass options.fetch");
    this.fetchImpl = f.bind(globalThis);
    this.retryBaseMs = opts.retryBaseMs ?? 150;
  }
  // ------------------------------------------------------------------ transport
  async attempt(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal: ctl.signal
      });
      let json = null;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { detail: text.slice(0, 500) };
        }
      }
      return { status: res.status, headers: res.headers, json };
    } catch (err) {
      const aborted = err?.name === "AbortError";
      throw new AranNetworkError(aborted ? `Aran request timed out after ${this.timeoutMs} ms` : `Aran request failed: ${err?.message ?? err}`, err);
    } finally {
      clearTimeout(timer);
    }
  }
  static detail(json, fallback) {
    const d = json?.detail;
    return typeof d === "string" ? d : fallback;
  }
  async call(method, path, body, opts) {
    const maxAttempts = opts.idempotent ? MAX_RETRIES + 1 : 1;
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.retryBaseMs * 2 ** (i - 1)));
      try {
        const res = await this.attempt(method, path, body);
        if (res.status >= 200 && res.status < 300) return res.json;
        const msg = _Aran.detail(res.json, `Aran responded ${res.status}`);
        if (res.status === 401) throw new AranAuthError(msg, res.json);
        if (res.status === 403) throw new AranScopeError(msg, res.json);
        if (res.status === 429) {
          const ra = Number(res.headers.get("Retry-After"));
          throw new AranRateLimitError(msg, Number.isFinite(ra) && ra > 0 ? ra : void 0, res.json);
        }
        const err = new AranError(msg, res.status, res.json);
        if (RETRYABLE_STATUS.has(res.status)) {
          lastErr = err;
          continue;
        }
        throw err;
      } catch (err) {
        if (err instanceof AranNetworkError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
  // ------------------------------------------------------------------ API
  /** Tokenise sensitive values in free text. Not retried: a retry could issue a second token set. */
  async protect(input) {
    const body = { text: input.text };
    if (input.customerRef !== void 0) body.customer_ref = input.customerRef;
    if (input.purpose !== void 0) body.purpose = input.purpose;
    if (input.sink !== void 0) body.sink = input.sink;
    const r = await this.call("POST", "/v1/protect", body, { idempotent: false });
    return {
      after: String(r.after ?? ""),
      findings: r.findings ?? [],
      notes: r.notes ?? [],
      latencyMs: Number(r.latency_ms ?? 0),
      raw: r
    };
  }
  /**
   * Tokenise labelled fields in ONE request (one sentence per field) and return the token for each field.
   * Throws AranUnprotectedError if any field is not provably tokenised; never returns a raw value.
   */
  async protectFields(input) {
    const entries = Object.entries(input.fields);
    if (entries.length === 0) return {};
    const lines = [];
    const plan = entries.map(([field, value]) => {
      const kind = kindOf(field);
      if (!kind) throw new AranUnprotectedError(field, "unsupported field (supported: name, mobile, aadhaar, card, pan, upi)");
      if (typeof value !== "string" || value.trim() === "") throw new AranUnprotectedError(field, "empty value");
      if (/[\r\n]/.test(value)) throw new AranUnprotectedError(field, "value contains a line break");
      const tpl = TEMPLATES[kind];
      lines.push(`${tpl.prefix}${value}${tpl.suffix}`);
      return { field, kind, value, tpl, line: lines.length - 1 };
    });
    const res = await this.protect({
      text: lines.join("\n"),
      customerRef: input.customerRef,
      purpose: input.purpose,
      sink: input.sink
    });
    const outLines = res.after.split("\n");
    if (outLines.length !== lines.length) {
      throw new AranUnprotectedError(plan[0].field, `response had ${outLines.length} lines for ${lines.length} fields`);
    }
    const out = {};
    for (const p of plan) {
      const line = outLines[p.line];
      if (!line.startsWith(p.tpl.prefix) || !line.endsWith(p.tpl.suffix) || line.length < p.tpl.prefix.length + p.tpl.suffix.length) {
        throw new AranUnprotectedError(p.field, "could not locate the token in the response");
      }
      const token = line.slice(p.tpl.prefix.length, line.length - p.tpl.suffix.length);
      if (token === "" || token === p.value || line.includes(p.value)) throw new AranUnprotectedError(p.field, "value came back unchanged");
      const typ = FINDING_TYPE[p.kind];
      if (!res.findings.some((f) => f.type === typ && f.protected)) {
        throw new AranUnprotectedError(p.field, `no protected ${typ} finding in the response`);
      }
      out[p.field] = token;
    }
    return out;
  }
  /** Redact a prompt through the AI gateway. */
  async gateway(input) {
    return this.call("POST", "/v1/gateway", { role: input.role, prompt: input.prompt }, { idempotent: false });
  }
  /** Find which sink leaked a dump of tokens. */
  async trace(input) {
    return this.call("POST", "/v1/trace", { dump: input.dump }, { idempotent: true });
  }
  /** Reveal a token's original value. Needs the `detokenise` scope; every call is audited. */
  async detokenise(input) {
    return this.call("POST", "/v1/detokenise", { token: input.token, ...input.caller ? { caller: input.caller } : {} }, { idempotent: true });
  }
  /** Destroy a customer's key for a purpose (right to erasure). Returns the signed receipt. */
  async erase(input) {
    return this.call("POST", "/v1/erase", { customer_ref: input.customerRef, purpose: input.purpose }, { idempotent: false });
  }
  /** Verify an erasure receipt against this workspace's signing keys. */
  async verifyReceipt(receipt) {
    return this.call("POST", "/v1/receipts/verify", receipt, { idempotent: true });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Aran,
  AranAuthError,
  AranError,
  AranNetworkError,
  AranRateLimitError,
  AranScopeError,
  AranUnprotectedError
});
