"""Calibrated sensitive-data detector.

Owner pair: Bharadhwaj M, SN Arun Vijay (AI/ML).

Each recogniser proposes candidate spans with evidence (checksum result, context
classifier score, NER marginal, nearby keywords). A per-type logistic regression turns
the evidence into a score, and isotonic regression (Zadrozny & Elkan 2002) maps the
score to a calibrated probability, fitted on a split the models never saw. "p=0.9"
then means about 9 in 10 such findings are real, which is what lets the firewall pick
block / tokenise / alert thresholds per channel instead of trusting a regex hit.
"""
import math
import os
import re
import sys
from dataclasses import dataclass, field

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aran_core import luhn_valid, verhoeff_valid  # noqa: E402

from firewall.normalise import identity_views  # noqa: E402
from firewall.registry import CustomerRegistry, canonical, typo_neighbours  # noqa: E402

from .context_clf import UPI_REGISTRY, candidates  # noqa: E402

# A full stop next to a number only rules it out when it is a decimal point (digit on the
# other side): "mobile 9876543210." ends a sentence (red-team finding, E15). ASCII digits
# only: Python's \d also matches Devanagari and other digits, and a number mixing scripts
# ("9८7६...") reached the checksum code and crashed it (E15). The normaliser maps every
# script to ASCII first, so nothing is lost.
AADHAAR = re.compile(r"(?<!\d)(?<!\d\.)([2-9]\d{3})[ -]?(\d{4})[ -]?(\d{4})(?!\d|\.\d)", re.ASCII)
CARD = re.compile(r"(?<!\d)(?<!\d\.)(\d(?:[ -]?\d){12,18})(?!\d|\.\d)", re.ASCII)
MOBILE = re.compile(r"(?<!\w)(?<!\d\.)(?:\+91[ -]?)?[6-9]\d{9}(?!\d|\.\d)", re.ASCII)
PAN = re.compile(r"(?<![A-Z0-9])[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z](?![A-Z0-9])")
IIN = re.compile(r"^(4|5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720|60|65|81|82|508|3[47]|35)")
KEYWORDS = {
    "AADHAAR": r"aadhaa?r|uid|kyc|आधार",
    "CARD": r"card|pan\b|cc|debit|credit|chargeback|कार्ड",
    "MOBILE": r"mobile|phone|call|sms|number|ivr|whatsapp|मोबाइल|फ़ोन|फोन|naya number",
    "PAN": r"\bpan\b|income tax|पैन",
}
# Indian numbering cues for a bare 10-digit number (roadmap item 3): a JSON key or
# key=value field named like a phone, a preposition or verb that takes a phone number,
# and words that announce a reference number instead.
MOBILE_KEY = re.compile(r"(mob|mobile|phone|ph|msisdn|cell|contact|tel|whatsapp|alt_no|rmn)\w*[\"']?\s*[:=]\s*[\"']?(\+91[ -]?)?$", re.I)
SEND_TO = re.compile(r"(\bto|\bfrom|\bon|\bat|call|dial|sms|reach|registered|linked|\bno\.?|number|को|पर|pe)\s*[:=]?\s*$", re.I)
ID_WORDS = re.compile(r"txn|rrn|utr|ref|order|ticket|invoice|acct|a/c|account|cust_id|id\b|batch|job|build|seq|pid|खाता|आदेश", re.I)
CALENDAR = re.compile(r"\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|"
                      r"saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|"
                      r"april|june|july|august|september|october|november|december)\b", re.I)
PERSON_CUE = re.compile(r"(customer|cust|name|holder|payer|payee|applicant|dear|for|by|from|shri|smt|mr|mrs|ms|"
                        r"ग्राहक|नाम|जी|ji|bhai|madam|sir)\W*$", re.I)
ADDR_CUE = re.compile(r"(address|addr|residing at|at|pickup|dispatch|पता|ghar)\W*$", re.I)
TYPES = ["AADHAAR", "CARD", "MOBILE", "PAN", "OTP", "UPI", "PER", "ADDR"]


@dataclass
class Finding:
    type: str
    start: int
    end: int
    p: float = 0.0
    evidence: dict = field(default_factory=dict)
    meta: dict = field(default_factory=dict)  # registry result, canonical value, view mapping; not model input


def _kw(text, s, e, typ):
    rx = KEYWORDS.get(typ)
    return float(bool(rx and re.search(rx, text[max(0, s - 40):e + 20], re.I)))


def _logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def bayes(p, lr, floor=1e-3):
    """Posterior after evidence with likelihood ratio lr. A hit in a registry is strong
    enough to overrule a model that said 0, so the prior is floored before a large lr."""
    if lr == 1.0:
        return p
    if lr > 1.0:
        p = max(p, floor)
    p = min(p, 1 - 1e-12)
    o = p / (1 - p) * lr
    return o / (1 + o)


class Detector:
    def __init__(self, ner=None, otp_clf=None, upi_clf=None, registry=None, otp_registry=None, normaliser=None,
                 miss_lr=None, token_check=None, ner_gate=None):
        self.ner, self.otp_clf, self.upi_clf = ner, otp_clf, upi_clf
        self.ner_gate = ner_gate  # e.g. ai.ner.may_have_entities: skip the CRF on lines that cannot hold a name
        self.stack, self.iso = {}, {}
        # Evidence the bank owns (see firewall/registry.py). A hit multiplies the odds by
        # about 1/eps; a miss is neutral unless miss_lr says otherwise for that type (a
        # bank that is sure its registry covers every number it could leak can set e.g.
        # {"CARD": 0.05}). token_check(digits, type) says whether a checksum-failing
        # number is one of this bank's own Aran tokens, so typo repair never flags them.
        self.registry, self.otp_registry, self.normaliser = registry, otp_registry, normaliser
        self.miss_lr = miss_lr or {}
        self.token_check = token_check

    # ------------------------------------------------------------ candidate proposal
    def propose(self, text, trace_id=None):
        out = []
        for m in AADHAAR.finditer(text):
            d = "".join(m.groups())
            out.append(Finding("AADHAAR", m.start(), m.end(),
                               evidence=dict(checksum=float(verhoeff_valid(d)), kw=_kw(text, m.start(), m.end(), "AADHAAR"))))
        for m in CARD.finditer(text):
            d = re.sub(r"[ -]", "", m.group(1))
            out.append(Finding("CARD", m.start(), m.end(),
                               evidence=dict(checksum=float(luhn_valid(d)), iin=float(bool(IIN.match(d))),
                                             len16=float(len(d) == 16), kw=_kw(text, m.start(), m.end(), "CARD"))))
        for m in MOBILE.finditer(text):
            left = text[max(0, m.start() - 32):m.start()]
            lw = " ".join(re.findall(r"[\w/]+", left.lower())[-3:])
            out.append(Finding("MOBILE", m.start(), m.end(),
                               evidence=dict(plus91=float(m.group().startswith("+91")), kw=_kw(text, m.start(), m.end(), "MOBILE"),
                                             keyfield=float(bool(MOBILE_KEY.search(left))),
                                             sendto=float(bool(SEND_TO.search(left))),
                                             idword=float(bool(ID_WORDS.search(lw))))))
        for m in PAN.finditer(text):
            out.append(Finding("PAN", m.start(), m.end(), evidence=dict(kw=_kw(text, m.start(), m.end(), "PAN"))))
        for kind, clf, typ in (("otp", self.otp_clf, "OTP"), ("upi", self.upi_clf, "UPI")):
            spans = list(candidates(text, kind))
            if spans and clf is not None:
                for (s, e), z in zip(spans, clf.decision([(text, s, e) for s, e in spans])):
                    ev = dict(ctx=float(z))
                    if typ == "UPI":
                        handle = text[s:e].partition("@")[2].lower()
                        ev.update(registry=float(handle in UPI_REGISTRY), hdot=float("." in handle))
                    out.append(Finding(typ, s, e, evidence=ev))
            elif spans and typ == "OTP" and self.otp_registry is not None and trace_id:
                out += [Finding("OTP", s, e, evidence=dict(ctx=0.0)) for s, e in spans]
        gate = getattr(self, "ner_gate", None)  # detectors pickled before the gate existed
        if self.ner is not None and (gate is None or gate(text)):
            for s, e, typ, p in self.ner.entities(text):
                if typ in ("PER", "ADDR"):
                    span, left = text[s:e], text[max(0, s - 24):s]
                    words = span.split()
                    ev = dict(ner=_logit(p), ntok=min(len(words), 8) / 8, digit=float(any(c.isdigit() for c in span)),
                              calendar=float(bool(CALENDAR.search(span))),
                              title=sum(w[:1].isupper() for w in words) / len(words),
                              deva=float(bool(re.search(r"[\u0900-\u097F]", span))),
                              cue=float(bool((PERSON_CUE if typ == "PER" else ADDR_CUE).search(left))))
                    if typ == "ADDR":
                        ev["pin"] = float(bool(re.search(r"\b[1-9]\d{5}\b", span)))
                        ev["comma"] = float("," in span)
                    out.append(Finding(typ, s, e, evidence=ev))
        return out

    @staticmethod
    def _vec(f):
        return [f.evidence[k] for k in sorted(f.evidence)]

    # ------------------------------------------------------------ training
    def fit_stack(self, findings, labels):
        """findings: list of Finding, labels: 0/1. Fits per-type logistic stackers."""
        for typ in TYPES:
            idx = [i for i, f in enumerate(findings) if f.type == typ]
            ys = [labels[i] for i in idx]
            if len(set(ys)) < 2:
                continue
            X = np.array([self._vec(findings[i]) for i in idx])
            self.stack[typ] = LogisticRegression(C=10.0, max_iter=1000).fit(X, ys)

    def raw_score(self, f):
        m = self.stack.get(f.type)
        if m is None:
            return 0.5
        return float(m.predict_proba(np.array([self._vec(f)]))[0, 1])

    def fit_calibration(self, findings, labels):
        for typ in TYPES:
            idx = [i for i, f in enumerate(findings) if f.type == typ]
            ys = [labels[i] for i in idx]
            if len(set(ys)) < 2:
                continue
            s = [self.raw_score(findings[i]) for i in idx]
            self.iso[typ] = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(s, ys)

    def calibrated(self, f, text=None, trace_id=None):
        """Calibrated probability; with `text`, registry evidence is added on top."""
        value = canonical(f.type, text[f.start:f.end]) if text is not None else None
        # Hard gate from the Aran design (Theorem 1): a 12-digit or card-length number that
        # fails its checksum is either an Aran token or not an identifier, never a leak...
        if f.type in ("AADHAAR", "CARD") and f.evidence.get("checksum") == 0.0:
            # ...unless it is one typo away from a registered customer and is not our token.
            return self._typo(f, value) if value is not None and self.registry is not None else 0.0
        s = self.raw_score(f)
        iso = self.iso.get(f.type)
        p = float(iso.predict([s])[0]) if iso is not None else s
        if value is None:
            return p
        if self.registry is not None and f.type in CustomerRegistry.TYPES:
            hit = self.registry.contains(f.type, value)
            f.meta["registry"] = "hit" if hit else "miss"
            p = bayes(p, self.registry.likelihood_ratio() if hit else self.miss_lr.get(f.type, 1.0))
        if self.otp_registry is not None and f.type == "OTP":
            hit = self.otp_registry.contains(value, trace_id)
            f.meta["registry"] = "hit" if hit else ("miss" if trace_id else "no trace id")
            if hit:
                p = bayes(p, 10.0 ** len(value))  # chance that a non-OTP number equals the live OTP
            elif self.otp_clf is None:
                p = 0.0  # candidate came from the registry path only; a miss means nothing found
        return p

    def _typo(self, f, digits):
        if len(digits) not in ((12,) if f.type == "AADHAAR" else (16,)):
            return 0.0
        neighbours = typo_neighbours(digits, f.type)
        hits = [v for v in neighbours if self.registry.contains(f.type, v)]
        if not hits or (self.token_check is not None and self.token_check(digits, f.type)):
            return 0.0
        prior = Finding(f.type, f.start, f.end, evidence=dict(f.evidence, checksum=1.0))
        s = self.raw_score(prior)
        iso = self.iso.get(f.type)
        p = float(iso.predict([s])[0]) if iso is not None else s
        f.meta.update(registry="typo", repaired=hits[0])
        return bayes(p, self.registry.likelihood_ratio(len(neighbours)))

    # ------------------------------------------------------------ inference
    def _split(self, view, trace_id):
        """A split-field view only counts if the joined value passes its checksum and the
        line names the type nearby or the registry knows the value."""
        d = view.text
        typ = "AADHAAR" if len(d) == 12 else "CARD"
        ok = verhoeff_valid(d) and d[0] not in "01" if typ == "AADHAAR" else luhn_valid(d) and bool(IIN.match(d))
        if not ok:
            return []
        a, b = view.parts[0][0], view.parts[-1][1]
        kw = _kw(view.base, a, b, typ)
        hit = self.registry is not None and self.registry.contains(typ, d)
        if not (kw or hit):
            return []
        ev = dict(checksum=1.0, kw=kw)
        if typ == "CARD":
            ev.update(iin=1.0, len16=1.0)
        f = Finding(typ, 0, len(d), evidence=ev)
        f.p = self.calibrated(f, d, trace_id)
        return [f]

    def _scan_view(self, text, threshold, trace_id):
        found = []
        for f in self.propose(text, trace_id):
            f.p = self.calibrated(f, text, trace_id)
            if f.p >= threshold:
                found.append(f)
        # overlapping findings: keep the most probable, then the longest
        found.sort(key=lambda f: (-f.p, -(f.end - f.start)))
        kept = []
        for f in found:
            if all(f.end <= k.start or f.start >= k.end for k in kept):
                kept.append(f)
        return kept

    def scan(self, text, threshold=0.5, trace_id=None):
        """Findings in original-line coordinates. With a normaliser, each view of the line
        is scanned; f.meta carries the canonical value, and for split fields the parts, and
        for base64 blobs the decoded text and span inside it, so the firewall can replace
        values in place."""
        views = self.normaliser.views(text) if self.normaliser is not None else identity_views(text)
        plain, special = [], []
        for v in views:
            fs = self._split(v, trace_id) if v.parts else self._scan_view(v.text, threshold, trace_id)
            for f in fs:
                if f.p < threshold:
                    continue
                f.meta["value"] = v.text[f.start:f.end]
                a, b = v.span(f.start, f.end)
                if v.parts:
                    f.meta["parts"] = v.parts
                if v.layer is not None:
                    f.meta.update(layer=v.layer, inner=(a, b), decoded=v.base)
                    f.start, f.end = v.layer["start"], v.layer["end"]
                    special.append(f)
                elif v.parts:
                    f.start, f.end = a, b
                    special.append(f)
                else:
                    f.start, f.end = a, b
                    plain.append(f)
        # findings from different views of the same text: keep the most probable
        plain.sort(key=lambda f: (-f.p, -(f.end - f.start)))
        kept = []
        for f in plain:
            if all(f.end <= k.start or f.start >= k.end for k in kept):
                kept.append(f)
        # a split value or a base64 blob is handled as a whole; drop plain findings inside it
        cover = []
        for f in special:
            cover += [(f.start, f.end)] if "layer" in f.meta else f.meta["parts"]
        kept = [f for f in kept if all(f.end <= a or f.start >= b for a, b in cover)]
        seen, uniq = set(), []
        for f in special:
            key = (f.type, f.meta["value"], f.start, f.end, f.meta.get("inner"))
            if key not in seen:
                seen.add(key); uniq.append(f)
        return sorted(kept + uniq, key=lambda f: f.start)


def label_findings(findings, gold_spans):
    """A finding is correct if it overlaps a gold span of the same type."""
    return [int(any(t == f.type and f.start < b and f.end > a for a, b, t in gold_spans)) for f in findings]


def ece(p, y, bins=10):
    p, y = np.asarray(p), np.asarray(y)
    tot = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        m = (p >= lo) & ((p < hi) if b < bins - 1 else (p <= hi))
        if m.any():
            tot += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(tot)


def reliability(p, y, bins=10):
    p, y = np.asarray(p), np.asarray(y)
    rows = []
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        m = (p >= lo) & ((p < hi) if b < bins - 1 else (p <= hi))
        if m.any():
            rows.append(dict(bin=f"{lo:.1f}-{hi:.1f}", n=int(m.sum()), mean_p=round(float(p[m].mean()), 3),
                             frac_true=round(float(y[m].mean()), 3)))
    return rows
