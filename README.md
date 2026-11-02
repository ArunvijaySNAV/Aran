# Aran2

Two deliverables in one repo.

1. **Aran Cloud**: firewall-as-a-service that tokenises sensitive data (Aadhaar, card, mobile, PAN, UPI, names) before it is stored or shared. Per-tenant engines, scoped keys, signed erasure receipts, console.
2. **Tessera Bank** (fictional): a staff-facing bank management system on Next.js + Supabase Postgres that holds only Aran tokens and fails closed.

| Path | What |
|---|---|
| `aran-cloud/core`, `aran-cloud/cloud`, `aran-cloud/research` | Aran (Python/FastAPI) |
| `packages/aran-js` | `@aran/sdk` (TypeScript) |
| `packages/aran-py` | Python SDK |
| `bank/` | Tessera Bank |
| `e2e/` | Playwright scripts (console and bank) |
| `docs/` | AUDIT, ARCHITECTURE, INTEGRATION, DEMO, DEPLOY, REPORT |
| `scripts/` | run_local, tunnel, reset_demo, seed, assert_no_plaintext, provisioning |

Quick start: `docs/DEPLOY.md`. Integration: `docs/INTEGRATION.md`. Demo script: `docs/DEMO.md`. Results and limitations: `docs/REPORT.md`.

All test identifiers are generated with valid checksums and belong to nobody. Never commit `.env*` files or databases.
