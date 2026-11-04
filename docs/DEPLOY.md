# Deploy

Nothing here has been run against production. These are the exact steps.

## Supabase
1. Create a project (region closest to Vercel `bom1`, i.e. Mumbai/`ap-south-1`).
2. Copy the **direct** connection string (Settings > Database > Connection string, "Direct", port 5432) as `DATABASE_URL`, plus the project URL, anon key and service-role key.
3. Run the migrations and seed from your machine:
```bash
cd bank && DATABASE_URL='postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres' npx tsx scripts/migrate.ts
```
4. Provision Aran keys and seed (after Aran is reachable, see below):
```bash
ARAN_BASE_URL=https://<your-tunnel> python3 scripts/provision_bank_keys.py   # writes bank/.env.local
scripts/bank-run.sh seed.ts                                                  # staff users + 25 customers through Aran
scripts/bank-run.sh assert_no_plaintext.ts                                   # must print PASS
```
`SEED_STAFF_PASSWORD` sets the staff password. Against a non-local `DATABASE_URL` the seed refuses to run without it (the public local default `Tessera-demo-1` is used only for a local database), and it never prints the password. Choose a strong one, keep it in your password manager, and never write the hosted passwords in this repository, an issue or a chat.

## Aran on your machine
```bash
python3 -m venv .venv && .venv/bin/pip install -r aran-cloud/core/requirements.txt requests
ARAN_TRUST_CF=1 ARAN_DEMO_MODE=0 scripts/run_local.sh
scripts/tunnel.sh            # in a second terminal: cloudflared tunnel --url http://localhost:8100
```
Only port 8100 is tunnelled. Quick-tunnel URLs change on every restart: update `ARAN_BASE_URL` in Vercel and redeploy each time. For a stable URL use a named tunnel (instructions in `scripts/tunnel.sh`).

## Vercel (bank)
```bash
cd bank && npm run vendor-sdk     # refreshes bank/vendor/aran-sdk from packages/aran-js
vercel link                       # root directory: bank
vercel env add DATABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ARAN_BASE_URL production
vercel env add ARAN_APP_KEY production
vercel env add ARAN_COMPLIANCE_KEY production
vercel env add CONNECTION_ENC_KEY production   # optional: enables the admin "Aran connection" page (see below)
vercel deploy --prod
```
`vercel.json` pins the function region to `bom1`. The Aran keys and the service-role key are server-only; none is `NEXT_PUBLIC_*`.

### Connecting Aran from the bank (admin "Aran connection" page)
Instead of editing environment variables, an **administrator** can connect the bank to Aran Cloud at **Settings > Aran connection** (`/settings/aran`): enter the Aran Cloud address, the app key and the compliance key, press **Save**, and the bank tests the connection (reachable, each key accepted, each key allowed to do what the bank needs). The keys are stored **encrypted** (AES-256-GCM) in `core_banking.aran_connection` and are never shown again; the page shows only the status, the workspace name, the last four characters of each key, the address, the last check time and who changed it.

It needs one extra secret, `CONNECTION_ENC_KEY`: **32 random bytes as 64 hex characters (or base64)**. Without it the page is read-only and says the bank is configured by environment variables (the `ARAN_*` variables keep working exactly as before).
```bash
openssl rand -hex 32                                   # generate it once; keep a copy in your password manager
vercel env add CONNECTION_ENC_KEY production          # paste the value; mark it sensitive
vercel env add CONNECTION_ENC_KEY preview             # if previews should use the page too
vercel deploy --prod                                   # environment changes apply to new deployments
```
Locally put `CONNECTION_ENC_KEY=<value>` in `bank/.env.local` (mode 600, gitignored) and restart the bank. Notes:
- Run `cd bank && npm run migrate` once per database: migration `0003_aran_connection.sql` creates the table.
- **Changing or losing `CONNECTION_ENC_KEY` makes the saved keys unreadable.** The bank then ignores the saved row and uses the `ARAN_*` variables (the page says so); save the connection again to re-encrypt.
- Resolution order, in one place (`bank/lib/aran.ts`): the saved connection if it exists and decrypts, otherwise the `ARAN_*` variables, otherwise every call fails closed (503, "Nothing was saved"). A saved connection is picked up by every server instance within about 5 seconds.
- "Test connection" sends no customer data. Its reveal check asks Aran to detokenise the fixed text `aran-connection-test`, which Aran answers with "unknown" and logs as one audit line.
- Connect, test and disconnect are recorded in `log_platform.app_logs` (who, when, outcome; never a key, not even its last four characters).

## Pre-demo checklist
- [ ] `ARAN_DEMO_MODE=0` (the console's seeding endpoint stays hidden)
- [ ] `ARAN_TRUST_CF=1` when tunnelled (and `--no-proxy-headers` is on, as `run_local.sh` does)
- [ ] `ARAN_INTERNAL_SECRET`, `ARAN_MASTER_KEY` set; `.env.local` mode 600; master key backed up outside the repo
- [ ] Port 8000 not exposed; only 8100 tunnelled
- [ ] Tunnel URL copied into Vercel `ARAN_BASE_URL`, redeployed
- [ ] `curl https://<tunnel>/v1/health` returns `{"status":"ok"}`
- [ ] Bank login works for all four roles; `assert_no_plaintext.ts` prints PASS (it also fails if an Aran API key is stored in any table)
- [ ] Admin > Aran connection shows **Connected** (or the `ARAN_*` variables are set and "Test connection" passes)
- [ ] Laptop on power, sleep disabled (`caffeinate -dis`), lid open or clamshell with a display

## Resetting the hosted demo
`scripts/reset_hosted_demo.sh` empties the bank's demo data on a hosted Supabase project (customers, accounts, transactions, KYC cases, reveals, erasure requests, logs, CRM, vendor and AI-chat tables, and restarts `CUS-` and account numbering). It keeps the staff rows (`core_banking.staff`), the saved Aran connection, the migrations table and **all Supabase Auth users**, and never touches any schema other than the five the bank owns (`core_banking`, `log_platform`, `crm`, `vendor_share`, `ai_chat`).

Safeguards, in order: it refuses unless `HOSTED_PROJECT_REF` is set and equals the project ref inside `DATABASE_URL` (direct `db.<ref>.supabase.co` or pooler user `postgres.<ref>`); it refuses a local database and a non-interactive shell; it lists every table and row count; it needs you to type `reset <ref>`; it writes and verifies a JSON backup of all rows in those schemas (mode 600, in `~/aran2-hosted-backups/`, override with `BACKUP_DIR`; the rows hold tokens, not raw identifiers, but keep the file private) and only then truncates, in one transaction.
```bash
set -a; source bank/.env.production.local; set +a      # your private copy; never committed
HOSTED_PROJECT_REF=<project ref> scripts/reset_hosted_demo.sh --dry-run   # checks and counts only
HOSTED_PROJECT_REF=<project ref> scripts/reset_hosted_demo.sh             # backup, typed confirmation, reset
SEED_STAFF_PASSWORD=<private> scripts/bank-run.sh seed.ts   # reseed (use bank/.env.production.local values, see SECRETS_CHECKLIST)
```
Aran's own vault is not reset by this script. An identifier Aran has already seen belongs to the first customer reference that presented it, so after a reset either use a fresh Aran workspace or expect the same test values to behave as "already owned" (erasure will then not make them unreadable). The guard logic is unit-tested; the data steps (backup, truncate) have not been run against any database.
