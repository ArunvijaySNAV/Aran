"use client";
import { useActionState } from "react";
import { Banner, Button, Card, CardTitle, Field, Input, Textarea } from "@/components/ui";
import { chatAction, type ChatData } from "./actions";

export function Chat() {
  const [s, action, pending] = useActionState<{ ok: boolean; status?: number; message?: string; fieldErrors?: Record<string, string>; data?: ChatData }, FormData>(chatAction, { ok: false });
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="conversationId" value={s.data?.conversationId ?? ""} />
        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="Customer reference (optional)" htmlFor="ref"><Input id="ref" name="ref" placeholder="CUS-000001" /></Field>
          <Field label="Ask the assistant" htmlFor="prompt" error={s.fieldErrors?.prompt} hint="Paste real-looking customer details if you like: the provider never sees them."><Textarea id="prompt" name="prompt" required aria-invalid={!!s.fieldErrors?.prompt} /></Field>
        </div>
        <Button variant="primary" disabled={pending}>{pending ? "Asking…" : "Ask"}</Button>
      </form>
      {s.message ? <Banner tone="bad" role="alert">{s.status === 503 ? "Service unavailable (503). " : ""}{s.message}</Banner> : null}
      {s.data ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-live="polite">
          <Card><CardTitle>Answer to you</CardTitle><p className="whitespace-pre-wrap break-words text-sm">{s.data.reply}</p>
            <p className="mt-3 text-xs text-muted">Provider: <strong>{s.data.provider}</strong></p></Card>
          <Card className="border-accent"><CardTitle>What the AI provider saw</CardTitle>
            {s.data.providerSaw.map((m, i) => <pre key={i} className="whitespace-pre-wrap break-words rounded-lg bg-surface2 p-3 text-xs">{m.content}</pre>)}
            <p className="mt-3 text-xs text-muted">{s.data.protectedCount} sensitive value(s) replaced before leaving the bank.</p></Card>
        </div>
      ) : null}
    </div>
  );
}
