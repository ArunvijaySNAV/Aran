"""Simulated data-flow telemetry of a bank, as the Aran firewall would record it, with
labelled exfiltration scenarios.

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

One record = one (source system, sink, hour) with the number of records that carried
sensitive fields, the data classes seen, the fraction that left raw (not tokenised),
detokenisation calls and distinct customers. No identifiers are generated here, only
counts. The flow catalogue mirrors the channels in the Aran design note.
"""
import math
import random

import numpy as np

# (source, sink, data classes, active hours, mean records/hour, base raw fraction, detok rate, weekday-only)
FLOWS = [
    ("core-banking", "analytics-dwh", {"AADHAAR", "CARD", "MOBILE", "PER"}, [1, 2, 3], 50000, 0.0, 0.0, False),
    ("crm", "call-center", {"PER", "MOBILE", "ADDR"}, list(range(9, 19)), 800, 0.0, 0.02, True),
    ("mobile-app", "log-platform", {"OTP", "UPI", "MOBILE"}, list(range(24)), 3000, 0.0002, 0.0, False),
    ("upi-switch", "log-platform", {"UPI", "MOBILE"}, list(range(24)), 5000, 0.0001, 0.0, False),
    ("loan-origination", "loan-vendor", {"PER", "ADDR", "PAN", "AADHAAR"}, [10, 11], 2000, 0.0, 0.0, True),
    ("employee-desktop", "llm-gateway", {"PER", "AADHAAR", "PAN"}, list(range(9, 20)), 150, 0.002, 0.0, True),
    ("core-banking", "backup-vault", {"AADHAAR", "CARD", "MOBILE", "PER", "ADDR", "PAN"}, [23], 80000, 1.0, 0.0, False),
    ("notification", "email-gateway", {"PER", "MOBILE"}, list(range(8, 22)), 1200, 0.0, 0.0, False),
    ("card-switch", "fraud-engine", {"CARD", "MOBILE"}, list(range(24)), 4000, 0.0, 0.01, False),
]
DIURNAL = [0.3, 0.2, 0.15, 0.15, 0.2, 0.35, 0.6, 0.9, 1.1, 1.3, 1.4, 1.4, 1.3, 1.3, 1.4, 1.4, 1.3, 1.2, 1.2, 1.1, 1.0, 0.8, 0.6, 0.4]


def _rec(day, hour, src, sink, classes, n, raw, detok, cust, label=0, attack=None):
    return dict(day=day, hour=hour, src=src, sink=sink, classes=set(classes), n=max(int(n), 1),
                raw_frac=min(max(raw, 0.0), 1.0), detok_rate=detok, cust_ratio=cust, label=label, attack=attack)


def simulate(days, seed=0):
    r = random.Random(seed)
    out = []
    for day in days:
        weekend = day % 7 in (5, 6)
        for src, sink, classes, hours, mean, raw, detok, wk in FLOWS:
            if wk and weekend:
                continue
            for h in hours:
                shape = DIURNAL[h] if len(hours) == 24 else 1.0
                n = mean * shape * (0.6 if weekend else 1.0) * math.exp(r.gauss(0, 0.25))
                rf = raw * math.exp(r.gauss(0, 0.5)) if 0 < raw < 1 else raw
                cls = {c for c in classes if r.random() < 0.9} or set(classes)
                out.append(_rec(day, h, src, sink, cls, n, rf, detok * math.exp(r.gauss(0, 0.3)),
                                min(1.0, 0.85 + r.gauss(0, 0.05))))
    return out


def inject_attacks(days, seed=1):
    """Labelled attack records. Each scenario has an id so detection can be reported per attack."""
    r = random.Random(seed)
    d = list(days)
    a = []
    # A1 bulk raw export to the loan vendor at 2 am
    a.append(_rec(d[1], 2, "loan-origination", "loan-vendor", {"PER", "ADDR", "PAN", "AADHAAR"}, 95000, 1.0, 0.0, 0.99, 1, "A1 bulk raw export at night"))
    # A2 raw Aadhaar pasted into LLM prompts during office hours, normal volume
    for h in (11, 12, 15):
        a.append(_rec(d[3], h, "employee-desktop", "llm-gateway", {"PER", "AADHAAR", "PAN"}, 160, 0.3, 0.0, 0.85, 1, "A2 raw Aadhaar in LLM prompts"))
    # A3 debug logging left on: small raw fraction into logs for half a day
    for h in range(8, 20):
        n = 3000 * DIURNAL[h] * math.exp(r.gauss(0, 0.25))
        a.append(_rec(d[4], h, "mobile-app", "log-platform", {"OTP", "UPI", "MOBILE"}, n, 0.05, 0.0, 0.85, 1, "A3 debug logs leaking raw OTP/UPI"))
    # A4 shadow-IT sink never seen before
    a.append(_rec(d[5], 14, "crm", "paste-site.example", {"PER", "MOBILE"}, 300, 0.0, 0.0, 0.9, 1, "A4 new external sink"))
    # A5 insider mass detokenisation in the call centre after hours
    for h in (19, 20):
        a.append(_rec(d[6], h, "crm", "call-center", {"PER", "MOBILE", "ADDR"}, 900, 0.0, 0.6, 1.0, 1, "A5 insider detokenisation spike"))
    # A6 repeat of A1 a week later (tests immune memory)
    a.append(_rec(d[-1], 3, "loan-origination", "loan-vendor", {"PER", "ADDR", "PAN", "AADHAAR"}, 70000, 1.0, 0.0, 0.99, 1, "A6 repeat of A1"))
    return a


class FlowFeaturizer:
    """Per-pair baselines learned from self only; features are contextual so 2 am is
    normal for the nightly warehouse load but abnormal for the loan vendor."""

    names = ["volume_z", "raw_frac_z", "hour_distance", "pair_novel", "class_novel", "detok_log", "cust_ratio"]

    def fit(self, records):
        by = {}
        for x in records:
            by.setdefault((x["src"], x["sink"]), []).append(x)
        self.pairs = {}
        for k, xs in by.items():
            v = np.log1p([x["n"] for x in xs])
            lr = np.log10(np.array([x["raw_frac"] for x in xs]) + 1e-4)
            self.pairs[k] = dict(mu=v.mean(), sd=max(v.std(), 0.1), rmu=lr.mean(), rsd=max(lr.std(), 0.25),
                                 hours={x["hour"] for x in xs},
                                 classes=set().union(*[x["classes"] for x in xs]))
        allv = np.log1p([x["n"] for x in records])
        self.g = dict(mu=allv.mean(), sd=allv.std())
        return self

    def transform(self, records):
        rows = []
        for x in records:
            p = self.pairs.get((x["src"], x["sink"]))
            if p:
                z = (math.log1p(x["n"]) - p["mu"]) / p["sd"]
                hd = min(min(abs(x["hour"] - h), 24 - abs(x["hour"] - h)) for h in p["hours"]) / 12
                cn = len(x["classes"] - p["classes"]) / max(len(x["classes"]), 1)
                rz = (math.log10(x["raw_frac"] + 1e-4) - p["rmu"]) / p["rsd"]
                novel = 0.0
            else:
                z, hd, cn, novel = (math.log1p(x["n"]) - self.g["mu"]) / self.g["sd"], 1.0, 1.0, 1.0
                rz = (math.log10(x["raw_frac"] + 1e-4) + 4)
            rows.append([max(min(z, 8), -8), max(min(rz, 8), -8), hd, novel, cn,
                         math.log1p(100 * x["detok_rate"]), x["cust_ratio"]])
        return np.array(rows)
