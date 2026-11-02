"""Cryptographic bill of materials (CBOM) for a Python code base.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

India's quantum-safe task force (DST, Feb 2026) asks technology providers for a CBOM: a
list of every cryptographic algorithm a product uses, where, and whether a quantum
computer breaks it. This scanner reads source files, finds known primitives by pattern,
and writes a CycloneDX 1.6 style CBOM with a quantum verdict per algorithm:

  broken     Shor's algorithm recovers the private key (RSA, ECDSA, ECDH, Ed25519, X25519, DH)
  weakened   Grover's algorithm halves the bit strength (128-bit AES keys drop to 64 bits)
  safe       NIST post-quantum algorithms, AES-256, SHA-256 and longer hashes, HMAC-SHA256

It also lists places where a 128-bit key is generated, since those are the AES uses that
Grover weakens. Pattern matching, not program analysis: it can miss indirect uses.

Usage: python -m pqc.cbom [root] [out.json]
"""
import json
import os
import re
import sys

# name, primitive, pattern, quantum verdict, classical bits, NIST PQ level (None if broken)
RULES = [
    ("Ed25519", "signature", r"\bEd25519(Private|Public)Key\b", "broken", 128, None),
    ("X25519", "key-agreement", r"\bX25519(Private|Public)Key\b", "broken", 128, None),
    ("RSA", "pke/signature", r"\brsa\.generate_private_key|\bRSAPublicKey\b|from Crypto.PublicKey import RSA", "broken", 112, None),
    ("ECDSA/ECDH", "signature/key-agreement", r"\bec\.(generate_private_key|ECDSA|ECDH)\b", "broken", 128, None),
    ("ML-DSA-65", "signature", r"\bMLDSA65(Private|Public)Key\b", "safe", 192, 3),
    ("ML-KEM-768", "kem", r"\bMLKEM768(Private|Public)Key\b", "safe", 192, 3),
    ("AES-GCM", "ae", r"\bAESGCM\(", "depends on key size", None, None),
    ("AES (FF1 format-preserving encryption)", "block-cipher", r"algorithms\.AES\(", "depends on key size", None, None),
    ("SHA-256", "hash", r"hashlib\.sha256|hashes\.SHA256", "safe", 128, 1),
    ("SHA3-256", "hash", r"hashlib\.sha3_256", "safe", 128, 1),
    ("HMAC-SHA256", "mac", r"hmac\.new\(", "safe", 256, 5),
]
# A classical algorithm in a file that pairs it with its post-quantum partner is a hybrid use.
HYBRID = {"Ed25519": (r"MLDSA65|HybridSigner", "ML-DSA-65"), "X25519": (r"MLKEM768|HybridKEM", "ML-KEM-768")}
SKIP = re.compile(r"^(test_|experiment|cbom\.py$)")
KEY128 = re.compile(r"(key\w*)\s*=\s*(secrets\.token_bytes|os\.urandom)\(16\)")


def scan(root):
    found, weak_keys = {}, []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "data")]
        for f in files:
            if not f.endswith(".py") or SKIP.match(f):
                continue
            path = os.path.join(dirpath, f)
            rel = os.path.relpath(path, root)
            with open(path, encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
            lines = text.splitlines()
            for i, line in enumerate(lines, 1):
                if line.lstrip().startswith("#"):
                    continue
                for name, prim, pat, verdict, bits, level in RULES:
                    if re.search(pat, line):
                        if name in HYBRID and re.search(HYBRID[name][0], text):
                            name, verdict = f"{name} (hybrid with {HYBRID[name][1]})", "safe while the PQ half holds"
                        found.setdefault(name, dict(primitive=prim, quantum=verdict, classical_bits=bits,
                                                    nist_level=level, occurrences=[]))["occurrences"].append(f"{rel}:{i}")
                if KEY128.search(line):
                    weak_keys.append(f"{rel}:{i}")
    return found, weak_keys


def to_cyclonedx(found, weak_keys):
    comps = []
    for name, d in sorted(found.items()):
        comps.append({
            "type": "cryptographic-asset", "name": name, "bom-ref": "crypto/" + name,
            "cryptoProperties": {"assetType": "algorithm",
                                 "algorithmProperties": {"primitive": d["primitive"],
                                                         "classicalSecurityLevel": d["classical_bits"],
                                                         "nistQuantumSecurityLevel": d["nist_level"] or 0}},
            "properties": [{"name": "aran:quantum", "value": d["quantum"]}],
            "evidence": {"occurrences": [{"location": o} for o in d["occurrences"]]},
        })
    return {"bomFormat": "CycloneDX", "specVersion": "1.6", "components": comps,
            "properties": [{"name": "aran:128-bit-key-generation", "value": w} for w in weak_keys]}


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    found, weak = scan(root)
    out = to_cyclonedx(found, weak)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w") as fh:
            json.dump(out, fh, indent=1)
    for name, d in sorted(found.items(), key=lambda kv: kv[1]["quantum"]):
        print(f"{name:42s} {d['quantum']:22s} {len(d['occurrences'])} uses")
    print("128-bit keys generated at:", *weak, sep="\n  ")
