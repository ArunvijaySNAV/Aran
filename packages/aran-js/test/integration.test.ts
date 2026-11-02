import { describe, expect, it } from "vitest";
import { Aran, AranScopeError, AranAuthError } from "../src/index.js";

const base = process.env.ARAN_BASE_URL;
const key = process.env.ARAN_APP_KEY;

// ---- checksum-valid sample data that belongs to nobody (never real identifiers)
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
const rd = (n: number, first = 0) => Array.from({ length: n }, (_, i) => (i === 0 && first ? first + Math.floor(Math.random() * (10 - first)) : Math.floor(Math.random() * 10)));
function verhoeffCheck(body: number[]): number {
  let c = 0;
  [...body].reverse().forEach((d, i) => { c = D[c]![P[(i + 1) % 8]![d]!]!; });
  return INV[c]!;
}
const aadhaar = () => { const b = rd(11, 2); return [...b, verhoeffCheck(b)].join(""); };
function luhnCheck(body: number[]): number {
  let s = 0;
  [...body].reverse().forEach((d, i) => { let v = d; if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; } s += v; });
  return (10 - (s % 10)) % 10;
}
const card = () => { const b = [4, ...rd(14)]; return [...b, luhnCheck(b)].join(""); };
const mobile = () => `${6 + Math.floor(Math.random() * 4)}${rd(9).join("")}`;
const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const pan = () => `${[0,1,2].map(() => L[Math.floor(Math.random() * 26)]).join("")}P${L[Math.floor(Math.random() * 26)]}${rd(4).join("")}${L[Math.floor(Math.random() * 26)]}`;
const NAMES = ["Aarav Sharma", "Priya Patel", "Rahul", "Meera Nair", "Siddhesh Marathe", "Lakshmi", "Nirupama Dandekar"];

// Runs only against a live stack: ARAN_BASE_URL=http://127.0.0.1:8100 ARAN_APP_KEY=<admin key> npm test
describe.skipIf(!base || !key)("integration (live Aran Cloud)", () => {
  const aran = () => new Aran({ apiKey: key!, baseUrl: base!, timeoutMs: 10000 });

  it("protectFields tokenises all five fields; the vault token resolves back for an admin key", async () => {
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const fields = { name: NAMES[i % NAMES.length]!, mobile: mobile(), aadhaar: aadhaar(), card: card(), pan: pan() };
      const ref = `INT-${Date.now()}-${i}`;
      const out = await aran().protectFields({ fields, customerRef: ref, purpose: "KYC", sink: "kyc-archive" });
      for (const k of Object.keys(fields)) expect(out[k]).not.toBe((fields as Record<string, string>)[k]);
      const back = await aran().detokenise({ token: out.aadhaar! });
      expect(back.status).toBe("ok");
      expect(back.value).toBe(fields.aadhaar);
      ok++;
    }
    expect(ok).toBe(10);
  });

  it("a bad key is an AranAuthError", async () => {
    const e = await new Aran({ apiKey: "aran_live_nope", baseUrl: base! }).protect({ text: "hi" }).catch((x) => x);
    expect(e).toBeInstanceOf(AranAuthError);
  });

  it("a protect-only key gets AranScopeError on detokenise and erase", async () => {
    const r = await fetch(`${base}/v1/keys`, { method: "POST", headers: { "X-API-Key": key!, "Content-Type": "application/json" }, body: JSON.stringify({ label: "sdk-int", scopes: ["protect"] }) });
    const protectOnly = new Aran({ apiKey: (await r.json() as { api_key: string }).api_key, baseUrl: base! });
    await expect(protectOnly.detokenise({ token: "123456789012" })).rejects.toBeInstanceOf(AranScopeError);
    await expect(protectOnly.erase({ customerRef: "X", purpose: "KYC" })).rejects.toBeInstanceOf(AranScopeError);
  });
});
