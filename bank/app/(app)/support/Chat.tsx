"use client";
import { useActionState } from "react";
import { Banner, Button, Card, CardTitle, Field, Input, Textarea } from "@/components/ui";
import { LogLine } from "@/components/aran";
import { chatAction, type ChatData } from "./actions";

export function Chat() {
  const [s, action, pending] = useActionState<{ ok: boolean; status?: number; message?: string; fieldErrors?: Record<string, string>; data?: ChatData }, FormData>(chatAction, { ok: false });
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="conversationId" value={s.data?.conversationId ?? ""} />
          <Field label="Customer reference (optional)" htmlFor="ref"><Input id="ref" name="ref" placeholder="e.g. CUS-000001…" /></Field>
          <Field label="Ask the assistant" htmlFor="prompt" error={s.fieldErrors?.prompt} hint="Paste real-looking customer details if you like: the provider never sees them."><Textarea id="prompt" name="prompt" required aria-invalid={!!s.fieldErrors?.prompt} /></Field>
          <Button variant="primary" disabled={pending}>{pending ? "Asking…" : "Ask"}</Button>
        </form>
        {s.message && !s.fieldErrors?.prompt ? <Banner tone="bad" role="alert">{s.status === 503 ? "Service unavailable (503). " : ""}{s.message}</Banner> : null}
        {s.data ? (
          <div><Card><CardTitle>Answer to you</CardTitle><p className="whitespace-pre-wrap break-words text-[16px]">{s.data.reply}</p>
            <p className="mt-3 text-[14px] text-ink2">Provider: <strong>{s.data.provider}</strong></p></Card></div>
        ) : null}
      </div>
      <div className="night rounded-[14px] p-5 sm:p-6 lg:sticky lg:top-20" aria-live="polite">
        {s.data ? (
          <>
            <h2 className="mb-3 text-[19px] font-bold leading-tight [font-stretch:100%]">What the AI provider saw</h2>
            {s.data.providerSaw.map((m, i) => <pre key={i} className="mb-3 whitespace-pre-wrap break-words rounded-[8px] bg-nightbg p-3 font-mono text-[13px] leading-relaxed text-nighttext shadow-[inset_0_0_0_1.5px_var(--night-line)]"><LogLine text={m.content} /></pre>)}
            <p className="text-[14px] font-semibold text-token">{s.data.protectedCount} sensitive value(s) replaced before leaving the bank.</p>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-[19px] font-bold leading-tight [font-stretch:100%]">The provider&apos;s side</h2>
            <p className="text-[15px] text-ink2">After you ask, the exact text the provider received appears here, with every sensitive value already swapped for a token.</p>
          </>
        )}
      </div>
    </div>
  );
}
