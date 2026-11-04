// Plaintext scanner. Aran tokens are built so that tokenised Aadhaar fail Verhoeff and tokenised cards fail Luhn,
// which makes a clean scan real evidence that no raw identifier sits in the database.
// No `server-only` import on purpose: scripts/assert_no_plaintext.ts and the CI test use it too.
import type postgres from "postgres";
import { luhnValid, verhoeffValid } from "./validators";

export const SCHEMAS = ["core_banking", "log_platform", "crm", "vendor_share", "ai_chat"] as const;
export interface ScanFinding { schema: string; table: string; column: string; kind: "aadhaar" | "card" | "mobile" | "aran-key"; masked: string }
export interface ScanReport {
  clean: boolean; tables: number; rows: number; cells: number; findings: ScanFinding[];
  perTable: { schema: string; table: string; rows: number }[]; scannedAt: string;
}

const mask = (d: string) => "•".repeat(Math.max(0, d.length - 4)) + d.slice(-4);

/** Every raw-identifier candidate in one string: 12/16-digit numbers that pass their checksum and 10-digit Indian mobiles. */
/** Aran placeholder tokens such as <PER:0123456789> carry random hex, which is occasionally all digits: skip their insides. */
const PLACEHOLDER = /<[A-Z_]+:[0-9a-z-]+>/g;

export function findPlaintext(raw: string): { kind: ScanFinding["kind"]; masked: string }[] {
  const text = raw.replace(PLACEHOLDER, " ");
  const out: { kind: ScanFinding["kind"]; masked: string }[] = [];
  const seen = new Set<string>();
  const add = (kind: ScanFinding["kind"], d: string) => { const k = kind + d; if (!seen.has(k)) { seen.add(k); out.push({ kind, masked: mask(d) }); } };
  const check = (d: string) => {
    if (d.length === 12 && verhoeffValid(d) && /^[2-9]/.test(d)) add("aadhaar", d);
    if (d.length === 12 && /^91[6-9]\d{9}$/.test(d)) add("mobile", d.slice(2));
    if (d.length === 16 && luhnValid(d)) add("card", d);
    if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) add("mobile", d);
  };
  // plain runs, not glued to letters/dots (hex ids, base64, decimals)
  for (const m of text.matchAll(/(?<![0-9A-Za-z.])(\d{10}|\d{12}|\d{16})(?![0-9A-Za-z])/g)) check(m[1]!);
  // grouped forms: 1234 5678 9012, 1234-5678-9012-3456
  for (const m of text.matchAll(/(?<![0-9A-Za-z.])(\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{4})?)(?![0-9A-Za-z])/g)) check(m[1]!.replace(/[ -]/g, ""));
  return out;
}

/** Raw Aran API keys: anything shaped like aran_live_<hex>, and any exact secret the caller passes in (for example the keys from the environment). */
const KEY_SHAPE = /aran_[a-z]+_[0-9a-zA-Z]{16,}/g;
export function findKeys(raw: string, secrets: string[] = []): { kind: "aran-key"; masked: string }[] {
  const hit = KEY_SHAPE.test(raw) || secrets.some((x) => x.length >= 12 && raw.includes(x));
  KEY_SHAPE.lastIndex = 0;
  return hit ? [{ kind: "aran-key", masked: "aran_…" }] : [];   // never echo any part of the key
}

export async function scanPlaintext(sql: postgres.Sql, opts: { secrets?: string[] } = {}): Promise<ScanReport> {
  const cols = await sql<{ table_schema: string; table_name: string; column_name: string; data_type: string }[]>`
    select table_schema, table_name, column_name, data_type from information_schema.columns
    where table_schema = any(${SCHEMAS as unknown as string[]}) and data_type in ('text','character varying','jsonb','json')
    order by table_schema, table_name, ordinal_position`;
  const tables = await sql<{ table_schema: string; table_name: string }[]>`
    select table_schema, table_name from information_schema.tables
    where table_schema = any(${SCHEMAS as unknown as string[]}) and table_type = 'BASE TABLE' order by 1, 2`;
  const findings: ScanFinding[] = [];
  const perTable: ScanReport["perTable"] = [];
  let rows = 0, cells = 0;
  for (const t of tables) {
    const tcols = cols.filter((c) => c.table_schema === t.table_schema && c.table_name === t.table_name);
    const q = `select ${tcols.length ? tcols.map((c) => `"${c.column_name}"::text as "${c.column_name}"`).join(", ") : "1"} from "${t.table_schema}"."${t.table_name}"`;
    const data = await sql.unsafe(q);
    perTable.push({ schema: t.table_schema, table: t.table_name, rows: data.length });
    rows += data.length;
    for (const row of data) for (const c of tcols) {
      const v = row[c.column_name] as string | null;
      if (!v) continue;
      cells++;
      for (const f of [...findPlaintext(v), ...findKeys(v, opts.secrets)]) findings.push({ schema: t.table_schema, table: t.table_name, column: c.column_name, ...f });
    }
  }
  return { clean: findings.length === 0, tables: tables.length, rows, cells, findings, perTable, scannedAt: new Date().toISOString() };
}
