"""Aran inline firewall: detector + tokeniser + immune flow monitor, wired together.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

For every line headed to a sink (log platform, LLM gateway, vendor, ...):
  1. the calibrated detector finds sensitive spans with probabilities;
  2. spans at or above the sink's threshold are replaced: Aadhaar and card numbers by
     checksum-complement tokens (vaultless FF1, always fail the checksum, so a token is
     never mistaken for a real number and names the sink it was issued to), OTPs are
     destroyed, other types become keyed per-sink pseudonyms;
  3. per (source, sink, hour) the firewall keeps flow counts and hands each finished
     hour to the artificial immune system, which raises an alert for non-self flows.

With a normaliser and registries attached to the detector (see normalise.py and
registry.py), hidden identifiers are replaced in place: a split field keeps its
fields, a base64 blob is decoded, cleaned and re-encoded, and an escaped or
other-script number becomes an ordinary token.
"""
import hashlib
import hmac
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aran_core import FF1, _offset, cc_token_aadhaar, luhn_check_digit, verhoeff_check_digit  # noqa: E402

from .ledger import LENGTH, positions, render  # noqa: E402
from .normalise import b64_encode  # noqa: E402


def cc_token_card(ff1, key, card, sink):
    """Card counterpart of cc_token_aadhaar: FF1 on the first 15 digits, then a check
    digit that is deliberately wrong by a keyed non-zero offset, so it always fails Luhn."""
    body = ff1.encrypt(card[:15], sink.encode())
    off = 1 + hmac.new(key, b"card|" + sink.encode(), hashlib.sha256).digest()[0] % 9
    return body + str((int(luhn_check_digit(body)) + off) % 10)


def card_offset(key, sink):
    return 1 + hmac.new(key, b"card|" + sink.encode(), hashlib.sha256).digest()[0] % 9


class AranFirewall:
    def __init__(self, detector, key, ais=None, featurizer=None, thresholds=None, ledger=None, mask_policy=None):
        """ledger, mask_policy: optional leakage ledger (ledger.py) and, per sink, the
        partial mask that sink asks for, e.g. {"crm-ui": {"CARD": "last4"}}. The ledger
        grants the mask only if no trust domain of that sink drops below its bit
        threshold, and otherwise a smaller mask or a token."""
        self.det, self.key, self.ff1 = detector, key, FF1(key)
        self.ledger, self.mask_policy = ledger, mask_policy or {}
        self.ais, self.feat = ais, featurizer
        self.thresholds = thresholds or {}
        self.flows = defaultdict(lambda: dict(n=0, raw=0, classes=set(), detok=0))
        self.sinks = set(self.thresholds)
        if getattr(detector, "registry", None) is not None and detector.token_check is None:
            detector.token_check = self.is_own_token

    def is_own_token(self, digits, typ):
        """True if a checksum-failing number is a token this firewall issued for a
        registered customer. The wrong check digit must match the sink's keyed offset
        (a free test that rules out 8 in 9 sinks) and the decrypted body must be a
        registered customer. Typo repair asks this before flagging, because a token is
        pseudorandom and could sit one edit away from some other customer."""
        reg = self.det.registry
        for sink in self.sinks:
            body = digits[:-1]
            if typ == "AADHAAR" and len(digits) == 12:
                if int(digits[-1]) != (int(verhoeff_check_digit(body)) + _offset(self.key, sink)) % 10:
                    continue
                real = self.ff1.decrypt(body, sink.encode())
                real += verhoeff_check_digit(real)
            elif typ == "CARD" and len(digits) == 16:
                if int(digits[-1]) != (int(luhn_check_digit(body)) + card_offset(self.key, sink)) % 10:
                    continue
                real = self.ff1.decrypt(digits[:15], sink.encode())
                real += luhn_check_digit(real)
            else:
                return False
            if reg is None or reg.contains(typ, real):
                return True
        return False

    def _pseudo(self, typ, value, sink):
        h = hmac.new(self.key, f"{typ}|{sink}|{value}".encode(), hashlib.sha256).hexdigest()[:10]
        return f"<{typ}:{h}>"

    def _replace(self, f, value, sink):
        digits = re.sub(r"[^0-9]", "", value)
        want = self.mask_policy.get(sink, {}).get(f.type)
        shown = digits[-10:] if f.type == "MOBILE" else digits
        if want and self.ledger is not None and len(shown) == LENGTH.get(f.type):
            granted, _ = self.ledger.decide(f.type, shown, sink, want)
            if granted != "token":
                return render(shown, positions(granted, len(shown)))
        if f.type == "AADHAAR" and len(digits) == 12:
            return cc_token_aadhaar(self.ff1, self.key, digits, sink)
        if f.type == "CARD" and len(digits) == 16:
            return cc_token_card(self.ff1, self.key, digits, sink)
        if f.type == "OTP":
            return "<OTP:destroyed>"
        return self._pseudo(f.type, value, sink)

    def _edits(self, findings, text, sink):
        """(start, end, replacement) for findings on `text`; split fields part by part."""
        out = []
        for f in findings:
            value = f.meta.get("value", text[f.start:f.end])
            value = f.meta.get("repaired", value)  # a typo'd number is tokenised as the customer it belongs to
            rep = self._replace(f, value, sink)
            parts = f.meta.get("parts")
            if parts and rep.isdigit() and len(rep) == 4 * len(parts):
                out += [(a, b, rep[4 * i:4 * i + 4]) for i, (a, b) in enumerate(parts)]
            elif parts:
                out += [(a, b, rep if i == 0 else "") for i, (a, b) in enumerate(parts)]
            else:
                out.append((f.start, f.end, rep))
        return out

    @staticmethod
    def _apply(text, edits):
        out, last = [], 0
        for a, b, rep in sorted(edits):
            if a < last:
                continue  # overlapping edit; the earlier one already covers it
            out.append(text[last:a]); out.append(rep); last = b
        out.append(text[last:])
        return "".join(out)

    def process(self, line, src, sink, hour=0, trace_id=None):
        """Returns (clean_line, findings). Findings below threshold pass through raw and are
        counted as raw in the flow record, so the immune layer still sees them. trace_id is
        the request's W3C trace ID (from the traceparent header), used by the OTP registry."""
        self.sinks.add(sink)
        t = self.thresholds.get(sink, 0.5)
        findings = self.det.scan(line, threshold=min(t, 0.2), trace_id=trace_id)
        hit = [f for f in findings if f.p >= t]
        raw = len(findings) - len(hit)
        edits = self._edits([f for f in hit if "layer" not in f.meta], line, sink)
        blobs = defaultdict(list)
        for f in hit:
            if "layer" in f.meta:
                blobs[(f.start, f.end)].append(f)
        for (a, b), fs in blobs.items():
            dec, lay = fs[0].meta["decoded"], fs[0].meta["layer"]
            inner = []
            for f in fs:
                g = type(f)(f.type, *f.meta["inner"], p=f.p, meta={k: v for k, v in f.meta.items() if k != "parts"})
                if f.meta.get("parts"):
                    g.meta["parts"] = f.meta["parts"]
                inner.append(g)
            edits.append((a, b, b64_encode(self._apply(dec, self._edits(inner, dec, sink)), lay["alphabet"], lay["padded"])))
        if findings:
            fl = self.flows[(src, sink, hour)]
            fl["n"] += 1; fl["raw"] += int(raw > 0); fl["classes"] |= {f.type for f in findings}
        return self._apply(line, edits), findings

    def flow_records(self):
        recs = []
        for (src, sink, hour), fl in self.flows.items():
            recs.append(dict(day=0, hour=hour, src=src, sink=sink, classes=set(fl["classes"]), n=fl["n"],
                             raw_frac=fl["raw"] / fl["n"], detok_rate=fl["detok"] / fl["n"], cust_ratio=0.85, label=0, attack=None))
        return recs

    def immune_alerts(self):
        if self.ais is None or not self.flows:
            return []
        recs = self.flow_records()
        scores = self.ais.score(self.feat.transform(recs))
        return [(r, float(s)) for r, s in zip(recs, scores) if s > 0]
