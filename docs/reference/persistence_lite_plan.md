# Aran Core "Persistence Lite" Architectural Plan

> **Document Version:** 1.0.0  
> **Status:** Architecture & Design Specification (Awaiting Approval — No Code Implemented)  
> **Target Files:** `research/firewall/store.py` (new), `research/firewall/shredder.py`, `app/server/engine.py`, `app/server/main.py`  
> **Scope:** Minimal, robust, production-grade persistence for core cryptographic state.

---

## 1. Executive Summary & Design Scope

Aran currently operates with sub-millisecond in-memory data structures. While this delivers outstanding demo speed ($p_{50} \approx 0.4\text{ ms}$), all cryptographic state—customer purpose keys, vault tokens, the RFC 6962 Merkle audit log, and signing private keys—vanishes on process restart.

**Persistence Lite** bridges this gap without compromising performance or code simplicity:
- **Zero-Config In-Memory Fallback:** When `ARAN_STORE` is unset, the engine remains 100% in-memory. All 45 research tests and existing demo scripts run completely unmodified.
- **Strict Scope (Exactly 5 Items Persisted):**
  1. **Purpose Keys:** Encrypted at rest using AES-256-GCM under a Key-Encryption Key (KEK) derived from `ARAN_MASTER_KEY`.
  2. **Vault Tokens:** Token string, ciphertext, nonce, customer ref, purpose, sink, and timestamp.
  3. **Owner & Attribution Indexes:** Reverse lookup tables mapping HMACs to customer refs, token-to-sink attribution for forensic tracing, and customer profile registries.
  4. **Merkle Transparency Log:** Append-only log reloaded in exact sequential order, reconstructing the identical leaf count and Merkle root.
  5. **Hybrid Post-Quantum Signers:** Ed25519 and ML-DSA-65 private keys encrypted at rest, ensuring receipts issued before a restart remain verifiable forever.
- **Public Key Endpoint:** New `GET /api/public-keys` endpoint exposing Ed25519 and ML-DSA-65 public keys for independent offline auditor verification.
- **Storage Engine:** Python standard library `sqlite3` wrapped in a dedicated module (`research/firewall/store.py`), architected with clean SQL primitives so PostgreSQL can replace it in the future without changing engine logic.

---

## 2. Storage Architecture & Schema Design (`research/firewall/store.py`)

All database operations are encapsulated in `research/firewall/store.py`. No raw SQL strings or connection management logic will clutter `shredder.py` or `engine.py`.

### 2.1 SQLite Configuration & PRAGMAs
To guarantee ACID durability, sub-millisecond write latency, and cryptographic erasure safety, SQLite connections are configured with:
```sql
PRAGMA journal_mode = WAL;          -- High-concurrency Write-Ahead Logging
PRAGMA synchronous = NORMAL;        -- Fast fsync on checkpoints; durable in WAL
PRAGMA foreign_keys = ON;           -- Referential integrity
PRAGMA secure_delete = ON;          -- CRITICAL: Overwrite deleted pages with 0x00
PRAGMA busy_timeout = 5000;         -- 5-second lock timeout for concurrency
```

### 2.2 Relational Schema

```sql
-- 1. Keystore & Signers (Encrypted under Master KEK)
CREATE TABLE IF NOT EXISTS keystore (
    id TEXT PRIMARY KEY,                       -- e.g. 'primary_signer', 'ff1_key', 'index_key'
    key_type TEXT NOT NULL,                    -- 'hybrid_signer', 'raw_bytes'
    encrypted_key BLOB NOT NULL,               -- AES-256-GCM ciphertext
    nonce BLOB NOT NULL,                       -- 12-byte GCM nonce
    public_pem_ed25519 TEXT,                   -- Public key PEM (for verification)
    public_pem_mldsa TEXT,                     -- Public key PEM (for verification)
    created_at REAL NOT NULL
);

-- 2. Purpose Keys (Per Customer and Purpose)
CREATE TABLE IF NOT EXISTS purpose_keys (
    customer_ref TEXT NOT NULL,
    purpose TEXT NOT NULL,
    encrypted_key BLOB NOT NULL,               -- AES-256-GCM of the 256-bit purpose key
    nonce BLOB NOT NULL,                       -- 12-byte GCM nonce
    locked_until REAL,                         -- Retention lock timestamp (PMLA)
    created_at REAL NOT NULL,
    PRIMARY KEY (customer_ref, purpose)
);

-- 3. Customer Profile & Identifier Registry
CREATE TABLE IF NOT EXISTS customer_registry (
    customer_ref TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    upi TEXT,
    ids_json TEXT NOT NULL,                    -- Encrypted or masked ID metadata
    created_at REAL NOT NULL
);

-- 4. Owner Lookup Index (HMAC Hash -> Customer Ref)
CREATE TABLE IF NOT EXISTS owner_index (
    owner_hash BLOB PRIMARY KEY,               -- 32-byte HMAC(index_key, "own|typ|canonical")
    customer_ref TEXT NOT NULL
);

-- 5. Vault Tokens (Format-Preserving Token -> Ciphertext at Rest)
CREATE TABLE IF NOT EXISTS vault_tokens (
    token TEXT PRIMARY KEY,
    customer_ref TEXT NOT NULL,
    purpose TEXT NOT NULL,
    sink TEXT NOT NULL,
    id_type TEXT NOT NULL,
    nonce BLOB NOT NULL,                       -- 12-byte AES-GCM nonce
    ciphertext BLOB NOT NULL,                  -- AES-GCM encrypted raw value under purpose key
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_tokens_cust ON vault_tokens(customer_ref, purpose);

-- 6. Token-to-Sink Attribution Index (For Forensic Leak Tracing)
CREATE TABLE IF NOT EXISTS token_sink_index (
    token TEXT PRIMARY KEY,
    sink TEXT NOT NULL,
    created_at REAL NOT NULL
);

-- 7. RFC 6962 Merkle Transparency Log (Append-Only)
CREATE TABLE IF NOT EXISTS merkle_log (
    leaf_index INTEGER PRIMARY KEY,
    leaf_hash BLOB NOT NULL,                   -- SHA-256(0x00 || canonical_json)
    event_json TEXT NOT NULL,
    created_at REAL NOT NULL
);

-- 8. Erased Purposes & Cryptographic Receipts
CREATE TABLE IF NOT EXISTS erasure_receipts (
    customer_ref TEXT NOT NULL,
    purpose TEXT NOT NULL,
    receipt_json TEXT NOT NULL,                -- Full Ed25519 + ML-DSA-65 signed receipt
    erased_at REAL NOT NULL,
    PRIMARY KEY (customer_ref, purpose)
);
```

---

## 3. Cryptographic Key Hierarchy & Startup Protocols

```
                      [ Environment: ARAN_MASTER_KEY ]
                                    │
                                    ▼
                          [ HKDF-Expand-SHA256 ]
                    (Salt: b"aran-persistence-salt-v1")
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
[ Purpose KEK ]             [ Signer KEK ]              [ Index/FF1 KEK ]
(AES-256-GCM)               (AES-256-GCM)               (AES-256-GCM)
        │                           │                           │
        ▼                           ▼                           ▼
Encrypts customer           Encrypts Ed25519            Derives or encrypts
purpose keys at rest        & ML-DSA-65 private         the HMAC index_key
(in `purpose_keys`)         keys (in `keystore`)        and FF1 engine key
```

### 3.1 Startup Rules & Validation
1. **Persistent Mode (`ARAN_STORE` is set):**
   - Check `ARAN_MASTER_KEY`. If missing, empty, or shorter than 32 hex bytes, **abort immediately** with a fatal `RuntimeError`:
     `"ARAN_STORE is configured for persistence, but ARAN_MASTER_KEY is missing or invalid. Provide a 256-bit key (64 hex characters) to encrypt keys at rest."`
   - Test KEK validity against `keystore` (verify GCM tag). If invalid, abort with:
     `"Failed to decrypt keystore under provided ARAN_MASTER_KEY. Master key does not match existing database."`
2. **In-Memory Mode (`ARAN_STORE` is unset):**
   - Engine initializes 100% in volatile memory. No disk files created. `ARAN_MASTER_KEY` is not required. Current behavior remains 100% backwards-compatible.

---

## 4. Erasure Safety & The Backup Threat (Non-Negotiable Guarantees)

Erasure safety is the core cryptographic differentiator of Aran. Under DPDP Act 2023 Section 12, when a customer withdraws consent, data must be irrevocably unrecoverable.

### 4.1 Secure Deletion Mechanics
When `vault.erase(customer_ref, purpose)` is called:
1. **Atomic In-Memory Overwrite:** The volatile key bytearray in `self.keys` is zeroed in-place (`key[i] = 0`) before removal from memory.
2. **Database Row Deletion with `PRAGMA secure_delete=ON`:**
   ```sql
   DELETE FROM purpose_keys WHERE customer_ref = ? AND purpose = ?;
   ```
   SQLite's `secure_delete` guarantees that the database B-Tree page containing the deleted row is immediately overwritten with `0x00` bytes, rather than merely marked as unallocated free space.
3. **WAL Checkpoint and Truncation:**
   Because WAL mode writes changes to `.db-wal`, old page copies remain in the WAL file until checkpointed. The erase transaction is immediately followed by:
   ```sql
   PRAGMA wal_checkpoint(TRUNCATE);
   ```
   This flushes the zeroed page into the main `.db` file and truncates the WAL file to 0 bytes, ensuring no lingering key ciphertext exists in `.db-wal` or `.db-shm`.
4. **Receipt Persistence & "Erased" State Invariant:**
   In the same transaction, the signed erasure receipt is inserted into `erasure_receipts`. On any subsequent restart, the customer reads as **`"erased"`**, NEVER as `"unknown"`.

### 4.2 The Reality of Backups & Physical Storage (Honest Threat Model)
* **The Vulnerability:** If a system administrator makes a full database backup (file copy, snapshot, or tape archive) *prior* to an erasure, that historical backup still contains the encrypted purpose key. If an attacker later compromises both that historical backup and the `ARAN_MASTER_KEY`, they can reconstruct the customer's purpose key and decrypt the vault tokens!
* **Hardware Storage Limits:** Furthermore, modern NVMe/SSD controllers use wear-leveling (Flash Translation Layer), meaning overwritten logical blocks may physically persist in un-reclaimed flash blocks until garbage-collected by drive firmware (TRIM).

### 4.3 Mitigation Strategy: Architectural Key-Table Isolation (Selected & Justified)

Between the two proposed mitigations:
- *Option A:* No long-lived backups of the key table (Architectural Key Store Isolation).
- *Option B:* Per-key random wrapping values stored separately.

**Selected Approach: Option A — Architectural Key Store Isolation & Bounded WAL Retention.**

**Justification:**
1. **Directly Solves the Root Cause:** Cryptographic erasure fails if historical copies of keys are indefinitely archived. Option A mandates that the `purpose_keys` table resides in a physically separated SQLite database file (`aran_keys.db` or dedicated key partition) that is **explicitly excluded from long-term archival backups**.
2. **Separation of Concerns:** The main database (containing tokens, Merkle log, attribution indexes, and receipts) has zero raw PII and can be backed up to cold storage for 10 years for compliance audits. The key store, conversely, operates under a **strict 24-hour rolling retention policy with automated cryptographic expiry**.
3. **Operational Robustness:** Option B introduces distributed failure modes (synchronizing deletions across two databases or files without two-phase commit risks leaving dangling partial keys on system crash). Option A keeps transactions single-file, atomic, and regulatory-compliant.

---

## 5. Audit of In-Memory State & Singletons

Every stateful data structure in the Aran core was audited to determine whether it must persist or is safe to rebuild:

| Component | Location | Persistent in Lite? | Reason & Rebuild Strategy |
| :--- | :--- | :--- | :--- |
| **`PurposeVault.keys`** | `shredder.py:140` | **YES** | Encrypted under KEK in `purpose_keys`. Required for detokenisation. |
| **`PurposeVault.locks`** | `shredder.py:141` | **YES** | Persisted in `purpose_keys.locked_until`. Prevents bypassing PMLA retention. |
| **`PurposeVault.destroyed`** | `shredder.py:142` | **YES** | Persisted in `erasure_receipts`. Guarantees erased stays erased across reboot. |
| **`PurposeVault.owner`** | `shredder.py:143` | **YES** | Persisted in `owner_index`. Enforces first-owner-wins across restarts. |
| **`PurposeVault.vault`** | `shredder.py:144` | **YES** | Persisted in `vault_tokens`. Format-preserving tokens and ciphertexts. |
| **`PurposeVault.log`** | `shredder.py:145` | **YES** | Persisted in `merkle_log`. Rebuilds exact Merkle tree root and leaf hashes. |
| **`PurposeVault.sk` / `signer`** | `shredder.py:137` | **YES** | Persisted in `keystore`. Historical receipts must verify against public keys. |
| **`Engine.key` (FF1 Key)** | `engine.py:90` | **YES** | Persisted or derived from `ARAN_MASTER_KEY`. Needed to reverse/trace FF1 tokens. |
| **`Engine.fw.index`** | `engine.py:385` | **YES** | Persisted in `token_sink_index`. Required for leak trace sink attribution. |
| **`Engine.customers`** | `engine.py:103` | **YES** | Persisted in `customer_registry`. Rebuilds customer profiles on boot. |
| **`CustomerRegistry` (Cuckoo)** | `engine.py:91` | **REBUILT** | In-memory Cuckoo filter is rehydrated on boot from `customer_registry`. |
| **`OtpRegistry` (Cuckoo)** | `engine.py:92` | **NO** | Ephemeral by design (5-minute TTL). Safe to discard on restart. |
| **`Immune` Layer State** | `engine.py:111` | **NO** | Sliding window traffic counters (`cur`, `closed`). Resets safely on boot. |
| **`Engine.latency_ms` & `counts`** | `engine.py:107` | **NO** | Telemetry buffers for UI dashboard. Ephemeral in memory. |
| **`Engine.events` / `sink_store`** | `engine.py:105` | **NO** | Circular deques for live console inspection. Safe to reset. |
| **`LEDGER` Singleton** | `standout.py:205` | **NO** | Min-entropy domain tracker for partial masks. Highlighted for future phase. |

---

## 6. Public Key Exposure Specification

### `GET /api/public-keys`
Allows third-party compliance officers, customers, and auditors to verify post-quantum erasure receipts without access to server secrets.

**Response Schema (`200 OK`):**
```json
{
  "alg": "Ed25519+ML-DSA-65",
  "context": "aran-v2",
  "public_keys": {
    "ed25519": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9N1m...\n-----END PUBLIC KEY-----\n",
    "ml_dsa_65": "-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8A...\n-----END PUBLIC KEY-----\n"
  },
  "created_at": 1730278800.0,
  "key_id": "aran-signer-primary"
}
```

---

## 7. Performance Budget & Transaction Atomicity

### 7.1 Atomicity Boundary
Every tokenisation and erasure operation executes inside a single atomic SQLite transaction:
```python
with self.store.transaction():
    self.store.save_token(...)
    self.store.append_merkle_leaf(...)
    self.store.update_owner(...)
```
A crash at any instant will cleanly roll back; no token can exist without its key, and no receipt can exist without its Merkle leaf.

### 7.2 Performance Target ($< 3\text{ ms}$ Added Latency)
- **Baseline Memory Processing:** $p_{50} \approx 0.4\text{ ms}$, $p_{95} \approx 2.6\text{ ms}$.
- **Target with Persistence Lite:** $p_{50} < 2.5\text{ ms}$, $p_{95} < 5.5\text{ ms}$ ($< 3\text{ ms}$ overhead).
- **Optimization:** SQLite WAL mode with in-memory caching of decrypted purpose keys during active process lifetime prevents redundant disk reads and crypto-wrapping on every line of a batch.

---

## 8. Verification & Test Suite Plan (8 Required Tests)

The following tests will be implemented in `research/test_persistence.py`:

1. **`test_restart_persistence_keys_and_tokens`**:
   Enroll customer, tokenize Aadhaar/Card, write to store, terminate engine. Boot second engine with same store and KEK; verify detokenise returns exact plaintext.
2. **`test_receipt_issued_before_restart_verifies_after_restart`**:
   Issue erasure receipt on Run 1. Boot Run 2 with same store. Fetch public keys via `/api/public-keys` and verify receipt signature and Merkle inclusion proof.
3. **`test_merkle_root_identical_after_reload`**:
   Record 50 sequential events on Run 1. Measure root and leaf count. Reload Run 2; verify bitwise identical Merkle root and identical proof paths.
4. **`test_erased_stays_erased_after_restart`**:
   Erase KYC purpose for `CUST-001`. Reboot engine. Call `/api/detokenise` on the erased token; assert response status is `"erased"` with exact reason, NOT `"unknown"`.
5. **`test_wrong_or_missing_master_key_refuses_boot`**:
   - Assert engine boot fails with clear error if `ARAN_STORE` is set but `ARAN_MASTER_KEY` is missing.
   - Assert engine boot fails if restarted with an incorrect `ARAN_MASTER_KEY` (GCM authentication failure).
6. **`test_transaction_atomicity_and_crash_safety`**:
   Inject simulated failure mid-tokenisation; assert SQLite transaction rollback leaves zero orphaned tokens or corrupt Merkle states.
7. **`test_in_memory_mode_unmodified`**:
   Run with `ARAN_STORE` unset; assert zero disk files created and identical behavior across all 45 existing research tests.
8. **`test_performance_overhead_within_budget`**:
   Run 1,000 requests through `/api/process` with persistence ON vs OFF; verify measured added latency is under 3 ms.

---

## 9. File Modification Plan

1. **`research/firewall/store.py` (NEW FILE):**
   - SQLite schema initialization, connection management, WAL configuration, KEK envelope encryption/decryption, and atomic transaction methods.
2. **`research/firewall/shredder.py` (SURGICAL UPDATES):**
   - Accept optional `store` parameter in `PurposeVault`.
   - On `enroll()` / `tokenise()` / `erase()`: persist state through `store` if configured.
   - On `__init__()`: rehydrate keys, tokens, owner index, and Merkle leaves from `store`.
3. **`app/server/engine.py` (SURGICAL UPDATES):**
   - Initialize `store` from `ARAN_STORE` and `ARAN_MASTER_KEY`.
   - Rehydrate `self.customers` and `self.registry` from `store` on boot.
   - Persist token-to-sink mapping in `_IndexingFirewall`.
4. **`app/server/main.py` (MINIMAL UPDATES):**
   - Add `GET /api/public-keys` endpoint.
5. **`research/test_persistence.py` (NEW FILE):**
   - The 8 comprehensive integration and benchmark tests.

---

## 10. Operational Constraints & Concurrency Guarantees

- **One-Worker Requirement:** The Aran core engine MUST be executed with a single worker process (`uvicorn --workers 1`). While SQLite WAL mode supports high-performance concurrent readers and sequential writers within a process (using thread-safe mutexes), running multi-process workers on the same SQLite WAL file without distributed locking risks write contention, busy timeouts, and in-memory key cache incoherence.
- **Physical Separation:** `keys.db` (containing encrypted purpose keys and system keys) and `aran.db` (containing encrypted tokens, indexes, and logs) MUST maintain strict `0600` (`-rw-------`) file permissions.
- **Backup Policy Statement:** *"Erasure is bounded by the key-store backup policy; production uses KMS/HSM."*


