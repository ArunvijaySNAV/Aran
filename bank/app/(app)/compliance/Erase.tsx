"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Banner, Button, Field, Input, Table } from "@/components/ui";
import { eraseAction, verifyAction, type EraseData } from "./actions";

export function VerifyButton({ receipt }: { receipt: unknown }) {
  const [s, action, pending] = useActionState(verifyAction, { ok: false });
  return (
    <form action={action} className="space-y-1"><input type="hidden" name="receipt" value={JSON.stringify(receipt)} />
      <Button size="sm" disabled={pending}>{pending ? "Verifying…" : "Verify receipt"}</Button>
      {s.data ? <div role="status" className={`text-xs ${s.data.valid ? "text-ok" : "text-bad"}`}>{s.data.valid ? "Valid: " : "Invalid: "}{s.data.detail}</div> : null}
      {s.message ? <div role="alert" className="text-xs text-bad">{s.message}</div> : null}</form>
  );
}

export function EraseForm() {
  const [s, action, pending] = useActionState<{ ok: boolean; status?: number; message?: string; fieldErrors?: Record<string, string>; data?: EraseData }, FormData>(eraseAction, { ok: false });
  const router = useRouter();
  useEffect(() => { if (s.ok) router.refresh(); }, [s, router]);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <Field label="Customer reference" htmlFor="er-ref"><Input id="er-ref" name="ref" placeholder="CUS-000001" required /></Field>
        <Field label="Type the reference again to confirm" htmlFor="er-confirm" error={s.fieldErrors?.confirm} hint="Erasure destroys the keys for KYC, Loans, Service and Marketing. It cannot be undone."><Input id="er-confirm" name="confirm" autoComplete="off" required /></Field>
        {s.message ? <Banner tone="bad" role="alert">{s.status === 503 ? "Service unavailable (503). " : ""}{s.message}</Banner> : null}
        <Button variant="danger" disabled={pending}>{pending ? "Erasing…" : "Erase this customer's data"}</Button>
      </form>
      {s.data ? (
        <div className="space-y-4" aria-live="polite">
          <Banner tone="ok"><strong>Erased.</strong> {s.data.receipts.length} signed receipts issued.</Banner>
          <Table label="Receipts" head={["Purpose", "Signature", "Check"]}>{s.data.receipts.map((r) => <tr key={r.purpose}><td>{r.purpose}</td><td className="text-xs">{String(r.receipt.alg ?? "Ed25519")}<br /><span className="font-mono">{String(r.receipt.key_id ?? "")}</span></td><td><VerifyButton receipt={r.receipt} /></td></tr>)}</Table>
          <h3 className="font-semibold">Do the stored tokens still resolve?</h3>
          <Table label="Token resolution after erasure" head={["Field", "Token in our database", "Aran says"]}>{s.data.dead.map((d) => <tr key={d.field}><td>{d.field}</td><td className="font-mono text-xs break-all">{d.token}</td><td><span className={d.status === "erased" ? "font-semibold text-ok" : "font-semibold text-bad"}>{d.status}</span></td></tr>)}</Table>
        </div>
      ) : null}
    </div>
  );
}
