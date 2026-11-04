// Clears the bank's DEMO DATA on a hosted Supabase project. Run it through scripts/reset_hosted_demo.sh (see docs/DEPLOY.md).
// Touches only the five schemas the bank owns (core_banking, log_platform, crm, vendor_share, ai_chat); keeps core_banking.staff,
// core_banking.aran_connection and the migrations table; never touches auth users, public or any other schema.
// Refuses unless HOSTED_PROJECT_REF equals the ref in DATABASE_URL, needs a typed confirmation, and writes a backup first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import postgres from "postgres";
import { checkRef } from "./hosted_ref";

const SCHEMAS = ["core_banking", "log_platform", "crm", "vendor_share", "ai_chat"];
const KEEP = new Set(["core_banking.staff", "core_banking.aran_connection"]);
const DRY = process.argv.includes("--dry-run");

async function main() {
  const url = process.env.DATABASE_URL;
  const chk = checkRef(url, process.env.HOSTED_PROJECT_REF);
  if (!chk.ok) { console.error(`REFUSED: ${chk.why}`); process.exit(2); }
  if (!process.stdin.isTTY && !DRY) { console.error("REFUSED: a typed confirmation needs an interactive terminal."); process.exit(2); }
  const sql = postgres(url as string, { max: 1, onnotice: () => {} });
  try {
    const all = await sql<{ s: string; t: string }[]>`select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ${sql(SCHEMAS)} order by 1, 2`;
    const targets = all.filter((x) => !KEEP.has(`${x.s}.${x.t}`));
    const counts: Record<string, number> = {};
    for (const x of all) counts[`${x.s}.${x.t}`] = (await sql.unsafe(`select count(*)::int as n from "${x.s}"."${x.t}"`))[0]!.n as number;
    console.log(`Project ${chk.ref}. Will EMPTY these tables (rows now):`);
    for (const x of targets) console.log(`  ${x.s}.${x.t}  ${counts[`${x.s}.${x.t}`]}`);
    console.log(`Kept: ${[...KEEP].join(", ")}, auth users, and everything outside the five bank schemas.`);
    if (DRY) { console.log("Dry run: nothing backed up, nothing changed."); return; }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`Type  reset ${chk.ref}  to continue: `)).trim(); rl.close();
    if (typed !== `reset ${chk.ref}`) { console.error("REFUSED: confirmation did not match. Nothing was changed."); process.exit(2); }

    // Backup first: every row of every table in the five schemas (tokens only, but treat the file as private), mode 600, outside the repository.
    const dir = process.env.BACKUP_DIR ?? path.join(os.homedir(), "aran2-hosted-backups");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${chk.ref}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const dump: Record<string, unknown[]> = {};
    for (const x of all) dump[`${x.s}.${x.t}`] = await sql.unsafe(`select * from "${x.s}"."${x.t}"`);
    fs.writeFileSync(file, JSON.stringify({ ref: chk.ref, at: new Date().toISOString(), tables: dump }), { mode: 0o600 });
    const back = JSON.parse(fs.readFileSync(file, "utf8")).tables as Record<string, unknown[]>;
    for (const k of Object.keys(counts)) if (back[k]?.length !== counts[k]) throw new Error(`Backup check failed for ${k}; nothing was changed.`);
    console.log(`Backup written and verified: ${file}`);

    await sql.begin(async (tx) => {
      await tx.unsafe(`truncate table ${targets.map((x) => `"${x.s}"."${x.t}"`).join(", ")} restart identity cascade`);
      await tx.unsafe(`alter sequence core_banking.customer_ref_seq restart with 1`);
      await tx.unsafe(`alter sequence core_banking.account_no_seq restart with 1000001`);
    });
    console.log("Done. Demo data cleared. Aran's own vault is not touched: use a fresh Aran workspace (or accept that reused identifiers belong to earlier references) before reseeding.");
  } finally { await sql.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
