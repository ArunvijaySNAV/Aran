import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Card, CardTitle, Empty, Table, rupees } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { OpenAccountForm } from "./Forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts" };

export default async function Accounts({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const s = await requireSession("accounts");
  const { ref } = await searchParams;
  const rows = await getDb().select({ a: t.accounts, ref: t.customers.customerRef }).from(t.accounts).innerJoin(t.customers, eq(t.customers.id, t.accounts.customerId)).orderBy(desc(t.accounts.createdAt)).limit(50);
  const writer = s.role === "kyc_officer" || s.role === "admin";
  return (
    <div className="space-y-6">
      <PageHead title="Accounts" sub="Deposits, withdrawals and transfers with balance checks." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card><CardTitle>Recent accounts</CardTitle>
          {rows.length === 0 ? <Empty title="No accounts yet">Open the first account with the form.</Empty> : (
            <Table label="Accounts" head={["Account", "Customer", "Type", "Balance"]}>{rows.map(({ a, ref: r }) => <tr key={a.id}><td><Link className="font-semibold underline" href={`/accounts/${a.accountNo}`}>{a.accountNo}</Link></td><td><Link className="underline" href={`/customers/${r}`}>{r}</Link></td><td>{a.type}</td><td className="tabular-nums">{rupees(a.balancePaise)}</td></tr>)}</Table>
          )}</Card>
        <Card><CardTitle>Open an account</CardTitle>{writer ? <OpenAccountForm defaultRef={ref} /> : <p className="text-sm text-muted">Your role has read-only access to accounts.</p>}</Card>
      </div>
    </div>
  );
}
