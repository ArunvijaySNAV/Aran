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
`SEED_STAFF_PASSWORD` sets the staff password (default is a demo value: change it for anything public).

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
vercel deploy --prod
```
`vercel.json` pins the function region to `bom1`. The Aran keys and the service-role key are server-only; none is `NEXT_PUBLIC_*`.

## Pre-demo checklist
- [ ] `ARAN_DEMO_MODE=0` (the console's seeding endpoint stays hidden)
- [ ] `ARAN_TRUST_CF=1` when tunnelled (and `--no-proxy-headers` is on, as `run_local.sh` does)
- [ ] `ARAN_INTERNAL_SECRET`, `ARAN_MASTER_KEY` set; `.env.local` mode 600; master key backed up outside the repo
- [ ] Port 8000 not exposed; only 8100 tunnelled
- [ ] Tunnel URL copied into Vercel `ARAN_BASE_URL`, redeployed
- [ ] `curl https://<tunnel>/v1/health` returns `{"status":"ok"}`
- [ ] Bank login works for all four roles; `assert_no_plaintext.ts` prints PASS
- [ ] Laptop on power, sleep disabled (`caffeinate -dis`), lid open or clamshell with a display
