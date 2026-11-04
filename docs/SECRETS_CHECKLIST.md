# Secrets checklist (names and where to get them: never values)

Nothing in this file is a secret. Never paste a value into the repository, an issue, a chat or a screenshot. The real values live only in Vercel (Project Settings > Environment Variables), in your password manager, and in `bank/.env.production.local` on your machine (gitignored). The committed template with empty placeholders is `bank/.env.production.local.template`.

## A. The bank on Vercel (and for running migrations and the seed against the hosted database)

| Variable | Used by | Sensitive? | Where to obtain it |
|---|---|---|---|
| `DATABASE_URL` | every server page and action (`bank/db/index.ts`), `npm run migrate`, `scripts/seed.ts`, `scripts/assert_no_plaintext.ts` | **Yes** (contains the database password) | Supabase dashboard > your project > **Connect** / Settings > Database > Connection string. `docs/DEPLOY.md` says to use the direct string (port 5432). Supabase documents direct connections as IPv6-only and recommends its pooler for serverless hosts such as Vercel: if the direct string does not connect from Vercel, use the pooler string (transaction mode, port 6543); the bank's database client already runs with prepared statements off (`prepare: false`). Not tested against a hosted project yet. The password is the one you set when creating the project (reset it under Settings > Database if lost) |
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server sign-in (`bank/lib/supabase/*`), seed | No (public by design, `NEXT_PUBLIC_`) | Supabase dashboard > Settings > API > **Project URL** (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server sign-in | No (public by design; Row Level Security protects data) | Supabase dashboard > Settings > API > the **anon / public** key (or the project's publishable key if the dashboard shows the newer key format; not tested with the newer format here) |
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/seed.ts` (creates the four staff users in Supabase Auth). The bank also has a helper for it (`bank/lib/supabase/admin.ts`) but no page or action calls it today, so the running site should not need it; `docs/DEPLOY.md` still lists it for Vercel. Safest: keep it on your machine for seeding and leave it off Vercel unless the app reports it missing (not tried against a hosted deployment) | **Yes: full database and auth access** | Supabase dashboard > Settings > API > the **service_role** key (or the secret key in the newer format). Never `NEXT_PUBLIC_`, never in client code |
| `ARAN_BASE_URL` | all Aran calls from the bank (`bank/lib/aran.ts`); the fallback when no connection is saved on the admin page | No, but it is the address of your Aran | The **public address of the tunnel** to Aran Cloud's port 8100: `scripts/tunnel.sh` runs `cloudflared`, which prints the `https://….trycloudflare.com` address when it starts (a quick tunnel changes on every restart, a named tunnel is stable). No trailing slash |
| `ARAN_APP_KEY` | protect, gateway and trace calls (onboarding, support chat, vendor export, breach trace) | **Yes** | An Aran key with the scopes **protect, gateway, trace**, label "Tessera app server". Mint it with `ARAN_BASE_URL=<tunnel> python3 scripts/provision_bank_keys.py` (writes `bank/.env.local`) or in the Aran console (Dashboard > API keys) with the admin key. Shown once at creation |
| `ARAN_COMPLIANCE_KEY` | Reveal, erase and receipt verification | **Yes** | An Aran key with the scopes **detokenise, erase, verify, dashboard**, label "Tessera compliance". Same two ways as above |
| `CONNECTION_ENC_KEY` | encrypts the Aran keys saved from the admin **Aran connection** page (AES-256-GCM, `bank/lib/connection-crypto.ts`) | **Yes** | You generate it: `openssl rand -hex 32` (64 hex characters). Keep a copy in your password manager. Optional: without it the page is read-only and the bank uses `ARAN_BASE_URL`, `ARAN_APP_KEY` and `ARAN_COMPLIANCE_KEY`. **Changing or losing it makes saved keys unreadable** (the bank then falls back to the environment variables; save the connection again) |

Only on your machine when seeding the hosted database (not set on Vercel):

| Variable | Used by | Where to obtain it |
|---|---|---|
| `SEED_STAFF_PASSWORD` | `scripts/seed.ts`: the password of the four staff logins (default is a public demo value) | You choose it: use a strong one for anything public. Change it later in Supabase Auth if needed |
| `SEED_CUSTOMERS` | `scripts/seed.ts`: how many customers to create (default 25) | Optional |

How to run migrations or the seed against the hosted project from your machine, without writing values on the command line:
```bash
cd /Users/snarunvijay/Documents/hackathons/Aran2/bank
set -a && source .env.production.local && set +a        # your filled-in copy of the template
npm run migrate                                          # applies bank/db/migrations/*.sql, including 0003_aran_connection.sql
```

## B. Aran Cloud on the machine that runs it (the "hosted setup" behind the tunnel)

These are read by Aran, not by the bank. `scripts/run_local.sh` creates the first three in `.env.local` (mode 600) the first time it runs; back up the master key outside the repository, because without it the per-tenant vaults cannot be opened.

| Variable | Used by | Sensitive? | Where to obtain it |
|---|---|---|---|
| `ARAN_MASTER_KEY` | derives every tenant's key-encryption key (`aran-cloud/core/tenants.py`) | **Yes** | Generated by `run_local.sh` (64 hex characters) |
| `ARAN_INTERNAL_SECRET` | the cloud-to-core secret (core refuses calls without it) | **Yes** | Generated by `run_local.sh` |
| `ARAN_ADMIN_TOKEN` | core admin endpoints | **Yes** | Generated by `run_local.sh` |
| `ARAN_DEMO_MODE` | `0` hides the console's demo seeding endpoint; `1` for a local rehearsal | No | Set when starting: `ARAN_DEMO_MODE=0` for anything public |
| `ARAN_TRUST_CF` | `1` when the traffic comes through a Cloudflare Tunnel, so the real client address is used for rate limits | No | Set to `1` behind the tunnel |
| `ARAN_CORS_ORIGINS` | optional list of browser origins allowed to call the cloud API | No | Only if a browser app outside Aran's own console must call it (the bank calls server-side and does not need it) |
| `ARAN_RATE_LIMIT_PER_KEY`, `ARAN_SIGNUP_LIMIT`, `ARAN_PUBLIC_DEMO_PER_MIN` | rate limits | No | Optional, defaults in `aran-cloud/cloud/main.py` |
| `ARAN_LLM_URL`, `ARAN_LLM_KEY`, `ARAN_LLM_MODEL` | optional external language model for the AI gateway (without them the "echo stand-in" provider is used) | **Yes** (`ARAN_LLM_KEY`) | Your model provider's dashboard; leave unset to keep the echo stand-in |

## C. Before you deploy: a short pass
- [ ] `bank/.env.production.local` exists on your machine, every placeholder filled, and `git status` does not list it.
- [ ] The section A variables (`CONNECTION_ENC_KEY` optional, `SUPABASE_SERVICE_ROLE_KEY` see its note) are entered in Vercel for **Production** (and **Preview** if you use previews), the sensitive ones marked as sensitive.
- [ ] `ARAN_APP_KEY` and `ARAN_COMPLIANCE_KEY` belong to the **same Aran workspace** (check: Admin > Aran connection > Test connection after the first deployment, or the Aran dashboard for that workspace).
- [ ] The keys you minted for the bank are **not** the workspace admin key. Keep the admin key offline.
- [ ] A key that was ever pasted into a chat, a screenshot or a commit is treated as leaked: revoke it in the Aran console (API keys) and mint a new one.
- [ ] The Supabase **service_role** key and the database password were never pasted anywhere outside Supabase, Vercel and your password manager.
