"""Tests for the demo endpoints in standout.py, run on a real engine.
Run from app/server: python -m pytest -q test_standout.py"""
import pytest

import engine as E
import standout as S


@pytest.fixture(scope="module")
def eng():
    e = E.Engine(n_customers=6, seed=7)
    S._eng = lambda: e
    return e


def words(digits):
    w = "zero one two three four five six seven eight nine".split()
    return " ".join(w[int(c)] for c in digits)


def test_arena_plain_number_is_caught(eng):
    S.arena_reset()
    ch = S.arena_challenge()
    r = S.arena_try(S.ArenaTry(text=f"customer number {ch['value']}", nick="t", challenge=ch["id"]))
    assert r["verdict"] == "caught" and ch["value"] not in r["after"]


def test_arena_message_without_the_number_is_not_counted(eng):
    before = S.arena_board()
    r = S.arena_try(S.ArenaTry(text="hello there", nick="t"))
    after = S.arena_board()
    assert r["verdict"] == "unverified"
    assert (after["caught"], after["slipped"]) == (before["caught"], before["slipped"])


def test_arena_checker_finds_number_words(eng):
    # the checker decodes number words even when the live firewall does not
    assert S._contains("call me on " + words("9876543210"), "9876543210")


def test_board_masks_the_challenge(eng):
    b = S.arena_board()
    assert b["challenge"]["value"].startswith("•") and b["challenge"]["value"][-4:].isdigit()


def test_versus_tokenises_everything_and_traces_the_leak(eng):
    d = S.versus_run(S.VersusIn(n=6))
    assert d["without"]["exposed"] > 0
    assert d["with_"]["raw_left"] == 0 and d["with_"]["checksum_valid_ids"] == 0
    assert d["with_"]["trace"]["top"]["sink"] == d["leaked_sink"]


def test_ledger_refuses_the_joining_mask(eng):
    S.ledger_reset()
    ref = sorted(eng.customers)[0]
    a = S.ledger_disclose(S.DiscloseIn(customer_ref=ref, type="CARD", sink="acme-crm", mask="first6"))
    assert a["granted"] == "first6"
    b = S.ledger_disclose(S.DiscloseIn(customer_ref=ref, type="CARD", sink="acme-collections", mask="last4"))
    assert b["refused"] and b["bits_if_granted"] < b["tau"] <= b["bits_after"]
    acme = next(d for d in b["domains"] if d["domain"] == "acme")
    assert acme["naive_candidates"] < 2 ** 20 <= acme["candidates"]


def test_pqc_hybrid_survives_the_simulated_quantum_attack(eng):
    d = S.pqc_harvest(S.PqcIn())
    assert d["classical"]["quantum_attacker_opens"] and not d["hybrid"]["quantum_attacker_opens"]
    assert d["classical"]["owner_opens"] and d["hybrid"]["owner_opens"]


def test_mosca(eng):
    assert S.pqc_mosca(10, 3, 10)["exposed_years"] == 3
