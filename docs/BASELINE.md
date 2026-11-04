# Baseline before the design overhaul

Taken on branch `design-overhaul` at tag `pre-design` (plus docs/guard files only), 2026-11-04, same machine: Aran core + cloud (demo mode on), local Supabase, bank built and served with `next start -p 3100`. Every suite was run for this file.

| Suite | Result |
|---|---|
| Research + core (`aran-cloud/research/test_*.py`, `core/test_standout.py`) | 64 passed, 1 skipped |
| Cloud security + tenant isolation (`test_cloud_security.py`, `test_tenant_isolation.py`) | 23 passed (15 + 8) |
| Cloud smoke (`smoke_test.py`) | all 12 steps passed |
| TypeScript SDK (`packages/aran-js`) | 17 passed, 3 skipped (unit only); 20 passed with a live stack (3 integration) |
| Python SDK (`packages/aran-py/test_sdk.py`) | 6 passed |
| Bank build (`next build`) | compiled successfully |
| Bank vitest | 17 passed (see note) |
| Console Playwright (`e2e/console.spec.mjs`) | OK: 38 screenshots, no console errors, no failed requests, no horizontal scroll |
| Bank Playwright (`e2e/bank.spec.mjs`) | OK: 31 screenshots, onboarding → reveal → erase, support, vendor breach, scan, portal |
| Plaintext scan (`scripts/assert_no_plaintext.ts`) | PASS |

Required after the overhaul: identical pass counts, zero new failures.

## Notes
- **Bank vitest flake (pre-existing, not explained).** The first run after Docker/Supabase had been restarted reported 1 failed of 17. Three consecutive reruns, with no code change, passed 17 of 17. The failing test name was not captured. Treat a single failure on a cold database as a flake, and compare steady-state counts.
- The bank's Aran keys now belong to the user's own workspace ("aranwork"); the 56 older customers were tokenised by a different workspace, so reveal/erase on those rows does not work. Tests create their own customers and are unaffected.
- Before screenshots: `docs/screens/before/{console,bank}/` (90 images, 390 px and 1440 px, all four bank roles, plus a denied-page capture) from `e2e/capture.mjs`; capture report shows 0 console errors and 0 horizontal scroll.
- Target look screenshots: `docs/screens/reference/preview-{390,1440}.png`.
