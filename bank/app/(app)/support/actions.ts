"use server";
import { deps, requireActionSession } from "@/lib/auth";
import { fail, type ActionState } from "@/lib/action";
import { supportChat } from "@/lib/domain";

export type ChatData = { conversationId: string; reply: string; providerSaw: { role: string; content: string }[]; provider: string; protectedCount: number };
export async function chatAction(_: ActionState<ChatData>, f: FormData): Promise<ActionState<ChatData>> {
  try {
    const s = await requireActionSession("support");
    const ref = String(f.get("ref") ?? "").trim().toUpperCase() || null;
    const data = await supportChat(deps(), s, ref, String(f.get("prompt") ?? ""), String(f.get("conversationId") ?? "") || undefined);
    return { ok: true, data };
  } catch (e) { return fail(e) as ActionState<ChatData>; }
}
