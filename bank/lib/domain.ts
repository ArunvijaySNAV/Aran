// Bank operations. Pure functions over { db, app, compliance } so they can be tested against a mock Aran.
// Rule: if Aran is unreachable or returns an error, throw ServiceUnavailable (HTTP 503) and write nothing.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { AranError, type Aran, type Receipt } from "@aran/sdk";
import type { Db } from "@/db";
import * as t from "@/db/schema";
import { normMobile, validateOnboard, type OnboardInput } from "./validators";

export interface Deps { db: Db; app: Aran; compliance: Aran }
export interface Actor { id: string | null; email: string; role?: t.Role }

export class ServiceUnavailable extends Error {
  readonly status = 503;
  constructor(readonly cause?: unknown) { super("Data protection service unavailable. Nothing was saved."); }
}
export class Forbidden extends Error { readonly status = 403; }
export class BadInput extends Error { readonly status = 422; constructor(readonly fields: Record<string, string>, msg = "Check the highlighted fields.") { super(msg); } }
export class NotFound extends Error { readonly status = 404; }

/** Runs an Aran call; any failure becomes ServiceUnavailable so callers fail closed. */
async function aranCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof AranError || (e as Error)?.name?.startsWith("Aran")) throw new ServiceUnavailable(e);
    throw e;
  }
}

/** Redacts free text through Aran before it may be stored. Throws if anything sensitive was left raw. */
export async function redact(app: Aran, text: string, sink: string, customerRef?: string): Promise<string> {
  if (!text.trim()) return "";
  const r = await aranCall(() => app.protect({ text, sink, purpose: "Service", customerRef }));
  if (r.findings.some((f) => !f.protected)) throw new ServiceUnavailable(new Error("a sensitive value was not protected"));
  return r.after;
}

async function logLine(deps: Deps, tx: Pick<Db, "insert">, actor: Actor, action: string, text: string, ref?: string) {
  const line = await redact(deps.app, text, "log-platform", ref);
  await tx.insert(t.appLogs).values({ actor: actor.email, action, line });
}

export async function nextCustomerRef(db: Db): Promise<string> {
  const r = await db.execute(sql`select nextval('core_banking.customer_ref_seq') as n`);
  return `CUS-${String((r as unknown as { n: string }[])[0]!.n).padStart(6, "0")}`;
}

// ------------------------------------------------------------------ onboarding
export async function onboardCustomer(deps: Deps, actor: Actor, input: OnboardInput, source: "branch" | "portal" = "branch") {
  const errs = validateOnboard(input);
  if (Object.keys(errs).length) throw new BadInput(errs);
  const ref = await nextCustomerRef(deps.db);
  const mobile = normMobile(input.mobile);
  const aadhaar = input.aadhaar.replace(/[\s-]/g, "");
  const secret = source === "portal" ? randomBytes(9).toString("base64url") : null;

  await deps.db.transaction(async (tx) => {
    // (a) kyc-archive: tokens for every identifier
    const kycFields: Record<string, string> = { name: input.name.trim(), mobile, aadhaar };
    if (input.pan) kycFields.pan = input.pan.trim().toUpperCase();
    if (input.card) kycFields.card = input.card.replace(/[\s-]/g, "");
    const kyc = await aranCall(() => deps.app.protectFields({ fields: kycFields, customerRef: ref, purpose: "KYC", sink: "kyc-archive" }));
    const [cust] = await tx.insert(t.customers).values({
      customerRef: ref, nameToken: kyc.name!, mobileToken: kyc.mobile!, aadhaarToken: kyc.aadhaar!,
      panToken: kyc.pan ?? null, cardToken: kyc.card ?? null, source, createdBy: actor.id,
      portalSecretHash: secret ? createHash("sha256").update(secret).digest("hex") : null,
    }).returning({ id: t.customers.id });
    await tx.insert(t.kycCases).values({ customerId: cust!.id, openedBy: actor.id });

    // (c) log-platform: a redacted audit line (the mobile number is in the text on purpose: Aran must redact it)
    await logLine(deps, tx, actor, "customer.onboarded", `KYC onboarding completed for ${ref}, contact mobile ${mobile}`, ref);

    // (d) crm: contact with the CRM sink's own tokens
    const crm = await aranCall(() => deps.app.protectFields({ fields: { name: input.name.trim(), mobile }, customerRef: ref, purpose: "Service", sink: "crm" }));
    await tx.insert(t.contacts).values({ customerRef: ref, nameToken: crm.name!, mobileToken: crm.mobile! });

    // consented loan lead: loan-vendor tokens
    if (input.loanInterest) {
      const lf: Record<string, string> = { name: input.name.trim(), mobile };
      if (input.pan) lf.pan = input.pan.trim().toUpperCase();
      const loan = await aranCall(() => deps.app.protectFields({ fields: lf, customerRef: ref, purpose: "Loans", sink: "loan-vendor" }));
      await tx.insert(t.loanLeads).values({ customerRef: ref, nameToken: loan.name!, mobileToken: loan.mobile!, panToken: loan.pan ?? null, loanAmountPaise: Math.round(Number(input.loanAmountRupees) * 100) });
    }
  });
  return { customerRef: ref, portalSecret: secret };
}

// ------------------------------------------------------------------ reads
export async function listCustomers(db: Db, q: string, page: number, pageSize = 15) {
  const where = q ? sql`${t.customers.customerRef} ilike ${"%" + q.replace(/[%_]/g, "") + "%"}` : undefined;
  const rows = await db.select().from(t.customers).where(where).orderBy(desc(t.customers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(t.customers).where(where)) as [{ n: number }];
  return { rows, total: n, pageSize };
}
export async function getCustomer(db: Db, ref: string) {
  const [c] = await db.select().from(t.customers).where(eq(t.customers.customerRef, ref));
  return c ?? null;
}

export async function dashboardStats(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(t.customers);
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(t.customers).where(gte(t.customers.createdAt, weekAgo));
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(t.kycCases).where(eq(t.kycCases.status, "open"));
  const [d] = await db.select({ n: sql<number>`coalesce(sum(balance_paise),0)::bigint` }).from(t.accounts);
  const events = await db.select().from(t.appLogs).orderBy(desc(t.appLogs.id)).limit(10);
  return { customers: a!.n, newKycThisWeek: b!.n, openCases: c!.n, depositsPaise: Number(d!.n), events };
}

export async function resolveKycCase(deps: Deps, actor: Actor, caseId: string, status: "approved" | "rejected", note: string) {
  const redacted = await redact(deps.app, note, "log-platform");
  await deps.db.transaction(async (tx) => {
    await tx.update(t.kycCases).set({ status, notes: redacted, resolvedAt: new Date() }).where(and(eq(t.kycCases.id, caseId), eq(t.kycCases.status, "open")));
    await tx.insert(t.appLogs).values({ actor: actor.email, action: `kyc.${status}`, line: `case ${caseId} ${status}` });
  });
}

// ------------------------------------------------------------------ accounts
export async function openAccount(deps: Deps, actor: Actor, ref: string, type: "savings" | "current", openingRupees: number) {
  const c = await getCustomer(deps.db, ref);
  if (!c) throw new NotFound("No such customer");
  if (c.status !== "active") throw new BadInput({ customer: "Customer data was erased" });
  if (!(openingRupees >= 0)) throw new BadInput({ opening: "Opening deposit cannot be negative" });
  const line = await redact(deps.app, `account opened for ${ref}`, "log-platform", ref);
  return deps.db.transaction(async (tx) => {
    const no = ((await tx.execute(sql`select nextval('core_banking.account_no_seq') as n`)) as unknown as { n: string }[])[0]!.n;
    const [acc] = await tx.insert(t.accounts).values({ customerId: c.id, accountNo: `TSB${no}`, type, balancePaise: Math.round(openingRupees * 100) }).returning();
    if (openingRupees > 0) await tx.insert(t.transactions).values({ accountId: acc!.id, kind: "deposit", amountPaise: Math.round(openingRupees * 100), balanceAfterPaise: Math.round(openingRupees * 100), description: "Opening deposit", createdBy: actor.id });
    await tx.insert(t.appLogs).values({ actor: actor.email, action: "account.opened", line });
    return acc!;
  });
}

export type TxOp = { kind: "deposit" | "withdrawal"; accountNo: string; rupees: number; description: string } | { kind: "transfer"; accountNo: string; toAccountNo: string; rupees: number; description: string };

export async function transact(deps: Deps, actor: Actor, op: TxOp) {
  const paise = Math.round(op.rupees * 100);
  if (!Number.isFinite(paise) || paise <= 0) throw new BadInput({ amount: "Enter an amount above zero." });
  if (op.kind === "transfer" && op.toAccountNo === op.accountNo) throw new BadInput({ toAccountNo: "Choose a different destination account." });
  const description = await redact(deps.app, op.description ?? "", "log-platform");   // before any write
  return deps.db.transaction(async (tx) => {
    const toNo = op.kind === "transfer" ? op.toAccountNo : null;
    const nos = toNo ? [op.accountNo, toNo] : [op.accountNo];
    const rows = await tx.select().from(t.accounts).where(inArray(t.accounts.accountNo, nos)).orderBy(t.accounts.id).for("update");
    const from = rows.find((r) => r.accountNo === op.accountNo);
    if (!from) throw new NotFound("No such account");
    if (from.status !== "open") throw new BadInput({ account: "Account is not open" });
    if (op.kind === "deposit") {
      const bal = from.balancePaise + paise;
      await tx.update(t.accounts).set({ balancePaise: bal }).where(eq(t.accounts.id, from.id));
      await tx.insert(t.transactions).values({ accountId: from.id, kind: "deposit", amountPaise: paise, balanceAfterPaise: bal, description, createdBy: actor.id });
      return { balancePaise: bal };
    }
    if (from.balancePaise < paise) throw new BadInput({ amount: "Insufficient balance." });
    const bal = from.balancePaise - paise;
    await tx.update(t.accounts).set({ balancePaise: bal }).where(eq(t.accounts.id, from.id));
    if (op.kind === "withdrawal") {
      await tx.insert(t.transactions).values({ accountId: from.id, kind: "withdrawal", amountPaise: paise, balanceAfterPaise: bal, description, createdBy: actor.id });
      return { balancePaise: bal };
    }
    const to = rows.find((r) => r.accountNo === toNo);
    if (!to) throw new NotFound("No such destination account");
    if (to.status !== "open") throw new BadInput({ toAccountNo: "Destination account is not open" });
    const toBal = to.balancePaise + paise;
    await tx.update(t.accounts).set({ balancePaise: toBal }).where(eq(t.accounts.id, to.id));
    await tx.insert(t.transactions).values([
      { accountId: from.id, kind: "transfer_out", amountPaise: paise, balanceAfterPaise: bal, counterpartyAccountId: to.id, description, createdBy: actor.id },
      { accountId: to.id, kind: "transfer_in", amountPaise: paise, balanceAfterPaise: toBal, counterpartyAccountId: from.id, description, createdBy: actor.id },
    ]);
    return { balancePaise: bal };
  });
}

export async function statement(db: Db, accountNo: string, page: number, pageSize = 20) {
  const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.accountNo, accountNo));
  if (!acc) return null;
  const rows = await db.select().from(t.transactions).where(eq(t.transactions.accountId, acc.id)).orderBy(desc(t.transactions.createdAt), desc(t.transactions.id)).limit(pageSize).offset((page - 1) * pageSize);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(t.transactions).where(eq(t.transactions.accountId, acc.id))) as [{ n: number }];
  return { account: acc, rows, total: n, pageSize };
}

// ------------------------------------------------------------------ reveal (compliance only)
export const REVEALABLE = { aadhaar: "aadhaarToken", mobile: "mobileToken", pan: "panToken", card: "cardToken" } as const;
export type RevealField = keyof typeof REVEALABLE;

export async function revealField(deps: Deps, actor: Actor, ref: string, field: RevealField, reason: string) {
  if (actor.role !== "compliance_officer") throw new Forbidden("Only a compliance officer can reveal protected values.");
  if (!(field in REVEALABLE)) throw new BadInput({ field: "This field cannot be revealed." });
  if (reason.trim().length < 10) throw new BadInput({ reason: "Give a reason of at least 10 characters." });
  const c = await getCustomer(deps.db, ref);
  if (!c) throw new NotFound("No such customer");
  if (c.status === "erased") throw new BadInput({ field: "This customer's data was erased." });
  const token = c[REVEALABLE[field]];
  if (!token) throw new BadInput({ field: "No value on file." });
  const redactedReason = await redact(deps.app, reason, "log-platform", ref);
  const r = await aranCall(() => deps.compliance.detokenise({ token, caller: `compliance:${actor.email}` }));
  if (r.status !== "ok" || r.value == null) throw new BadInput({ field: r.status === "erased" ? "This value was erased." : "This value cannot be revealed." });
  await deps.db.insert(t.reveals).values({ customerRef: ref, field, reason: redactedReason, staffId: actor.id });
  return { value: r.value };
}

// ------------------------------------------------------------------ support AI
export async function supportChat(deps: Deps, actor: Actor, ref: string | null, prompt: string, conversationId?: string) {
  if (!prompt.trim()) throw new BadInput({ prompt: "Type a question." });
  const g = await aranCall(() => deps.app.gateway({ prompt, role: "customer-care" })) as {
    reply: string; provider_saw: { role: string; content: string }[]; provider_reply: string; provider: string; findings_in_prompt: number;
  };
  const saw = g.provider_saw[g.provider_saw.length - 1]?.content ?? "";
  let convId = conversationId;
  if (!convId) {
    const [c] = await deps.db.insert(t.conversations).values({ customerRef: ref, staffId: actor.id, provider: g.provider }).returning({ id: t.conversations.id });
    convId = c!.id;
  }
  await deps.db.insert(t.messages).values([
    { conversationId: convId, role: "user", content: saw },
    { conversationId: convId, role: "assistant", content: g.provider_reply },
  ]);
  return { conversationId: convId, reply: g.reply, providerSaw: g.provider_saw, provider: g.provider, protectedCount: g.findings_in_prompt };
}

// ------------------------------------------------------------------ loan vendor export (admin)
export async function buildVendorExport(deps: Deps, actor: Actor) {
  const leads = await deps.db.select().from(t.loanLeads).where(isNull(t.loanLeads.exportedBatchId));
  if (!leads.length) throw new BadInput({ export: "No new loan leads to export." });
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["customer_ref,name_token,mobile_token,pan_token,loan_amount_inr", ...leads.map((l) => [l.customerRef, l.nameToken, l.mobileToken, l.panToken, l.loanAmountPaise / 100].map(esc).join(","))].join("\n");
  return deps.db.transaction(async (tx) => {
    const [b] = await tx.insert(t.exportBatches).values({ createdBy: actor.id, rowCount: leads.length, csv }).returning();
    for (const l of leads) await tx.update(t.loanLeads).set({ exportedBatchId: b!.id }).where(eq(t.loanLeads.id, l.id));
    await tx.insert(t.appLogs).values({ actor: actor.email, action: "vendor.export", line: `exported ${leads.length} leads in batch ${b!.id}` });
    return b!;
  });
}
export async function simulateBreach(deps: Deps, batchId: string) {
  const [b] = await deps.db.select().from(t.exportBatches).where(eq(t.exportBatches.id, batchId));
  if (!b) throw new NotFound("No such batch");
  return aranCall(() => deps.app.trace({ dump: b.csv }));
}

// ------------------------------------------------------------------ erasure & receipts (compliance)
export const PURPOSES = ["KYC", "Loans", "Service", "Marketing"] as const;

export async function eraseCustomer(deps: Deps, ref: string, requestedBy: string) {
  const c = await getCustomer(deps.db, ref);
  if (!c) throw new NotFound("No such customer");
  const receipts: { purpose: string; receipt: Receipt }[] = [];
  for (const purpose of PURPOSES) {
    const receipt = await aranCall(() => deps.compliance.erase({ customerRef: ref, purpose }));
    receipts.push({ purpose, receipt });
  }
  await deps.db.transaction(async (tx) => {
    for (const r of receipts) await tx.insert(t.erasureRequests).values({ customerRef: ref, purpose: r.purpose, requestedBy, receipt: r.receipt as unknown as object });
    await tx.update(t.customers).set({ status: "erased" }).where(eq(t.customers.id, c.id));
    await tx.insert(t.appLogs).values({ actor: requestedBy, action: "customer.erased", line: `erased ${ref} for ${PURPOSES.join(", ")}` });
  });
  return receipts;
}
export async function verifyStoredReceipt(deps: Deps, receipt: Receipt) {
  return aranCall(() => deps.compliance.verifyReceipt(receipt));
}
/** After erasure: every token this bank still stores for the customer should now read as erased. */
export async function proveTokensDead(deps: Deps, ref: string) {
  const c = await getCustomer(deps.db, ref);
  if (!c) throw new NotFound("No such customer");
  const out: { field: string; token: string; status: string }[] = [];
  for (const [field, col] of Object.entries(REVEALABLE)) {
    const token = c[col as keyof typeof c] as string | null;
    if (!token) continue;
    const r = await aranCall(() => deps.compliance.detokenise({ token, caller: "compliance:erasure-check" }));
    out.push({ field, token, status: r.status });
  }
  return out;
}

// ------------------------------------------------------------------ portal
export async function portalLookup(db: Db, ref: string, secret: string) {
  const c = await getCustomer(db, ref);
  const hash = createHash("sha256").update(secret).digest("hex");
  if (!c || !c.portalSecretHash || c.portalSecretHash !== hash) return null;
  return c;
}
export async function listCustomerAccounts(db: Db, customerId: string) {
  return db.select().from(t.accounts).where(eq(t.accounts.customerId, customerId));
}
