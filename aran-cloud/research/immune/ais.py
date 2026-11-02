"""Artificial immune system (AIS) for data-flow anomaly detection: the "biology plan".

Owner pair: Inbathamizhan S, Aasif Ahmed A (cyber security).

The body's T-cells are trained in the thymus: any T-cell that reacts to the body's own
proteins ("self") is destroyed, so the survivors react only to foreign things
("non-self"). Negative selection copies this (Forrest et al. 1994). Here "self" is the
set of normal data flows the firewall has seen (who sends which data class to which
sink, how much, at what hour, how much of it raw). Random detectors are generated and
any detector that matches a normal flow is deleted. A new flow that a surviving
detector matches is anomalous.

This module implements the real-valued V-detector variant (Ji & Dasgupta 2004):
detectors are hyperspheres whose radius stretches up to the edge of the self region,
and generation stops when sampling estimates the non-self space is covered to a target
level. Two more immune ideas are added:

* Immune memory (clonal selection, de Castro & Von Zuben 2002): when an analyst confirms
  an attack, the matching point is cloned into memory detectors with small mutations,
  so a repeat of the same attack is caught with a higher score.
* Self-tolerance update: when an analyst marks an alert as a false alarm, the point is
  added to self and every detector covering it is removed, as the thymus would.
"""
import math

import numpy as np
from sklearn.neighbors import NearestNeighbors


class Scaler:
    """Maps each feature so the self range sits in [0.1, 0.7]; values outside self clip
    towards the [0, 1] edges, leaving non-self room on both sides."""

    def fit(self, X):
        self.lo, self.hi = X.min(0), X.max(0)
        self.span = np.where(self.hi - self.lo > 1e-9, self.hi - self.lo, 1.0)
        return self

    def transform(self, X):
        return np.clip((np.asarray(X, float) - self.lo) / self.span * 0.6 + 0.1, 0.0, 1.0)


class VDetectorNSA:
    def __init__(self, self_radius=0.05, coverage=0.999, max_detectors=5000, seed=0):
        self.rs, self.coverage, self.max_detectors = self_radius, coverage, max_detectors
        self.rng = np.random.default_rng(seed)

    # ------------------------------------------------------------ training (thymus)
    def fit(self, X_self):
        self.scaler = Scaler().fit(X_self)
        self.self_pts = self.scaler.transform(X_self)
        self._nn = NearestNeighbors(n_neighbors=1).fit(self.self_pts)
        d = self.self_pts.shape[1]
        centres, radii = [], []
        streak, need = 0, math.ceil(1 / (1 - self.coverage))
        tries = 0
        while len(centres) < self.max_detectors and tries < 200 * self.max_detectors:
            tries += 1
            x = self.rng.random(d)
            if centres and np.any(np.linalg.norm(np.array(centres) - x, axis=1) < np.array(radii)):
                streak += 1
                if streak >= need:
                    break
                continue
            streak = 0
            ds = self._nn.kneighbors(x[None], return_distance=True)[0][0, 0]
            if ds > self.rs:
                centres.append(x); radii.append(ds - self.rs)
        self.C, self.R = np.array(centres).reshape(-1, d), np.array(radii)
        self.mem_C, self.mem_R = np.empty((0, d)), np.empty(0)
        return self

    # ------------------------------------------------------------ inference
    def _margin(self, Z, C, R):
        if len(C) == 0:
            return np.full(len(Z), -1.0)
        best = np.full(len(Z), -np.inf)
        for i in range(0, len(C), 1024):
            D = np.linalg.norm(Z[:, None, :] - C[None, i:i + 1024, :], axis=2)
            best = np.maximum(best, (R[None, i:i + 1024] - D).max(1))
        return best

    def score(self, X):
        """Signed margin: > 0 means inside a detector (non-self). Memory detectors add a
        boost, as a secondary immune response is faster and stronger."""
        Z = self.scaler.transform(X)
        s = self._margin(Z, self.C, self.R)
        if len(self.mem_C):
            m = self._margin(Z, self.mem_C, self.mem_R)
            s = np.maximum(s, np.where(m > 0, m + 0.1, m))
        return s

    def predict(self, X):
        return (self.score(X) > 0).astype(int)

    # ------------------------------------------------------------ adaptive immunity
    def confirm_attack(self, x, clones=10, sigma=0.02):
        z = self.scaler.transform(np.asarray(x, float)[None])[0]
        pts = [z] + [np.clip(z + self.rng.normal(0, sigma, z.shape), 0, 1) for _ in range(clones)]
        for p in pts:
            ds = self._nn.kneighbors(p[None])[0][0, 0]
            if ds > self.rs:
                self.mem_C = np.vstack([self.mem_C, p]); self.mem_R = np.append(self.mem_R, ds - self.rs)

    def confirm_false_alarm(self, x):
        z = self.scaler.transform(np.asarray(x, float)[None])[0]
        self.self_pts = np.vstack([self.self_pts, z])
        self._nn = NearestNeighbors(n_neighbors=1).fit(self.self_pts)
        keep = np.linalg.norm(self.C - z, axis=1) >= self.R + self.rs
        self.C, self.R = self.C[keep], self.R[keep]
        if len(self.mem_C):
            keep = np.linalg.norm(self.mem_C - z, axis=1) >= self.mem_R + self.rs
            self.mem_C, self.mem_R = self.mem_C[keep], self.mem_R[keep]


def tune_self_radius(X_self, X_val_normal, target_fpr=0.02, grid=(0.02, 0.03, 0.05, 0.08, 0.12, 0.16, 0.2), coverage=0.999, seed=0):
    """Smallest self radius whose false-alarm rate on held-out normal data is <= target."""
    for rs in grid:
        m = VDetectorNSA(self_radius=rs, coverage=coverage, seed=seed).fit(X_self)
        fpr = float(m.predict(X_val_normal).mean())
        if fpr <= target_fpr:
            return rs, fpr, m
    return rs, fpr, m
