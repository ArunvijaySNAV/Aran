import { desc, isNull, sql } from "drizzle-orm";
import { Banner, Card, CardTitle, Empty, when } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { Breach } from "./Breach";
import { ExportButton } from "./ExportButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loan vendor export" };

export default async function Vendor() {
  await requireSession("vendor");
  const db = getDb();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(t.loanLeads).where(isNull(t.loanLeads.exportedBatchId))) as [{ n: number }];
  const batches = await db.select().from(t.exportBatches).orderBy(desc(t.exportBatches.createdAt)).limit(10);
  return (
    <div className="space-y-6">
      <PageHead title="Loan vendor export" sub="Consented leads go to the lending partner as loan-vendor tokens only." />
      <Card className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-3xl font-bold tabular-nums">{n}</div><div className="text-sm text-muted">new consented leads waiting</div></div><ExportButton disabled={n === 0} /></Card>
      <Card><CardTitle>Export batches</CardTitle>
        {batches.length === 0 ? <Empty title="No exports yet">Build the first export once a customer consents to a loan offer during onboarding.</Empty> : batches.map((b) => (
          <div key={b.id} className="mb-6 space-y-3 border-b border-line pb-6 last:mb-0 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{when(b.createdAt)} · {b.rowCount} row(s)</div><a className="text-sm underline" download={`loan-vendor-${b.id}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(b.csv)}`}>Download CSV</a></div>
            <pre className="max-h-40 overflow-auto rounded-lg bg-surface2 p-3 text-xs">{b.csv.split("\n").slice(0, 4).join("\n")}</pre>
            <Breach batchId={b.id} />
          </div>
        ))}</Card>
      <Banner>The vendor gets tokens from the loan-vendor destination, which differ from the tokens in this bank&apos;s own database for the same person.</Banner>
    </div>
  );
}
