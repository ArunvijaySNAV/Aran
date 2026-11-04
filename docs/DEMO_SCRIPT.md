# Live demo script (10 minutes, for judges)

Everything below was taken from the code and from a rehearsal run of this exact script (`e2e/demo_walkthrough.mjs`, see the last section). Where something is not verified it says so.

**Addresses.** Aran console: `http://127.0.0.1:8100` · Tessera Bank: `http://127.0.0.1:3100`.
**Bank logins** (password for all: `Tessera-demo-1`): `kyc@tessera.test`, `support@tessera.test`, `compliance@tessera.test`, `admin@tessera.test`.
**Aran admin key** (for the console steps): copy it from `/Users/snarunvijay/Documents/hackathons/Aran2/.new-workspace-admin-key` with `pbcopy < /Users/snarunvijay/Documents/hackathons/Aran2/.new-workspace-admin-key` (it never needs to be shown on screen).

---

## 1. Who can do what (from the code: `bank/lib/auth.ts`, the pages and the server actions)

Left navigation each role sees: the bank shows only the items a role may open. Typing another address is refused server-side and lands on the Dashboard with "Your role cannot open that page."

| Role | Nav items | Can do | Cannot do |
|---|---|---|---|
| **KYC officer** `kyc@` | Dashboard, Customers, Accounts | View customers (all identifiers as tokens); **Onboard a customer** (button on Customers); **Approve / Reject** an open KYC case; **open accounts and post transactions**. | Reveal anything (customer page says "Only compliance officers can reveal"); Support console, Vendor exports, Compliance centre, Data plane, Aran connection (all refused). |
| **Support agent** `support@` | Dashboard, Customers, Support | View customers (tokens only, read-only); use the **Support console** (AI assistant with the "What the AI provider saw" pane). | Onboard, approve/reject, open accounts or see Accounts at all, reveal, anything else. |
| **Compliance officer** `compliance@` | Dashboard, Customers, Accounts, Compliance | **Reveal** Aadhaar, mobile, PAN, card (reason of at least 10 characters, value shown 30 s, every reveal logged); see the Reveal history; **Compliance centre**: erase a customer, verify receipts, see every reveal with its reason; view accounts (read-only: "Your role has read-only access"). | Onboard, approve/reject, open accounts or post transactions, Support console, Vendor exports, Data plane, Aran connection. Names cannot be revealed (one-way pseudonym) for any role. |
| **Administrator** `admin@` | Dashboard, Customers, Accounts, Support, Vendor exports, Compliance, Data Plane, Aran connection | Everything the other roles can do **except Reveal**: onboard, approve/reject, accounts (read and write), Support console, **Vendor exports** (build CSV, simulate a breach), **Compliance centre** (erase, verify), **Data plane** (read every schema, **Scan for plaintext**), **Aran connection** (save/test/disconnect the Aran keys). Sees the Reveal history. | **Reveal** (the bank refuses it for every role except compliance officer; the customer page shows no Reveal buttons for the admin). |

Public, no login: the Customer portal at `/portal` (register, see my data, erase my data). Not part of the 10 minutes; mention it if time allows.

---

## 2. The 10-minute script

Values are fixed and **verified with the bank's own validators** (`bank/lib/validators.ts`: Verhoeff for Aadhaar, Luhn for cards, 10 digits starting 6–9 for mobiles, PAN shape). They belong to nobody. See section 5 for why you must use a **new set** for every demo run in the same Aran workspace.

| Value | Used in step | Check |
|---|---|---|
| Landing Aadhaar `343950504654` | 1 | passes Verhoeff |
| Customer **Anjali Verma**, mobile `7432972377`, Aadhaar `652301019164`, PAN `CFLPH7375C`, card `4247108646585311`, loan ₹150000 | 4 | Aadhaar Verhoeff ✓, card Luhn ✓, mobile ✓, PAN ✓ |
| Wrong Aadhaar to type once on purpose: `652301019165` | 4 | fails Verhoeff (the last digit is a checksum) |
| Support complaint: card `4549955977661482`, Aadhaar `402079608370`, mobile `9860183355` | 5 | all valid |
| Spare customer sets for a second run: **Rohan Iyer** `9617326009` / `986363938813` / `YAOPJ0578A` / `4179350466188048`; **Kavita Menon** `6743012187` / `670917204747` / `VNSPM9157U` / `4615601807485697` | – | all valid |
| More sets: `cd bank && npx tsx ../scripts/demo_values.ts 3` | – | prints fresh verified sets |

Do not use a mobile number that starts with 91 (for example `9180815617`): the bank's validator strips a leading "91" and then rejects it.

### 1. Console landing — 0:00 to 1:15 · `http://127.0.0.1:8100/`
1. Page loads on "The number a thief can't use." The plate on the right shows a sample number in red with the stamp **"Passes the Verhoeff checksum: a usable Aadhaar"**.
2. Click the number box, select all, type `343950504654`. Stamp stays red.
3. Click **Protect this number**. The digits roll for about a second, then show a token in blue and the stamp reads **"Fails the Verhoeff checksum: cannot be an Aadhaar"**.
4. Click the sink pill **crm**, then **loan-vendor**: a different token each time.
5. Scroll to "One tap. Raw on the left, tokens in the database." and click **Run again**. The meta line reads like "5 of 5 values protected · engine time 3.42 ms · types: PER, AADHAAR, MOBILE, CARD, PAN".
6. Scroll to "Erase a customer. Get a certificate." and click **Crypto-shred purpose key**: "All 4 sample tokens are now unreadable."
- **Audience sees:** red real-looking number becomes a blue token that fails the checksum; the same number gets a different token per destination; the flight is a real call to `/v1/protect`.
- **Proves:** a stolen token can never be mistaken for a real Aadhaar, and leaks identify their source. (Steps 1 to 4 and 6 are labelled illustrations in the page; step 5 is a real call on generated sample data, say so.)

### 2. Signup — skip (0:20 of talking, no clicks)
Say: "Signup issues the admin key once; we already created this workspace." Do not click **Get an API key** (it creates a new workspace).

### 3. Connect: a real test event — 1:15 to 2:30 · `http://127.0.0.1:8100/connect`
1. The page asks **"Paste a key to continue"**. Paste the admin key (⌘V after `pbcopy`), click **Use this key**.
2. Four steps appear: step 01 is ticked; step 02 shows the base URL and code tabs (TypeScript, Python, curl).
3. Click **Send a test event**. Under step 04 "Watch it arrive" two panes fill: **Sent** (a generated sample record with a name, Aadhaar, mobile, card and PAN, all raw) and **Stored** (the same record, every value a token); the status line reads **`Connected: your app sent an event to sink "crm" (2 values protected).`**
- **Proves:** integration is one call, and the first event is counted for real (it shows on the dashboard Overview).

### 4. Bank as KYC officer — 2:30 to 5:00 · `http://127.0.0.1:3100/login`
1. Log in `kyc@tessera.test`. Dashboard: "Welcome, Kavya", counts (Customers, New KYC this week, Open KYC cases, Deposits held) and "Last 10 events" with `<MOBILE:…>` tokens in the log lines. Left nav: **Dashboard, Customers, Accounts**.
2. **Customers**: the table shows Reference, Name, Aadhaar, Mobile, Status, Since; every identifier is a token chip (names `<PER:…>`, Aadhaar 12 digits, mobile `<MOBILE:…>`). "Nothing here is a real number."
3. Click **Onboard a customer**. Step 1 of 3 "Identity": Full name `Anjali Verma`, Mobile `7432972377`, **Continue**.
4. Step 2 of 3 "Identifiers": Aadhaar `652301019165` (wrong on purpose), **Continue** → red inline message "Enter a valid 12-digit Aadhaar (the last digit is a checksum)." Replace with `652301019164`, PAN `CFLPH7375C`, Debit card `4247108646585311`, **Continue**.
5. Step 3 of 3 "Consent & review": tick the loan-consent box, Loan amount `150000`. The right-hand Night panel "What happens on submit" lists the four destinations (kyc-archive, log-platform, crm, loan-vendor). Click **Onboard customer**.
   - **Expected:** the page jumps to the new customer (`CUS-0000xx`) in well under a second with the green banner **"Customer onboarded. Every identifier below is an Aran token."**
   - **If it does not move, do not click again: see recovery sheet A.**
6. On the customer page: **Identifiers** table = tokens only (none of the typed numbers appears anywhere on the page). Column "Value" says "One-way pseudonym: cannot be revealed" for the name and "Only compliance officers can reveal" for the rest. An open **KYC cases** card has **Approve** and **Reject** (do not click).
7. Under Accounts click **Open an account** (the form comes with the customer reference filled in), Opening deposit `25000`, **Open account** → "Account TSB10000nn opened." Click the account number. In **New transaction**: Type Deposit, Amount `1200`, Description `Salary credit, call me on 7432972377`, **Post transaction** → **"Done. New balance ₹26,200."** The statement row reads `Salary credit, call me on <MOBILE:v…>`.
- **Audience sees:** validation at the door; the raw values exist only in the form; the database and the logs hold tokens; even a mobile typed into a free-text description is replaced.
- **Proves:** the bank stores tokens, never plaintext, on every path that touches identifiers.

### 5. Bank as support agent — 5:00 to 5:45
1. Sign out (top right), log in `support@tessera.test`. Nav: **Dashboard, Customers, Support**. (Open the new customer from Customers if you want to show it is read-only: tokens, no Reveal, no Approve.)
2. **Support**: Customer reference `CUS-0000xx` (the new one), question:
   `Customer says card 4549955977661482 was blocked and her Aadhaar 402079608370 is on file. Call 9860183355.` → **Ask**.
3. Right-hand Night pane **"What the AI provider saw"**: `Customer says card <CARD_1> was blocked and her Aadhaar <AADHAAR_1> is on file. Call <MOBILE_1>.` and "3 sensitive value(s) replaced before leaving the bank." Left card "Answer to you": starts "You wrote:" with the card shown as `XXXXXXXXXXXX1482` and the Aadhaar masked; the provider line reads "echo stand-in (no external AI call)".
- **Say it straight:** the agent's own screen shows the mobile number in clear (Aran lets the customer-care role see mobile numbers); the provider and the stored chat never received it.
- **Proves:** an AI tool can help staff without ever seeing the raw values.

### 6. Bank as compliance officer — 5:45 to 7:30
1. Log in `compliance@tessera.test`. Nav: **Dashboard, Customers, Accounts, Compliance**.
2. **Customers** → open the new customer (first row). Click **Reveal Aadhaar**, reason `RBI audit request 114: verify identity of account holder`, **Reveal**. A **red chip** shows `652301019164` with a shrinking bar and **"Hides in 30s · this reveal is recorded"**. Click **Hide now**. (Reveal Mobile works the same way.)
3. Reload the page (⌘R): the card **Reveal history** now lists the reveal with its reason. (It does not update by itself.)
4. **Compliance** → "Erase a customer": Customer reference `CUS-0000xx`, type it again to confirm, **Erase this customer's data**. Result: **"Erased. 4 signed receipts issued."**, an **Erasure certificate** with the seal, and a Night table "Do the stored tokens still resolve?" where every row (aadhaar, mobile, pan, card) reads **erased**.
5. Click **Verify receipt** on any purpose: **"Valid: Ed25519 ✓ · ML-DSA-65 ✓ · in the transparency log ✓"**.
6. Open the customer again: it now says erased and offers no Reveal.
- **Proves:** reveal is gated, reasoned and logged; erasure destroys keys and returns a signed, verifiable receipt; the stored tokens become permanently unreadable.
- **Note:** this burns the customer reference for good in this Aran workspace (section 5).

### 7. Bank as administrator — 7:30 to 9:00
1. Log in `admin@tessera.test`. Nav shows all eight items: **Dashboard, Customers, Accounts, Support, Vendor exports, Compliance, Data Plane, Aran connection**.
2. **Data Plane**: a Night page, one section per schema with its Aran sink (core_banking → kyc-archive, log_platform → log-platform, crm → crm, vendor_share → loan-vendor, ai_chat → ai-gateway); token columns are blue chips. Click **Scan for plaintext**: **"Clean. Scanned 15 tables, … rows, … text cells: no Verhoeff-valid 12-digit number, no Luhn-valid 16-digit number, no Indian mobile number. Aran tokens are built to fail those checks."**
3. **Vendor exports**: "New consented leads waiting" shows the number of leads (the five seeded ones plus the new customer: 6). Click **Build CSV export**; the new batch appears at the top after a moment (reload if it does not). Click its **Simulate vendor breach**: **"Leak traced to the “loan-vendor” destination. 15 of 15 values in the leaked file are tokens Aran issued to that destination."** (expected figure; with a different number of waiting leads it is three values per lead, minus a PAN for leads without one) and a table of tokens, each with source sink `loan-vendor`. (12 of the 15 come from the five seeded leads, verified with the demo workspace's keys; 3 from the new customer, verified after erasure as well. The full 15 in one batch was not run in one go: see "Not verified".)
4. **Aran connection**: shows the diagram Bank → Aran Cloud → Tokens and "Source: Environment variables" (the keys come from the server's environment). Click **Test connection**: **"All checks passed."** with ten separate checks (address answers, each key accepted, protect, gateway, trace, reveal, erase, verify, dashboard), stamp **Connected**, workspace "Tessera Bank".
- **Proves:** every table holds tokens (the scan is the evidence); one leaked file points at its source; the Aran link is testable from the UI.

### 8. Back to the Aran console: the audit — 9:00 to 9:45 · `http://127.0.0.1:8100/dashboard`
1. If asked to sign in: paste the admin key, **Open dashboard**. Left tabs: **Overview, Data flows, API keys, Trace, Erasure & receipts, Audit, Playground**.
2. **Audit**: "Every reveal attempt, including refusals and unknown tokens, in a hash chain." Rows: When, Key ("Tessera compliance"), Token, Purpose, Result, Entry hash. Your reveals are the newest rows.
3. Click **Verify chain**: **"Chain intact. N entries, head …"**.
4. (Optional, 15 s) **Erasure & receipts** tab: the four receipts of the customer you erased.
- **Proves:** the bank's reveals are independently recorded by Aran in a tamper-evident chain that the bank cannot edit.

---

## 3. Recovery sheet

### A. The onboarding redirect flake (known, cause not found: `docs/FUNCTIONALITY_GAPS.md` item 25)
- **What happens:** after **Onboard customer** the page stays on step 3 and nothing changes. The customer **was saved** (it appears at the top of Customers). It happened in 2 of the 5 rehearsal runs.
- **On stage:** do **not** click Onboard again (that would create a second customer). Say "saved: let me open it", wait 2 to 3 seconds, click **Customers** in the left nav, click the **first row** (the newest reference). In the rehearsal that worked.
- **If the click does nothing too:** press ⌘R on the Customers page and click the first row again; if that fails, type the address `http://127.0.0.1:3100/customers/CUS-0000xx` (the reference is in the first row). Direct address loads always worked. (The reload step was not needed during the rehearsal, so it is untested.)
- **Avoid:** do not rehearse onboarding two minutes before going live on a freshly started bank; it fails more often right after a restart.

### B. A Reveal fails ("Check the highlighted fields." or no value)
- **Meaning:** the bank could not reveal that value: the customer is erased, the token is not known to the Aran workspace the bank is connected to, or the compliance key lacks the reveal permission. (The message is vague; gap 24.)
- **On stage:** do not debug. Switch to a different customer from the list (for example `CUS-000001`, which has Aadhaar, mobile, PAN and card) and reveal there; say "this one is already erased" only if it really is.
- **After the demo:** Admin > Aran connection > **Test connection**: the "Compliance key can use Reveal (detokenise)" line says what is wrong. If the reason is shorter than 10 characters the form shows "Give a reason of at least 10 characters." (that one is inline and clear).

### C. Aran is unreachable → show it on purpose (the fail-closed feature)
- **To demo it deliberately** (30 seconds, after the erasure step, as the KYC officer): in a terminal run
  `kill $(lsof -Pi :8100 -sTCP:LISTEN -t)`
  then in the bank try to onboard any customer (use a spare set from section 2). The red banner reads **"Service unavailable (503). Data protection service unavailable. Nothing was saved."** Open Customers: the count has not changed.
- **Say:** "If the protection service cannot be reached the bank refuses to write anything. A bank that cannot tokenise must not store plaintext." (What the other pages do during an outage was not checked in the rehearsal: stay on the onboarding page and the Customers count.)
- **Bring it back:**
  ```bash
  cd /Users/snarunvijay/Documents/hackathons/Aran2/aran-cloud/cloud && set -a && source ../../.env.local && set +a && ARAN_DEMO_MODE=1 nohup ../../.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8100 --no-proxy-headers > /tmp/aran_cloud.log 2>&1 &
  ```
  then `curl -s http://127.0.0.1:8100/v1/health` must print `{"status":"ok","core":true,"core_ready":true}`. The bank needs no restart (rehearsed: the next onboarding succeeded).
- **If it happens by accident:** the same banner appears; the fix is the same command (or `scripts/run_local.sh`, section 4, if the core is also down).

### D. Restarting each component
| Component | Stop | Start | Notes |
|---|---|---|---|
| Aran cloud only (port 8100, console + API) | `kill $(lsof -Pi :8100 -sTCP:LISTEN -t)` | the command in C | rehearsed |
| Aran core + cloud | `for P in 8000 8100; do kill $(lsof -Pi :$P -sTCP:LISTEN -t); done` | `cd /Users/snarunvijay/Documents/hackathons/Aran2 && ARAN_DEMO_MODE=1 scripts/run_local.sh` (waits until the core is ready, about 15 to 40 s) | rehearsed. `run_local.sh` refuses to start if either port is still in use. Data survives a restart; reveals and traces of earlier customers keep working (fixed in commit `edfb918`) |
| Bank (production build, port 3100) | `kill $(lsof -Pi :3100 -sTCP:LISTEN -t)` | `cd /Users/snarunvijay/Documents/hackathons/Aran2/bank && set -a && source .env.local && set +a && npx next start -p 3100` | rehearsed. Rebuild first (`npx next build`) only if code changed, and stop any dev server on port 3000 before building. Expect the redirect flake to be more likely just after a restart |
| Supabase (database, login) | `cd bank && supabase stop` | `cd bank && supabase start` | **not exercised in the rehearsal**; do not use `supabase db reset` unless you mean to wipe the data |

---

## 4. Pre-demo checklist

**Start order** (each step waits for the previous one): 1) Docker Desktop running; 2) `cd /Users/snarunvijay/Documents/hackathons/Aran2/bank && supabase start`; 3) `cd /Users/snarunvijay/Documents/hackathons/Aran2 && ARAN_DEMO_MODE=1 scripts/run_local.sh`; 4) the bank start command in D.

**Health checks** (run all; expected output in the second column):

| Command | Expect |
|---|---|
| `curl -s http://127.0.0.1:8000/api/health` | `{"ready":true,"error":null}` |
| `curl -s http://127.0.0.1:8100/v1/health` | `{"status":"ok","core":true,"core_ready":true}` |
| `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54321/auth/v1/health` | `200` |
| `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/login` | `200` |
| `docker exec supabase_db_tessera-bank psql -U postgres -Atc "select count(*) from core_banking.customers"` | `25` on a clean state |
| `cd /Users/snarunvijay/Documents/hackathons/Aran2 && set -a && source bank/.env.local && set +a && curl -s -H "X-API-Key: $ARAN_COMPLIANCE_KEY" $ARAN_BASE_URL/v1/dashboard \| python3 -c "import sys,json; print(json.load(sys.stdin)['tenant']['name'])"` | `Tessera Bank` (proves the bank's keys point at the workspace you expect) |
| `scripts/bank-run.sh assert_no_plaintext.ts \| tail -1` | `PASS: no raw Aadhaar, card or mobile found, and no Aran API key stored in any table` |
| four logins | log in once as each role in the browser (or `curl` the Supabase password grant) |
| Admin > Aran connection > **Test connection** | "All checks passed", ten checks |

Optional polish: Admin > Aran connection > paste the Aran address and both keys > **Save** turns the stamp blue ("Connected", source "Saved on this page"). It needs `CONNECTION_ENC_KEY` (set in `bank/.env.local`) and must be redone after every reset.

Also: open the console landing page once to check the sample call works, have the admin key in the clipboard, and have the four logins in password-manager autofill or on a card. The browser zoom at 100% shows the whole screen at 1440 px wide; for a projector press ⌘+ twice (the layout is checked at 125% and 150%), or add `?present=1` to a page for the presenter overlay (arrows move between pages, Esc leaves it).

**Reset to a clean state** (local stack only; never run against a hosted database):
```bash
cd /Users/snarunvijay/Documents/hackathons/Aran2
F=docs/backups/bank-$(date +%Y%m%d-%H%M%S).sql        # docs/backups is git-excluded
docker exec supabase_db_tessera-bank pg_dump -U postgres -d postgres --schema=public --schema=core_banking --schema=crm --schema=log_platform --schema=vendor_share --schema=ai_chat > $F
cd bank && supabase db reset                          # wipes the LOCAL database only (host 127.0.0.1:54322)
set -a && source .env.local && set +a && npm run migrate
cd .. && scripts/bank-run.sh seed.ts                  # if it stops with "status: 422", run it again until it prints "customers in database: 25"
```
(The 422 is the seed's random mobile number starting with 91, which the bank's validator refuses; a rerun resumes.) Then restart the bank (D) so it reconnects, and run the health checks. A reseed gives 25 customers CUS-000001 to CUS-000025, 13 accounts, 5 loan leads.

### Warning: erased customer references are burned for good
Aran never re-keys an erased (customer reference, purpose). The bank's reference counter starts again at CUS-000001 after a reset, so a reference erased in an earlier run comes back **with unreadable tokens** (`<…:withheld-erased>`): the customer looks active but nothing can be revealed.
- The erase step of this demo burns the reference you erase (for example CUS-000026). Before the **next** demo, find the highest burned number and move the counter past it (replace `<N>`):
  ```bash
  cd /Users/snarunvijay/Documents/hackathons/Aran2
  T=$(sqlite3 -readonly aran-cloud/cloud/cloud.db "select tenant_id from api_keys where label='Tessera compliance' order by id desc limit 1")
  sqlite3 -readonly data/tenants/$T/aran.db "select distinct customer_ref from erasure_receipts order by 1"
  docker exec supabase_db_tessera-bank psql -U postgres -Atc "select setval('core_banking.customer_ref_seq', <N>)"   # run AFTER the reseed; the next customer gets <N>+1
  ```
- **If any burned reference is 25 or lower** (for example you erased a seeded customer), a reseed would burn those seeded customers too: create a **new Aran workspace and new bank keys** first (Admin > Aran connection, or `scripts/provision_bank_keys.py`), then reseed.
- Same rule for **identifiers**: Aran gives an Aadhaar, mobile, PAN or card to the customer reference that presented it **first**. Onboarding the same numbers again later under a new reference reuses the first owner's tokens, and erasing the new reference then shows tokens as `ok`, not `erased`. **Use a new value set for every demo run in the same workspace** (section 2).

---

## 5. How this script was checked (rehearsal)

`e2e/demo_walkthrough.mjs` follows the steps above like a presenter (browser automation, not a test suite) against a throwaway Aran workspace and a second bank instance, so nothing in the demo workspace was erased. Run it again before the demo with fresh values (it writes data: one customer, one account, reveals, an erase, a vendor export):
```bash
cd /Users/snarunvijay/Documents/hackathons/Aran2 && set -a && source bank/.env.local && set +a
DEMO_SET=spare2 BANK_URL=http://127.0.0.1:3100 ARAN_ADMIN_KEY=$(cat .new-workspace-admin-key) node e2e/demo_walkthrough.mjs
```
(Only against the real demo workspace if you are about to reseed and move the reference counter, because it erases the customer it creates.)

**Where reality differed from my first draft of the script (and what the script now says):**
1. The customer page and Reveal history do not update by themselves after a reveal: a reload is needed (step 6).
2. A new vendor batch can take a moment to appear at the top; the leads count text is truncated if read too early (step 7).
3. The sidebar tab is "Erasure & receipts", not "Erasure and receipts" (step 8).
4. A second run with the same Aadhaar/mobile/PAN/card made the erasure look broken (tokens `ok`): see the identifier rule in section 4.
5. The seed script stops now and then with a 422 (mobiles starting 91): rerun it.
6. The onboarding redirect failed in 2 of 5 runs (recovery sheet A).
7. A "Test connection" press needs the button, not the hint text that also says "Test connection".

**Last full rehearsal:** 0 differences from this script, 0 console errors (set `spare2`, throwaway workspace).

**Not verified**
- The vendor breach as one 15-of-15 batch in the demo workspace: the rehearsal ran in a throwaway workspace, where the seeded leads (tokenised under the demo workspace) read "not ours". I checked the pieces separately: the five seeded leads trace 12 of 12 with the demo workspace key, and a new customer's lead traces 3 of 3 even after that customer is erased.
- The landing page's screen at 1:15 with a projector, the console's Night mode, and the customer portal were not part of the rehearsal.
- `supabase stop` / `start` and the ⌘R-then-click recovery were not exercised. Only Chromium was used.
