// Seeds 25 customers THROUGH the protected path (lib/domain.onboardCustomer -> Aran), never by direct insert.
// Also creates the four demo staff users in Supabase Auth + core_banking.staff.
// Usage (from bank/): DATABASE_URL=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ARAN_BASE_URL=... ARAN_APP_KEY=... npx tsx ../scripts/seed.ts
import { createClient } from "@supabase/supabase-js";
import { Aran } from "@aran/sdk";
import { makeDb } from "../bank/db";
import * as t from "../bank/db/schema";
import { eq } from "drizzle-orm";
import { onboardCustomer, openAccount, transact } from "../bank/lib/domain";
import { FIRST, LAST, TEST_CARDS } from "./fictional";

const need = (n: string) => { const v = process.env[n]; if (!v) throw new Error(`${n} is required`); return v; };

// ---- Aadhaar / mobile / PAN: random, checksum-valid. The bank validators leave no never-issued range for these, so a value COULD match a real person (see docs/DEMO_DATA.md).
// Cards come from the published test-card pool in ./fictional (each used once per run: Aran gives an identifier to the first customer that presents it).
const Dt = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const Pt = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const rd = (n: number, f = 0) => Array.from({ length: n }, (_, i) => (i === 0 && f ? f + Math.floor(Math.random() * (10 - f)) : Math.floor(Math.random() * 10)));
const verh = (b: number[]) => { let c = 0; [...b].reverse().forEach((d, i) => { c = Dt[c]![Pt[(i + 1) % 8]![d]!]!; }); return [0,4,3,2,1,5,6,7,8,9][c]!; };
const LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; const L1 = () => LET[Math.floor(Math.random() * 26)]!;
export const genAadhaar = () => { const a = rd(11, 2); return [...a, verh(a)].join(""); };
// never starts with "91": the bank validator strips a leading 91 (country code) before checking
export const genMobile = (): string => { const m = `${6 + Math.floor(Math.random() * 4)}${rd(9).join("")}`; return m.startsWith("91") ? genMobile() : m; };
export const genPan = () => `${L1()}${L1()}${L1()}P${L1()}${rd(4).join("")}${L1()}`;

const STAFF = [
  { email: "kyc@tessera.test", name: "Kavya KYC", role: "kyc_officer" },
  { email: "support@tessera.test", name: "Sanjay Support", role: "support_agent" },
  { email: "compliance@tessera.test", name: "Chitra Compliance", role: "compliance_officer" },
  { email: "admin@tessera.test", name: "Arjun Admin", role: "admin" },
] as const;

async function main() {
  const db = makeDb(need("DATABASE_URL"));
  const sb = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // Local development only may fall back to the public demo password; any other database needs SEED_STAFF_PASSWORD (kept privately, never in the repository).
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(need("DATABASE_URL"));
  const password = process.env.SEED_STAFF_PASSWORD ?? (local ? "Tessera-demo-1" : "");
  if (!password) throw new Error("SEED_STAFF_PASSWORD is required when DATABASE_URL is not a local database");
  for (const s of STAFF) {
    const list = await sb.auth.admin.listUsers({ perPage: 200 });
    let u = list.data.users.find((x) => x.email === s.email);
    if (!u) { const c = await sb.auth.admin.createUser({ email: s.email, password, email_confirm: true }); if (c.error) throw c.error; u = c.data.user!; }
    await db.insert(t.staff).values({ id: u.id, email: s.email, fullName: s.name, role: s.role }).onConflictDoNothing();
  }
  console.log(`staff ready (password: ${process.env.SEED_STAFF_PASSWORD ? "from SEED_STAFF_PASSWORD" : "local demo default"}) ${STAFF.map((s) => s.email).join(", ")}`);

  const app = new Aran({ apiKey: need("ARAN_APP_KEY"), baseUrl: need("ARAN_BASE_URL"), timeoutMs: 8000 });
  const deps = { db, app, compliance: app }; // seed only protects; nothing is revealed or erased
  const [admin] = await db.select().from(t.staff).where(eq(t.staff.email, "admin@tessera.test"));
  const actor = { id: admin!.id, email: admin!.email, role: admin!.role };
  const have = (await db.select().from(t.customers)).length;
  const want = Number(process.env.SEED_CUSTOMERS ?? 25);
  for (let i = have; i < want; i++) {
    const r = await onboardCustomer(deps, actor, {
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, mobile: genMobile(), aadhaar: genAadhaar(),
      pan: i % 3 === 0 ? genPan() : undefined, card: i % 4 === 0 ? TEST_CARDS[i / 4] : undefined, loanInterest: i % 5 === 0, loanAmountRupees: 50000 + i * 10000,
    });
    if (i % 2 === 0) {
      const a = await openAccount(deps, actor, r.customerRef, "savings", 5000 + i * 1000);
      await transact(deps, actor, { kind: "deposit", accountNo: a.accountNo, rupees: 1500, description: "Salary credit" });
    }
  }
  const [{ n }] = (await db.$client`select count(*)::int as n from core_banking.customers`) as unknown as [{ n: number }];
  console.log(`customers in database: ${n}`);
  await db.$client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
