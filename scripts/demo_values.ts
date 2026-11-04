// Prints fresh, valid, made-up identifiers for a demo run, each checked with the bank's own validators (Verhoeff Aadhaar, Luhn card,
// 10-digit mobile starting 6-9 and NOT starting 91 (the bank's validator strips a leading 91), PAN shape). They belong to nobody.
// Aran gives an identifier to the customer reference that first presented it, so use a NEW set for every run in the same Aran workspace.
// Usage (from bank/):  npx tsx ../scripts/demo_values.ts [count]
import { isAadhaar, isCard, isMobile, isPan } from "../bank/lib/validators";
const digs = (n: number, first = 0) => Array.from({ length: n }, (_, i) => (i === 0 && first ? first + Math.floor(Math.random() * (10 - first)) : Math.floor(Math.random() * 10))).join("");
const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; const l = () => L[Math.floor(Math.random() * 26)]!;
const aadhaar = () => { for (;;) { const a = digs(12, 2); if (isAadhaar(a)) return a; } };
const card = () => { for (;;) { const c = "4" + digs(15); if (isCard(c)) return c; } };
const mobile = () => { for (;;) { const m = String(6 + Math.floor(Math.random() * 4)) + digs(9); if (isMobile(m) && !m.startsWith("91")) return m; } };
const pan = () => { for (;;) { const p = `${l()}${l()}${l()}P${l()}${digs(4)}${l()}`; if (isPan(p)) return p; } };
const n = Number(process.argv[2] ?? 1);
for (let i = 1; i <= n; i++) console.log(`set ${i}:  Aadhaar ${aadhaar()}   mobile ${mobile()}   PAN ${pan()}   card ${card()}`);
