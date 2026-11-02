# Deployment Guide: Aran Architecture

This guide details running the complete Aran stack:
1. **Aran Core Engine** (Data-flow firewall with cryptographic persistence and post-quantum Merkle receipts)
2. **Aran Cloud** (Multi-tenant SaaS proxy with scoped API keys, audit logging, and namespaces)
3. **Heritage Co-operative Bank A** (Legacy unprotected mock banking portal)
4. **Heritage Co-operative Bank B** (Aran-connected protected mock banking portal)

---

## 1. Quickstart with Docker Compose

To start all 4 services in containers:

```bash
# 1. Ensure master key and internal secret are generated (mode 600)
./scripts/run_demo.sh  # Generates .env.local if missing

# 2. Launch container stack
docker compose up -d
```

### Published Ports & Network Topology
- **Aran Core (`core`)**: Internal network only (`aran-net`). **Not published to the host.** The core is locked down and reachable only by authorized services possessing the shared `X-Aran-Internal` secret.
- **Aran Cloud (`cloud`)**: Published at `http://127.0.0.1:8100` (Public SaaS entry point).
- **Bank A (`bank-a`)**: Published at `http://127.0.0.1:9001`.
- **Bank B (`bank-b`)**: Published at `http://127.0.0.1:9002`.

### Worker Concurrency Requirement
> [!IMPORTANT]
> The core server requires `--workers 1`.
> SQLite WAL mode allows multiple concurrent readers, but cryptographic state persistence (Merkle append-log, vault tokens, and purpose keys) requires a single write thread to prevent database locks.

---

## 2. Cryptographic Key Management & Backups

In Persistence Lite, cryptographic state is separated physically across two SQLite stores:
- `data/keys.db`: Stores purpose keys, FF1 master key, owner HMAC key, and ML-DSA-65/Ed25519 signing keys, all encrypted at rest under the Key Encryption Key (KEK).
- `data/aran.db`: Stores vault tokens, HMAC owner index, and the Merkle append-only tree.

### Key Encryption Key (KEK)
The KEK is supplied through the environment variable `ARAN_MASTER_KEY` in `.env.local`:

```bash
# Verify permissions on the local key file (MUST be mode 600)
chmod 600 .env.local
ls -la .env.local
# Expected: -rw-------  1 user  group  .env.local
```

### Production Security Model
In production the key store is a KMS or HSM.
Local `.env.local` files and file-based KEKs are intended for air-gapped evaluation and development environments only. For enterprise banking production deployments, the KEK and internal secrets reside within a FIPS 140-2 Level 3 Hardware Security Module (HSM) or cloud KMS (AWS KMS, Google Cloud KMS, Azure Key Vault).

### Backing Up the Master Key
To back up the master key securely:
```bash
# Export the key to a secure encrypted backup location outside the repository
gpg --symmetric --cipher-algo AES256 < .env.local > /secure/offline/backup/aran_master_key.gpg
```

---

## 3. Environment Reset & Clean Slate

To completely wipe all persistent databases, reset rate limiter states, and restart fresh:

```bash
# Using Docker Compose:
docker compose down -v

# Using Local Process Daemon:
./scripts/reset_demo.sh
```

`reset_demo.sh` safely terminates lingering listeners on ports 8000, 8100, 9001, and 9002, flushes in-memory rate limiter queues, and removes test SQLite database files while keeping the master encryption key intact.

---

## 4. Verification and Healthchecks

Every container defines an automated `HEALTHCHECK`:
- Core: `curl -f http://localhost:8000/api/health`
- Cloud: `curl -f http://localhost:8100/v1/health`
- Bank A: `curl -f http://localhost:9001/api/config`
- Bank B: `curl -f http://localhost:9002/api/config`

To run the unified verification suite across all components, execute:
```bash
./scripts/preflight.sh
```

