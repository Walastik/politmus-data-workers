"""Classify congressional bills with a local Ollama model.

Run as ./scripts/run_classifier.sh [args] (activates the venv) or
python backend/scripts/classify_bills.py [args]. The worker lives in
backend/bill_classifier.py; see --help and the README.
"""

import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from bill_classifier import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
