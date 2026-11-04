"""Unit test for the cloud's startup cleanup of tenant_tokens (no running stack needed).
The cleanup must remove gateway placeholders such as <CARD_1> and nothing else: real <MOBILE:v...>, <PAN:v...>, <PER:...>,
<UPI:v...> tokens and numeric Aadhaar/card tokens must survive every restart (they used to be deleted by a LIKE '<%>%' match).
Run: PYTHONPATH=../core:../research:. python -m pytest test_registry_cleanup.py"""
import os
import sqlite3
import tempfile
import time

_tmp = tempfile.mkdtemp(prefix="aran_cleanup_")
os.environ["ARAN_CLOUD_DB"] = os.path.join(_tmp, "cloud.db")   # must be set before main is imported (init_db runs at import)

import main  # noqa: E402

REAL = [
    "<MOBILE:v52dfcc08ea>", "<PAN:vcf1a07ed64>", "<PER:b30bbe964a>", "<UPI:v0a1b2c3d4e>", "<ADDR:v9f8e7d6c5b>", "<OTP:v1234567890>",
    "<AADHAAR:v0011223344>", "<CARD:v5566778899>", "952773346288", "4111111111111111",
]
PLACEHOLDERS = ["<CARD_1>", "<AADHAAR_1>", "<MOBILE_1>", "<PAN_12>", "<UPI_3>", "<PER_100>"]
NOT_PLACEHOLDERS_BUT_SIMILAR = ["<MOBILE_>", "<card_1>", "<MOBILE_1", "MOBILE_1>", "<MOBILE_1>x", "<MOBILE:_1>", "<A_B_1>", "<MOBILE-1>"]


def _seed(conn, tenant, tokens):
    for t in tokens:
        conn.execute("INSERT OR REPLACE INTO tenant_tokens (token, tenant_id, customer_ref, purpose, sink, created_at) VALUES (?,?,?,?,?,?)",
                     (t, tenant, "CUS-000001", "KYC", "kyc-archive", time.time()))


def _tokens(conn, tenant):
    return {r["token"] for r in conn.execute("SELECT token FROM tenant_tokens WHERE tenant_id = ?", (tenant,)).fetchall()}


def test_cleanup_removes_only_gateway_placeholders():
    conn = main.get_db()
    with conn:
        for tid in ("t_one", "t_two"):
            conn.execute("INSERT OR IGNORE INTO tenants (id, name, email, created_at) VALUES (?,?,?,?)", (tid, tid, f"{tid}@x.test", "2026-01-01"))
            _seed(conn, tid, REAL + PLACEHOLDERS + NOT_PLACEHOLDERS_BUT_SIMILAR)
        removed = main.purge_gateway_placeholders(conn)
    assert removed == 2 * len(PLACEHOLDERS)
    for tid in ("t_one", "t_two"):
        left = _tokens(conn, tid)
        assert not (left & set(PLACEHOLDERS)), "placeholders must be removed"
        assert set(REAL) <= left, "real tokens must survive"
        assert set(NOT_PLACEHOLDERS_BUT_SIMILAR) <= left, "look-alikes that are not gateway placeholders must survive"
    conn.close()


def test_restart_keeps_real_tokens():
    """init_db() is the code that runs at every cloud start."""
    conn = main.get_db()
    with conn:
        conn.execute("INSERT OR IGNORE INTO tenants (id, name, email, created_at) VALUES (?,?,?,?)", ("t_three", "t3", "t3@x.test", "2026-01-01"))
        _seed(conn, "t_three", REAL + PLACEHOLDERS)
    conn.close()
    main.init_db()
    main.init_db()   # idempotent: a second start changes nothing more
    conn = main.get_db()
    left = _tokens(conn, "t_three")
    assert set(REAL) <= left and not (left & set(PLACEHOLDERS))
    conn.close()
