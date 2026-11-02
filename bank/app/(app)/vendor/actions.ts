"use server";
import { deps, requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { buildVendorExport, simulateBreach } from "@/lib/domain";
import type { TraceResult } from "@aran/sdk";

export async function exportAction(): Promise<ActionState> {
  try { const s = await requireActionSession("vendor"); const b = await buildVendorExport(deps(), s); return { ok: true, message: `Batch created with ${b.rowCount} lead(s).` }; }
  catch (e) { return fail(e); }
}
export async function breachAction(_: ActionState<TraceResult>, f: FormData): Promise<ActionState<TraceResult>> {
  try { await requireActionSession("vendor"); return { ok: true, data: await simulateBreach(deps(), String(f.get("batchId"))) }; }
  catch (e) { return fail(e) as ActionState<TraceResult>; }
}
