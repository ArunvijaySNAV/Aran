"""AI gateway for LLM prompts (roadmap item 6).

Owner pairs: Bharadhwaj M, SN Arun Vijay (gateway and prompt handling);
Inbathamizhan S, Aasif Ahmed A (detokenise log and access control).

Banks are putting chatbots and copilots in front of customer data, and RBI's FREE-AI
framework (August 2025) asks them to govern what goes into AI. The gateway sits between
staff tools and any model provider and speaks the OpenAI-compatible chat format:

  1. Every message is scanned by Aran's calibrated detector (with the normaliser and
     registries if attached). Each sensitive value becomes a typed placeholder such as
     <AADHAAR_1> or <PER_2>. The same value gets the same placeholder throughout one
     conversation, so the model can still reason ("<PER_1> owns <CARD_1>").
  2. Only placeholders leave the bank. The provider never sees a raw identifier, and
     anything it memorises or logs is a placeholder with no meaning outside the bank.
  3. The model's reply is scanned again (a model can produce real-looking numbers from
     memory or from a document); new values are replaced and never resolved.
  4. Placeholders in the reply are resolved only for a caller whose role may see that
     type, and only for placeholders issued in that caller's own conversation. Every
     resolution is appended to a hash-chained audit log (caller, conversation, type,
     count), so a reviewer can prove the log was not edited.
  5. Text that already looks like a placeholder in a user's message is neutralised
     first, so nobody can plant <AADHAAR_1> and have it resolved later, and a model
     tricked into printing another conversation's placeholders resolves nothing.

OTPs are never stored: an OTP becomes <OTP_n> with no value behind it.
"""
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass, field

PLACEHOLDER = re.compile(r"<(AADHAAR|CARD|MOBILE|PAN|OTP|UPI|PER|ADDR)_(\d{1,6})>")
NO_VALUE = {"OTP"}

# Which types each role may see in clear in model replies. Anything else is shown masked.
DEFAULT_ROLES = {
    "kyc-officer": {"AADHAAR", "CARD", "MOBILE", "PAN", "UPI", "PER", "ADDR"},
    "customer-care": {"MOBILE", "UPI", "PER", "ADDR"},
    "analyst": set(),
}


def mask_value(typ, value):
    d = re.sub(r"\D", "", value)
    if typ in ("AADHAAR", "CARD", "MOBILE") and len(d) >= 4:
        return "X" * (len(d) - 4) + d[-4:]
    if typ == "PAN":
        return "XXXXX" + value[5:9] + "X"
    return f"[{typ} hidden]"


@dataclass
class Conversation:
    owner: str
    by_value: dict = field(default_factory=dict)  # (type, value) -> placeholder
    by_ph: dict = field(default_factory=dict)     # placeholder -> (type, value or None)
    count: dict = field(default_factory=dict)     # type -> last number used


class AuditLog:
    """Append-only, hash-chained: entry_i carries H(entry_{i-1}), so changing or deleting
    any entry breaks every later hash."""

    def __init__(self):
        self.entries, self.head = [], "0" * 64

    def append(self, **rec):
        rec = dict(rec, t=round(time.time(), 3), prev=self.head)
        self.head = hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).hexdigest()
        rec["hash"] = self.head
        self.entries.append(rec)
        return rec

    def verify(self):
        prev = "0" * 64
        for e in self.entries:
            body = {k: v for k, v in e.items() if k != "hash"}
            if body["prev"] != prev or hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest() != e["hash"]:
                return False
            prev = e["hash"]
        return True


class AIGateway:
    def __init__(self, detector, upstream, roles=None, threshold=0.5, key=None):
        """detector: ai.detector.Detector (normaliser and registries optional).
        upstream: callable(list of {"role","content"}) -> reply text. This is where the
        provider call goes (see openai_upstream below)."""
        self.det, self.upstream = detector, upstream
        self.roles = roles or DEFAULT_ROLES
        self.threshold = threshold
        self.key = key or secrets.token_bytes(16)
        self.convs = {}
        self.audit = AuditLog()
        self.sent = []  # exactly what went to the provider, for inspection and tests

    # ------------------------------------------------------------ helpers
    def conversation(self, conv_id, caller):
        c = self.convs.get(conv_id)
        if c is None:
            c = self.convs[conv_id] = Conversation(owner=caller)
        return c

    @staticmethod
    def neutralise(text):
        """User text that imitates a placeholder is rewritten so it can never resolve."""
        return PLACEHOLDER.sub(lambda m: f"[{m.group(1)}-{m.group(2)}]", text)

    def _placeholder(self, conv, typ, value, keep=True):
        k = (typ, value)
        if typ not in NO_VALUE and k in conv.by_value:
            return conv.by_value[k]
        n = conv.count.get(typ, 0) + 1
        conv.count[typ] = n
        ph = f"<{typ}_{n}>"
        conv.by_ph[ph] = (typ, value if keep and typ not in NO_VALUE else None)
        if keep and typ not in NO_VALUE:
            conv.by_value[k] = ph
        return ph

    def tokenise(self, text, conv, trace_id=None, keep=True):
        """Placeholders for every finding at or above the threshold. Returns (text, findings)."""
        findings = [f for f in self.det.scan(text, threshold=self.threshold, trace_id=trace_id) if f.p >= self.threshold]
        out, last = [], 0
        for f in sorted(findings, key=lambda f: f.start):
            if f.start < last:
                continue
            value = f.meta.get("value", text[f.start:f.end])
            ph = self._placeholder(conv, f.type, value, keep)
            parts = f.meta.get("parts")
            if parts:  # split field: placeholder in the first part, later parts emptied
                for i, (a, b) in enumerate(parts):
                    out.append(text[last:a]); out.append(ph if i == 0 else ""); last = b
            else:
                out.append(text[last:f.start]); out.append(ph); last = f.end
        out.append(text[last:])
        return "".join(out), findings

    def detokenise(self, text, conv_id, caller):
        """Resolve placeholders of this conversation that the caller's role may see."""
        conv = self.convs.get(conv_id)
        allowed = self.roles.get(self.role_of(caller), set())
        shown, masked, refused = {}, 0, 0

        def sub(m):
            nonlocal masked, refused
            ph = m.group(0)
            if conv is None or conv.owner != caller or ph not in conv.by_ph:
                refused += 1
                return ph
            typ, value = conv.by_ph[ph]
            if value is None:
                return ph
            if typ in allowed:
                shown[typ] = shown.get(typ, 0) + 1
                return value
            masked += 1
            return mask_value(typ, value)

        out = PLACEHOLDER.sub(sub, text)
        if shown or masked or refused:
            self.audit.append(caller=caller, conversation=conv_id, shown=shown, masked=masked, refused=refused)
        return out

    @staticmethod
    def role_of(caller):
        return caller.split(":", 1)[0]

    # ------------------------------------------------------------ the call
    def chat(self, caller, conv_id, messages, trace_id=None):
        """caller is "role:user", e.g. "customer-care:agent17". Returns a dict with the
        reply as the caller sees it and what the provider saw."""
        conv = self.conversation(conv_id, caller)
        if conv.owner != caller:
            raise PermissionError("conversation belongs to another caller")
        t0 = time.perf_counter()
        safe, found = [], 0
        for m in messages:
            text = self.neutralise(m.get("content", ""))
            clean, fs = self.tokenise(text, conv, trace_id)
            found += len(fs)
            safe.append({"role": m.get("role", "user"), "content": clean})
        t1 = time.perf_counter()
        self.sent.append(safe)
        reply = self.upstream(safe)
        t2 = time.perf_counter()
        # the reply may hold values the model produced itself; hide them, never resolve them
        reply_clean, rfs = self.tokenise(self.neutralise_foreign(reply, conv), conv, keep=False)
        shown = self.detokenise(reply_clean, conv_id, caller)
        t3 = time.perf_counter()
        return dict(reply=shown, provider_saw=safe, provider_reply=reply, findings_in_prompt=found,
                    findings_in_reply=len(rfs), ms=dict(tokenise=round(1e3 * (t1 - t0), 2), provider=round(1e3 * (t2 - t1), 2),
                                                       detokenise=round(1e3 * (t3 - t2), 2)))

    @staticmethod
    def neutralise_foreign(text, conv):
        """Placeholders in a reply that this conversation never issued are neutralised."""
        return PLACEHOLDER.sub(lambda m: m.group(0) if m.group(0) in conv.by_ph else f"[{m.group(1)}-{m.group(2)}]", text)


# ---------------------------------------------------------------- providers
def openai_upstream(url, api_key, model, timeout=60):
    """Any OpenAI-compatible provider or local model server (vLLM, Ollama, llama.cpp).
    The key comes from the caller's environment, never from the repo."""
    import httpx

    def call(messages):
        r = httpx.post(url.rstrip("/") + "/chat/completions", timeout=timeout,
                       headers={"Authorization": f"Bearer {api_key}"},
                       json={"model": model, "messages": messages})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    return call


def recorder_upstream(log):
    """Test provider: records each request and replies with the last user message, which
    is the hardest case for the gateway (every placeholder comes straight back)."""
    def call(messages):
        log.append(messages)
        return "You wrote: " + messages[-1]["content"]
    return call


def make_router(gateway):
    """FastAPI router exposing POST /v1/chat/completions. Headers: X-Aran-Caller
    ("role:user") and X-Aran-Conversation. Mount it on any FastAPI app."""
    from fastapi import APIRouter, Header, HTTPException

    router = APIRouter()

    @router.post("/v1/chat/completions")
    def completions(body: dict, x_aran_caller: str = Header(...), x_aran_conversation: str = Header(...),
                    traceparent: str = Header(None)):
        trace = traceparent.split("-")[1] if traceparent and traceparent.count("-") >= 3 else None
        try:
            res = gateway.chat(x_aran_caller, x_aran_conversation, body.get("messages", []), trace_id=trace)
        except PermissionError as e:
            raise HTTPException(403, str(e))
        return {"object": "chat.completion", "model": body.get("model", "aran-gateway"),
                "choices": [{"index": 0, "message": {"role": "assistant", "content": res["reply"]}, "finish_reason": "stop"}],
                "aran": {"provider_saw": res["provider_saw"], "findings_in_prompt": res["findings_in_prompt"],
                         "findings_in_reply": res["findings_in_reply"], "ms": res["ms"]}}

    @router.get("/v1/aran/audit")
    def audit():
        return {"verified": gateway.audit.verify(), "entries": gateway.audit.entries[-200:]}

    return router
