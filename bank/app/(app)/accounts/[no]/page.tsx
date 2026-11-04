import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardTitle, Empty, Table, linkButton, rupees, when } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { statement } from "@/lib/domain";
import { TransactForm } from "../Forms";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ page?: string }> }) {
  const s = await requireSession("accounts");
  const { no } = await params; const p = Math.max(1, Number((await searchParams).page) || 1);
  const st = await statement(getDb(), no, p);
  if (!st) notFound();
  const pages = Math.max(1, Math.ceil(st.total / st.pageSize));
  const writer = s.role === "kyc_officer" || s.role === "admin";
  return (
    <div className="space-y-6">
      <PageHead title={st.account.accountNo} sub={`${st.account.type} account`} actions={<div className="text-right"><div className="w-expanded tabular text-[clamp(30px,3.6vw,48px)] leading-none">{rupees(st.account.balancePaise)}</div><Badge tone={st.account.status === "open" ? "ok" : "warn"}>{st.account.status}</Badge></div>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card><CardTitle>Statement</CardTitle>
          {st.rows.length === 0 ? <Empty title="No transactions yet">Post a deposit with the form to start the statement.</Empty> : (
            <Table label="Statement" head={["When", "Type", "Amount", "Balance", "Description"]}>
              {st.rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{when(r.createdAt)}</td><td className="capitalize">{r.kind.replace("_", " ")}</td>
                <td className={`tabular-nums ${r.kind === "deposit" || r.kind === "transfer_in" ? "text-bank font-semibold" : ""}`}>{r.kind === "deposit" || r.kind === "transfer_in" ? "+" : "−"}{rupees(r.amountPaise)}</td><td className="tabular-nums">{rupees(r.balanceAfterPaise)}</td><td className="break-words">{r.description}</td></tr>)}
            </Table>)}
          <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center gap-3 text-[15px]"><span className="text-muted">Page {p} of {pages}</span>
            {p > 1 ? <Link className={linkButton({ size: "sm" })} href={`?page=${p - 1}`}>Previous</Link> : null}{p < pages ? <Link className={linkButton({ size: "sm" })} href={`?page=${p + 1}`}>Next</Link> : null}</nav></Card>
        <Card><CardTitle>New transaction</CardTitle>{writer ? <TransactForm accountNo={st.account.accountNo} /> : <p className="text-[15px] text-ink2">Your role has read-only access.</p>}</Card>
      </div>
    </div>
  );
}
