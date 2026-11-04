# Demo data: what is generated and whether it can belong to a real person

Audit of every generator that produces values a bank form accepts. "Safe" means the value cannot belong to a real person; the bank's validators were **not** weakened to get there.

| Value | Where generated | Now | Can it be a real person's? |
|---|---|---|---|
| Card | `scripts/seed.ts`, `scripts/demo_values.ts`, `docs/DEMO_SCRIPT.md`, `e2e/demo_walkthrough.mjs` | Published payment-gateway test numbers from one pool (`scripts/fictional.ts`), each Luhn-valid, 16 digits, an issuer prefix Aran recognises. Was: random Luhn-valid numbers starting with 4 | **No** now. A pool entry can be presented by one customer per Aran workspace (Aran gives an identifier to the first reference that presents it); the seed uses each once and skips the card when the pool is used up |
| Name | same, plus `scripts/seed_demo.py` | Common first names with obviously fictional surnames (Testwala, Sampleton, Demokar...). Was: ordinary Indian full names | **Practically no** (a first name alone is not an identity) |
| Email | no customer email is collected anywhere. Staff logins use `@tessera.test` | unchanged | **No**: `.test` is reserved (RFC 2606) |
| UPI | the bank neither collects nor generates UPI IDs. Aran's detector training data (`aran-cloud/research/synth.py`) generates UPI handles for the model only; it is not stored as customer data | unchanged | n/a to the bank |
| Aadhaar | `seed.ts`, `demo_values.ts`, DEMO_SCRIPT, walkthrough | **Unchanged: random 12 digits, first digit 2-9, valid Verhoeff checksum** | **Yes, possibly.** The validator accepts exactly that shape and publishes no never-issued range, so any such number might be issued. A rough estimate: about 8x10^10 numbers pass the shape and checksum and roughly 1.4x10^9 Aadhaar numbers exist, so on the order of 1-2% of random ones could be live. Cannot be made safe without weakening the validator |
| Mobile | same | **Unchanged: random 10 digits starting 6-9** | **Yes, quite possibly.** The validator accepts any 6-9 number and I know of no officially reserved fictional Indian range. A large share of numbers in that space are in service. Cannot be made safe |
| PAN | same | **Unchanged: random `AAAPA9999A` shape** | **Possibly.** Aran only recognises a PAN whose 4th letter is a real holder type (P C H F A T B L J G); a PAN with any other 4th letter would pass the bank's regex but would not be protected by Aran, so that trick would send plaintext. Cannot be made safe |

Consequence: the two notices ("Fictional bank for demonstration. Do not enter real personal data.") matter, and live demos should type the card from the pool and treat Aadhaar, mobile and PAN as "made up, probably not real, not guaranteed".
