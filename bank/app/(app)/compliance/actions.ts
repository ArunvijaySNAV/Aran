"use server";
import { deps, requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { eraseCustomer, proveTokensDead, verifyStoredReceipt } from "@/lib/domain";
import type { Receipt } from "@aran/sdk";

export type EraseData = { receipts: { purpose: string; receipt: Receipt; verify?: Record<string, unknown> }[]; dead: { field: string; token: string; status: string }[] };
export async function eraseAction(_: ActionState<EraseData>, f: FormData): Promise<ActionState<EraseData>> {
  try {
    const s = await requireActionSession("compliance");
    const ref = String(f.get("ref") ?? "").trim().toUpperCase();
    if (f.get("confirm") !== ref || !ref) return { ok: false, status: 422, message: "Type the customer reference exactly to confirm.", fieldErrors: { confirm: "Does not match" } };
    const d = deps();
    const receipts = await eraseCustomer(d, ref, s.email);
    const dead = await proveTokensDead(d, ref);
    return { ok: true, data: { receipts: receipts.map((r) => ({ purpose: r.purpose, receipt: r.receipt })), dead } };
  } catch (e) { return fail(e) as ActionState<EraseData>; }
}
export async function verifyAction(_: ActionState<{ valid: boolean; detail: string }>, f: FormData): Promise<ActionState<{ valid: boolean; detail: string }>> {
  try {
    await requireActionSession("compliance");
    const v = await verifyStoredReceipt(deps(), JSON.parse(String(f.get("receipt"))));
    return { ok: true, data: { valid: !!v.valid, detail: v.valid ? `Ed25519 ✓${v.post_quantum_valid ? " · ML-DSA-65 ✓" : ""} · in the transparency log ✓` : String(v.error ?? "signature or log check failed") } };
  } catch (e) { return fail(e) as ActionState<{ valid: boolean; detail: string }>; }
}
