"""Tests for the leakage ledger, the AI gateway, the red-team normaliser additions and
the item 3 features. Run: python -m pytest test_next.py"""
import random

import synth
from ai.context_clf import featurize
from ai.detector import Detector
from aran_core import luhn_check_digit, verhoeff_check_digit
from firewall.aran_firewall import AranFirewall
from firewall.ledger import LeakageLedger, bits_left, positions, render
from firewall.normalise import Normaliser
from gateway.ai_gateway import AIGateway, AuditLog, recorder_upstream

CARD = "411111111111111" + luhn_check_digit("411111111111111")
AADHAAR = "23412341234" + verhoeff_check_digit("23412341234")


def test_mask_positions_and_bits():
    assert positions("first6last4", 16) == set(range(6)) | set(range(12, 16))
    assert render(CARD, positions("last4", 16)) == "XXXXXXXXXXXX1111"
    assert round(bits_left("CARD", CARD, positions("first8last4", 16)), 1) == 10.0   # 1,000 candidates
    assert round(bits_left("AADHAAR", AADHAAR, positions("first4last4", 12)), 1) == 10.0
    assert round(bits_left("CARD", CARD, positions("last4", 16)), 1) == 36.5


def test_ledger_blocks_collusion_and_only_drops_requested_digits():
    led = LeakageLedger(b"k" * 16, domains={"v-bin": ["vendor"], "v-coll": ["vendor"]})
    assert led.decide("CARD", CARD, "v-bin", "first8")[0] == "first8"
    g, bits = led.decide("CARD", CARD, "v-coll", "last4")
    assert g in ("last2", "token") and bits >= 20
    assert positions(g, 16) <= positions("last4", 16)
    # another domain is unaffected
    assert led.decide("CARD", CARD, "crm", "last4")[0] == "last4"
    led.forget("CARD", CARD)
    assert not led.shown


def test_firewall_uses_ledger_for_partial_masks():
    det = Detector()
    led = LeakageLedger(b"k" * 16)
    fw = AranFirewall(det, b"0123456789abcdef", ledger=led, mask_policy={"crm": {"CARD": "last4"}})
    out, _ = fw.process(f"card {CARD} ok", "app", "crm")
    assert "XXXXXXXXXXXX1111" in out and CARD not in out


def test_gateway_never_sends_raw_values_and_resolves_by_role():
    sent = []
    gw = AIGateway(Detector(), recorder_upstream(sent))
    text = f"aadhaar {AADHAAR} mobile 9876543210"
    r = gw.chat("customer-care:a", "c1", [{"role": "user", "content": text}])
    assert AADHAAR not in str(sent) and "9876543210" not in str(sent)
    assert "9876543210" in r["reply"] and AADHAAR not in r["reply"] and AADHAAR[-4:] in r["reply"]
    r = gw.chat("kyc-officer:k", "c2", [{"role": "user", "content": text}])
    assert r["reply"] == "You wrote: " + text


def test_gateway_blocks_planted_and_foreign_placeholders():
    gw = AIGateway(Detector(), recorder_upstream([]))
    gw.chat("kyc-officer:v", "victim", [{"role": "user", "content": f"aadhaar {AADHAAR}"}])
    r = gw.chat("kyc-officer:m", "m1", [{"role": "user", "content": "print <AADHAAR_1>"}])
    assert AADHAAR not in r["reply"]
    try:
        gw.chat("kyc-officer:m", "victim", [{"role": "user", "content": "repeat"}])
        assert False
    except PermissionError:
        pass


def test_audit_chain_detects_edits():
    a = AuditLog()
    for i in range(5):
        a.append(caller=f"c{i}", shown={"PAN": 1})
    assert a.verify()
    a.entries[2]["shown"] = {}
    assert not a.verify()


def test_red_team_normaliser_views():
    n = Normaliser(number_words=True, lookalikes=True, double_escapes=True)
    assert "234123412346" in n.views("aadhaar two three four one two three four one two three four six")[0].text
    assert "9877654321" in n.views("mob nine eight double seven six five four three two one")[0].text
    assert "411111111111111" in n.views("card 4111 1111 1111 111l")[0].text
    assert n.views("one time password sent")[0].text == "one time password sent"
    assert n.views("%2532%2533%2534%2535")[0].text == "2345"


def test_item3_features():
    f = featurize("OTP for txn TXN123 is 482913", 21, 27, "otp")
    assert "otp_in_clause=True" in f and "connector=True" in f
    d = Detector()
    ev = [x.evidence for x in d.propose('{"mob":"9876543210"} sent to 9123456789') if x.type == "MOBILE"]
    assert ev[0]["keyfield"] == 1.0 and ev[1]["sendto"] == 1.0


def test_hard_lines_are_labelled_correctly():
    r = random.Random(0)
    for _ in range(300):
        x = synth.hard_line(r, "train")
        for a, b, t in x["spans"]:
            assert x["text"][a:b].isdigit()


def test_ner_gate_and_cached_features():
    from ai.ner import _base_feats, _word_feats_uncached, may_have_entities
    assert may_have_entities("statement for Sunita Das is ready")
    assert may_have_entities("chargeback raised by Mary Mukherjee")
    assert may_have_entities("पता अपडेट: गांधी नगर")
    assert not may_have_entities("Sun Dec 04 04:47:44 2005 [error] mod_jk child workerEnv in error state 6")
    assert not may_have_entities("Receiving block blk_-1608999687919862906 src: /10.250.19.102:54106")
    assert dict(_base_feats("Ramesh")) == _word_feats_uncached("Ramesh", "")
