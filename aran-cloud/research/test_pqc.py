"""Tests for the post-quantum upgrade: hybrid signatures, hybrid key wrapping, receipts, CBOM."""
import json
import os

import pytest
from cryptography.exceptions import InvalidTag

from aran_core import FF1
from firewall.shredder import PurposeVault, verify_receipt
from pqc import cbom
from pqc.hybrid import (ClassicalKEM, HybridKEM, HybridSigner, blob_header, mosca, unwrap_keys, verify_hybrid,
                        wrap_keys)


def test_ff1_aes256_nist_vectors():
    # NIST SP 800-38G FF1 samples 7 and 8 (AES-256, radix 10)
    ff1 = FF1(bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3CEF4359D8D580AA4F7F036D6F04FC6A94"), 10)
    assert ff1.encrypt("0123456789", b"") == "6657667009"
    assert ff1.encrypt("0123456789", bytes.fromhex("39383736353433323130")) == "1001623463"


def test_hybrid_signature_needs_both_halves():
    s = HybridSigner()
    sig = s.sign(b"receipt")
    assert verify_hybrid(s.public(), sig, b"receipt")["valid"]
    assert not verify_hybrid(s.public(), sig, b"receipt!")["valid"]
    other = HybridSigner()
    for half in ("ed25519", "ml_dsa_65"):  # one half swapped for a valid signature by someone else
        forged = dict(sig, **{half: other.sign(b"receipt")[half]})
        r = verify_hybrid(s.public(), forged, b"receipt")
        assert not r["valid"] and not r[half]


@pytest.mark.parametrize("kem", [HybridKEM, ClassicalKEM])
def test_key_wrap_round_trip_and_wrong_recipient(kem):
    keys = {"C1|Loans": os.urandom(32), "C2|KYC": os.urandom(32)}
    r = kem()
    blob = wrap_keys(r.public(), keys)
    assert blob_header(blob)["alg"] == kem.alg
    assert {k: bytes(v) for k, v in unwrap_keys(r, blob).items()} == keys
    with pytest.raises(InvalidTag):
        unwrap_keys(kem(), blob)


def test_hybrid_wrap_survives_broken_x25519():
    """Knowing the X25519 private key (what Shor gives) is not enough to open a hybrid blob."""
    from experiment_pqc import shor_x25519
    keys = {"C1|Loans": os.urandom(32)}
    c, h = ClassicalKEM(), HybridKEM()
    cb, hb = wrap_keys(c.public(), keys), wrap_keys(h.public(), keys)
    assert bytes(unwrap_keys(None, cb, shared_secret=shor_x25519(cb, c))["C1|Loans"]) == keys["C1|Loans"]
    with pytest.raises(InvalidTag):
        unwrap_keys(None, hb, shared_secret=shor_x25519(hb, h))


def _vault_receipt(pq):
    v = PurposeVault(pq=pq)
    v.enroll("C1", {"AADHAAR": "234123412346"})
    return v.erase("C1", "Marketing")


def test_pq_receipt_verifies_and_tampering_fails():
    r = _vault_receipt(True)
    res = verify_receipt(r, require_pq=True)
    assert res["valid"] and res["post_quantum_valid"] and res["alg"] == "Ed25519+ML-DSA-65"
    bad = json.loads(json.dumps(r)); bad["event"]["tokens_unreadable"] += 1
    assert not verify_receipt(bad)["valid"]
    bad = json.loads(json.dumps(r)); bad["pq_signature"] = HybridSigner().sign(b"x")["ml_dsa_65"]
    assert not verify_receipt(bad)["valid"]


def test_legacy_receipts_still_verify_but_downgrade_is_blocked():
    legacy = _vault_receipt(False)
    assert verify_receipt(legacy)["valid"]
    assert not verify_receipt(legacy, require_pq=True)["valid"]
    # Stripping the PQ half of a new receipt turns it into a "legacy" one with a signature over
    # different bytes (alg was signed), so it fails even without require_pq.
    stripped = {k: v for k, v in _vault_receipt(True).items() if k not in ("alg", "pq_signature", "pq_public_key")}
    assert not verify_receipt(stripped)["valid"]


def test_mosca():
    assert mosca(70, 7, 9) == 68 and mosca(0.0001, 7, 9) < 0


def test_cbom_finds_hybrids_and_no_128_bit_keys_in_product_code():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    found, weak = cbom.scan(root)
    assert "ML-DSA-65" in found and "ML-KEM-768" in found
    assert not any(v["quantum"] == "broken" for v in found.values())
    assert weak == []
    doc = cbom.to_cyclonedx(found, weak)
    assert doc["bomFormat"] == "CycloneDX" and len(doc["components"]) == len(found)
