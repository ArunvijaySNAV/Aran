import Link from "next/link";
import { Badge, Card, CardTitle, Empty, Stat, Table, Banner, rupees, when } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { LogLine } from "@/components/aran";
import { dashboardStats } from "@/lib/domain";
import { getDb } from "@/db";
import { requireSession, ROLE_LABEL } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requireSession("dashboard");
  const { denied } = await searchParams;
  const d = await dashboardStats(getDb());
  return (
    <div className="space-y-6">
      <PageHead title={`Welcome, ${s.fullName.split(" ")[0]}`} sub={`Signed in as ${ROLE_LABEL[s.role]}. Every number below is a live query.`} />
      {denied ? <Banner tone="warn" role="alert">Your role cannot open that page. Ask an admin if you need access.</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.25fr]">
        <Stat lead className="sm:col-span-2 lg:col-span-1" label="Customers" sub="Aadhaar, card and mobile numbers are held as tokens." value={d.customers} />
        <Stat label="New KYC this week" value={d.newKycThisWeek} />
        <Stat label="Open KYC cases" value={d.openCases} />
        <Stat label="Deposits held" value={<span className="whitespace-nowrap">{rupees(d.depositsPaise).replace(/\.\d\d$/, "")}<span className="text-[.55em]">{rupees(d.depositsPaise).slice(-3)}</span></span>} />
      </div>
      <Card>
        <CardTitle>Last 10 events</CardTitle>
        {d.events.length === 0 ? <Empty title="No events yet">Onboard a customer to see activity here. <Link className="underline" href="/customers/new">Onboard a customer</Link></Empty> : (
          <Table label="Recent events" head={["When", "Who", "Action", "Log line (redacted by Aran)"]}>
            {d.events.map((e) => <tr key={e.id}><td className="whitespace-nowrap">{when(e.at)}</td><td>{e.actor}</td><td><Badge>{e.action}</Badge></td><td className="break-words"><LogLine text={e.line} /></td></tr>)}
          </Table>
        )}
      </Card>
    </div>
  );
}
