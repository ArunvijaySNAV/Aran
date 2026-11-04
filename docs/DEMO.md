# 5-minute demo

Logins (password from `SEED_STAFF_PASSWORD`, default `Tessera-demo-1`): `kyc@`, `support@`, `compliance@`, `admin@tessera.test`. Keep two windows: the bank, and the Aran console dashboard (`/dashboard`, sign in with the workspace admin key).

| Time | Do | Say / show |
|---|---|---|
| 0:00 | **KYC officer**: Customers > Onboard. Use a generated Aadhaar, e.g. from the Aran console playground sample. Tick loan consent. | Inline checksum validation. "Raw values go to Aran; the bank stores tokens." |
| 0:45 | **Admin** > Data plane. Open each of the five schemas. | Tokens in `core_banking`, redacted lines in `log_platform`, CRM tokens, loan-vendor tokens, redacted prompts in `ai_chat`. Every row is real. |
| 1:30 | Compare the same customer's mobile token in `core_banking.customers`, `crm.contacts`, `vendor_share.loan_leads`. | Same person, same Aadhaar: **a different token per destination**. |
| 2:00 | **Support agent** > Support console: paste a complaint with a card and Aadhaar. | Answer on the left, **"What the AI provider saw"** on the right. The provider label says whether it is the echo stand-in or a real model. |
| 2:45 | **Admin** > Loan vendor export > Build CSV > **Simulate vendor breach**. | "A vendor leaks the file." Aran traces it to the `loan-vendor` destination from the tokens alone. |
| 3:30 | **Compliance officer**: customer page > Reveal Aadhaar, give a reason. Value shows for 30 s then hides. Switch to the Aran dashboard > Audit > Verify chain. | The reveal is in the bank's log with its reason and in Aran's tamper-evident chain. |
| 4:15 | Compliance centre: erase the customer. Verify a receipt. Look at "Do the stored tokens still resolve?" | Four signed receipts; every stored token now reads **erased**. |
| 4:45 | **Admin** > Data plane > **Scan for plaintext**. | "No Verhoeff-valid 12-digit, Luhn-valid 16-digit or Indian mobile number anywhere. Aran tokens are built to fail those checks, so a clean scan is real evidence." |

Setup (before the demo, 30 seconds): **Admin** > **Aran connection**. Paste the Aran Cloud address, the app key and the compliance key, press **Save**. The stamp turns blue ("Connected"), the page names the workspace and lists each check (address answers, each key accepted, each key allowed to protect, use the gateway, trace, reveal, erase, verify). Only the last four characters of each key are ever shown again. If the bank already runs on environment variables, the page says "Environment variables" and **Test connection** checks them. **Disconnect** returns the bank to its environment variables. (Needs `CONNECTION_ENC_KEY`; see docs/DEPLOY.md. Without it the page is read-only.)

Backup: if Aran is down, show onboarding returning **503 and writing nothing** (the fail-closed behaviour).
