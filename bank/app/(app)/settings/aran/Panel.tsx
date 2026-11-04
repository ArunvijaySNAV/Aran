"use client";
import { useActionState, useState } from "react";
import { Banner, Button, Card, CardTitle, Field, Input, when } from "@/components/ui";
import { Stamp } from "@/components/aran";
import type { ConnectionView } from "@/lib/connection";
import { aranConnectionAction, type ConnectionState } from "./actions";

const LABEL = { connected: "Connected", not_connected: "Not connected", unreachable: "Unreachable", key_rejected: "Key rejected" } as const;
const SOURCE = { saved: "Saved on this page", env: "Environment variables", none: "Nothing configured" } as const;

function StatusStamp({ status }: { status: ConnectionView["status"] }) {
  if (status === "connected") return <Stamp tone="protected">{LABEL.connected}</Stamp>;
  const problem = status !== "not_connected";
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-[6px] border-2 px-3 py-1 text-[15px] font-extrabold ${problem ? "rotate-[1deg] border-attention bg-attentionsoft text-attention" : "border-rulestrong bg-stock text-ink2"}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={problem ? "M8 1.5l7 12.5H1L8 1.5zM8 6.5v3.2M8 11.6v.1" : "M3 8h10"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {LABEL[status]}
    </span>
  );
}

/** Bank → Aran Cloud → tokens, drawn only from what this page knows: the address, the workspace name and the status. */
function Diagram({ view }: { view: ConnectionView }) {
  const ok = view.status === "connected";
  const host = (() => { try { return view.baseUrl ? new URL(view.baseUrl).host : "not set"; } catch { return view.baseUrl ?? "not set"; } })();
  const line = ok ? "var(--token)" : view.status === "not_connected" ? "var(--rule-strong)" : "var(--attention)";
  const dash = ok ? undefined : "6 5";
  return (
    <svg viewBox="0 0 560 120" role="img" className="h-auto w-full" aria-label={`Diagram: Tessera Bank sends values to Aran Cloud at ${host}, which gives back tokens. Status: ${LABEL[view.status]}.`}>
      <g fill="none" strokeWidth="1.5">
        <rect x="2" y="30" width="150" height="60" rx="8" stroke="var(--ink)" fill="var(--bond)" />
        <rect x="205" y="22" width="170" height="76" rx="8" stroke={line} strokeWidth="2" fill="var(--bond)" strokeDasharray={dash} />
        <rect x="428" y="30" width="130" height="60" rx="8" stroke="var(--ink)" fill="var(--bond)" />
        <path d="M152 60H205M197 54l8 6-8 6" stroke={line} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" />
        <path d="M375 60H428M420 54l8 6-8 6" stroke={line} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" />
      </g>
      <g fill="var(--ink)" fontFamily="inherit" textAnchor="middle">
        <text x="77" y="56" fontSize="15" fontWeight="700">Tessera Bank</text><text x="77" y="76" fontSize="12" fill="var(--ink-2)">sends raw values</text>
        <text x="290" y="52" fontSize="15" fontWeight="700">Aran Cloud</text><text x="290" y="70" fontSize="12" fill="var(--ink-2)">{host.length > 24 ? host.slice(0, 23) + "…" : host}</text><text x="290" y="87" fontSize="12" fill="var(--ink-2)">{view.workspaceName ?? "workspace unknown"}</text>
        <text x="493" y="56" fontSize="15" fontWeight="700">Tokens</text><text x="493" y="76" fontSize="12" fill="var(--ink-2)">stored instead</text>
      </g>
    </svg>
  );
}

export function AranConnectionPanel({ initial }: { initial: ConnectionView }) {
  const [state, action, pending] = useActionState<ConnectionState, FormData>(aranConnectionAction, { ok: false, data: initial });
  const [confirming, setConfirming] = useState(false);
  const view = state.data ?? initial;
  const fe = state.fieldErrors ?? {};
  const ro = !view.editable;
  const groups = [["reach", "Reachability"], ["app", "App key (protect, gateway, trace)"], ["compliance", "Compliance key (reveal, erase, verify, dashboard)"]] as const;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><CardTitle>Status</CardTitle><StatusStamp status={view.status} /></div>
        <Diagram view={view} />
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-[15px]">
          <dt className="text-ink2">Workspace</dt><dd className="font-semibold">{view.workspaceName ?? "Not known yet"}</dd>
          <dt className="text-ink2">Address</dt><dd className="break-all font-semibold">{view.baseUrl ?? "Not set"}</dd>
          <dt className="text-ink2">App key</dt><dd className="font-mono text-[13px]" translate="no">{view.appKeyLast4 ? `••••••••${view.appKeyLast4}` : "Not saved"}</dd>
          <dt className="text-ink2">Compliance key</dt><dd className="font-mono text-[13px]" translate="no">{view.complianceKeyLast4 ? `••••••••${view.complianceKeyLast4}` : "Not saved"}</dd>
          <dt className="text-ink2">Source</dt><dd className="font-semibold">{SOURCE[view.source]}</dd>
          <dt className="text-ink2">Last checked</dt><dd className="font-semibold">{view.lastCheckedAt ? when(view.lastCheckedAt) : "Never"}</dd>
          <dt className="text-ink2">Last changed by</dt><dd className="break-all font-semibold">{view.updatedBy ?? "No one yet"}</dd>
        </dl>
        <div aria-live="polite" className="mt-5 space-y-4">
          {view.checks.length ? groups.map(([g, title]) => {
            const items = view.checks.filter((c) => c.group === g);
            return items.length ? (
              <section key={g} aria-label={title}>
                <h3 className="mb-1.5 text-[15px] font-bold">{title}</h3>
                <ul className="space-y-1.5">{items.map((c) => (
                  <li key={c.id} className={`flex items-start gap-2 text-[15px] ${c.ok ? "text-ink" : "text-attention"}`}>
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-1 shrink-0">{c.ok ? <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="var(--token)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M8 1.5l7 12.5H1L8 1.5zM8 6.5v3.2M8 11.6v.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}</svg>
                    <span><span className="sr-only">{c.ok ? "Passed: " : "Problem: "}</span><strong className="font-semibold">{c.label}.</strong> <span className={c.ok ? "text-ink2" : ""}>{c.detail}</span></span>
                  </li>))}</ul>
              </section>) : null;
          }) : <p className="text-[15px] text-ink2">No test has run yet. Use Test connection to check the address, both keys and what each key is allowed to do.</p>}
        </div>
      </Card>

      <Card>
        <CardTitle>Connect</CardTitle>
        {ro ? <Banner tone="warn">The bank is configured by environment variables, so this page is read-only. To connect Aran from here, set <code translate="no" className="font-mono text-[13px]">CONNECTION_ENC_KEY</code> on the server and restart the bank (see docs/DEPLOY.md). Test connection still works.</Banner> : null}
        {state.message ? <div className="mt-3"><Banner tone={state.ok ? (view.status === "connected" ? "ok" : "warn") : "bad"} role={state.ok ? "status" : "alert"}>{state.message}</Banner></div> : null}
        <form action={action} noValidate className="mt-4 space-y-4" key={`${view.lastCheckedAt}-${view.updatedBy}-${view.status}`} autoComplete="off">
          <Field label="Aran Cloud address" htmlFor="aran-url" error={fe.baseUrl} hint="For example https://aran.example.com"><Input id="aran-url" name="baseUrl" defaultValue={view.baseUrl ?? ""} disabled={ro} inputMode="url" placeholder="https://…" aria-invalid={!!fe.baseUrl} /></Field>
          <Field label="App key" htmlFor="aran-app-key" error={fe.appKey} hint={view.appKeyLast4 ? `A key ending ${view.appKeyLast4} is saved. Leave blank to keep it.` : "Needs protect, gateway and trace."}><Input id="aran-app-key" name="appKey" type="password" disabled={ro} placeholder="aran_live_…" aria-invalid={!!fe.appKey} /></Field>
          <Field label="Compliance key" htmlFor="aran-compliance-key" error={fe.complianceKey} hint={view.complianceKeyLast4 ? `A key ending ${view.complianceKeyLast4} is saved. Leave blank to keep it.` : "Needs detokenise, erase, verify and dashboard."}><Input id="aran-compliance-key" name="complianceKey" type="password" disabled={ro} placeholder="aran_live_…" aria-invalid={!!fe.complianceKey} /></Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" name="intent" value="save" disabled={pending || ro}>{pending ? "Working…" : "Save"}</Button>
            <Button name="intent" value="test" disabled={pending}>Test connection</Button>
            {confirming ? (
              <><Button variant="danger" name="intent" value="disconnect" disabled={pending || ro}>Confirm disconnect</Button><Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></>
            ) : <Button type="button" variant="danger" onClick={() => setConfirming(true)} disabled={pending || ro || view.source !== "saved"}>Disconnect</Button>}
          </div>
          <p className="text-[14px] text-ink2">Test connection checks the saved connection, or the environment variables if none is saved. It sends no customer data; the reveal check asks Aran about a fixed test token, which Aran logs as one unknown-token line.</p>
        </form>
      </Card>
    </div>
  );
}
