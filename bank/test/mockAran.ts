// A small in-process mock of the Aran Cloud API (just what the bank uses), with failure injection.
import http from "node:http";
import { AddressInfo } from "node:net";
import { verhoeffValid } from "../lib/validators";

export const APP_KEY = "aran_live_mockapp";
export const COMPLIANCE_KEY = "aran_live_mockcompliance";

interface Entry { value: string; ref: string | undefined; purpose: string; type: string }
const rnd = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

export class MockAran {
  server!: http.Server;
  url = "";
  vault = new Map<string, Entry>();
  erased = new Set<string>();           // `${ref}|${purpose}`
  calls: { path: string; key: string }[] = [];
  down = false;                         // every call -> 503
  failAfter: number | null = null;      // protect calls beyond this many -> 503
  private protects = 0;

  reset() { this.vault.clear(); this.erased.clear(); this.calls = []; this.down = false; this.failAfter = null; this.protects = 0; }

  private tokenFor(type: string, value: string, ref: string | undefined, purpose: string) {
    let tok: string;
    if (type === "AADHAAR") { do { tok = rnd(12); } while (verhoeffValid(tok)); }
    else if (type === "PER") tok = `<PER:${rnd(10)}>`;
    else tok = `<${type}:v${rnd(10)}>`;
    this.vault.set(tok, { value, ref, purpose, type });
    return tok;
  }

  protect(text: string, ref: string | undefined, purpose: string) {
    const findings: { type: string; start: number; end: number; p: number; protected: boolean; token: string }[] = [];
    let after = text;
    const rules: [string, RegExp][] = [
      ["AADHAAR", /(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/g], ["CARD", /(?<![0-9A-Za-z])\d{16}(?![0-9A-Za-z])/g],
      ["MOBILE", /(?<![0-9A-Za-z])[6-9]\d{9}(?![0-9A-Za-z])/g], ["PAN", /\b[A-Z]{5}\d{4}[A-Z]\b/g],
      ["PER", /(?<=Account holder )[A-Za-z .'-]+?(?= opened an account)/g],
    ];
    for (const [type, rx] of rules) {
      after = after.replace(rx, (m) => { const tok = this.tokenFor(type, m, ref, purpose); findings.push({ type, start: 0, end: 1, p: 0.99, protected: true, token: tok }); return tok; });
    }
    return { after, findings };
  }

  async start() {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const key = String(req.headers["x-api-key"] ?? "");
        const path = req.url ?? "";
        this.calls.push({ path, key });
        const send = (s: number, j: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        if (this.down) return send(503, { detail: "Aran core call /api/process failed: connection refused" });
        if (path === "/v1/health") return send(200, { status: "ok", core: true, core_ready: true });
        if (key !== APP_KEY && key !== COMPLIANCE_KEY) return send(401, { detail: "Invalid, missing or revoked API key." });
        const j = body ? JSON.parse(body) : {};
        const needs = (scope: "app" | "compliance") => (scope === "app" ? key === APP_KEY : key === COMPLIANCE_KEY);
        if (path === "/v1/protect") {
          if (!needs("app")) return send(403, { detail: "this key lacks the 'protect' scope" });
          if (typeof j.text !== "string") return send(422, { detail: [{ loc: ["body", "text"], msg: "Field required" }] });   // connection probe: empty body
          this.protects++;
          if (this.failAfter !== null && this.protects > this.failAfter) return send(503, { detail: "Aran core call failed" });
          const r = this.protect(j.text, j.customer_ref, j.purpose ?? "KYC");
          return send(200, { ...r, notes: [], latency_ms: 1.2 });
        }
        if (path === "/v1/gateway") {
          if (!needs("app")) return send(403, { detail: "this key lacks the 'gateway' scope" });
          if (typeof j.prompt !== "string") return send(422, { detail: [{ loc: ["body", "prompt"], msg: "Input should be a valid string" }] });
          const saw = this.protect(j.prompt, undefined, "Service").after.replace(/\d{10,16}/g, "<NUM>");
          return send(200, { reply: `You wrote: ${j.prompt}`, provider_saw: [{ role: "user", content: saw }], provider_reply: `You wrote: ${saw}`, provider: "echo stand-in (no external AI call)", findings_in_prompt: 1 });
        }
        if (path === "/v1/trace") {
          if (!needs("app")) return send(403, { detail: "this key lacks the 'trace' scope" });
          if (typeof j.dump !== "string") return send(422, { detail: [{ loc: ["body", "dump"], msg: "Field required" }] });
          const hits = [...(j.dump as string).matchAll(/<[A-Z]+:[v0-9a-z]+>|(?<![0-9A-Za-z])\d{12}(?![0-9A-Za-z])/g)].map((m) => m[0]);
          const items = hits.map((v) => ({ value: v, sink: this.vault.has(v) ? "loan-vendor" : null, how: this.vault.has(v) ? "vault" : null }));
          const matched = items.filter((i) => i.sink).length;
          return send(200, { candidates: items.length, matched, ranking: matched ? [{ sink: "loan-vendor", tokens: matched, share: 1 }] : [], top: matched ? { sink: "loan-vendor", tokens: matched, share: 1 } : null, items, raw_identifiers_in_dump: 0 });
        }
        if (path === "/v1/detokenise") {
          if (!needs("compliance")) return send(403, { detail: "this key lacks the 'detokenise' scope" });
          const e = this.vault.get(j.token);
          if (!e) return send(200, { token: j.token, value: null, status: "unknown" });
          if (e.ref && this.erased.has(`${e.ref}|${e.purpose}`)) return send(200, { token: j.token, value: null, status: "erased" });
          return send(200, { token: j.token, value: e.value, status: "ok" });
        }
        if (path === "/v1/erase") {
          if (!needs("compliance")) return send(403, { detail: "this key lacks the 'erase' scope" });
          if (!j.customer_ref) return send(422, { detail: [{ loc: ["body", "customer_ref"], msg: "Field required" }] });
          this.erased.add(`${j.customer_ref}|${j.purpose}`);
          return send(200, { event: { event: "KEY_DESTROYED", customer: j.customer_ref, purpose: j.purpose }, key_id: "k_mock", alg: "Ed25519+ML-DSA-65", public_key: "pk", signature: "sig" });
        }
        if (path === "/v1/dashboard") return needs("compliance") ? send(200, { tenant: { id: "t_mock", name: "Mock Bank" } }) : send(403, { detail: "this key lacks the 'dashboard' scope" });
        if (path === "/v1/receipts/verify") return !needs("compliance") ? send(403, { detail: "this key lacks the 'verify' scope" }) : send(200, { valid: j.signature === "sig", post_quantum_valid: true });
        return send(404, { detail: "not found" });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  stop() { return new Promise<void>((r) => this.server.close(() => r())); }
}
