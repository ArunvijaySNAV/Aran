import Link from "next/link";
import { Badge, Empty, Input, Table, linkButton, when } from "@/components/ui";
import { TokenChip } from "@/components/aran";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import { can, requireSession } from "@/lib/auth";
import { listCustomers } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const s = await requireSession("customers");
  const { q = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const { rows, total, pageSize } = await listCustomers(getDb(), q, p);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-5">
      <PageHead title="Customers" sub="Identifiers are shown as protected tokens, never as the original values." actions={can(s.role, "onboard") ? <Link className={linkButton({ variant: "primary" })} href="/customers/new">Onboard a customer</Link> : undefined} />
      <form className="flex max-w-md gap-2" role="search"><label className="sr-only" htmlFor="q">Search by customer reference</label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search CUS-…" /><button className={linkButton()}>Search</button></form>
      {rows.length === 0 ? <Empty title={q ? "No customers match" : "No customers yet"}>{q ? "Try another reference." : "Onboard the first customer to get started."}</Empty> : (
        <Table label="Customers" head={["Reference", "Name", "Aadhaar", "Mobile", "Status", "Since"]}>
          {rows.map((c) => (
            <tr key={c.id}><td><Link className="font-semibold underline" href={`/customers/${c.customerRef}`}>{c.customerRef}</Link></td>
              <td>{c.nameToken ? <TokenChip title="name: one-way pseudonym">{c.nameToken}</TokenChip> : <Badge>Name · protected</Badge>}</td><td>{c.aadhaarToken ? <TokenChip title="aadhaar token (fails the Verhoeff checksum)">{c.aadhaarToken}</TokenChip> : <Badge>Aadhaar · protected</Badge>}</td><td>{c.mobileToken ? <TokenChip title="mobile token">{c.mobileToken}</TokenChip> : <Badge>Mobile · protected</Badge>}</td>
              <td><Badge tone={c.status === "active" ? "ok" : "bad"}>{c.status}</Badge></td><td className="whitespace-nowrap">{when(c.createdAt)}</td></tr>
          ))}
        </Table>
      )}
      <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3 text-[15px]"><span className="text-ink2">Page {p} of {pages} · {total} customers</span>
        {p > 1 ? <Link className={linkButton({ size: "sm" })} href={`?q=${encodeURIComponent(q)}&page=${p - 1}`}>Previous</Link> : null}
        {p < pages ? <Link className={linkButton({ size: "sm" })} href={`?q=${encodeURIComponent(q)}&page=${p + 1}`}>Next</Link> : null}</nav>
    </div>
  );
}
