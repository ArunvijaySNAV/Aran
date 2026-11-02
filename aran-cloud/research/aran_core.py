"""Core primitives for the Aran research prototype.

Checksums (Verhoeff, Luhn), NIST SP 800-38G FF1 format-preserving encryption,
checksum-complement tokens, and min-entropy leakage counting for masks.
"""
import hashlib
import hmac
import math
import secrets

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# ---------------------------------------------------------------- Verhoeff
# Multiplication table of the dihedral group D5, permutation table, inverse.
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][ord(ch) - 48]]
    return c == 0


def verhoeff_check_digit(payload: str) -> str:
    c = 0
    for i, ch in enumerate(reversed(payload)):
        c = _D[c][_P[(i + 1) % 8][ord(ch) - 48]]
    return str(_INV[c])


# ---------------------------------------------------------------- Luhn
def luhn_valid(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def luhn_check_digit(payload: str) -> str:
    for d in "0123456789":
        if luhn_valid(payload + d):
            return d
    raise ValueError(payload)


# ---------------------------------------------------------------- FF1 (NIST SP 800-38G)
def _num(x, radix):
    n = 0
    for d in x:
        n = n * radix + d
    return n


def _str(n, radix, m):
    out = [0] * m
    for i in range(m - 1, -1, -1):
        out[i] = n % radix
        n //= radix
    return out


class FF1:
    def __init__(self, key: bytes, radix: int = 10):
        self.radix = radix
        self._ecb = Cipher(algorithms.AES(key), modes.ECB())

    def _ciph(self, block: bytes) -> bytes:
        e = self._ecb.encryptor()
        return e.update(block) + e.finalize()

    def _prf(self, data: bytes) -> bytes:
        y = bytes(16)
        for i in range(0, len(data), 16):
            y = self._ciph(bytes(a ^ b for a, b in zip(y, data[i:i + 16])))
        return y

    def _rounds(self, x, tweak: bytes, decrypt: bool):
        radix, n, t = self.radix, len(x), len(tweak)
        u, v = n // 2, n - n // 2
        a, b = list(x[:u]), list(x[u:])
        bl = math.ceil(math.ceil(v * math.log2(radix)) / 8)
        d = 4 * math.ceil(bl / 4) + 4
        p = bytes([1, 2, 1]) + radix.to_bytes(3, "big") + bytes([10, u % 256]) + n.to_bytes(4, "big") + t.to_bytes(4, "big")
        order = range(9, -1, -1) if decrypt else range(10)
        for i in order:
            src = a if decrypt else b
            q = tweak + bytes((-t - bl - 1) % 16) + bytes([i]) + _num(src, radix).to_bytes(bl, "big")
            r = self._prf(p + q)
            s = r
            j = 1
            while len(s) < d:
                s += self._ciph(bytes(x ^ y for x, y in zip(r, j.to_bytes(16, "big"))))
                j += 1
            y = int.from_bytes(s[:d], "big")
            m = u if i % 2 == 0 else v
            if decrypt:
                c = (_num(b, radix) - y) % (radix ** m)
                b, a = a, _str(c, radix, m)
            else:
                c = (_num(a, radix) + y) % (radix ** m)
                a, b = b, _str(c, radix, m)
        return a + b

    def encrypt(self, digits: str, tweak: bytes = b"") -> str:
        return "".join(map(str, self._rounds([int(c) for c in digits], tweak, False)))

    def decrypt(self, digits: str, tweak: bytes = b"") -> str:
        return "".join(map(str, self._rounds([int(c) for c in digits], tweak, True)))


# ---------------------------------------------------------------- checksum-complement tokens
def _offset(key: bytes, sink: str) -> int:
    """Keyed non-zero offset 1..9 that replaces the true check digit."""
    return 1 + hmac.new(key, sink.encode(), hashlib.sha256).digest()[0] % 9


def cc_token_aadhaar(ff1: FF1, key: bytes, aadhaar: str, sink: str) -> str:
    """Vaultless checksum-complement token: always fails Verhoeff by construction."""
    body = ff1.encrypt(aadhaar[:11], sink.encode())
    bad = (int(verhoeff_check_digit(body)) + _offset(key, sink)) % 10
    return body + str(bad)


def cc_detokenize_aadhaar(ff1: FF1, token: str, sink: str) -> str:
    body = ff1.decrypt(token[:11], sink.encode())
    return body + verhoeff_check_digit(body)


def random_cc_token(n_payload: int, check_fn) -> str:
    """Vault-mode token: uniform random payload plus a deliberately wrong check digit."""
    body = "".join(secrets.choice("0123456789") for _ in range(n_payload))
    good = int(check_fn(body))
    bad = (good + 1 + secrets.randbelow(9)) % 10
    return body + str(bad)


# ---------------------------------------------------------------- min-entropy of masks
def count_verhoeff_completions(known: dict, length: int = 12, first_digit_min: int = 2) -> int:
    """Count length-digit strings that pass Verhoeff, match the known positions
    (index -> digit, 0-based from the left) and respect the Aadhaar first-digit rule.
    Dynamic programme over the D5 state, right to left."""
    states = {0: 1}
    for i in range(length):  # i = position counted from the right
        pos = length - 1 - i
        choices = [known[pos]] if pos in known else range(10)
        if pos == 0:
            choices = [c for c in choices if c >= first_digit_min]
        nxt = {}
        for s, cnt in states.items():
            for dgt in choices:
                ns = _D[s][_P[i % 8][dgt]]
                nxt[ns] = nxt.get(ns, 0) + cnt
        states = nxt
    return states.get(0, 0)


def count_luhn_completions(known: dict, length: int = 16) -> int:
    states = {0: 1}
    for i in range(length):
        pos = length - 1 - i
        choices = [known[pos]] if pos in known else range(10)
        nxt = {}
        for s, cnt in states.items():
            for dgt in choices:
                v = dgt * 2 - 9 if (i % 2 == 1 and dgt * 2 > 9) else (dgt * 2 if i % 2 == 1 else dgt)
                ns = (s + v) % 10
                nxt[ns] = nxt.get(ns, 0) + cnt
        states = nxt
    return states.get(0, 0)
