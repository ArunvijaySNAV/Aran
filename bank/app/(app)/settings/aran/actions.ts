"use server";
import { getDb } from "@/db";
import { requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { disconnect, getView, saveConnection, scrub, testConnection, type ConnectionView } from "@/lib/connection";
import { BadInput, Forbidden } from "@/lib/domain";

export type ConnectionState = ActionState<ConnectionView>;

/** One action for the three buttons (name="intent": save | test | disconnect). Responses carry only the public view: never a key. */
export async function aranConnectionAction(_: ConnectionState, f: FormData): Promise<ConnectionState> {
  try {
    const s = await requireActionSession("settings");
    const intent = String(f.get("intent") ?? "");
    const db = getDb();
    if (intent === "save") {
      const data = await saveConnection(db, s, { baseUrl: String(f.get("baseUrl") ?? ""), appKey: String(f.get("appKey") ?? ""), complianceKey: String(f.get("complianceKey") ?? "") });
      return { ok: true, message: data.status === "connected" ? "Saved. Aran Cloud is connected." : "Saved, but the connection has a problem. See the checks below.", data };
    }
    if (intent === "test") {
      const data = await testConnection(db, s);
      return { ok: true, message: data.status === "connected" ? "All checks passed." : "Some checks did not pass. See below.", data };
    }
    if (intent === "disconnect") {
      const data = await disconnect(db, s);
      return { ok: true, message: "Disconnected. The bank uses its environment variables again.", data };
    }
    throw new BadInput({}, "Unknown action.");
  } catch (e) {
    if (e instanceof BadInput || e instanceof Forbidden) return fail(e) as ConnectionState;
    console.error("aran connection:", scrub((e as Error)?.message ?? "unexpected error"));   // scrubbed: no key can reach a log
    return { ok: false, status: 500, message: "Something went wrong. Nothing was changed." };
  }
}

/** For the page and the status refresh: the public view only. */
export async function currentConnectionView(): Promise<ConnectionView> { return getView(getDb()); }
