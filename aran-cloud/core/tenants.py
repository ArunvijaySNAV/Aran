"""Per-tenant engines: the isolation boundary of Aran.

Every tenant gets its own Engine: its own store (vault, owner index, token index, Merkle log,
receipts), FF1 key, signing keys (Ed25519 + ML-DSA-65), registries, immune state, leakage ledger
and gateway audit. Nothing is shared between tenants except the read-only trained detector.

Layout:  <tenants_dir>/<tenant_id>/aran.db  and  <tenants_dir>/<tenant_id>/keys.db
Keys at rest are wrapped by a per-tenant KEK = HKDF(ARAN_MASTER_KEY, salt=tenant_id, info=aran-tenant-kek-v1).
"""
import collections
import os
import re
import threading
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

import engine as E
from firewall.store import parse_master_key

TENANT_ID_RX = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
KEK_INFO = b"aran-tenant-kek-v1"


def valid_tenant_id(tid):
    return bool(tid) and TENANT_ID_RX.fullmatch(tid) is not None


def tenant_kek(master_key, tenant_id):
    """Per-tenant key-encryption key (32 bytes)."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=tenant_id.encode("utf-8"), info=KEK_INFO) \
        .derive(parse_master_key(master_key))


class _Slot:
    def __init__(self):
        self.engine = None
        self.inflight = 0
        self.lock = threading.Lock()   # serialises creation of this tenant's engine


class TenantManager:
    def __init__(self, tenants_dir, master_key, capacity=32, base=None):
        self.tenants_dir = os.path.abspath(tenants_dir)
        self.master_key = parse_master_key(master_key)
        self.capacity = max(1, int(capacity))
        self.base = base
        self._slots = collections.OrderedDict()   # tenant_id -> _Slot, least recently used first
        self._mu = threading.Lock()
        os.makedirs(self.tenants_dir, mode=0o700, exist_ok=True)

    # ------------------------------------------------------------ lifecycle
    def _build(self, tenant_id):
        tdir = os.path.join(self.tenants_dir, tenant_id)
        os.makedirs(tdir, mode=0o700, exist_ok=True)
        eng = E.Engine(n_customers=0, store_path=os.path.join(tdir, "aran.db"),
                       master_key=tenant_kek(self.master_key, tenant_id),
                       base=self.base, auto_learn=False, tenant_id=tenant_id)
        eng.keep_plaintext = False
        return eng

    def acquire(self, tenant_id):
        """Returns the tenant's engine and pins it in the cache until release()."""
        if not valid_tenant_id(tenant_id):
            raise ValueError("invalid tenant id")
        with self._mu:
            slot = self._slots.get(tenant_id)
            if slot is None:
                slot = self._slots[tenant_id] = _Slot()
            self._slots.move_to_end(tenant_id)
            slot.inflight += 1
        try:
            with slot.lock:
                if slot.engine is None:
                    slot.engine = self._build(tenant_id)
            self._evict()
            return slot.engine
        except Exception:
            self.release(tenant_id)
            with self._mu:
                if self._slots.get(tenant_id) is slot and slot.engine is None and slot.inflight == 0:
                    del self._slots[tenant_id]
            raise

    def peek(self, tenant_id):
        """The engine of a tenant already pinned by acquire() (no counting)."""
        with self._mu:
            slot = self._slots.get(tenant_id)
            return slot.engine if slot is not None else None

    def release(self, tenant_id):
        with self._mu:
            slot = self._slots.get(tenant_id)
            if slot is not None:
                slot.inflight = max(0, slot.inflight - 1)

    def _evict(self):
        victims = []
        with self._mu:
            while len(self._slots) > self.capacity:
                tid = next((t for t, sl in self._slots.items() if sl.inflight == 0), None)
                if tid is None:
                    break   # everything is busy; exceed the cap rather than close a live engine
                victims.append(self._slots.pop(tid))
        for sl in victims:
            if sl.engine is not None:
                sl.engine.close()

    def engines(self):
        with self._mu:
            return [sl.engine for sl in self._slots.values() if sl.engine is not None]

    def cached_ids(self):
        with self._mu:
            return list(self._slots)

    def tick(self):
        """Advance every cached tenant's immune windows (one background thread calls this)."""
        for eng in self.engines():
            try:
                eng.immune.tick()
            except Exception:
                pass

    def close(self):
        with self._mu:
            slots, self._slots = list(self._slots.values()), collections.OrderedDict()
        for sl in slots:
            if sl.engine is not None:
                sl.engine.close()
