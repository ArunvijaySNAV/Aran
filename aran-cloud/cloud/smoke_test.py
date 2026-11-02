#!/usr/bin/env python3
"""aran_cloud/smoke_test.py: End-to-end integration and smoke test for Aran Cloud (preview).

Validates:
1. Workspace Signup & Key Generation (single-use raw key, SHA-256 stored).
2. Key Authentication & 401 enforcement.
3. Protect Write Path: namespacing, tokenisation, namespace stripping.
4. Metering & Dashboard: isolated counts, p50/p95 latency from tenant usage events.
5. Cross-Tenant Owner Isolation Safeguards: zero leakage of customer_refs across tenants.
6. Erasure & Receipt Storage: Ed25519 + ML-DSA-65 receipts stored and verified.
7. Restart Persistence: kills and restarts Aran Cloud process; verifies keys and metrics persist.
"""

import os
import subprocess
import sys
import time
import requests

CLOUD_URL = os.environ.get("ARAN_CLOUD_URL", "http://127.0.0.1:8100")
CORE_URL = os.environ.get("ARAN_CORE_URL", "http://127.0.0.1:8000")

INTERNAL_SECRET = os.environ.get("ARAN_INTERNAL_SECRET")
if not INTERNAL_SECRET:
    _env_local = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
    if os.path.exists(_env_local):
        with open(_env_local) as _f:
            for _line in _f:
                if _line.startswith("ARAN_INTERNAL_SECRET="):
                    INTERNAL_SECRET = _line.strip().split("=", 1)[1]


def get_core_headers():
    h = {}
    if INTERNAL_SECRET:
        h["X-Aran-Internal"] = INTERNAL_SECRET
    return h


def print_step(n, msg):
    step_str = f"{n:02d}" if isinstance(n, int) else str(n)
    print(f"\n[Step {step_str}] {msg}")


def assert_eq(actual, expected, desc):
    if actual != expected:
        raise AssertionError(f"FAILED {desc}: expected {expected!r}, got {actual!r}")
    print(f"  ✔ {desc}: {actual!r}")


def assert_true(cond, desc, details=None):
    if not cond:
        msg = f"FAILED {desc}"
        if details:
            msg += f" (details: {details})"
        raise AssertionError(msg)
    print(f"  ✔ {desc}")


def main():
    print("=" * 65)
    print(" Running Aran Cloud SaaS Smoke Test Suite")
    print("=" * 65)

    # 1. Connectivity
    print_step(1, "Check Aran Core & Aran Cloud service health")
    r_core = requests.get(f"{CORE_URL}/api/health", timeout=5)
    assert_eq(r_core.status_code, 200, "Aran Core status")
    assert_true(r_core.json().get("ready"), "Aran Core ready flag")

    r_cloud_home = requests.get(f"{CLOUD_URL}/", timeout=5)
    assert_eq(r_cloud_home.status_code, 200, "Aran Cloud landing page status")

    # 2. Signup
    print_step(2, "Workspace signup & key generation (POST /v1/workspaces)")
    r_ws = requests.post(f"{CLOUD_URL}/v1/workspaces", headers={"X-Forwarded-For": "10.100.1.1"}, json={
        "name": "Cloud Smoke Corp",
        "email": f"dev_{time.time()}@smoke.io"
    }, timeout=5)
    assert_eq(r_ws.status_code, 200, "Workspace creation status")
    ws_data = r_ws.json()
    t_id = ws_data["tenant_id"]
    api_key = ws_data["api_key"]
    assert_true(t_id.startswith("t_"), f"Tenant ID prefix ({t_id})")
    assert_true(api_key.startswith("aran_live_") and len(api_key) == 42, f"API key format: {api_key[:16]}...")

    # 3. Key Authentication (401 checks)
    print_step(3, "Enforce API key authentication (401 on missing/invalid keys)")
    r_no_key = requests.post(f"{CLOUD_URL}/v1/protect", json={"text": "hello"}, timeout=5)
    assert_eq(r_no_key.status_code, 401, "Missing key rejected with 401")
    assert_true("Invalid, missing or revoked" in r_no_key.json()["detail"], "Clear 401 message")

    r_bad_key = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": "aran_live_badkey_000000000000000000"}, json={"text": "hello"}, timeout=5)
    assert_eq(r_bad_key.status_code, 401, "Invalid key rejected with 401")

    # 4. Protect write path
    print_step(4, "Protect customer PII (POST /v1/protect with namespacing)")
    sample = requests.get(f"{CORE_URL}/api/tour/generate", headers=get_core_headers(), timeout=5).json()
    aadhaar = sample["aadhaar"]
    card = sample["card"]
    cust_ref = "CUST-SMK-001"

    r_prot = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": api_key}, json={
        "text": f"Customer Sunita with Aadhaar {aadhaar} and Card {card}",
        "customer_ref": cust_ref,
        "purpose": "KYC",
        "sink": "kyc-archive"
    }, timeout=10)
    assert_eq(r_prot.status_code, 200, "Protect status")
    prot_data = r_prot.json()

    f_aad = next(f for f in prot_data["findings"] if f["type"] == "AADHAAR")
    f_crd = next(f for f in prot_data["findings"] if f["type"] == "CARD")
    assert_eq(f_aad["customer_ref"], cust_ref, "Aadhaar customer_ref namespace stripped for tenant")
    assert_eq(f_crd["customer_ref"], cust_ref, "Card customer_ref namespace stripped for tenant")
    assert_true(f_aad["erasable"], "Aadhaar token is erasable")
    tok_aadhaar = f_aad["token"]

    # 5. Dashboard metrics
    print_step(5, "Verify isolated dashboard metrics (GET /v1/dashboard)")
    r_dash = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5)
    assert_eq(r_dash.status_code, 200, "Dashboard status")
    dash = r_dash.json()
    assert_eq(dash["tenant"]["id"], t_id, "Dashboard tenant ID")
    assert_true(dash["metrics"]["identifiers_protected"] >= 2, "Protected count >= 2")
    assert_eq(dash["metrics"]["requests_this_month"], 1, "Requests count == 1")
    assert_true(dash["metrics"]["p95_ms"] > 0, f"p95 latency computed: {dash['metrics']['p95_ms']}ms")
    assert_true("Aran Cloud (preview)" in dash["preview_notice"], "Preview disclaimer present")

    # 6. Two-tenant isolation safeguard
    print_step(6, "Verify cross-tenant owner isolation safeguard (zero customer_ref leakage)")
    # Create second tenant
    r_t2 = requests.post(f"{CLOUD_URL}/v1/workspaces", headers={"X-Forwarded-For": "10.100.1.2"}, json={
        "name": "Tenant Beta",
        "email": f"beta_{time.time()}@tenant.io"
    }, timeout=5).json()
    key_t2 = r_t2["api_key"]

    # Tenant 2 sends the SAME Aadhaar under their own customer_ref
    r_prot2 = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": key_t2}, json={
        "text": f"Customer Beta with Aadhaar {aadhaar}",
        "customer_ref": "CUST-BETA-CONFIDENTIAL",
        "purpose": "KYC"
    }, timeout=10).json()

    f_aad2 = next(f for f in r_prot2["findings"] if f["type"] == "AADHAAR")
    assert_eq(f_aad2["customer_ref"], None, "Tenant Beta customer_ref is None (NEVER reveals Tenant 1 ref)")
    assert_true(f_aad2["owner_conflict"], "Owner conflict flag is True")
    assert_true(any("identifier already enrolled elsewhere" in n for n in r_prot2.get("notes", [])),
                "Clean isolation note present")

    # Confirm Tenant 2 dashboard contains ZERO events from Tenant 1
    dash_t2 = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": key_t2}, timeout=5).json()
    assert_eq(dash_t2["metrics"]["requests_this_month"], 1, "Tenant 2 has exactly 1 request")
    assert_true(not any(e["customer_ref"] == cust_ref for e in dash_t2["recent_activity"]),
                "Tenant 1 customer_ref completely absent from Tenant 2 dashboard activity")

    # 7. Cross-Tenant Token Ownership & Isolation (Detokenise & Trace)
    print_step(7, "Cross-tenant token isolation: detokenise and trace access control")
    # Beta calls detokenise with Alpha's token -> MUST get "unknown"
    r_beta_detok = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": key_t2}, json={"token": tok_aadhaar}, timeout=5).json()
    assert_eq(r_beta_detok["status"], "unknown", "Tenant Beta detokenising Alpha's token receives 'unknown'")
    assert_eq(r_beta_detok["value"], None, "Tenant Beta receives None value for Alpha's token")
    assert_true("Not a vault token" in r_beta_detok.get("reason", ""), "Standard unknown token reason returned")

    # Alpha calls detokenise with its own token -> receives "ok" and actual decrypted value
    r_alpha_detok = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": api_key}, json={"token": tok_aadhaar}, timeout=5).json()
    assert_eq(r_alpha_detok["status"], "ok", "Tenant Alpha detokenises its own token successfully ('ok')")
    assert_eq(r_alpha_detok["value"], aadhaar, "Tenant Alpha detokenises to correct original Aadhaar value")

    # Breach dump containing Alpha's token
    dump_text = f"CONFIDENTIAL EXFILTRATION DUMP:\nrecord: token={tok_aadhaar} sink=kyc-archive\nstatus: raw_leak"

    # Beta traces the dump containing Alpha's token -> zero matches, no top sink, empty ranking
    r_beta_trace = requests.post(f"{CLOUD_URL}/v1/trace", headers={"X-API-Key": key_t2}, json={"dump": dump_text}, timeout=5).json()
    assert_eq(r_beta_trace["matched"], 0, "Tenant Beta trace on Alpha's token reports matched == 0")
    assert_eq(r_beta_trace["top"], None, "Tenant Beta trace on Alpha's token reports top == None")
    assert_eq(len(r_beta_trace["ranking"]), 0, "Tenant Beta trace on Alpha's token reports empty ranking")

    # Alpha traces the dump containing its own token -> resolves match and identifies top sink
    r_alpha_trace = requests.post(f"{CLOUD_URL}/v1/trace", headers={"X-API-Key": api_key}, json={"dump": dump_text}, timeout=5).json()
    assert_true(r_alpha_trace["matched"] >= 1, f"Tenant Alpha trace reports matched >= 1 (got {r_alpha_trace['matched']})")
    assert_true(r_alpha_trace["top"] is not None, "Tenant Alpha trace has top sink identification")
    assert_eq(r_alpha_trace["top"]["sink"], "kyc-archive", "Tenant Alpha trace correctly identifies 'kyc-archive' sink")

    # 8. Vaultless Token Co-Ownership Across Tenants (Requirement 4a)
    print_step(8, "Vaultless FF1 token co-ownership across tenants (Alpha & Beta)")
    sample_vaultless = requests.get(f"{CORE_URL}/api/tour/generate", headers=get_core_headers(), timeout=5).json()["aadhaar"]

    # Alpha protects Aadhaar with NO customer_ref (vaultless)
    r_va = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": api_key}, json={
        "text": f"Vaultless customer with Aadhaar {sample_vaultless}",
        "sink": "kyc-archive",
        "purpose": "KYC"
    }, timeout=10).json()
    tok_va = next(f for f in r_va["findings"] if f["type"] == "AADHAAR")["token"]
    assert_true(tok_va is not None, "Alpha received deterministic vaultless token")

    # Beta protects the EXACT SAME Aadhaar with NO customer_ref (vaultless)
    r_vb = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": key_t2}, json={
        "text": f"Vaultless customer with Aadhaar {sample_vaultless}",
        "sink": "kyc-archive",
        "purpose": "KYC"
    }, timeout=10).json()
    tok_vb = next(f for f in r_vb["findings"] if f["type"] == "AADHAAR")["token"]
    assert_eq(tok_vb, tok_va, "Both tenants received identical deterministic vaultless token string")

    # Both can trace their own vaultless token
    dump_vaultless = f"CONFIDENTIAL LEAK:\nrecord: token={tok_va} sink=kyc-archive"
    r_trace_va = requests.post(f"{CLOUD_URL}/v1/trace", headers={"X-API-Key": api_key}, json={"dump": dump_vaultless}, timeout=5).json()
    assert_true(r_trace_va["matched"] >= 1, "Alpha matches its own vaultless token in trace")
    assert_eq(r_trace_va["top"]["sink"], "kyc-archive", "Alpha trace identifies correct sink")

    r_trace_vb = requests.post(f"{CLOUD_URL}/v1/trace", headers={"X-API-Key": key_t2}, json={"dump": dump_vaultless}, timeout=5).json()
    assert_true(r_trace_vb["matched"] >= 1, "Beta matches its own vaultless token in trace")
    assert_eq(r_trace_vb["top"]["sink"], "kyc-archive", "Beta trace identifies correct sink")

    # Neither sees other's activity
    dash_a_check = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5).json()
    dash_b_check = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": key_t2}, timeout=5).json()
    assert_true(not any(e["tenant_id"] == dash_b_check["tenant"]["id"] for e in dash_a_check["recent_activity"]),
                "Alpha dashboard activity contains 0 Beta events")
    assert_true(not any(e["tenant_id"] == t_id for e in dash_b_check["recent_activity"]),
                "Beta dashboard activity contains 0 Alpha events")

    # 9. AI Gateway Multi-Tenant Prompts & Placeholder Exclusion (Requirement 4b)
    print_step(9, "AI Gateway multi-tenant prompts & placeholder exclusion")
    r_gw_a = requests.post(f"{CLOUD_URL}/v1/gateway", headers={"X-API-Key": api_key}, json={
        "role": "customer-care",
        "text": f"Alpha customer card inquiry: {card}"
    }, timeout=10)
    assert_eq(r_gw_a.status_code, 200, "Alpha gateway call succeeded")
    assert_true(r_gw_a.json().get("findings_in_prompt", 0) >= 1, "Alpha prompt PII detected")

    r_gw_b = requests.post(f"{CLOUD_URL}/v1/gateway", headers={"X-API-Key": key_t2}, json={
        "role": "customer-care",
        "text": f"Beta customer card inquiry: {card}"
    }, timeout=10)
    assert_eq(r_gw_b.status_code, 200, "Beta gateway call succeeded (no error, no ownership theft)")
    assert_true(r_gw_b.json().get("findings_in_prompt", 0) >= 1, "Beta prompt PII detected")

    # Assert placeholders like <CARD_1> or <AADHAAR_1> are NOT in tenant_tokens
    r_detok_ph_a = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": api_key}, json={"token": "<CARD_1>"}, timeout=5).json()
    assert_eq(r_detok_ph_a["status"], "unknown", "Placeholder <CARD_1> NOT recorded in Alpha tenant_tokens")
    r_detok_ph_b = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": key_t2}, json={"token": "<CARD_1>"}, timeout=5).json()
    assert_eq(r_detok_ph_b["status"], "unknown", "Placeholder <CARD_1> NOT recorded in Beta tenant_tokens")

    # Confirm each dashboard shows only its own gateway activity
    dash_a_gw = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5).json()
    dash_b_gw = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": key_t2}, timeout=5).json()
    a_gw_count = sum(1 for e in dash_a_gw["recent_activity"] if e["endpoint"] == "/v1/gateway")
    b_gw_count = sum(1 for e in dash_b_gw["recent_activity"] if e["endpoint"] == "/v1/gateway")
    assert_eq(a_gw_count, 1, "Alpha dashboard has exactly 1 gateway event")
    assert_eq(b_gw_count, 1, "Beta dashboard has exactly 1 gateway event")

    # 10. Checksum Failure vs Passed Unprotected (Requirement 4c)
    print_step(10, "Checksum failure verification (increments 'not valid IDs', not 'Passed unprotected')")
    dash_metric_before = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5).json()
    init_unprot = dash_metric_before["metrics"]["passed_unprotected"]
    init_ignored = dash_metric_before["metrics"]["not_valid_ids_ignored"]

    # Send random 12-digit number that fails the checksum
    r_bogus = requests.post(f"{CLOUD_URL}/v1/protect", headers={"X-API-Key": api_key}, json={
        "text": "Checking applicant identity with 1234 5678 9012 in queue",
        "customer_ref": "CUST-CHECKSUM-001",
        "purpose": "KYC"
    }, timeout=10).json()
    assert_true(any("fails the Aadhaar/Luhn checksum" in n for n in r_bogus.get("notes", [])),
                "Core notes flagged Aadhaar/Luhn checksum failure")

    dash_metric_after = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5).json()
    new_unprot = dash_metric_after["metrics"]["passed_unprotected"]
    new_ignored = dash_metric_after["metrics"]["not_valid_ids_ignored"]

    assert_eq(new_unprot, init_unprot, "Checksum failure did NOT increment 'Passed unprotected'")
    assert_eq(new_ignored, init_ignored + 1, "Checksum failure DID increment 'not valid IDs (ignored)' by 1")

    # 11. Erase and Receipt Storage
    print_step(11, "Execute erasure & verify stored post-quantum receipts")
    r_erase = requests.post(f"{CLOUD_URL}/v1/erase", headers={"X-API-Key": api_key}, json={
        "customer_ref": cust_ref,
        "purpose": "KYC"
    }, timeout=10)
    assert_eq(r_erase.status_code, 200, "Erasure status")
    receipt = r_erase.json()
    assert_eq(receipt["alg"], "Ed25519+ML-DSA-65", "Receipt algorithm")
    assert_eq(receipt["tenant_customer_ref"], cust_ref, "Receipt outer customer ref un-namespaced")

    # Verify receipt via /v1/receipts/verify
    r_ver = requests.post(f"{CLOUD_URL}/v1/receipts/verify", headers={"X-API-Key": api_key}, json=receipt, timeout=5).json()
    assert_true(r_ver.get("valid"), "Receipt verification valid")
    assert_true(r_ver.get("post_quantum_valid"), "Post-quantum ML-DSA-65 signature verified")

    # Confirm receipt stored in tenant dashboard
    dash_after_erase = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5).json()
    assert_true(dash_after_erase["metrics"]["receipts_count"] >= 1, "Receipt recorded in dashboard")
    saved_receipt = next(r for r in dash_after_erase["receipts"] if r["customer_ref"] == cust_ref)
    assert_eq(saved_receipt["alg"], "Ed25519+ML-DSA-65", "Dashboard stored receipt algorithm")

    # Confirm token is permanently erased via detokenise for Alpha
    r_detok = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": api_key}, json={"token": tok_aadhaar}, timeout=5).json()
    assert_eq(r_detok["status"], "erased", "Detokenise reports erased status for Alpha")
    assert_eq(r_detok["value"], None, "Detokenised value is None")

    # Confirm Tenant Beta STILL receives "unknown" with zero hint of erasure
    r_beta_detok_after = requests.post(f"{CLOUD_URL}/v1/detokenise", headers={"X-API-Key": key_t2}, json={"token": tok_aadhaar}, timeout=5).json()
    assert_eq(r_beta_detok_after["status"], "unknown", "Tenant Beta still receives 'unknown' for erased token")
    assert_eq(r_beta_detok_after["value"], None, "Tenant Beta receives None for erased token")

    # 12. Restart Persistence Test
    print_step(12, "Test restart persistence across process reboot")
    print("  ▶ Restarting Aran Cloud process...")
    # Find PID on port 8100
    pid_res = subprocess.run(["lsof", "-Pi", ":8100", "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
    if pid_res.stdout.strip():
        subprocess.run(["kill", "-9", pid_res.stdout.strip()])
        time.sleep(1)

    # Relaunch Aran Cloud on 8100 with ARAN_INTERNAL_SECRET preserved
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    venv_py = os.path.join(repo_root, ".venv", "bin", "python3")
    cloud_env = dict(os.environ)
    cloud_env["ARAN_DEMO_MODE"] = os.environ.get("ARAN_DEMO_MODE", "1")
    if INTERNAL_SECRET:
        cloud_env["ARAN_INTERNAL_SECRET"] = INTERNAL_SECRET

    proc = subprocess.Popen(
        [venv_py, "-m", "uvicorn", "main:app", "--port", "8100"],
        cwd=os.path.join(repo_root, "aran-cloud", "cloud"),
        env=cloud_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(2)

    # Verify key and metrics persist in cloud.db
    r_persist = requests.get(f"{CLOUD_URL}/v1/dashboard", headers={"X-API-Key": api_key}, timeout=5)
    assert_eq(r_persist.status_code, 200, "API key valid after restart")
    persist_data = r_persist.json()
    assert_eq(persist_data["tenant"]["name"], "Cloud Smoke Corp", "Tenant name preserved")
    assert_true(persist_data["metrics"]["identifiers_protected"] >= 2, "Metrics preserved across reboot")
    assert_true(persist_data["metrics"]["receipts_count"] >= 1, "Erasure receipts preserved in cloud.db")

    print("\n" + "=" * 65)
    print(" ALL 12 ARAN CLOUD SMOKE TEST STEPS PASSED SUCCESSFULLY! ")
    print("=" * 65)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ ARAN CLOUD SMOKE TEST FAILED: {e}", file=sys.stderr)
        sys.exit(1)
