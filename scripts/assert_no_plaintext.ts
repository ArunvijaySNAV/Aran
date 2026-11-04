// Fails (exit 1) if any table in the five bank schemas holds a raw Aadhaar (Verhoeff-valid 12 digits),
// card (Luhn-valid 16 digits) or Indian mobile (10 digits), or any Aran API key (shaped aran_live_… or equal to ARAN_APP_KEY / ARAN_COMPLIANCE_KEY). Usage (from bank/): DATABASE_URL=... npx tsx ../scripts/assert_no_plaintext.ts
import postgres from "postgres";
import { scanPlaintext } from "../bank/lib/scan";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const secrets = [process.env.ARAN_APP_KEY, process.env.ARAN_COMPLIANCE_KEY].filter((x): x is string => !!x);   // never printed
  const r = await scanPlaintext(sql, { secrets });
  await sql.end();
  console.log(`scanned ${r.tables} tables, ${r.rows} rows, ${r.cells} text cells`);
  for (const t of r.perTable) console.log(`  ${t.schema}.${t.table}: ${t.rows} rows`);
  if (!r.clean) {
    console.error(`FAIL: ${r.findings.length} plaintext candidate(s)`);
    for (const f of r.findings) console.error(`  ${f.schema}.${f.table}.${f.column}: ${f.kind} ${f.masked}`);
    process.exit(1);
  }
  console.log("PASS: no raw Aadhaar, card or mobile found, and no Aran API key stored in any table");
}
main().catch((e) => { console.error(e); process.exit(1); });
