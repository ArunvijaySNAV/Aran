// Applies db/migrations/*.sql in order. Works against local Supabase and hosted Supabase (DATABASE_URL).
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
async function main() {
const sql = postgres(url as string, { max: 1, onnotice: () => {} });
const dir = path.join(__dirname, "..", "db", "migrations");
await sql`create table if not exists public._tessera_migrations (name text primary key, applied_at timestamptz default now())`;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  const done = await sql`select 1 from public._tessera_migrations where name = ${f}`;
  if (done.length) { console.log("skip", f); continue; }
  await sql.begin(async (tx) => { await tx.unsafe(fs.readFileSync(path.join(dir, f), "utf8")); await tx`insert into public._tessera_migrations(name) values (${f})`; });
  console.log("applied", f);
}
await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
