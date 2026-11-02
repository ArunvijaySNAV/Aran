"""Phase 2: real multi-tenant isolation. Needs a running core + cloud (see scripts/_dev_start.sh)
for the cloud-level tests; the restart test starts its own core on a temp data dir."""
import json
import os
import random
import socket
import statistics
import subprocess
import sys
import tempfile
import time

import pytest
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "aran-cloud", "research"))
import synth  # noqa: E402

CLOUD_URL = os.environ.get("ARAN_CLOUD_URL", "http://127.0.0.1:8100")


def _secret():
    s = os.environ.get("ARAN_INTERNAL_SECRET")
    if not s:
        for line in open(os.path.join(REPO, ".env.local")):
            if line.startswith("ARAN_INTERNAL_SECRET="):
                s = line.strip().split("=", 1)[1]
    return s


def _aadhaar(seed=None):
    import re
    return re.sub(r"\D", "", synth.gen_aadhaar(random.Random(seed)))


def signup(tag):
    r = requests.post(f"{CLOUD_URL}/v1/workspaces", json={"name": f"{tag} {time.time()}", "email": f"{tag}@iso.test"})
    assert r.status_code == 200, r.text
    return r.json()


def H(ws):
    return {"X-API-Key": ws["api_key"]}


def protect(ws, text, ref, sink="kyc-archive", purpose="KYC"):
    r = requests.post(f"{CLOUD_URL}/v1/protect", headers=H(ws),
                      json={"text": text, "customer_ref": ref, "sink": sink, "purpose": purpose})
    assert r.status_code == 200, r.text
    return r.json()


def aadhaar_token(res):
    return next(f["token"] for f in res["findings"] if f["type"] == "AADHAAR" and f["protected"])


@pytest.fixture(scope="module")
def tenants():
    a, b = signup("isoA"), signup("isoB")
    aad = _aadhaar()
    # the SAME Aadhaar, and even the same customer_ref, enrolled by both banks
    ra = protect(a, f"Customer KYC Aadhaar {aad}", "CUS-000001")
    rb = protect(b, f"Customer KYC Aadhaar {aad}", "CUS-000001")
    return dict(a=a, b=b, aad=aad, ra=ra, rb=rb, ta=aadhaar_token(ra), tb=aadhaar_token(rb))


# ---------------------------------------------------------------- 1
def test_same_aadhaar_tokenises_independently_with_no_hint(tenants):
    t = tenants
    assert t["ta"] != t["tb"]
    for res in (t["ra"], t["rb"]):
        blob = json.dumps(res).lower()
        for hint in ("owner_conflict", "conflict", "already enrolled", "enrolled elsewhere", "original owner"):
            assert hint not in blob, hint
    # the second tenant's finding carries its own ref, not a null/hidden one
    fb = next(f for f in t["rb"]["findings"] if f["type"] == "AADHAAR")
    assert fb["customer_ref"] == "CUS-000001"


def test_vaultless_tokens_also_differ_per_tenant(tenants):
    t = tenants
    aad = _aadhaar(7)
    ta = aadhaar_token(requests.post(f"{CLOUD_URL}/v1/protect", headers=H(t["a"]), json={"text": f"KYC Aadhaar {aad}", "sink": "kyc-archive"}).json())
    tb = aadhaar_token(requests.post(f"{CLOUD_URL}/v1/protect", headers=H(t["b"]), json={"text": f"KYC Aadhaar {aad}", "sink": "kyc-archive"}).json())
    assert ta != tb


# ---------------------------------------------------------------- 3 (receipts, run before erase test reuses tenants)
def test_erase_in_a_leaves_b_intact_and_receipts_are_tenant_bound(tenants):
    t = tenants
    # erase in A
    r = requests.post(f"{CLOUD_URL}/v1/erase", headers=H(t["a"]), json={"customer_ref": "CUS-000001", "purpose": "KYC"})
    assert r.status_code == 200, r.text
    receipt = r.json()
    # A's token is erased, B's still resolves to the Aadhaar
    da = requests.post(f"{CLOUD_URL}/v1/detokenise", headers=H(t["a"]), json={"token": t["ta"]}).json()
    assert da["status"] == "erased" and da["value"] is None
    db = requests.post(f"{CLOUD_URL}/v1/detokenise", headers=H(t["b"]), json={"token": t["tb"]}).json()
    assert db["status"] == "ok" and db["value"] == t["aad"]

    # receipt: verifies with A's key, fails with B's
    pk_a = requests.get(f"{CLOUD_URL}/v1/public-keys", headers=H(t["a"])).json()
    pk_b = requests.get(f"{CLOUD_URL}/v1/public-keys", headers=H(t["b"])).json()
    assert pk_a["public_keys"]["ed25519"] != pk_b["public_keys"]["ed25519"]
    assert pk_a["public_keys"]["ml_dsa_65"] != pk_b["public_keys"]["ml_dsa_65"]
    assert pk_a["key_id"] != pk_b["key_id"]
    assert receipt["key_id"] == pk_a["key_id"]
    assert receipt["public_key"] == pk_a["public_keys"]["ed25519"]
    va = requests.post(f"{CLOUD_URL}/v1/receipts/verify", headers=H(t["a"]), json=receipt).json()
    assert va["valid"] is True and va["post_quantum_valid"] is True
    vb = requests.post(f"{CLOUD_URL}/v1/receipts/verify", headers=H(t["b"]), json=receipt).json()
    assert vb["valid"] is False
    # tampering with the key_id (a signed field) breaks the signature
    forged = dict(receipt, key_id=pk_b["key_id"])
    assert requests.post(f"{CLOUD_URL}/v1/receipts/verify", headers=H(t["a"]), json=forged).json()["valid"] is False


# ---------------------------------------------------------------- 4
def test_a_cannot_detokenise_or_trace_bs_token_same_as_random_string(tenants):
    t = tenants
    fresh = signup("isoB2")
    aad = _aadhaar(99)
    tok_b = aadhaar_token(protect(fresh, f"KYC Aadhaar {aad}", "X-1"))
    random_tok = "".join(random.choice("0123456789") for _ in range(12))

    def det(ws, tok):
        r = requests.post(f"{CLOUD_URL}/v1/detokenise", headers=H(ws), json={"token": tok})
        assert r.status_code == 200
        return {k: v for k, v in r.json().items() if k != "token"}

    assert det(t["a"], tok_b) == det(t["a"], random_tok)
    assert det(t["a"], tok_b)["status"] == "unknown"

    dump = f"leak: {tok_b}\nother: {random_tok}"
    r = requests.post(f"{CLOUD_URL}/v1/trace", headers=H(t["a"]), json={"dump": dump}).json()
    assert r["matched"] == 0 and r["top"] is None and r["ranking"] == []
    assert all(i["sink"] is None and i["how"] is None for i in r["items"])
    # and the owner can trace it
    r = requests.post(f"{CLOUD_URL}/v1/trace", headers=H(fresh), json={"dump": dump}).json()
    assert r["matched"] == 1 and r["top"]["sink"] == "kyc-archive"


def test_core_level_isolation_without_the_cloud_filter():
    """Even calling the core directly with another tenant's header, the token is unknown."""
    sec = _secret()
    core = os.environ.get("ARAN_CORE_URL", "http://127.0.0.1:8000")
    hdr = lambda tid: {"X-Aran-Internal": sec, "X-Aran-Tenant": tid}
    a, b = f"core_a_{int(time.time())}", f"core_b_{int(time.time())}"
    aad = _aadhaar(5)
    body = {"text": f"KYC Aadhaar {aad}", "source": "t", "sink": "kyc-archive", "customer_ref": "C1", "purpose": "KYC"}
    tb = aadhaar_token(requests.post(f"{core}/api/process", headers=hdr(b), json=body).json())
    assert requests.post(f"{core}/api/detokenise", headers=hdr(a), json={"token": tb, "caller": "x"}).json()["status"] == "unknown"
    assert requests.post(f"{core}/api/detokenise", headers=hdr(b), json={"token": tb, "caller": "x"}).json()["value"] == aad
    tr = requests.post(f"{core}/api/trace", headers=hdr(a), json={"dump": f"x {tb}"}).json()
    assert tr["matched"] == 0


def test_core_requires_internal_secret_and_tenant_header():
    sec = _secret()
    core = os.environ.get("ARAN_CORE_URL", "http://127.0.0.1:8000")
    assert requests.get(f"{core}/api/stats", headers={"X-Aran-Tenant": "t_x"}).status_code == 401           # tenant w/o secret
    assert requests.get(f"{core}/api/stats", headers={"X-Aran-Internal": "wrong", "X-Aran-Tenant": "t_x"}).status_code == 401
    assert requests.get(f"{core}/api/stats", headers={"X-Aran-Internal": sec}).status_code == 400            # no tenant
    for bad in ("../etc", "a/b", "x" * 65, "a b", ".."):
        assert requests.get(f"{core}/api/stats", headers={"X-Aran-Internal": sec, "X-Aran-Tenant": bad}).status_code == 400, bad
    assert requests.get(f"{core}/api/health").status_code == 200


# ---------------------------------------------------------------- 5 restart
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class CoreProc:
    def __init__(self, data_dir, port):
        self.port, self.data_dir = port, data_dir
        self.url = f"http://127.0.0.1:{port}"
        self.hdr = {"X-Aran-Internal": "restart-test-secret"}
        if os.environ.get("ARAN_ADMIN_TOKEN"):
            self.hdr["X-Admin-Token"] = os.environ["ARAN_ADMIN_TOKEN"]
        self.proc = None

    def start(self):
        env = dict(os.environ, ARAN_INTERNAL_SECRET="restart-test-secret", ARAN_DATA_DIR=self.data_dir,
                   ARAN_MASTER_KEY=os.environ.get("ARAN_MASTER_KEY") or open(os.path.join(REPO, ".env.local")).read().split("ARAN_MASTER_KEY=")[1].split()[0])
        env.pop("ARAN_TENANTS_DIR", None)
        self.proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(self.port),
                                      "--workers", "1", "--no-proxy-headers"],
                                     cwd=os.path.join(REPO, "aran-cloud", "core"), env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
            try:
                if requests.get(f"{self.url}/api/health", timeout=1).json().get("ready"):
                    return self
            except Exception:
                pass
            time.sleep(0.5)
        raise RuntimeError("core did not become ready")

    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=15)

    def post(self, path, tid, body):
        return requests.post(f"{self.url}{path}", headers=dict(self.hdr, **{"X-Aran-Tenant": tid}), json=body)

    def get(self, path, tid):
        return requests.get(f"{self.url}{path}", headers=dict(self.hdr, **{"X-Aran-Tenant": tid}))


def test_restart_keeps_merkle_root_tokens_receipts_and_does_not_resurrect_erased_keys():
    with tempfile.TemporaryDirectory(prefix="aran-restart-") as d:
        c = CoreProc(d, _free_port()).start()
        try:
            aad, aad2 = _aadhaar(11), _aadhaar(12)
            tid = "t_restart1"
            r = c.post("/api/process", tid, {"text": f"KYC Aadhaar {aad}", "source": "t", "sink": "kyc-archive",
                                             "customer_ref": "CUS-1", "purpose": "KYC"}).json()
            tok = aadhaar_token(r)
            r2 = c.post("/api/process", tid, {"text": f"KYC Aadhaar {aad2}", "source": "t", "sink": "kyc-archive",
                                              "customer_ref": "CUS-2", "purpose": "KYC"}).json()
            tok2 = aadhaar_token(r2)
            er = c.post("/api/erase", tid, {"customer_ref": "CUS-2", "purpose": "KYC"})
            assert er.status_code == 200, er.text
            receipt = er.json()
            before = c.get("/api/merkle", tid).json()
            pk_before = c.get("/api/public-keys", tid).json()
            c.stop()
            c = CoreProc(d, c.port).start()
            after = c.get("/api/merkle", tid).json()
            assert after["root"] == before["root"] and after["size"] == before["size"]
            assert c.get("/api/public-keys", tid).json()["public_keys"] == pk_before["public_keys"]
            assert c.post("/api/detokenise", tid, {"token": tok, "caller": "t"}).json()["value"] == aad
            assert c.post("/api/detokenise", tid, {"token": tok2, "caller": "t"}).json()["status"] == "erased"
            assert c.post("/api/receipts/verify", tid, receipt).json()["valid"] is True
            # an erased customer sent again after the restart must not get a fresh key
            r3 = c.post("/api/process", tid, {"text": f"KYC Aadhaar {aad2}", "source": "t", "sink": "kyc-archive",
                                              "customer_ref": "CUS-2", "purpose": "KYC"}).json()
            assert "withheld" in r3["after"], r3["after"]
        finally:
            c.stop()


# ---------------------------------------------------------------- 6 latency (measured, not asserted against a target)
def test_protect_latency_5_fields_is_measured_and_recorded():
    ws = signup("isoLat")
    r = random.Random(2026)
    import re
    lat_client, lat_core, prot_counts = [], [], []
    n = 120
    for i in range(n + 10):
        text = (f"Customer {synth.gen_name(r, 'test')} KYC: Aadhaar {re.sub(chr(92)+'D', '', synth.gen_aadhaar(r))}, "
                f"mobile {re.sub(chr(92)+'D', '', synth.gen_mobile(r))[-10:]}, "
                f"card {re.sub(chr(92)+'D', '', synth.gen_card(r))}, PAN {synth.gen_pan(r)}")
        t0 = time.perf_counter()
        res = requests.post(f"{CLOUD_URL}/v1/protect", headers=H(ws),
                            json={"text": text, "customer_ref": f"LAT-{i:04d}", "sink": "kyc-archive", "purpose": "KYC"})
        dt = (time.perf_counter() - t0) * 1000
        assert res.status_code == 200, res.text
        n_prot = sum(1 for f in res.json()["findings"] if f["protected"])
        assert n_prot >= 4, res.json()["after"]   # identifiers always protected; the name (NER) can be missed
        if i >= 10:
            prot_counts.append(n_prot)   # first 10 are warm-up
            lat_client.append(dt)
            lat_core.append(res.json()["latency_ms"])
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))]
    out = dict(endpoint="/v1/protect", payload="name+Aadhaar+mobile+card+PAN (5 fields, enrolled customer_ref)", n=len(lat_client),
               client_ms=dict(p50=round(q(lat_client, .5), 1), p95=round(q(lat_client, .95), 1), mean=round(statistics.mean(lat_client), 1)),
               core_ms=dict(p50=round(q(lat_core, .5), 1), p95=round(q(lat_core, .95), 1)),
               fields_protected=dict(of=5, min=min(prot_counts), mean=round(statistics.mean(prot_counts), 2),
                                     requests_with_all_5=sum(1 for c in prot_counts if c == 5)),
               measured_at=time.strftime("%Y-%m-%d %H:%M:%S"), path="client -> cloud(8100) -> core(8000), localhost, sequential")
    os.makedirs(os.path.join(REPO, "docs", "measurements"), exist_ok=True)
    json.dump(out, open(os.path.join(REPO, "docs", "measurements", "protect_latency_local.json"), "w"), indent=2)
    print("\nLATENCY", json.dumps(out))
    assert out["client_ms"]["p95"] < 5000
