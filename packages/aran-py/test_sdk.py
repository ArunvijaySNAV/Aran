"""
Tests for Aran Python SDK against running stack.
"""

import json
import os
import sys
import time
import urllib.request
import pytest

# Ensure aran_sdk is on sys.path
SDK_DIR = os.path.dirname(os.path.abspath(__file__))
if SDK_DIR not in sys.path:
    sys.path.insert(0, SDK_DIR)

from aran import Aran, AranAuthError, AranScopeError, AranRateLimit, AranError


CLOUD_URL = os.environ.get("ARAN_CLOUD_URL", "http://127.0.0.1:8100")
CORE_URL = os.environ.get("ARAN_CORE_URL", "http://127.0.0.1:8000")


def get_internal_secret():
    secret = os.environ.get("ARAN_INTERNAL_SECRET")
    if not secret:
        env_local = os.path.join(os.path.dirname(__file__), "..", ".env.local")
        if os.path.exists(env_local):
            with open(env_local) as f:
                for line in f:
                    if line.startswith("ARAN_INTERNAL_SECRET="):
                        secret = line.strip().split("=", 1)[1]
    return secret


def get_sample_pii():
    secret = get_internal_secret()
    req = urllib.request.Request(
        f"{CORE_URL}/api/tour/generate",
        headers={"X-Aran-Internal": secret} if secret else {},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.fixture(scope="module")
def admin_key():
    req = urllib.request.Request(
        f"{CLOUD_URL}/v1/workspaces",
        data=json.dumps({"name": f"SDK Test Corp {time.time()}", "email": f"sdk_{time.time()}@test.com"}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Forwarded-For": "10.250.1.1"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["api_key"]


def test_sdk_protect_and_detokenise(admin_key):
    client = Aran(api_key=admin_key, base_url=CLOUD_URL)
    
    sample = get_sample_pii()
    raw_aadhaar = sample["aadhaar"]

    # 1. Protect
    raw = f"Customer KYC Aadhaar: {raw_aadhaar}"
    res = client.protect(text=raw, customer_ref="SDK-CUST-1", purpose="KYC", sink="kyc-archive")
    assert res is not None
    assert "findings" in res
    assert len(res["findings"]) > 0
    token = res["findings"][0]["token"]
    assert token != raw_aadhaar
    assert len(token) > 0

    # 2. Detokenise
    detok = client.detokenise(token)
    assert detok.get("status") == "ok"
    assert detok.get("value") == raw_aadhaar


def test_sdk_gateway(admin_key):
    client = Aran(api_key=admin_key, base_url=CLOUD_URL)
    prompt = "Hello agent, customer mobile is 9876543210. Help them."
    res = client.gateway(prompt=prompt, role="customer-care")
    assert "provider_saw" in res
    saw_content = res["provider_saw"][0]["content"]
    assert "9876543210" not in saw_content
    assert "<MOBILE_1>" in saw_content or "MOBILE" in saw_content


def test_sdk_trace(admin_key):
    client = Aran(api_key=admin_key, base_url=CLOUD_URL)
    sample = get_sample_pii()
    raw_aadhaar = sample["aadhaar"]

    # Protect a token to trace
    p = client.protect(f"Aadhaar {raw_aadhaar}", customer_ref="SDK-CUST-2", sink="loan-vendor")
    tok = p["findings"][0]["token"]
    
    dump = f"Vendor dump: customer_record_token='{tok}'"
    tr = client.trace(dump)
    assert tr.get("matched", 0) > 0
    assert tr.get("top", {}).get("sink") == "loan-vendor"


def test_sdk_erase_and_verify_receipt(admin_key):
    client = Aran(api_key=admin_key, base_url=CLOUD_URL)
    sample = get_sample_pii()
    raw_card = sample["card"]

    # Protect a token under KYC
    p = client.protect(f"Card {raw_card}", customer_ref="SDK-CUST-3", purpose="KYC", sink="kyc-archive")
    tok = p["findings"][0]["token"]

    # Detokenise works before erasure
    before = client.detokenise(tok)
    assert before.get("status") == "ok"

    # Erase
    receipt = client.erase(customer_ref="SDK-CUST-3", purpose="KYC")
    assert receipt is not None
    assert "verified" in receipt or "event" in receipt

    # Detokenise fails / erased after erasure
    after = client.detokenise(tok)
    assert after.get("status") == "erased"

    # Verify receipt
    v = client.verify_receipt(receipt)
    assert v.get("valid") is True


def test_sdk_typed_error_401():
    client = Aran(api_key="aran_live_invalidkey00000000000000000", base_url=CLOUD_URL)
    with pytest.raises(AranAuthError) as exc_info:
        client.protect("Test text")
    assert exc_info.value.status_code == 401


def test_sdk_typed_error_403(admin_key):
    # Mint a key with only 'protect' scope
    req = urllib.request.Request(
        f"{CLOUD_URL}/v1/keys",
        data=json.dumps({"label": "Protect Only", "scopes": ["protect"]}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-API-Key": admin_key},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        scoped_key = json.loads(resp.read().decode("utf-8"))["api_key"]

    protect_client = Aran(api_key=scoped_key, base_url=CLOUD_URL)
    sample = get_sample_pii()
    raw_aadhaar = sample["aadhaar"]

    # protect succeeds
    res = protect_client.protect(f"Aadhaar {raw_aadhaar}", customer_ref="SDK-CUST-4")
    tok = res["findings"][0]["token"]

    # detokenise fails with 403 AranScopeError
    with pytest.raises(AranScopeError) as exc_info:
        protect_client.detokenise(tok)
    assert exc_info.value.status_code == 403
    assert "detokenise" in str(exc_info.value)
