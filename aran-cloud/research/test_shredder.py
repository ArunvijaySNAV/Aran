"""Tests for purpose-bound crypto-shredding and Merkle erasure receipts (M5)."""
import copy
import time

import pytest

from aran_core import luhn_valid, verhoeff_valid
from firewall.shredder import Erased, MerkleLog, PurposeVault, verify_inclusion, verify_receipt

AADHAAR = "234123412346"


def _vault():
    v = PurposeVault()
    v.enroll("C1", {"AADHAAR": AADHAAR}, retain={"KYC": time.time() + 3600})
    v.enroll("C2", {})
    return v


def test_merkle_inclusion_proofs_for_every_index_and_size():
    m = MerkleLog()
    for n in range(1, 33):
        m.append({"i": n})
        for i in range(n):
            assert verify_inclusion(m.leaves[i], i, n, m.proof(i, n), m.root(n))
    assert not verify_inclusion(m.leaves[3], 4, 32, m.proof(3, 32), m.root(32))


def test_vault_tokens_fail_checksum_and_round_trip():
    v = _vault()
    for _ in range(200):
        t = v.tokenise("AADHAAR", AADHAAR, "C1", "Loans", "loan-vendor")
        assert len(t) == 12 and not verhoeff_valid(t)
        assert v.detokenise(t) == AADHAAR
    c = v.tokenise("CARD", "4111111111111111", "C1", "Service", "crm")
    assert len(c) == 16 and not luhn_valid(c)


def test_erasure_kills_only_that_purpose_and_receipt_verifies():
    v = _vault()
    loans = v.tokenise("AADHAAR", AADHAAR, "C1", "Loans", "loan-vendor")
    service = v.tokenise("AADHAAR", AADHAAR, "C1", "Service", "crm")
    r = v.erase("C1", "Loans")
    assert r["event"]["tokens_unreadable"] == 1
    with pytest.raises(Erased):
        v.detokenise(loans)
    assert v.detokenise(service) == AADHAAR
    assert verify_receipt(r)["valid"]
    with pytest.raises(Erased):
        v.tokenise("AADHAAR", AADHAAR, "C1", "Loans", "loan-vendor")


def test_tampered_receipt_fails():
    v = _vault()
    r = v.erase("C2", "Marketing")
    bad = copy.deepcopy(r); bad["event"]["customer"] = "C9"
    assert not verify_receipt(bad)["valid"]
    bad = copy.deepcopy(r); bad["root"] = r["proof"][0] if r["proof"] else "AAAA"
    assert not verify_receipt(bad)["valid"]


def test_retention_lock_blocks_kyc_erasure():
    v = _vault()
    with pytest.raises(PermissionError):
        v.erase("C1", "KYC")
    assert v.key_status("C1")[0]["alive"]
