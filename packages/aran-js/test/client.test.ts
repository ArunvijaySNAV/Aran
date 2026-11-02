import { describe, expect, it, vi } from "vitest";
import {
  Aran,
  AranAuthError,
  AranError,
  AranNetworkError,
  AranRateLimitError,
  AranScopeError,
  AranUnprotectedError,
} from "../src/index.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function make(handler: Handler, extra: Partial<ConstructorParameters<typeof Aran>[0]> = {}) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const f = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  const aran = new Aran({ apiKey: "aran_live_test", baseUrl: "https://aran.test/", fetch: f, retryBaseMs: 1, ...extra });
  return { aran, calls, f };
}

describe("protect", () => {
  it("posts the right payload with the key header and maps the response", async () => {
    const { aran, calls } = make(() =>
      json(200, { after: "Aadhaar 111122223333", findings: [{ type: "AADHAAR", start: 8, end: 20, p: 0.99, protected: true, token: "111122223333" }], notes: ["n"], latency_ms: 1.5 }),
    );
    const r = await aran.protect({ text: "Aadhaar 999", customerRef: "CUS-1", purpose: "KYC", sink: "kyc-archive" });
    expect(calls[0]!.url).toBe("https://aran.test/v1/protect");
    expect((calls[0]!.init.headers as Record<string, string>)["X-API-Key"]).toBe("aran_live_test");
    expect(calls[0]!.body).toEqual({ text: "Aadhaar 999", customer_ref: "CUS-1", purpose: "KYC", sink: "kyc-archive" });
    expect(r.after).toBe("Aadhaar 111122223333");
    expect(r.latencyMs).toBe(1.5);
    expect(r.findings[0]!.token).toBe("111122223333");
    expect(r.notes).toEqual(["n"]);
  });

  it("omits optional fields that were not given", async () => {
    const { aran, calls } = make(() => json(200, { after: "x", findings: [], notes: [], latency_ms: 0 }));
    await aran.protect({ text: "hello" });
    expect(calls[0]!.body).toEqual({ text: "hello" });
  });

  it("is never retried (a retry could issue a second token set)", async () => {
    const { aran, f } = make(() => json(503, { detail: "down" }));
    await expect(aran.protect({ text: "x" })).rejects.toBeInstanceOf(AranError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("typed errors", () => {
  it("maps 401, 403, 429 (with retryAfter), other statuses and network failures", async () => {
    await expect(make(() => json(401, { detail: "bad key" })).aran.protect({ text: "x" })).rejects.toMatchObject({ name: "AranAuthError", status: 401, message: "bad key" });
    await expect(make(() => json(403, { detail: "this key lacks the 'detokenise' scope" })).aran.detokenise({ token: "t" })).rejects.toBeInstanceOf(AranScopeError);
    const rl = await make(() => json(429, { detail: "slow down" }, { "Retry-After": "17" })).aran.protect({ text: "x" }).catch((e) => e);
    expect(rl).toBeInstanceOf(AranRateLimitError);
    expect(rl.retryAfter).toBe(17);
    expect(rl.status).toBe(429);
    const other = await make(() => json(422, { detail: "bad" })).aran.protect({ text: "x" }).catch((e) => e);
    expect(other).toBeInstanceOf(AranError);
    expect(other).not.toBeInstanceOf(AranAuthError);
    expect(other.status).toBe(422);
    const net = await make(() => { throw new TypeError("fetch failed"); }).aran.protect({ text: "x" }).catch((e) => e);
    expect(net).toBeInstanceOf(AranNetworkError);
  });

  it("times out slow requests with AranNetworkError", async () => {
    const { aran } = make((_u, init) => new Promise((_res, rej) => {
      (init.signal as AbortSignal).addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }), { timeoutMs: 20 });
    const e = await aran.protect({ text: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(AranNetworkError);
    expect(e.message).toMatch(/timed out/);
  });
});

describe("retries (idempotent calls only, max 2)", () => {
  it("trace retries network errors twice then succeeds", async () => {
    let n = 0;
    const { aran, f } = make(() => {
      n++;
      if (n < 3) throw new TypeError("reset");
      return json(200, { candidates: 1, matched: 1, ranking: [], top: null, items: [], raw_identifiers_in_dump: 0 });
    });
    const r = await aran.trace({ dump: "x" });
    expect(r.matched).toBe(1);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("gives up after 2 retries (3 attempts total)", async () => {
    const { aran, f } = make(() => json(503, { detail: "x" }));
    await expect(aran.detokenise({ token: "t" })).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry 401/403/429 or non-idempotent calls", async () => {
    for (const status of [401, 403, 429]) {
      const { aran, f } = make(() => json(status, { detail: "x" }));
      await aran.verifyReceipt({ event: {}, signature: "s", public_key: "p" }).catch(() => {});
      expect(f).toHaveBeenCalledTimes(1);
    }
    const e = make(() => { throw new TypeError("x"); });
    await e.aran.erase({ customerRef: "C", purpose: "KYC" }).catch(() => {});
    expect(e.f).toHaveBeenCalledTimes(1);
    const g = make(() => json(502, { detail: "x" }));
    await g.aran.gateway({ prompt: "p", role: "analyst" }).catch(() => {});
    expect(g.f).toHaveBeenCalledTimes(1);
  });
});

describe("other endpoints", () => {
  it("sends the documented bodies", async () => {
    const { aran, calls } = make(() => json(200, { ok: true }));
    await aran.gateway({ prompt: "hi", role: "analyst" });
    await aran.trace({ dump: "d" });
    await aran.detokenise({ token: "tok" });
    await aran.erase({ customerRef: "CUS-9", purpose: "Loans" });
    const receipt = { event: { a: 1 }, signature: "s", public_key: "k", key_id: "k_1" };
    await aran.verifyReceipt(receipt);
    expect(calls.map((c) => c.url.replace("https://aran.test", ""))).toEqual(["/v1/gateway", "/v1/trace", "/v1/detokenise", "/v1/erase", "/v1/receipts/verify"]);
    expect(calls[0]!.body).toEqual({ role: "analyst", prompt: "hi" });
    expect(calls[3]!.body).toEqual({ customer_ref: "CUS-9", purpose: "Loans" });
    expect(calls[4]!.body).toEqual(receipt);
  });
});

// A fake core that tokenises the way the real one does: digits -> other digits, names/mobile/pan -> <TYPE:vxxxx>
function fakeProtect(opts: { skip?: string[]; echo?: boolean } = {}): Handler {
  return (_u, init) => {
    const text = JSON.parse(String(init.body)).text as string;
    const findings: any[] = [];
    const after = text
      .split("\n")
      .map((line) => {
        const rules: [string, RegExp, string][] = [
          ["PER", /^(Account holder )(.+)( opened an account)$/, "PER"],
          ["MOBILE", /^(Mobile number: )(\d{10})()$/, "MOBILE"],
          ["AADHAAR", /^(Aadhaar number: )(\d{12})()$/, "AADHAAR"],
          ["CARD", /^(Card number: )(\d{16})()$/, "CARD"],
          ["PAN", /^(PAN number: )([A-Z]{5}\d{4}[A-Z])()$/, "PAN"],
          ["UPI", /^(UPI ID )(\S+@\S+)()$/, "UPI"],
        ];
        for (const [typ, rx] of rules) {
          const m = rx.exec(line);
          if (!m) continue;
          if (opts.skip?.includes(typ)) return line;
          const tok = /^\d+$/.test(m[2]!) ? m[2]!.split("").reverse().join("") : `<${typ}:v${m[2]!.length}x>`;
          findings.push({ type: typ, start: 0, end: 1, p: 0.99, protected: true, token: tok });
          return `${m[1]}${opts.echo ? m[2] : tok}${m[3]}`;
        }
        return line;
      })
      .join("\n");
    return json(200, { after, findings, notes: [], latency_ms: 1 });
  };
}

const FIELDS = { name: "Pooja Hegde", mobile: "9907439150", aadhaar: "341777631706", card: "4806360837783535", pan: "YOJPN8124D", upi: "pooja12@okbank" };

describe("protectFields", () => {
  it("sends one labelled sentence per field in a single request and returns tokens by field", async () => {
    const { aran, calls } = make(fakeProtect());
    const out = await aran.protectFields({ fields: FIELDS, customerRef: "CUS-000123", purpose: "KYC", sink: "kyc-archive" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.text.split("\n")).toEqual([
      "Account holder Pooja Hegde opened an account",
      "Mobile number: 9907439150",
      "Aadhaar number: 341777631706",
      "Card number: 4806360837783535",
      "PAN number: YOJPN8124D",
      "UPI ID pooja12@okbank",
    ]);
    expect(calls[0]!.body).toMatchObject({ customer_ref: "CUS-000123", purpose: "KYC", sink: "kyc-archive" });
    expect(Object.keys(out)).toEqual(Object.keys(FIELDS));
    expect(out.aadhaar).toBe("341777631706".split("").reverse().join(""));
    for (const [k, v] of Object.entries(out)) expect(v).not.toBe((FIELDS as any)[k]);
  });

  it("accepts field aliases but returns tokens under the caller's own names", async () => {
    const { aran } = make(fakeProtect());
    const out = await aran.protectFields({ fields: { phone: "9907439150", fullName: "Pooja Hegde" }, customerRef: "C", purpose: "KYC", sink: "kyc-archive" });
    expect(Object.keys(out).sort()).toEqual(["fullName", "phone"]);
  });

  it("throws AranUnprotectedError when a field comes back unprotected, never raw", async () => {
    for (const skip of ["PER", "MOBILE", "AADHAAR", "CARD", "PAN", "UPI"]) {
      const { aran } = make(fakeProtect({ skip: [skip] }));
      const e = await aran.protectFields({ fields: FIELDS, customerRef: "C", purpose: "KYC", sink: "kyc-archive" }).catch((x) => x);
      expect(e).toBeInstanceOf(AranUnprotectedError);
    }
  });

  it("throws when the service echoes the raw value even though it reports a finding", async () => {
    const { aran } = make(fakeProtect({ echo: true }));
    const e = await aran.protectFields({ fields: { aadhaar: FIELDS.aadhaar }, customerRef: "C", purpose: "KYC", sink: "kyc-archive" }).catch((x) => x);
    expect(e).toBeInstanceOf(AranUnprotectedError);
    expect(e.field).toBe("aadhaar");
  });

  it("throws when the response shape is not what was sent", async () => {
    const { aran } = make(() => json(200, { after: "one line only", findings: [], notes: [], latency_ms: 1 }));
    await expect(aran.protectFields({ fields: { aadhaar: "341777631706", mobile: "9907439150" }, customerRef: "C", purpose: "KYC", sink: "s" })).rejects.toBeInstanceOf(AranUnprotectedError);
  });

  it("rejects unknown fields, empty values and line breaks before any request", async () => {
    const { aran, f } = make(fakeProtect());
    const bad: Record<string, string>[] = [{ email: "a@b.c" }, { aadhaar: "" }, { name: "A\nB" }];
    for (const fields of bad) {
      await expect(aran.protectFields({ fields, customerRef: "C", purpose: "KYC", sink: "s" })).rejects.toBeInstanceOf(AranUnprotectedError);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("propagates transport errors unchanged (caller must fail closed)", async () => {
    const { aran } = make(() => json(503, { detail: "Aran core call failed" }));
    await expect(aran.protectFields({ fields: { aadhaar: FIELDS.aadhaar }, customerRef: "C", purpose: "KYC", sink: "s" })).rejects.toMatchObject({ status: 503 });
  });
});

describe("construction", () => {
  it("requires apiKey and baseUrl", () => {
    expect(() => new Aran({ apiKey: "", baseUrl: "x" })).toThrow(AranError);
    expect(() => new Aran({ apiKey: "k", baseUrl: "" })).toThrow(AranError);
  });
});
