"use server";
import { deps } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { eraseCustomer, listCustomerAccounts, onboardCustomer, portalLookup, proveTokensDead } from "@/lib/domain";
import { getDb } from "@/db";

export type PortalCreated = { customerRef: string; secret: string };
export async function portalOnboardAction(_: ActionState<PortalCreated>, f: FormData): Promise<ActionState<PortalCreated>> {
  try {
    const r = await onboardCustomer(deps(), { id: null, email: "customer-portal" }, {
      name: String(f.get("name") ?? ""), mobile: String(f.get("mobile") ?? ""), aadhaar: String(f.get("aadhaar") ?? ""),
      pan: String(f.get("pan") ?? "") || undefined, loanInterest: false,
    }, "portal");
    return { ok: true, data: { customerRef: r.customerRef, secret: r.portalSecret! } };
  } catch (e) { return fail(e) as ActionState<PortalCreated>; }
}

// guessing limiter: 5 tries per reference per 10 minutes (in memory; one instance is enough for the demo)
const tries = new Map<string, number[]>();
function limited(ref: string) {
  const now = Date.now(); const a = (tries.get(ref) ?? []).filter((t) => now - t < 600_000);
  a.push(now); tries.set(ref, a); return a.length > 5;
}

export type MyData = { customerRef: string; status: string; accounts: { accountNo: string; balance: number }[]; fields: string[]; erased?: { purpose: string; keyId: string }[]; dead?: { field: string; status: string }[] };
export async function portalViewAction(_: ActionState<MyData>, f: FormData): Promise<ActionState<MyData>> {
  const ref = String(f.get("ref") ?? "").trim().toUpperCase(); const secret = String(f.get("secret") ?? "").trim();
  if (limited(ref)) return { ok: false, status: 429, message: "Too many attempts. Try again in a few minutes." };
  const c = await portalLookup(getDb(), ref, secret);
  if (!c) return { ok: false, status: 401, message: "Reference or secret is not right." };
  const accounts = await listCustomerAccounts(getDb(), c.id);
  return { ok: true, data: { customerRef: c.customerRef, status: c.status, accounts: accounts.map((a) => ({ accountNo: a.accountNo, balance: a.balancePaise })), fields: ["Name", "Mobile", "Aadhaar", ...(c.panToken ? ["PAN"] : [])] } };
}

export async function portalEraseAction(_: ActionState<MyData>, f: FormData): Promise<ActionState<MyData>> {
  const ref = String(f.get("ref") ?? "").trim().toUpperCase(); const secret = String(f.get("secret") ?? "").trim();
  if (limited(ref)) return { ok: false, status: 429, message: "Too many attempts. Try again in a few minutes." };
  const c = await portalLookup(getDb(), ref, secret);
  if (!c) return { ok: false, status: 401, message: "Reference or secret is not right." };
  if (f.get("confirm") !== "ERASE") return { ok: false, status: 422, message: "Type ERASE to confirm." };
  try {
    const d = deps();
    const rs = await eraseCustomer(d, ref, "customer-portal");
    const dead = await proveTokensDead(d, ref);
    return { ok: true, data: { customerRef: ref, status: "erased", accounts: [], fields: [], erased: rs.map((r) => ({ purpose: r.purpose, keyId: String(r.receipt.key_id ?? "") })), dead: dead.map((x) => ({ field: x.field, status: x.status })) } };
  } catch (e) { return fail(e) as ActionState<MyData>; }
}
