"""Purpose-bound crypto-shredding with Merkle erasure receipts (mechanism M5).

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

Each customer gets one random 256-bit key per purpose (KYC, Loans, Service, Marketing).
In vault mode, an identifier headed to a sink is replaced by a random token that keeps
the identifier's shape and fails its checksum (Theorem 1 still holds); the vault keeps
only AES-256-GCM ciphertext of the value under that customer's purpose key. Destroying
the key makes every token issued for that purpose permanently unreadable, wherever the
token was copied (logs, vendors, backups): the copies stay, the meaning is gone.

Every key creation and destruction is appended to a Merkle log (RFC 6962 hashing). An
erasure returns a receipt: the event, the log root at that size, the inclusion proof,
and a hybrid signature over all of it: Ed25519 plus ML-DSA-65 (FIPS 204, post-quantum),
both required. Anyone with the public keys can check that the erasure was recorded and has
not been rewritten since, even after a quantum computer can forge Ed25519 alone.
Receipts made before the upgrade (Ed25519 only, no "alg" field) still verify, unless the
verifier is told to require post-quantum receipts (require_pq=True), which blocks a forger
who strips the ML-DSA half and presents the receipt as an old one.

A purpose can carry a retention lock (KYC records must be kept for a period under the
PMLA rules). Erasure of a locked purpose is refused until the lock ends.

Software key store for the demo; a bank would keep the keys in an HSM or cloud KMS.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aran_core import luhn_check_digit, random_cc_token, verhoeff_check_digit  # noqa: E402

from pqc.hybrid import SIG_ALG, HybridSigner, verify_hybrid  # noqa: E402

from .aran_firewall import AranFirewall  # noqa: E402
from .registry import canonical  # noqa: E402

PURPOSES = ("KYC", "Loans", "Service", "Marketing")


class Erased(Exception):
    """The purpose key behind a token has been destroyed."""


# ---------------------------------------------------------------- Merkle log (RFC 6962)
def _leaf(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def _node(a: bytes, b: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + a + b).digest()


def _k(n):
    """Largest power of two smaller than n."""
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def _root(leaves):
    if not leaves:
        return hashlib.sha256(b"").digest()
    if len(leaves) == 1:
        return leaves[0]
    k = _k(len(leaves))
    return _node(_root(leaves[:k]), _root(leaves[k:]))


def _path(m, leaves):
    if len(leaves) <= 1:
        return []
    k = _k(len(leaves))
    if m < k:
        return _path(m, leaves[:k]) + [_root(leaves[k:])]
    return _path(m - k, leaves[k:]) + [_root(leaves[:k])]


def verify_inclusion(leaf_hash: bytes, index: int, size: int, path, root: bytes) -> bool:
    """RFC 9162 section 2.1.3.2 inclusion proof check."""
    if index >= size:
        return False
    fn, sn, r = index, size - 1, leaf_hash
    for p in path:
        if sn == 0:
            return False
        if fn % 2 == 1 or fn == sn:
            r = _node(p, r)
            if fn % 2 == 0:
                while fn % 2 == 0 and fn != 0:
                    fn >>= 1; sn >>= 1
        else:
            r = _node(r, p)
        fn >>= 1; sn >>= 1
    return sn == 0 and r == root


class MerkleLog:
    def __init__(self):
        self.entries, self.leaves = [], []

    def append(self, event: dict) -> int:
        data = json.dumps(event, sort_keys=True, separators=(",", ":")).encode()
        self.entries.append(event); self.leaves.append(_leaf(data))
        return len(self.leaves) - 1

    def root(self, size=None):
        return _root(self.leaves[:len(self.leaves) if size is None else size])

    def proof(self, index, size=None):
        return _path(index, self.leaves[:len(self.leaves) if size is None else size])


def _b64(b):
    return base64.b64encode(b).decode()


def _unb64(s):
    return base64.b64decode(s.encode())


# ---------------------------------------------------------------- vault
class PurposeVault:
    def __init__(self, index_key=None, signing_key=None, clock=time.time, pq=True, store=None):
        self.store = store
        self.clock = clock
        self.detok_calls = []

        if self.store is not None:
            # 1. Index Key (A2)
            if index_key is not None:
                self.index_key = index_key
                self.store.save_system_key("index_key", self.index_key)
            else:
                loaded_idx = self.store.load_system_key("index_key")
                if loaded_idx is not None:
                    self.index_key = loaded_idx
                else:
                    self.index_key = secrets.token_bytes(32)
                    self.store.save_system_key("index_key", self.index_key)

            # 2. Signing Keys
            if signing_key is not None:
                self.sk = signing_key
                self.signer = HybridSigner(ed_key=self.sk) if pq else None
            else:
                loaded_signer = self.store.load_hybrid_signer("primary_signer")
                if loaded_signer is not None:
                    ed_priv, ml_priv, ed_pub, ml_pub = loaded_signer
                    self.sk = Ed25519PrivateKey.from_private_bytes(ed_priv)
                    ml_sk = serialization.load_der_private_key(ml_priv, password=None)
                    self.signer = HybridSigner(ed_key=self.sk, ml_key=ml_sk) if pq else None
                else:
                    self.sk = Ed25519PrivateKey.generate()
                    self.signer = HybridSigner(ed_key=self.sk) if pq else None
                    if self.signer is not None:
                        ed_priv_bytes = self.sk.private_bytes(
                            serialization.Encoding.Raw,
                            serialization.PrivateFormat.Raw,
                            serialization.NoEncryption(),
                        )
                        ml_priv_bytes = self.signer.ml.private_bytes(
                            serialization.Encoding.DER,
                            serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption(),
                        )
                        pub = self.signer.public()
                        self.store.save_hybrid_signer(
                            "primary_signer",
                            ed_priv_bytes,
                            ml_priv_bytes,
                            pub["ed25519"],
                            pub["ml_dsa_65"],
                        )

            # 3. Purpose Keys & Locks
            self.keys = {}
            self.locks = {}
            loaded_pkeys = self.store.load_all_purpose_keys()
            for (c, p), val in loaded_pkeys.items():
                self.keys[(c, p)] = val["key"]
                if val.get("locked_until") is not None:
                    self.locks[(c, p)] = val["locked_until"]

            # 4. Vault Tokens
            self.vault = self.store.load_all_vault_tokens()

            # 5. Owner Index
            self.owner = self.store.load_all_owners()

            # 6. Destroyed Receipts
            self.destroyed = self.store.load_all_erasure_receipts()

            # 7. Merkle Log
            self.log = MerkleLog()
            loaded_leaves = self.store.load_merkle_log()
            self.log.entries = [x[2] for x in loaded_leaves]
            self.log.leaves = [x[1] for x in loaded_leaves]
        else:
            self.index_key = index_key or secrets.token_bytes(32)
            self.sk = signing_key or Ed25519PrivateKey.generate()
            self.signer = HybridSigner(ed_key=self.sk) if pq else None
            self.keys = {}        # (customer_ref, purpose) -> bytearray key, absent once destroyed
            self.locks = {}       # (customer_ref, purpose) -> retain-until timestamp
            self.destroyed = {}   # (customer_ref, purpose) -> receipt
            self.owner = {}       # HMAC(type, value) -> customer_ref
            self.vault = {}       # token -> dict(customer, purpose, sink, type, nonce, ct)
            self.log = MerkleLog()

    # ------------------------------------------------------------ customers and keys
    def _owner_key(self, typ, value):
        return hmac.new(self.index_key, f"own|{typ}|{canonical(typ, value)}".encode(), hashlib.sha256).digest()

    def enroll(self, customer_ref, identifiers, retain=None):
        """identifiers: {type: value}. retain: {purpose: retain-until timestamp}."""
        for typ, value in identifiers.items():
            k = self._owner_key(typ, value)
            self.owner[k] = customer_ref
            if self.store is not None:
                self.store.save_owner(k, customer_ref)
        for p in PURPOSES:
            k = (customer_ref, p)
            if k not in self.keys:
                key_bytes = secrets.token_bytes(32)
                self.keys[k] = bytearray(key_bytes)
                event = dict(event="KEY_CREATED", customer=customer_ref, purpose=p, at=round(self.clock(), 3))
                idx = self.log.append(event)
                until = (retain or {}).get(p)
                if self.store is not None:
                    self.store.save_purpose_key(customer_ref, p, key_bytes, locked_until=until)
                    self.store.append_merkle_leaf(idx, self.log.leaves[idx], event)
        for p, until in (retain or {}).items():
            self.locks[(customer_ref, p)] = until

    def owner_of(self, typ, value):
        return self.owner.get(self._owner_key(typ, value))

    def key_status(self, customer_ref):
        now = self.clock()
        out = []
        for p in PURPOSES:
            k = (customer_ref, p)
            out.append(dict(purpose=p, alive=k in self.keys,
                            tokens=sum(1 for v in self.vault.values() if v["customer"] == customer_ref and v["purpose"] == p),
                            locked_until=self.locks.get(k) if self.locks.get(k, 0) > now else None,
                            receipt=self.destroyed.get(k)))
        return out

    # ------------------------------------------------------------ tokens
    def tokenise(self, typ, value, customer_ref, purpose, sink):
        key = self.keys.get((customer_ref, purpose))
        if key is None:
            raise Erased(f"{purpose} key for {customer_ref} was destroyed")
        digits = "".join(c for c in value if c.isdigit())
        while True:
            if typ == "AADHAAR" and len(digits) == 12:
                tok = random_cc_token(11, verhoeff_check_digit)
            elif typ == "CARD" and len(digits) == 16:
                tok = random_cc_token(15, luhn_check_digit)
            else:
                tok = f"<{typ}:v{secrets.token_hex(5)}>"
            if tok not in self.vault:
                break
        nonce = secrets.token_bytes(12)
        ct = AESGCM(bytes(key)).encrypt(nonce, value.encode(), tok.encode())
        at_ts = round(self.clock(), 3)
        self.vault[tok] = dict(customer=customer_ref, purpose=purpose, sink=sink, type=typ, nonce=nonce, ct=ct,
                               at=at_ts)
        if self.store is not None:
            try:
                self.store.save_vault_token(tok, customer_ref, purpose, sink, typ, nonce, ct, at_ts)
            except Exception:
                pass
        return tok

    def detokenise(self, token, caller="unknown"):
        e = self.vault.get(token)
        if e is None:
            raise KeyError("not a vault token")
        self.detok_calls.append(dict(token=token, caller=caller, sink=e["sink"], at=round(self.clock(), 3)))
        key = self.keys.get((e["customer"], e["purpose"]))
        if key is None:
            raise Erased(f"{e['purpose']} key for {e['customer']} was destroyed")
        return AESGCM(bytes(key)).decrypt(e["nonce"], e["ct"], token.encode()).decode()

    # ------------------------------------------------------------ erasure
    def erase(self, customer_ref, purpose):
        k = (customer_ref, purpose)
        if k in self.destroyed:
            return self.destroyed[k]
        if k not in self.keys:
            raise KeyError("no such customer or purpose")
        until = self.locks.get(k, 0)
        if until > self.clock():
            raise PermissionError(f"{purpose} records are under a retention lock until "
                                  f"{time.strftime('%d %b %Y', time.gmtime(until))}")
        key = self.keys.pop(k)
        for i in range(len(key)):
            key[i] = 0  # overwrite the only copy before dropping it
        tokens = sum(1 for v in self.vault.values() if v["customer"] == customer_ref and v["purpose"] == purpose)
        event = dict(event="KEY_DESTROYED", customer=customer_ref, purpose=purpose, tokens_unreadable=tokens,
                     at=round(self.clock(), 3))
        idx = self.log.append(event)
        size = len(self.log.leaves)
        body = dict(event=event, leaf_index=idx, tree_size=size, root=_b64(self.log.root(size)),
                    proof=[_b64(p) for p in self.log.proof(idx, size)])
        if self.signer is None:  # legacy Ed25519-only receipt
            sig = self.sk.sign(json.dumps(body, sort_keys=True, separators=(",", ":")).encode())
            receipt = dict(body, signature=_b64(sig), public_key=self.public_key_pem())
        else:
            body["alg"] = SIG_ALG  # signed, so it cannot be stripped without breaking both signatures
            sig = self.signer.sign(json.dumps(body, sort_keys=True, separators=(",", ":")).encode())
            pub = self.signer.public()
            receipt = dict(body, signature=sig["ed25519"], public_key=pub["ed25519"],
                           pq_signature=sig["ml_dsa_65"], pq_public_key=pub["ml_dsa_65"])
        self.destroyed[k] = receipt
        if self.store is not None:
            self.store.delete_purpose_key(customer_ref, purpose)
            self.store.append_merkle_leaf(idx, self.log.leaves[idx], event)
            self.store.save_erasure_receipt(customer_ref, purpose, receipt)
            self.store.checkpoint_and_truncate()
        return receipt

    def public_key_pem(self):
        return self.sk.public_key().public_bytes(serialization.Encoding.PEM,
                                                 serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def verify_receipt(receipt, require_pq=False) -> dict:
    """Checks a receipt on its own: signature(s), then inclusion of the event in the signed root.

    require_pq=True rejects Ed25519-only receipts; turn it on once Ed25519 can no longer be
    trusted on its own (or for receipts dated after the bank's migration)."""
    fields = ("event", "leaf_index", "tree_size", "root", "proof") + (("alg",) if "alg" in receipt else ())
    body = {k: receipt[k] for k in fields}
    msg = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    pq = None
    if receipt.get("alg") == SIG_ALG:
        res = verify_hybrid(dict(ed25519=receipt["public_key"], ml_dsa_65=receipt["pq_public_key"]),
                            dict(ed25519=receipt["signature"], ml_dsa_65=receipt.get("pq_signature", "")), msg)
        sig_ok, pq = res["valid"], res["ml_dsa_65"]
    elif "alg" in receipt:
        sig_ok = False  # unknown algorithm
    else:
        pk = serialization.load_pem_public_key(receipt["public_key"].encode())
        assert isinstance(pk, Ed25519PublicKey)
        try:
            pk.verify(_unb64(receipt["signature"]), msg)
            sig_ok = not require_pq
        except InvalidSignature:
            sig_ok = False
    leaf = _leaf(json.dumps(body["event"], sort_keys=True, separators=(",", ":")).encode())
    inc_ok = verify_inclusion(leaf, body["leaf_index"], body["tree_size"], [_unb64(p) for p in body["proof"]], _unb64(body["root"]))
    return dict(signature_valid=sig_ok, included_in_log=inc_ok, valid=sig_ok and inc_ok,
                alg=receipt.get("alg", "Ed25519"), post_quantum_valid=pq)


# ---------------------------------------------------------------- firewall in vault mode
class PurposeFirewall(AranFirewall):
    """AranFirewall that uses purpose-bound vault tokens for enrolled customers.

    sink_purpose maps each sink to the purpose its data is used for. A value of an
    enrolled customer becomes a vault token under that customer's purpose key; once the
    key is destroyed, new values for that customer and purpose are withheld outright.
    Values of people who are not enrolled fall back to the vaultless FF1 tokens."""

    def __init__(self, detector, key, vault, sink_purpose, **kw):
        super().__init__(detector, key, **kw)
        self.vault, self.sink_purpose = vault, sink_purpose

    def _replace(self, f, value, sink, purpose=None):
        purpose = purpose or self.sink_purpose.get(sink)
        if purpose and f.type in ("AADHAAR", "CARD", "MOBILE", "PAN", "UPI"):
            cust = self.vault.owner_of(f.type, value)
            if cust is not None:
                try:
                    return self.vault.tokenise(f.type, value, cust, purpose, sink)
                except Erased:
                    return f"<{f.type}:withheld-erased>"
        return super()._replace(f, value, sink)

    def is_own_token(self, digits, typ):
        return digits in self.vault.vault or super().is_own_token(digits, typ)
