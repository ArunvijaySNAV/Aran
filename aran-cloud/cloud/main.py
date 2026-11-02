"""aran_cloud/main.py: Aran Cloud (preview) - Multi-tenant SaaS proxy layer for Aran Data-Flow Firewall.

Provides:
- Workspaces and API Key generation (SHA-256 stored).
- Per-tenant engines in the core (X-Aran-Tenant); no shared vault or namespacing.
- Per-tenant usage metering and deterministic latency calculation.
- Granular per-tenant audit logs, erasure receipts, and dashboard metrics.
"""

from collections import defaultdict, deque
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import random  # noqa: F401
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import numpy as np
from pydantic import BaseModel
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "research")))
import synth  # noqa: E402  (checksum-valid sample identifiers that belong to no one)

# ---------------------------------------------------------------- configuration
PORT = int(os.environ.get("PORT", 8100))
ARAN_CORE_URL = os.environ.get("ARAN_CORE_URL", "http://127.0.0.1:8000").rstrip("/")
ARAN_ADMIN_TOKEN = os.environ.get("ARAN_ADMIN_TOKEN")

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "static")
DB_PATH = os.environ.get("ARAN_CLOUD_DB") or os.path.join(HERE, "cloud.db")

VALID_SCOPES = {"admin", "protect", "gateway", "trace", "detokenise", "erase", "verify", "dashboard"}
DEFAULT_ADMIN_SCOPES = "admin,protect,gateway,trace,detokenise,erase,verify,dashboard"

# Rate limiting settings (Item 5 & Hardening 1a)
RATE_LIMIT_PER_KEY = int(os.environ.get("ARAN_RATE_LIMIT_PER_KEY", "300"))
ARAN_SIGNUP_LIMIT = int(os.environ.get("ARAN_SIGNUP_LIMIT", os.environ.get("ARAN_SIGNUP_LIMIT_PER_IP", "5")))
ARAN_DEMO_MODE = os.environ.get("ARAN_DEMO_MODE", "0") in ("1", "true", "True")
ARAN_TRUST_CF = os.environ.get("ARAN_TRUST_CF", "0") in ("1", "true", "True")
ARAN_CORS_ORIGINS = [o.strip() for o in os.environ.get("ARAN_CORS_ORIGINS", "").split(",") if o.strip()]

_key_request_timestamps = defaultdict(deque)  # key_hash -> deque of timestamps
_signup_ip_timestamps = defaultdict(deque)    # ip -> deque of timestamps
_rate_limit_lock = threading.Lock()
_public_demo_ts = defaultdict(deque)          # ip -> timestamps (public demo limiter)
PUBLIC_DEMO_PER_MIN = int(os.environ.get("ARAN_PUBLIC_DEMO_PER_MIN", "12"))
PUBLIC_DEMO_TENANT = "t_public_demo"
_SAMPLES = defaultdict(lambda: deque(maxlen=5))   # (tenant_id, sink) -> redacted outputs, memory only
_samples_lock = threading.Lock()


def is_demo_exempt(ip: str) -> bool:
    if not ARAN_DEMO_MODE:
        return False
    return ip in ("127.0.0.1", "::1", "localhost")


def check_key_rate_limit(key_hash: str):
    now = time.time()
    window = 60.0  # 1 minute
    with _rate_limit_lock:
        ts_queue = _key_request_timestamps[key_hash]
        while ts_queue and ts_queue[0] <= now - window:
            ts_queue.popleft()
        if len(ts_queue) >= RATE_LIMIT_PER_KEY:
            retry_after = int(window - (now - ts_queue[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: max {RATE_LIMIT_PER_KEY} requests per minute.",
                headers={"Retry-After": str(max(1, retry_after))},
            )
        ts_queue.append(now)


def client_ip(request: Request) -> str:
    """The caller's IP. CF-Connecting-IP is trusted only behind Cloudflare (ARAN_TRUST_CF=1);
    X-Forwarded-For is never read because any client can set it. Run uvicorn with
    --no-proxy-headers, otherwise uvicorn itself rewrites request.client.host from XFF."""
    if ARAN_TRUST_CF:
        cf = (request.headers.get("CF-Connecting-IP") or "").strip()
        if cf:
            return cf
    return request.client.host if request.client else "127.0.0.1"


def check_signup_rate_limit(request: Request):
    ip = client_ip(request)

    if is_demo_exempt(ip):
        return

    now = time.time()
    window = 3600.0  # 1 hour
    with _rate_limit_lock:
        ts_queue = _signup_ip_timestamps[ip]
        while ts_queue and ts_queue[0] <= now - window:
            ts_queue.popleft()
        if len(ts_queue) >= ARAN_SIGNUP_LIMIT:
            retry_after = int(window - (now - ts_queue[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Signup rate limit exceeded: max {ARAN_SIGNUP_LIMIT} signups per hour per IP.",
                headers={"Retry-After": str(max(1, retry_after))},
            )
        ts_queue.append(now)

app = FastAPI(
    title="Aran Cloud (preview)",
    description="Thin SaaS proxy providing tenants, API keys, namespacing, and metering for Aran.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ARAN_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path in ("/", "/connect", "/dashboard"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ---------------------------------------------------------------- storage
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    conn = get_db()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                created_at TEXT NOT NULL,
                plan TEXT DEFAULT 'free'
            );
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL REFERENCES tenants(id),
                key_hash TEXT UNIQUE NOT NULL,
                prefix TEXT NOT NULL,
                label TEXT DEFAULT 'Default Admin Key',
                scopes TEXT DEFAULT 'admin,protect,gateway,trace,detokenise,erase,verify,dashboard',
                created_at TEXT NOT NULL,
                last_used TEXT,
                revoked INTEGER DEFAULT 0
            );
        """)
        # Migration for existing api_keys tables missing scopes/last_used columns
        info_keys = conn.execute("PRAGMA table_info(api_keys);").fetchall()
        col_names = {row[1] for row in info_keys}
        if "scopes" not in col_names:
            conn.execute("""
                CREATE TABLE api_keys_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL REFERENCES tenants(id),
                    key_hash TEXT UNIQUE NOT NULL,
                    prefix TEXT NOT NULL,
                    label TEXT DEFAULT 'Default Admin Key',
                    scopes TEXT DEFAULT 'admin,protect,gateway,trace,detokenise,erase,verify,dashboard',
                    created_at TEXT NOT NULL,
                    last_used TEXT,
                    revoked INTEGER DEFAULT 0
                );
            """)
            conn.execute("""
                INSERT INTO api_keys_v2 (tenant_id, key_hash, prefix, label, scopes, created_at, revoked)
                SELECT tenant_id, key_hash, prefix, 'Default Admin Key',
                       'admin,protect,gateway,trace,detokenise,erase,verify,dashboard',
                       created_at, revoked FROM api_keys;
            """)
            conn.execute("DROP TABLE api_keys;")
            conn.execute("ALTER TABLE api_keys_v2 RENAME TO api_keys;")
        else:
            if "label" not in col_names:
                try:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN label TEXT DEFAULT 'Default Admin Key';")
                except Exception:
                    pass
            if "last_used" not in col_names:
                try:
                    conn.execute("ALTER TABLE api_keys ADD COLUMN last_used TEXT;")
                except Exception:
                    pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL REFERENCES tenants(id),
                at REAL NOT NULL,
                endpoint TEXT NOT NULL,
                sink TEXT,
                purpose TEXT,
                protected_count INTEGER DEFAULT 0,
                unprotected_count INTEGER DEFAULT 0,
                ignored_count INTEGER DEFAULT 0,
                by_type TEXT,
                latency_ms REAL NOT NULL,
                customer_ref TEXT,
                status TEXT DEFAULT 'ok'
            );
        """)
        try:
            conn.execute("ALTER TABLE usage_events ADD COLUMN unprotected_count INTEGER DEFAULT 0;")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usage_events ADD COLUMN ignored_count INTEGER DEFAULT 0;")
        except sqlite3.OperationalError:
            pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_tokens (
                token TEXT NOT NULL,
                tenant_id TEXT NOT NULL REFERENCES tenants(id),
                customer_ref TEXT,
                purpose TEXT,
                sink TEXT,
                created_at REAL NOT NULL,
                PRIMARY KEY (tenant_id, token)
            );
        """)

        # Migration: check if tenant_tokens has single-column PK (token) and migrate to (tenant_id, token)
        info = conn.execute("PRAGMA table_info(tenant_tokens);").fetchall()
        pk_cols = [row[1] for row in info if row[5] > 0]
        if len(pk_cols) == 1 and pk_cols[0] == "token":
            conn.execute("""
                CREATE TABLE tenant_tokens_v2 (
                    token TEXT NOT NULL,
                    tenant_id TEXT NOT NULL REFERENCES tenants(id),
                    customer_ref TEXT,
                    purpose TEXT,
                    sink TEXT,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (tenant_id, token)
                );
            """)
            conn.execute("""
                INSERT OR IGNORE INTO tenant_tokens_v2 (token, tenant_id, customer_ref, purpose, sink, created_at)
                SELECT token, tenant_id, customer_ref, purpose, sink, created_at FROM tenant_tokens
                WHERE token NOT LIKE '<%>%';
            """)
            conn.execute("DROP TABLE tenant_tokens;")
            conn.execute("ALTER TABLE tenant_tokens_v2 RENAME TO tenant_tokens;")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_tenant_tokens_tenant ON tenant_tokens(tenant_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tenant_tokens_token ON tenant_tokens(token);")
        # Clean up any leftover placeholder tokens
        conn.execute("DELETE FROM tenant_tokens WHERE token LIKE '<%>%';")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL REFERENCES tenants(id),
                customer_ref TEXT NOT NULL,
                purpose TEXT NOT NULL,
                at REAL NOT NULL,
                receipt_json TEXT NOT NULL,
                verified INTEGER DEFAULT 1
            );
        """)

        # Detokenise Audit table with cryptographic hash chain (Item 2 & Hardening 1d)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS detokenise_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL REFERENCES tenants(id),
                key_id INTEGER,
                key_label TEXT,
                token TEXT NOT NULL,
                purpose TEXT,
                result TEXT NOT NULL,
                at REAL NOT NULL,
                created_at TEXT NOT NULL,
                prev_hash TEXT,
                entry_hash TEXT
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_tenant ON detokenise_audit(tenant_id);")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_chain_state (
                tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
                head_hash TEXT NOT NULL,
                total_entries INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        # Backfill audit_chain_state if empty
        conn.execute("""
            INSERT OR IGNORE INTO audit_chain_state (tenant_id, head_hash, total_entries, updated_at)
            SELECT a.tenant_id, a.entry_hash, count_table.cnt, a.created_at
            FROM detokenise_audit a
            JOIN (
                SELECT tenant_id, MAX(id) as max_id, COUNT(*) as cnt
                FROM detokenise_audit
                GROUP BY tenant_id
            ) count_table ON a.id = count_table.max_id;
        """)

        audit_cols = {row[1] for row in conn.execute("PRAGMA table_info(detokenise_audit);").fetchall()}
        if "prev_hash" not in audit_cols:
            try:
                conn.execute("ALTER TABLE detokenise_audit ADD COLUMN prev_hash TEXT;")
            except Exception:
                pass
        if "entry_hash" not in audit_cols:
            try:
                conn.execute("ALTER TABLE detokenise_audit ADD COLUMN entry_hash TEXT;")
            except Exception:
                pass
    conn.close()


init_db()


def log_detokenise_audit(
    conn: sqlite3.Connection,
    tenant_id: str,
    key_id: Optional[int],
    key_label: Optional[str],
    token: str,
    purpose: Optional[str],
    result: str,
):
    """Inserts a cryptographic hash-chained audit log row for detokenise operations."""
    last_row = conn.execute(
        "SELECT entry_hash FROM detokenise_audit WHERE tenant_id = ? ORDER BY id DESC LIMIT 1",
        (tenant_id,),
    ).fetchone()
    prev_hash = last_row[0] if (last_row and last_row[0]) else "0" * 64

    now_ts = time.time()
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    entry_payload = f"{prev_hash}|{tenant_id}|{key_id or ''}|{key_label or ''}|{token}|{purpose or ''}|{result}|{now_ts:.4f}|{now_str}"
    entry_hash = hashlib.sha256(entry_payload.encode("utf-8")).hexdigest()

    conn.execute(
        """
        INSERT INTO detokenise_audit (
            tenant_id, key_id, key_label, token, purpose, result, at, created_at, prev_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tenant_id, key_id, key_label, token, purpose, result, now_ts, now_str, prev_hash, entry_hash),
    )

    conn.execute(
        """
        INSERT INTO audit_chain_state (tenant_id, head_hash, total_entries, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(tenant_id) DO UPDATE SET
            head_hash = excluded.head_hash,
            total_entries = total_entries + 1,
            updated_at = excluded.updated_at
        """,
        (tenant_id, entry_hash, now_str),
    )


# ---------------------------------------------------------------- auth dependency & scopes
def get_current_tenant_and_key(x_api_key: Optional[str] = Header(None)) -> dict:
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid, missing or revoked API key. Pass a valid key in header 'X-API-Key'.",
        )
    raw_key = x_api_key.strip()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    # Rate limit check per API key (Item 5)
    check_key_rate_limit(key_hash)

    conn = get_db()
    row = conn.execute(
        """
        SELECT t.id, t.name, t.email, t.created_at, t.plan,
               k.id as key_id, k.prefix as key_prefix, k.label as key_label, k.scopes as key_scopes, k.created_at as key_created
        FROM api_keys k
        JOIN tenants t ON k.tenant_id = t.id
        WHERE k.key_hash = ? AND k.revoked = 0
        """,
        (key_hash,),
    ).fetchone()

    if not row:
        conn.close()
        raise HTTPException(
            status_code=401,
            detail="Invalid, missing or revoked API key. Pass a valid key in header 'X-API-Key'.",
        )

    # Update last_used
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    with conn:
        conn.execute("UPDATE api_keys SET last_used = ? WHERE key_hash = ?", (now_str, key_hash))
    conn.close()

    raw_scopes = row["key_scopes"] or ""
    scopes_list = [s.strip().lower() for s in raw_scopes.split(",") if s.strip()]

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "created_at": row["created_at"],
        "plan": row["plan"],
        "key_id": row["key_id"],
        "key_prefix": row["key_prefix"],
        "key_label": row["key_label"],
        "scopes": scopes_list,
        "key_hash": key_hash,
    }


get_current_tenant = get_current_tenant_and_key


def require_scope(required_scope: str):
    def dependency(tenant_and_key: dict = Depends(get_current_tenant_and_key)):
        scopes = tenant_and_key.get("scopes", [])
        if "admin" not in scopes and required_scope not in scopes:
            raise HTTPException(
                status_code=403,
                detail=f"this key lacks the '{required_scope}' scope",
            )
        return tenant_and_key
    return dependency


def require_any_scope(*allowed_scopes: str):
    def dependency(tenant_and_key: dict = Depends(get_current_tenant_and_key)):
        scopes = tenant_and_key.get("scopes", [])
        if "admin" in scopes:
            return tenant_and_key
        for s in allowed_scopes:
            if s in scopes:
                return tenant_and_key
        raise HTTPException(
            status_code=403,
            detail=f"this key lacks the '{allowed_scopes[0]}' scope",
        )
    return dependency


# ---------------------------------------------------------------- models
class WorkspaceIn(BaseModel):
    name: str
    email: str


class ProtectIn(BaseModel):
    text: str
    customer_ref: Optional[str] = None
    purpose: Optional[str] = "KYC"
    sink: Optional[str] = "kyc-archive"


class GatewayIn(BaseModel):
    role: str = "customer-care"
    text: Optional[str] = None
    prompt: Optional[str] = None


class DetokeniseIn(BaseModel):
    token: str
    caller: Optional[str] = "console"


class EraseIn(BaseModel):
    customer_ref: str
    purpose: str = "KYC"


class TraceIn(BaseModel):
    dump: str


class KeyCreateIn(BaseModel):
    label: str
    scopes: List[str]


# ---------------------------------------------------------------- helpers
def call_core(method: str, endpoint: str, json_data: dict = None, admin: bool = False, timeout: float = 10.0, tenant_id: str = None):
    url = f"{ARAN_CORE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    internal_secret = os.environ.get("ARAN_INTERNAL_SECRET")
    if internal_secret:
        headers["X-Aran-Internal"] = internal_secret
    if tenant_id:
        headers["X-Aran-Tenant"] = tenant_id   # selects the tenant's own engine in the core
    if admin and ARAN_ADMIN_TOKEN:
        headers["X-Admin-Token"] = ARAN_ADMIN_TOKEN
    try:
        t0 = time.perf_counter()
        if method.upper() == "GET":
            r = requests.get(url, headers=headers, params=json_data, timeout=timeout)
        else:
            r = requests.post(url, headers=headers, json=json_data, timeout=timeout)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        r.raise_for_status()
        return r.json(), latency_ms
    except requests.exceptions.RequestException as err:
        err_msg = str(err)
        if hasattr(err, "response") and err.response is not None:
            try:
                err_msg = err.response.json().get("detail", err.response.text)
            except Exception:
                err_msg = err.response.text
        raise HTTPException(status_code=502, detail=f"Aran core call {endpoint} failed: {err_msg}")


# ---------------------------------------------------------------- v1 API
@app.post("/v1/workspaces")
def create_workspace(body: WorkspaceIn, request: Request):
    """Creates a new workspace tenant and returns a single-use ADMIN API key with all scopes."""
    # Check signup rate limit (Item 5)
    check_signup_rate_limit(request)

    tenant_id = f"t_{secrets.token_hex(4)}"
    raw_key = f"aran_live_{secrets.token_hex(16)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    prefix = raw_key[:14]

    raw_dash_key = f"aran_live_{secrets.token_hex(16)}"
    dash_key_hash = hashlib.sha256(raw_dash_key.encode()).hexdigest()
    dash_prefix = raw_dash_key[:14]
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db()
    with conn:
        conn.execute(
            """
            INSERT INTO tenants (id, name, email, created_at, plan)
            VALUES (?, ?, ?, ?, 'free')
            """,
            (tenant_id, body.name.strip(), body.email.strip(), now_str),
        )
        conn.execute(
            """
            INSERT INTO api_keys (tenant_id, key_hash, prefix, label, scopes, created_at, revoked)
            VALUES (?, ?, ?, 'Default Admin Key', ?, ?, 0)
            """,
            (tenant_id, key_hash, prefix, DEFAULT_ADMIN_SCOPES, now_str),
        )
        conn.execute(
            """
            INSERT INTO api_keys (tenant_id, key_hash, prefix, label, scopes, created_at, revoked)
            VALUES (?, ?, ?, 'Dashboard Read-Only Key', 'dashboard', ?, 0)
            """,
            (tenant_id, dash_key_hash, dash_prefix, now_str),
        )
    conn.close()

    return {
        "tenant_id": tenant_id,
        "name": body.name.strip(),
        "email": body.email.strip(),
        "api_key": raw_key,
        "admin_key": raw_key,
        "dashboard_key": raw_dash_key,
        "prefix": prefix,
        "label": "Default Admin Key",
        "scopes": [s.strip() for s in DEFAULT_ADMIN_SCOPES.split(",")],
        "plan": "free",
        "created_at": now_str,
        "note": "Save your API key now. It is shown once and stored only as a SHA-256 hash.",
    }


# ---------------------------------------------------------------- Scoped API Key Management (Item 1)
@app.post("/v1/keys")
def mint_key(body: KeyCreateIn, tenant: dict = Depends(require_scope("admin"))):
    """Mints a key with a label and a chosen list of scopes (admin scope only)."""
    chosen_scopes = [s.strip().lower() for s in body.scopes if s.strip()]
    if not chosen_scopes:
        raise HTTPException(status_code=400, detail="At least one scope must be provided.")
    for s in chosen_scopes:
        if s not in VALID_SCOPES:
            raise HTTPException(status_code=400, detail=f"Invalid scope '{s}'. Valid scopes are: {sorted(VALID_SCOPES)}")

    raw_key = f"aran_live_{secrets.token_hex(16)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    prefix = raw_key[:14]
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    scopes_str = ",".join(chosen_scopes)

    conn = get_db()
    with conn:
        cur = conn.execute(
            """
            INSERT INTO api_keys (tenant_id, key_hash, prefix, label, scopes, created_at, revoked)
            VALUES (?, ?, ?, ?, ?, ?, 0)
            """,
            (tenant["id"], key_hash, prefix, body.label.strip(), scopes_str, now_str),
        )
        new_id = cur.lastrowid
    conn.close()

    return {
        "id": new_id,
        "prefix": prefix,
        "api_key": raw_key,
        "label": body.label.strip(),
        "scopes": chosen_scopes,
        "created": now_str,
        "created_at": now_str,
        "last_used": None,
        "revoked": 0,
        "note": "Save your API key now. It is shown once and stored only as a SHA-256 hash.",
    }


@app.get("/v1/keys")
def list_keys(tenant: dict = Depends(require_scope("dashboard"))):
    """Lists keys for the authenticated tenant (prefix, label, scopes, created, last used, revoked; never the secret)."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT id, prefix, label, scopes, created_at, last_used, revoked
        FROM api_keys
        WHERE tenant_id = ?
        ORDER BY id ASC
        """,
        (tenant["id"],),
    ).fetchall()
    conn.close()

    out = []
    for r in rows:
        scopes_list = [s.strip().lower() for s in (r["scopes"] or "").split(",") if s.strip()]
        out.append({
            "id": r["id"],
            "prefix": r["prefix"],
            "label": r["label"],
            "scopes": scopes_list,
            "created": r["created_at"],
            "created_at": r["created_at"],
            "last_used": r["last_used"],
            "revoked": bool(r["revoked"]),
        })
    return {"keys": out, "count": len(out)}


@app.delete("/v1/keys/{key_id}")
def revoke_key(key_id: str, tenant: dict = Depends(require_scope("admin"))):
    """Revokes an API key by id or prefix (admin scope only)."""
    conn = get_db()
    with conn:
        row = conn.execute(
            """
            SELECT id, prefix, revoked FROM api_keys
            WHERE tenant_id = ? AND (id = ? OR prefix = ?)
            """,
            (tenant["id"], key_id, key_id),
        ).fetchone()

        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Key not found.")

        conn.execute(
            """
            UPDATE api_keys SET revoked = 1
            WHERE tenant_id = ? AND (id = ? OR prefix = ?)
            """,
            (tenant["id"], key_id, key_id),
        )
    conn.close()

    return {"status": "ok", "message": f"Key {key_id} has been revoked.", "revoked": True}


@app.post("/v1/protect")
def protect(body: ProtectIn, tenant: dict = Depends(require_scope("protect"))):
    """Forwards to the calling tenant's own engine in the core, meters usage."""
    tenant_id = tenant["id"]

    core_payload = {
        "text": body.text,
        "source": "core-banking",
        "sink": body.sink or "kyc-archive",
        "customer_ref": body.customer_ref,
        "purpose": body.purpose or "KYC",
    }

    core_res, latency_ms = call_core("POST", "/api/process", core_payload, tenant_id=tenant_id)
    if "latency_ms" in core_res:
        latency_ms = core_res["latency_ms"]

    clean_findings = []
    by_type = {}
    prot_count = 0

    for f in core_res.get("findings", []):
        fc = dict(f)
        ftyp = fc.get("type", "UNKNOWN")
        if fc.get("protected"):
            prot_count += 1
            by_type[ftyp] = by_type.get(ftyp, 0) + 1
        clean_findings.append(fc)

    clean_notes = list(core_res.get("notes", []))

    # Calculate counts:
    # 1. Real identifiers that were detected but not protected:
    # findings where protected is False, plus any valid raw identifiers core notes passed through
    unprot_findings = sum(1 for f in core_res.get("findings", []) if not f.get("protected"))
    raw_passed = sum(1 for note in core_res.get("notes", []) if "passed through unchanged" in note)
    unprot_count = unprot_findings + raw_passed

    # 2. Shape matches that fail their checksum (ignored, not valid IDs)
    ignored_count = sum(1 for note in core_res.get("notes", []) if "fails the Aadhaar/Luhn checksum" in note)

    now_ts = time.time()
    conn = get_db()
    with conn:
        # Record issued tokens under calling tenant (if not an owner conflict)
        for fc in clean_findings:
            tok = fc.get("token")
            if tok:
                c_ref = fc.get("customer_ref") or body.customer_ref
                c_purp = fc.get("purpose") or body.purpose or "KYC"
                c_sink = body.sink or "kyc-archive"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO tenant_tokens (token, tenant_id, customer_ref, purpose, sink, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (str(tok), tenant_id, c_ref, c_purp, c_sink, now_ts),
                )

        # Record usage event
        conn.execute(
            """
            INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
            VALUES (?, ?, '/v1/protect', ?, ?, ?, ?, ?, ?, ?, ?, 'ok')
            """,
            (
                tenant_id,
                now_ts,
                body.sink or "kyc-archive",
                body.purpose or "KYC",
                prot_count,
                unprot_count,
                ignored_count,
                json.dumps(by_type),
                latency_ms,
                body.customer_ref,
            ),
        )
    conn.close()

    # Redacted sample for the Data flows tab: memory only, and only when nothing was left raw.
    if unprot_count == 0:
        with _samples_lock:
            _SAMPLES[(tenant_id, body.sink or "kyc-archive")].appendleft(
                {"at": now_ts, "redacted": str(core_res.get("after", ""))[:400], "protected": prot_count})

    core_res["findings"] = clean_findings
    core_res["notes"] = clean_notes
    return core_res


@app.post("/v1/gateway")
def gateway(body: GatewayIn, tenant: dict = Depends(require_scope("gateway"))):
    """AI Gateway forwarder for staff chatbots."""
    tenant_id = tenant["id"]
    prompt_text = body.prompt if body.prompt is not None else (body.text or "")
    core_res, latency_ms = call_core("POST", "/api/tour/gateway", {"role": body.role, "text": prompt_text}, tenant_id=tenant_id)

    findings_in_prompt = core_res.get("findings_in_prompt", 0)
    by_type = {"PROMPT_PII": findings_in_prompt} if findings_in_prompt else {}

    now_ts = time.time()
    conn = get_db()
    with conn:
        conn.execute(
            """
            INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
            VALUES (?, ?, '/v1/gateway', 'llm-gateway', 'Service', ?, 0, 0, ?, ?, NULL, 'ok')
            """,
            (tenant_id, now_ts, findings_in_prompt, json.dumps(by_type), latency_ms),
        )
    conn.close()

    return core_res


@app.post("/v1/detokenise")
def detokenise(body: DetokeniseIn, tenant: dict = Depends(get_current_tenant)):
    """Detokenisation forwarder: only resolves tokens that belong to the calling tenant."""
    tenant_id = tenant["id"]
    scopes = tenant.get("scopes", [])

    # Scope check: must have 'detokenise' or 'admin'
    if "admin" not in scopes and "detokenise" not in scopes:
        conn = get_db()
        with conn:
            log_detokenise_audit(
                conn,
                tenant_id=tenant_id,
                key_id=tenant.get("key_id"),
                key_label=tenant.get("key_label"),
                token=body.token,
                purpose="unknown",
                result="denied",
            )
        conn.close()
        raise HTTPException(status_code=403, detail="this key lacks the 'detokenise' scope")

    # Check token ownership in cloud.db
    conn = get_db()
    row = conn.execute(
        "SELECT tenant_id, purpose FROM tenant_tokens WHERE token = ? AND tenant_id = ?",
        (body.token, tenant_id),
    ).fetchone()

    unknown_res = {
        "token": body.token,
        "value": None,
        "status": "unknown",
        "reason": "Not a vault token. Vaultless FF1 tokens are reversed only inside the bank's key boundary.",
    }

    if not row:
        # Unknown to this tenant or belongs to another tenant: return standard unknown response
        with conn:
            conn.execute(
                """
                INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
                VALUES (?, ?, '/v1/detokenise', 'vault', 'Detokenise', 0, 0, 0, '{}', 0.5, NULL, 'unknown')
                """,
                (tenant_id, time.time()),
            )
            log_detokenise_audit(
                conn,
                tenant_id=tenant_id,
                key_id=tenant.get("key_id"),
                key_label=tenant.get("key_label"),
                token=body.token,
                purpose="unknown",
                result="unknown",
            )
        conn.close()
        return unknown_res

    purpose = row["purpose"] or "KYC"

    # Owned by caller: forward to Aran core
    core_res, latency_ms = call_core("POST", "/api/detokenise", {"token": body.token, "caller": body.caller or "console"}, tenant_id=tenant_id)
    res_status = core_res.get("status", "ok")

    with conn:
        conn.execute(
            """
            INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
            VALUES (?, ?, '/v1/detokenise', 'vault', 'Detokenise', 0, 0, 0, '{}', ?, NULL, ?)
            """,
            (tenant_id, time.time(), latency_ms, res_status),
        )
        log_detokenise_audit(
            conn,
            tenant_id=tenant_id,
            key_id=tenant.get("key_id"),
            key_label=tenant.get("key_label"),
            token=body.token,
            purpose=purpose,
            result=res_status,
        )
    conn.close()

    return core_res


@app.post("/v1/erase")
def erase(body: EraseIn, tenant: dict = Depends(require_scope("erase"))):
    """Forwards to the tenant's own engine, which destroys the customer's purpose key and signs a
    receipt with the tenant's own keys; the receipt is stored here."""
    tenant_id = tenant["id"]

    receipt, latency_ms = call_core(
        "POST",
        "/api/erase",
        {"customer_ref": body.customer_ref, "purpose": body.purpose},
        admin=True,
        tenant_id=tenant_id,
    )

    now_ts = time.time()
    conn = get_db()
    with conn:
        conn.execute(
            """
            INSERT INTO receipts (tenant_id, customer_ref, purpose, at, receipt_json, verified)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (tenant_id, body.customer_ref, body.purpose, now_ts, json.dumps(receipt)),
        )
        conn.execute(
            """
            INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
            VALUES (?, ?, '/v1/erase', 'vault', ?, 0, 0, 0, '{}', ?, ?, 'shredded')
            """,
            (tenant_id, now_ts, body.purpose, latency_ms, body.customer_ref),
        )
    conn.close()

    return receipt


@app.post("/v1/receipts/verify")
def verify_receipt(receipt: dict, tenant: dict = Depends(require_any_scope("verify", "dashboard"))):
    """Verifies a receipt against the calling tenant's own signing key."""
    res, _ = call_core("POST", "/api/receipts/verify", receipt, tenant_id=tenant["id"])
    return res


@app.post("/v1/trace")
def trace(body: TraceIn, tenant: dict = Depends(require_any_scope("trace", "dashboard"))):
    """Forwards dump trace to Aran core, reporting only tokens owned by the calling tenant."""
    tenant_id = tenant["id"]
    core_res, latency_ms = call_core("POST", "/api/trace", {"dump": body.dump}, tenant_id=tenant_id)

    conn = get_db()
    caller_tokens = {
        row["token"]: dict(row)
        for row in conn.execute(
            "SELECT token, sink, purpose, customer_ref FROM tenant_tokens WHERE tenant_id = ?",
            (tenant_id,),
        ).fetchall()
    }
    conn.close()

    votes = {}
    matched = 0
    filtered_items = []

    for item in core_res.get("items", []):
        val = item.get("value")
        if val in caller_tokens:
            tok_info = caller_tokens[val]
            sink = tok_info.get("sink") or item.get("sink")
            how = item.get("how")
            if sink:
                votes[sink] = votes.get(sink, 0) + 1
                matched += 1
            filtered_items.append({"value": val, "sink": sink, "how": how})
        else:
            # Token does not belong to caller or is unknown: hide sink/how
            filtered_items.append({"value": val, "sink": None, "how": None})

    ranking = []
    for s, n in votes.items():
        share = round(n / matched, 4) if matched else 0.0
        ranking.append({"sink": s, "tokens": n, "share": share})
    ranking.sort(key=lambda x: -x["tokens"])

    filtered_res = {
        "candidates": core_res.get("candidates", len(filtered_items)),
        "matched": matched,
        "ranking": ranking,
        "top": ranking[0] if ranking else None,
        "items": filtered_items,
        "raw_identifiers_in_dump": core_res.get("raw_identifiers_in_dump", 0),
    }

    conn = get_db()
    with conn:
        conn.execute(
            """
            INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count, ignored_count, by_type, latency_ms, customer_ref, status)
            VALUES (?, ?, '/v1/trace', 'trace', 'Audit', ?, 0, 0, '{}', ?, NULL, 'ok')
            """,
            (tenant_id, time.time(), matched, latency_ms),
        )
    conn.close()

    return filtered_res


@app.get("/v1/dashboard")
def get_dashboard(tenant: dict = Depends(require_scope("dashboard"))):
    """Returns calling tenant's isolated metrics, usage events, and receipts."""
    tenant_id = tenant["id"]
    conn = get_db()

    events = [dict(r) for r in conn.execute(
        "SELECT * FROM usage_events WHERE tenant_id = ? ORDER BY id DESC", (tenant_id,)
    ).fetchall()]

    receipts_rows = [dict(r) for r in conn.execute(
        "SELECT * FROM receipts WHERE tenant_id = ? ORDER BY id DESC", (tenant_id,)
    ).fetchall()]

    # Count plaintext reads from detokenise_audit (Item 2)
    plaintext_reads = conn.execute(
        "SELECT count(*) FROM detokenise_audit WHERE tenant_id = ? AND result = 'ok'",
        (tenant_id,),
    ).fetchone()[0]
    conn.close()

    total_protected = sum(e["protected_count"] for e in events)
    total_unprotected = sum((e.get("unprotected_count") or 0) for e in events)
    total_ignored = sum((e.get("ignored_count") or 0) for e in events)
    by_type = {}
    latencies = []
    destinations = {}

    for e in events:
        lat = e["latency_ms"]
        if lat is not None:
            latencies.append(lat)

        if e["sink"]:
            destinations[e["sink"]] = destinations.get(e["sink"], 0) + (e["protected_count"] or 1)

        if e["by_type"]:
            try:
                bt = json.loads(e["by_type"])
                for k, v in bt.items():
                    by_type[k] = by_type.get(k, 0) + v
            except Exception:
                pass

    p50_ms = round(float(np.median(latencies)), 2) if latencies else 0.0
    p95_ms = round(float(np.percentile(latencies, 95)), 2) if latencies else 0.0
    requests_count = len(events)
    plan_limit = 10000

    parsed_receipts = []
    for r in receipts_rows:
        try:
            r_json = json.loads(r["receipt_json"])
        except Exception:
            r_json = {}
        parsed_receipts.append({
            "id": r["id"],
            "customer_ref": r["customer_ref"],
            "purpose": r["purpose"],
            "at": r["at"],
            "verified": bool(r["verified"]),
            "alg": r_json.get("alg", "Ed25519+ML-DSA-65"),
            "root": r_json.get("root"),
            "signature": r_json.get("signature"),
            "raw_receipt": r_json,
        })

    now = time.time()
    since = now - 24 * 3600
    conn = get_db()
    hourly_rows = conn.execute(
        """
        SELECT CAST(at / 3600 AS INTEGER) AS h, count(*) AS n,
               COALESCE(SUM(protected_count),0) AS p, COALESCE(SUM(unprotected_count),0) AS u,
               COALESCE(SUM(ignored_count),0) AS i
        FROM usage_events WHERE tenant_id = ? AND at >= ? GROUP BY h
        """, (tenant_id, since)).fetchall()
    sink_rows = conn.execute(
        """
        SELECT sink, count(*) AS n, COALESCE(SUM(protected_count),0) AS p,
               COALESCE(SUM(unprotected_count),0) AS u, MAX(at) AS last_at
        FROM usage_events WHERE tenant_id = ? AND sink IS NOT NULL AND endpoint IN ('/v1/protect','/v1/gateway','/v1/playground')
        GROUP BY sink ORDER BY last_at DESC
        """, (tenant_id,)).fetchall()
    conn.close()
    by_hour = {r["h"]: r for r in hourly_rows}
    cur_h = int(now // 3600)
    hourly = []
    for h in range(cur_h - 23, cur_h + 1):
        r = by_hour.get(h)
        hourly.append({"hour_start": h * 3600, "requests": r["n"] if r else 0, "protected": r["p"] if r else 0,
                       "unprotected": r["u"] if r else 0, "ignored": r["i"] if r else 0})
    sinks = [{"sink": r["sink"], "events": r["n"], "protected": r["p"], "unprotected": r["u"], "last_at": r["last_at"]}
             for r in sink_rows]
    tenant_public = {k: v for k, v in tenant.items() if k not in ("key_hash", "email")}

    return {
        "tenant": tenant_public,
        "hourly": hourly,
        "sinks": sinks,
        "isolation": "Each workspace has its own engine, vault, token index, Merkle log and signing keys.",
        "metrics": {
            "identifiers_protected": total_protected,
            "passed_unprotected": total_unprotected,
            "raw_values_passed": total_unprotected,
            "not_valid_ids_ignored": total_ignored,
            "ignored_checksum_count": total_ignored,
            "plaintext_reads": plaintext_reads,
            "plaintext reads": plaintext_reads,
            "by_type": by_type,
            "p50_ms": p50_ms,
            "p95_ms": p95_ms,
            "requests_this_month": requests_count,
            "plan_limit": plan_limit,
            "usage_percent": round((requests_count / plan_limit) * 100, 2),
            "destinations": destinations,
            "receipts_count": len(parsed_receipts),
        },
        "recent_activity": events[:50],
        "receipts": parsed_receipts,
    }


# ---------------------------------------------------------------- Detokenise Audit (Item 2 & Hardening 1d)
@app.get("/v1/audit")
def get_audit(tenant: dict = Depends(require_scope("dashboard"))):
    """Returns caller's detokenise audit log rows (dashboard scope)."""
    tenant_id = tenant["id"]
    conn = get_db()
    rows = conn.execute(
        """
        SELECT id, key_id, key_label, token, purpose, result, at, created_at, prev_hash, entry_hash
        FROM detokenise_audit
        WHERE tenant_id = ?
        ORDER BY id DESC LIMIT 200
        """,
        (tenant_id,),
    ).fetchall()
    conn.close()

    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "key_id": r["key_id"],
            "key_label": r["key_label"],
            "token": r["token"],
            "purpose": r["purpose"],
            "result": r["result"],
            "at": r["at"],
            "created_at": r["created_at"],
            "prev_hash": r["prev_hash"],
            "entry_hash": r["entry_hash"],
        })
    return {"audit": out, "count": len(out)}


@app.get("/v1/audit/verify")
def verify_audit_chain(tenant: dict = Depends(require_scope("dashboard"))):
    """Recomputes and cryptographically verifies the hash chain of detokenise_audit rows."""
    tenant_id = tenant["id"]
    conn = get_db()
    rows = conn.execute(
        """
        SELECT id, tenant_id, key_id, key_label, token, purpose, result, at, created_at, prev_hash, entry_hash
        FROM detokenise_audit
        WHERE tenant_id = ?
        ORDER BY id ASC
        """,
        (tenant_id,),
    ).fetchall()
    conn.close()

    expected_prev = "0" * 64
    for r in rows:
        prev_hash = r["prev_hash"]
        entry_hash = r["entry_hash"]

        if prev_hash != expected_prev:
            return {
                "valid": False,
                "error": f"Broken chain pointer at row id {r['id']}: expected prev_hash {expected_prev}, got {prev_hash}",
                "failed_at_id": r["id"],
                "total_rows": len(rows),
            }

        recomputed = hashlib.sha256(
            f"{prev_hash}|{r['tenant_id']}|{r['key_id'] or ''}|{r['key_label'] or ''}|{r['token']}|{r['purpose'] or ''}|{r['result']}|{r['at']:.4f}|{r['created_at']}".encode("utf-8")
        ).hexdigest()

        if entry_hash != recomputed:
            return {
                "valid": False,
                "error": f"Tampered entry hash at row id {r['id']}: expected {recomputed}, stored {entry_hash}",
                "failed_at_id": r["id"],
                "total_rows": len(rows),
            }

        expected_prev = entry_hash

    # Check whether the chain was truncated from the end (tail deletion)
    conn = get_db()
    chain_state = conn.execute(
        "SELECT head_hash, total_entries FROM audit_chain_state WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()
    conn.close()

    if chain_state:
        expected_head = chain_state["head_hash"]
        expected_total = chain_state["total_entries"]
        if len(rows) != expected_total or (len(rows) > 0 and expected_prev != expected_head):
            return {
                "valid": False,
                "error": f"Chain truncation detected: stored head hash {expected_head} (expected {expected_total} entries), got {expected_prev} ({len(rows)} entries)",
                "failed_at_id": "tail_truncated",
                "total_rows": len(rows),
                "expected_rows": expected_total,
            }

    return {
        "valid": True,
        "total_rows": len(rows),
        "latest_hash": expected_prev,
        "verified_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.post("/v1/internal/reset-limiters")
def reset_limiters(request: Request):
    """Clears in-memory rate limiter state. Requires ARAN_DEMO_MODE=1 and (internal secret or admin key)."""
    demo_mode = os.environ.get("ARAN_DEMO_MODE", "0") in ("1", "true", "True") or ARAN_DEMO_MODE
    if not demo_mode:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: reset-limiters is only allowed when ARAN_DEMO_MODE=1",
        )

    internal_secret = os.environ.get("ARAN_INTERNAL_SECRET")
    hdr_secret = request.headers.get("X-Aran-Internal")
    api_key = request.headers.get("X-API-Key")

    authorized = False
    if internal_secret and hdr_secret and secrets.compare_digest(hdr_secret.strip(), internal_secret.strip()):
        authorized = True
    elif api_key:
        key_hash = hashlib.sha256(api_key.strip().encode()).hexdigest()
        conn = get_db()
        row = conn.execute(
            "SELECT scopes, revoked FROM api_keys WHERE key_hash = ? AND revoked = 0",
            (key_hash,),
        ).fetchone()
        conn.close()
        if row:
            raw_scopes = row["scopes"] or ""
            scopes = [s.strip().lower() for s in raw_scopes.split(",") if s.strip()]
            if "admin" in scopes:
                authorized = True

    if not authorized:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: reset-limiters requires valid X-Aran-Internal secret or admin-scoped X-API-Key",
        )

    with _rate_limit_lock:
        _key_request_timestamps.clear()
        _signup_ip_timestamps.clear()
        _public_demo_ts.clear()
    return {"status": "ok", "cleared": True}


# ---------------------------------------------------------------- public demo, playground, samples
def _sample_record(r: "random.Random"):
    """A KYC line made only of generated, checksum-valid identifiers that belong to no one."""
    digits = lambda x: re.sub(r"\D", "", x)
    rec = {
        "name": synth.gen_name(r, "test"),
        "aadhaar": digits(synth.gen_aadhaar(r)),
        "mobile": digits(synth.gen_mobile(r))[-10:],
        "card": digits(synth.gen_card(r)),
        "pan": synth.gen_pan(r),
    }
    rec["text"] = (f"Customer {rec['name']} KYC: Aadhaar {rec['aadhaar']}, mobile {rec['mobile']}, "
                   f"card {rec['card']}, PAN {rec['pan']}")
    return rec


def _public_demo_limit(request: Request):
    ip = client_ip(request)
    now = time.time()
    with _rate_limit_lock:
        q = _public_demo_ts[ip]
        while q and q[0] <= now - 60:
            q.popleft()
        if len(q) >= PUBLIC_DEMO_PER_MIN:
            raise HTTPException(429, f"Demo limit reached: {PUBLIC_DEMO_PER_MIN} per minute.",
                                headers={"Retry-After": str(max(1, int(60 - (now - q[0])) + 1))})
        q.append(now)


@app.get("/v1/public/demo")
def public_demo(request: Request):
    """Landing-page demo: a real protect call on a freshly generated SAMPLE record. It accepts no input
    text, so it can never be used to push real data through. Runs in its own demo workspace."""
    _public_demo_limit(request)
    import random
    rec = _sample_record(random.Random(secrets.randbits(64)))
    core_res, _ = call_core("POST", "/api/process", {
        "text": rec["text"], "source": "public-demo", "sink": "kyc-archive",
        "customer_ref": f"DEMO-{secrets.randbelow(50):03d}", "purpose": "KYC"}, tenant_id=PUBLIC_DEMO_TENANT)
    return {
        "sample": True,
        "before": rec["text"],
        "after": core_res.get("after", ""),
        "findings": [{"type": f["type"], "protected": bool(f.get("protected")), "token": f.get("token")}
                     for f in core_res.get("findings", [])],
        "latency_ms": core_res.get("latency_ms"),
    }


class PlaygroundIn(BaseModel):
    text: str


@app.post("/v1/playground")
def playground(body: PlaygroundIn, tenant: dict = Depends(require_scope("dashboard"))):
    """Console playground: protect pasted text WITHOUT enrolling a customer (vaultless tokens, nothing
    reversible is stored). Recorded in usage under the sink 'playground'."""
    if len(body.text) > 4000:
        raise HTTPException(422, "Playground text is limited to 4000 characters.")
    tenant_id = tenant["id"]
    core_res, latency_ms = call_core("POST", "/api/process", {
        "text": body.text, "source": "playground", "sink": "playground", "purpose": "Service"}, tenant_id=tenant_id)
    findings = core_res.get("findings", [])
    prot = sum(1 for f in findings if f.get("protected"))
    unprot = len(findings) - prot
    by_type = {}
    for f in findings:
        if f.get("protected"):
            by_type[f["type"]] = by_type.get(f["type"], 0) + 1
    conn = get_db()
    with conn:
        conn.execute(
            """INSERT INTO usage_events (tenant_id, at, endpoint, sink, purpose, protected_count, unprotected_count,
               ignored_count, by_type, latency_ms, customer_ref, status)
               VALUES (?, ?, '/v1/playground', 'playground', 'Service', ?, ?, 0, ?, ?, NULL, 'ok')""",
            (tenant_id, time.time(), prot, unprot, json.dumps(by_type), core_res.get("latency_ms", latency_ms)))
    conn.close()
    return {"after": core_res.get("after", ""), "latency_ms": core_res.get("latency_ms"),
            "notes": core_res.get("notes", []),
            "findings": [{"type": f["type"], "start": f["start"], "end": f["end"], "p": f["p"],
                          "protected": bool(f.get("protected")), "token": f.get("token")} for f in findings]}


@app.get("/v1/samples")
def samples(sink: str, tenant: dict = Depends(require_scope("dashboard"))):
    """The last few redacted outputs sent to a sink (kept in memory only; never contains raw values)."""
    with _samples_lock:
        rows = list(_SAMPLES.get((tenant["id"], sink), []))
    return {"sink": sink, "samples": rows, "note": "Redacted outputs only, held in memory (lost on restart)."}


@app.get("/v1/health")
def get_v1_health():
    """Checks the core at /api/health and returns ok or degraded."""
    try:
        resp = requests.get(f"{ARAN_CORE_URL}/api/health", timeout=2.0)
        if resp.status_code == 200:
            core_data = resp.json()
            if core_data.get("ready"):
                return {"status": "ok", "core": True, "core_ready": True}
        return {"status": "degraded", "core": False, "core_ready": False}
    except Exception as e:
        return {"status": "degraded", "core": False, "error": str(e)}


@app.post("/v1/demo/seed")
def trigger_demo_seed(request: Request, tenant: dict = Depends(get_current_tenant)):
    """Seeds demo traffic for the calling workspace using the caller's own admin key.
    Hidden (404) unless ARAN_DEMO_MODE=1 and the key has the admin scope. Never mints a key."""
    import subprocess
    import sys
    if not ARAN_DEMO_MODE or "admin" not in tenant.get("scopes", []):
        raise HTTPException(status_code=404, detail="Not Found")
    api_key = (request.headers.get("X-API-Key") or "").strip()
    script_path = os.path.join(HERE, "..", "..", "scripts", "seed_demo.py")
    res = subprocess.run(
        [sys.executable, script_path, "--api-key", api_key],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Seed failed: {res.stderr}")
    return {"status": "ok", "output": res.stdout}


@app.get("/v1/demo/sample-dump")
def get_sample_dump(tenant: dict = Depends(require_scope("dashboard"))):
    """Returns a short exfiltration sample text made from the calling tenant's own recent tokens."""
    tenant_id = tenant["id"]
    conn = get_db()
    rows = conn.execute(
        """
        SELECT token, sink, purpose, customer_ref
        FROM tenant_tokens
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 6
        """,
        (tenant_id,),
    ).fetchall()

    if not rows:
        sample_text = (
            "--- SAMPLE EXFILTRATION DUMP (SIMULATED DATASET) ---\n"
            "Source: synthetic-log-export\n"
            "Notice: No tokens have been protected in this workspace yet. Click 'Run demo traffic' first."
        )
        return {
            "sample": sample_text,
            "token_count": 0,
            "label": "sample",
            "is_sample": True,
        }

    lines = [
        "--- SAMPLE EXFILTRATION DUMP (SIMULATED DATASET) ---",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}",
        "Label: sample (synthesized from your workspace's tokenised records)",
        "",
        "Payload records excerpt:"
    ]
    for r in rows:
        lines.append(f'  {{"cust_id": "{r["customer_ref"] or "ANON"}", "token": "{r["token"]}", "sink": "{r["sink"]}"}}')

    sample_text = "\n".join(lines)
    return {
        "sample": sample_text,
        "token_count": len(rows),
        "label": "sample",
        "is_sample": True,
    }


@app.get("/v1/public-keys")
def get_public_keys(tenant: dict = Depends(get_current_tenant)):
    """Returns the calling tenant's own hybrid public keys (Ed25519 & ML-DSA-65) and key_id."""
    res, _ = call_core("GET", "/api/public-keys", tenant_id=tenant["id"])
    return res


# ---------------------------------------------------------------- static & frontend
@app.get("/")
def serve_landing():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/signup")
def serve_signup():
    return FileResponse(os.path.join(STATIC_DIR, "signup.html"))


@app.get("/connect")
def serve_connect():
    return FileResponse(os.path.join(STATIC_DIR, "connect.html"))


@app.get("/dashboard")
def serve_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "dashboard.html"))


_APP_TABS = {"overview": "overview", "traffic": "flows", "integrations": "keys", "receipts": "receipts",
             "trace": "trace", "audit": "audit", "usage": "overview"}


@app.get("/app/{page}")
def serve_app_page(page: str):
    tab = _APP_TABS.get(page.removesuffix(".html"), "overview")
    return RedirectResponse(url=f"/dashboard#{tab}")


@app.get("/app")
def serve_app_root():
    return RedirectResponse(url="/dashboard#overview")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
