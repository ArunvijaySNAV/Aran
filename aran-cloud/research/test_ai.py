"""Fast checks for the AI, immune and firewall layers (no downloads needed)."""
import random
import re

import numpy as np

import synth
from ai.context_clf import ContextClassifier, label_candidates
from ai.detector import Detector, ece
from ai.ner import spans_to_bio, tokenize
from aran_core import luhn_valid, verhoeff_valid
from firewall.aran_firewall import AranFirewall
from immune.ais import VDetectorNSA
from immune.flows import FlowFeaturizer, inject_attacks, simulate

KEY = bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3C")


def test_generated_identifiers_are_valid_and_spans_align():
    r = random.Random(0)
    for _ in range(500):
        assert verhoeff_valid(re.sub(r"\D", "", synth.gen_aadhaar(r)))
        assert luhn_valid(re.sub(r"\D", "", synth.gen_card(r)))
    for row in synth.make_corpus("test", 300, seed=1) + synth.make_train_corpus(300, seed=2):
        for a, b, t in row["spans"]:
            assert row["text"][a:b].strip() == row["text"][a:b] and b > a


def test_train_and_test_names_are_disjoint():
    for k, v in synth.SPLITS.items():
        assert not set(v["train"]) & set(v["test"]), k
    assert not {t for _, t in synth.TEMPLATES["train"]} & {t for _, t in synth.TEMPLATES["test"]}


def test_tokenizer_keeps_devanagari_words_whole():
    toks = [t for t, _, _ in tokenize("ग्राहक रमेश शर्मा का ओटीपी 4821 है")]
    assert toks == ["ग्राहक", "रमेश", "शर्मा", "का", "ओटीपी", "4821", "है"]
    words, tags = spans_to_bio("Dear Ravi Kumar, OTP", [(5, 15, "PER")])
    assert tags[:3] == ["O", "B-PER", "I-PER"]


def test_context_classifier_separates_otp_from_ports():
    rows = synth.make_train_corpus(1500, seed=3)
    items, y = label_candidates(rows, "otp")
    clf = ContextClassifier("otp").fit(items, y)
    p = clf.proba([("OTP 482913 is your one time password", 4, 10), ("listening on port 8443 pid 1203", 18, 22)])
    assert p[0] > 0.5 > p[1]


def test_negative_selection_never_covers_self():
    rng = np.random.default_rng(0)
    X = rng.normal(0, 1, (300, 3))
    m = VDetectorNSA(self_radius=0.05, seed=1).fit(X)
    assert (m.predict(X) == 0).all()
    far = np.array([[8.0, 8.0, 8.0]])
    assert m.predict(far)[0] == 1
    before = m.score(far)[0]
    m.confirm_attack(far[0])
    assert m.score(far)[0] > before
    m.confirm_false_alarm(far[0])
    assert m.predict(far)[0] == 0


def test_immune_layer_flags_bulk_night_export():
    tr = simulate(range(0, 14), 0)
    f = FlowFeaturizer().fit(tr)
    m = VDetectorNSA(self_radius=0.02).fit(f.transform(tr))
    a1 = [x for x in inject_attacks(range(18, 30)) if x["attack"].startswith("A1")]
    assert m.predict(f.transform(a1))[0] == 1


def test_firewall_tokenises_and_tokens_fail_checksums():
    det = Detector()  # untrained: every candidate gets p = 0.5
    fw = AranFirewall(det, KEY)
    r = random.Random(5)
    a = re.sub(r"\D", "", synth.gen_aadhaar(r))
    c = re.sub(r"\D", "", synth.gen_card(r))
    out, findings = fw.process(f"kyc uid={a} card={c}", src="crm", sink="log-platform", hour=10)
    assert a not in out and c not in out
    toks = re.findall(r"\d{12,16}", out)
    assert any(len(t) == 12 and not verhoeff_valid(t) for t in toks)
    assert any(len(t) == 16 and not luhn_valid(t) for t in toks)
    rec = fw.flow_records()[0]
    assert rec["sink"] == "log-platform" and rec["n"] == 1


def test_ece_is_zero_for_perfect_calibration():
    assert ece([0.0, 0.0, 1.0, 1.0], [0, 0, 1, 1]) == 0.0
