"""Correctness checks against published test vectors and invariants."""
import secrets

from aran_core import (FF1, cc_detokenize_aadhaar, cc_token_aadhaar, count_luhn_completions,
                       count_verhoeff_completions, luhn_check_digit, luhn_valid,
                       verhoeff_check_digit, verhoeff_valid)

KEY = bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3C")


def test_ff1_nist_vectors():
    ff1 = FF1(KEY, 10)
    # NIST SP 800-38G FF1 samples 1 and 2 (AES-128, radix 10)
    assert ff1.encrypt("0123456789", b"") == "2433477484"
    assert ff1.encrypt("0123456789", bytes.fromhex("39383736353433323130")) == "6124200773"
    assert ff1.decrypt("6124200773", bytes.fromhex("39383736353433323130")) == "0123456789"


def test_ff1_radix36_vector():
    ff1 = FF1(KEY, 36)
    pt = [int(c, 36) for c in "0123456789abcdefghi"]
    ct = ff1._rounds(pt, bytes.fromhex("3737373770717273373737"), False)
    assert "".join("0123456789abcdefghijklmnopqrstuvwxyz"[d] for d in ct) == "a9tv40mll9kdu509eum"


def test_checksums():
    assert verhoeff_valid("2363") and verhoeff_check_digit("236") == "3"
    assert luhn_valid("4111111111111111") and luhn_check_digit("411111111111111") == "1"


def test_cc_tokens_never_pass_and_round_trip():
    ff1 = FF1(KEY)
    for _ in range(2000):
        body = str(2 + secrets.randbelow(8)) + "".join(secrets.choice("0123456789") for _ in range(10))
        a = body + verhoeff_check_digit(body)
        assert verhoeff_valid(a)
        for sink in ("crm", "loan-vendor", "llm-gateway"):
            t = cc_token_aadhaar(ff1, KEY, a, sink)
            assert not verhoeff_valid(t)
            assert cc_detokenize_aadhaar(ff1, t, sink) == a


def test_completion_counts():
    assert count_verhoeff_completions({}) == 8 * 10 ** 10  # all valid Aadhaar-shaped numbers
    assert count_luhn_completions({}) == 10 ** 15
