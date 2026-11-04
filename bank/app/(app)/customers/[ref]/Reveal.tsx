"use client";
import { useActionState, useEffect, useState } from "react";
import { Banner, Button, Field, Textarea } from "@/components/ui";
import { revealAction } from "../actions";

const LABEL: Record<string, string> = { aadhaar: "Aadhaar", mobile: "Mobile", pan: "PAN", card: "Card" };

/** Compliance-only reveal: needs a reason, shows the value for 30 seconds, then hides it again. */
export function Reveal({ customerRef, field }: { customerRef: string; field: "aadhaar" | "mobile" | "pan" | "card" }) {
  const [state, action, pending] = useActionState(revealAction, { ok: false });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  useEffect(() => { if (state.ok && state.data) { setValue(state.data.value); setLeft(30); } }, [state]);
  useEffect(() => {
    if (value === null) return;
    if (left <= 0) { setValue(null); setOpen(false); return; }
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [value, left]);

  if (value !== null) return (
    <div role="status" className="space-y-1"><div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-xs text-muted">Hides in {left}s · this reveal is recorded</div>
      <Button size="sm" type="button" onClick={() => { setValue(null); setOpen(false); }}>Hide now</Button></div>
  );
  if (!open) return <Button size="sm" type="button" onClick={() => setOpen(true)}>Reveal {LABEL[field]}</Button>;
  return (
    <form action={action} className="w-full max-w-sm space-y-2 rounded-[8px] border-[1.5px] border-rule bg-stock p-3">
      <input type="hidden" name="ref" value={customerRef} /><input type="hidden" name="field" value={field} />
      <Field label={`Why do you need the ${LABEL[field]}?`} htmlFor={`reason-${field}`} error={state.fieldErrors?.reason}><Textarea id={`reason-${field}`} name="reason" required minLength={10} aria-invalid={!!state.fieldErrors?.reason} /></Field>
      {state.message && !state.fieldErrors?.reason ? <Banner tone="bad" role="alert">{state.message}</Banner> : null}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" type="submit" disabled={pending}>{pending ? "Revealing…" : "Reveal"}</Button><Button size="sm" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}
