"""Train Aran's detector once and save it for the live server.

Runs the same training as research/experiment_ai.py (E5 NER, E6 OTP and UPI context
classifiers, E7 stacking and isotonic calibration) on the same public corpora, then
pickles the calibrated detector to models/detector.pkl. The server loads that file,
so it needs no datasets at run time.

    cd research && ./fetch_data.sh && ./fetch_ai_data.sh
    python3 app/server/build_models.py
"""
import os
import pickle
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.join(HERE, "..", "research")
sys.path.insert(0, RESEARCH)
os.chdir(RESEARCH)

import experiment_ai as X  # noqa: E402
from ai.detector import Detector  # noqa: E402

t0 = time.time()
ner_fold, ner = X.e5()
fold, final = X.e6()
det_fold = Detector(ner_fold, fold["otp"], fold["upi"])
half = len(X.TRAIN_CAL) // 2
F1, Y1 = X._findings(det_fold, X.TRAIN_CAL[:half], X.REAL1[0::2] + X.SMS1[0::2])
det_fold.fit_stack(F1, Y1)
F2, Y2 = X._findings(det_fold, X.TRAIN_CAL[half:], X.REAL1[1::2] + X.SMS1[1::2])
det_fold.fit_calibration(F2, Y2)
det = Detector(ner, final["otp"], final["upi"])
det.stack, det.iso = det_fold.stack, det_fold.iso

os.makedirs(os.path.join(HERE, "models"), exist_ok=True)
out = os.path.join(HERE, "models", "detector.pkl")
with open(out, "wb") as fh:
    pickle.dump(det, fh)
X.log("saved", out, os.path.getsize(out), "bytes in", round(time.time() - t0), "s")
