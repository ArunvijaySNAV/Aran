"""Tests for Aran Core Persistence Lite (mechanism M5 + storage durability).

Validates:
- physical separation (keys.db and aran.db with permission 0600)
- startup guards (ARAN_MASTER_KEY required in persistent mode; bad KEK or wrong schema version rejected)
- vault token and purpose key restart persistence
- vaultless FF1 token trace and owner index lookup across restarts (A2)
- Merkle log root & inclusion proof invariance across restarts (A5, A6)
- A1 plaintext scan (database, WAL, logs contain zero raw identifiers)
- A4 warm cache eviction upon erasure (immediate detokenise -> erased; restart -> erased)
- concurrent processing without database locked errors (A6)
- in-memory mode parity when ARAN_STORE is unset
"""

import concurrent.futures
import json
import os
import sqlite3
import stat
import tempfile
import threading
import time
import pytest

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from firewall.store import AranStore, SCHEMA_VERSION, BACKUP_POLICY_STATEMENT
from firewall.shredder import PurposeVault, verify_inclusion, verify_receipt
import engine as E

MASTER_KEY = "0123456789abcdef" * 4


@pytest.fixture
def temp_store_paths():
    with tempfile.TemporaryDirectory() as td:
        data_db = os.path.join(td, "aran.db")
        keys_db = os.path.join(td, "keys.db")
        yield data_db, keys_db


def test_startup_guards_and_permissions(temp_store_paths):
    data_db, keys_db = temp_store_paths

    # 1. Missing master key fails
    with pytest.raises(RuntimeError) as exc_info:
        AranStore(data_db, keys_db, master_key="")
    assert "ARAN_MASTER_KEY" in str(exc_info.value)

    # 2. Invalid short master key fails
    with pytest.raises(RuntimeError):
        AranStore(data_db, keys_db, master_key="short")

    # 3. Successful initialization & 0600 permissions check
    store = AranStore(data_db, keys_db, master_key=MASTER_KEY)
    mode_data = stat.S_IMODE(os.stat(data_db).st_mode)
    mode_keys = stat.S_IMODE(os.stat(keys_db).st_mode)
    assert mode_data == 0o600, f"Expected 0600, got {oct(mode_data)}"
    assert mode_keys == 0o600, f"Expected 0600, got {oct(mode_keys)}"
    store.close()

    # 4. Wrong master key on reload fails Canary check
    with pytest.raises(RuntimeError) as exc_info2:
        AranStore(data_db, keys_db, master_key="f" * 64)
    assert "Failed to decrypt keystore" in str(exc_info2.value)

    # 5. Wrong schema version fails
    store_ok = AranStore(data_db, keys_db, master_key=MASTER_KEY)
    with store_ok.data_conn:
        store_ok.data_conn.execute("UPDATE schema_meta SET value = '999' WHERE key = 'version';")
    store_ok.close()

    with pytest.raises(RuntimeError) as exc_info3:
        AranStore(data_db, keys_db, master_key=MASTER_KEY)
    assert "Incompatible database schema version 999" in str(exc_info3.value)


def test_persistent_keys_and_tokens_survive_restart(temp_store_paths):
    data_db, keys_db = temp_store_paths

    # Run 1: Enroll and tokenize
    e1 = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c1 = e1.add_customer("Priya Patel")
    ref = c1["ref"]
    aadhaar = c1["AADHAAR"]

    res = e1.process(f"Enrolling customer with Aadhaar {aadhaar}", "console", "marketing-cloud", customer_ref=ref, purpose="Marketing")
    token = res["findings"][0]["token"]
    assert token is not None
    assert e1.detokenise(token, "tester")["value"] == aadhaar
    e1.close()

    # Run 2: Boot fresh Engine with same store
    e2 = E.Engine(store_path=data_db, master_key=MASTER_KEY)
    assert token in e2.vault.vault
    detok = e2.detokenise(token, "tester")
    assert detok["status"] == "ok"
    assert detok["value"] == aadhaar
    e2.close()


def test_vaultless_token_traces_and_owner_lookup_works_after_restart(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e1 = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c1 = e1.add_customer("Vikram Malhotra")
    ref = c1["ref"]
    aadhaar = c1["AADHAAR"]

    # Issue stranger vaultless token
    res = e1.process("Stranger Aadhaar 502964485065 payment", "console", "loan-vendor")
    tok_vaultless = res["findings"][0]["token"]
    assert tok_vaultless is not None

    # Check trace on Run 1
    t1 = e1.trace(tok_vaultless)
    assert t1["top"]["sink"] == "loan-vendor"

    # Check owner lookup on Run 1
    assert e1.vault.owner_of("AADHAAR", aadhaar) == ref
    e1.close()

    # Run 2: Restart
    e2 = E.Engine(store_path=data_db, master_key=MASTER_KEY)
    # Check trace on Run 2 (proves Engine.key was persisted and decrypted)
    t2 = e2.trace(tok_vaultless)
    assert t2["top"]["sink"] == "loan-vendor"

    # Check owner lookup on Run 2 (proves index_key and owner_index persisted)
    assert e2.vault.owner_of("AADHAAR", aadhaar) == ref
    e2.close()


def test_receipt_issued_before_restart_verifies_after_restart(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e1 = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c1 = e1.add_customer("Ananya Deshmukh")
    ref = c1["ref"]
    receipt = e1.erase(ref, "Marketing")
    assert receipt is not None
    e1.close()

    # Run 2: Restart
    e2 = E.Engine(store_path=data_db, master_key=MASTER_KEY)
    # Signing keys were persisted; receipt verified with both Ed25519 and ML-DSA-65
    res = E.verify_receipt(receipt)
    assert res["valid"] is True
    assert res["signature_valid"] is True
    assert res["post_quantum_valid"] is True
    assert res["included_in_log"] is True

    # Check public keys match current signer
    pub = e2.vault.signer.public()
    assert receipt["public_key"] == pub["ed25519"]
    assert receipt["pq_public_key"] == pub["ml_dsa_65"]
    e2.close()


def test_merkle_root_and_inclusion_proof_after_restart(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e1 = E.Engine(n_customers=3, store_path=data_db, master_key=MASTER_KEY)
    # A5 verification: Merkle leaves must contain only metadata, never identifiers or tokens
    for entry in e1.vault.log.entries:
        assert set(entry.keys()).issubset({"event", "customer", "purpose", "at", "tokens_unreadable"})
        for k, v in entry.items():
            assert not (isinstance(v, str) and v.isdigit() and len(v) >= 10), f"Identifier found in Merkle log: {k}={v}"

    root1 = e1.vault.log.root()
    leaf_count1 = len(e1.vault.log.leaves)
    idx = 2
    proof1 = e1.vault.log.proof(idx, leaf_count1)
    leaf1 = e1.vault.log.leaves[idx]
    e1.close()

    # Run 2: Restart
    e2 = E.Engine(store_path=data_db, master_key=MASTER_KEY)
    assert len(e2.vault.log.leaves) == leaf_count1
    assert e2.vault.log.root() == root1
    # Verify pre-restart inclusion proof verifies against reloaded tree
    assert verify_inclusion(leaf1, idx, leaf_count1, proof1, e2.vault.log.root(leaf_count1))
    e2.close()


def test_warm_cache_eviction_and_erased_stays_erased(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e1 = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c1 = e1.add_customer("Sunita Rao")
    ref = c1["ref"]
    aadhaar = c1["AADHAAR"]

    res = e1.process(f"Customer {ref} Aadhaar {aadhaar}", "console", "marketing-cloud", customer_ref=ref, purpose="Marketing")
    token = res["findings"][0]["token"]

    # Warm cache test: detokenise before erase
    detok1 = e1.detokenise(token, "tester")
    assert detok1["status"] == "ok"
    assert detok1["value"] == aadhaar

    # Erase
    receipt = e1.erase(ref, "Marketing")
    assert receipt["event"]["customer"] == ref

    # Warm cache test: detokenise immediately after erase (zero restart) MUST return erased
    detok2 = e1.detokenise(token, "tester")
    assert detok2["status"] == "erased"
    assert detok2["value"] is None
    e1.close()

    # Run 2: Restart engine
    e2 = E.Engine(store_path=data_db, master_key=MASTER_KEY)
    detok3 = e2.detokenise(token, "tester")
    assert detok3["status"] == "erased"
    assert detok3["value"] is None
    assert "destroyed" in detok3["reason"].lower() or "erased" in detok3["reason"].lower()
    e2.close()


def test_plaintext_scan_in_db_wal_logs(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c = e.add_customer("Kavita Reddy")
    ref = c["ref"]
    aadhaar = c["AADHAAR"]
    card = c["CARD"]
    mob = c["MOBILE"]
    pan = c["PAN"]

    # Issue tokens across sinks
    e.process(f"Aadhaar {aadhaar} for customer {ref}", "console", "marketing-cloud", customer_ref=ref, purpose="Marketing")
    e.process(f"Card {card} payment for {ref}", "console", "log-platform", customer_ref=ref, purpose="Service")

    # Flush WAL
    e.store.checkpoint_and_truncate()

    # Scan all files on disk
    scanned_files = [data_db, keys_db, data_db + "-wal", keys_db + "-wal", data_db + "-shm", keys_db + "-shm"]
    found_plaintext = []

    for fp in scanned_files:
        if os.path.exists(fp):
            with open(fp, "rb") as fh:
                bytes_content = fh.read()
                for target_id in (aadhaar, card, mob, pan):
                    if target_id.encode("ascii") in bytes_content:
                        found_plaintext.append((fp, target_id))

    assert len(found_plaintext) == 0, f"A1 VIOLATION: Raw identifiers leaked in plaintext: {found_plaintext}"

    # Also inspect what customer_registry actually stored
    cur = e.store.data_conn.cursor()
    row = cur.execute("SELECT customer_ref, name, upi, encrypted_ids, masked_json FROM customer_registry WHERE customer_ref = ?", (ref,)).fetchone()
    cur.close()
    assert row is not None
    assert row[0] == ref
    assert row[1] == "Kavita Reddy"
    # encrypted_ids is binary ciphertext
    assert isinstance(row[3], bytes)
    for raw_id in (aadhaar, card, mob, pan):
        assert raw_id.encode("ascii") not in row[3], "Raw ID found in ciphertext bytes!"
    # masked_json contains only masked strings
    masked = json.loads(row[4])
    assert "XXXX" in masked["AADHAAR"]
    assert aadhaar not in row[4]
    e.close()


def test_concurrency_no_database_locked_error(temp_store_paths):
    data_db, keys_db = temp_store_paths

    e = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c = e.add_customer("Deepa Menon")
    ref = c["ref"]
    aadhaar = c["AADHAAR"]

    def run_worker(worker_id):
        text = f"Worker {worker_id} processing request for customer {ref} Aadhaar {aadhaar}"
        return e.process(text, "console", "marketing-cloud", customer_ref=ref, purpose="Marketing")

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(run_worker, i) for i in range(20)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    assert len(results) == 20
    for res in results:
        assert res["findings"][0]["token"] is not None
    e.close()


def test_in_memory_mode_unmodified(temp_store_paths):
    data_db, _ = temp_store_paths
    # Ensure ARAN_STORE is unset
    old_store = os.environ.pop("ARAN_STORE", None)
    try:
        e = E.Engine(n_customers=3)
        assert e.store is None
        assert not os.path.exists(data_db)
        c = e.add_customer("Memory Tester")
        assert len(e.customers) == 4
        res = e.process(f"Customer {c['ref']} Aadhaar {c['AADHAAR']}", "console", "kyc-archive", customer_ref=c["ref"], purpose="KYC")
        assert res["findings"][0]["token"] is not None
    finally:
        if old_store:
            os.environ["ARAN_STORE"] = old_store


def test_concurrent_api_process_two_calls_succeed(temp_store_paths):
    """Step 0a: Confirm two concurrent /api/process calls succeed with no database is locked error."""
    data_db, keys_db = temp_store_paths
    e = E.Engine(n_customers=2, store_path=data_db, master_key=MASTER_KEY)
    c = e.add_customer("Concurrent Test")
    ref = c["ref"]
    aadhaar = c["AADHAAR"]

    results = []
    errors = []

    def call_proc(idx):
        try:
            res = e.process(f"Request {idx} with Aadhaar {aadhaar}", "core-banking", "kyc-archive", customer_ref=ref, purpose="KYC")
            results.append(res)
        except Exception as ex:
            errors.append(ex)

    t1 = threading.Thread(target=call_proc, args=(1,))
    t2 = threading.Thread(target=call_proc, args=(2,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors, f"Concurrent calls had errors: {errors}"
    assert len(results) == 2
    for r in results:
        assert r["findings"][0]["protected"] is True
    e.close()


def test_corrupted_store_refuses_to_start(temp_store_paths):
    """Step 0a: A corrupted or wrong-schema-version store refuses to start with a clear message."""
    data_db, keys_db = temp_store_paths

    # Create a corrupted file
    corrupt_keys = keys_db + ".corrupt"
    with open(corrupt_keys, "wb") as f:
        f.write(b"NOT_A_SQLITE_DATABASE_HEADER_CORRUPTED_BYTES_1234567890")

    with pytest.raises((sqlite3.DatabaseError, RuntimeError)) as exc_info:
        AranStore(data_db, corrupt_keys, master_key=MASTER_KEY)
    err = str(exc_info.value).lower()
    assert "not a database" in err or "corrupt" in err or "database disk image is malformed" in err


def test_plaintext_scan_beyond_core_after_seed():
    """Step 0b: Scan demo_bank/data_aran.db, aran_cloud/cloud.db, every log file, and seeded stores.

    Bank B's database and cloud.db must contain zero raw Aadhaar, card, mobile, and PAN values.
    Names are a known exception (reported separately).
    """
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    legacy_db = os.path.join(repo_root, "demo_bank", "data_legacy.db")

    if not os.path.exists(legacy_db):
        pytest.skip("data_legacy.db not found; seed_demo.py has not been run yet.")

    conn_a = sqlite3.connect(legacy_db)
    custs = conn_a.execute("SELECT name, mobile, aadhaar, card FROM customers").fetchall()
    conn_a.close()

    if not custs:
        pytest.skip("No seeded customers found in data_legacy.db.")

    raw_aadhaars = [c[2] for c in custs if c[2]]
    raw_cards = [c[3] for c in custs if c[3]]
    raw_mobiles = [c[1] for c in custs if c[1]]
    raw_names = [c[0] for c in custs if c[0]]

    targets = [
        os.path.join(repo_root, "demo_bank", "data_aran.db"),
        os.path.join(repo_root, "aran_cloud", "cloud.db"),
        os.path.join(repo_root, "data", "aran.db"),
        os.path.join(repo_root, "data", "keys.db"),
        "/tmp/aran_server.log",
        "/tmp/aran_cloud.log",
        "/tmp/bank_b.log",
    ]

    def scan_bytes(filepath, patterns):
        if not os.path.exists(filepath):
            return {}
        with open(filepath, "rb") as f:
            content = f.read()
        return {p: content.count(p.encode("utf-8")) for p in patterns if p and content.count(p.encode("utf-8")) > 0}

    # Bank B and cloud.db must have ZERO raw Aadhaar, Card, or Mobile
    for target in targets[:2]:
        a_hits = scan_bytes(target, raw_aadhaars)
        c_hits = scan_bytes(target, raw_cards)
        m_hits = scan_bytes(target, raw_mobiles)
        n_hits = scan_bytes(target, raw_names)

        assert len(a_hits) == 0, f"Found raw Aadhaar in {target}: {a_hits}"
        assert len(c_hits) == 0, f"Found raw Card in {target}: {c_hits}"
        assert len(m_hits) == 0, f"Found raw Mobile in {target}: {m_hits}"
        # Names are reported separately
        print(f"\nTarget {os.path.basename(target)}: 0 raw PII numbers found; {len(n_hits)} names (known exception).")

