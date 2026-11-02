import {
  AranAuthError,
  AranError,
  AranNetworkError,
  AranRateLimitError,
  AranScopeError,
  AranUnprotectedError,
} from "./errors.js";
import { FINDING_TYPE, TEMPLATES, kindOf } from "./fields.js";
import type {
  AranOptions,
  DetokeniseResult,
  Finding,
  GatewayInput,
  ProtectFieldsInput,
  ProtectInput,
  ProtectResult,
  Receipt,
  TraceResult,
  VerifyResult,
} from "./types.js";

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

interface CallOptions {
  /** idempotent calls may be retried (max 2) on network errors and 502/503/504 */
  idempotent: boolean;
}

export class Aran {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryBaseMs: number;

  constructor(opts: AranOptions) {
    if (!opts || !opts.apiKey) throw new AranError("Aran: apiKey is required");
    if (!opts.baseUrl) throw new AranError("Aran: baseUrl is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 4000;
    const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new AranError("Aran: no fetch available; use Node 18+ or pass options.fetch");
    this.fetchImpl = f.bind(globalThis);
    this.retryBaseMs = opts.retryBaseMs ?? 150;
  }

  // ------------------------------------------------------------------ transport
  private async attempt(method: string, path: string, body: unknown): Promise<{ status: number; headers: Headers; json: unknown }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "X-API-Key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      let json: unknown = null;
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
      const aborted = (err as { name?: string } | null)?.name === "AbortError";
      throw new AranNetworkError(aborted ? `Aran request timed out after ${this.timeoutMs} ms` : `Aran request failed: ${(err as Error)?.message ?? err}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private static detail(json: unknown, fallback: string): string {
    const d = (json as { detail?: unknown } | null)?.detail;
    return typeof d === "string" ? d : fallback;
  }

  private async call<T>(method: string, path: string, body: unknown, opts: CallOptions): Promise<T> {
    const maxAttempts = opts.idempotent ? MAX_RETRIES + 1 : 1;
    let lastErr: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.retryBaseMs * 2 ** (i - 1)));
      try {
        const res = await this.attempt(method, path, body);
        if (res.status >= 200 && res.status < 300) return res.json as T;
        const msg = Aran.detail(res.json, `Aran responded ${res.status}`);
        if (res.status === 401) throw new AranAuthError(msg, res.json);
        if (res.status === 403) throw new AranScopeError(msg, res.json);
        if (res.status === 429) {
          const ra = Number(res.headers.get("Retry-After"));
          throw new AranRateLimitError(msg, Number.isFinite(ra) && ra > 0 ? ra : undefined, res.json);
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
  async protect(input: ProtectInput): Promise<ProtectResult> {
    const body: Record<string, unknown> = { text: input.text };
    if (input.customerRef !== undefined) body.customer_ref = input.customerRef;
    if (input.purpose !== undefined) body.purpose = input.purpose;
    if (input.sink !== undefined) body.sink = input.sink;
    const r = await this.call<Record<string, unknown>>("POST", "/v1/protect", body, { idempotent: false });
    return {
      after: String(r.after ?? ""),
      findings: (r.findings as Finding[] | undefined) ?? [],
      notes: (r.notes as string[] | undefined) ?? [],
      latencyMs: Number(r.latency_ms ?? 0),
      raw: r,
    };
  }

  /**
   * Tokenise labelled fields in ONE request (one sentence per field) and return the token for each field.
   * Throws AranUnprotectedError if any field is not provably tokenised; never returns a raw value.
   */
  async protectFields(input: ProtectFieldsInput): Promise<Record<string, string>> {
    const entries = Object.entries(input.fields);
    if (entries.length === 0) return {};
    const lines: string[] = [];
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
      sink: input.sink,
    });
    const outLines = res.after.split("\n");
    if (outLines.length !== lines.length) {
      throw new AranUnprotectedError(plan[0]!.field, `response had ${outLines.length} lines for ${lines.length} fields`);
    }
    const out: Record<string, string> = {};
    for (const p of plan) {
      const line = outLines[p.line]!;
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
  async gateway(input: GatewayInput): Promise<Record<string, unknown>> {
    return this.call("POST", "/v1/gateway", { role: input.role, prompt: input.prompt }, { idempotent: false });
  }

  /** Find which sink leaked a dump of tokens. */
  async trace(input: { dump: string }): Promise<TraceResult> {
    return this.call("POST", "/v1/trace", { dump: input.dump }, { idempotent: true });
  }

  /** Reveal a token's original value. Needs the `detokenise` scope; every call is audited. */
  async detokenise(input: { token: string; caller?: string }): Promise<DetokeniseResult> {
    return this.call("POST", "/v1/detokenise", { token: input.token, ...(input.caller ? { caller: input.caller } : {}) }, { idempotent: true });
  }

  /** Destroy a customer's key for a purpose (right to erasure). Returns the signed receipt. */
  async erase(input: { customerRef: string; purpose: string }): Promise<Receipt> {
    return this.call("POST", "/v1/erase", { customer_ref: input.customerRef, purpose: input.purpose }, { idempotent: false });
  }

  /** Verify an erasure receipt against this workspace's signing keys. */
  async verifyReceipt(receipt: Receipt): Promise<VerifyResult> {
    return this.call("POST", "/v1/receipts/verify", receipt, { idempotent: true });
  }
}
