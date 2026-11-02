"use server";
import { deps, requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { Forbidden, openAccount, transact } from "@/lib/domain";

async function writer() {
  const s = await requireActionSession("accounts");
  if (s.role !== "kyc_officer" && s.role !== "admin") throw new Forbidden("Your role has read-only access to accounts.");
  return s;
}

export async function openAccountAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await writer();
    const a = await openAccount(deps(), s, String(f.get("ref") ?? "").trim().toUpperCase(), f.get("type") === "current" ? "current" : "savings", Number(f.get("opening") ?? 0));
    return { ok: true, message: `Account ${a.accountNo} opened.` };
  } catch (e) { return fail(e); }
}

export async function transactAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await writer();
    const kind = String(f.get("kind"));
    const base = { accountNo: String(f.get("accountNo")), rupees: Number(f.get("amount")), description: String(f.get("description") ?? "") };
    const r = kind === "transfer" ? await transact(deps(), s, { kind: "transfer", toAccountNo: String(f.get("toAccountNo") ?? "").trim().toUpperCase(), ...base })
      : await transact(deps(), s, { kind: kind === "withdrawal" ? "withdrawal" : "deposit", ...base });
    return { ok: true, message: `Done. New balance ₹${(r.balancePaise / 100).toLocaleString("en-IN")}.` };
  } catch (e) { return fail(e); }
}
