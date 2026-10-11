"""Batch classification worker for legislative bills using local Ollama model."""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Optional

# Ensure backend and scripts directories are in path
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SCRIPTS_DIR = os.path.abspath(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from ollama import Client
from sqlalchemy import desc, nulls_last
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Bill
from llm_config import SYSTEM_PROMPT, ClassificationMetadata


def clean_html(text: Optional[str]) -> str:
    """Strip HTML tags and normalize whitespace from CRS summaries."""
    if not text:
        return ""
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


def build_bill_context(bill: Bill) -> str:
    """Compile all available bill metadata and summary into an analysis prompt."""
    parts = [f"Bill ID: {bill.id}"]
    if bill.title:
        parts.append(f"Title: {bill.title}")
    if bill.policy_area:
        parts.append(f"Policy Area: {bill.policy_area}")
    if bill.sponsor_name:
        sponsor_info = bill.sponsor_name
        if bill.sponsor_party:
            sponsor_info += f" ({bill.sponsor_party})"
        parts.append(f"Sponsor: {sponsor_info}")
    if bill.bipartisan_type:
        parts.append(f"Bipartisan Status: {bill.bipartisan_type}")
    if bill.status:
        parts.append(f"Legislative Status: {bill.status}")
    if bill.latest_action_text:
        parts.append(f"Latest Action: {bill.latest_action_text}")
    if bill.summary:
        cleaned_summary = clean_html(bill.summary)
        parts.append(f"Congressional Research Service (CRS) Summary:\n{cleaned_summary}")
    return "\n\n".join(parts)


def run_batch_classification(
    *,
    limit: Optional[int] = None,
    delay: float = 1.5,
    bill_id: Optional[str] = None,
    force: bool = False,
    model_name: str = "nemotron-3.5-lightning:30b",
    ollama_host: str = "http://localhost:11434",
):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting Batch Bill Classification Worker")
    print(f"  Model: {model_name}")
    print(f"  Ollama Host: {ollama_host}")
    print(f"  Inter-bill delay: {delay}s")

    client = Client(host=ollama_host)
    db: Session = SessionLocal()

    stats = {
        "total_found": 0,
        "processed": 0,
        "successful": 0,
        "failed": 0,
        "intents_extracted": 0,
    }

    try:
        query = db.query(Bill)

        if bill_id:
            query = query.filter(Bill.id == bill_id)
        else:
            # Filter for bills with substantive summaries
            query = query.filter(
                Bill.summary.isnot(None),
                Bill.summary != "",
            )
            if not force:
                query = query.filter(Bill.classification_metadata == None)

            # Prioritize bills that have been voted on, then newest introduced
            query = query.order_by(
                nulls_last(desc(Bill.voted_date)),
                nulls_last(desc(Bill.introduced_date)),
                desc(Bill.id),
            )

        if limit and limit > 0:
            query = query.limit(limit)

        bills = query.all()
        stats["total_found"] = len(bills)

        if not bills:
            print("No pending bills found matching classification criteria.")
            return stats

        print(f"Found {len(bills)} bill(s) queued for classification.\n")

        start_time = time.time()

        for idx, bill in enumerate(bills, start=1):
            prefix = f"[{idx}/{len(bills)}] ({bill.id})"
            print(f"{prefix} '{bill.title or 'Untitled'}'...")

            context_text = build_bill_context(bill)

            try:
                t0 = time.time()
                response = client.chat(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": f"Analyze this bill:\n{context_text}"},
                    ],
                    format=ClassificationMetadata.model_json_schema(),
                )
                duration = time.time() - t0

                raw_content = response["message"]["content"]
                parsed = ClassificationMetadata.model_validate_json(raw_content)

                # Persist to database immediately
                bill.classification_metadata = json.loads(raw_content)
                db.commit()

                intents_count = len(parsed.intents)
                stats["processed"] += 1
                stats["successful"] += 1
                stats["intents_extracted"] += intents_count

                # Form concise log of extracted targets
                intent_summary = ", ".join(
                    f"{i.target} ({i.mechanism}: {i.direction})" for i in parsed.intents[:3]
                )
                if intents_count > 3:
                    intent_summary += f", +{intents_count - 3} more"

                print(
                    f"  -> Saved {intents_count} intent(s) in {duration:.1f}s: "
                    f"[{intent_summary if intent_summary else 'No substantive intents'}]"
                )

            except Exception as e:
                db.rollback()
                stats["processed"] += 1
                stats["failed"] += 1
                print(f"  -> ERROR classifying {bill.id}: {e}")

            # Pacing delay between bills to avoid overheating/saturating GPU
            if idx < len(bills) and delay > 0:
                time.sleep(delay)

        elapsed = time.time() - start_time
        print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Batch Classification Complete")
        print(f"  Total Considered:    {stats['total_found']}")
        print(f"  Successfully Saved:  {stats['successful']}")
        print(f"  Failed:              {stats['failed']}")
        print(f"  Intents Extracted:   {stats['intents_extracted']}")
        print(f"  Total Duration:      {elapsed:.1f}s (avg {elapsed / max(1, stats['processed']):.1f}s/bill)")

        return stats

    except KeyboardInterrupt:
        print("\n[!] Execution paused by user (Ctrl+C). Completed bills have already been saved to the database.")
        return stats
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Batch classify congressional bills using local Ollama model")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of bills to process in this run (default: all unclassified)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="Seconds to sleep between LLM calls to pace the machine (default: 1.5s)",
    )
    parser.add_argument(
        "--bill-id",
        type=str,
        default=None,
        help="Specific bill ID to classify (e.g., '119-hr-105')",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-classify bills even if classification_metadata already exists",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=os.environ.get("OLLAMA_MODEL", "nemotron-3.5-lightning:30b"),
        help="Ollama model name (default: nemotron-3.5-lightning:30b)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
        help="Ollama host URL (default: http://localhost:11434)",
    )

    args = parser.parse_args()

    run_batch_classification(
        limit=args.limit,
        delay=args.delay,
        bill_id=args.bill_id,
        force=args.force,
        model_name=args.model,
        ollama_host=args.host,
    )


if __name__ == "__main__":
    main()
