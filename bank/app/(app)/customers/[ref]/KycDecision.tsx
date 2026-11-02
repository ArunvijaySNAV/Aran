"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Banner, Button, Input } from "@/components/ui";
import { kycDecisionAction } from "../actions";

export function KycDecision({ caseId, customerRef }: { caseId: string; customerRef: string }) {
  const [s, action, pending] = useActionState(kycDecisionAction, { ok: false });
  const router = useRouter();
  useEffect(() => { if (s.ok) router.refresh(); }, [s, router]);
  return (
    <form action={action} className="space-y-2"><input type="hidden" name="caseId" value={caseId} /><input type="hidden" name="ref" value={customerRef} />
      <label className="sr-only" htmlFor={`note-${caseId}`}>Decision note</label><Input id={`note-${caseId}`} name="note" placeholder="Decision note (optional)" />
      {s.message ? <Banner tone={s.ok ? "ok" : "bad"} role="status">{s.message}</Banner> : null}
      <div className="flex gap-2"><Button size="sm" variant="primary" name="decision" value="approved" disabled={pending}>Approve</Button><Button size="sm" variant="danger" name="decision" value="rejected" disabled={pending}>Reject</Button></div></form>
  );
}
