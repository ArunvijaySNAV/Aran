# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Existing codebase. Aran Cloud console: plain HTML/CSS/JS served by FastAPI from `aran-cloud/cloud/static/` (no build step). Tessera Bank: Next.js (App Router), TypeScript, Tailwind, hand-written shadcn-style components, Drizzle over Supabase Postgres. Functionality is frozen for the frontend overhaul; only markup, styles, copy, icons, fonts and animation change.

## Users
Bank engineers who integrate the API, compliance officers who reveal and erase data, and hackathon judges watching a live demo (often projected, over a few minutes). Staff roles in the bank: KYC officer, support agent, compliance officer, admin. Customers use a thin portal for self-onboarding and "erase my data".

## Product Purpose
Aran Cloud is a firewall-as-a-service that tokenises Aadhaar, card and mobile numbers (also PAN, UPI, names) before they reach a bank's database, logs, vendors and AI tools. Tessera Bank is a fictional bank management system that uses Aran over HTTPS so its database holds tokens, never plaintext. Success: an engineer can integrate in a few lines, a compliance officer can prove erasure and see every reveal, and a judge understands in seconds that the stored data is worthless to a thief.

## Positioning
Aadhaar and card tokens are built to fail their own checksum (Verhoeff, Luhn), so a token can never be mistaken for a real identifier; the same value gets a different token per destination, so a leak identifies its source; erasure destroys a key and returns a signed, verifiable receipt.

## Operating Context
Used at a desk by engineers and compliance staff; shown on a projector in a live demo. Aran runs on the presenter's machine behind a Cloudflare Tunnel; the bank is a separate app that calls it server-side. Every number on screen must come from a real API call or query.

## Capabilities and Constraints
- Aran Cloud: signup and scoped API keys, `/v1/protect`, gateway for AI prompts, detokenise (audited, hash-chained), erase with signed receipts, trace of leaked dumps, dashboard (overview, data flows, keys, trace, receipts, audit, playground), public sample demo endpoint.
- Tessera Bank: onboarding with checksum validation, customers with Reveal (compliance only, reason required, 30 s auto-hide), accounts and transactions, support AI console showing what the provider saw, loan-vendor export with breach trace, compliance centre, Data Plane viewer with plaintext scan, customer portal.
- Terminology: protected, token, sink (`kyc-archive`, `log-platform`, `crm`, `loan-vendor`, `ai-gateway`), purpose, reveal, erase, receipt, trace.
- Constraints: fail closed (bank returns 503 and writes nothing if Aran is unreachable); API keys never reach the browser; names are one-way pseudonyms and cannot be revealed; the app server sees plaintext briefly before calling Aran.

## Brand Commitments
`DESIGN.md` (root) is the binding visual authority and must not be rewritten: "Printed like money", security-printing vocabulary, blue ink means protected, red stamp means a real raw value is exposed, Night world for anything "inside the vault". Aran mark (three arches) and Tessera Bank mark (mosaic tiles, gold line) as specified there. Fonts: Archivo and Martian Mono, local only.

## Evidence on Hand
Real behaviour and measurements live in `docs/REPORT.md` and `docs/measurements/`. Seed data is generated, checksum-valid and labelled sample data. There are no customers, logos, testimonials or benchmarks beyond that; none may be invented.

## Product Principles
1. Prove it, don't claim it: every figure traces to an API response or a query.
2. Show the boundary between raw and tokenised.
3. Ink carries meaning: blue is protected, red is exposed, and neither is decoration.
4. Honest words: describe exact properties; never "unhackable" or "military-grade".
5. One bold moment per screen; the rest stays calm and dense where data needs it.

## Accessibility & Inclusion
WCAG 2.1 AA minimum, targets in DESIGN.md section 3.2; visible focus; touch targets of 44 px or more; works at 360 px and 200% zoom; reduced-motion mode shows the same information; colour is never the only signal; layouts tolerate 40% longer text (Hindi, Tamil).
