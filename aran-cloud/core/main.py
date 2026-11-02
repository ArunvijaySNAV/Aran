"""Aran console API. Run: uvicorn main:app --port 8000 (from app/server)."""
import hmac
import os
import re
import sys
import threading
import time

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import engine as E

app = FastAPI(title="Aran console API", version="1.0")


@app.middleware("http")
async def check_internal_secret(request: Request, call_next):
    internal_secret = os.environ.get("ARAN_INTERNAL_SECRET")
    if internal_secret:
        path = request.url.path
        if path != "/api/health":
            provided = request.headers.get("X-Aran-Internal") or ""
            if not hmac.compare_digest(provided, internal_secret):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Unauthorized: missing or invalid X-Aran-Internal header."},
                )
    return await call_next(request)


ENG = None
READY = threading.Event()
LOAD_ERROR = None


def _load():
    global ENG, LOAD_ERROR
    try:
        ENG = E.Engine(n_customers=int(os.environ.get("ARAN_CUSTOMERS", "25")))
        READY.set()
        while True:
            ENG.immune.tick()
            time.sleep(1.0)
    except Exception as e:  # surfaced on /api/health
        LOAD_ERROR = repr(e)
        raise


@app.on_event("startup")
def startup():
    threading.Thread(target=_load, daemon=True).start()


def eng():
    if not READY.is_set():
        raise HTTPException(503, LOAD_ERROR or "Aran is loading its models, try again in a few seconds")
    return ENG


def _check_admin(token_header: str | None):
    admin_token = os.environ.get("ARAN_ADMIN_TOKEN")
    if admin_token and token_header != admin_token:
        raise HTTPException(401, "unauthorized")



# ---------------------------------------------------------------- models
class ProcessIn(BaseModel):
    text: str = Field(max_length=20000)
    source: str = "console"
    sink: str = "log-platform"
    trace_id: str | None = None
    customer_ref: str | None = None
    purpose: str | None = None


class SampleIn(BaseModel):
    kind: str
    who: str = "customer"
    sink: str | None = None


class DetokIn(BaseModel):
    token: str
    caller: str = "console"


class EraseIn(BaseModel):
    customer_ref: str
    purpose: str


class TraceIn(BaseModel):
    dump: str = Field(max_length=200000)


class LearnIn(BaseModel):
    seconds: int = Field(default=360, ge=30, le=1800)


class LabelIn(BaseModel):
    label: str


class ReplayIn(BaseModel):
    rate: float = 1.0


class CustomerIn(BaseModel):
    name: str | None = None


# ---------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return dict(ready=READY.is_set(), error=LOAD_ERROR)


@app.get("/api/config")
def config():
    e = eng()
    return dict(sinks=[dict(name=s, purpose=p, threshold=t) for s, (p, t) in E.SINKS.items()],
                purposes=E.PURPOSES, samples=E.SAMPLES, sample_sinks=E.SAMPLE_SINK, sample_sources=E.SAMPLE_SOURCE,
                public_key=e.vault.public_key_pem(), window_seconds=E.WINDOW,
                drills={"new-sink": "Send customer records to a sink never seen before",
                        "bulk-export": "Bulk export of loan applications in one window",
                        "detok-spike": "Insider detokenises many customer tokens",
                        "bypass": "Firewall switched to monitor-only on the log platform"})


@app.get("/api/stats")
def stats():
    return eng().stats()


@app.post("/api/process")
def process(body: ProcessIn):
    e = eng()
    if body.customer_ref is not None:
        if not re.fullmatch(r"^[A-Za-z0-9_-]{1,64}$", body.customer_ref):
            raise HTTPException(422, "customer_ref must contain only letters, numbers, underscores and dashes (1-64 characters)")
    if body.purpose is not None and body.purpose not in E.PURPOSES:
        raise HTTPException(422, f"purpose must be one of {', '.join(E.PURPOSES)}")
    if body.customer_ref and body.customer_ref not in e.customers and len(e.dynamic_customers) >= 10000:
        raise HTTPException(429, "Dynamic customer enrolment limit reached (10,000 customers)")
    try:
        return e.process(body.text, body.source, body.sink, body.trace_id,
                         customer_ref=body.customer_ref, purpose=body.purpose)
    except ValueError as err:
        raise HTTPException(400, str(err))


@app.post("/api/sample")
def sample(body: SampleIn):
    e = eng()
    if body.kind not in E.SAMPLES:
        raise HTTPException(400, "unknown sample")
    s = e.sample(body.kind, body.who)
    return e.process(s["text"], s["source"], body.sink or s["sink"], s["trace_id"])


@app.get("/api/events")
def events(limit: int = 50):
    e = eng()
    with e.lock:
        return list(e.events)[:max(1, min(limit, 300))]


@app.get("/api/customers")
def customers():
    e = eng()
    with e.lock:
        return [e.customer_view(r) for r in sorted(e.customers)]


@app.post("/api/customers")
def add_customer(body: CustomerIn):
    e = eng()
    c = e.add_customer(body.name)
    return e.customer_view(c["ref"])


@app.get("/api/customers/{ref}")
def customer(ref: str):
    e = eng()
    if ref not in e.customers:
        raise HTTPException(404, "no such customer")
    with e.lock:
        v = e.customer_view(ref)
        v["tokens"] = [dict(token=t, sink=x["sink"], purpose=x["purpose"], type=x["type"], at=x["at"])
                       for t, x in e.vault.vault.items() if x["customer"] == ref][-50:]
        return v


@app.post("/api/detokenise")
def detokenise(body: DetokIn):
    return eng().detokenise(body.token.strip(), body.caller)


@app.post("/api/erase")
def erase(body: EraseIn, x_admin_token: str | None = Header(None)):
    _check_admin(x_admin_token)
    e = eng()
    try:
        return e.erase(body.customer_ref, body.purpose)
    except PermissionError as err:
        raise HTTPException(423, str(err))
    except KeyError as err:
        raise HTTPException(404, str(err))


@app.post("/api/receipts/verify")
def verify(receipt: dict):
    try:
        return E.verify_receipt(receipt)
    except Exception as err:
        return dict(valid=False, signature_valid=False, included_in_log=False, error=str(err))


@app.get("/api/public-keys")
@app.get("/api/keys/public")
def public_keys():
    e = eng()
    with e.lock:
        if e.vault.signer is not None:
            pub = e.vault.signer.public()
            return dict(
                alg=pub["alg"],
                context=e.vault.signer.context.decode("ascii", errors="ignore"),
                public_keys=dict(
                    ed25519=pub["ed25519"],
                    ml_dsa_65=pub["ml_dsa_65"],
                ),
                created_at=e.started,
                key_id="aran-signer-primary",
                backup_policy=E.BACKUP_POLICY_STATEMENT,
            )
        else:
            return dict(
                alg="Ed25519",
                public_keys=dict(
                    ed25519=e.vault.public_key_pem(),
                ),
                created_at=e.started,
                key_id="aran-signer-primary",
                backup_policy=E.BACKUP_POLICY_STATEMENT,
            )


@app.get("/api/merkle")
def merkle():
    e = eng()
    with e.lock:
        log = e.vault.log
        return dict(size=len(log.leaves), root=log.root().hex(),
                    recent=list(reversed(log.entries[-25:])))


@app.post("/api/trace")
def trace(body: TraceIn):
    return eng().trace(body.dump)


@app.get("/api/leaked-dump")
def leaked_dump(sink: str, lines: int = 20):
    return dict(sink=sink, dump=eng().leaked_dump(sink, max(1, min(lines, 200))))


@app.get("/api/immune")
def immune():
    e = eng()
    with e.lock:
        return dict(state=e.immune.state, alerts=[{k: v for k, v in a.items() if k != "_x"} for a in e.immune.alerts[:100]],
                    open_windows=len(e.immune.cur), closed_windows=len(e.immune.closed))


@app.post("/api/immune/learn")
def learn(body: LearnIn):
    e = eng()
    e.immune.start_learning(body.seconds)
    if not e.replay.running:
        e.replay.start(e.replay.rate)
    return e.immune.state


@app.post("/api/immune/alerts/{alert_id}/label")
def label(alert_id: str, body: LabelIn):
    if body.label not in ("attack", "normal"):
        raise HTTPException(400, "label is attack or normal")
    try:
        a = eng().immune.label(alert_id, body.label)
    except StopIteration:
        raise HTTPException(404, "no such alert")
    return {k: v for k, v in a.items() if k != "_x"}


@app.post("/api/drills/{kind}")
def run_drill(kind: str):
    e = eng()
    if e.immune.state["mode"] != "watching":
        raise HTTPException(409, "Teach the immune layer normal traffic first")
    try:
        return dict(done=E.drill(e, kind), window_seconds=E.WINDOW)
    except KeyError:
        raise HTTPException(404, "unknown drill")


@app.post("/api/replay/start")
def replay_start(body: ReplayIn):
    e = eng()
    try:
        e.replay.start(body.rate)
    except RuntimeError as err:
        raise HTTPException(500, str(err))
    return e.replay.status()


@app.post("/api/replay/stop")
def replay_stop():
    e = eng()
    e.replay.stop()
    return e.replay.status()


@app.get("/api/results")
def results():
    return E.results()


JOBS = {"tests": [sys.executable, "-m", "pytest", "-q", "test_core.py", "test_registry.py", "test_shredder.py"],
        "e1-e4": [sys.executable, "experiment.py"]}


@app.post("/api/jobs/{name}")
def start_job(name: str, x_admin_token: str | None = Header(None)):
    _check_admin(x_admin_token)
    e = eng()
    if name not in JOBS:
        raise HTTPException(404, "unknown job")
    j = e.jobs.get(name)
    if j and j["finished"] is None:
        return j
    return E.run_job(e, name, JOBS[name])


@app.get("/api/jobs/{name}")
def get_job(name: str):
    if name not in JOBS:
        raise HTTPException(404, "unknown job")
    return eng().jobs.get(name)  # null until it has been run once


class DigitsIn(BaseModel):
    digits: str = Field(max_length=40)


@app.post("/api/tour/checksum")
def tour_checksum(body: DigitsIn):
    try:
        return E.checksum_explain(body.digits)
    except ValueError as err:
        raise HTTPException(400, str(err))


@app.get("/api/tour/generate")
def tour_generate():
    """A fresh generated Aadhaar, card and mobile (checksum-valid, belonging to no one)."""
    import synth
    r = eng().rand
    return dict(aadhaar=E.re.sub(r"\D", "", synth.gen_aadhaar(r)), card=E.re.sub(r"\D", "", synth.gen_card(r)),
                mobile=E.re.sub(r"\D", "", synth.gen_mobile(r))[-10:])


@app.post("/api/tour/tokens")
def tour_tokens():
    return E.tour_tokens(eng())


@app.post("/api/tour/false-alarms")
def tour_false_alarms():
    return E.tour_false_alarms(eng())


class RefIn(BaseModel):
    customer_ref: str


@app.post("/api/tour/customer-loan")
def tour_customer_loan(body: RefIn):
    e = eng()
    if body.customer_ref not in e.customers:
        raise HTTPException(404, "no such customer")
    s = e.sample("loan", ref=body.customer_ref)
    return e.process(s["text"], "guided-tour", "loan-vendor", s["trace_id"], observe=False)


@app.post("/api/tour/evasion")
def tour_evasion():
    return E.tour_evasion(eng())


class KindIn(BaseModel):
    kind: str | None = None


@app.post("/api/tour/packet")
def tour_packet(body: KindIn):
    if body.kind and body.kind not in E.SAMPLES:
        raise HTTPException(400, "unknown sample")
    return E.tour_packet(eng(), body.kind)


class SinkIn(BaseModel):
    sink: str = "log-platform"
    aadhaar: str | None = Field(default=None, max_length=12)


@app.post("/api/tour/build-token")
def tour_build_token(body: SinkIn):
    if body.sink not in E.SINKS:
        raise HTTPException(400, "unknown sink")
    return E.tour_build_token(eng(), body.sink, body.aadhaar)


@app.get("/api/tour/immune-space")
def tour_immune_space(axes: str = "0,1,3"):
    try:
        a = [int(x) for x in axes.split(",")]
    except ValueError:
        raise HTTPException(400, "axes are three feature numbers, e.g. 0,1,3")
    if len(a) != 3 or len(set(a)) != 3 or not all(0 <= x < 7 for x in a):
        raise HTTPException(400, "pick three different features from 0 to 6")
    return E.tour_immune_space(eng(), tuple(a))


@app.get("/api/tour/immune-radar")
def tour_immune_radar():
    return E.tour_immune_radar(eng())


class GatewayIn(BaseModel):
    role: str = "customer-care"
    text: str = Field(max_length=4000)


@app.post("/api/tour/gateway")
def tour_gateway(body: GatewayIn):
    if body.role not in ("kyc-officer", "customer-care", "analyst"):
        raise HTTPException(400, "role is kyc-officer, customer-care or analyst")
    return E.tour_gateway(eng(), body.role, body.text)


# ---------------------------------------------------------------- demo features
# phone arena, with/without split screen, leakage ledger, card photo scan, post-quantum (standout.py)
import standout  # noqa: E402

standout._eng = eng
app.include_router(standout.router)


# ---------------------------------------------------------------- frontend
# "/" is the console from the team's design (app/ui, plain HTML, CSS and JS, no build step).
# The earlier React console (app/web, built to app/web/dist) stays at /classic.
HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "..", "ui")
DIST = os.path.join(HERE, "..", "web", "dist")
if os.path.isdir(os.path.join(DIST, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST, "assets")), name="assets")


@app.get("/classic")
@app.get("/classic/")
def classic():
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        raise HTTPException(404, "the classic console is not built; run npm run build in app/web")
    return FileResponse(os.path.join(DIST, "index.html"))


@app.get("/{path:path}")
def ui(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "no such endpoint")
    root = os.path.realpath(UI)
    f = os.path.realpath(os.path.join(root, path))
    if path and f.startswith(root + os.sep) and os.path.isfile(f):
        return FileResponse(f, headers={"Cache-Control": "no-cache"})
    return FileResponse(os.path.join(root, "index.html"), headers={"Cache-Control": "no-cache"})
