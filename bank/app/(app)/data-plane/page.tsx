import { Card, CardTitle, Empty, Mono, Table } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { SCHEMAS } from "@/lib/scan";
import { Scan } from "./Scan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data plane" };

const SINK: Record<string, string> = { core_banking: "kyc-archive", log_platform: "log-platform", crm: "crm", vendor_share: "loan-vendor", ai_chat: "ai-gateway" };

/** Read-only view of the real rows, so a reviewer can see tokens in the actual database. Timestamps and ids shown as-is. */
export default async function DataPlane() {
  await requireSession("dataplane");
  const sql = getDb().$client;
  const tables = await sql<{ table_schema: string; table_name: string }[]>`select table_schema, table_name from information_schema.tables where table_schema = any(${SCHEMAS as unknown as string[]}) and table_type='BASE TABLE' order by 1,2`;
  const out: { schema: string; table: string; count: number; cols: string[]; rows: Record<string, unknown>[] }[] = [];
  for (const t of tables) {
    const cols = (await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_schema=${t.table_schema} and table_name=${t.table_name} order by ordinal_position`).map((c) => c.column_name)
      .filter((c) => !["csv", "receipt", "portal_secret_hash"].includes(c));
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(t.table_schema)}.${sql(t.table_name)}`;
    const rows = cols.length ? await sql.unsafe(`select ${cols.map((c) => `"${c}"::text as "${c}"`).join(", ")} from "${t.table_schema}"."${t.table_name}" order by 1 desc limit 5`) : [];
    out.push({ schema: t.table_schema, table: t.table_name, count: n, cols, rows: rows as unknown as Record<string, unknown>[] });
  }
  return (
    <div className="space-y-6">
      <PageHead title="Data plane" sub="The real rows in each schema. Look for tokens where you would expect Aadhaar, mobile, PAN or card numbers." />
      <Card><CardTitle>Plaintext scan</CardTitle><Scan /></Card>
      {SCHEMAS.map((sc) => (
        <section key={sc} className="space-y-3"><h2 className="text-lg font-bold">{sc} <span className="text-sm font-normal text-muted">· Aran sink: {SINK[sc]}</span></h2>
          {out.filter((o) => o.schema === sc).map((o) => (
            <Card key={o.table}><div className="mb-2 flex items-baseline justify-between"><h3 className="font-semibold">{o.table}</h3><span className="text-xs text-muted">{o.count} row(s), newest 5 shown</span></div>
              {o.rows.length === 0 ? <Empty title="Empty table" /> : <Table label={`${sc}.${o.table}`} head={o.cols}>{o.rows.map((r, i) => <tr key={i}>{o.cols.map((c) => <td key={c} className="max-w-[260px]"><Mono>{String(r[c] ?? "")}</Mono></td>)}</tr>)}</Table>}</Card>
          ))}</section>
      ))}
    </div>
  );
}
