import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Badge, Banner, Card, CardTitle, Empty, Mono, Table, rupees, when } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { can, requireSession } from "@/lib/auth";
import { getCustomer, listCustomerAccounts } from "@/lib/domain";
import { Reveal } from "./Reveal";
import { KycDecision } from "./KycDecision";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ created?: string }> }) {
  const s = await requireSession("customers");
  const { ref } = await params; const { created } = await searchParams;
  const db = getDb();
  const c = await getCustomer(db, ref);
  if (!c) notFound();
  const accounts = await listCustomerAccounts(db, c.id);
  const cases = await db.select().from(t.kycCases).where(eq(t.kycCases.customerId, c.id)).orderBy(desc(t.kycCases.createdAt));
  const reveals = await db.select().from(t.reveals).where(eq(t.reveals.customerRef, ref)).orderBy(desc(t.reveals.createdAt)).limit(10);
  const canReveal = s.role === "compliance_officer" && c.status === "active";
  const rows: { label: string; field: "aadhaar" | "mobile" | "pan" | "card" | "name"; token: string | null }[] = [
    { label: "Name", field: "name", token: c.nameToken }, { label: "Mobile", field: "mobile", token: c.mobileToken }, { label: "Aadhaar", field: "aadhaar", token: c.aadhaarToken },
    { label: "PAN", field: "pan", token: c.panToken }, { label: "Card", field: "card", token: c.cardToken },
  ];
  return (
    <div className="space-y-6">
      <PageHead title={c.customerRef} sub={`Customer since ${when(c.createdAt)} · via ${c.source}`} actions={<Badge tone={c.status === "active" ? "ok" : "bad"}>{c.status}</Badge>} />
      {created ? <Banner tone="ok" role="status">Customer onboarded. Every identifier below is an Aran token.</Banner> : null}
      {c.status === "erased" ? <Banner tone="warn">This customer&apos;s data was erased. The tokens below no longer resolve to anything.</Banner> : null}
      <Card>
        <CardTitle>Identifiers</CardTitle>
        <Table label="Identifiers" head={["Field", "Stored in this database", "Value"]}>
          {rows.map((r) => r.token ? (
            <tr key={r.field}><td className="font-semibold">{r.label}</td><td><div className="mb-1"><Badge>{r.label} · protected</Badge></div><Mono>{r.token}</Mono></td>
              <td>{r.field === "name" ? <span className="text-xs text-muted">One-way pseudonym: cannot be revealed</span> : canReveal ? <Reveal customerRef={ref} field={r.field} /> : <span className="text-xs text-muted">{s.role === "compliance_officer" ? "Erased" : "Only compliance officers can reveal"}</span>}</td></tr>
          ) : null)}
        </Table>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardTitle>Accounts</CardTitle>
          {accounts.length === 0 ? <Empty title="No accounts yet">{can(s.role, "accounts") ? <Link className="underline" href={`/accounts?ref=${ref}`}>Open an account</Link> : null}</Empty> : (
            <Table label="Accounts" head={["Account", "Type", "Balance"]}>{accounts.map((a) => <tr key={a.id}><td><Link className="underline" href={`/accounts/${a.accountNo}`}>{a.accountNo}</Link></td><td>{a.type}</td><td className="tabular-nums">{rupees(a.balancePaise)}</td></tr>)}</Table>
          )}</Card>
        <Card><CardTitle>KYC cases</CardTitle>
          {cases.length === 0 ? <Empty title="No cases" /> : cases.map((k) => (
            <div key={k.id} className="mb-3 space-y-2"><div className="flex items-center gap-2"><Badge tone={k.status === "open" ? "warn" : k.status === "approved" ? "ok" : "bad"}>{k.status}</Badge><span className="text-xs text-muted">{when(k.createdAt)}</span></div>
              {k.notes ? <p className="text-sm">{k.notes}</p> : null}
              {k.status === "open" && can(s.role, "onboard") ? <KycDecision caseId={k.id} customerRef={ref} /> : null}</div>
          ))}</Card>
      </div>
      {s.role === "compliance_officer" || s.role === "admin" ? (
        <Card><CardTitle>Reveal history</CardTitle>
          {reveals.length === 0 ? <Empty title="No reveals" /> : <Table label="Reveals" head={["When", "Field", "Reason (redacted)"]}>{reveals.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{when(r.createdAt)}</td><td>{r.field}</td><td>{r.reason}</td></tr>)}</Table>}</Card>
      ) : null}
    </div>
  );
}
