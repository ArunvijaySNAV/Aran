import { desc } from "drizzle-orm";
import { Card, CardTitle, Empty, Table, when } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { EraseForm, VerifyButton } from "./Erase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance centre" };

export default async function Compliance() {
  await requireSession("compliance");
  const db = getDb();
  const reqs = await db.select().from(t.erasureRequests).orderBy(desc(t.erasureRequests.createdAt)).limit(30);
  const rv = await db.select().from(t.reveals).orderBy(desc(t.reveals.createdAt)).limit(30);
  return (
    <div className="space-y-6">
      <PageHead title="Compliance centre" sub="Erasure under DPDP, receipts anyone can verify, and every reveal with its reason." />
      <div className="space-y-6">
        <Card><CardTitle>Erase a customer</CardTitle><EraseForm /></Card>
        <Card><CardTitle>Erasure requests and receipts</CardTitle>
          {reqs.length === 0 ? <Empty title="No erasures yet" /> : <Table label="Erasure requests" head={["When", "Customer", "Purpose", "By", "Receipt"]}>
            {reqs.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{when(r.createdAt)}</td><td>{r.customerRef}</td><td>{r.purpose}</td><td className="break-all">{r.requestedBy}</td><td>{r.receipt ? <VerifyButton receipt={r.receipt} /> : "–"}</td></tr>)}</Table>}</Card>
      </div>
      <Card><CardTitle>Reveals and reasons</CardTitle>
        {rv.length === 0 ? <Empty title="No reveals yet">Reveals made from a customer page appear here with the reason given. Aran keeps its own tamper-evident audit too.</Empty> : <Table label="Reveals" head={["When", "Customer", "Field", "Reason"]}>{rv.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{when(r.createdAt)}</td><td>{r.customerRef}</td><td>{r.field}</td><td>{r.reason}</td></tr>)}</Table>}</Card>
    </div>
  );
}
