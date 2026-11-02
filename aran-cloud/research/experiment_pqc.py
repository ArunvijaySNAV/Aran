"""Experiments E17 to E19: Aran's post-quantum upgrade.

E17  Retroactive un-erasure. Crypto-shredding (M5) assumes that once a purpose key is
     destroyed, every leftover ciphertext is meaningless. But keys that ever left the vault
     (nightly backup to a disaster-recovery site) travelled sealed under a key-exchange
     algorithm. An attacker who records that traffic today and gets a quantum computer later
     recovers the destroyed keys and undoes the erasure. We measure how many erased values
     come back with X25519 sealing versus hybrid X25519 + ML-KEM-768 sealing.
     A quantum computer cannot be run here, so its effect on X25519 is simulated by handing the
     attacker the X25519 private key, which is exactly what Shor's algorithm outputs. No
     quantum attack on ML-KEM is known, so the attacker gets nothing for that half.
E18  Cost: key, signature and ciphertext sizes and timings for Ed25519, ML-DSA, X25519,
     ML-KEM and the hybrids; erasure-receipt size and erasures per second before and after;
     FF1 tokenising speed with 128-bit and 256-bit AES keys.
E19  Inventory: CBOM of the code base before and after the upgrade, and a Mosca priority
     table for each kind of data Aran protects.

Run: python experiment_pqc.py   (about 1 minute). Writes results_pqc.json and pqc/cbom.json.
"""
import json
import os
import random
import secrets
import statistics
import subprocess
import sys
import tempfile
import time

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric import mldsa, mlkem
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from aran_core import FF1, cc_token_aadhaar, luhn_check_digit, verhoeff_check_digit
from firewall.shredder import PURPOSES, PurposeVault, verify_receipt
from pqc import cbom
from pqc.hybrid import ClassicalKEM, HybridKEM, _combine, blob_header, mosca, unb64, unwrap_keys, wrap_keys

HERE = os.path.dirname(os.path.abspath(__file__))
RNG = random.Random(17)


def gen_aadhaar():
    body = str(RNG.randint(2, 9)) + "".join(str(RNG.randint(0, 9)) for _ in range(10))
    return body + verhoeff_check_digit(body)


def gen_card():
    body = "4" + "".join(str(RNG.randint(0, 9)) for _ in range(14))
    return body + luhn_check_digit(body)


# ---------------------------------------------------------------- E17
def shor_x25519(blob, recipient):
    """Simulated quantum attack on the X25519 half: returns the shared secret an attacker
    gets from the recorded ciphertext once the recipient's X25519 private key is known."""
    h = blob_header(blob)
    ct = unb64(h["ct"])
    x_priv = recipient.x  # what Shor's algorithm would compute from the public key
    ss_x = x_priv.exchange(X25519PublicKey.from_public_bytes(ct[:32]))
    if h["alg"] == "X25519":
        import hashlib
        pk = x_priv.public_key().public_bytes_raw()
        return hashlib.sha3_256(b"aran-x25519-v1" + ss_x + ct[:32] + pk).digest()
    # Hybrid: the ML-KEM shared secret is still unknown. Best the attacker can do is guess it.
    pk = x_priv.public_key().public_bytes_raw()
    return _combine(secrets.token_bytes(32), ss_x, ct[:32], pk)


def e17(n_customers=1000, n_erased=300):
    vault = PurposeVault()
    customers = []
    for i in range(n_customers):
        ref = f"C{i:05d}"
        ids = dict(AADHAAR=gen_aadhaar(), CARD=gen_card())
        vault.enroll(ref, ids)
        customers.append((ref, ids))
        for typ, val in ids.items():
            for purpose, sink in (("Loans", "loan-vendor"), ("Marketing", "crm-saas")):
                vault.tokenise(typ, val, ref, purpose, sink)
    # The attacker's harvest: the vault's ciphertext table (crypto-shredding says this is safe to
    # leak once keys are gone) and one night's sealed key backup to the DR site.
    stolen_vault = {t: dict(e) for t, e in vault.vault.items()}
    keys_now = {f"{c}|{p}": k for (c, p), k in vault.keys.items()}
    results = {}
    for kem_cls in (ClassicalKEM, HybridKEM):
        dr = kem_cls()
        blob = wrap_keys(dr.public(), keys_now)
        results[kem_cls.alg] = dict(dr=dr, blob=blob, blob_bytes=len(blob))
    # Erasure requests: Loans and Marketing keys of n_erased customers destroyed everywhere.
    erased = RNG.sample([c for c, _ in customers], n_erased)
    for c in erased:
        for p in ("Loans", "Marketing"):
            vault.erase(c, p)
    erased_set = set(erased)
    targets = {t: e for t, e in stolen_vault.items() if e["customer"] in erased_set}
    truth = dict(customers)
    readable_after_erasure = 0
    for t, e in targets.items():
        try:
            vault.detokenise(t)
            readable_after_erasure += 1
        except Exception:
            pass
    out = dict(customers=n_customers, erased_customers=n_erased, erased_values=len(targets),
               readable_by_bank_after_erasure=readable_after_erasure, sealing={})
    # Q-day.
    for alg, r in results.items():
        ss = shor_x25519(r["blob"], r["dr"])
        try:
            keys = unwrap_keys(None, r["blob"], shared_secret=ss)
        except InvalidTag:
            keys = {}
        recovered = 0
        for t, e in targets.items():
            k = keys.get(f"{e['customer']}|{e['purpose']}")
            if k is None:
                continue
            val = AESGCM(bytes(k)).decrypt(e["nonce"], e["ct"], t.encode()).decode()
            if val == truth[e["customer"]][e["type"]]:
                recovered += 1
        out["sealing"][alg] = dict(backup_bytes=r["blob_bytes"], keys_recovered=len(keys),
                                   erased_values_recovered=recovered,
                                   erased_values_recovered_pct=round(100 * recovered / len(targets), 2))
    out["sealing"]["never exported (HSM only)"] = dict(backup_bytes=0, keys_recovered=0, erased_values_recovered=0,
                                                       erased_values_recovered_pct=0.0)
    return out


# ---------------------------------------------------------------- E18
def timeit(fn, n):
    ts = []
    for _ in range(n):
        t = time.perf_counter(); fn(); ts.append(time.perf_counter() - t)
    return round(statistics.median(ts) * 1e6, 1)  # microseconds


def e18():
    msg = os.urandom(600)
    sig_rows = []
    for name, gen in (("Ed25519", Ed25519PrivateKey.generate), ("ML-DSA-44", mldsa.MLDSA44PrivateKey.generate),
                      ("ML-DSA-65", mldsa.MLDSA65PrivateKey.generate), ("ML-DSA-87", mldsa.MLDSA87PrivateKey.generate)):
        k = gen(); s = k.sign(msg); pk = k.public_key()
        sig_rows.append(dict(alg=name, public_key_bytes=len(pk.public_bytes_raw()), signature_bytes=len(s),
                             keygen_us=timeit(gen, 200), sign_us=timeit(lambda: k.sign(msg), 500),
                             verify_us=timeit(lambda: pk.verify(s, msg), 500)))
    kem_rows = []
    x = X25519PrivateKey.generate(); xp = x.public_key()
    kem_rows.append(dict(alg="X25519", public_key_bytes=32, ciphertext_bytes=32,
                         encaps_us=timeit(lambda: X25519PrivateKey.generate().exchange(xp), 500),
                         decaps_us=timeit(lambda: x.exchange(xp), 500)))
    for name, gen in (("ML-KEM-768", mlkem.MLKEM768PrivateKey.generate), ("ML-KEM-1024", mlkem.MLKEM1024PrivateKey.generate)):
        k = gen(); pk = k.public_key(); ss, ct = pk.encapsulate()
        kem_rows.append(dict(alg=name, public_key_bytes=len(pk.public_bytes_raw()), ciphertext_bytes=len(ct),
                             encaps_us=timeit(pk.encapsulate, 500), decaps_us=timeit(lambda: k.decapsulate(ct), 500)))
    h = HybridKEM(); hp = h.public(); _, hct = HybridKEM.encapsulate(hp)
    kem_rows.append(dict(alg="X25519+ML-KEM-768", public_key_bytes=32 + 1184, ciphertext_bytes=len(hct),
                         encaps_us=timeit(lambda: HybridKEM.encapsulate(hp), 500), decaps_us=timeit(lambda: h.decapsulate(hct), 500)))
    # Receipts and erasures per second.
    receipt_rows = []
    for pq in (False, True):
        v = PurposeVault(pq=pq)
        for i in range(400):
            v.enroll(f"C{i}", dict(AADHAAR=gen_aadhaar()))
        t = time.perf_counter()
        rs = [v.erase(f"C{i}", "Marketing") for i in range(400)]
        dt = time.perf_counter() - t
        t = time.perf_counter()
        ok = all(verify_receipt(r)["valid"] for r in rs)
        vt = time.perf_counter() - t
        receipt_rows.append(dict(signature="Ed25519+ML-DSA-65" if pq else "Ed25519", receipt_json_bytes=len(json.dumps(rs[-1])),
                                 erasures_per_second=round(400 / dt), verifications_per_second=round(400 / vt), all_valid=ok))
    # FF1 tokenising speed, 128-bit vs 256-bit AES.
    ff1_rows = []
    vals = [gen_aadhaar() for _ in range(3000)]
    for bits in (128, 256):
        key = secrets.token_bytes(bits // 8); f = FF1(key)
        t = time.perf_counter()
        for a in vals:
            cc_token_aadhaar(f, key, a, "crm-saas")
        ff1_rows.append(dict(aes_key_bits=bits, grover_bits=bits // 2, tokens_per_second=round(len(vals) / (time.perf_counter() - t))))
    return dict(signatures=sig_rows, kems=kem_rows, receipts=receipt_rows, ff1=ff1_rows)


# ---------------------------------------------------------------- E19
SHELF = [  # data, years it must stay secret (assumption, see the research doc), protected by
    ("Aadhaar number", 70, "key exchange (TLS, key backup)"),
    ("PAN", 70, "key exchange (TLS, key backup)"),
    ("Name and address", 30, "key exchange (TLS, key backup)"),
    ("Mobile number", 10, "key exchange (TLS, key backup)"),
    ("UPI ID", 10, "key exchange (TLS, key backup)"),
    ("Card number", 5, "key exchange (TLS, key backup)"),
    ("Erasure receipt (must stay unforgeable)", 10, "signature (Ed25519)"),
    ("OTP", 0.0001, "key exchange (TLS)"),
]
MIGRATION_YEARS = 7          # 2026 -> 2033, India's standard-track full adoption date
CRQC_SCENARIOS = {"early (2032)": 6, "middle (2035)": 9, "late (2040)": 14}


def e19():
    after, weak_after = cbom.scan(os.path.dirname(HERE))
    with open(os.path.join(HERE, "pqc", "cbom.json"), "w") as fh:
        json.dump(cbom.to_cyclonedx(after, weak_after), fh, indent=1)
    before = weak_before = None
    tmp = tempfile.mkdtemp()
    try:
        subprocess.run(["git", "-C", os.path.dirname(HERE), "worktree", "add", "-q", "--detach", tmp, "origin/main"],
                       check=True, capture_output=True)
        before, weak_before = cbom.scan(tmp)
        subprocess.run(["git", "-C", os.path.dirname(HERE), "worktree", "remove", "--force", tmp], capture_output=True)
    except Exception as err:  # no git history available
        print("before-scan skipped:", err)
    summarise = lambda f: {k: dict(quantum=v["quantum"], uses=len(v["occurrences"])) for k, v in sorted(f.items())}
    mosca_rows = [dict(data=d, shelf_life_years=s, protected_by=p,
                       **{f"exposed_years_{k}": round(max(0.0, mosca(s, MIGRATION_YEARS, x)), 1) for k, x in CRQC_SCENARIOS.items()})
                  for d, s, p in SHELF]
    return dict(cbom_before=summarise(before) if before else None, cbom_after=summarise(after),
                key128_sites_before=weak_before, key128_sites_after=weak_after,
                migration_years=MIGRATION_YEARS, crqc_scenarios=CRQC_SCENARIOS, mosca=mosca_rows)


if __name__ == "__main__":
    out = {}
    for name, fn in (("E17", e17), ("E18", e18), ("E19", e19)):
        t = time.time(); out[name] = fn(); print(name, f"{time.time() - t:.1f}s")
        print(json.dumps(out[name], indent=1)[:3000])
    out["environment"] = dict(python=sys.version.split()[0], cryptography=__import__("cryptography").__version__,
                              cpu=os.cpu_count())
    with open(os.path.join(HERE, "results_pqc.json"), "w") as fh:
        json.dump(out, fh, indent=1)
