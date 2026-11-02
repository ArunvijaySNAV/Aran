"""Leakage ledger (M4): cap how much any group of sinks learns about one identifier.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

A mask such as "last 4 digits" looks safe field by field, but sinks that can join their
data see the union of what each was shown. One vendor system shows the first 6 digits of
a card and another the last 4: together they leave 100,000 candidates (16.6 bits), and a
script tries those in seconds. The ledger measures this exactly and refuses it.

For an identifier X of type t and a trust domain D (sinks that can join data, such as all
systems of one vendor), the ledger keeps the set of digit positions any sink in D has been
shown. Remaining uncertainty is the min-entropy

    H_inf(X | view_D) = log2 #{ x' of type t : x' agrees with X on the shown positions }

counted exactly with the dynamic programmes in aran_core (Verhoeff for Aadhaar, Luhn for
cards) or in closed form (mobiles: first digit 6 to 9, no checksum). A new disclosure is
allowed only if every domain containing the sink stays at or above the threshold tau_t.
Otherwise the ledger offers the richest smaller mask that keeps every domain above tau_t,
and if none exists, a token (which shows no digits).

The ledger never stores identifiers: entries are keyed by HMAC(K, type|value) and hold
one bitmask of shown positions per domain. Min-entropy assumes identifiers are uniform
over the valid set; real issuance is not, so tau should be set with margin (research doc,
section 6).
"""
import hashlib
import hmac
import math
import os
import sys
from functools import lru_cache

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aran_core import count_luhn_completions, count_verhoeff_completions  # noqa: E402

LENGTH = {"AADHAAR": 12, "CARD": 16, "MOBILE": 10}


def positions(mask, n):
    """Digit positions shown by a named mask on an n-digit identifier.
    Masks: none, token, lastK, firstK, firstJlastK (e.g. first6last4), full."""
    if mask in ("none", "token"):
        return frozenset()
    if mask == "full":
        return frozenset(range(n))
    first = last = 0
    m = mask
    if m.startswith("first"):
        m = m[5:]
        k = 0
        while k < len(m) and m[k].isdigit():
            k += 1
        first, m = int(m[:k]), m[k:]
    if m.startswith("last"):
        last = int(m[4:])
    elif m:
        raise ValueError(f"unknown mask {mask!r}")
    if first + last > n:
        raise ValueError(f"mask {mask!r} shows more than {n} digits")
    return frozenset(range(first)) | frozenset(range(n - last, n))


@lru_cache(maxsize=None)
def _count(typ, shown_key):
    """Number of valid identifiers of type typ consistent with the shown digits.
    shown_key is a tuple of (position, digit) pairs."""
    known = dict(shown_key)
    if typ == "AADHAAR":
        return count_verhoeff_completions(known)
    if typ == "CARD":
        return count_luhn_completions(known)
    if typ == "MOBILE":
        first = 1 if 0 in known else 4  # first digit is 6, 7, 8 or 9
        if 0 in known and known[0] < 6:
            return 0
        return first * 10 ** (10 - 1 - sum(1 for p in known if p != 0))
    raise KeyError(typ)


def smaller_masks(requested, n, masks):
    """Masks from `masks` that show a strict subset of what `requested` shows, richest first."""
    want = positions(requested, n)
    out = []
    for m in masks:
        try:
            p = positions(m, n)
        except ValueError:
            continue
        if p < want:
            out.append((len(p), m))
    return [m for _, m in sorted(out, key=lambda x: -x[0])]


def bits_left(typ, digits, shown):
    """Min-entropy in bits of an identifier after the positions in `shown` are revealed."""
    c = _count(typ, tuple(sorted((p, int(digits[p])) for p in shown)))
    return math.log2(c) if c > 0 else 0.0


def render(digits, shown, fill="X"):
    return "".join(d if i in shown else fill for i, d in enumerate(digits))


class LeakageLedger:
    # Smaller masks the ledger may fall back to (only those inside the requested one).
    MASKS = ["full", "first8last4", "first6last4", "first8", "first4last4", "first6", "first4", "last4", "last2", "token"]

    def __init__(self, key, tau=None, domains=None):
        """key: HMAC key for entry names. tau: bits per type (default 20 for Aadhaar and
        cards, 16 for mobiles). domains: sink -> list of domain names; every sink is also
        its own domain, so a single sink is held to the same threshold."""
        self.key = key
        self.tau = {"AADHAAR": 20.0, "CARD": 20.0, "MOBILE": 16.0, **(tau or {})}
        self.domains = {s: list(ds) for s, ds in (domains or {}).items()}
        self.shown = {}  # (entry, domain) -> frozenset of positions
        self.log = []    # (sink, type, requested, granted, bits_after) per decision, no values

    def _entry(self, typ, digits):
        return hmac.new(self.key, f"{typ}|{digits}".encode(), hashlib.sha256).digest()[:16]

    def domains_of(self, sink):
        return [sink] + [d for d in self.domains.get(sink, []) if d != sink]

    def _worst(self, typ, digits, entry, sink, pos):
        return min(bits_left(typ, digits, self.shown.get((entry, d), frozenset()) | pos) for d in self.domains_of(sink))

    def check(self, typ, digits, sink, mask):
        """Bits left in the weakest domain if `mask` were granted, without recording it."""
        pos = positions(mask, LENGTH[typ])
        return self._worst(typ, digits, self._entry(typ, digits), sink, pos)

    def decide(self, typ, digits, sink, requested):
        """Returns (granted_mask, bits_left_in_weakest_domain) and records the grant."""
        n = LENGTH[typ]
        if len(digits) != n or not digits.isdigit():
            raise ValueError(f"{typ} needs {n} digits")
        entry = self._entry(typ, digits)
        # data minimisation: a smaller mask may only drop digits the sink asked for,
        # never show ones it did not ask for
        order = [requested] + smaller_masks(requested, n, self.MASKS)
        granted, bits = "token", None
        for m in order:
            pos = positions(m, n)
            b = self._worst(typ, digits, entry, sink, pos)
            # a mask that shows no new position cannot lower anything, so it is always allowed
            if b >= self.tau[typ] or all(pos <= self.shown.get((entry, d), frozenset()) for d in self.domains_of(sink)):
                granted, bits = m, b
                break
        if bits is None:
            bits = self._worst(typ, digits, entry, sink, frozenset())
        pos = positions(granted, n)
        for d in self.domains_of(sink):
            self.shown[(entry, d)] = self.shown.get((entry, d), frozenset()) | pos
        self.log.append((sink, typ, requested, granted, round(bits, 2)))
        return granted, bits

    def forget(self, typ, digits):
        """Drop every entry for an identifier (used with crypto-shredding on erasure)."""
        entry = self._entry(typ, digits)
        for k in [k for k in self.shown if k[0] == entry]:
            del self.shown[k]

    def nbytes(self):
        return len(self.shown) * (16 + 8 + 8)
