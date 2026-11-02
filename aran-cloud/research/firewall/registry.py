"""Own-customer registry, trace-bound OTP registry, and typo repair.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

Detection by shape alone has a floor: a bare 10-digit number may or may not be a
mobile, and a 6-digit number may or may not be an OTP. The bank already knows which
numbers are its customers' and which OTPs it has just issued, so Aran asks it.

* CustomerRegistry: HMAC(K, type|value) of every Aadhaar, card, mobile and PAN the bank
  holds, stored in a cuckoo filter (Fan et al., CoNEXT 2014). A cuckoo filter keeps a
  short fingerprint per item in one of two buckets, so it supports deletion (DPDP
  erasure), which a Bloom filter cannot. With f-bit fingerprints and buckets of b slots
  the false-positive rate is at most 2b / 2^f; f = 32, b = 4 gives about 1.9e-9.
  Without K the filter reveals nothing; testing one Aadhaar needs K.
* OtpRegistry: HMAC(K, otp|trace_id) with a time to live. A 4 to 8 digit string in a
  line is an OTP leak if its HMAC with that line's trace ID is live. Without the trace
  binding, a random 6-digit number would match one of L live OTPs with probability
  L / 10^6 (7% at 70,000 live OTPs); with it, about 10^-6 per candidate.
* typo_neighbours: a real Aadhaar or card number with one wrong digit or one adjacent
  swap fails its checksum and would look like an Aran token. Verhoeff catches every such
  error and Luhn catches every single-digit error, so Aran tries every single edit that
  passes the checksum and asks the registry. A registered neighbour means a leak.
"""
import hashlib
import hmac
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aran_core import luhn_valid, verhoeff_valid  # noqa: E402


class CuckooFilter:
    """Partial-key cuckoo hashing with 32-bit fingerprints and 4-slot buckets.

    The alternate bucket is i XOR hash(fingerprint), so either bucket can be found from
    the other and the fingerprint alone, which is what makes moving ("kicking") items
    and deleting them possible without the original key.
    """

    SLOTS = 4
    MAX_KICKS = 500

    def __init__(self, capacity, seed=0):
        n = max(1, int(capacity / (self.SLOTS * 0.95)))
        self.nb = 1 << (n - 1).bit_length()  # power of two, so XOR stays in range
        self.t = np.zeros((self.nb, self.SLOTS), dtype=np.uint32)  # 0 means empty
        self.count = 0
        self._rng = np.random.default_rng(seed)

    @staticmethod
    def _split(digest):
        fp = int.from_bytes(digest[:4], "big") or 1
        return fp, int.from_bytes(digest[4:12], "big")

    def _alt(self, i, fp):
        h = int.from_bytes(hashlib.blake2b(fp.to_bytes(4, "big"), digest_size=8).digest(), "big")
        return (i ^ h) & (self.nb - 1)

    def _buckets(self, digest):
        fp, h = self._split(digest)
        i1 = h & (self.nb - 1)
        return fp, i1, self._alt(i1, fp)

    def _put(self, i, fp):
        row = self.t[i]
        free = np.flatnonzero(row == 0)
        if free.size:
            row[free[0]] = fp
            return True
        return False

    def add(self, digest):
        fp, i1, i2 = self._buckets(digest)
        if self._put(i1, fp) or self._put(i2, fp):
            self.count += 1
            return True
        i = i1 if self._rng.random() < 0.5 else i2
        for _ in range(self.MAX_KICKS):
            j = int(self._rng.integers(self.SLOTS))
            fp, self.t[i, j] = int(self.t[i, j]), fp
            i = self._alt(i, fp)
            if self._put(i, fp):
                self.count += 1
                return True
        raise OverflowError("cuckoo filter full; build it with a larger capacity")

    def __contains__(self, digest):
        fp, i1, i2 = self._buckets(digest)
        return bool((self.t[i1] == fp).any() or (self.t[i2] == fp).any())

    def remove(self, digest):
        fp, i1, i2 = self._buckets(digest)
        for i in (i1, i2):
            hit = np.flatnonzero(self.t[i] == fp)
            if hit.size:
                self.t[i, hit[0]] = 0
                self.count -= 1
                return True
        return False

    def false_positive_bound(self):
        return 2 * self.SLOTS / 2 ** 32

    def nbytes(self):
        return self.t.nbytes


def canonical(typ, value):
    """Registry key form: digits only for numbers (+91 and separators dropped), upper case for PAN."""
    if typ == "PAN":
        return value.strip().upper()
    d = "".join(c for c in value if c.isdigit())
    if typ == "MOBILE" and len(d) == 12 and d.startswith("91"):
        d = d[2:]
    return d


class CustomerRegistry:
    TYPES = ("AADHAAR", "CARD", "MOBILE", "PAN")

    def __init__(self, key, capacity=1_000_000):
        self.key = key
        self.f = CuckooFilter(capacity)
        self.lookups = 0

    def _h(self, typ, value):
        return hmac.new(self.key, f"cust|{typ}|{canonical(typ, value)}".encode(), hashlib.sha256).digest()

    def add(self, typ, value):
        self.f.add(self._h(typ, value))

    def remove(self, typ, value):
        """DPDP erasure: the customer's identifiers stop being recognised."""
        return self.f.remove(self._h(typ, value))

    def contains(self, typ, value):
        self.lookups += 1
        return self._h(typ, value) in self.f

    def likelihood_ratio(self, lookups=1):
        """Likelihood ratio of a hit: P(hit | real) / P(hit | not real), at most 1 / (lookups * eps)."""
        return 1.0 / (lookups * self.f.false_positive_bound())


class OtpRegistry:
    """Issued OTPs bound to the trace that issued them, each with a time to live."""

    def __init__(self, key, ttl=300.0, clock=time.time):
        self.key, self.ttl, self.clock = key, ttl, clock
        self.live = {}

    def _h(self, otp, trace_id):
        return hmac.new(self.key, f"otp|{trace_id}|{otp}".encode(), hashlib.sha256).digest()[:16]

    def issue(self, otp, trace_id):
        self.live[self._h(otp, trace_id)] = self.clock() + self.ttl

    def expire(self):
        now = self.clock()
        for h in [h for h, t in self.live.items() if t < now]:
            del self.live[h]

    def contains(self, otp, trace_id):
        if not trace_id:
            return False
        t = self.live.get(self._h(otp, trace_id))
        return t is not None and t >= self.clock()

    def false_positive_bound(self):
        # a 128-bit HMAC prefix: a wrong (otp, trace) pair matches a live entry with
        # probability about len(live) / 2^128, far below the 10^-6 of guessing the OTP itself
        return max(len(self.live), 1) / 2 ** 128


def typo_neighbours(digits, typ):
    """Every string one substitution or one adjacent swap away that passes the checksum.

    For a 12-digit Aadhaar that is at most 108 substitutions + 11 swaps; for a 16-digit
    card 144 + 15. About one in ten pass the checksum, so a lookup tests about 12 values.
    """
    valid = verhoeff_valid if typ == "AADHAAR" else luhn_valid
    out, n = set(), len(digits)
    for i in range(n):
        for c in "0123456789":
            if c != digits[i]:
                v = digits[:i] + c + digits[i + 1:]
                if valid(v) and not (typ == "AADHAAR" and v[0] in "01"):
                    out.add(v)
    for i in range(n - 1):
        if digits[i] != digits[i + 1]:
            v = digits[:i] + digits[i + 1] + digits[i] + digits[i + 2:]
            if valid(v) and not (typ == "AADHAAR" and v[0] in "01"):
                out.add(v)
    return sorted(out)
