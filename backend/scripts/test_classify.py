"""Manual check: classify one bill with the local model (writes nothing) and
score its intents against sample stances, as if an official voted Yea.

    python backend/scripts/test_classify.py [bill_id] [--model qwen3.6:27b]

Not a pytest test (pytest runs with --ignore=scripts).
"""

import argparse
import json
import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from bill_classifier import (  # noqa: E402
    DEFAULT_HOST,
    DEFAULT_MODEL,
    DEFAULT_NUM_CTX,
    DEFAULT_NUM_PREDICT,
    DEFAULT_TIMEOUT_SECONDS,
    load_local_prompts,
)
from database import SessionLocal  # noqa: E402
from models import Bill  # noqa: E402
from services.bill_classification import BillSnapshot, classify_bill, summary_text  # noqa: E402
from services.llm_runtime import make_chat_fn  # noqa: E402

SAMPLE_STANCES = [
    {"target": "Immigration Enforcement", "mechanism": "funding", "direction": "increase"},
    {"target": "Taxation", "mechanism": "taxation", "direction": "decrease"},
    {"target": "Climate Change", "mechanism": "regulation", "direction": "increase"},
    {"target": "Healthcare", "mechanism": "funding", "direction": "increase"},
]


def evaluate_intents(intents, stances):
    """Score intents against stances as if the official voted Yea."""
    total_score = 0
    receipts = []
    stance_map = {s["target"]: s for s in stances}
    for intent in intents:
        stance = stance_map.get(intent.target)
        if stance is None or stance["mechanism"] != intent.mechanism:
            continue
        if stance["direction"] == intent.direction:
            score = 1
        elif stance["direction"] in ("increase", "decrease") and intent.direction in ("increase", "decrease"):
            score = -1
        else:
            score = 0
        if score:
            total_score += score
            receipts.append({
                "target": intent.target,
                "mechanism": intent.mechanism,
                "stance_direction": stance["direction"],
                "effect_direction": intent.direction,
                "simulated_vote": "Yea",
                "score_delta": score,
                "rationale": intent.rationale,
                "citation": intent.citation,
            })
    return total_score, receipts


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("bill_id", nargs="?")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        query = db.query(Bill)
        if args.bill_id:
            bill = query.filter(Bill.id == args.bill_id).first()
        else:
            bill = query.filter(Bill.classification_metadata.is_(None), Bill.summary.isnot(None), Bill.summary != "").first()
        if bill is None:
            print("No matching bill. Pass a bill id: python backend/scripts/test_classify.py <bill_id>")
            return
        snapshot = BillSnapshot.of(bill)
    finally:
        db.close()

    text = summary_text(snapshot.summary)
    print(f"Found bill: {snapshot.id} - {snapshot.title}")
    print(f"Summary text: {len(text):,} chars\n")
    if not text:
        print("No CRS summary yet; nothing to classify.")
        return

    print(f"Running inference through {args.model}...")
    chat_fn = make_chat_fn(args.model, DEFAULT_HOST, DEFAULT_TIMEOUT_SECONDS, DEFAULT_NUM_CTX, DEFAULT_NUM_PREDICT)
    prompts = load_local_prompts()
    result = classify_bill(snapshot, text, prompt=prompts.system, summary_prompt=prompts.summary, chat_fn=chat_fn, log=print)
    print(json.dumps(result.metadata(model=args.model, version="manual", classified_at=""), indent=2))

    print("\nEvaluating against sample stances (assuming a 'Yea' vote)...")
    total_score, receipts = evaluate_intents(result.intents, SAMPLE_STANCES)
    print(f"Final Score (Simulated Yea): {total_score}")
    print(json.dumps(receipts, indent=2))


if __name__ == "__main__":
    main()
