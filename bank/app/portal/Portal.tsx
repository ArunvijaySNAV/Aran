"use client";
import { useActionState, useRef } from "react";
import { Banner, Button, Card, CardTitle, Field, Input, Table, rupees } from "@/components/ui";
import { portalEraseAction, portalOnboardAction, portalViewAction, type MyData, type PortalCreated } from "./actions";

type S<T> = { ok: boolean; status?: number; message?: string; fieldErrors?: Record<string, string>; data?: T };

export function SignUp() {
  const [s, action, pending] = useActionState<S<PortalCreated>, FormData>(portalOnboardAction, { ok: false });
  if (s.data) return (
    <Card><CardTitle>You are registered</CardTitle>
      <Banner tone="ok" role="status">Your customer reference is <strong className="font-mono">{s.data.customerRef}</strong>.</Banner>
      <div className="mt-4 space-y-2"><p className="text-sm font-semibold">Your portal secret (shown once)</p><code id="secret" className="block break-all rounded-lg bg-surface2 p-3 font-mono text-sm">{s.data.secret}</code>
        <p className="text-sm text-muted">Keep it safe: with your reference it lets you view and erase your data below. We store only a hash of it.</p></div></Card>
  );
  const e = s.fieldErrors ?? {};
  return (
    <Card><CardTitle>Register with Tessera Bank</CardTitle>
      <form action={action} noValidate className="space-y-4">
        {s.message ? <Banner tone="bad" role="alert">{s.status === 503 ? "Service unavailable (503). " : ""}{s.message}</Banner> : null}
        <Field label="Full name" htmlFor="p-name" error={e.name}><Input id="p-name" name="name" autoComplete="name" aria-invalid={!!e.name} /></Field>
        <Field label="Mobile number" htmlFor="p-mobile" error={e.mobile}><Input id="p-mobile" name="mobile" inputMode="numeric" autoComplete="tel" aria-invalid={!!e.mobile} /></Field>
        <Field label="Aadhaar number" htmlFor="p-aadhaar" error={e.aadhaar}><Input id="p-aadhaar" name="aadhaar" inputMode="numeric" autoComplete="off" aria-invalid={!!e.aadhaar} /></Field>
        <Field label="PAN (optional)" htmlFor="p-pan" error={e.pan}><Input id="p-pan" name="pan" autoComplete="off" className="uppercase" aria-invalid={!!e.pan} /></Field>
        <Button variant="primary" disabled={pending} className="w-full">{pending ? "Protecting and saving…" : "Register"}</Button>
      </form></Card>
  );
}

export function MyDataPanel() {
  const [v, view, viewing] = useActionState<S<MyData>, FormData>(portalViewAction, { ok: false });
  const [er, erase, erasing] = useActionState<S<MyData>, FormData>(portalEraseAction, { ok: false });
  const secretRef = useRef("");
  const d = er.data ?? v.data;
  return (
    <Card><CardTitle>My data</CardTitle>
      {!d ? (
        <form action={view} noValidate className="space-y-4" onSubmit={(e) => { secretRef.current = String(new FormData(e.currentTarget).get("secret") ?? ""); }}>
          {v.message ? <Banner tone="bad" role="alert">{v.message}</Banner> : null}
          <Field label="Customer reference" htmlFor="m-ref"><Input id="m-ref" name="ref" placeholder="CUS-000001" autoComplete="off" /></Field>
          <Field label="Portal secret" htmlFor="m-secret"><Input id="m-secret" name="secret" type="password" autoComplete="off" /></Field>
          <Button disabled={viewing} className="w-full">{viewing ? "Checking…" : "Show my data"}</Button>
        </form>
      ) : (
        <div className="space-y-4" aria-live="polite">
          <p className="text-sm">Reference <strong className="font-mono">{d.customerRef}</strong> · status <strong>{d.status}</strong></p>
          {d.status === "active" ? (<>
            <p className="text-sm text-muted">We hold these about you, all as protected tokens: {d.fields.join(", ")}.</p>
            {d.accounts.length ? <Table label="Accounts" head={["Account", "Balance"]}>{d.accounts.map((a) => <tr key={a.accountNo}><td>{a.accountNo}</td><td>{rupees(a.balance)}</td></tr>)}</Table> : null}
            <form action={erase} className="space-y-3 rounded-lg border border-line p-4"><input type="hidden" name="ref" value={d.customerRef} /><input type="hidden" name="secret" value={secretRef.current} />
              <p className="text-sm font-semibold">Erase my data</p><p className="text-xs text-muted">This destroys the keys for all uses of your data. It cannot be undone.</p>
              {er.message ? <Banner tone="bad" role="alert">{er.message}</Banner> : null}
              <Field label="Type ERASE to confirm" htmlFor="m-confirm"><Input id="m-confirm" name="confirm" autoComplete="off" /></Field>
              <Button variant="danger" disabled={erasing}>{erasing ? "Erasing…" : "Erase my data"}</Button></form>
          </>) : <Banner tone="warn">Your data has been erased.</Banner>}
          {d.erased ? <div className="space-y-3"><Banner tone="ok" role="status">Erased. {d.erased.length} signed receipts were issued.</Banner>
            <Table label="After erasure" head={["Field", "Token we stored now resolves to"]}>{(d.dead ?? []).map((x) => <tr key={x.field}><td>{x.field}</td><td className="font-semibold text-ok">{x.status}</td></tr>)}</Table></div> : null}
        </div>
      )}
    </Card>
  );
}
