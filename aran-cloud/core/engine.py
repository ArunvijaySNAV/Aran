"""The live Aran engine behind the console.

Everything here runs the research code in research/ for real: the calibrated detector
with the normaliser and both registries, the firewall in vault mode, the purpose vault
with Merkle receipts, and the artificial immune system learning this server's own
traffic. No result is hard-coded; every number the console shows is counted here.

The only generated inputs are identifiers: customers are created with checksum-valid
numbers that belong to no real person, because real Aadhaar, PAN or card numbers must
never be used outside a bank.
"""
import glob
import json
import logging
import math
import os
import pickle
import random
import re
import secrets
import subprocess
import sys
import threading
import time
from collections import defaultdict, deque

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.abspath(os.path.join(HERE, "..", "research"))
sys.path.insert(0, RESEARCH)

import synth  # noqa: E402
from ai.detector import Detector  # noqa: E402
import base64  # noqa: E402
from aran_core import FF1, _D, _num, _str, _INV, _P, _offset, luhn_check_digit, luhn_valid, verhoeff_check_digit, verhoeff_valid  # noqa: E402
from firewall.aran_firewall import card_offset  # noqa: E402
from firewall.normalise import Normaliser  # noqa: E402
from firewall.registry import CustomerRegistry, OtpRegistry, canonical  # noqa: E402
from firewall.shredder import PURPOSES, Erased, PurposeFirewall, PurposeVault, verify_receipt  # noqa: E402
from firewall.store import AranStore, BACKUP_POLICY_STATEMENT  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from immune.ais import tune_self_radius  # noqa: E402
from immune.flows import FlowFeaturizer  # noqa: E402

MODELS = os.environ.get("ARAN_MODELS", os.path.join(HERE, "models", "detector.pkl"))
LOGS_DIR = os.environ.get("ARAN_LOGS", os.path.join(RESEARCH, "data"))
WINDOW = float(os.environ.get("ARAN_WINDOW_SECONDS", "30"))

# sink -> (purpose its data serves, detection threshold)
SINKS = {
    "log-platform": ("Service", 0.5),
    "crm-notes": ("Service", 0.5),
    "loan-vendor": ("Loans", 0.5),
    "llm-gateway": ("Service", 0.3),
    "marketing-cloud": ("Marketing", 0.5),
    "kyc-archive": ("KYC", 0.5),
}
# normal traffic the replay sends: (source system, sink, Loghub systems whose real lines it carries)
REPLAY_PAIRS = [
    ("core-banking", "log-platform", ["HDFS", "Hadoop", "Spark", "Zookeeper"]),
    ("mobile-app", "log-platform", ["Android", "HealthApp"]),
    ("call-centre", "crm-notes", ["Windows", "Mac"]),
    ("loan-origination", "loan-vendor", ["OpenStack", "Apache"]),
    ("employee-desktop", "llm-gateway", ["Linux", "OpenSSH"]),
]
SAMPLES = {
    "loan": "Loan application API",
    "kyc": "KYC upload API",
    "callnote": "Call-centre note",
    "payment": "Payment callback",
    "otp": "Login with OTP",
    "chatbot": "Prompt to an AI assistant",
}
SAMPLE_SINK = {"loan": "loan-vendor", "kyc": "kyc-archive", "callnote": "crm-notes", "payment": "log-platform",
               "otp": "log-platform", "chatbot": "llm-gateway"}
SAMPLE_SOURCE = {"loan": "loan-origination", "kyc": "onboarding", "callnote": "call-centre", "payment": "upi-switch",
                 "otp": "mobile-app", "chatbot": "employee-desktop"}
ID_RX = re.compile(r"(?<![0-9A-Za-z])(\d{16}|\d{12})(?![0-9A-Za-z])")
PSEUDO_RX = re.compile(r"<(?!OTP:destroyed)[A-Z]+:[0-9a-z\-]+>")


def _p95(xs):
    return round(float(np.percentile(xs, 95)), 1) if xs else None


class Engine:
    def __init__(self, n_customers=25, seed=None, store_path=None, master_key=None):
        t0 = time.time()
        with open(MODELS, "rb") as fh:
            base = pickle.load(fh)

        # Persistence Lite support
        store_path = store_path or os.environ.get("ARAN_STORE")
        if store_path:
            master_key = master_key or os.environ.get("ARAN_MASTER_KEY")
            self.store = AranStore(data_path=store_path, master_key=master_key)
            self.key = self.store.load_system_key("ff1_key")
            if self.key is None:
                self.key = secrets.token_bytes(32)
                self.store.save_system_key("ff1_key", self.key)
        else:
            self.store = None
            self.key = secrets.token_bytes(32)  # AES-256 for FF1: Grover leaves 128-bit strength

        self.registry = CustomerRegistry(secrets.token_bytes(32), capacity=100_000)
        self.otp_registry = OtpRegistry(secrets.token_bytes(32), ttl=300.0)
        self.det = Detector(base.ner, base.otp_clf, base.upi_clf, normaliser=Normaliser(),
                            registry=self.registry, otp_registry=self.otp_registry)
        self.det.stack, self.det.iso = base.stack, base.iso
        self.vault = PurposeVault(store=self.store)
        self.fw = _IndexingFirewall(self.det, self.key, self.vault, {s: p for s, (p, _) in SINKS.items()},
                                    thresholds={s: t for s, (_, t) in SINKS.items()}, eng=self)
        self.ff1 = FF1(self.key)
        self.lock = threading.RLock()
        self.rand = random.Random(seed if seed is not None else secrets.randbits(64))
        self.started = time.time()
        self.customers = {}
        self.dynamic_customers = set()
        self.events = deque(maxlen=300)
        self.sink_store = defaultdict(lambda: deque(maxlen=500))  # what each sink actually received
        self.latency_ms = deque(maxlen=2000)
        self.counts = defaultdict(int)
        self.by_type = defaultdict(int)
        self.bypass = set()   # sinks the operator switched to monitor-only (values pass raw)
        self.immune = Immune(self)
        self.replay = Replay(self)
        self.jobs = {}

        # Rehydrate customer profiles and registry if store exists
        if self.store is not None:
            profiles = self.store.load_all_customer_profiles()
            for prof in profiles:
                ref = prof["ref"]
                self.dynamic_customers.add(ref)
                if (ref, "KYC") in self.vault.keys:
                    kyc_key = bytes(self.vault.keys[(ref, "KYC")])
                    try:
                        raw_ids_json = AESGCM(kyc_key).decrypt(
                            prof["nonce"], prof["encrypted_ids"], ref.encode("utf-8")
                        ).decode("utf-8")
                        ids = json.loads(raw_ids_json)
                        self.customers[ref] = dict(ref=ref, name=prof["name"], upi=prof["upi"], created=prof["created"], **ids)
                        for t, v in ids.items():
                            self.registry.add(t, v)
                    except Exception:
                        masked = json.loads(prof["masked_json"])
                        self.customers[ref] = dict(ref=ref, name=prof["name"], upi=prof["upi"], created=prof["created"], **masked)
                else:
                    masked = json.loads(prof["masked_json"])
                    self.customers[ref] = dict(ref=ref, name=prof["name"], upi=prof["upi"], created=prof["created"], _erased=True, **masked)

        if not self.customers:
            for _ in range(n_customers):
                self.add_customer()
        self.load_seconds = round(time.time() - t0, 1)
        if self.replay.logs:
            def _auto_learn():
                secs = int(os.environ.get("ARAN_LEARN_SECONDS", "75"))
                self.immune.start_learning(secs)
                if not self.replay.running:
                    self.replay.start(self.replay.rate)
            threading.Thread(target=_auto_learn, daemon=True).start()
        else:
            logging.warning("Log data missing in %s; skipping immune auto-learning", LOGS_DIR)

    # ------------------------------------------------------------ customers
    def add_customer(self, name=None):
        r = self.rand
        with self.lock:
            ref = f"CUST-{len(self.customers) + 1:04d}"
            aad = re.sub(r"\D", "", synth.gen_aadhaar(r))
            card = re.sub(r"\D", "", synth.gen_card(r))
            mob = re.sub(r"\D", "", synth.gen_mobile(r))[-10:]
            pan = synth.gen_pan(r)
            ids = dict(AADHAAR=aad, CARD=card, MOBILE=mob, PAN=pan)
            for t, v in ids.items():
                self.registry.add(t, v)
            name = name or synth.gen_name(r, "test")
            upi = name.split()[0].lower() + str(r.randint(10, 99)) + "@" + r.choice(synth.SPLITS["upi"]["test"])
            # KYC records are kept for 5 years after the relationship ends (PMLA rules)
            self.vault.enroll(ref, dict(ids, UPI=upi), retain={"KYC": time.time() + 5 * 365 * 86400})
            self.customers[ref] = dict(ref=ref, name=name, upi=upi, created=time.time(), **ids)
            if self.store is not None:
                kyc_key = bytes(self.vault.keys[(ref, "KYC")])
                nonce = secrets.token_bytes(12)
                enc_ids = AESGCM(kyc_key).encrypt(nonce, json.dumps(ids).encode("utf-8"), ref.encode("utf-8"))
                masked = {
                    "AADHAAR": "XXXX XXXX " + aad[-4:],
                    "CARD": "XXXX XXXX XXXX " + card[-4:],
                    "MOBILE": "XXXXXX" + mob[-4:],
                    "PAN": pan[:2] + "XXXXXX" + pan[-2:] if len(pan) >= 4 else "–",
                }
                self.store.save_customer_profile(
                    customer_ref=ref,
                    name=name,
                    upi=upi,
                    encrypted_ids=enc_ids,
                    nonce=nonce,
                    masked_json=json.dumps(masked),
                    created_at=time.time(),
                )
            return self.customers[ref]

    def customer_view(self, ref):
        c = self.customers[ref]
        aad = c.get("AADHAAR", "")
        card = c.get("CARD", "")
        mob = c.get("MOBILE", "")
        pan = c.get("PAN", "")
        masked = dict(
            AADHAAR=aad if aad.startswith("XXXX") else ("XXXX XXXX " + aad[-4:] if aad else "–"),
            CARD=card if card.startswith("XXXX") else ("XXXX XXXX XXXX " + card[-4:] if card else "–"),
            MOBILE=mob if mob.startswith("XXXX") else ("XXXXXX" + mob[-4:] if mob else "–"),
            PAN=pan if "XXXX" in pan else (pan[:2] + "XXXXXX" + pan[-2:] if len(pan) >= 4 else "–")
        )
        return dict(ref=ref, name=c.get("name", ref), masked=masked, keys=self.vault.key_status(ref))
        return dict(ref=ref, name=c.get("name", ref), masked=masked, keys=self.vault.key_status(ref))

    # ------------------------------------------------------------ requests
    def sample(self, kind, who="customer", ref=None):
        """A bank request of the given kind, filled with a real enrolled customer's
        identifiers ("customer") or with a stranger's freshly generated ones."""
        r = self.rand
        if ref is not None:
            c = self.customers[ref]
        elif who == "customer" and self.customers:
            c = self.customers[r.choice(sorted(self.customers))]
        else:
            c = dict(name=synth.gen_name(r, "test"), AADHAAR=re.sub(r"\D", "", synth.gen_aadhaar(r)),
                     CARD=re.sub(r"\D", "", synth.gen_card(r)), MOBILE=re.sub(r"\D", "", synth.gen_mobile(r))[-10:],
                     PAN=synth.gen_pan(r), upi=synth.gen_upi(r, "test"))
        addr = synth.gen_address(r, "test")
        trace = "%032x" % r.getrandbits(128)
        a = c["AADHAAR"]
        if kind == "loan":
            text = json.dumps(dict(applicant=c["name"], pan=c["PAN"], aadhaar=f"{a[:4]} {a[4:8]} {a[8:]}",
                                   mobile="+91" + c["MOBILE"], address=addr, amount=r.randint(50, 900) * 1000), ensure_ascii=False)
        elif kind == "kyc":
            text = (f"POST /kyc/v2/verify status=200 customer={c['name']} doc=aadhaar uid={a} "
                    f"pan={c['PAN']} addr=\"{addr}\"")
        elif kind == "callnote":
            text = (f"Customer {c['name']} called from {c['MOBILE']}, card {c['CARD'][:4]}-{c['CARD'][4:8]}-"
                    f"{c['CARD'][8:12]}-{c['CARD'][12:]} block karna hai, address {addr} pe naya card bhejo")
        elif kind == "payment":
            text = json.dumps(dict(event="payment.captured", vpa=c["upi"], payer_mobile=c["MOBILE"],
                                   utr="UTR" + "".join(r.choice("0123456789") for _ in range(12)),
                                   amount=f"{r.randint(10, 9999)}.00"))
        elif kind == "otp":
            otp = "".join(r.choice("0123456789") for _ in range(6))
            self.otp_registry.issue(otp, trace)  # the auth service issued this OTP on this trace
            text = f"auth-svc INFO login challenge sent mobile={c['MOBILE']} code {otp} trace={trace[:8]}"
        elif kind == "chatbot":
            text = (f"Summarise this complaint: {c['name']} (Aadhaar {a}, PAN {c['PAN']}) says the debit on card "
                    f"{c['CARD']} was not authorised. Reply politely.")
        else:
            raise KeyError(kind)
        return dict(text=text, sink=SAMPLE_SINK[kind], source=SAMPLE_SOURCE[kind], trace_id=trace)

    def process(self, text, source, sink, trace_id=None, record=True, observe=True,
                customer_ref=None, purpose=None):
        if sink not in SINKS and not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{1,60}", sink):
            raise ValueError("sink names are lower-case letters, digits, dots and dashes")
        with self.lock:
            if customer_ref is not None:
                if customer_ref not in self.customers:
                    self.dynamic_customers.add(customer_ref)
                    self.vault.enroll(customer_ref, {})
                    self.customers[customer_ref] = dict(ref=customer_ref, name=customer_ref, created=time.time())
            t0 = time.perf_counter()
            self.fw.conflicts = set()
            self.fw.conflict_notes = []
            self.fw._current_customer_ref = customer_ref
            self.fw._current_purpose = purpose
            try:
                if sink in self.bypass:
                    fs = self.det.scan(text, threshold=0.2, trace_id=trace_id)
                    out, issued = text, []
                    for f in fs:
                        f.meta["passed_raw"] = True
                else:
                    self.fw.issued_now = []
                    out, fs = self.fw.process(text, src=source, sink=sink, trace_id=trace_id)
                    issued = self.fw.issued_now
            finally:
                self.fw._current_customer_ref = None
                self.fw._current_purpose = None
            ms = (time.perf_counter() - t0) * 1000
            thr = SINKS.get(sink, ("", 0.5))[1]
            findings = []
            for f in sorted(fs, key=lambda f: f.start):
                protected = f.p >= thr and not f.meta.get("passed_raw")
                findings.append(dict(type=f.type, start=f.start, end=f.end, p=round(f.p, 4), protected=protected,
                                     evidence={k: round(v, 3) for k, v in f.evidence.items()},
                                     registry=f.meta.get("registry"), repaired=bool(f.meta.get("repaired"))))
            for tok, typ, value in issued:
                for fd in findings:
                    if fd.get("token") is None and fd["type"] == typ and fd["protected"]:
                        fd["token"] = tok
                        break
            for fd in findings:
                tok = fd.get("token")
                is_vault = tok in self.vault.vault if tok else False
                fd["erasable"] = is_vault
                if is_vault:
                    ve = self.vault.vault[tok]
                    fd["customer_ref"] = ve["customer"]
                    fd["purpose"] = ve["purpose"]
                else:
                    fd["customer_ref"] = None
                    fd["purpose"] = None
                fd["owner_conflict"] = fd["start"] in self.fw.conflicts
            raw_left = sum(1 for f in findings if not f["protected"])
            owners = {self.vault.owner_of(f["type"], text[f["start"]:f["end"]]) for f in findings}
            owners.discard(None)
            if observe:
                self.immune.observe(source, sink, len(findings), raw_left, {f["type"] for f in findings}, len(owners))
            if record:
                self.latency_ms.append(ms)
                self.counts["requests"] += 1
                self.counts["values_protected"] += len(findings) - raw_left
                self.counts["values_raw"] += raw_left
                for f in findings:
                    self.by_type[f["type"]] += 1
            notes = list(self.fw.conflict_notes)
            for m in re.finditer(r"(?<!\d)(?<!\d\.)(?:\d[ -]?){9,15}\d(?!\d|\.\d)", text):
                raw_seq = m.group(0)
                d = re.sub(r"\D", "", raw_seq)
                if len(d) not in (10, 12, 16):
                    continue
                if any(f["protected"] and not (m.end() <= f["start"] or m.start() >= f["end"]) for f in findings):
                    continue
                failed = False
                if len(d) == 12:
                    failed = not verhoeff_valid(d)
                elif len(d) == 16:
                    failed = not luhn_valid(d)
                elif len(d) == 10:
                    failed = not luhn_valid(d)
                if failed:
                    digits_pos = [i for i, c in enumerate(raw_seq) if c.isdigit()]
                    keep = set(digits_pos[-4:])
                    masked = "".join(c if i in keep or not c.isdigit() else "X" for i, c in enumerate(raw_seq))
                    note = f"{masked} looks like an ID but fails the Aadhaar/Luhn checksum, so Aran treats it as not a real identifier."
                    if note not in notes:
                        notes.append(note)
            ev = dict(id=secrets.token_hex(6), at=time.time(), source=source, sink=sink, before=text, after=out,
                      latency_ms=round(ms, 2), findings=findings, notes=notes, bypass=sink in self.bypass, trace_id=trace_id)
            self.sink_store[sink].append(out)
            if record:
                self.events.appendleft(ev)
            return ev

    # ------------------------------------------------------------ detokenise, erase
    def detokenise(self, token, caller):
        with self.lock:
            e = self.vault.vault.get(token)
            if e is not None:
                self.immune.observe_detok(caller, e["sink"])
            try:
                return dict(token=token, value=self.vault.detokenise(token, caller), status="ok")
            except Erased as err:
                return dict(token=token, value=None, status="erased", reason=str(err))
            except KeyError:
                return dict(token=token, value=None, status="unknown",
                            reason="Not a vault token. Vaultless FF1 tokens are reversed only inside the bank's key boundary.")

    def erase(self, ref, purpose):
        with self.lock:
            receipt = self.vault.erase(ref, purpose)
            if purpose == "KYC" or all(not k["alive"] for k in self.vault.key_status(ref)):
                if ref in self.customers:
                    for t in ("AADHAAR", "CARD", "MOBILE", "PAN"):
                        if t in self.customers[ref]:
                            self.registry.remove(t, self.customers[ref][t])
                if self.store is not None:
                    self.store.delete_customer_profile(ref)
                    self.store.checkpoint_and_truncate()
            return receipt

    # ------------------------------------------------------------ leak trace
    def _ff1_sink(self, digits):
        """Which known sink a vaultless token was issued to, checked cryptographically:
        the wrong check digit must match the sink's keyed offset and the decrypted body
        must be a registered customer."""
        for sink in list(SINKS) + sorted(self.fw.sinks - set(SINKS)):
            body = digits[:-1]
            if len(digits) == 12:
                if int(digits[-1]) != (int(verhoeff_check_digit(body)) + _offset(self.key, sink)) % 10:
                    continue
                real = self.ff1.decrypt(body, sink.encode()); real += verhoeff_check_digit(real); typ = "AADHAAR"
            else:
                if int(digits[-1]) != (int(luhn_check_digit(body)) + card_offset(self.key, sink)) % 10:
                    continue
                real = self.ff1.decrypt(digits[:15], sink.encode()); real += luhn_check_digit(real); typ = "CARD"
            if self.registry.contains(typ, real):
                return sink
        return None

    def trace(self, dump):
        with self.lock:
            votes, items = defaultdict(int), []
            cands = [m.group(1) for m in ID_RX.finditer(dump)] + PSEUDO_RX.findall(dump)
            for c in cands:
                how, sink = None, None
                if c in self.vault.vault:
                    how, sink = "vault", self.vault.vault[c]["sink"]
                elif c in self.fw.index:
                    how, sink = "issued-token index", self.fw.index[c]
                elif c.isdigit():
                    sink = self._ff1_sink(c)
                    how = "FF1 offset + registry" if sink else None
                if sink:
                    votes[sink] += 1
                items.append(dict(value=c, sink=sink, how=how))
            raw = [dict(type=f.type, p=round(f.p, 3)) for f in self.det.scan(dump) if f.type in ("AADHAAR", "CARD")]
            total = sum(votes.values())
            ranking = sorted(({"sink": s, "tokens": n, "share": round(n / total, 4)} for s, n in votes.items()),
                             key=lambda x: -x["tokens"])
            return dict(candidates=len(cands), matched=total, ranking=ranking, top=ranking[0] if ranking else None,
                        items=items[:200], raw_identifiers_in_dump=len(raw))

    def leaked_dump(self, sink, lines=20):
        """What a breach of this sink would expose: the last lines the sink really stored."""
        with self.lock:
            got = list(self.sink_store.get(sink, []))[:lines]
            return "\n".join(got)

    # ------------------------------------------------------------ stats
    def stats(self):
        with self.lock:
            return dict(requests=self.counts["requests"], values_protected=self.counts["values_protected"],
                        values_passed_raw=self.counts["values_raw"], by_type=dict(self.by_type),
                        p50_ms=round(float(np.median(self.latency_ms)), 1) if self.latency_ms else None,
                        p95_ms=_p95(list(self.latency_ms)), alerts=len(self.immune.alerts),
                        open_alerts=sum(1 for a in self.immune.alerts if a["label"] is None),
                        customers=len(self.customers), tokens_issued=len(self.fw.index) + len(self.vault.vault),
                        vault_tokens=len(self.vault.vault), keys_destroyed=len(self.vault.destroyed),
                        merkle_size=len(self.vault.log.leaves), uptime_s=round(time.time() - self.started),
                        immune=self.immune.state, replay=self.replay.status(), model_load_seconds=self.load_seconds)

    def close(self):
        """Clean shutdown of background threads and persistent database connections."""
        if hasattr(self, "replay") and getattr(self.replay, "running", False):
            self.replay.stop()
        if self.store is not None:
            self.store.close()


class _IndexingFirewall(PurposeFirewall):
    """Records every token it issues, so a leaked dump can be traced back."""

    def __init__(self, *a, eng=None, **kw):
        super().__init__(*a, **kw)
        self.eng = eng
        self.index, self.issued_now = {}, []
        if self.eng and self.eng.store is not None:
            self.index.update(self.eng.store.load_all_token_sinks())
        self._current_purpose = None
        self._current_customer_ref = None
        self.conflicts = set()
        self.conflict_notes = []

    def _replace(self, f, value, sink, purpose=None):
        purpose = purpose or self._current_purpose
        if self._current_customer_ref and f.type in ("AADHAAR", "CARD", "MOBILE", "PAN", "UPI"):
            existing_owner = self.vault.owner_of(f.type, value)
            if existing_owner is None:
                k = self.vault._owner_key(f.type, value)
                self.vault.owner[k] = self._current_customer_ref
                if self.vault.store is not None:
                    self.vault.store.save_owner(k, self._current_customer_ref)
                if self.eng and self._current_customer_ref in self.eng.customers:
                    self.eng.customers[self._current_customer_ref][f.type] = value
            elif existing_owner != self._current_customer_ref:
                self.conflicts.add(f.start)
                note = "owner_conflict: this identifier is already enrolled under another customer; token issued under the original owner."
                if note not in self.conflict_notes:
                    self.conflict_notes.append(note)
        tok = super()._replace(f, value, sink, purpose=purpose)
        if tok not in ("<OTP:destroyed>",) and "withheld" not in tok:
            self.index[tok] = sink
            if self.eng and self.eng.store is not None:
                try:
                    self.eng.store.save_token_sink(tok, sink)
                except Exception:
                    pass
        self.issued_now.append((tok, f.type, value))
        return tok


# ---------------------------------------------------------------- immune layer on live traffic
class Immune:
    """Learns 'self' from this server's own flow windows, then scores each new window.

    A flow record is one (source, sink, window) with the number of messages that carried
    sensitive values, the fraction left raw, the data classes, the detokenisation rate
    and the customer ratio, counted from real traffic through the firewall."""

    def __init__(self, eng):
        self.eng = eng
        self.cur = {}
        self.closed = deque(maxlen=5000)
        self.alerts = []
        self.state = dict(mode="idle", learned_records=0, self_radius=None, detectors=0, val_fpr=None,
                          learn_until=None, window_seconds=WINDOW)
        self.feat = self.ais = None
        self.learn_from = None
        self.recent = deque(maxlen=40)  # scored windows, for the tour's radar view

    def _win(self):
        return int(time.time() // WINDOW)

    def _rec(self, src, sink):
        w = self._win()
        k = (src, sink, w)
        if k not in self.cur:
            self.cur[k] = dict(src=src, sink=sink, window=w, n=0, raw=0, classes=set(), detok=0, owners=0)
        return self.cur[k]

    def observe(self, src, sink, n_findings, raw_left, classes, owners):
        if not n_findings:
            return
        r = self._rec(src, sink)
        r["n"] += 1; r["raw"] += int(raw_left > 0); r["classes"] |= classes; r["owners"] += owners

    def observe_detok(self, caller, sink):
        self._rec(caller, sink)["detok"] += 1

    @staticmethod
    def as_flow(r):
        n = max(r["n"], 1)
        hour = time.localtime(r["window"] * WINDOW).tm_hour
        return dict(day=0, hour=hour, src=r["src"], sink=r["sink"], classes=set(r["classes"]), n=n,
                    raw_frac=r["raw"] / n, detok_rate=r["detok"] / n, cust_ratio=min(1.0, r["owners"] / n), label=0, attack=None)

    def tick(self):
        """Close finished windows; learn or score them."""
        with self.eng.lock:
            w = self._win()
            done = [k for k in self.cur if k[2] < w]
            recs = [self.cur.pop(k) for k in done]
            for r in recs:
                self.closed.append(r)
            if self.state["mode"] == "learning" and time.time() >= self.state["learn_until"]:
                self._fit()
            elif self.state["mode"] == "watching":
                for r in recs:
                    self._score(r)

    def start_learning(self, seconds):
        with self.eng.lock:
            self.learn_from = self._win()
            self.state.update(mode="learning", learn_until=time.time() + seconds, learned_records=0)

    def _fit(self):
        self_recs = [self.as_flow(r) for r in self.closed if r["window"] >= self.learn_from]
        if len(self_recs) < 10:
            self.state.update(mode="idle", error=f"only {len(self_recs)} flow windows seen; keep normal traffic running and learn again")
            return
        self.feat = FlowFeaturizer().fit(self_recs)
        X = self.feat.transform(self_recs)
        tr, va = X[0::2], X[1::2]
        rs, fpr, self.ais = tune_self_radius(tr, va, target_fpr=0.05)
        self.state.update(mode="watching", learned_records=len(self_recs), self_radius=rs, detectors=len(self.ais.C),
                          val_fpr=round(fpr, 4), learn_until=None, error=None,
                          pairs=sorted({f"{x['src']} -> {x['sink']}" for x in self_recs}))

    def _score(self, r):
        rec = self.as_flow(r)
        x = self.feat.transform([rec])
        s = float(self.ais.score(x)[0])
        z = self.ais.scaler.transform(x)[0]
        self.recent.appendleft(dict(at=r["window"] * WINDOW, src=rec["src"], sink=rec["sink"], n=rec["n"],
                                    score=round(s, 4), alert=s > 0, z=[round(float(v), 3) for v in z]))
        if s <= 0:
            return
        names = FlowFeaturizer.names
        why = []
        f = dict(zip(names, x[0]))
        if f["pair_novel"] > 0: why.append("source and sink never seen together while learning")
        if abs(f["volume_z"]) > 2: why.append(f"volume {rec['n']} messages is {f['volume_z']:+.1f} sd from normal")
        if f["raw_frac_z"] > 2: why.append(f"{rec['raw_frac']:.0%} of messages left raw")
        if f["class_novel"] > 0: why.append("new data classes: " + ", ".join(sorted(rec["classes"])))
        if f["detok_log"] > 1: why.append(f"detokenisation rate {rec['detok_rate']:.2f} per message")
        if f["hour_distance"] > 0.1 and not f["pair_novel"]: why.append("outside the hours this flow normally runs")
        self.alerts.insert(0, dict(id=secrets.token_hex(5), at=r["window"] * WINDOW, src=rec["src"], sink=rec["sink"],
                                   score=round(s, 4), n=rec["n"], raw_frac=round(rec["raw_frac"], 3),
                                   detok_rate=round(rec["detok_rate"], 3), classes=sorted(rec["classes"]),
                                   features={k: round(float(v), 3) for k, v in f.items()},
                                   reasons=why or ["outside the learned self region"], label=None, _x=x[0].tolist()))

    def label(self, alert_id, label):
        with self.eng.lock:
            a = next(a for a in self.alerts if a["id"] == alert_id)
            x = np.array(a["_x"])
            if label == "attack":
                self.ais.confirm_attack(x)   # immune memory: similar flows score higher next time
            else:
                self.ais.confirm_false_alarm(x)  # self-tolerance: drop detectors covering this flow
            a["label"] = label
            self.state["detectors"] = len(self.ais.C)
            return a


# ---------------------------------------------------------------- replay of real logs
class Replay:
    """Streams real production log lines (Loghub, 16 systems) through the firewall as the
    bank's normal traffic. About one line in ten carries a bank event for an enrolled
    customer, as in experiment E9."""

    def __init__(self, eng):
        self.eng = eng
        self.logs = {}
        for f in sorted(glob.glob(os.path.join(LOGS_DIR, "*_2k.log"))):
            self.logs[os.path.basename(f)[:-7]] = open(f, errors="replace").read().splitlines()
        self.running = False
        self.rate = 1.0
        self.sent = 0
        self.thread = None

    def status(self):
        return dict(running=self.running, lines_per_second_per_flow=self.rate, lines_sent=self.sent,
                    flows=[f"{s} -> {k}" for s, k, _ in REPLAY_PAIRS], log_systems=len(self.logs))

    def start(self, rate=1.0):
        if not self.logs:
            raise RuntimeError("no Loghub logs found; run research/fetch_data.sh")
        self.rate = max(0.2, min(float(rate), 5.0))
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        t = getattr(self, "thread", None)
        if t and t.is_alive() and threading.current_thread() != t:
            t.join(timeout=2.0)

    def _line(self, systems):
        r = self.eng.rand
        sysname = r.choice([s for s in systems if s in self.logs] or sorted(self.logs))
        ln = r.choice(self.logs[sysname])
        if r.random() < 0.1:
            text = synth.make_line(r, *r.choice(synth.TEMPLATES["test"]), "test")[0]
            if r.random() < 0.7 and self.eng.customers:
                eligible = [c for c in self.eng.customers.values() if "AADHAAR" in c and "MOBILE" in c]
                if eligible:
                    c = r.choice(eligible)
                    text += f" aadhaar={c['AADHAAR']} mobile={c['MOBILE']}"
            ln = ln + " | " + text
        return ln

    def _run(self):
        nxt = time.time()
        while self.running:
            for src, sink, systems in REPLAY_PAIRS:
                k = np.random.poisson(self.rate)
                for _ in range(k):
                    self.eng.process(self._line(systems), src, sink, record=True)
                    self.sent += 1
            nxt += 1.0
            time.sleep(max(0.0, nxt - time.time()))


# ---------------------------------------------------------------- drills: real actions, judged live
def drill(eng, kind):
    """Runs a real action against the live firewall. The immune layer is not told; it has
    to notice the resulting flow window on its own."""
    r = eng.rand
    if kind == "new-sink":
        for _ in range(30):
            s = eng.sample(r.choice(["callnote", "loan"]))
            eng.process(s["text"], "call-centre", "paste-site.example", record=True)
        return "Sent 30 customer records from the call centre to paste-site.example, a sink never seen before."
    if kind == "bulk-export":
        for _ in range(250):
            s = eng.sample("loan")
            eng.process(s["text"], "loan-origination", "loan-vendor", record=True)
        return "Exported 250 loan applications to the loan vendor in one window."
    if kind == "detok-spike":
        toks = [t for t, e in eng.vault.vault.items() if e["sink"] == "crm-notes"][:60]
        if not toks:
            return "No crm-notes vault tokens yet; send some call-centre notes first."
        for t in toks:
            eng.detokenise(t, "call-centre")
        for _ in range(5):
            s = eng.sample("callnote")
            eng.process(s["text"], "call-centre", "crm-notes", record=True)
        return f"The call centre detokenised {len(toks)} customer tokens from crm-notes."
    if kind == "bypass":
        eng.bypass.add("log-platform")
        try:
            for _ in range(40):
                s = eng.sample("payment")
                eng.process(s["text"], "upi-switch", "log-platform", record=True)
        finally:
            eng.bypass.discard("log-platform")
        return "Switched log-platform to monitor-only and sent 40 payment callbacks; values went through raw."
    raise KeyError(kind)


# ---------------------------------------------------------------- results and test runs
RESULT_FILES = {"E1-E4 core": "results.json", "E5-E9 AI and immune": "results_ai.json",
                "E10-E12 normaliser and registries": "results_registry.json"}


def results():
    out = {}
    for name, f in RESULT_FILES.items():
        p = os.path.join(RESEARCH, f)
        if os.path.exists(p):
            out[name] = dict(file=f"research/{f}", modified=os.path.getmtime(p), data=json.load(open(p)))
    return out


def run_job(eng, name, cmd, timeout=900):
    job = dict(name=name, cmd=" ".join(cmd), started=time.time(), finished=None, returncode=None, output="")
    eng.jobs[name] = job

    def go():
        try:
            p = subprocess.run(cmd, cwd=RESEARCH, capture_output=True, text=True, timeout=timeout)
            job.update(output=(p.stdout + p.stderr)[-20000:], returncode=p.returncode)
        except subprocess.TimeoutExpired as e:
            job.update(output=f"timed out after {timeout}s\n{(e.stdout or '')[-5000:]}", returncode=-1)
        job["finished"] = time.time()

    threading.Thread(target=go, daemon=True).start()
    return job


# ---------------------------------------------------------------- guided tour: live explanations
DEVA, TAMIL, FULL = (str.maketrans("0123456789", x) for x in ("०१२३४५६७८९", "௦௧௨௩௪௫௬௭௮௯", "０１２３４５６７８９"))
# the evasion tricks of experiment E10 (research/experiment_registry.py)
TRICKS = [
    ("Plain number", lambda d: d),
    ("Tamil digits", lambda d: d.translate(TAMIL)),
    ("Devanagari digits", lambda d: d.translate(DEVA)),
    ("Full-width digits", lambda d: d.translate(FULL)),
    ("URL percent-encoding", lambda d: "".join("%%%02X" % ord(c) for c in d)),
    ("JSON \\u escapes", lambda d: "".join("\\u%04x" % ord(c) for c in d)),
    ("HTML entities", lambda d: "".join("&#%d;" % ord(c) for c in d)),
    ("Dots between groups", lambda d: ".".join(d[i:i + 4] for i in range(0, 12, 4))),
    ("Space between every digit", lambda d: " ".join(d)),
    ("Zero-width space inside", lambda d: d[:5] + "\u200b" + d[5:]),
    ("Split into three fields", lambda d: f"{d[:4]} aadhaar_p2={d[4:8]} aadhaar_p3={d[8:]}"),
    ("Whole line in base64", None),
]


def checksum_explain(digits):
    """Step-by-step Verhoeff (12 digits) or Luhn (16 digits) check, as the tour shows it."""
    d = re.sub(r"\D", "", digits)
    if len(d) == 12:
        c, steps = 0, []
        for i, ch in enumerate(reversed(d)):
            p = _P[i % 8][int(ch)]
            n = _D[c][p]
            steps.append(dict(position=len(d) - i, digit=int(ch), permuted=p, before=c, after=n))
            c = n
        return dict(kind="Aadhaar (Verhoeff)", digits=d, valid=c == 0, final=c, steps=steps,
                    correct_check_digit=verhoeff_check_digit(d[:-1]))
    if len(d) == 16:
        steps, total = [], 0
        for i, ch in enumerate(reversed(d)):
            v = int(ch)
            dbl = i % 2 == 1
            w = v * 2 - 9 if dbl and v * 2 > 9 else (v * 2 if dbl else v)
            steps.append(dict(position=len(d) - i, digit=v, doubled=dbl, value=w))
            total += w
        return dict(kind="Card (Luhn)", digits=d, valid=total % 10 == 0, total=total, steps=steps,
                    correct_check_digit=luhn_check_digit(d[:-1]))
    raise ValueError("enter 12 digits (Aadhaar) or 16 digits (card)")


def tour_tokens(eng):
    """One enrolled customer's Aadhaar and card sent to four sinks: every sink gets a different token."""
    with eng.lock:
        c = eng.customers[eng.rand.choice(sorted(eng.customers))]
        rows = []
        for sink in ("log-platform", "crm-notes", "loan-vendor", "marketing-cloud"):
            ev = eng.process(f"customer {c['ref']} aadhaar {c['AADHAAR']} card {c['CARD']}", "guided-tour", sink, observe=False)
            toks = {f["type"]: f.get("token") for f in ev["findings"] if f["protected"]}
            a, k = toks.get("AADHAAR"), toks.get("CARD")
            rows.append(dict(sink=sink, purpose=SINKS[sink][0], aadhaar_token=a, card_token=k, after=ev["after"],
                             aadhaar_token_passes=bool(a and a.isdigit() and verhoeff_valid(a)),
                             card_token_passes=bool(k and k.isdigit() and luhn_valid(k))))
        return dict(customer=c["ref"], name=c["name"], aadhaar=c["AADHAAR"], card=c["CARD"],
                    aadhaar_valid=verhoeff_valid(c["AADHAAR"]), card_valid=luhn_valid(c["CARD"]), sinks=rows)


def tour_evasion(eng):
    """The same customer's Aadhaar hidden 12 ways, each sent through the live firewall."""
    with eng.lock:
        c = eng.customers[eng.rand.choice(sorted(eng.customers))]
        a = c["AADHAAR"]
        out = []
        for name, fn in TRICKS:
            if fn is None:
                line = "customer update aadhaar=" + a
                line = "payload=" + base64.b64encode(line.encode()).decode()
            else:
                line = "customer update aadhaar=" + fn(a)
            ev = eng.process(line, "guided-tour", "log-platform", observe=False)
            caught = any(f["type"] == "AADHAAR" and f["protected"] for f in ev["findings"])
            out.append(dict(trick=name, before=line, after=ev["after"], caught=caught, latency_ms=ev["latency_ms"]))
        return dict(customer=c["ref"], aadhaar=a, rows=out, caught=sum(r["caught"] for r in out))


NAIVE = {"Aadhaar-shaped": re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b"),
         "Card-shaped": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
         "OTP-shaped": re.compile(r"\b\d{4,8}\b")}


def tour_false_alarms(eng, n=300):
    """Real production log lines (Loghub) contain no Indian identifiers, so every hit is a
    false alarm. Count what plain patterns flag versus what Aran's detector flags."""
    r = random.Random()
    systems = sorted(eng.replay.logs)
    lines = [r.choice(eng.replay.logs[r.choice(systems)]) for _ in range(n)]
    naive = {k: 0 for k in NAIVE}
    aran, examples, cells = defaultdict(int), [], []
    t0 = time.perf_counter()
    with eng.lock:
        for ln in lines:
            hits = []
            for k, rx in NAIVE.items():
                m = rx.findall(ln)
                naive[k] += len(m)
                if m:
                    hits.append((k, m[0]))
            fs = [f for f in eng.det.scan(ln) if f.p >= 0.5]
            for f in fs:
                aran[f.type] += 1
            cells.append([sum(len(rx.findall(ln)) for rx in NAIVE.values()), len(fs)])
            if hits and len(examples) < 6:
                examples.append(dict(line=ln[:180], naive=[f"{k}: {v}" for k, v in hits], aran=[f.type for f in fs]))
    return dict(lines=n, systems=len(systems), naive=naive, naive_total=sum(naive.values()), aran=dict(aran),
                aran_total=sum(aran.values()), examples=examples, cells=cells, seconds=round(time.perf_counter() - t0, 2))


def _ff1_rounds(ff1, digits, tweak):
    """The ten Feistel rounds of FF1 encryption, recorded half by half (same arithmetic as
    aran_core.FF1._rounds), so the tour can show a token being built round by round."""
    radix, n, t = ff1.radix, len(digits), len(tweak)
    u, v = n // 2, n - n // 2
    a, b = [int(c) for c in digits[:u]], [int(c) for c in digits[u:]]
    bl = math.ceil(math.ceil(v * math.log2(radix)) / 8)
    d = 4 * math.ceil(bl / 4) + 4
    p = bytes([1, 2, 1]) + radix.to_bytes(3, "big") + bytes([10, u % 256]) + n.to_bytes(4, "big") + t.to_bytes(4, "big")
    rounds = []
    for i in range(10):
        q = tweak + bytes((-t - bl - 1) % 16) + bytes([i]) + _num(b, radix).to_bytes(bl, "big")
        r = ff1._prf(p + q)
        s, j = r, 1
        while len(s) < d:
            s += ff1._ciph(bytes(x ^ y for x, y in zip(r, j.to_bytes(16, "big"))))
            j += 1
        y = int.from_bytes(s[:d], "big")
        m = u if i % 2 == 0 else v
        c = (_num(a, radix) + y) % (radix ** m)
        a, b = b, _str(c, radix, m)
        rounds.append(dict(round=i + 1, left="".join(map(str, a)), right="".join(map(str, b)), aes=r[:6].hex()))
    return rounds


def tour_build_token(eng, sink="log-platform", aadhaar=None):
    """Build a vaultless token step by step for a generated Aadhaar, then check the live
    firewall issues exactly the same token."""
    with eng.lock:
        a = aadhaar if aadhaar and re.fullmatch(r"\d{12}", aadhaar) and verhoeff_valid(aadhaar) \
            else re.sub(r"\D", "", synth.gen_aadhaar(eng.rand))
        body = a[:11]
        rounds = _ff1_rounds(eng.ff1, body, sink.encode())
        enc = rounds[-1]["left"] + rounds[-1]["right"]
        right = verhoeff_check_digit(enc)
        off = _offset(eng.key, sink)
        token = enc + str((int(right) + off) % 10)
        ev = eng.process(f"kyc check aadhaar {a}", "guided-tour", sink, record=False, observe=False)
        issued = next((f.get("token") for f in ev["findings"] if f["type"] == "AADHAAR" and f["protected"]), None)
        return dict(aadhaar=a, body=body, check=a[-1], sink=sink, rounds=rounds, encrypted=enc, right_check=right,
                    offset=off, token=token, token_valid=verhoeff_valid(token), real_valid=verhoeff_valid(a),
                    firewall_token=issued, firewall_after=ev["after"], matches=issued == token,
                    note="enrolled customers get random vault tokens instead; this person is not enrolled, so the vaultless FF1 path is used")


def tour_packet(eng, kind=None):
    """One real request for the animated pipeline: a sample through the live firewall."""
    kind = kind or eng.rand.choice(sorted(SAMPLES))
    s = eng.sample(kind)
    ev = eng.process(s["text"], s["source"], s["sink"], s["trace_id"], observe=False)
    return dict(ev, kind=kind)


def tour_immune_radar(eng):
    """Recent scored traffic windows in the detector's own scaled feature space. Every
    feature is scaled so the range seen while learning normal traffic sits in [0.1, 0.7]."""
    with eng.lock:
        im = eng.immune
        return dict(mode=im.state["mode"], names=FlowFeaturizer.names, self_lo=0.1, self_hi=0.7,
                    windows=list(im.recent)[:20], state=im.state,
                    learn_left=max(0, round(im.state["learn_until"] - time.time())) if im.state.get("learn_until") else None,
                    next_window_in=round(WINDOW - time.time() % WINDOW, 1), window_seconds=WINDOW)


_GW = {}


def gateway(eng):
    """The AI gateway (research/gateway/ai_gateway.py) on the live detector. With
    ARAN_LLM_URL, ARAN_LLM_KEY and ARAN_LLM_MODEL set it calls that OpenAI-compatible
    model; otherwise the provider is the echo stand-in from the gateway's own tests,
    which repeats the prompt back, the hardest case for placeholders."""
    if "gw" not in _GW:
        from gateway.ai_gateway import AIGateway, openai_upstream, recorder_upstream
        url = os.environ.get("ARAN_LLM_URL")
        if url:
            up, name = openai_upstream(url, os.environ.get("ARAN_LLM_KEY", ""), os.environ.get("ARAN_LLM_MODEL", "")), "model at ARAN_LLM_URL"
        else:
            up, name = recorder_upstream([]), "echo stand-in (no external AI call)"
        _GW["gw"], _GW["name"] = AIGateway(eng.det, up), name
    return _GW["gw"], _GW["name"]


def tour_gateway(eng, role, text):
    gw, name = gateway(eng)
    conv = "tour-" + secrets.token_hex(4)
    with eng.lock:
        res = gw.chat(f"{role}:tour", conv, [{"role": "user", "content": text}])
    return dict(res, provider=name, role=role, audit_ok=gw.audit.verify(), audit_size=len(gw.audit.entries),
                audit_last=gw.audit.entries[-1] if gw.audit.entries else None)


def tour_immune_space(eng, axes=(0, 1, 3), max_self=400, max_det=250):
    """Three of the immune layer's seven scaled features, for the 3D view. Detectors are
    balls; the orthogonal shadow of a ball on any three axes is a ball of the same radius,
    so the spheres drawn are the exact shadows of the real detectors."""
    with eng.lock:
        im = eng.immune
        names = FlowFeaturizer.names
        if im.ais is None:
            return dict(mode=im.state["mode"], names=names, axes=list(axes))
        a = list(axes)
        S, C, R = im.ais.self_pts, im.ais.C, im.ais.R
        rng = np.random.default_rng(0)
        si = rng.choice(len(S), min(len(S), max_self), replace=False) if len(S) else []
        di = np.argsort(-R)[:max_det]
        r3 = lambda v: [round(float(x), 3) for x in v]
        return dict(mode=im.state["mode"], names=names, axes=a, self_lo=0.1, self_hi=0.7,
                    self_pts=[r3(S[i, a]) for i in si],
                    detectors=[dict(c=r3(C[i, a]), r=round(float(R[i]), 3)) for i in di], detectors_total=len(C),
                    memory=[dict(c=r3(c[a]), r=round(float(r), 3)) for c, r in zip(im.ais.mem_C, im.ais.mem_R)][:100],
                    windows=[dict(at=w["at"], src=w["src"], sink=w["sink"], alert=w["alert"], score=w["score"], p=[w["z"][i] for i in a])
                             for w in list(im.recent)[:30]])
