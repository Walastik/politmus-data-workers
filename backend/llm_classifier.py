"""Classify unenriched bill summaries with a local Ollama model."""

from __future__ import annotations

import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

from database import SessionLocal
from init_db import ensure_schema
from services.bill_classification import (
    classify_one_bill,
    ensure_default_guidelines,
    load_active_guidelines,
    pending_classification_query,
    plain_summary,
)

load_dotenv()

DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:32b")
DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "180"))


def make_ollama_client(host: str, timeout_seconds: float):
    try:
        import ollama
    except ImportError as exc:
        raise RuntimeError(
            "The ollama package is required. pip install ollama"
        ) from exc
    return ollama.Client(
        host=host,
        timeout=httpx.Timeout(timeout_seconds, connect=10.0),
    )


def ollama_chat_fn(client, model: str):
    def chat_fn(messages, format_schema) -> str:
        response = client.chat(
            model=model,
            messages=messages,
            format=format_schema,
            options={"temperature": 0},
        )
        message = getattr(response, "message", None)
        content = getattr(message, "content", None) if message is not None else None
        if not content and isinstance(response, dict):
            content = (response.get("message") or {}).get("content")
        if not content:
            raise ValueError("Ollama returned an empty response")
        return content

    return chat_fn


def run_classification(
    *,
    limit: int = 50,
    force: bool = False,
    bill_id: str | None = None,
    dry_run: bool = False,
    model: str | None = None,
    host: str | None = None,
    timeout: float | None = None,
    chat_fn=None,
    session_factory=None,
) -> dict:
    """Classify bills that have a summary but no classification yet."""
    ensure_schema()
    model_name = model or DEFAULT_MODEL
    stats = {
        "bills_pending": 0,
        "classified": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": dry_run,
        "model": model_name,
        "guidelines_id": None,
        "guidelines_name": None,
    }
    factory = session_factory or SessionLocal
    session = factory()
    try:
        guideline = load_active_guidelines(session)
        if guideline is None:
            guideline = ensure_default_guidelines(session)
            session.commit()
        stats["guidelines_id"] = guideline.id
        stats["guidelines_name"] = guideline.name

        query = pending_classification_query(
            session, force=force, bill_id=bill_id
        )
        if limit and limit > 0:
            query = query.limit(limit)
        bills = query.all()
        stats["bills_pending"] = len(bills)
        print(
            f"Found {len(bills)} bill(s) to classify "
            f"(model={model_name}, guidelines={guideline.name!r})."
        )
        if not bills:
            return stats

        if dry_run:
            for index, bill in enumerate(bills, start=1):
                preview = plain_summary(bill.summary)
                print(
                    f"[{index}/{len(bills)}] {bill.id} — dry-run "
                    f"({len(preview)} summary chars)"
                )
                stats["skipped"] += 1
            return stats

        if chat_fn is None:
            client = make_ollama_client(
                host or DEFAULT_HOST,
                timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS,
            )
            chat_fn = ollama_chat_fn(client, model_name)

        for index, bill in enumerate(bills, start=1):
            print(f"[{index}/{len(bills)}] {bill.id} — classifying...")
            try:
                payload = classify_one_bill(bill, guideline, model_name, chat_fn)
                bill.classification = payload
                session.commit()
            except Exception as exc:
                print(f"  Failed: {exc}")
                stats["failed"] += 1
                session.rollback()
                guideline = load_active_guidelines(session) or guideline
                continue
            stats["classified"] += 1
            print(
                f"  funding={payload['funding_impact']} "
                f"regulation={payload['regulatory_impact']}"
            )
        return stats
    finally:
        session.close()


def print_classification_stats(stats: dict) -> None:
    print("\nBill classification summary")
    print(f"  Pending considered: {stats['bills_pending']}")
    print(f"  Classified:         {stats['classified']}")
    print(f"  Skipped:            {stats['skipped']}")
    print(f"  Failed:             {stats['failed']}")
    print(f"  Model:              {stats['model']}")
    guidelines = stats.get("guidelines_name") or "none"
    guidelines_id = stats.get("guidelines_id")
    if guidelines_id is not None:
        guidelines = f"{guidelines} (#{guidelines_id})"
    print(f"  Guidelines:         {guidelines}")
    if stats.get("dry_run"):
        print("  Mode:               dry-run (no Ollama calls)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Classify bill CRS summaries with a local Ollama model and "
            "store structured JSON on each bill."
        )
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Maximum bills to classify this run (default 50). Use 0 for all.",
    )
    parser.add_argument(
        "--bill-id",
        help="Classify a single bill by id (e.g. 119-hr-1).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reclassify bills that already have a classification.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List matching bills without calling Ollama or writing rows.",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Ollama model name (default {DEFAULT_MODEL}).",
    )
    parser.add_argument(
        "--host",
        default=None,
        help=f"Ollama host (default {DEFAULT_HOST}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help=(
            "Ollama request timeout in seconds "
            f"(default {int(DEFAULT_TIMEOUT_SECONDS)})."
        ),
    )
    args = parser.parse_args(argv)
    try:
        stats = run_classification(
            limit=args.limit,
            force=args.force,
            bill_id=args.bill_id,
            dry_run=args.dry_run,
            model=args.model,
            host=args.host,
            timeout=args.timeout,
        )
    except Exception as exc:
        print(f"Classification failed: {exc}", file=sys.stderr)
        return 1
    print_classification_stats(stats)
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
