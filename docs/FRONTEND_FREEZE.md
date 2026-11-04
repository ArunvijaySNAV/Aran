# Frontend freeze map

Branch `design-overhaul`, rollback tag `pre-design`. Enforced by `scripts/check_design_only.sh` (run after every commit).

## 1. Editable (presentation only)
- `aran-cloud/cloud/static/css/**`, `static/img/**`, `static/fonts/**`, `static/favicon.svg`
- `aran-cloud/cloud/static/{index,signup,connect,dashboard}.html` **markup**: every `id`, `data-*` attribute and class that a script or test queries must keep working (see `docs/TEST_SELECTORS.md`)
- `bank/app/globals.css`, `bank/app/favicon.ico`, `bank/public/**`
- `bank/components/**` (existing and new `components/aran/**`), including `ui.tsx`, `Nav.tsx`, `Logo.tsx`, `PageHead.tsx`
- JSX and class names of every `bank/app/**/page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, and of client components (`Forms.tsx`, `Erase.tsx`, `Reveal.tsx`, `KycDecision.tsx`, `OnboardForm.tsx`, `Scan.tsx`, `Chat.tsx`, `Breach.tsx`, `ExportButton.tsx`, `LoginForm.tsx`, `Portal.tsx`)
- `bank/package.json` / lockfile: **only** to add fonts or essential packages (each one named in the report)
- docs, `scripts/check_design_only.sh`, `scripts/check_contrast.py`, `e2e/capture.mjs` (screenshot tool, not a test)

## 2. Protected (must not change)
- `aran-cloud/core/**`, `aran-cloud/research/**`, `aran-cloud/cloud/*.py` (API, tests, smoke)
- `packages/**` (both SDKs and their tests)
- `bank/db/**`, `bank/lib/**` (domain, auth, aran, action, scan, validators, supabase), `bank/middleware.ts`
- every `bank/app/**/actions.ts` (server actions) and `bank/app/api/**` (route handlers)
- `bank/test/**`, `bank/vitest.config.ts`, `bank/next.config.ts`, `bank/vercel.json`, `bank/supabase/**`, `bank/vendor/**`, `bank/scripts/**`, `bank/.env*`
- `scripts/**` (except the two design scripts above), `e2e/*.spec.mjs` (tests), `Dockerfile`, `docker-compose.yml`, `.env*`
- `aran-cloud/cloud/static/js/*.js`: behaviour is protected (see mixed)

## 3. Mixed (editable JSX, protected logic)
For each file below the protected region is everything from the `export ... function` line to the line before that function's first top-level `return (` / `return <` (data loading, role checks, hooks, handlers, effects). The guard compares a hash of that region against `pre-design`. Imports may change.

| File | Protected region (pre-design line numbers) |
|---|---|
| `bank/app/(app)/dashboard/page.tsx` | 11-14 |
| `bank/app/(app)/customers/page.tsx` | 11-16 |
| `bank/app/(app)/customers/[ref]/page.tsx` | 15-28 |
| `bank/app/(app)/customers/new/page.tsx` | 7-8 |
| `bank/app/(app)/accounts/page.tsx` | 13-17 |
| `bank/app/(app)/accounts/[no]/page.tsx` | 12-18 |
| `bank/app/(app)/support/page.tsx` | 12-14 |
| `bank/app/(app)/vendor/page.tsx` | 13-17 |
| `bank/app/(app)/compliance/page.tsx` | 12-16 |
| `bank/app/(app)/data-plane/page.tsx` | 14-25 |
| `bank/app/(app)/layout.tsx` | 7-12 |
| `bank/app/(app)/accounts/Forms.tsx`, `compliance/Erase.tsx`, `customers/[ref]/{Reveal,KycDecision}.tsx`, `customers/new/OnboardForm.tsx`, `data-plane/Scan.tsx`, `support/Chat.tsx`, `vendor/{Breach,ExportButton}.tsx`, `login/LoginForm.tsx`, `portal/Portal.tsx` | hooks, handlers and effects above the component's first top-level `return` |
| `aran-cloud/cloud/static/js/{console,dashboard,landing}.js` and inline `<script>` blocks of `signup.html`, `connect.html` | **behavioural fingerprint**: every `/v1/...` URL, HTTP method, storage key, poll interval and request body literal must be identical; DOM-building code may change only if the ids/classes it needs still exist |

## 4. Rule of thumb
If a change alters what is sent to or read from an API, what a handler does, which role sees what, or which data a component receives, it is out of scope: log it in `docs/FUNCTIONALITY_GAPS.md` instead.
