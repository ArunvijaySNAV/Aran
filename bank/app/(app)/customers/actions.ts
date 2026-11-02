"use server";
import { deps, requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { onboardCustomer, resolveKycCase, revealField, type RevealField } from "@/lib/domain";

export async function onboardAction(_: ActionState<{ ref: string }>, f: FormData): Promise<ActionState<{ ref: string }>> {
  let ref: string;
  try {
    const s = await requireActionSession("onboard");
    const r = await onboardCustomer(deps(), s, {
      name: String(f.get("name") ?? ""), mobile: String(f.get("mobile") ?? ""), aadhaar: String(f.get("aadhaar") ?? ""),
      pan: String(f.get("pan") ?? "") || undefined, card: String(f.get("card") ?? "") || undefined,
      loanInterest: f.get("loanInterest") === "on", loanAmountRupees: Number(f.get("loanAmount") ?? 0),
    });
    ref = r.customerRef;
  } catch (e) { return fail(e) as ActionState<{ ref: string }>; }
  return { ok: true, data: { ref } };
}

export async function revealAction(_: ActionState<{ value: string; field: string }>, f: FormData): Promise<ActionState<{ value: string; field: string }>> {
  try {
    const s = await requireActionSession("compliance");
    const field = String(f.get("field")) as RevealField;
    const r = await revealField(deps(), s, String(f.get("ref")), field, String(f.get("reason") ?? ""));
    return { ok: true, data: { value: r.value, field } };
  } catch (e) { return fail(e) as ActionState<{ value: string; field: string }>; }
}

export async function kycDecisionAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const s = await requireActionSession("onboard");
    await resolveKycCase(deps(), s, String(f.get("caseId")), f.get("decision") === "approved" ? "approved" : "rejected", String(f.get("note") ?? ""));
    return { ok: true, message: "Decision saved." };
  } catch (e) { return fail(e); }
}
