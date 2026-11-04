"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { openAccountAction, transactAction } from "./actions";

export function OpenAccountForm({ defaultRef }: { defaultRef?: string }) {
  const [s, action, pending] = useActionState(openAccountAction, { ok: false });
  const router = useRouter();
  useEffect(() => { if (s.ok) router.refresh(); }, [s, router]);
  return (
    <form action={action} className="space-y-4" noValidate>
      {s.message ? <Banner tone={s.ok ? "ok" : "bad"} role="status">{s.message}</Banner> : null}
      <Field label="Customer reference" htmlFor="oa-ref" error={s.fieldErrors?.customer}><Input id="oa-ref" name="ref" defaultValue={defaultRef} placeholder="e.g. CUS-000001" required /></Field>
      <Field label="Account type" htmlFor="oa-type"><Select id="oa-type" name="type"><option value="savings">Savings</option><option value="current">Current</option></Select></Field>
      <Field label="Opening deposit (₹)" htmlFor="oa-open" error={s.fieldErrors?.opening}><Input id="oa-open" name="opening" type="number" min={0} step="0.01" defaultValue={0} /></Field>
      <Button variant="primary" disabled={pending}>{pending ? "Opening…" : "Open account"}</Button>
    </form>
  );
}

export function TransactForm({ accountNo }: { accountNo: string }) {
  const [s, action, pending] = useActionState(transactAction, { ok: false });
  const router2 = useRouter();
  useEffect(() => { if (s.ok) router2.refresh(); }, [s, router2]);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="accountNo" value={accountNo} />
      {s.message ? <Banner tone={s.ok ? "ok" : "bad"} role="status">{s.status === 503 ? "Service unavailable (503). " : ""}{s.message}</Banner> : null}
      <Field label="Type" htmlFor="tx-kind"><Select id="tx-kind" name="kind"><option value="deposit">Deposit</option><option value="withdrawal">Withdraw</option><option value="transfer">Transfer out</option></Select></Field>
      <Field label="Amount (₹)" htmlFor="tx-amt" error={s.fieldErrors?.amount}><Input id="tx-amt" name="amount" type="number" min="0.01" step="0.01" required aria-invalid={!!s.fieldErrors?.amount} /></Field>
      <Field label="To account (transfers only)" htmlFor="tx-to" error={s.fieldErrors?.toAccountNo}><Input id="tx-to" name="toAccountNo" placeholder="e.g. TSB1000002" /></Field>
      <Field label="Description" htmlFor="tx-desc" hint="Passed through Aran's log filter before it is stored"><Input id="tx-desc" name="description" maxLength={140} /></Field>
      <Button variant="primary" disabled={pending}>{pending ? "Posting…" : "Post transaction"}</Button>
    </form>
  );
}
