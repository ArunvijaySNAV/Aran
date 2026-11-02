import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Aran } from "@aran/sdk";
import { eq, sql } from "drizzle-orm";
import { makeDb, type Db } from "@/db";
import * as t from "@/db/schema";
import { BadInput, Forbidden, ServiceUnavailable, eraseCustomer, onboardCustomer, openAccount, proveTokensDead, revealField, simulateBreach, buildVendorExport, transact, verifyStoredReceipt, type Actor, type Deps } from "@/lib/domain";
import { findPlaintext, scanPlaintext } from "@/lib/scan";
import { isAadhaar, isCard, isMobile, luhnValid, verhoeffValid } from "@/lib/validators";
import { APP_KEY, COMPLIANCE_KEY, MockAran } from "./mockAran";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
let db: Db; let mock: MockAran; let deps: Deps;
const staffId = crypto.randomUUID();
const kyc: Actor = { id: staffId, email: "test-kyc@tessera.test", role: "kyc_officer" };
const comp: Actor = { id: staffId, email: "test-comp@tessera.test", role: "compliance_officer" };
const AADHAAR = "341777631706"; // generated, checksum-valid, belongs to nobody
const valid = (over: Partial<Parameters<typeof onboardCustomer>[2]> = {}) => ({ name: "Pooja Hegde", mobile: "9907439150", aadhaar: AADHAAR, ...over });
const created: string[] = [];

async function counts() {
  const q = async (s: string) => Number(((await db.$client.unsafe(`select count(*)::int as n from ${s}`)) as unknown as { n: number }[])[0]!.n);
  return { customers: await q("core_banking.customers"), kyc: await q("core_banking.kyc_cases"), logs: await q("log_platform.app_logs"), contacts: await q("crm.contacts"), leads: await q("vendor_share.loan_leads") };
}

beforeAll(async () => {
  db = makeDb(DB_URL);
  mock = await new MockAran().start();
  await db.insert(t.staff).values({ id: staffId, email: "test-owner@tessera.test", fullName: "Test", role: "admin" }).onConflictDoNothing();
  deps = { db, app: new Aran({ apiKey: APP_KEY, baseUrl: mock.url, timeoutMs: 3000, retryBaseMs: 1 }), compliance: new Aran({ apiKey: COMPLIANCE_KEY, baseUrl: mock.url, timeoutMs: 3000, retryBaseMs: 1 }) };
});
beforeEach(() => mock.reset());
afterAll(async () => {
  await mock.stop();
  if (created.length) {
    const refs = sql.join(created.map((r) => sql`${r}`), sql`, `);
    await db.execute(sql`delete from core_banking.transactions where account_id in (select a.id from core_banking.accounts a join core_banking.customers c on c.id=a.customer_id where c.customer_ref in (${refs}))`);
    await db.execute(sql`delete from core_banking.accounts where customer_id in (select id from core_banking.customers where customer_ref in (${refs}))`);
    await db.execute(sql`delete from core_banking.kyc_cases where customer_id in (select id from core_banking.customers where customer_ref in (${refs}))`);
    await db.execute(sql`delete from core_banking.reveals where customer_ref in (${refs})`);
    await db.execute(sql`delete from core_banking.erasure_requests where customer_ref in (${refs})`);
    await db.execute(sql`delete from crm.contacts where customer_ref in (${refs})`);
    await db.execute(sql`delete from vendor_share.loan_leads where customer_ref in (${refs})`);
    await db.execute(sql`delete from core_banking.customers where customer_ref in (${refs})`);
  }
  await db.execute(sql`delete from log_platform.app_logs where actor like 'test-%'`);
  await db.execute(sql`delete from vendor_share.export_batches where created_by = ${staffId}`);
  await db.execute(sql`delete from core_banking.staff where id = ${staffId}`);
  await db.$client.end();
});

describe("validators", () => {
  it("accepts a valid Aadhaar and rejects a wrong check digit", () => {
    expect(verhoeffValid(AADHAAR)).toBe(true);
    expect(isAadhaar(AADHAAR)).toBe(true);
    expect(isAadhaar("341777631707")).toBe(false);
    expect(isAadhaar("141777631706")).toBe(false);
  });
  it("Luhn and mobile", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(isCard("4111111111111112")).toBe(false);
    expect(isMobile("9907439150")).toBe(true);
    expect(isMobile("+91 99074 39150")).toBe(true);
    expect(isMobile("5907439150")).toBe(false);
  });
});

describe("onboarding fails closed", () => {
  it("stores tokens only and writes one row per schema on success", async () => {
    const before = await counts();
    const r = await onboardCustomer(deps, kyc, valid({ pan: "YOJPN8124D", loanInterest: true, loanAmountRupees: 100000 }));
    created.push(r.customerRef);
    const after = await counts();
    expect(after.customers).toBe(before.customers + 1);
    expect(after.contacts).toBe(before.contacts + 1);
    expect(after.leads).toBe(before.leads + 1);
    expect(after.logs).toBe(before.logs + 1);
    const [c] = await db.select().from(t.customers).where(eq(t.customers.customerRef, r.customerRef));
    expect(c!.aadhaarToken).not.toContain(AADHAAR);
    expect(c!.aadhaarToken).toMatch(/^\d{12}$/);
    expect(verhoeffValid(c!.aadhaarToken)).toBe(false);
    expect(c!.mobileToken).toMatch(/^<MOBILE:/);
    // the log line was redacted by Aran, not by us
    const [log] = await db.select().from(t.appLogs).orderBy(sql`id desc`).limit(1);
    expect(log!.line).not.toContain("9907439150");
    // different sinks, different tokens
    const [crm] = await db.select().from(t.contacts).where(eq(t.contacts.customerRef, r.customerRef));
    expect(crm!.mobileToken).not.toBe(c!.mobileToken);
  });

  it("Aran down: 503 and NOTHING is written", async () => {
    mock.down = true;
    const before = await counts();
    const e = await onboardCustomer(deps, kyc, valid()).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailable);
    expect(e.status).toBe(503);
    expect(await counts()).toEqual(before);
  });

  it("Aran fails half-way (after the KYC call): the whole transaction rolls back", async () => {
    mock.failAfter = 1; // kyc-archive protect succeeds, the next Aran call (log line) gets 503
    const before = await counts();
    const e = await onboardCustomer(deps, kyc, valid({ loanInterest: true, loanAmountRupees: 50000 })).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailable);
    expect(mock.calls.filter((c) => c.path === "/v1/protect").length).toBeGreaterThanOrEqual(2);   // it really got past the first call
    expect(await counts()).toEqual(before);                                                          // customers, cases, logs, contacts, leads all unchanged
  });

  it("invalid input is rejected before any Aran call", async () => {
    const e = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631707" })).catch((x) => x);
    expect(e).toBeInstanceOf(BadInput);
    expect(e.fields.aadhaar).toBeTruthy();
    expect(mock.calls).toHaveLength(0);
  });

  it("an unprotected field from Aran is never stored (SDK refuses it)", async () => {
    const orig = mock.protect.bind(mock);
    mock.protect = (text, ref, purpose) => { const r = orig(text, ref, purpose); return { after: text, findings: r.findings.map((f) => ({ ...f, protected: false })) }; };
    const before = await counts();
    const e = await onboardCustomer(deps, kyc, valid()).catch((x) => x);
    mock.protect = orig;
    expect(e).toBeInstanceOf(ServiceUnavailable);
    expect(await counts()).toEqual(before);
  });
});

describe("reveal permission", () => {
  let ref: string;
  beforeEach(async () => { const r = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706" })); ref = r.customerRef; created.push(ref); });

  it("only a compliance officer can reveal", async () => {
    for (const role of ["kyc_officer", "support_agent", "admin"] as const) {
      const e = await revealField(deps, { ...kyc, role }, ref, "aadhaar", "audit review of this account").catch((x) => x);
      expect(e).toBeInstanceOf(Forbidden);
    }
    expect(mock.calls.filter((c) => c.path === "/v1/detokenise")).toHaveLength(0);   // Aran was never asked
  });
  it("requires a reason", async () => {
    const e = await revealField(deps, comp, ref, "aadhaar", "short").catch((x) => x);
    expect(e).toBeInstanceOf(BadInput);
    expect(e.fields.reason).toBeTruthy();
  });
  it("reveals with the compliance key, records the reason, and the app key could not", async () => {
    const r = await revealField(deps, comp, ref, "aadhaar", "Regulator request 2026-114, verify identity");
    expect(r.value).toBe(AADHAAR);
    const used = mock.calls.filter((c) => c.path === "/v1/detokenise");
    expect(used).toHaveLength(1);
    expect(used[0]!.key).toBe(COMPLIANCE_KEY);
    const rows = await db.select().from(t.reveals).where(eq(t.reveals.customerRef, ref));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toContain("Regulator request");
    // the app-server key has no detokenise scope
    await expect(deps.app.detokenise({ token: "x" })).rejects.toMatchObject({ status: 403 });
  });
  it("names are one-way and cannot be revealed", async () => {
    const e = await revealField(deps, comp, ref, "name" as never, "audit review of this account").catch((x) => x);
    expect(e).toBeInstanceOf(BadInput);
  });
});

describe("accounts", () => {
  it("deposit, withdraw, transfer and balance checks are atomic", async () => {
    const r1 = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706" })); created.push(r1.customerRef);
    const r2 = await onboardCustomer(deps, kyc, valid({ name: "Rahul Kumar", mobile: "9812345678", aadhaar: "341777631706" })); created.push(r2.customerRef);
    const a = await openAccount(deps, kyc, r1.customerRef, "savings", 1000);
    const b = await openAccount(deps, kyc, r2.customerRef, "current", 0);
    await transact(deps, kyc, { kind: "deposit", accountNo: a.accountNo, rupees: 500, description: "cash, caller 9907439150" });
    await transact(deps, kyc, { kind: "transfer", accountNo: a.accountNo, toAccountNo: b.accountNo, rupees: 700, description: "rent" });
    const bal = async (no: string) => Number((await db.select().from(t.accounts).where(eq(t.accounts.accountNo, no)))[0]!.balancePaise);
    expect(await bal(a.accountNo)).toBe(80000);
    expect(await bal(b.accountNo)).toBe(70000);
    const e = await transact(deps, kyc, { kind: "withdrawal", accountNo: a.accountNo, rupees: 5000, description: "" }).catch((x) => x);
    expect(e).toBeInstanceOf(BadInput);
    const e2 = await transact(deps, kyc, { kind: "transfer", accountNo: a.accountNo, toAccountNo: b.accountNo, rupees: 5000, description: "" }).catch((x) => x);
    expect(e2).toBeInstanceOf(BadInput);
    expect(await bal(a.accountNo) + (await bal(b.accountNo))).toBe(150000);   // money conserved
    const rows = await db.select().from(t.transactions);
    expect(rows.some((x) => x.description.includes("9907439150"))).toBe(false);  // description was redacted
  });
  it("a description that cannot be redacted blocks the transaction (503)", async () => {
    const r = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706" })); created.push(r.customerRef);
    const a = await openAccount(deps, kyc, r.customerRef, "savings", 100);
    mock.down = true;
    const e = await transact(deps, kyc, { kind: "deposit", accountNo: a.accountNo, rupees: 10, description: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailable);
    const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.accountNo, a.accountNo));
    expect(acc!.balancePaise).toBe(10000);
  });
});

describe("vendor export and breach trace", () => {
  it("exports consented leads as tokens and traces a leaked batch", async () => {
    const r = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706", pan: "YOJPN8124D", loanInterest: true, loanAmountRupees: 200000 })); created.push(r.customerRef);
    const batch = await buildVendorExport(deps, kyc);
    expect(batch.csv).toContain(r.customerRef);
    expect(batch.csv).not.toContain("9907439150");
    expect(batch.csv).not.toContain("YOJPN8124D");
    const trace = await simulateBreach(deps, batch.id);
    expect(trace.top?.sink).toBe("loan-vendor");
  });
});

describe("erasure and receipts", () => {
  it("erases all purposes, stores receipts, tokens stop resolving, receipt verifies", async () => {
    const r = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706", pan: "YOJPN8124D" })); created.push(r.customerRef);
    const alive = await proveTokensDead(deps, r.customerRef);
    expect(alive.every((x) => x.status === "ok")).toBe(true);
    const receipts = await eraseCustomer(deps, r.customerRef, comp.email);
    expect(receipts.map((x) => x.purpose)).toEqual(["KYC", "Loans", "Service", "Marketing"]);
    const dead = await proveTokensDead(deps, r.customerRef);
    expect(dead.length).toBeGreaterThanOrEqual(3);
    expect(dead.every((x) => x.status === "erased")).toBe(true);
    const [c] = await db.select().from(t.customers).where(eq(t.customers.customerRef, r.customerRef));
    expect(c!.status).toBe("erased");
    expect((await db.select().from(t.erasureRequests).where(eq(t.erasureRequests.customerRef, r.customerRef)))).toHaveLength(4);
    expect((await verifyStoredReceipt(deps, receipts[0]!.receipt)).valid).toBe(true);
    // revealing after erasure is refused
    const e = await revealField(deps, comp, r.customerRef, "aadhaar", "after erasure, should fail").catch((x) => x);
    expect(e).toBeInstanceOf(BadInput);
  });
});

describe("no plaintext in the database", () => {
  it("findPlaintext flags raw identifiers and ignores Aran tokens", () => {
    expect(findPlaintext(`Aadhaar ${AADHAAR}`).map((f) => f.kind)).toEqual(["aadhaar"]);
    expect(findPlaintext("Aadhaar 3417 7763 1706").map((f) => f.kind)).toEqual(["aadhaar"]);
    expect(findPlaintext("call 9907439150").map((f) => f.kind)).toEqual(["mobile"]);
    expect(findPlaintext("card 4111111111111111").map((f) => f.kind)).toEqual(["card"]);
    expect(findPlaintext("card 4111 1111 1111 1111").map((f) => f.kind)).toEqual(["card"]);
    // tokens: Aran Aadhaar tokens fail Verhoeff; card tokens fail Luhn; placeholders have no digit runs
    expect(findPlaintext("tok 956561289261 and <MOBILE:v18835bacea> and <PER:c7c1a5f075>")).toEqual([]);
    // a placeholder whose random hex happens to be all digits must not be a false positive
    expect(findPlaintext("name <PER:9876543210> mobile <MOBILE:v9876543210>")).toEqual([]);
    expect(findPlaintext("ref CUS-000123 batch 3f2a6c1e-8b6d-4a3e-9c1f-123456789012")).toEqual([]);
  });
  it("after onboarding through Aran the scan is clean, and a planted raw value is caught", async () => {
    const r = await onboardCustomer(deps, kyc, valid({ aadhaar: "341777631706", pan: "YOJPN8124D", card: "4111111111111111" })); created.push(r.customerRef);
    const first = await scanPlaintext(db.$client);
    expect(first.findings).toEqual([]);
    // negative control: plant a raw mobile in a log line, expect the scanner to find it, then remove it
    const [row] = await db.insert(t.appLogs).values({ actor: "test-plant", action: "plant", line: "oops 9907439150" }).returning();
    try {
      const rep = await scanPlaintext(db.$client);
      expect(rep.clean).toBe(false);
      expect(rep.findings.some((f) => f.table === "app_logs" && f.kind === "mobile")).toBe(true);
    } finally { await db.delete(t.appLogs).where(eq(t.appLogs.id, row!.id)); }
    expect((await scanPlaintext(db.$client)).clean).toBe(true);
  });
});
