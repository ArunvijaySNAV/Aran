"""Endpoints for the demo features: phone arena, with/without split screen, leakage ledger,
card photo scan (OCR) and the post-quantum page.

Every endpoint runs Aran's real code (the live firewall in engine.py, research/firewall/ledger.py,
research/pqc/hybrid.py). Identifiers are generated and belong to no one.
"""
import base64
import io
import json
import math
import os
import re
import secrets
import socket
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

import engine as E
from firewall.ledger import LENGTH, LeakageLedger, bits_left, positions, render
from firewall.normalise import Normaliser

router = APIRouter()
_eng = None  # set by main.py: a function returning the loaded Engine (raises 503 while loading)


def eng():
    return _eng()


# ================================================================ 1. phone arena
# The broadest decoder in the repo (number words, look-alike letters, double escapes). It is only
# used to check that a player really hid the challenge number, never to protect anything.
CHECKER = Normaliser(number_words=True, lookalikes=True, double_escapes=True)


def _new_arena():
    return dict(challenge=None, attempts=deque(maxlen=200), caught=0, slipped=0, unverified=0, players=set())


class _Arena:
    """Per-engine arena state, so one tenant's game never touches another's."""
    def _d(self):
        return eng().standout.setdefault("arena", _new_arena())

    def __getitem__(self, k):
        return self._d()[k]

    def __setitem__(self, k, v):
        self._d()[k] = v

    def update(self, *a, **kw):
        self._d().update(*a, **kw)


ARENA = _Arena()
KINDS = {"AADHAAR": "Aadhaar", "CARD": "Card", "MOBILE": "Mobile"}


def _new_challenge():
    e = eng()
    with e.lock:
        c = e.customers[e.rand.choice(sorted(e.customers))]
        typ = e.rand.choice(sorted(KINDS))
        ARENA["challenge"] = dict(id=secrets.token_hex(4), type=typ, label=KINDS[typ], value=c[typ], customer=c["ref"],
                                  issued=time.time())
    return ARENA["challenge"]


def _contains(text, value):
    """True if any decoded view of the text carries the challenge digits in order."""
    for v in CHECKER.views(text):
        if value in re.sub(r"\D", "", v.text):
            return True
    return value in re.sub(r"\D", "", text)


def _mask(s):
    return "•" * (len(s) - 4) + s[-4:]


class ArenaTry(BaseModel):
    text: str = Field(max_length=2000)
    nick: str = Field(default="Judge", max_length=24)
    challenge: str | None = None
    via: str = Field(default="typed", max_length=10)


@router.get("/api/arena/challenge")
def arena_challenge():
    return ARENA["challenge"] or _new_challenge()


@router.post("/api/arena/challenge")
def arena_new_challenge():
    return _new_challenge()


@router.post("/api/arena/try")
def arena_try(body: ArenaTry):
    e = eng()
    ch = ARENA["challenge"] or _new_challenge()
    if body.challenge and body.challenge != ch["id"]:
        raise HTTPException(409, "The challenge changed. Reload to get the new number.")
    ev = e.process(body.text, "arena-phone", "log-platform")
    hidden = _contains(body.text, ch["value"])
    caught = any(f["type"] == ch["type"] and f["protected"] for f in ev["findings"])
    # caught also when the number is gone from what the sink stored (e.g. caught as another type)
    still_there = _contains(ev["after"], ch["value"])
    verdict = "caught" if hidden and not still_there else "slipped" if hidden else "unverified"
    ARENA[verdict] += 1
    nick = re.sub(r"[^\w .\-]", "", body.nick).strip()[:24] or "Judge"
    ARENA["players"].add(nick)
    row = dict(id=ev["id"], at=ev["at"], nick=nick, via=body.via, verdict=verdict, type=ch["label"],
               before=body.text[:300], after=ev["after"][:300], latency_ms=ev["latency_ms"],
               found=[dict(type=f["type"], p=f["p"], protected=f["protected"]) for f in ev["findings"]],
               typed_caught=caught)
    ARENA["attempts"].appendleft(row)
    return dict(row, challenge=ch)


@router.get("/api/arena/board")
def arena_board():
    ch = ARENA["challenge"] or _new_challenge()
    att = list(ARENA["attempts"])
    return dict(challenge=dict(ch, value=_mask(ch["value"])), attempts=att[:30], caught=ARENA["caught"],
                slipped=ARENA["slipped"], unverified=ARENA["unverified"], players=len(ARENA["players"]))


@router.post("/api/arena/reset")
def arena_reset():
    ARENA.update(attempts=deque(maxlen=200), caught=0, slipped=0, unverified=0, players=set())
    return dict(challenge=_new_challenge())


def _lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; this only picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


@router.get("/api/arena/join")
def arena_join(request: Request):
    host = request.url.hostname or "localhost"
    port = request.url.port
    lan = _lan_ip()
    use = lan if host in ("localhost", "127.0.0.1") else host
    url = f"{request.url.scheme}://{use}{':' + str(port) if port else ''}/#arena"
    return dict(url=url, lan_ip=lan, local_only=host in ("localhost", "127.0.0.1"),
                hint="Phones reach this only if the server listens on the network: "
                     "python -m uvicorn main:app --host 0.0.0.0 --port 8000, and the phone is on the same Wi-Fi.")


@router.get("/api/qr")
def qr(text: str):
    import qrcode
    import qrcode.image.svg
    if len(text) > 300:
        raise HTTPException(400, "text too long")
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


# ================================================================ 2. without / with Aran
class VersusIn(BaseModel):
    n: int = Field(default=12, ge=4, le=40)


# DPDP Rules 2025, Schedule: failing to take reasonable security safeguards to prevent a
# personal data breach can cost up to Rs 250 crore (Learn 7).
DPDP_MAX_CRORE = 250


@router.post("/api/versus/run")
def versus_run(body: VersusIn):
    e = eng()
    kinds = sorted(E.SAMPLES)
    items = []
    for i in range(body.n):
        kind = kinds[i % len(kinds)]
        s = e.sample(kind)
        ev = e.process(s["text"], s["source"], s["sink"], s["trace_id"])
        thr = E.SINKS[s["sink"]][1]
        exposed = [dict(type=f["type"], value=s["text"][f["start"]:f["end"]]) for f in ev["findings"] if f["p"] >= thr]
        items.append(dict(kind=kind, label=E.SAMPLES[kind], source=s["source"], sink=s["sink"], before=s["text"],
                          after=ev["after"], exposed=exposed, protected=sum(f["protected"] for f in ev["findings"]),
                          raw_left=sum(not f["protected"] for f in ev["findings"] if f["p"] >= thr), latency_ms=ev["latency_ms"],
                          tokens=[f["token"] for f in ev["findings"] if f.get("token")]))
    # the breach: the sink that received most requests leaks everything it stored in this run
    counts = {}
    for it in items:
        counts[it["sink"]] = counts.get(it["sink"], 0) + 1
    leaked = max(counts, key=lambda k: (counts[k], k))
    raw_dump = "\n".join(it["before"] for it in items if it["sink"] == leaked)
    aran_dump = "\n".join(it["after"] for it in items if it["sink"] == leaked)
    tr = e.trace(aran_dump)
    readable_raw = sum(len(it["exposed"]) for it in items if it["sink"] == leaked)
    # values a thief can still use: anything that passed raw, plus any 12/16-digit run that passes
    # its checksum (Aran's tokens fail it by design)
    real_ids = [m.group(1) for m in E.ID_RX.finditer(aran_dump)
                if (len(m.group(1)) == 12 and E.verhoeff_valid(m.group(1))) or (len(m.group(1)) == 16 and E.luhn_valid(m.group(1)))]
    readable_aran = sum(it["raw_left"] for it in items if it["sink"] == leaked)
    return dict(items=items, leaked_sink=leaked, without=dict(exposed=sum(len(i["exposed"]) for i in items),
                                                             dump_readable=readable_raw, dump=raw_dump[:4000]),
                with_=dict(protected=sum(i["protected"] for i in items), raw_left=sum(i["raw_left"] for i in items),
                           dump_readable=readable_aran, checksum_valid_ids=len(real_ids),
                           dump=aran_dump[:4000], trace=tr),
                dpdp_max_crore=DPDP_MAX_CRORE,
                p50_ms=round(sorted(i["latency_ms"] for i in items)[len(items) // 2], 2))


# ================================================================ 3. leakage ledger
# Trust domains: sinks that can join their data. "acme" is one vendor running two systems.
DOMAINS = {"acme-crm": ["acme"], "acme-collections": ["acme"], "acme-analytics": ["acme"],
           "loan-vendor": ["lenders"], "partner-bank": ["lenders"]}
class _Ledger:
    """Per-engine leakage-ledger state (see _ledger)."""
    def _d(self):
        return eng().standout.setdefault("ledger", {})

    def __getitem__(self, k):
        return self._d()[k]

    def clear(self):
        self._d().clear()


LEDGER = _Ledger()


def _ledger():
    d = eng().standout.setdefault("ledger", {})
    if "l" not in d:
        d["l"] = LeakageLedger(secrets.token_bytes(32), domains=DOMAINS)
        d["naive"] = {}  # what a per-field masker would have shown each domain (for comparison)
        d["log"] = []
    return d["l"]


class DiscloseIn(BaseModel):
    customer_ref: str
    type: str = "CARD"
    sink: str
    mask: str = Field(max_length=20)


def _guess_time(cands, rate):
    s = cands / rate
    for unit, n in (("years", 31557600), ("days", 86400), ("hours", 3600), ("minutes", 60)):
        if s >= n:
            return f"{s / n:,.1f} {unit}"
    return f"{s:,.2f} seconds"


def _view(typ, digits, sink, l):
    out, entry = [], l._entry(typ, digits)
    for d in l.domains_of(sink):
        shown = l.shown.get((entry, d), frozenset())
        naive = LEDGER["naive"].get((typ, digits, d), frozenset())
        b, nb = bits_left(typ, digits, shown), bits_left(typ, digits, naive)
        out.append(dict(domain=d, sinks=sorted(s for s in list(DOMAINS) if d in DOMAINS[s]) or [d],
                        sees=render(digits, shown), bits=round(b, 2), candidates=round(2 ** b),
                        naive_sees=render(digits, naive), naive_bits=round(nb, 2), naive_candidates=round(2 ** nb),
                        naive_time=_guess_time(2 ** nb, 1000), tau=l.tau[typ]))
    return out


@router.post("/api/ledger/disclose")
def ledger_disclose(body: DiscloseIn):
    e = eng()
    if body.customer_ref not in e.customers:
        raise HTTPException(404, "no such customer")
    if body.type not in LENGTH:
        raise HTTPException(400, "type is AADHAAR, CARD or MOBILE")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{1,40}", body.sink):
        raise HTTPException(400, "sink names are lower-case letters, digits, dots and dashes")
    l = _ledger()
    digits = e.customers[body.customer_ref][body.type]
    n = LENGTH[body.type]
    try:
        req = positions(body.mask, n)
    except ValueError as err:
        raise HTTPException(400, str(err))
    before = l.check(body.type, digits, body.sink, "token")
    if_granted = l.check(body.type, digits, body.sink, body.mask)
    t0 = time.perf_counter()
    granted, bits = l.decide(body.type, digits, body.sink, body.mask)
    ms = (time.perf_counter() - t0) * 1000
    for d in l.domains_of(body.sink):
        k = (body.type, digits, d)
        LEDGER["naive"][k] = LEDGER["naive"].get(k, frozenset()) | req
    row = dict(at=time.time(), customer=body.customer_ref, type=body.type, sink=body.sink, requested=body.mask,
               granted=granted, refused=granted != body.mask, bits_before=round(before, 2),
               bits_if_granted=round(if_granted, 2), bits_after=round(bits, 2), tau=l.tau[body.type],
               sink_sees=render(digits, positions(granted, n)), requested_sees=render(digits, req), ms=round(ms, 2))
    LEDGER["log"].insert(0, row)
    return dict(row, domains=_view(body.type, digits, body.sink, l))


@router.get("/api/ledger/state")
def ledger_state(customer_ref: str, type: str = "CARD"):
    e = eng()
    if customer_ref not in e.customers or type not in LENGTH:
        raise HTTPException(404, "no such customer or type")
    l = _ledger()
    digits = e.customers[customer_ref][type]
    doms = []
    for sink in ("acme-crm", "loan-vendor"):
        doms += [d for d in _view(type, digits, sink, l) if d["domain"] not in [x["domain"] for x in doms]]
    return dict(domains=doms, log=[r for r in LEDGER["log"] if r["customer"] == customer_ref][:20],
                trust_domains=DOMAINS, masks=LeakageLedger.MASKS, tau=l.tau, length=LENGTH[type],
                full_bits=round(bits_left(type, digits, frozenset()), 2))


@router.post("/api/ledger/reset")
def ledger_reset():
    LEDGER.clear()
    _ledger()
    return dict(ok=True)


# ================================================================ 4. card photo scan (OCR)
class OcrIn(BaseModel):
    image: str = Field(max_length=12_000_000)  # data URL
    sink: str = "kyc-archive"


@router.post("/api/ocr")
def ocr(body: OcrIn):
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError:
        raise HTTPException(503, "OCR needs pytesseract and pillow (pip install pytesseract pillow) and the Tesseract "
                                 "program (Learn 10 has the install steps).")
    m = re.match(r"data:image/[a-z+]+;base64,(.*)", body.image, re.S)
    if not m:
        raise HTTPException(400, "send the picture as a data URL")
    try:
        img = Image.open(io.BytesIO(base64.b64decode(m.group(1))))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        raise HTTPException(400, "that file is not a picture")
    if max(img.size) > 2000:
        img.thumbnail((2000, 2000))
    t0 = time.perf_counter()
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config="--psm 11")
    except pytesseract.TesseractNotFoundError:
        raise HTTPException(503, "The Tesseract program is not installed on the server (Learn 10 has the install steps).")
    ocr_ms = (time.perf_counter() - t0) * 1000
    # rebuild the text line by line, remembering where each word sits in it and on the picture
    words, text, last = [], "", None
    for i, w in enumerate(data["text"]):
        w = w.strip()
        if not w or float(data["conf"][i]) < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        if text:
            text += "\n" if key != last else " "
        last = key
        words.append(dict(start=len(text), end=len(text) + len(w), text=w, conf=float(data["conf"][i]),
                          box=[data["left"][i], data["top"][i], data["width"][i], data["height"][i]]))
        text += w
    sink = body.sink if body.sink in E.SINKS else "kyc-archive"
    ev = eng().process(text, "card-scan", sink) if text else dict(after="", findings=[], latency_ms=0)
    marks = []
    for f in ev["findings"]:
        boxes = [w["box"] for w in words if w["start"] < f["end"] and w["end"] > f["start"]]
        if boxes:
            x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
            x1 = max(b[0] + b[2] for b in boxes); y1 = max(b[1] + b[3] for b in boxes)
            marks.append(dict(type=f["type"], p=f["p"], protected=f["protected"], token=f.get("token"),
                              value=text[f["start"]:f["end"]], box=[x0, y0, x1 - x0, y1 - y0]))
    return dict(width=img.size[0], height=img.size[1], text=text, after=ev["after"], marks=marks, words=len(words),
                ocr_ms=round(ocr_ms), firewall_ms=ev["latency_ms"], sink=sink)


# ================================================================ 5. post-quantum
def _pqc():
    from pqc import hybrid as H
    return H


class PqcIn(BaseModel):
    customer_ref: str | None = None


@router.post("/api/pqc/harvest")
def pqc_harvest(body: PqcIn):
    """Wrap a customer's purpose keys for the DR site twice (classical X25519 and hybrid
    X25519 + ML-KEM-768), let an attacker record both blobs, then simulate the quantum
    computer: Shor's algorithm gives the X25519 private key (we hand it over), and no
    quantum attack on ML-KEM is known (the attacker can only guess that half)."""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PublicKey
    import hashlib
    H = _pqc()
    e = eng()
    ref = body.customer_ref if body.customer_ref in e.customers else sorted(e.customers)[0]
    keys = {p: secrets.token_bytes(32) for p in ("Service", "Loans", "Marketing")}
    out = {}
    for name, cls in (("classical", H.ClassicalKEM), ("hybrid", H.HybridKEM)):
        rec = cls()
        pub = rec.public()
        t0 = time.perf_counter()
        blob = H.wrap_keys(pub, keys)
        wrap_ms = (time.perf_counter() - t0) * 1000
        h = H.blob_header(blob)
        ct = H.unb64(h["ct"])
        # the quantum step: what Shor's algorithm computes from the public key
        ss_x = rec.x.exchange(X25519PublicKey.from_public_bytes(ct[:32]))
        pk = rec.x.public_key().public_bytes_raw()
        if name == "classical":
            ss = hashlib.sha3_256(b"aran-x25519-v1" + ss_x + ct[:32] + pk).digest()
        else:
            ss = H._combine(secrets.token_bytes(32), ss_x, ct[:32], pk)
        try:
            got = H.unwrap_keys(None, blob, shared_secret=ss)
            opened = all(bytes(got[k]) == keys[k] for k in keys)
        except InvalidTag:
            opened = False
        ok = H.unwrap_keys(rec, blob) == {k: bytearray(v) for k, v in keys.items()}
        pub_bytes = sum(len(v) for v in pub.values() if isinstance(v, (bytes, bytearray)))
        out[name] = dict(alg=pub["alg"], public_key_bytes=pub_bytes, ciphertext_bytes=len(ct), blob_bytes=len(blob),
                         wrap_ms=round(wrap_ms, 2), owner_opens=ok, quantum_attacker_opens=opened,
                         header=dict(alg=h["alg"], ct=h["ct"][:48] + "…", nonce=h["nonce"]))
    return dict(customer=ref, purposes=list(keys), **out)


@router.get("/api/pqc/receipt")
def pqc_receipt():
    """The newest erasure receipt the live vault signed (hybrid Ed25519 + ML-DSA-65)."""
    e = eng()
    with e.lock:
        rs = sorted(e.vault.destroyed.values(), key=lambda r: r.get("event", {}).get("at", 0))
    if not rs:
        return dict(receipt=None)
    r = rs[-1]
    size = lambda k: len(base64.b64decode(r[k])) if r.get(k) else 0
    return dict(receipt=dict(alg=r.get("alg", "Ed25519"), customer=r["event"].get("customer"),
                             purpose=r["event"].get("purpose"), ed25519_sig_bytes=size("signature"),
                             ml_dsa_sig_bytes=size("pq_signature"), ml_dsa_pub_bytes=size("pq_public_key")),
                verify=E.verify_receipt(r))


@router.get("/api/pqc/cbom")
def pqc_cbom():
    path = os.path.join(E.RESEARCH, "pqc", "cbom.json")
    with open(path) as fh:
        d = json.load(fh)
    rows = []
    for c in d["components"]:
        props = {p["name"]: p["value"] for p in c.get("properties", [])}
        alg = c.get("cryptoProperties", {}).get("algorithmProperties", {})
        rows.append(dict(name=c["name"], primitive=alg.get("primitive"), nist_level=alg.get("nistQuantumSecurityLevel"),
                         quantum=props.get("aran:quantum"),
                         where=[o["location"] for o in c.get("evidence", {}).get("occurrences", [])]))
    return dict(components=rows, format=f'{d["bomFormat"]} {d["specVersion"]}')


@router.get("/api/pqc/mosca")
def pqc_mosca(shelf: float = 10, migration: float = 3, crqc: float = 10):
    H = _pqc()
    return dict(exposed_years=H.mosca(shelf, migration, crqc), shelf=shelf, migration=migration, crqc=crqc)
