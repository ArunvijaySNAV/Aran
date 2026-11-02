# Aran SaaS Foundation Plan: Multi-Tenancy, API Keys, and Persistence

> **Document Version:** 1.0.0  
> **Target System:** Aran Data-Flow Firewall (`app/server`, `research/`)  
> **Status:** Architectural Design & Implementation Plan (Read-Only)  
> **Author:** Antigravity AI  

---

## Executive Overview

Aran currently operates as a high-performance in-memory research prototype and demonstration console. Core cryptographic algorithms (NIST SP 800-38G FF1, RFC 6962 Merkle trees, hybrid Ed25519 + ML-DSA-65 signatures, and cuckoo filter registries) execute at sub-millisecond speeds ($p_{50} \approx 0.4\text{ ms}$, $p_{95} \approx 2.6\text{ ms}$). However, all keys, vault tokens, Merkle nodes, ledger entries, and audit logs reside in volatile process memory (`PurposeVault.keys`, `PurposeVault.vault`, `PurposeVault.log`, `Engine.customers`, `standout.LEDGER`).

This document defines the production SaaS architecture for Aran:
1. **Multi-Tenancy:** Complete tenant isolation via hashed API keys, per-tenant cryptographic silos, and zero cross-tenant contamination.
2. **Durability & Persistence:** Pluggable SQLite (local/demo) and PostgreSQL (production) persistence using SQLAlchemy Core.
3. **Crypto-Shredding at Rest:** Envelope encryption of purpose keys under a master Key Encryption Key (KEK) and mitigation of database replica/WAL un-erasure.
4. **Persistent Post-Quantum Receipts:** Tenant-specific Ed25519 and ML-DSA-65 keys guaranteeing offline audit verification across server restarts.
5. **Zero-Downtime Migration:** An 8-step migration plan where all 45 research tests and end-to-end smoke tests pass after every stage.

---

## 1. Multi-Tenancy & API Key Resolution

### 1.1 Request Authentication & Resolution
Every incoming API request must resolve to an authenticated `tenant_id` before hitting the firewall engine.

```
Incoming Request
  │
  ├── Headers: X-API-Key: aran_live_...
  │     │
  │     ▼
  │   [Hash check: SHA-256(key)] ──▶ Match in `api_keys` table
  │     │
  │     ├── Found: TenantContext(tenant_id, plan, rate_limits)
  │     └── Missing / Invalid: HTTP 401 Unauthorized
  │
  └── No Header & ARAN_REQUIRE_KEY not set:
        │
        └── Fallback to TenantContext(tenant_id="demo", ...)
```

* **API Key Format:** `aran_live_<32_random_bytes_hex>` (64 hex characters, prefixed with `aran_live_` for secret-scanner detection).
* **Key Storage:** Keys are displayed **once** upon generation. The database stores only `key_hash = SHA-256(raw_key.encode())`, the short display prefix `prefix = raw_key[:14]`, and `created_at` / `revoked_at`.
* **Demo Mode Preservation:** If environment variable `ARAN_REQUIRE_KEY` is absent or `0`, requests omitting `X-API-Key` automatically bind to `tenant_id = "demo"`. The existing plain HTML/JS UI at [`app/ui/`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/ui) continues functioning with zero modifications.

### 1.2 Tenant Administration (Guarded by `ARAN_ADMIN_TOKEN`)
Tenant onboarding and API key rotation use the existing `ARAN_ADMIN_TOKEN` mechanism ([`app/server/main.py:44`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py#L44)), preventing tenant keys from performing administrative escalations.

* `POST /api/admin/tenants`: Creates a new tenant record (`id`, `name`, `billing_tier`).
* `POST /api/admin/tenants/{id}/keys`: Generates a fresh 256-bit API key, registers its SHA-256 hash, and returns the plaintext key once.
* `DELETE /api/admin/tenants/{id}/keys/{key_id}`: Revokes an active key.

### 1.3 Tenant Engine Silos
Instead of a single global `ENG` instance ([`app/server/main.py:15`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py#L15)), the server instantiates a `TenantManager` managing an in-memory LRU cache of `Engine` instances keyed by `tenant_id`.

```
                    ┌──────────────────────────────────────────────┐
                    │            Shared Read-Only Assets           │
                    │  - Detector Models (base.ner, otp_clf, etc.) │
                    │  - Loghub Real Log Corpora (research/data)   │
                    └──────────────────────┬───────────────────────┘
                                           │ (read-only reference)
                  ┌────────────────────────┴────────────────────────┐
                  ▼                                                 ▼
      ┌───────────────────────┐                         ┌───────────────────────┐
      │ Engine (Tenant A)     │                         │ Engine (Tenant B)     │
      │ - PurposeVault        │                         │ - PurposeVault        │
      │   (keys, tokens, log) │                         │   (keys, tokens, log) │
      │ - CustomerRegistry    │                         │ - CustomerRegistry    │
      │ - IndexingFirewall    │                         │ - IndexingFirewall    │
      │ - LeakageLedger       │                         │ - LeakageLedger       │
      │ - Immune Layer (AIS)  │                         │ - Immune Layer (AIS)  │
      └───────────────────────┘                         └───────────────────────┘
```

* **Shared Read-Only Singletons:**
  * Model artifacts (`app/server/models/detector.pkl` containing CRF NER, character n-gram classifiers, and isotonic calibrator) are loaded **once** at server boot and shared read-only across all tenants.
  * Loghub corpora (`LOGS_DIR` in [`app/server/engine.py:45`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/engine.py#L45)) are mapped into a shared read-only corpus.
* **Isolated Per-Tenant State:**
  * `PurposeVault`: Per-tenant cryptographic keys, tokens, and Merkle tree.
  * `_IndexingFirewall`: Per-tenant token-to-sink reverse attribution index (`self.index`).
  * `CustomerRegistry` & `OtpRegistry`: Per-tenant HMAC-keyed cuckoo filters.
  * `LeakageLedger`: Per-tenant min-entropy domain tracking (replacing the global `LEDGER` singleton in [`app/server/standout.py:205`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/standout.py#L205)).
  * `Immune`: Per-tenant flow windows, learned self-radius, and detector centroids.

### 1.4 Fixing Identifier Ownership: Per-Tenant & Per-Customer Binding

#### Problem in Current Code
In `PurposeVault` ([`research/firewall/shredder.py:143`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/shredder.py#L143)), ownership is indexed by:
$$\text{owner\_key} = \text{HMAC}(\text{index\_key}, \text{typ} \parallel \text{canonical}(\text{value})) \to \text{customer\_ref}$$
1. **Across Tenants:** If global, Bank A enrolling Aadhaar $X$ prevents Bank B from enrolling its own customer with Aadhaar $X$.
2. **Within a Tenant:** The first customer who registers Aadhaar $X$ permanently claims it (first-owner-wins rule from Amendment A1). If a second customer (e.g., joint account holder or family member sharing a phone) submits Aadhaar $X$, Aran issues the token under the *first* customer's purpose key. Erasing customer 2 does not erase the token.

#### Solution Part 1: Scoped by Tenant (By Construction)
The `owner_index` and `index_key` are strictly scoped to the tenant. The HMAC key is unique per tenant:
$$\text{index\_key}_{\text{tenant}} = \text{HKDF}(\text{master\_key}, \text{salt}=\text{tenant\_id})$$
Ownership checks never cross tenant boundaries.

#### Solution Part 2: Binding Per $(Customer, Value)$ Inside a Tenant
To allow two customers ($C_1, C_2$) sharing an identifier within the same bank to each have their own independent token and erasure lifecycle:

1. **Change in `PurposeVault`:**
   * Replace the 1-to-1 dictionary `self.owner: dict[hash, customer_ref]` with a relation:
     $$\text{self.owners}: \text{dict}[\text{hash}, \text{set}[\text{customer\_ref}]]$$
   * When tokenizing via `PurposeVault.tokenise(typ, value, customer_ref, purpose, sink)`:
     The vault stores:
     $$\text{vault\_tokens}[\text{token}] = (\text{customer\_ref}, \text{purpose}, \text{sink}, \text{ciphertext})$$
     Each customer receives a distinct token encrypted under their own $(C_i, \text{purpose})$ AES-GCM key.
2. **What This Breaks & How to Handle It:**
   * **Breaks Un-Attributed Log Processing:** When a raw log arrives via `POST /api/process` without a `customer_ref`, and Aadhaar $X$ belongs to both $C_1$ and $C_2$, the firewall cannot know whose purpose key to encrypt under.
     * *Resolution:* If multiple owners exist and no `customer_ref` is provided, Aran must either:
       a) Fall back to the vaultless FF1 path (traceable, but un-erased without customer context), or
       b) Require an explicit `customer_ref` header/field when multi-owner ambiguity is detected.
   * **Breaks Downstream Referential Integrity:** If $C_1$ and $C_2$ both submit Aadhaar $X$ to the same sink (e.g. `loan-vendor`), the vendor receives two different tokens ($T_1 \neq T_2$) for the same person/account, breaking join queries at the sink.
     * *Resolution:* This is the fundamental trade-off of crypto-shredding: independent erasure *requires* independent cryptographic keys, which produces distinct ciphertexts.

---

## 2. Persistence & Crypto-Shredding Safety

### 2.1 Storage Layer Selection
* **Recommendation:** **SQLAlchemy Core** with asynchronous connection pooling (`aiosqlite` for SQLite / `asyncpg` for PostgreSQL).
* **Rationale:**
  * **Plain `sqlite3`:** Rejected because porting hand-written SQL to PostgreSQL requires manual abstraction over datetime parsing, `RETURNING` clauses, dialect-specific upserts (`ON CONFLICT DO UPDATE`), and binary blob semantics.
  * **Full SQLAlchemy ORM:** Rejected because identity maps, object hydration, and change-tracking introduce CPU overhead that would inflate Aran's $0.4\text{ ms}$ baseline.
  * **SQLAlchemy Core:** Delivers cross-database dialect compilation (identical schema and statements on SQLite and PostgreSQL), connection pooling, and type safety, with negligible overhead.

### 2.2 Complete Database Schema

```sql
-- 1. Tenant Registry
CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Hashed API Keys
CREATE TABLE api_keys (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    prefix VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- 3. Customers
CREATE TABLE customers (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ref VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, ref)
);

-- 4. Customer Identifier Bindings (Masked for Display)
CREATE TABLE customer_identifiers (
    tenant_id VARCHAR(64) NOT NULL,
    customer_ref VARCHAR(64) NOT NULL,
    id_type VARCHAR(16) NOT NULL,
    masked_value VARCHAR(64) NOT NULL,
    PRIMARY KEY (tenant_id, customer_ref, id_type),
    FOREIGN KEY (tenant_id, customer_ref) REFERENCES customers(tenant_id, ref) ON DELETE CASCADE
);

-- 5. Owner Lookup Index (HMAC Hash -> Customer)
CREATE TABLE owner_index (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    id_type VARCHAR(16) NOT NULL,
    owner_hash BYTEA NOT NULL,
    customer_ref VARCHAR(64) NOT NULL,
    PRIMARY KEY (tenant_id, id_type, owner_hash, customer_ref)
);
CREATE INDEX idx_owner_lookup ON owner_index(tenant_id, id_type, owner_hash);

-- 6. Purpose Keys (Encrypted at Rest with KEK)
CREATE TABLE purpose_keys (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_ref VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    encrypted_key BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, customer_ref, purpose)
);

-- 7. Vault Tokens (Encrypted Values at Rest)
CREATE TABLE vault_tokens (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token VARCHAR(64) PRIMARY KEY,
    customer_ref VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    sink VARCHAR(64) NOT NULL,
    id_type VARCHAR(16) NOT NULL,
    nonce BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tokens_cust ON vault_tokens(tenant_id, customer_ref, purpose);

-- 8. Merkle Transparency Log (RFC 6962 Append-Only)
CREATE TABLE merkle_log (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    leaf_index BIGINT NOT NULL,
    event_json TEXT NOT NULL,
    leaf_hash BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, leaf_index)
);

-- 9. Signed Erasure Receipts
CREATE TABLE erasure_receipts (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_ref VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    receipt_json TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, customer_ref, purpose)
);

-- 10. Reverse Token Index (Attribution Tracing)
CREATE TABLE token_sink_index (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token VARCHAR(64) PRIMARY KEY,
    sink VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Leakage Ledger State (Min-Entropy Tracking)
CREATE TABLE ledger_state (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_hash BYTEA NOT NULL,
    domain VARCHAR(64) NOT NULL,
    revealed_positions VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, entry_hash, domain)
);

-- 12. Security & Anomaly Alerts
CREATE TABLE security_alerts (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_id VARCHAR(32) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    src VARCHAR(64) NOT NULL,
    sink VARCHAR(64) NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    sample_count INTEGER NOT NULL,
    raw_fraction DOUBLE PRECISION NOT NULL,
    detok_rate DOUBLE PRECISION NOT NULL,
    classes_json TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    label VARCHAR(16)
);
```

### 2.3 Immune State Memory Justification
* **Recommendation:** Keep sliding-window traffic counters (`Immune.cur`, `Immune.recent`) in **RAM**.
* **Justification:** Every incoming line updates flow statistics across 7 dimensions ([`app/server/engine.py:387`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/engine.py#L387)). Writing each window increment to PostgreSQL would introduce intolerable I/O contention.
* **Persistent Components:** Only closed anomaly alerts (`security_alerts` table), operator feedback labels (`POST /api/immune/alerts/{id}/label`), and the fitted negative-selection detector centroids (`self.ais.C`) are persisted.

### 2.4 Crypto-Shredding at Rest & The Backup Threat

#### Envelope Encryption
Purpose keys are never stored in plaintext on disk:
1. `ARAN_MASTER_KEK` (256-bit secret) is injected via environment variable or KMS provider interface (`KMSProvider.decrypt_kek()`).
2. `Tenant_KEK = HKDF(ARAN_MASTER_KEK, salt=tenant_id, info=b"aran-tenant-kek-v1")`.
3. In `purpose_keys`, the 256-bit AES key is encrypted via `AES-256-GCM(Tenant_KEK, nonce, purpose_key)`.

#### Erasure Execution
Upon `POST /api/erase`:
```python
# Hard delete with zeroing overwrite
with db.transaction():
    # 1. Overwrite bytes in-place to prevent raw page inspection
    db.execute(
        update(purpose_keys)
        .where(tenant_id == tid, customer_ref == ref, purpose == p)
        .values(encrypted_key=b"\x00" * 48, nonce=b"\x00" * 12)
    )
    # 2. Hard delete the row
    db.execute(
        delete(purpose_keys)
        .where(tenant_id == tid, customer_ref == ref, purpose == p)
    )
```
Soft deletion (`deleted_at = NOW()`) is strictly prohibited for cryptographic keys.

#### The Threat of Database Backups, WAL, and PITR
* **The Reality:** A database `DELETE` removes a row from active pages, but PostgreSQL Write-Ahead Logs (WAL), Point-In-Time-Recovery (PITR) logs, and full database backups preserve deleted tuples for 30–90 days. An adversary obtaining a database backup can extract the deleted ciphertext and KEK, un-erasing the customer!
* **Architectural Safeguards:**
  1. **Tablespace Isolation:** Place the `purpose_keys` table on an isolated tablespace with a strict `wal_level = minimal` or separate ephemeral database with short-lived backup retention.
  2. **External Key Wrapping (Recommended for Production):** Each tenant KEK is stored in an external cloud KMS (AWS KMS, GCP Cloud KMS, Azure Key Vault). When a customer invokes erasure, if ultra-strict guarantees are required, purpose keys can be wrapped individually with KMS keys configured with automated cryptoperiod destruction.
  3. **30-Day Backup Expiry Rule:** Under the DPDP Act 2023, data erasure obligations permit reasonable operational lifecycles. All physical database backups and WAL archives must enforce automated 30-day cryptographic destruction.

### 2.5 Merkle Log Reload & Root Determinism
RFC 6962 Merkle log leaves ([`research/firewall/shredder.py:90`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/shredder.py#L90)) are hash-chained strictly in order:
$$\text{leaf\_hash} = \text{SHA-256}(0x00 \parallel \text{canonical\_json}(\text{event}))$$
On engine boot for a tenant:
```python
rows = db.query(
    select(merkle_log.c.leaf_hash)
    .where(merkle_log.c.tenant_id == tenant_id)
    .order_by(merkle_log.c.leaf_index.asc())
)
vault.log.leaves = [r.leaf_hash for r in rows]
# Root is computed dynamically from leaves
assert vault.log.root() == expected_persisted_root
```
Because the leaf order and canonical JSON formatting are invariant, root calculation across restarts is 100% deterministic.

---

## 3. Signing Keys & Verifiable Receipts

### 3.1 Tenant-Specific vs. Global Signing Keys
* **Recommendation: Tenant-Specific Signing Keys.**
* **Justification:**
  1. **Legal Accountability:** Under DPDP Rules 2025, the signature on an erasure receipt must bind the specific Data Fiduciary (the Bank), not a multi-tenant SaaS provider.
  2. **Blast Radius:** If Bank A rotates or revokes its signing key, Bank B's historical erasure receipts must remain completely unaffected.
  3. **Key Life-Cycle:** Key rotation is per-tenant, allowing individual banks to transition from Ed25519 to post-quantum algorithms on their own compliance schedules.

### 3.2 Signing Key Persistence
Store tenant keys in a secure table `tenant_signers`:
```sql
CREATE TABLE tenant_signers (
    tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    key_id VARCHAR(64) NOT NULL,
    alg VARCHAR(32) NOT NULL DEFAULT 'Ed25519+ML-DSA-65',
    encrypted_ed25519_key BYTEA NOT NULL,
    encrypted_mldsa_key BYTEA NOT NULL,
    public_ed25519_pem TEXT NOT NULL,
    public_mldsa_pem TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
Private signing keys are encrypted under `Tenant_KEK` using AES-256-GCM. Public verification keys are stored in plaintext PEM format for fast distribution.

### 3.3 Public Key Verification Endpoint
Expose an unauthenticated, cacheable endpoint:
`GET /api/v1/tenants/{tenant_id}/public-keys` or `GET /.well-known/aran-keys.json`:

```json
{
  "tenant_id": "bank-acme",
  "keys": [
    {
      "key_id": "key_2026_10_01",
      "alg": "Ed25519+ML-DSA-65",
      "status": "active",
      "public_key": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----\n",
      "pq_public_key": "-----BEGIN ML-DSA-65 PUBLIC KEY-----\nMIIC...-----END ML-DSA-65 PUBLIC KEY-----\n"
    }
  ]
}
```

### 3.4 Self-Contained Offline Receipt Verification
To allow auditors, courts, or customers to verify an erasure receipt without connecting to Aran's servers, the receipt issued by `POST /api/erase` ([`research/firewall/shredder.py:230`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/shredder.py#L230)) must carry:
1. `event`: Event metadata (`event`, `customer`, `purpose`, `tokens_unreadable`, `at`).
2. `leaf_index` and `tree_size`: Precise position in the tenant's transparency log.
3. `root`: Base64-encoded Merkle tree root.
4. `proof`: Ordered array of base64 hashes constructing the audit path.
5. `alg`: `"Ed25519+ML-DSA-65"`.
6. `key_id`: Identifier of the signing key.
7. `signature`: Ed25519 signature of the canonical root and body.
8. `pq_signature`: ML-DSA-65 post-quantum signature.
9. `public_key` & `pq_public_key`: Embedded PEM public keys.

Any third-party validator running `verify_receipt(receipt, require_pq=True)` executes offline verification in $<1\text{ ms}$.

---

## 4. Incremental 8-Day Migration Plan

Each phase is constrained to $\le 1$ engineering day. All 45 research tests and the 11-step smoke test must pass at the completion of each phase.

| Day | Focus | Files Touched | New Files | Tests Added | Risk / Fallback |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Day 1** | Database Layer & Core Schema | `app/server/requirements.txt` | `app/server/db.py`, `app/server/schema.py` | Connection & schema initialization tests | Low. Runs in parallel with RAM engine; no production traffic affected. |
| **Day 2** | API Key Auth & Demo Fallback | [`app/server/main.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py) | `app/server/auth.py` | Header auth, missing key, invalid key, demo fallback tests | Low. If `ARAN_REQUIRE_KEY` is unset, default `"demo"` tenant activates. |
| **Day 3** | Tenant-Scoped Engine Manager | [`app/server/main.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py), [`app/server/engine.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/engine.py) | `app/server/tenant_manager.py` | Multi-engine concurrency and shared model validation | Medium. Must ensure `Detector` pickle is referenced read-only. |
| **Day 4** | Purpose Key Envelope Encryption & Vault Persistence | [`research/firewall/shredder.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/shredder.py), [`app/server/engine.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/engine.py) | `app/server/kms.py` | Key envelope encryption, hard delete zeroing, token retrieval | High. Crypto-shredding must remain mathematically sound. |
| **Day 5** | Merkle Log Persistence & Deterministic Reload | [`research/firewall/shredder.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/shredder.py), [`app/server/engine.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/engine.py) | — | Restart root identity tests, inclusion proof reload | Medium. RFC 6962 tree hash invariants must not drift across restarts. |
| **Day 6** | Signing Key Persistence & Verification Endpoint | [`app/server/main.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py), [`research/pqc/hybrid.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/pqc/hybrid.py) | — | Key rotation, offline receipt verification against endpoint | Low. Receipts use standard Ed25519 + ML-DSA-65 format. |
| **Day 7** | Multi-Tenant Ledger & Standout Cleanup | [`app/server/standout.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/standout.py), [`research/firewall/ledger.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/research/firewall/ledger.py) | — | Cross-tenant ledger isolation tests | Medium. Refactoring module-level `LEDGER` dictionary. |
| **Day 8** | Smoke Test Suite Extensions & Final Audit | [`scripts/smoke_test.py`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/scripts/smoke_test.py) | `tests/test_saas_e2e.py` | 14-step E2E multi-tenant suite | Low. Verification and latency benchmark check. |

### Extensions Required in `scripts/smoke_test.py`
The smoke test must be extended from 11 to 14 steps:
* **Step 12 (Cross-Tenant Isolation):** Submit identical Aadhaar $X$ under Tenant A and Tenant B. Assert both issue tokens successfully without owner conflict. Erasing Tenant A must leave Tenant B's token completely readable.
* **Step 13 (Restart Durability Test):** Issue token and record Merkle root $\to$ kill and restart server process $\to$ assert Merkle root matches byte-for-byte and pre-restart token detokenizes successfully.
* **Step 14 (Key Rotation Test):** Rotate Tenant API key via admin token $\to$ assert old key yields HTTP 401 and new key yields HTTP 200.

---

## 5. Architectural Risks & Open Questions

### 5.1 Critical Risks in Current Codebase
1. **Module-Level Singletons in `app/server/standout.py`:**
   * Global `LEDGER = {}` ([`standout.py:205`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/standout.py#L205)) and `DOMAINS` combine all calls into a single in-memory min-entropy pool. This will leak disclosure history across tenants unless moved into `Engine`.
2. **Global Jobs Subprocess Spawner:**
   * `POST /api/jobs/{name}` ([`app/server/main.py:283`](file:///Users/snarunvijay/Documents/hackathons/Aran/Aran/app/server/main.py#L283)) spawns pytest directly in the server process environment. In multi-tenant SaaS, arbitrary test execution by one tenant could compromise the host container.
3. **Pickle Model Deserialization:**
   * `engine.py:88` unpickles `detector.pkl`. While safe when read from a trusted local path, multi-tenant per-tenant model customization must never allow unpickling untrusted model binaries.
4. **Latency Budget Degradation:**
   * Current in-memory median processing latency is $0.4\text{ ms}$. Network database roundtrips to remote PostgreSQL typically add $1.5\text{ to }3.0\text{ ms}$.
   * *Mitigation:* In-memory LRU write-through cache for `owner_index` and `purpose_keys`. Fast-path reads hit RAM; writes update cache and commit to PostgreSQL transactionally.

### 5.2 Architectural Decisions to Confirm Prior to Implementation
1. **Rate Limiting & Tier Enforcement:** Should tenant API keys enforce requests-per-minute (RPM) throttles at the API gateway layer, or should throttling be handled by an ingress reverse proxy (e.g. Envoy/Nginx)?
2. **Key Erasure Legal Audit:** Does the customer's legal team require KMS-backed key destruction, or does an encrypted hard-delete in PostgreSQL satisfy statutory DPDP erasure requirements?
3. **Joint Identifier Disambiguation:** In the event of shared identifiers between two customers in the same bank, should un-attributed requests default to vaultless FF1 tokens or return HTTP 422 demanding `customer_ref` disambiguation?

---

### Unverified Annotations
* *Unverified in current repository:* Automated database migration harnesses (`alembic`) are not yet present in `requirements.txt`.
* *Unverified in current repository:* KMS network latency metrics against real Indian cloud regions (e.g. AWS `ap-south-1` Mumbai) have not been empirically benchmarked against the $2.6\text{ ms}$ $p_{95}$ budget.

