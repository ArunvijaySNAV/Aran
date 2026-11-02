"""Checks for the normaliser, the registries and typo repair (no downloads needed)."""
import base64
import hashlib
import random
import re

import synth
from ai.detector import Detector
from aran_core import luhn_valid, verhoeff_valid
from firewall.aran_firewall import AranFirewall
from firewall.normalise import Normaliser, canonical_view
from firewall.registry import CuckooFilter, CustomerRegistry, OtpRegistry, typo_neighbours

KEY = bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3C")


def _ids(seed=0):
    r = random.Random(seed)
    return re.sub(r"\D", "", synth.gen_aadhaar(r)), re.sub(r"\D", "", synth.gen_card(r))


def _firewall(a, c, clock=None):
    reg = CustomerRegistry(KEY, 1000)
    reg.add("AADHAAR", a); reg.add("CARD", c); reg.add("MOBILE", "+91 98765 43210")
    otp = OtpRegistry(KEY, ttl=60, clock=clock) if clock else OtpRegistry(KEY)
    det = Detector(registry=reg, otp_registry=otp, normaliser=Normaliser())
    return AranFirewall(det, KEY), reg, otp


def test_cuckoo_filter_add_lookup_delete():
    f = CuckooFilter(5000)
    keys = [hashlib.sha256(b"in%d" % i).digest() for i in range(4000)]
    for k in keys:
        f.add(k)
    assert all(k in f for k in keys)
    assert f.remove(keys[0]) and keys[0] not in f
    assert sum(hashlib.sha256(b"out%d" % i).digest() in f for i in range(20000)) == 0


def test_canonical_view_maps_back_to_original():
    s = "id=%32%33 \\u0034 ५ ６​7 &#56;"
    t, st, en = canonical_view(s)
    assert t == "id=23 4 5 67 8"
    assert s[st[3]:en[3]] == "%32" and s[st[t.index("5")]:en[t.index("5")]] == "५"


def test_typo_neighbours_cover_single_edits_and_swaps():
    a, c = _ids(1)
    wrong = a[:6] + str((int(a[6]) + 3) % 10) + a[7:]
    assert not verhoeff_valid(wrong) and a in typo_neighbours(wrong, "AADHAAR")
    swap = a[:3] + a[4] + a[3] + a[5:]
    if swap != a:
        assert a in typo_neighbours(swap, "AADHAAR")
    cw = c[:9] + str((int(c[9]) + 1) % 10) + c[10:]
    assert not luhn_valid(cw) and c in typo_neighbours(cw, "CARD")
    assert len(typo_neighbours(wrong, "AADHAAR")) < 30


def test_hidden_aadhaar_is_replaced_in_every_encoding():
    a, c = _ids(2)
    fw, _, _ = _firewall(a, c)
    hidden = [
        a.translate(str.maketrans("0123456789", "०१२३४५६७८९")),
        a.translate(str.maketrans("0123456789", "௦௧௨௩௪௫௬௭௮௯")),
        a.translate(str.maketrans("0123456789", "０１２３４５６７８９")),
        "".join("%%%02X" % ord(ch) for ch in a),
        "".join("\\u%04x" % ord(ch) for ch in a),
        f"{a[:4]}.{a[4:8]}.{a[8:]}", " ".join(a), a[:6] + "​" + a[6:],
    ]
    for h in hidden:
        out, fs = fw.process(f"kyc uid={h} ok", "crm", "logs")
        assert any(f.type == "AADHAAR" for f in fs), h
        assert out.startswith("kyc uid=") and out.endswith(" ok") and a not in canonical_view(out)[0]


def test_base64_blob_is_cleaned_and_reencoded():
    a, c = _ids(3)
    fw, _, _ = _firewall(a, c)
    blob = base64.urlsafe_b64encode(f'{{"aadhaar":"{a}","card":"{c}"}}'.encode()).decode().rstrip("=")
    out, fs = fw.process(f"token={blob}", "crm", "logs")
    new = out.split("=", 1)[1]
    dec = base64.urlsafe_b64decode(new + "=" * (-len(new) % 4)).decode()
    assert a not in dec and c not in dec and dec.startswith('{"aadhaar":"')
    assert {f.type for f in fs} >= {"AADHAAR", "CARD"}


def test_split_fields_keep_their_shape():
    a, c = _ids(4)
    fw, _, _ = _firewall(a, c)
    line = '{"aadhaar_1":"%s","aadhaar_2":"%s","aadhaar_3":"%s"}' % (a[:4], a[4:8], a[8:])
    out, _ = fw.process(line, "crm", "logs")
    got = "".join(re.findall(r'"(\d{4})"', out))
    assert len(got) == 12 and got != a and not verhoeff_valid(got)
    # no keyword and not registered: three 4-digit numbers are left alone
    assert fw.process("batch 1234 took 5678 ms on 9012", "crm", "logs")[0] == "batch 1234 took 5678 ms on 9012"


def test_registry_catches_bare_mobile_and_typo_but_not_own_tokens():
    a, c = _ids(5)
    fw, reg, _ = _firewall(a, c)
    out, fs = fw.process("contact 9876543210 now", "crm", "logs")
    assert "9876543210" not in out and fs[0].meta["registry"] == "hit"
    typo = a[:8] + str((int(a[8]) + 1) % 10) + a[9:]
    out, fs = fw.process(f"ref {typo} done", "crm", "logs")
    assert typo not in out and fs[0].meta["registry"] == "typo"
    # the typo'd number is tokenised as the customer it belongs to
    assert out == fw.process(f"ref {a} done", "crm", "logs")[0]
    tok = re.search(r"\d{12}", out).group()
    assert fw.is_own_token(tok, "AADHAAR") and not fw.det.scan(f"x {tok}")
    reg.remove("AADHAAR", a)  # erasure: the customer is no longer recognised
    assert not fw.det.scan(f"ref {typo} done")


def test_otp_registry_is_bound_to_trace_and_expires():
    now = [1000.0]
    a, c = _ids(6)
    fw, _, otp = _firewall(a, c, clock=lambda: now[0])
    otp.issue("482913", "trace-a")
    assert fw.process("value 482913 ok", "auth", "logs", trace_id="trace-a")[0] == "value <OTP:destroyed> ok"
    assert fw.process("value 482913 ok", "auth", "logs", trace_id="trace-b")[0] == "value 482913 ok"
    now[0] += 61
    assert fw.process("value 482913 ok", "auth", "logs", trace_id="trace-a")[0] == "value 482913 ok"
