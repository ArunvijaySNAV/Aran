"""Learned context classifier for OTP and UPI leaks in log text.

Owner pair: Bharadhwaj M, SN Arun Vijay (AI/ML).

OTPs and UPI IDs have no checksum, so a regex alone cannot tell an OTP from a port,
latency or order number, or a UPI ID ("ravi@oksbi") from a Unix user@host
("local@tbird-admin1"). This classifier looks at the words and characters around each
candidate and outputs a probability. It is a logistic regression over hashed
features: char n-grams of the context (so Hindi "ओटीपी" and Hinglish "otp aaya" work
without a tokenizer per language) plus position-tagged neighbour words.
"""
import re

import numpy as np
from sklearn.feature_extraction import FeatureHasher
from sklearn.linear_model import LogisticRegression

NUM_CAND = re.compile(r"(?<![\w.@/+\-])(\d{4,8})(?![\w@]|\.\d)", re.ASCII)
VPA_CAND = re.compile(r"(?<![\w.\-])([\w.\-]{2,64}@[A-Za-z][A-Za-z0-9.\-]{1,63})(?!\w)")
WORD = re.compile(r"[\wऀ-ॿ]+")
# Prior knowledge written by the team, not learned: words that announce a secret code,
# words that announce an ordinary number, and the public registry of UPI handles
# (NPCI publishes the list of PSP handles; this is a subset).
OTP_WORDS = re.compile(r"otp|one[ -]?time|passcode|pass code|password|pin\b|code|token|2fa|mfa|verification|verify|secure|"
                       r"ओटीपी|कोड|पासवर्ड|पिन|सत्यापन", re.I)
NUMBER_WORDS = re.compile(r"error|status|port|pid|order|ticket|build|ms\b|bytes|files|txn|rrn|utr|amount|amt|rs\.?|inr|"
                          r"retry|retries|attempt|node|server|uptime|latency|line|id\b|no\.|त्रुटि|राशि|आदेश|सर्वर|खाता", re.I)
UPI_REGISTRY = {"okhdfcbank", "okicici", "oksbi", "okaxis", "ybl", "paytm", "ibl", "axl", "upi", "apl", "kotak", "icici",
                "sbi", "hdfcbank", "axisbank", "pnb", "barodampay", "unionbank", "indus", "fbl", "airtel", "jupiteraxis",
                "freecharge", "idfcbank", "yesbank", "rbl", "federal", "kvb", "cnrb", "boi", "mahb", "iob", "idbi", "aubank"}


def candidates(text, kind):
    """Yields (start, end) of OTP-shaped (kind='otp') or VPA-shaped (kind='upi') strings."""
    rx = NUM_CAND if kind == "otp" else VPA_CAND
    for m in rx.finditer(text):
        s, e = m.span(1)
        while e > s and text[e - 1] in ".-":
            e -= 1
        yield s, e


def _norm_ctx(s):
    return re.sub(r"\d", "0", s.lower())


def featurize(text, s, e, kind):
    left, right, cand = text[max(0, s - 48):s], text[e:e + 32], text[s:e]
    f = []
    lc, rc = _norm_ctx(left), _norm_ctx(right)
    for n in (3, 4, 5):
        f += ["lc:" + lc[i:i + n] for i in range(max(0, len(lc) - 24), len(lc) - n + 1)]
        f += ["rc:" + rc[i:i + n] for i in range(0, min(len(rc), 20) - n + 1)]
    lw = WORD.findall(left.lower())[-5:]
    rw = WORD.findall(right.lower())[:4]
    for i, w in enumerate(reversed(lw)):
        f += [f"L{i + 1}={w}", f"LB={w}"]
    for i, w in enumerate(rw):
        f += [f"R{i + 1}={w}", f"RB={w}"]
    near = " ".join(lw[-3:])
    f += [f"otpword_near={bool(OTP_WORDS.search(near))}", f"otpword_left={bool(OTP_WORDS.search(left))}",
          f"otpword_right={bool(OTP_WORDS.search(right[:24]))}", f"numword_near={bool(NUMBER_WORDS.search(near))}",
          f"numword_right={bool(NUMBER_WORDS.search(' '.join(rw[:2])))}"]
    # Which cue is nearest on the left, and both kinds of cue together: "OTP for txn
    # TXN123 is 482913" has a number word next to the value but an OTP word earlier in
    # the same clause, and a linear model needs the pair as its own feature to learn that.
    clause = re.split(r"[.;|!?\n]", left)[-1]
    cw = WORD.findall(clause.lower())
    nearest = "none"
    for w in reversed(cw[-8:]):
        if OTP_WORDS.search(w):
            nearest = "otp"; break
        if NUMBER_WORDS.search(w):
            nearest = "num"; break
    otp_clause = bool(OTP_WORDS.search(clause))
    f += [f"nearest_cue={nearest}", f"otp_in_clause={otp_clause}",
          f"cue_pair={otp_clause}|{bool(NUMBER_WORDS.search(near))}",
          f"connector={bool(re.search(r'(\bis|:|=|\bhai|है)\s*$', left))}"]
    f.append("lpunct=" + (left.rstrip()[-1:] if left.strip() else "^"))
    f.append("rpunct=" + (right.lstrip()[:1] if right.strip() else "$"))
    if kind == "otp":
        f += [f"len={len(cand)}", f"lead0={cand[0] == '0'}", f"rep={len(set(cand)) <= 2}"]
    else:
        local, _, handle = cand.partition("@")
        f += [f"registry={handle.lower() in UPI_REGISTRY}", f"H={handle.lower()}", f"hdot={'.' in handle}", f"hdash={'-' in handle}", f"hdigit={any(c.isdigit() for c in handle)}",
              f"hlen={min(len(handle), 12)}", f"ldigits={local.isdigit()}", f"llen={min(len(local), 16)}",
              f"ldot={'.' in local}"]
        f += ["h3:" + handle.lower()[i:i + 3] for i in range(len(handle) - 2)]
    return f


class ContextClassifier:
    def __init__(self, kind, C=1.0):
        self.kind = kind
        self.hasher = FeatureHasher(n_features=2 ** 20, input_type="string", alternate_sign=False)
        self.lr = LogisticRegression(C=C, max_iter=2000, solver="liblinear")

    def _X(self, items):
        return self.hasher.transform(featurize(t, s, e, self.kind) for t, s, e in items)

    def fit(self, items, y):
        self.lr.fit(self._X(items), np.asarray(y))
        return self

    def decision(self, items):
        return self.lr.decision_function(self._X(items))

    def proba(self, items):
        return self.lr.predict_proba(self._X(items))[:, 1]


def label_candidates(rows, kind):
    """From synthetic rows (text + spans) build candidate items with labels.
    Candidates inside other sensitive spans (Aadhaar groups, mobiles, cards) are skipped:
    those are owned by the checksum recognisers, not this classifier."""
    want = "OTP" if kind == "otp" else "UPI"
    items, y = [], []
    for r in rows:
        for s, e in candidates(r["text"], kind):
            hit = [t for a, b, t in r["spans"] if s < b and e > a]
            if hit and want not in hit:
                continue
            items.append((r["text"], s, e)); y.append(int(want in hit))
    return items, y


def real_negatives(lines, kind):
    items = []
    for ln in lines:
        for s, e in candidates(ln, kind):
            items.append((ln, s, e))
    return items
