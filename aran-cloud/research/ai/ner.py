"""Multilingual NER for names and addresses in log text (English, Hindi, Hinglish).

Owner pair: Bharadhwaj M, SN Arun Vijay (AI/ML).

A linear-chain CRF (Lafferty et al. 2001) over hand-built features. A CRF is chosen over
a transformer because it trains in minutes on a laptop CPU, runs at log-ingest speed,
and needs no GPU in a bank's on-prem data centre. Features are script-aware so one
model covers Latin and Devanagari text.

Tags (BIO): PER (person), LOC (place), ORG (organisation), ADDR (postal address).
"""
import csv
import os
import random
import re
from functools import lru_cache

import sklearn_crfsuite

TOKEN = re.compile(r"[\wऀ-ॿ]+(?:[.'@\-/][\wऀ-ॿ]+)*|[^\s\wऀ-ॿ]")
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
PIN6 = re.compile(r"(?<!\d)[1-9]\d{5}(?!\d)")
KEY_WORDS = {"name", "customer", "cust", "holder", "payer", "payee", "applicant", "user", "dear", "for", "by",
             "from", "to", "naam", "ग्राहक", "नाम", "जी", "ji", "bhai", "madam", "sir", "shri", "smt", "mr", "mrs", "ms",
             "address", "addr", "residing", "at", "पता", "ghar", "dispatch", "pickup", "delivery"}


CAL = (r"(?:Mon|Monday|Tue|Tues|Tuesday|Wed|Wednesday|Thu|Thur|Thurs|Thursday|Fri|Friday|Sat|Saturday|Sun|Sunday|"
       r"Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|"
       r"Nov|November|Dec|December)")
TITLE_PAIR = re.compile(r"\b(?!" + CAL + r"\b)[A-Z][a-z]{2,}\s+(?!" + CAL + r"\b)[A-Z][a-z]{2,}\b|\b[A-Z]{3,}\s+[A-Z]{3,}\b")
# cue words that are common in machine logs ("for", "from", "user") count only when a
# capitalised word follows them
WEAK_CUES = {"for", "from", "to", "by", "user", "at"}
GATE_WORDS = re.compile(r"(?i:\b(" + "|".join(sorted((w for w in KEY_WORDS if w.isascii() and w not in WEAK_CUES and len(w) > 1),
                                                       key=len, reverse=True))
                        + r")\b|\b(?:road|street|nagar|salai|marg|lane|colony|flat|house)\b)"
                        r"|\b(?i:for|from|to|by|user|at)\s+(?!" + CAL + r"\b)[A-Z][a-z]")


def may_have_entities(text):
    """Cheap first stage of the NER cascade (roadmap items 7 and 12): run the CRF only on
    lines that could hold a name or an address, meaning Devanagari text, a cue word
    (customer, name, dear, address, ...), an address word, a weak cue such as "from"
    followed by a capitalised word, or two capitalised words in a row that are not dates."""
    return bool(DEVANAGARI.search(text) or GATE_WORDS.search(text) or TITLE_PAIR.search(text))


def tokenize(text):
    """Returns list of (token, start, end)."""
    return [(m.group(), m.start(), m.end()) for m in TOKEN.finditer(text)]


def _shape(w):
    s = re.sub(r"[A-Z]", "X", w)
    s = re.sub(r"[a-z]", "x", s)
    s = re.sub(r"\d", "d", s)
    s = DEVANAGARI.sub("h", s)
    return re.sub(r"(.)\1+", r"\1\1", s)


@lru_cache(maxsize=500_000)
def _base_feats(w):
    """Features of one word, computed once per distinct word (roadmap item 12). Log lines
    repeat the same words endlessly, and these regexes were 70% of the detector's time."""
    return tuple(_word_feats_uncached(w, "").items())


def _word_feats(w, p):
    if p == "":
        return dict(_base_feats(w))
    return {p + k: v for k, v in _base_feats(w)}


def _word_feats_uncached(w, p):
    lw = w.lower()
    return {
        p + "lower": lw,
        p + "suf3": lw[-3:],
        p + "suf2": lw[-2:],
        p + "pre2": lw[:2],
        p + "title": w[:1].isupper() and w[1:].islower(),
        p + "upper": w.isupper() and len(w) > 1,
        p + "digit": w.isdigit(),
        p + "hasdigit": any(c.isdigit() for c in w),
        p + "deva": bool(DEVANAGARI.search(w)),
        p + "shape": _shape(w),
        p + "key": lw in KEY_WORDS,
        p + "punct": not any(c.isalnum() for c in w) and not DEVANAGARI.search(w),
    }


def sent_features(words):
    feats = []
    n = len(words)
    for i, w in enumerate(words):
        f = {"bias": 1.0, "len": min(len(w), 12)}
        f.update(_word_feats(w, ""))
        f["pin6"] = bool(PIN6.fullmatch(w))
        for off in (-2, -1, 1, 2):
            j = i + off
            if 0 <= j < n:
                f.update({f"{off}:{k}": v for k, v in _base_feats(words[j]) if k not in ("pre2", "suf2")})
            else:
                f[f"{off}:pad"] = True
        if i > 0:
            f["-1|0"] = words[i - 1].lower() + "|" + w.lower()
        feats.append(f)
    return feats


# ---------------------------------------------------------------- corpus readers
def _norm(tag):
    if tag in ("O", "Other", ""):
        return "O"
    bio, _, typ = tag.partition("-")
    typ = typ.upper()[:3]
    typ = {"PER": "PER", "LOC": "LOC", "ORG": "ORG"}.get(typ)
    return f"{bio.upper()}-{typ}" if typ else "O"


def read_conll2003(path):
    """CoNLL-2003 uses IOB1; convert to BIO and drop MISC."""
    sents, words, tags = [], [], []
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("-DOCSTART-"):
            if words:
                sents.append((words, tags)); words, tags = [], []
            continue
        parts = line.split()
        words.append(parts[0]); tags.append(parts[-1])
    if words:
        sents.append((words, tags))
    out = []
    for ws, ts in sents:
        bio, prev = [], "O"
        for t in ts:
            if t == "O" or t.endswith("MISC"):
                bio.append("O"); prev = "O"; continue
            typ = t[2:]
            if t.startswith("B-") or prev[2:] != typ:
                bio.append("B-" + typ)
            else:
                bio.append("I-" + typ)
            prev = bio[-1]
        out.append((ws, bio))
    return out


def read_hiner(path, limit=None, seed=0):
    sents, words, tags = [], [], []
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip():
            if words:
                sents.append((words, [_norm(t) for t in tags])); words, tags = [], []
            continue
        w, _, t = line.partition("\t")
        words.append(w); tags.append(t)
    if words:
        sents.append((words, [_norm(t) for t in tags]))
    if limit and len(sents) > limit:
        sents = random.Random(seed).sample(sents, limit)
    return sents


def read_hinglish(path):
    sents, cur, words, tags = [], None, [], []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for row in csv.reader(fh):
            if len(row) < 3 or row[0] == "Sent":
                continue
            sid, w, t = row[0], row[1], row[2]
            if not sid.startswith("sent"):
                continue
            if sid != cur and words:
                sents.append((words, tags)); words, tags = [], []
            cur = sid
            if w.strip():
                words.append(w); tags.append(_norm(t))
    if words:
        sents.append((words, tags))
    return sents


def spans_to_bio(text, spans, keep=("PER", "ADDR")):
    toks = tokenize(text)
    tags = []
    for _, s, e in toks:
        tag = "O"
        for a, b, typ in spans:
            if typ in keep and s >= a and e <= b:
                tag = ("B-" if s == a or not tags or tags[-1] == "O" else "I-") + typ
                break
        tags.append(tag)
    # repair: first token of a span must be B-
    for i, t in enumerate(tags):
        if t.startswith("I-") and (i == 0 or tags[i - 1][2:] != t[2:]):
            tags[i] = "B-" + t[2:]
    return [t for t, _, _ in toks], tags


# ---------------------------------------------------------------- model
class NER:
    def __init__(self, c1=0.05, c2=0.05, max_iter=120):
        self.crf = sklearn_crfsuite.CRF(algorithm="lbfgs", c1=c1, c2=c2, max_iterations=max_iter,
                                        all_possible_transitions=True)

    def fit(self, sents):
        self.crf.fit([sent_features(w) for w, _ in sents], [t for _, t in sents])
        return self

    def predict(self, sents_words):
        return self.crf.predict([sent_features(w) for w in sents_words])

    def entities(self, text):
        """Returns list of (start, end, type, prob) on raw text; prob is the mean
        marginal probability of the predicted tags inside the span."""
        toks = tokenize(text)
        if not toks:
            return []
        words = [t for t, _, _ in toks]
        f = sent_features(words)
        tags = self.crf.predict_single(f)
        marg = self.crf.predict_marginals_single(f)
        out, i = [], 0
        while i < len(tags):
            if tags[i] == "O":
                i += 1; continue
            typ = tags[i][2:]
            j = i + 1
            while j < len(tags) and tags[j] == "I-" + typ:
                j += 1
            p = sum(marg[k][tags[k]] for k in range(i, j)) / (j - i)
            out.append((toks[i][1], toks[j - 1][2], typ, p))
            i = j
        return out


def bio_spans(tags):
    out, i = set(), 0
    while i < len(tags):
        if tags[i] == "O" or tags[i].startswith("I-"):
            i += 1; continue
        typ = tags[i][2:]
        j = i + 1
        while j < len(tags) and tags[j] == "I-" + typ:
            j += 1
        out.add((i, j, typ)); i = j
    return out


def entity_prf(gold, pred, types):
    """Exact-span entity precision, recall, F1 per type (CoNLL scoring)."""
    res = {}
    for typ in types:
        tp = fp = fn = 0
        for g, p in zip(gold, pred):
            gs = {s for s in bio_spans(g) if s[2] == typ}
            ps = {s for s in bio_spans(p) if s[2] == typ}
            tp += len(gs & ps); fp += len(ps - gs); fn += len(gs - ps)
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        res[typ] = dict(precision=round(pr, 4), recall=round(rc, 4),
                        f1=round(2 * pr * rc / (pr + rc), 4) if pr + rc else 0.0, support=tp + fn)
    return res


def load_corpora(data_dir, hiner_train_limit=20000, hiner_test_limit=5000, seed=0):
    p = lambda f: os.path.join(data_dir, f)
    hing = read_hinglish(p("hinglish_ner.csv"))
    r = random.Random(seed)
    r.shuffle(hing)
    cut = int(0.8 * len(hing))
    return {
        "conll_train": read_conll2003(p("conll_train.txt")),
        "conll_test": read_conll2003(p("conll_testb.txt")),
        "hiner_train": read_hiner(p("hiner_train.conll"), hiner_train_limit, seed),
        "hiner_test": read_hiner(p("hiner_test.conll"), hiner_test_limit, seed),
        "hinglish_train": hing[:cut],
        "hinglish_test": hing[cut:],
    }
