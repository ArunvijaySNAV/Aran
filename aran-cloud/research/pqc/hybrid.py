"""Hybrid post-quantum building blocks for Aran.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

Two pieces, each pairing a classical algorithm with a NIST post-quantum one, so the result
stays secure while either half holds:

  HybridSigner   Ed25519 + ML-DSA-65 (FIPS 204). A message counts as signed only if BOTH
                 signatures verify. Used for erasure receipts (shredder.py).
  HybridKEM      X25519 + ML-KEM-768 (FIPS 203), combined X-Wing style:
                 key = SHA3-256(label || ss_mlkem || ss_x25519 || ct_x25519 || pk_x25519).
                 Used to wrap purpose keys when they must leave the vault (backup, DR site).

ClassicalKEM is X25519 alone, kept only so experiments can show what a quantum attacker
gains against today's setup.

mosca() is Mosca's inequality: data is exposed if shelf_life + migration_time > years_to_crqc.

Everything uses the `cryptography` package (50.x ships ML-KEM and ML-DSA); no new dependency.
"""
import base64
import hashlib
import json
import secrets

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import mldsa, mlkem
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SIG_ALG = "Ed25519+ML-DSA-65"
KEM_ALG = "X25519+ML-KEM-768"
CLASSICAL_KEM_ALG = "X25519"
_SPKI = (serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
_RAW = (serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def b64(b):
    return base64.b64encode(b).decode()


def unb64(s):
    return base64.b64decode(s.encode())


# ---------------------------------------------------------------- signatures
class HybridSigner:
    """Ed25519 + ML-DSA-65. Both signatures cover the same bytes, under a context label."""

    def __init__(self, ed_key=None, ml_key=None, context=b"aran-v2"):
        self.ed = ed_key or Ed25519PrivateKey.generate()
        self.ml = ml_key or mldsa.MLDSA65PrivateKey.generate()
        self.context = context

    def sign(self, data: bytes) -> dict:
        return dict(alg=SIG_ALG,
                    ed25519=b64(self.ed.sign(self.context + b"|" + data)),
                    ml_dsa_65=b64(self.ml.sign(data, self.context)))

    def public(self) -> dict:
        return dict(alg=SIG_ALG,
                    ed25519=self.ed.public_key().public_bytes(*_SPKI).decode(),
                    ml_dsa_65=self.ml.public_key().public_bytes(*_SPKI).decode())


def verify_hybrid(public: dict, sig: dict, data: bytes, context=b"aran-v2") -> dict:
    """Returns each half's result; valid only when both halves verify."""
    out = dict(ed25519=False, ml_dsa_65=False)
    ed = serialization.load_pem_public_key(public["ed25519"].encode())
    ml = serialization.load_pem_public_key(public["ml_dsa_65"].encode())
    assert isinstance(ed, Ed25519PublicKey) and isinstance(ml, mldsa.MLDSA65PublicKey)
    try:
        ed.verify(unb64(sig["ed25519"]), context + b"|" + data); out["ed25519"] = True
    except (InvalidSignature, KeyError, ValueError):
        pass
    try:
        ml.verify(unb64(sig["ml_dsa_65"]), data, context); out["ml_dsa_65"] = True
    except (InvalidSignature, KeyError, ValueError):
        pass
    out["valid"] = out["ed25519"] and out["ml_dsa_65"]
    return out


# ---------------------------------------------------------------- key encapsulation
def _combine(ss_ml, ss_x, ct_x, pk_x, label=b"aran-xwing-v1"):
    return hashlib.sha3_256(label + ss_ml + ss_x + ct_x + pk_x).digest()


class HybridKEM:
    """X25519 + ML-KEM-768 recipient key pair. Ciphertext = 32-byte X25519 share + 1088-byte ML-KEM ct."""

    alg = KEM_ALG

    def __init__(self):
        self.x = X25519PrivateKey.generate()
        self.ml = mlkem.MLKEM768PrivateKey.generate()

    def public(self):
        return dict(alg=KEM_ALG, x25519=self.x.public_key().public_bytes(*_RAW),
                    ml_kem_768=self.ml.public_key().public_bytes_raw())

    @staticmethod
    def encapsulate(pub):
        pk_x = pub["x25519"]
        eph = X25519PrivateKey.generate()
        ct_x = eph.public_key().public_bytes(*_RAW)
        ss_x = eph.exchange(X25519PublicKey.from_public_bytes(pk_x))
        ss_ml, ct_ml = mlkem.MLKEM768PublicKey.from_public_bytes(pub["ml_kem_768"]).encapsulate()
        return _combine(ss_ml, ss_x, ct_x, pk_x), ct_x + ct_ml

    def decapsulate(self, ct):
        ct_x, ct_ml = ct[:32], ct[32:]
        ss_x = self.x.exchange(X25519PublicKey.from_public_bytes(ct_x))
        ss_ml = self.ml.decapsulate(ct_ml)
        return _combine(ss_ml, ss_x, ct_x, self.x.public_key().public_bytes(*_RAW))


class ClassicalKEM:
    """X25519 alone (ECIES-style), the way most key backups and TLS sessions work today."""

    alg = CLASSICAL_KEM_ALG

    def __init__(self):
        self.x = X25519PrivateKey.generate()

    def public(self):
        return dict(alg=CLASSICAL_KEM_ALG, x25519=self.x.public_key().public_bytes(*_RAW))

    @staticmethod
    def encapsulate(pub):
        eph = X25519PrivateKey.generate()
        ct_x = eph.public_key().public_bytes(*_RAW)
        ss = eph.exchange(X25519PublicKey.from_public_bytes(pub["x25519"]))
        return hashlib.sha3_256(b"aran-x25519-v1" + ss + ct_x + pub["x25519"]).digest(), ct_x

    def decapsulate(self, ct):
        ss = self.x.exchange(X25519PublicKey.from_public_bytes(ct))
        return hashlib.sha3_256(b"aran-x25519-v1" + ss + ct + self.x.public_key().public_bytes(*_RAW)).digest()


_KEMS = {KEM_ALG: HybridKEM, CLASSICAL_KEM_ALG: ClassicalKEM}


def wrap_keys(pub, keys: dict) -> bytes:
    """Seal {name: 32-byte key} to a recipient: KEM, then AES-256-GCM over the JSON."""
    k, ct = _KEMS[pub["alg"]].encapsulate(pub)
    nonce = secrets.token_bytes(12)
    body = json.dumps({n: b64(bytes(v)) for n, v in keys.items()}, sort_keys=True).encode()
    header = json.dumps(dict(alg=pub["alg"], ct=b64(ct), nonce=b64(nonce)), sort_keys=True).encode()
    return header + b"\n" + AESGCM(k).encrypt(nonce, body, header)


def unwrap_keys(recipient, blob: bytes, shared_secret=None) -> dict:
    """Open a blob with the recipient's private key, or with an already-known shared secret
    (that is what an attacker holds after breaking the KEM)."""
    header, sealed = blob.split(b"\n", 1)
    h = json.loads(header)
    k = shared_secret if shared_secret is not None else recipient.decapsulate(unb64(h["ct"]))
    body = AESGCM(k).decrypt(unb64(h["nonce"]), sealed, header)
    return {n: bytearray(unb64(v)) for n, v in json.loads(body).items()}


def blob_header(blob: bytes) -> dict:
    return json.loads(blob.split(b"\n", 1)[0])


# ---------------------------------------------------------------- planning
def mosca(shelf_life, migration_years, years_to_crqc):
    """Mosca's inequality. Returns years of exposure (> 0 means data will still matter
    after a quantum computer exists, while it was protected by breakable crypto)."""
    return shelf_life + migration_years - years_to_crqc
