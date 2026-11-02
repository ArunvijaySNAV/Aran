"""Aran Core Persistence Lite Storage Module.

Handles physical storage separation:
- keys.db: Purpose keys, FF1 master key, HMAC owner-index key, and signing keys (all encrypted at rest under KEK).
- aran.db: Vault tokens, Merkle log, owner index, token-to-sink index, customer registry (encrypted under KYC key), and receipts.

Features:
- PRAGMA secure_delete = ON for zeroing overwritten pages.
- WAL mode with checkpoint(TRUNCATE).
- Permissions enforced to 0600 on file creation.
- Strict startup guards for missing or invalid ARAN_MASTER_KEY.
- Atomic operations and schema version verification.
"""

import base64
import functools
import json
import os
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SCHEMA_VERSION = 1
BACKUP_POLICY_STATEMENT = "Erasure is bounded by the key-store backup policy; production uses KMS/HSM."


def synchronized(method):
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            if getattr(self, "_closed", False) and method.__name__ != "close":
                if method.__name__.startswith("load_"):
                    if "all" in method.__name__ or "log" in method.__name__:
                        return [] if "log" in method.__name__ else {}
                    return None
                return None
            return method(self, *args, **kwargs)
    return wrapper


def _derive_kek(master_key_bytes: bytes, info: bytes) -> bytes:
    """Derives a sub-key from master key using HKDF-SHA256."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"aran-persistence-salt-v1",
        info=info,
    )
    return hkdf.derive(master_key_bytes)


def parse_master_key(raw_key: Any) -> bytes:
    """Parses master key from hex, base64, or raw bytes into 32 bytes."""
    if not raw_key:
        raise RuntimeError(
            "ARAN_STORE is configured for persistence, but ARAN_MASTER_KEY environment "
            "variable is missing or empty. A 256-bit key (64 hex characters or 32 raw bytes) "
            "is required to encrypt keys at rest."
        )

    if isinstance(raw_key, bytes):
        if len(raw_key) == 32:
            return raw_key
        try:
            decoded = bytes.fromhex(raw_key.decode("ascii", errors="ignore").strip())
            if len(decoded) == 32:
                return decoded
        except Exception:
            pass
        raise RuntimeError("ARAN_MASTER_KEY bytes must be exactly 32 bytes long.")

    if isinstance(raw_key, str):
        cleaned = raw_key.strip()
        if len(cleaned) == 64:
            try:
                k = bytes.fromhex(cleaned)
                if len(k) == 32:
                    return k
            except Exception:
                pass
        # Try base64
        try:
            k = base64.b64decode(cleaned.encode("ascii"))
            if len(k) == 32:
                return k
        except Exception:
            pass

    raise RuntimeError(
        "ARAN_MASTER_KEY is invalid. It must be a 64-character hex string (32 bytes) or base64 equivalent."
    )


def _ensure_file_permissions(filepath: str) -> None:
    """Ensures file is created with 0600 (-rw-------) permissions."""
    parent = os.path.dirname(os.path.abspath(filepath))
    os.makedirs(parent, exist_ok=True)
    if not os.path.exists(filepath):
        fd = os.open(filepath, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
    else:
        try:
            os.chmod(filepath, 0o600)
        except OSError:
            pass


class AranStore:
    """Physical dual-file SQLite persistence engine for Aran core."""

    def __init__(self, data_path: str, keys_path: Optional[str] = None, master_key: Any = None):
        if not data_path:
            raise ValueError("data_path is required for AranStore.")

        self.data_path = os.path.abspath(data_path)
        if keys_path:
            self.keys_path = os.path.abspath(keys_path)
        else:
            self.keys_path = os.path.join(os.path.dirname(self.data_path), "keys.db")

        # Parse master key and derive sub-KEKs
        self.master_key = parse_master_key(master_key)
        self.purpose_kek = _derive_kek(self.master_key, b"purpose-key-wrap")
        self.signer_kek = _derive_kek(self.master_key, b"signer-key-wrap")
        self.system_kek = _derive_kek(self.master_key, b"system-key-wrap")

        # Ensure permissions (0600)
        _ensure_file_permissions(self.data_path)
        _ensure_file_permissions(self.keys_path)

        # Thread synchronization
        self._lock = threading.RLock()
        self._closed = False

        # Open connections
        self.data_conn = sqlite3.connect(self.data_path, check_same_thread=False)
        self.keys_conn = sqlite3.connect(self.keys_path, check_same_thread=False)

        # Configure PRAGMAs
        self._init_pragmas(self.data_conn)
        self._init_pragmas(self.keys_conn)

        # Initialize schema & version check
        self._init_schema()

    def _init_pragmas(self, conn: sqlite3.Connection) -> None:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA secure_delete = ON;")
        conn.execute("PRAGMA busy_timeout = 5000;")

    def _init_schema(self) -> None:
        # Schema version check in data_db
        with self.data_conn:
            self.data_conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            )
        cur = self.data_conn.cursor()
        row = cur.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()
        cur.close()
        self.data_conn.commit()

        if row:
            ver = int(row[0])
            if ver != SCHEMA_VERSION:
                raise RuntimeError(
                    f"Incompatible database schema version {ver}; expected {SCHEMA_VERSION}. "
                    "Corrupted or wrong-schema-version store refuses to start."
                )
        else:
            with self.data_conn:
                self.data_conn.execute(
                    "INSERT INTO schema_meta (key, value) VALUES ('version', ?);",
                    (str(SCHEMA_VERSION),)
                )

        # Schema version check in keys_db
        with self.keys_conn:
            self.keys_conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            )
        cur = self.keys_conn.cursor()
        row = cur.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()
        cur.close()
        self.keys_conn.commit()

        if row:
            ver = int(row[0])
            if ver != SCHEMA_VERSION:
                raise RuntimeError(
                    f"Incompatible keys database schema version {ver}; expected {SCHEMA_VERSION}. "
                    "Corrupted or wrong-schema-version store refuses to start."
                )
        else:
            with self.keys_conn:
                self.keys_conn.execute(
                    "INSERT INTO schema_meta (key, value) VALUES ('version', ?);",
                    (str(SCHEMA_VERSION),)
                )

        # Create tables in keys_db
        with self.keys_conn:
            self.keys_conn.execute("""
            CREATE TABLE IF NOT EXISTS keystore (
                id TEXT PRIMARY KEY,
                key_type TEXT NOT NULL,
                encrypted_key BLOB NOT NULL,
                nonce BLOB NOT NULL,
                public_pem_ed25519 TEXT,
                public_pem_mldsa TEXT,
                created_at REAL NOT NULL
            );
            """)
            self.keys_conn.execute("""
            CREATE TABLE IF NOT EXISTS purpose_keys (
                customer_ref TEXT NOT NULL,
                purpose TEXT NOT NULL,
                encrypted_key BLOB NOT NULL,
                nonce BLOB NOT NULL,
                locked_until REAL,
                created_at REAL NOT NULL,
                PRIMARY KEY (customer_ref, purpose)
            );
            """)

        # Create tables in data_db
        with self.data_conn:
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS customer_registry (
                customer_ref TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                upi TEXT,
                encrypted_ids BLOB NOT NULL,
                nonce BLOB NOT NULL,
                masked_json TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """)
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS owner_index (
                owner_hash BLOB PRIMARY KEY,
                customer_ref TEXT NOT NULL
            );
            """)
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS vault_tokens (
                token TEXT PRIMARY KEY,
                customer_ref TEXT NOT NULL,
                purpose TEXT NOT NULL,
                sink TEXT NOT NULL,
                id_type TEXT NOT NULL,
                nonce BLOB NOT NULL,
                ciphertext BLOB NOT NULL,
                created_at REAL NOT NULL
            );
            """)
            self.data_conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_vault_tokens_cust ON vault_tokens(customer_ref, purpose);"
            )
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS token_sink_index (
                token TEXT PRIMARY KEY,
                sink TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """)
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS merkle_log (
                leaf_index INTEGER PRIMARY KEY,
                leaf_hash BLOB NOT NULL,
                event_json TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """)
            self.data_conn.execute("""
            CREATE TABLE IF NOT EXISTS erasure_receipts (
                customer_ref TEXT NOT NULL,
                purpose TEXT NOT NULL,
                receipt_json TEXT NOT NULL,
                erased_at REAL NOT NULL,
                PRIMARY KEY (customer_ref, purpose)
            );
            """)

        # Verify or write Canary in keys_db to validate ARAN_MASTER_KEY
        self._verify_or_create_canary()

    def _verify_or_create_canary(self) -> None:
        canary_bytes = b"aran-canary-v1"
        cur = self.keys_conn.cursor()
        row = cur.execute(
            "SELECT encrypted_key, nonce FROM keystore WHERE id = '__canary__'"
        ).fetchone()
        cur.close()
        self.keys_conn.commit()

        if row:
            enc, nonce = row[0], row[1]
            try:
                dec = AESGCM(self.system_kek).decrypt(nonce, enc, b"canary")
                if dec != canary_bytes:
                    raise RuntimeError("Canary validation failed: master key mismatch.")
            except InvalidTag:
                raise RuntimeError(
                    "Failed to decrypt keystore under provided ARAN_MASTER_KEY. "
                    "Decryption tag mismatch: invalid master key."
                )
        else:
            nonce = os.urandom(12)
            enc = AESGCM(self.system_kek).encrypt(nonce, canary_bytes, b"canary")
            with self.keys_conn:
                self.keys_conn.execute(
                    "INSERT INTO keystore (id, key_type, encrypted_key, nonce, created_at) "
                    "VALUES ('__canary__', 'canary', ?, ?, ?);",
                    (enc, nonce, time.time())
                )

    # ---------------------------------------------------------------- Keystore
    @synchronized
    def save_system_key(self, key_id: str, raw_key: bytes) -> None:
        """Encrypts and saves a 32-byte master/HMAC key (e.g. ff1_key, index_key)."""
        nonce = os.urandom(12)
        enc = AESGCM(self.system_kek).encrypt(nonce, raw_key, key_id.encode())
        with self.keys_conn:
            self.keys_conn.execute(
                "INSERT INTO keystore (id, key_type, encrypted_key, nonce, created_at) "
                "VALUES (?, 'raw_bytes', ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key, nonce=excluded.nonce;",
                (key_id, enc, nonce, time.time())
            )

    @synchronized
    def load_system_key(self, key_id: str) -> Optional[bytes]:
        """Loads and decrypts a system key."""
        cur = self.keys_conn.cursor()
        row = cur.execute(
            "SELECT encrypted_key, nonce FROM keystore WHERE id = ?", (key_id,)
        ).fetchone()
        cur.close()
        self.keys_conn.commit()
        if not row:
            return None
        enc, nonce = row[0], row[1]
        try:
            return AESGCM(self.system_kek).decrypt(nonce, enc, key_id.encode())
        except InvalidTag:
            raise RuntimeError(f"Corrupted or untrusted system key '{key_id}'. Decryption tag failed.")

    @synchronized
    def save_hybrid_signer(
        self,
        key_id: str,
        ed_priv_bytes: bytes,
        ml_priv_bytes: bytes,
        ed_pub_pem: str,
        ml_pub_pem: str,
    ) -> None:
        """Saves Ed25519 and ML-DSA-65 private keys encrypted at rest under signer_kek."""
        payload = json.dumps({
            "ed": base64.b64encode(ed_priv_bytes).decode("ascii"),
            "ml": base64.b64encode(ml_priv_bytes).decode("ascii"),
        }).encode("utf-8")
        nonce = os.urandom(12)
        enc = AESGCM(self.signer_kek).encrypt(nonce, payload, key_id.encode())
        with self.keys_conn:
            self.keys_conn.execute(
                "INSERT INTO keystore (id, key_type, encrypted_key, nonce, public_pem_ed25519, public_pem_mldsa, created_at) "
                "VALUES (?, 'hybrid_signer', ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key, nonce=excluded.nonce, "
                "public_pem_ed25519=excluded.public_pem_ed25519, public_pem_mldsa=excluded.public_pem_mldsa;",
                (key_id, enc, nonce, ed_pub_pem, ml_pub_pem, time.time())
            )

    @synchronized
    def load_hybrid_signer(self, key_id: str) -> Optional[Tuple[bytes, bytes, str, str]]:
        """Loads and decrypts Ed25519 and ML-DSA-65 signer keys."""
        cur = self.keys_conn.cursor()
        row = cur.execute(
            "SELECT encrypted_key, nonce, public_pem_ed25519, public_pem_mldsa FROM keystore WHERE id = ?",
            (key_id,)
        ).fetchone()
        cur.close()
        self.keys_conn.commit()
        if not row:
            return None
        enc, nonce, ed_pub, ml_pub = row[0], row[1], row[2], row[3]
        try:
            payload_bytes = AESGCM(self.signer_kek).decrypt(nonce, enc, key_id.encode())
            data = json.loads(payload_bytes.decode("utf-8"))
            ed_priv = base64.b64decode(data["ed"])
            ml_priv = base64.b64decode(data["ml"])
            return ed_priv, ml_priv, ed_pub, ml_pub
        except InvalidTag:
            raise RuntimeError(f"Corrupted or untrusted signer key '{key_id}'. Decryption tag failed.")

    # ---------------------------------------------------------------- Purpose Keys
    @synchronized
    def save_purpose_key(
        self,
        customer_ref: str,
        purpose: str,
        raw_key: bytes,
        locked_until: Optional[float] = None,
    ) -> None:
        """Encrypts a customer's purpose key under purpose_kek and stores in keys.db."""
        nonce = os.urandom(12)
        aad = f"{customer_ref}|{purpose}".encode("utf-8")
        enc = AESGCM(self.purpose_kek).encrypt(nonce, raw_key, aad)
        with self.keys_conn:
            self.keys_conn.execute(
                "INSERT INTO purpose_keys (customer_ref, purpose, encrypted_key, nonce, locked_until, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(customer_ref, purpose) DO UPDATE SET encrypted_key=excluded.encrypted_key, "
                "nonce=excluded.nonce, locked_until=excluded.locked_until;",
                (customer_ref, purpose, enc, nonce, locked_until, time.time())
            )

    @synchronized
    def load_all_purpose_keys(self) -> Dict[Tuple[str, str], Dict[str, Any]]:
        """Loads and decrypts all alive purpose keys."""
        cur = self.keys_conn.cursor()
        rows = cur.execute(
            "SELECT customer_ref, purpose, encrypted_key, nonce, locked_until FROM purpose_keys"
        ).fetchall()
        cur.close()
        self.keys_conn.commit()
        out = {}
        for r in rows:
            cust, purp, enc, nonce, locked = r[0], r[1], r[2], r[3], r[4]
            aad = f"{cust}|{purp}".encode("utf-8")
            try:
                dec = AESGCM(self.purpose_kek).decrypt(nonce, enc, aad)
                out[(cust, purp)] = {
                    "key": bytearray(dec),
                    "locked_until": locked,
                }
            except InvalidTag:
                raise RuntimeError(f"Decryption failed for purpose key ({cust}, {purp}). Tag mismatch.")
        return out

    @synchronized
    def delete_purpose_key(self, customer_ref: str, purpose: str) -> bool:
        """Securely deletes a purpose key row from keys.db."""
        with self.keys_conn:
            cur = self.keys_conn.execute(
                "DELETE FROM purpose_keys WHERE customer_ref = ? AND purpose = ?",
                (customer_ref, purpose)
            )
            return cur.rowcount > 0

    # ---------------------------------------------------------------- Vault Tokens
    @synchronized
    def save_vault_token(
        self,
        token: str,
        customer_ref: str,
        purpose: str,
        sink: str,
        id_type: str,
        nonce: bytes,
        ciphertext: bytes,
        created_at: Optional[float] = None,
    ) -> None:
        """Stores encrypted vault token metadata in data_db."""
        at = created_at or time.time()
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO vault_tokens (token, customer_ref, purpose, sink, id_type, nonce, ciphertext, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(token) DO UPDATE SET customer_ref=excluded.customer_ref, purpose=excluded.purpose, "
                "sink=excluded.sink, id_type=excluded.id_type, nonce=excluded.nonce, ciphertext=excluded.ciphertext;",
                (token, customer_ref, purpose, sink, id_type, nonce, ciphertext, at)
            )

    @synchronized
    def load_all_vault_tokens(self) -> Dict[str, Dict[str, Any]]:
        """Loads all vault tokens from data_db."""
        cur = self.data_conn.cursor()
        rows = cur.execute(
            "SELECT token, customer_ref, purpose, sink, id_type, nonce, ciphertext, created_at FROM vault_tokens"
        ).fetchall()
        cur.close()
        self.data_conn.commit()
        out = {}
        for r in rows:
            out[r[0]] = {
                "customer": r[1],
                "purpose": r[2],
                "sink": r[3],
                "type": r[4],
                "nonce": r[5],
                "ct": r[6],
                "at": r[7],
            }
        return out

    # ---------------------------------------------------------------- Owner Index
    @synchronized
    def save_owner(self, owner_hash: bytes, customer_ref: str) -> None:
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO owner_index (owner_hash, customer_ref) VALUES (?, ?) "
                "ON CONFLICT(owner_hash) DO UPDATE SET customer_ref=excluded.customer_ref;",
                (owner_hash, customer_ref)
            )

    @synchronized
    def load_all_owners(self) -> Dict[bytes, str]:
        cur = self.data_conn.cursor()
        rows = cur.execute("SELECT owner_hash, customer_ref FROM owner_index").fetchall()
        cur.close()
        self.data_conn.commit()
        return {r[0]: r[1] for r in rows}

    # ---------------------------------------------------------------- Token Sink Index
    @synchronized
    def save_token_sink(self, token: str, sink: str) -> None:
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO token_sink_index (token, sink, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(token) DO UPDATE SET sink=excluded.sink;",
                (token, sink, time.time())
            )

    @synchronized
    def load_all_token_sinks(self) -> Dict[str, str]:
        cur = self.data_conn.cursor()
        rows = cur.execute("SELECT token, sink FROM token_sink_index").fetchall()
        cur.close()
        self.data_conn.commit()
        return {r[0]: r[1] for r in rows}

    # ---------------------------------------------------------------- Merkle Log
    @synchronized
    def append_merkle_leaf(self, leaf_index: int, leaf_hash: bytes, event: Dict[str, Any]) -> None:
        event_json = json.dumps(event, sort_keys=True, separators=(",", ":"))
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO merkle_log (leaf_index, leaf_hash, event_json, created_at) "
                "VALUES (?, ?, ?, ?);",
                (leaf_index, leaf_hash, event_json, time.time())
            )

    @synchronized
    def load_merkle_log(self) -> List[Tuple[int, bytes, Dict[str, Any]]]:
        """Loads Merkle log ordered strictly by leaf_index ascending."""
        cur = self.data_conn.cursor()
        rows = cur.execute(
            "SELECT leaf_index, leaf_hash, event_json FROM merkle_log ORDER BY leaf_index ASC"
        ).fetchall()
        cur.close()
        self.data_conn.commit()
        out = []
        for r in rows:
            out.append((r[0], r[1], json.loads(r[2])))
        return out

    # ---------------------------------------------------------------- Customer Registry (A1)
    @synchronized
    def save_customer_profile(
        self,
        customer_ref: str,
        name: str,
        upi: Optional[str],
        encrypted_ids: bytes,
        nonce: bytes,
        masked_json: str,
        created_at: Optional[float] = None,
    ) -> None:
        """Stores customer profile with identifiers encrypted under KYC purpose key.

        NEVER writes raw Aadhaar, PAN, Card, or Mobile numbers to disk in plaintext!
        """
        at = created_at or time.time()
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO customer_registry (customer_ref, name, upi, encrypted_ids, nonce, masked_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(customer_ref) DO UPDATE SET name=excluded.name, upi=excluded.upi, "
                "encrypted_ids=excluded.encrypted_ids, nonce=excluded.nonce, masked_json=excluded.masked_json;",
                (customer_ref, name, upi, encrypted_ids, nonce, masked_json, at)
            )

    @synchronized
    def load_all_customer_profiles(self) -> List[Dict[str, Any]]:
        cur = self.data_conn.cursor()
        rows = cur.execute(
            "SELECT customer_ref, name, upi, encrypted_ids, nonce, masked_json, created_at FROM customer_registry"
        ).fetchall()
        cur.close()
        self.data_conn.commit()
        out = []
        for r in rows:
            out.append({
                "ref": r[0],
                "name": r[1],
                "upi": r[2],
                "encrypted_ids": r[3],
                "nonce": r[4],
                "masked_json": r[5],
                "created": r[6],
            })
        return out

    @synchronized
    def delete_customer_profile(self, customer_ref: str) -> bool:
        with self.data_conn:
            cur = self.data_conn.execute(
                "DELETE FROM customer_registry WHERE customer_ref = ?", (customer_ref,)
            )
            return cur.rowcount > 0

    # ---------------------------------------------------------------- Erasure Receipts
    @synchronized
    def save_erasure_receipt(self, customer_ref: str, purpose: str, receipt: Dict[str, Any]) -> None:
        receipt_json = json.dumps(receipt, sort_keys=True, separators=(",", ":"))
        with self.data_conn:
            self.data_conn.execute(
                "INSERT INTO erasure_receipts (customer_ref, purpose, receipt_json, erased_at) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(customer_ref, purpose) DO UPDATE SET receipt_json=excluded.receipt_json;",
                (customer_ref, purpose, receipt_json, time.time())
            )

    @synchronized
    def load_all_erasure_receipts(self) -> Dict[Tuple[str, str], Dict[str, Any]]:
        cur = self.data_conn.cursor()
        rows = cur.execute(
            "SELECT customer_ref, purpose, receipt_json FROM erasure_receipts"
        ).fetchall()
        cur.close()
        self.data_conn.commit()
        return {(r[0], r[1]): json.loads(r[2]) for r in rows}

    # ---------------------------------------------------------------- Checkpoint & Maintenance
    @synchronized
    def checkpoint_and_truncate(self) -> None:
        """Executes secure deletion and truncates WAL logs on both databases."""
        if self._closed:
            return
        try:
            self.keys_conn.commit()
        except Exception:
            pass
        try:
            self.data_conn.commit()
        except Exception:
            pass

        try:
            cur1 = self.keys_conn.cursor()
            cur1.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            cur1.close()
        except Exception:
            pass

        try:
            cur2 = self.data_conn.cursor()
            cur2.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            cur2.close()
        except Exception:
            pass

    @synchronized
    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.keys_conn.commit()
        except Exception:
            pass
        try:
            self.data_conn.commit()
        except Exception:
            pass
        try:
            self.keys_conn.close()
        except Exception:
            pass
        try:
            self.data_conn.close()
        except Exception:
            pass
