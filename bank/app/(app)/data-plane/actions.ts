"use server";
import { getDb } from "@/db";
import { requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { scanPlaintext, type ScanReport } from "@/lib/scan";

/** Runs the plaintext scanner over every table in the five schemas. Admin only. */
export async function scanAction(): Promise<ActionState<ScanReport>> {
  try { await requireActionSession("dataplane"); return { ok: true, data: await scanPlaintext(getDb().$client) }; }
  catch (e) { return fail(e) as ActionState<ScanReport>; }
}
