#!/usr/bin/env python3
"""Which one-sentence label format makes the real /v1/protect tokenise each field type?

Run against a live Aran stack:  ARAN_BASE_URL=http://127.0.0.1:8100 ARAN_APP_KEY=aran_live_... python3 scripts/field_format_experiment.py
Uses only generated, checksum-valid sample data (research/synth.py) and the 40 invented names from the prototype's
names experiment. Prints the protected rate per (field, format) and writes docs/measurements/field_formats.json."""
import json
import os
import random
import re
import sys
import time

import requests

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "aran-cloud", "research"))
import synth  # noqa: E402

BASE = os.environ.get("ARAN_BASE_URL", "http://127.0.0.1:8100").rstrip("/")
KEY = os.environ["ARAN_APP_KEY"]
D = lambda s: re.sub(r"\D", "", s)

NAMES = ["Aarav Sharma", "Priya Patel", "Vikram Malhotra", "Ananya Deshmukh", "Rajesh Iyer", "Meera Nair", "Amod Varma",
         "Sunita Rao", "Kavita Reddy", "Rohan Gupta", "Siddharth Joshi", "Deepa Menon", "Rahul", "Pooja", "Arun", "Suresh",
         "Lakshmi", "Karthik", "Sneha", "Anil", "Deepak", "Vijay", "Anita", "Divya", "Ganesh", "Manoj", "Rajendra Kumble",
         "Siddhesh Marathe", "Pranavi Hegde", "Nandakumar Pillai", "Swati Kulkarni", "Aravind Saran", "Gitanjali Pande",
         "Muralidhar Somani", "Hemant Somasekhar", "Sarojini Bagchi", "Padmini Shanbhag", "Kailash Kanabar",
         "Anand Namboodiri", "Nirupama Dandekar"]

r = random.Random(42)
GEN = {
    "name": ("PER", lambda i: NAMES[i % len(NAMES)]),
    "mobile": ("MOBILE", lambda i: D(synth.gen_mobile(r))[-10:]),
    "aadhaar": ("AADHAAR", lambda i: D(synth.gen_aadhaar(r))),
    "card": ("CARD", lambda i: D(synth.gen_card(r))),
    "pan": ("PAN", lambda i: synth.gen_pan(r)),
    "upi": ("UPI", lambda i: synth.gen_upi(r, "test")),
}
FORMATS = {
    "name": {"Customer name: {v}": "Customer name: {v}", "Account holder {v} opened an account": "Account holder {v} opened an account",
             "Name: {v}": "Name: {v}"},
    "mobile": {"Mobile {v}": "Mobile {v}", "Mobile number: {v}": "Mobile number: {v}", "Customer mobile: +91{v}": "Customer mobile: +91{v}"},
    "aadhaar": {"Aadhaar {v}": "Aadhaar {v}", "Aadhaar number: {v}": "Aadhaar number: {v}"},
    "card": {"Card {v}": "Card {v}", "Card number: {v}": "Card number: {v}"},
    "pan": {"PAN {v}": "PAN {v}", "PAN number: {v}": "PAN number: {v}"},
    "upi": {"UPI ID {v}": "UPI ID {v}", "UPI: {v}": "UPI: {v}"},
}


def protect(text, ref):
    resp = requests.post(f"{BASE}/v1/protect", headers={"X-API-Key": KEY}, timeout=20,
                         json={"text": text, "customer_ref": ref, "sink": "kyc-archive", "purpose": "KYC"})
    resp.raise_for_status()
    return resp.json()


def main(n=40):
    out = {}
    for field, (typ, gen) in GEN.items():
        out[field] = {}
        for label, fmt in FORMATS[field].items():
            ok = 0
            leaked = 0
            for i in range(n):
                v = gen(i)
                res = protect(fmt.format(v=v), f"EXP-{field}-{i}-{int(time.time()*1000)%100000}")
                got = any(f["type"] == typ and f["protected"] for f in res["findings"])
                ok += got
                leaked += (v in res["after"])
            out[field][label] = dict(protected=ok, of=n, rate=round(ok / n, 3), raw_value_left_in_output=leaked)
    print(json.dumps(out, indent=2))
    os.makedirs(os.path.join(ROOT, "docs", "measurements"), exist_ok=True)
    json.dump(dict(measured_at=time.strftime("%Y-%m-%d %H:%M:%S"), results=out),
              open(os.path.join(ROOT, "docs", "measurements", "field_formats.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
