# Web Interface Guidelines review

Rules fetched on 2026-11-04 from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` (8,055 bytes, HTTP 200, saved copy read in full). The WebFetch tool failed on that URL ("Command failed with no output"), so the file was fetched with `curl` instead; nothing here comes from memory. Scope: all editable bank files (`bank/app/**`, `bank/components/**`) and console files (`aran-cloud/cloud/static/*.html`, `css/*`, `js/flip.js`, `js/ornament.js`). Frozen scripts (`console.js`, `dashboard.js`, `landing.js`) were scanned but cannot be changed. The Title Case rule is ignored (DESIGN.md: sentence case). Method: rule-by-rule greps over the file lists plus the per-screen reviews and the measured adapt/harden run (6 widths, 16 pages, stress text), not a line-by-line read of every file.

## Fixed in this pass
| Rule | File | Change |
|---|---|---|
| `transition: all` is an anti-pattern | `css/landing.css` (.tk) | lists `color, background-color, box-shadow` |
| `touch-action: manipulation` | `css/system.css`, `bank/app/globals.css` | on links, buttons, inputs, selects, textareas, summaries |
| Sticky header must not cover the focused element | both | `scroll-padding-top: 72px` |
| `color-scheme` for native controls | `bank/app/globals.css` | `light` on html, `dark` on `.night` |
| `<meta name="theme-color">` | all 4 console pages, `bank/app/layout.tsx` (`viewport.themeColor`) | page / bank-green colours |
| Safe areas for the fixed phone nav | `bank/app/layout.tsx` (`viewportFit: cover`), `globals.css` | bottom padding uses `env(safe-area-inset-bottom)` |
| Disable spellcheck on codes; `autocomplete="off"` on non-auth fields | `bank/components/ui.tsx` (`Input`, `Textarea`) | defaults (login and portal override with real values) |
| Placeholders end with `…` and show an example | accounts, compliance, support, portal | e.g. `e.g. CUS-000001…` |
| `translate="no"` on brand names and identifiers | `TokenChip`, `Logo` | added |
| Long content must wrap | both CSS | `overflow-wrap` rules; table cards clip and break long values |
| Async updates need `aria-live="polite"` | Scan, Breach, Chat | live regions are always mounted (an inserted live region is often not announced) |
| Errors linked to fields | `Field` (ui.tsx) | `aria-describedby` to the error id |
| Loading states end with `…` | all | already true ("Scanning every table…", "Asking…") |
| `font-variant-numeric: tabular-nums` | `.tabular`, table numeric columns | present |
| `text-wrap: balance` on headings | both CSS | present |
| Honor `prefers-reduced-motion` | both CSS | animations gated to `no-preference`; final states are the static styles |

## Already passing (checked)
No `outline: none` without replacement; no `user-scalable=no`; no `<div onClick>`; no `<img>` without dimensions (no `<img>` is used); no `onPaste` blocking; forms controls all have labels; icon-only buttons carry `aria-label` (console: 9); decorative SVG icons are `aria-hidden`; skip link on every page; `:focus-visible` rings measured 6.9:1 to 8.4:1; hover states on buttons and links; URL reflects search and pagination state in the bank.

## Not fixed (need behaviour or are outside the editable files)
| Rule | Where | Why |
|---|---|---|
| Errors: focus the first error on submit | portal, accounts, compliance, onboarding Continue | handler code (gap 14, 17, 20, 23) |
| Destructive actions need confirmation or undo | KYC "Reject" (`KycDecision.tsx`) is immediate | handler/flow change; erase already needs typed confirmation |
| Submit stays enabled until request starts | several buttons use `disabled={pending}` | that is the intended pattern (enabled until the request starts) |
| Keyboard handlers / ARIA tabs in console | `console.js`, `dashboard.js`, connect/signup inline scripts | frozen scripts (gaps 3, 4, 10) |
| `Intl.DateTimeFormat` for dates | `components/ui.tsx` `when()` | already `toLocaleString` with a fixed `en-GB`/IST format by DESIGN.md section 9 (24-hour IST); a user-locale format would change the product's stated format |
| Hydration: date rendering | `Scan.tsx` "Scanned at" uses `toLocaleTimeString` on the client | it renders only after a client action, so there is no server/client mismatch |
| Third-person copy ("the customer consents…") | onboarding consent line | factual consent wording, left as is |
| Specific button labels ("Continue") | onboarding | `text=Continue` is a test selector |
| Virtualise large lists | none over 50 rows | tables show at most 50 rows |

## Per-file result
Files not listed pass every rule above that can be checked by search. Files with a remaining note: `KycDecision.tsx` (immediate Reject), `OnboardForm.tsx` ("Continue" label, focus after step), `Portal.tsx`, `Erase.tsx`, `Chat.tsx`, `Scan.tsx`, `Breach.tsx` (focus after submit).
