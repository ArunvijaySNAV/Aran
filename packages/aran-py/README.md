# Aran Python SDK

Lightweight, standard-library-only Python client for the Aran Data-Flow Firewall.

## 3-Line Quickstart

```python
from aran import Aran

client = Aran("aran_live_your_api_key_here")
res = client.protect("Customer Aadhaar: 2345 6789 0123", customer_ref="CUST-101", sink="crm-notes")
print(res["text"])  # Tokenized PII output
```

## Features

- **Standard Library Only**: Zero external dependencies (`requests`, `urllib3`, etc. are not required).
- **Scoped API Keys**: Supports granular scopes (`protect`, `gateway`, `trace`, `detokenise`, `erase`, `verify`, `dashboard`, `admin`).
- **Typed Exceptions**:
  - `AranAuthError`: HTTP 401 for invalid or revoked credentials.
  - `AranScopeError`: HTTP 403 when a key lacks the necessary operation scope.
  - `AranRateLimit`: HTTP 429 when per-key (300/min) or signup limits are exceeded, with `retry_after`.
  - `AranError`: General API or network failures.
- **Resilient**: Automatic exponential backoff retries on transient network errors and HTTP 5xx responses for idempotent operations (`trace`, `detokenise`, `verify_receipt`).

