"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Banner, Button, Field, Input, Table } from "@/components/ui";
import { Certificate, TokenChip } from "@/components/aran";
import { eraseAction, verifyAction, type EraseData } from "./actions";

export function VerifyButton({ receipt }: { receipt: unknown }) {
  const [s, action, pending] = useActionState(verifyAction, { ok: false });
  return (
    <form action={action} className="space-y-1"><input type="hidden" name="receipt" value={JSON.stringify(receipt)} />
      <Button size="sm" disabled={pending}>{pending ? "Verifying…" : "Verify receipt"}</Button>
      {s.data ? <div role="status" className={`text-[14px] font-semibold ${s.data.valid ? "text-seal" : "text-attention"}`}>{s.data.valid ? "Valid: " : "Invalid: "}{s.data.detail}</div> : null}
      {s.message ? <div role="alert" className="text-[14px] font-semibold text-attention">{s.message}</div> : null}</form>
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
          <Certificate
            title="Erasure certificate"
            rows={s.data.receipts.map((r) => ({ label: r.purpose, value: `${String(r.receipt.alg ?? "Ed25519")} · ${String(r.receipt.key_id ?? "")}`, mono: true }))}
          >
            <p className="text-[15px] text-ink2">Destroying one key makes every copy unreadable, in every system at once. Each receipt is signed and can be verified.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">{s.data.receipts.map((r) => <div key={r.purpose} className="flex items-center justify-between gap-3 rounded-[8px] border-[1.5px] border-rule p-2.5"><span className="text-[15px] font-semibold">{r.purpose}</span><VerifyButton receipt={r.receipt} /></div>)}</div>
          </Certificate>
          <div className="night rounded-[14px] p-4 sm:p-5">
            <h3 className="mb-1 text-[17px] font-bold [font-stretch:100%]">Do the stored tokens still resolve?</h3>
            <p className="mb-3 text-[14px] text-ink2">Each token below is asked of Aran again after the key was destroyed.</p>
            <Table label="Token resolution after erasure" head={["Field", "Token in our database", "Aran says"]}>{s.data.dead.map((d, i) => <tr key={d.field}><td>{d.field}</td><td><span className={d.status === "erased" ? "unread" : undefined} style={{ animationDelay: `${i * 240}ms` }}><TokenChip>{d.token}</TokenChip></span></td><td><span className={d.status === "erased" ? "font-semibold text-token" : "font-semibold text-raw"}>{d.status}</span></td></tr>)}</Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
