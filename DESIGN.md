# DESIGN.md — Aran2 design system: "Printed like money"

> Applies to **Aran Cloud** (the firewall-as-a-service product) and **Tessera Bank** (the fictional bank that uses it).
> This file **replaces** the prototype's indigo/dark system (`brand.md`, `tokens.css`). Do not reuse its colours, logo or component styles.
> Reference implementation of the key moments: `docs/reference/aran-design-preview.html` (single file, open in a browser). Match its behaviour and feel; rebuild it properly, do not copy its hacks.
> Read this file fully before writing or changing any UI.

---

## 1. The idea

Money has been protected for centuries by **security printing**: guilloche rosettes, microtext, serial numbers, ink colours that mean something, foil that proves authenticity, rubber stamps that make a decision official. Aran does the same job for data. The interface borrows that vocabulary so the product looks like what it does: **it makes data tamper-evident and worthless to a thief.**

Light, paper-like, precise. Not a dark "cyber" console.

### The memorable thing (spend boldness here, keep everything else quiet)

**The checksum flip.** A real Aadhaar number passes its Verhoeff checksum. An Aran token is built to always fail it. The hero lets anyone watch a valid number turn into a token that *cannot* be an Aadhaar. This is Aran's core invention shown in three seconds, and it is the first thing on the landing page.

### Five principles

1. **Ink carries meaning.** Blue ink = protected. Red stamp = exposed. Everything else is paper and dark ink. These two colours are never used for anything else.
2. **Show the boundary.** Raw on one side, tokens on the other, with a visible line between them.
3. **Prove it, don't claim it.** Real payloads, real hash chains, signed certificates. No number appears that did not come from an API or a query.
4. **One bold moment per screen.** Surrounding UI is calm and dense where data needs it.
5. **Honest words.** Describe exact properties. Never "unhackable", "bulletproof", "military-grade", "zero-knowledge".

### What it must not become

Dark navy with glowing indigo; neon or acid accents on black; cream paper with a serif and terracotta; identical rounded cards with soft grey shadows; gradient washes; stock photos; emoji; fake dashboards; a tracked-out all-caps label above every heading; small monospace labels everywhere.

---

## 2. Two surfaces, three "worlds"

| World | Where | Ground | Accent | Role |
|---|---|---|---|---|
| **Stock** (default) | Aran Cloud: landing, signup, connect, dashboard | pale cool paper `#E8EEEA` | seal blue | the product, in daylight |
| **Bank** | Tessera Bank staff app and portal | white bond `#F7FAF8` on stock | bank green `#0B5A49` + a thin gold line | the customer's application |
| **Night** | Anywhere Aran is "looking inside": Data Plane, Aran Inspector, plaintext scan, what the AI provider saw, optional dashboard dark mode | ink `#0C1A2B` | periwinkle `#9DB0FF` | the vault interior |

**The seam:** whenever Tessera Bank shows something from Aran, it appears in a **Night panel** inside the light bank UI, so the theme change *is* the boundary. This rule is consistent everywhere.

The bank's brand colour (green) is deliberately **not** a meaning colour, so tokens (blue) and exposure (red) always stand out inside it.

---

## 3. Colour

### 3.1 Tokens

```css
:root{
  /* paper and ink */
  --stock:#E8EEEA;        /* page ground */
  --bond:#F7FAF8;         /* cards, plates, certificates */
  --ink:#0C1A2B;          /* text, rules, outlines (a blue-black ink, not #000) */
  --ink-2:#46566B;        /* secondary text */
  --rule:#C5D0CA;         /* hairlines, input borders */

  /* meaning: the only two colours that carry data-state meaning */
  --seal:#2342D6;         /* PROTECTED: tokens, verified, primary actions on Aran */
  --seal-soft:#DDE3FA;
  --stamp:#B3202A;        /* EXPOSED: a real raw value on screen */
  --stamp-soft:#F6DCDD;
  --attention:#7A4A00;    /* needs attention (text). Soft fill: #FBEBCB */
  --attention-soft:#FBEBCB;

  /* Tessera Bank */
  --bank:#0B5A49; --bank-soft:#D9EBE5; --bank-gold:#C59B27;

  /* Night world */
  --night:#0C1A2B; --night-2:#14263B; --night-line:#243A52;
  --night-text:#E8EEEA; --night-dim:#9FB1C4;
  --night-token:#9DB0FF;  /* protected, on night */
  --night-raw:#FF8A8F;    /* exposed, on night */

  /* foil: verified moments only (receipt verified, chain intact) */
  --foil:linear-gradient(100deg,#9BF0D2,#B9A6FF,#FFC6A8,#9AD8FF,#9BF0D2);
}
```

### 3.2 Measured contrast (WCAG relative luminance, computed)

| Pair | Ratio |
|---|---|
| `--ink` on `--stock` / on `--bond` | 14.90 / 16.68 |
| `--ink-2` on `--bond` | 7.13 |
| `--seal` on `--bond` / on `--stock` | 7.08 / 6.33 |
| white on `--seal` | 7.44 |
| `--stamp` on `--bond` / on `--stock` | 6.33 / 5.65 |
| white on `--ink` | 17.53 |
| bank green on `--bond` / white on bank green | 7.77 / 8.16 |
| `--attention` on `--bond` | 7.12 |
| `--night-text` on `--night` | 14.90 |
| `--night-token` on `--night` | 8.42 |
| `--night-raw` on `--night` | 7.75 |

Rules: body text ≥ 7:1 where the table allows, never below 4.5:1; UI outlines ≥ 3:1. Any new colour pair must be measured with `scripts/check_contrast.py`; results go in `docs/CONTRAST.md`. Seal blue on stock (6.33) is for large or bold text and controls; use `--ink` for long body copy.

### 3.3 Meaning rules

- **Blue ink (`--seal`)**: tokens, "protected", verified states, the primary button on Aran Cloud. Nothing else is blue except links inside prose.
- **Red stamp (`--stamp`)**: only where a **real raw value** is on screen: the checksum hero before protection, a Reveal, a plaintext-scan hit, a "without Aran" comparison. Destructive buttons are **not** red; they are outlined and confirm with a dialog.
- **Attention (amber)**: a warning about configuration or limits.
- **Foil**: a short reward when something has been cryptographically verified. Never decoration, never in static UI.
- Never colour alone: every state also has an icon and a text label ("Protected", "Exposed", "Signature valid").

---

## 4. Typography

Two families, both open source, both served **locally** (no CDN): install `@fontsource-variable/archivo` and `@fontsource-variable/martian-mono`, copy the `latin-wdth-normal.woff2` files into `public/fonts/` (bank) and `static/fonts/` (cloud), declare with `font-stretch` ranges.

| Role | Family | Axis use |
|---|---|---|
| Everything readable | **Archivo** (variable, weight 100–900, **width 62–125**) | Width is the personality: **expanded (110–125%) + weight 800** for headlines and the big numerals; **normal width, 400–600** for body and UI; **condensed (62–80%)** only for serial-style numbers and dense table headers. |
| Tokens, hashes, keys, code | **Martian Mono** (variable, wide) | Only for machine values: tokens, Merkle roots, API keys, IDs, code. Never for general labels. |

Scale (px; fluid with `clamp` on landing):

| Use | Size | Weight / width |
|---|---|---|
| Hero headline | clamp(40, 5.3vw, 78), line-height 1.0 | 800 / 106% |
| Section headline | clamp(32, 4.2vw, 56) | 800 / 108% |
| Big numerals (checksum plate, KPI) | clamp(24, 3.2vw, 44) (plate), up to 64 (KPI) | 800 / 118%, `tabular-nums` |
| Body | 17 (marketing 19) | 400 / 100% |
| UI and tables | 15 | 400–600 |
| Caption | 13 | 400 |
| Mono values | 11–13 | Martian Mono 400–500 |

Line height: headlines 1.0–1.05, body 1.55, mono 1.5. Measure ≤ 68 characters. Sentence case everywhere. **No all-caps eyebrows.** All caps only inside a seal or stamp, where it is the convention.

Type is part of the design: the checksum plate uses expanded numerals; the hero headline is set tight and large; condensed serial numbers appear in receipts and the data-flow table.

---

## 5. Brand marks

- **Aran mark:** three concentric arches (a fort gate seen from inside), the innermost solid. Single colour (`--seal`, or `--night-token` on night, or `--ink` for print). Draw it as inline SVG (see the `#mark` symbol in the preview). Minimum 16 px. Clear space = the width of the outer stroke × 3. Never add glow, gradients or a shield.
- **Wordmark:** "ARAN" in Archivo 800 at 125% width, letter-spacing 0.06em, beside the mark.
- **Favicon:** the mark in `--seal` on `--stock`, rounded square.
- **Tessera Bank mark:** wordmark "Tessera" in Archivo 700 on `--bank`, with two small gold squares (mosaic tiles, `--bank-gold` and `#E5C766`) before it. A 3 px gold line (`--bank-gold`) runs under the bank's top bar. No shield, so it is never confused with Aran.
- **Guilloche:** the generative rosette is the brand's texture. Generate it in code (hypotrochoid, 10 rotated copies, 0.55 px strokes, `currentColor`, see `rosette()` in the preview). Uses: hero plate corner (masked, slow 90 s rotation), certificate and receipt bands (sine interlace), empty states, the social card. It is always `--seal` at ≤ 50% opacity and never sits under body text.
- **Microprint:** a tiny repeating line of text ("Protected before it is stored") used as a rule on the plate and certificates. Decorative, `aria-hidden`.

---

## 6. Layout, shape, elevation

- **Grid:** 12 columns, 1180 px max (marketing), 1440 px max (app). Gutter 24 px (16 px under 640). Landing sections alternate a **6/6** hero split and **7/5** headline-and-copy splits; left-align everything. No centred marketing blocks.
- **Section divider:** a 1.5 px `--ink` rule across the container. Sections are separated by this rule and space, not by background colour changes.
- **Breakpoints:** 360, 640, 900, 1280, 1440. No horizontal page scroll at any width. At ≤ 900 px every split stacks; the flight scene becomes vertical.
- **Radii by role (not one radius everywhere):** certificates and cheques 6 px; plates and panels 14–18 px; buttons 8 px; inputs 8 px; chips 4 px; pills 999 px.
- **Elevation:** a 1.5 px `--ink` outline is the primary edge (like a printed border). Shadow only under floating objects (plate, certificate): `0 22px 40px -24px rgba(12,26,43,.45)`.
- **Spacing:** 4 px base; use 4, 8, 12, 16, 24, 32, 48, 56, 88.
- **App shell:** left sidebar 248 px (icon rail ≤ 1024, bottom sheet ≤ 640), top bar 56 px. Active nav item = ink fill with white text (Aran) or bank-green fill (bank).

---

## 7. Components

Plain CSS classes in Aran Cloud; shadcn/ui re-themed with these tokens in Tessera Bank (mapping in section 11).

- **Buttons.** Primary Aran: `--seal` fill, white text. Primary bank: `--bank` fill. Night: `--night-token` fill, `--night` text. Secondary: 1.5 px `--ink` outline. Height 46 px, radius 8. Press = 1 px down. Focus = 3 px `--seal` outline, 3 px offset. Loading replaces the label with a spinner and locks width. Labels are verbs: **Protect this number · Get an API key · Open account · Reveal value · Crypto-shred purpose key · Verify post-quantum proof · Trace a leaked dump · Create key**.
- **Plate.** The signature container: `--bond`, 1.5 px `--ink` outline, radius 18, a masked guilloche in one corner. Holds one big number and its checksum verdict.
- **Stamp (verdict).** An outlined box with 2 px border, 6 px radius, slightly rotated (−2.5° exposed, +1.5° protected), icon + sentence. Red variant (`--stamp` on `--stamp-soft`) = passes the checksum / exposed. Blue variant (`--seal` on `--seal-soft`) = fails the checksum / protected.
- **Token chip.** Martian Mono 12, 4 px radius, 1.5 px outline. Light: `--seal` on `--seal-soft`. Night: `--night-token` on `rgba(157,176,255,.12)`. Tooltip shows sink, purpose, issued time. Copy button on hover and focus.
- **Raw chip.** Same shape, red: `--stamp` on `--stamp-soft` (light) or `--night-raw` on `#2a1417` (night). Only inside a Reveal, a comparison or a scan hit, always with a countdown or a Hide button.
- **Sink pill.** 999 px, 1.5 px `--rule` outline; selected = `--ink` fill, white text. Sinks: `kyc-archive`, `log-platform`, `crm`, `loan-vendor`, `ai-gateway`.
- **Inputs.** Label above (15 px, `--ink-2`), 17 px text, 8 px radius, 1.5 px `--rule` border, `--bond` fill. Focus: `--seal` (or `--bank` in the bank) border and 3 px soft ring. Error: icon + message in `--attention`, border `--attention`; red is reserved for raw data. Checksum fields show a live valid or invalid hint.
- **Tables.** 44 px rows, hairline row borders, sticky header, numbers right-aligned and tabular, mono for machine values. Under 640 px each row becomes a labelled card. In Night tables, header `--night-dim`, borders `--night-line`.
- **Tabs.** Underline tabs; on Night, the active tab is a raised `--night-2` tab.
- **Certificate.** `--bond`, 6 px radius, 1.5 px `--ink` outline, a guilloche **band** (34 px) top edge, content, a circular **seal** (SVG, ring text, check mark), signature line. Used for erasure receipts, API key issue slips and exported reports.
- **Dialog / drawer / toast.** Dialog ≤ 520 px, focus-trapped, destructive dialogs require typing the object name. The **Aran Inspector** is a 420 px right drawer in Night. Toasts bottom-right (bottom-centre on mobile), 5 s, `role="status"`.
- **Code block.** Night ground in both themes, Martian Mono 13, language tabs (TypeScript, Python, curl), Copy with "Copied" confirmation. Never print a real key.
- **API key issue slip.** A certificate-styled card shown once at creation: key in mono, Copy, a checkbox "I have saved it" that enables Close.
- **Loading.** Skeletons drawn as **redaction bars** (solid `--ink` bars at 8% opacity that shimmer). Nothing shown for loads under 300 ms.
- **Empty.** One sentence saying what will appear here + the action that fills it. Use the approved copy in section 9.
- **Error.** What happened, whether anything changed, what to do. No apologies, no vagueness.

---

## 8. Signature moments (build these first)

Each is driven by **real API calls** in the product (the preview simulates them). Each must also work with reduced motion (jump to the end state).

1. **Checksum flip (landing hero).** A plate with a valid sample Aadhaar in red expanded numerals and a red stamp "Passes the Verhoeff checksum: a usable Aadhaar". Press **Protect this number**: digits roll left to right for ~0.9 s (random digits settle into the real token), the numerals turn blue, the stamp becomes blue "Fails the Verhoeff checksum: cannot be an Aadhaar". Switching the sink pill re-rolls to that sink's different token. Users can type or paste their own 12-digit number; only valid Verhoeff numbers show the red state. The public demo endpoint is rate-limited and accepts sample data only.
2. **The flight (Connect page, bank onboarding).** Left: a bank form. Right: the Night Data Plane. On submit, each field's value lifts off as a **red raw chip**, arcs toward the database, **flips to a blue token chip as it crosses the boundary line** (the Aran mark pulses once), and lands in its cell. Total ≈ 1.5 s, fields staggered 140 ms. The form fields then show "Sent through Aran". Footer text: "Saved. The database holds tokens only."
3. **Erase and certificate.** In a Night ledger, the customer's tokens across all sinks are listed. **Crypto-shred purpose key** blurs and strikes each token in turn (240 ms apart) to "unreadable"; then the certificate's **seal slams in** (scale 2.3 → 1 with overshoot) with a 0.4 s shake. **Verify post-quantum proof** runs the real verification, and on success the certificate band is washed by **foil** once and "Signature valid" appears.
4. **Same person, different tokens.** A compact table: one customer, one row per sink, the Aadhaar token for each in token chips. Appears on Customer detail and the landing page.
5. **Reveal with countdown (bank).** Role-gated Reveal → reason dialog → raw chip with a shrinking 30-second bar → auto-hide → the audit entry appears inline.
6. **Audit chain.** Entries as a vertical chain of short hashes joined by lines; **Verify chain** sweeps top to bottom and ends in "Chain intact · N entries" with a brief foil.
7. **Leak trace.** Paste a dump: tokens highlight in blue, thin lines draw to sink pills, the leaking sink's pill gets a red outline and a confidence figure from the API.
8. **Plaintext scan (bank Data Plane).** A Night panel button. Result: "0 candidates pass Luhn or Verhoeff across N cells" in blue, or offenders as raw chips.
9. **Presenter mode (`?present=1`).** Keys 1 to 6 jump to the six moments above, text scales up 125%, the cursor hides after 3 s, a small progress marker appears. Optional sound is off by default (one soft click on token lock, one thud on the seal).

Preview tokens are illustrative. The real formats come from the core: **Aadhaar tokens must fail Verhoeff, card tokens must fail Luhn**; the preview also makes mobile tokens start with 1–5 (never a valid Indian mobile). Confirm the core's actual formats during Phase 0 and make the UI show what the API returns.

---

## 9. Voice and content

- Plain, direct, active voice. Sentence case. No exclamation marks, no emoji, no "→" appended to buttons.
- Name things by what users do: "Protect", "Reveal", "Erase", "Verify", not by internals.
- Numbers: Indian grouping (12,34,567), ₹, dates "03 Nov 2026", 24-hour IST. Latency in ms with one decimal. Never show an unmeasured figure.
- Approved copy:
  - Hero: "The number a thief can't use." Sub: "Aran swaps Aadhaar, card and mobile numbers for tokens that fail their own checksum, before they reach your database, logs, vendors or AI tools."
  - Verdicts: "Passes the Verhoeff checksum: a usable Aadhaar" / "Fails the Verhoeff checksum: cannot be an Aadhaar".
  - Flight: "Saved. The database holds tokens only."
  - Erase: "Destroying one key makes every copy unreadable, in every system at once."
  - Empty traffic: "No payloads yet. Requests sent to `/v1/protect` or `/v1/gateway` appear here as they arrive."
  - Empty receipts: "No erasures yet. When you erase a customer, a signed certificate appears here."
  - Empty trace: "No tokens found. Paste a leaked log or database dump to see which destination it came from."
  - Fail closed (bank): "We could not reach the protection service. Nothing was saved."
  - Limits (Connect and docs): "Your application server sees the raw value briefly before calling Aran. Aran makes sure it is not stored or shared downstream in plaintext."
  - Bank footer: "Fictional bank for demonstration. Sample data only."
- Banned: unhackable, impenetrable, bulletproof, military-grade, zero-knowledge, 100% secure, "AI-powered" as a selling point.
- Retired from the prototype: the "Owner conflict" notice, "Bank A / Bank B", bracketed button labels.

---

## 10. Motion

- Easing `cubic-bezier(.16,1,.3,1)`; durations 150–250 ms for UI, up to 1.5 s only for the signature moments.
- Allowed: the eight moments above; guilloche rotation (90 s, one per view); count-up on first paint (≤ 600 ms); skeleton shimmer.
- Not allowed: scroll-triggered fade-ups on every section, hover lifts on cards, parallax, autoplay video, looping decorative loops, motion that carries meaning without a text equivalent.
- `prefers-reduced-motion: reduce`: no rotation, no flights, no shake; every moment jumps to its final state and still announces itself in text.
- Implementation: CSS and the Web Animations API; GSAP is allowed only if a sequence cannot be done otherwise; no three.js.

---

## 11. Implementation

### Aran Cloud (plain HTML/CSS/JS, no build step)
`tokens.css` (variables, `@font-face`) → `system.css` (components) → `landing.css` / `app.css`. Light is default. `html[data-theme="night"]` swaps the surface and text variables and keeps meaning colours on their night values. Night panels use a `.night` class that re-declares those variables locally.

### Tessera Bank (Next.js, Tailwind, shadcn/ui)

```css
:root{
  --background:#E8EEEA; --foreground:#0C1A2B;
  --card:#F7FAF8; --card-foreground:#0C1A2B;
  --primary:#0B5A49; --primary-foreground:#FFFFFF;
  --secondary:#E8EEEA; --secondary-foreground:#0C1A2B;
  --muted:#E8EEEA; --muted-foreground:#46566B;
  --accent:#D9EBE5; --accent-foreground:#0B5A49;
  --border:#C5D0CA; --input:#C5D0CA; --ring:#0B5A49; --radius:8px;
  --token:#2342D6; --token-bg:#DDE3FA; --raw:#B3202A; --raw-bg:#F6DCDD;
  --gold:#C59B27;
}
.night{ --background:#0C1A2B; --foreground:#E8EEEA; --card:#14263B; --border:#243A52;
  --token:#9DB0FF; --token-bg:rgba(157,176,255,.12); --raw:#FF8A8F; --raw-bg:#2A1417; --ring:#9DB0FF; }
```
Fonts with `next/font/local`, exposing `--font-sans` (Archivo) and `--font-mono` (Martian Mono). Shared components in `bank/components/aran/`: `Plate`, `Stamp`, `TokenChip`, `RawChip`, `SinkPill`, `Flight`, `Certificate`, `AuditChain`, `Inspector`, `Guilloche`, `RedactionSkeleton`.

No hard-coded hex inside components; no new colour without adding it here and measuring it.

---

## 12. Page blueprints

### Aran Cloud
1. **Landing.** Nav (mark, How it works, In a bank, Erasure, **Get an API key**). Hero: left headline + lede + two buttons; right the **checksum plate**. Then three sections, each opened by an ink rule and a large headline: *The flight* (section 8.2 as a live demo against a public sample endpoint), *Erase and certificate* (8.3), *Same person, different tokens* (8.4). Then "Where Aran sits" (a one-line diagram: app → Aran → database, logs, CRM, vendor, AI tool, drawn with ink lines and sink pills), integration in three steps with code tabs, pricing (three tiers, static), an "Honest limits" paragraph, footer (DPDP, RBI, CERT-In mapping, security contact).
2. **Signup.** One 440 px plate: name, work email, **Get an API key**. Keys appear once on a certificate-style slip.
3. **Connect.** Four steps (create key, add five lines, send a test event, watch it arrive). Step 4 shows the flight with the user's own test event.
4. **Dashboard** (Night available). Sidebar: Overview, Data flows, API keys, Trace, Erasure and receipts, Audit, Playground. Overview: four big-numeral tiles (Protected, Unprotected alarms, Ignored, p95 latency), a 24 h traffic chart in `--seal`, a by-sink table with sink pills, latest events as token chips. Tiles are not identical: the first (Protected) is twice the width and carries the guilloche corner; the rest are plain.

### Tessera Bank
Green top bar with the gold line. Sidebar by role: Dashboard, Customers, Onboarding, Accounts, Support, Vendor exports, Compliance, Data Plane (admin). The **Aran Inspector** toggle in the top bar opens the Night drawer with the last Aran calls (endpoint, sink, redacted payload, latency).
- **Onboarding:** four steps (Identity, Contact, Account, Review). On submit, the **flight** plays into a Data Plane strip at the bottom of the screen. Review shows "What will be stored" as token chips.
- **Customer detail:** protected fields as token chips, **Reveal** for compliance only (8.5), tabs Accounts, Activity, CRM notes, Data trail (8.4).
- **Support:** two-pane chat; the right pane, in Night, is "What the AI provider saw".
- **Vendor exports:** build a batch; **Simulate a breach** runs the leak trace (8.7).
- **Compliance:** erasure queue, then the certificate moment (8.3); reveal log.
- **Data Plane:** Night tabs per schema, token chips, the plaintext scan (8.8).
- **Portal:** single column, large inputs, two tasks: Open an account, My data (with Erase).

---

## 13. Accessibility and definition of done

- WCAG 2.1 AA minimum; targets in section 3.2. Visible 3 px focus outline everywhere; logical tab order; skip link; dialogs trap focus, everything else does not.
- Touch targets ≥ 44 px. Forms: labels always visible, `aria-describedby` for help and errors, correct `autocomplete`.
- Live regions: verdict stamps, flight completion, verification results use `aria-live="polite"`.
- Charts have a table alternative. Colour is never the only signal.
- Works at 200% zoom and at 360 px. Text may grow 40% (Tamil, Hindi) without breaking layouts.

A screen is done when:
- [ ] it uses tokens only (no stray hex);
- [ ] red and blue appear only per section 3.3;
- [ ] loading, empty, error and success states exist;
- [ ] it is screenshotted at 390 px and 1440 px into `docs/screens/` with no console errors;
- [ ] keyboard-only run-through passes;
- [ ] every number traces to real data;
- [ ] copy matches section 9;
- [ ] reduced-motion mode shows the same information.
