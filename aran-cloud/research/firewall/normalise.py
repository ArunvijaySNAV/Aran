"""Normaliser: undo the common ways an identifier gets hidden before detection runs.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

The first thing a security reviewer tries is to slip an Aadhaar past the firewall in a
form the patterns do not expect. The normaliser turns each line into one or more
"views" the detector can read, and keeps a map from every character of a view back to
the original line, so whatever the detector finds can be replaced in place.

What it undoes:
  * escapes: URL percent-encoding (%32%33), JSON \\u0032, HTML &#50; and &#x32;
  * digits in other scripts: Devanagari ०-९, Tamil ௦-௯, Bengali, Gujarati, Arabic-Indic and
    every other Unicode decimal digit, plus full-width ０-９ and Ａ-Ｚ
  * zero-width characters and soft hyphens hidden inside a number
  * separators inside a number: 2345.6789.0123, 2345_6789_0123, 2 3 4 5 6 7 8 9 0 1 2 3,
    98765 43210 (only for digit-group shapes that identifiers actually have)
  * split fields: "a1":"2345","a2":"6789","a3":"0123" becomes one candidate whose parts
    are replaced in place, so the JSON keeps its shape
  * base64 blobs (standard and URL-safe) that decode to readable text; the decoded text is
    scanned, and the blob is re-encoded after replacement
"""
import base64
import binascii
import re
import unicodedata
from dataclasses import dataclass, field

ZERO_WIDTH = {"​", "‌", "‍", "⁠", "﻿", "­", "᠎"}
PCT_RUN = re.compile(r"(?:%[0-9A-Fa-f]{2})+")
JSON_U = re.compile(r"\\u([0-9A-Fa-f]{4})")
HTML_ENT = re.compile(r"&#(?:x([0-9A-Fa-f]{1,6})|(\d{1,7}));")
SEP = r"[ \t._/\\|,*·:\-]{1,3}"
# identifier-shaped digit groups with one repeated separator between them
GROUPED = [
    re.compile(r"(?<!\d)\d{4}(" + SEP + r")\d{4}(?:\1\d{4}){1,2}(?!\d)"),         # 4-4-4 Aadhaar, 4-4-4-4 card
    re.compile(r"(?<!\d)\d{4}(" + SEP + r")\d{6}\1\d{4,5}(?!\d)"),                 # 4-6-5 and 4-6-4 cards
    re.compile(r"(?<![\d+])[6-9]\d{4}([ \t._\-]{1,2})\d{5}(?!\d)"),                 # 98765 43210 mobile
    re.compile(r"(?<![\d+])[6-9]\d{2}([ \t._\-]{1,2})\d{3}\1\d{4}(?!\d)"),         # 987-654-3210 mobile
    re.compile(r"(?<!\d)\d(?:([ \t._\-·*|,:/])\d)(?:\1\d){8,17}(?!\d)"),           # 2 3 4 5 ... spaced digits (10 for a mobile)
]
B64 = re.compile(r"(?<![A-Za-z0-9+/_\-])[A-Za-z0-9+/_\-]{16,}={0,2}(?![A-Za-z0-9+/=_\-])")
FOUR = re.compile(r"(?<!\d)\d{4}(?!\d)")
DIGIT_RUN = re.compile(r"\d{3,}")


@dataclass
class View:
    """A string the detector scans, with a map back to `base`.

    start_of[k], end_of[k]: the range in `base` that character k of `text` came from.
    layer: None for views of the original line; for a decoded base64 blob, the blob's
    span in the original line and how to re-encode it.
    parts: for a split-field view, the base ranges of each 4-digit part, in order.
    """
    text: str
    start_of: list
    end_of: list
    base: str
    layer: dict = None
    parts: list = field(default_factory=list)

    def span(self, s, e):
        return self.start_of[s], self.end_of[e - 1]


def _map_char(c):
    """One character to its canonical form ('' to drop it)."""
    if c in ZERO_WIDTH:
        return ""
    o = ord(c)
    if 0xFF01 <= o <= 0xFF5E:
        return chr(o - 0xFEE0)
    if o > 127 and c.isdecimal():
        return str(unicodedata.decimal(c))
    return c


def canonical_view(s):
    """Decode escapes and canonicalise characters, keeping the offset map."""
    chars, st, en = [], [], []

    def emit(text, a, b):
        for c in text:
            m = _map_char(c)
            if m:
                chars.append(m); st.append(a); en.append(b)

    i = 0
    while i < len(s):
        c = s[i]
        if c == "%":
            m = PCT_RUN.match(s, i)
            if m:
                raw = bytes.fromhex(m.group().replace("%", ""))
                try:
                    txt = raw.decode("utf-8")
                except UnicodeDecodeError:
                    txt = None
                if txt is not None:
                    # map each decoded character to the %XX bytes it came from
                    pos = i
                    for ch in txt:
                        nb = len(ch.encode("utf-8")) * 3
                        emit(ch, pos, pos + nb); pos += nb
                    i = m.end()
                    continue
        elif c == "\\":
            m = JSON_U.match(s, i)
            if m:
                emit(chr(int(m.group(1), 16)), i, m.end()); i = m.end()
                continue
        elif c == "&":
            m = HTML_ENT.match(s, i)
            if m:
                cp = int(m.group(1), 16) if m.group(1) else int(m.group(2))
                if cp < 0x110000:
                    emit(chr(cp), i, m.end()); i = m.end()
                    continue
        emit(c, i, i + 1)
        i += 1
    return "".join(chars), st, en


def collapse_separators(text, st, en):
    """Drop separators inside identifier-shaped digit groups."""
    drop = set()
    for rx in GROUPED:
        for m in rx.finditer(text):
            drop.update(k for k in range(m.start(), m.end()) if not text[k].isdigit())
    if not drop:
        return text, st, en
    keep = [k for k in range(len(text)) if k not in drop]
    return "".join(text[k] for k in keep), [st[k] for k in keep], [en[k] for k in keep]


def split_views(text, st, en, base, max_gap=24):
    """Runs of 3 (Aadhaar) or 4 (card) standalone 4-digit groups close together, joined.

    The gap between groups may hold field names and punctuation but no other number of 3
    or more digits. The detector still has to accept the joined value (checksum, and
    a keyword or registry hit), so a split view on its own flags nothing.
    """
    groups = [m.span() for m in FOUR.finditer(text)]
    out = []
    i = 0
    while i < len(groups):
        run = [groups[i]]
        j = i + 1
        while j < len(groups):
            a = run[-1][1]
            b = groups[j][0]
            gap = text[a:b]
            if b - a == 0 or b - a > max_gap or DIGIT_RUN.search(gap) or "\n" in gap:
                break
            run.append(groups[j]); j += 1
        if len(run) >= 3:
            for n in (4, 3):
                for k in range(0, len(run) - n + 1):
                    sel = run[k:k + n]
                    digits = "".join(text[a:b] for a, b in sel)
                    sst = [st[p] for a, b in sel for p in range(a, b)]
                    sen = [en[p] for a, b in sel for p in range(a, b)]
                    parts = [(st[a], en[b - 1]) for a, b in sel]
                    out.append(View(digits, sst, sen, base, parts=parts))
        i = j if len(run) > 1 else i + 1
    return out


def _b64_decode(blob):
    s = blob.rstrip("=")
    alphabet = "url" if ("-" in s or "_" in s) else "std"
    if alphabet == "url" and ("+" in s or "/" in s):
        return None
    pad = "=" * (-len(s) % 4)
    try:
        raw = (base64.urlsafe_b64decode if alphabet == "url" else base64.b64decode)(s + pad)
        txt = raw.decode("utf-8")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if not txt or sum(c.isprintable() or c in "\t\n" for c in txt) < 0.95 * len(txt):
        return None
    if not any(c.isdigit() for c in txt):
        return None
    return txt, alphabet, blob.endswith("=")


def b64_encode(txt, alphabet, padded):
    raw = txt.encode("utf-8")
    out = (base64.urlsafe_b64encode if alphabet == "url" else base64.b64encode)(raw).decode()
    return out if padded else out.rstrip("=")


# ---------------------------------------------------------------- red-team additions (E15)
# Spelled-out digits ("nine eight seven ..."), letters that look like digits inside a
# long number ("98765 4321O", "2345 6789 Ol23"), and escapes applied twice ("%2532").
# Off by default so E10 measures the normaliser exactly as it was built.
NUM_WORDS = {
    "zero": "0", "oh": "0", "nil": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9",
    "shunya": "0", "ek": "1", "do": "2", "teen": "3", "char": "4", "chaar": "4", "paanch": "5", "panch": "5",
    "chhe": "6", "che": "6", "saat": "7", "aath": "8", "nau": "9",
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पांच": "5", "पाँच": "5", "छह": "6", "छः": "6",
    "सात": "7", "आठ": "8", "नौ": "9",
    "பூஜ்ஜியம்": "0", "சுழியம்": "0", "ஒன்று": "1", "இரண்டு": "2", "மூன்று": "3", "நான்கு": "4", "ஐந்து": "5",
    "ஆறு": "6", "ஏழு": "7", "எட்டு": "8", "ஒன்பது": "9",
}
REPEAT = {"double": 2, "triple": 3}
WORD_TOKEN = re.compile(r"[^\s,;:/\-_.]+")
LOOKALIKE = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "B": "8"})
LOOK_RUN = re.compile(r"(?<![A-Za-z])[0-9OoIl|SB](?:[ \-]?[0-9OoIl|SB]){9,18}(?![A-Za-z])")


def words_to_digits(text, st, en, min_digits=4):
    """Runs of spelled-out digits become digits; each digit maps back to its word."""
    toks = [(m.start(), m.end(), m.group().lower()) for m in WORD_TOKEN.finditer(text)]
    out_runs, i = [], 0
    while i < len(toks):
        run, j, pend = [], i, 1
        while j < len(toks):
            a, b, w = toks[j]
            if run and text[run[-1][1]:a].strip(" ,-") != "":
                break
            if w in REPEAT and j + 1 < len(toks) and toks[j + 1][2] in NUM_WORDS:
                pend = REPEAT[w]; run.append((a, b, "")); j += 1
                continue
            if w not in NUM_WORDS:
                break
            run.append((a, b, NUM_WORDS[w] * pend)); pend = 1; j += 1
        ndig = sum(len(d) for _, _, d in run)
        if ndig >= min_digits:
            out_runs.append(run); i = j
        else:
            i += 1
    if not out_runs:
        return text, st, en
    chars, nst, nen, last = [], [], [], 0
    for run in out_runs:
        a0, b0 = run[0][0], run[-1][1]
        chars += text[last:a0]; nst += st[last:a0]; nen += en[last:a0]
        for a, b, d in run:
            for c in d:
                chars.append(c); nst.append(st[a]); nen.append(en[b - 1])
        last = b0
    chars += text[last:]; nst += st[last:]; nen += en[last:]
    return "".join(chars), nst, nen


def fix_lookalikes(text, st, en):
    """Inside a 10 to 19 character number-shaped run that is at least 70% real digits,
    read O, o as 0, I, l, | as 1, S as 5 and B as 8. One character for one, so the map
    is unchanged."""
    out = list(text)
    for m in LOOK_RUN.finditer(text):
        g = m.group()
        core = g.replace(" ", "").replace("-", "")
        if sum(c.isdigit() for c in core) >= 0.7 * len(core) and not core.isdigit():
            for k in range(m.start(), m.end()):
                out[k] = text[k].translate(LOOKALIKE)
    return "".join(out), st, en


def recanonical(text, st, en):
    """A second escape pass for doubly-escaped text, composed with the first map."""
    t2, s2, e2 = canonical_view(text)
    if t2 == text:
        return text, st, en
    return t2, [st[k] for k in s2], [en[k - 1] for k in e2]


class Normaliser:
    def __init__(self, decode_base64=True, join_split_fields=True, number_words=False, lookalikes=False,
                 double_escapes=False):
        self.decode_base64, self.join_split_fields = decode_base64, join_split_fields
        self.number_words, self.lookalikes, self.double_escapes = number_words, lookalikes, double_escapes

    def _views_of(self, base, layer=None):
        t, st, en = canonical_view(base)
        if self.double_escapes:
            t, st, en = recanonical(t, st, en)
        if self.number_words:
            t, st, en = words_to_digits(t, st, en)
        if self.lookalikes:
            t, st, en = fix_lookalikes(t, st, en)
        t, st, en = collapse_separators(t, st, en)
        views = [View(t, st, en, base, layer=layer)]
        if self.join_split_fields:
            for v in split_views(t, st, en, base):
                v.layer = layer
                views.append(v)
        return views

    def views(self, line):
        views = self._views_of(line)
        if self.decode_base64:
            for m in B64.finditer(line):
                dec = _b64_decode(m.group())
                if dec is None:
                    continue
                txt, alphabet, padded = dec
                layer = dict(start=m.start(), end=m.end(), alphabet=alphabet, padded=padded)
                views += self._views_of(txt, layer=layer)
        return views


def identity_views(line):
    n = len(line)
    return [View(line, list(range(n)), list(range(1, n + 1)), line)]
