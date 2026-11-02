# @aran/sdk

TypeScript client for **Aran Cloud**. Zero runtime dependencies, uses the global `fetch` (Node 18+, edge runtimes), ESM + CJS, full types.

> Server-side only. The API key must never reach a browser: do not use `NEXT_PUBLIC_*`.

```bash
npm install @aran/sdk
```

```ts
import { Aran } from "@aran/sdk";

const aran = new Aran({ apiKey: process.env.ARAN_APP_KEY!, baseUrl: process.env.ARAN_BASE_URL!, timeoutMs: 4000 });
```

## API

| Call | Scope needed | Retried? |
|---|---|---|
| `aran.protect({ text, customerRef?, purpose?, sink? })` → `{ after, findings[], notes[], latencyMs }` | `protect` | no |
| `aran.protectFields({ fields, customerRef, purpose, sink })` → `{ name, mobile, aadhaar, ... }` tokens | `protect` | no |
| `aran.gateway({ prompt, role })` | `gateway` | no |
| `aran.trace({ dump })` | `trace` or `dashboard` | yes (max 2) |
| `aran.detokenise({ token })` | `detokenise` | yes (max 2) |
| `aran.erase({ customerRef, purpose })` → signed receipt | `erase` | no |
| `aran.verifyReceipt(receipt)` | `verify` or `dashboard` | yes (max 2) |

Retries use exponential backoff and apply only to idempotent calls, only for network errors and 502/503/504. Protecting is never retried (a retry could issue a second set of tokens).

`purpose` is one of `KYC | Loans | Service | Marketing`. `sink` names where the data is going (`kyc-archive`, `log-platform`, `crm`, `loan-vendor`, `ai-gateway`, ...): the same value gets a different token per sink.

### `protectFields`

Sends one labelled sentence per field in a **single** request and returns the token for each field. Supported field names: `name`, `mobile`, `aadhaar`, `card`, `pan`, `upi` (common aliases such as `phone`, `fullName`, `vpa` work, and tokens come back under *your* key names).

If a field is not provably tokenised it throws `AranUnprotectedError`. It never returns a raw value.

### Errors

| Error | When |
|---|---|
| `AranAuthError` (401) | key missing, invalid or revoked |
| `AranScopeError` (403) | key lacks the scope |
| `AranRateLimitError` (429) | `retryAfter` in seconds |
| `AranNetworkError` | no response: DNS, connection, timeout |
| `AranUnprotectedError` | a field came back unprotected |
| `AranError` | any other non-2xx; `.status` and `.body` are set |

All extend `AranError`.

## Next.js server action (fail closed)

```ts
// app/actions/onboard.ts
"use server";
import "server-only";
import { Aran, AranUnprotectedError } from "@aran/sdk";

const aran = new Aran({ apiKey: process.env.ARAN_APP_KEY!, baseUrl: process.env.ARAN_BASE_URL! });

export async function onboardCustomer(form: FormData) {
  const customerRef = `CUS-${crypto.randomUUID().slice(0, 8)}`;
  let tokens: Record<string, string>;
  try {
    tokens = await aran.protectFields({
      fields: {
        name: String(form.get("name")),
        mobile: String(form.get("mobile")),
        aadhaar: String(form.get("aadhaar")),
        pan: String(form.get("pan")),
      },
      customerRef,
      purpose: "KYC",
      sink: "kyc-archive",
    });
  } catch (err) {
    // Aran down, key wrong, or a field not protected: write NOTHING and tell the caller to retry later.
    if (err instanceof AranUnprotectedError) console.error("unprotected field:", err.field);
    return { ok: false as const, status: 503 };
  }
  await db.insert(customers).values({ customerRef, ...tokens }); // tokens only, never the raw values
  return { ok: true as const, customerRef };
}
```

## What it does not do

The app server sees the plaintext for the moment before it calls Aran. Aran protects what is stored and shared afterwards; it does not protect values from the process that first receives them.

## Develop

```bash
npm install
npm test                 # unit tests against a mocked fetch
npm run build            # dist/ (ESM, CJS, .d.ts)
ARAN_BASE_URL=http://127.0.0.1:8100 ARAN_APP_KEY=aran_live_... npm test   # also runs the live integration tests
```
