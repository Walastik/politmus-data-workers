"""Summarize where supporters and opponents of a bill disagree, with a local
Ollama model, from the floor speeches and committee views bill_context.py
stored (see services/bill_debate.py for the rules).

A bill is due when it has sources and its stored debate is missing, was made
by a different prompt/model/version, or was made from different sources.
Failed bills wait FAILED_BACKOFF_HOURS before a retry.

    python debate_worker.py [--limit N] [--bill-id 119-hr-9340] [--dry-run] [--force]

The prompt is DEFAULT_DEBATE_PROMPT unless the gitignored
scripts/debate_llm_config.py defines DEBATE_PROMPT.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import func

from database import SessionLocal
from init_db import ensure_schema
from models import Bill, BillAmendment, BillSource, Official, RollCall, Vote
from services import llm_runtime
from services.bill_classification import summary_text
from services.bill_debate import (
    DEFAULT_DEBATE_PROMPT,
    STATUS_FAILED,
    STATUS_OK,
    DebateInput,
    DebateSource,
    debate_version,
    summarize_debate,
)

load_dotenv()

DEFAULT_MODEL = os.getenv("DEBATE_MODEL") or os.getenv("BILL_CLASSIFIER_MODEL") or os.getenv("OLLAMA_MODEL") or "qwen3.6:27b"
DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("DEBATE_TIMEOUT_SECONDS", "900"))
DEFAULT_NUM_CTX = 16384
DEFAULT_NUM_PREDICT = 4096
FAILED_BACKOFF_HOURS = 6
LOCK_PATH = os.path.join(tempfile.gettempdir(), "politmus_debate_worker.lock")
LOCAL_CONFIG_PATH = Path(__file__).resolve().parent / "scripts" / "debate_llm_config.py"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def load_prompt(path: Path = LOCAL_CONFIG_PATH) -> str:
    if not path.is_file():
        return DEFAULT_DEBATE_PROMPT
    module = llm_runtime.load_local_module(path, example="debate_llm_config.py")
    return llm_runtime.required_strings(module, ("DEBATE_PROMPT",))["DEBATE_PROMPT"]


def _party_tallies(session, roll_call_id: int) -> dict[str, dict[str, int]]:
    rows = (
        session.query(Official.party, Vote.position, func.count(Vote.id))
        .join(Official, Official.id == Vote.official_id)
        .filter(Vote.roll_call_id == roll_call_id)
        .group_by(Official.party, Vote.position)
        .all()
    )
    out: dict[str, dict[str, int]] = {}
    for party, position, count in rows:
        out.setdefault(party or "Unknown", {})[position] = count
    return out


def load_input(session, bill: Bill) -> DebateInput:
    roll_calls = (
        session.query(RollCall).filter(RollCall.bill_id == bill.id)
        .order_by(RollCall.date.nulls_last(), RollCall.id).all()
    )
    amendments = (
        session.query(BillAmendment).filter(BillAmendment.bill_id == bill.id)
        .order_by(BillAmendment.submitted_date.desc().nulls_last(), BillAmendment.id).all()
    )
    sources = (
        session.query(BillSource).filter(BillSource.bill_id == bill.id)
        .order_by(BillSource.date.nulls_last(), BillSource.id).all()
    )
    return DebateInput(
        bill_id=bill.id,
        title=bill.title,
        summary=summary_text(bill.summary),
        roll_calls=[
            {
                "chamber": rc.chamber, "date": rc.date.isoformat() if rc.date else None,
                "question": rc.question, "result": rc.result,
                "by_party": _party_tallies(session, rc.id),
            }
            for rc in roll_calls
        ],
        amendments=[
            {
                "chamber": a.chamber, "sponsor_name": a.sponsor_name, "sponsor_party": a.sponsor_party,
                "purpose": a.purpose, "text_excerpt": a.text_excerpt,
                "latest_action_text": a.latest_action_text,
            }
            for a in amendments
        ],
        sources=[
            DebateSource(
                id=s.id, kind=s.kind, speaker=s.speaker_name, party=s.speaker_party,
                state=s.speaker_state, chamber=s.chamber,
                date=s.date.isoformat() if s.date else None, title=s.title, text=s.text, url=s.url,
            )
            for s in sources
        ],
    )


def is_due(bill: Bill, data: DebateInput, version: str, now: datetime) -> bool:
    if (
        bill.debate_status == STATUS_FAILED
        and bill.debate_attempted_at
        and now - bill.debate_attempted_at < timedelta(hours=FAILED_BACKOFF_HOURS)
    ):
        return False
    meta = bill.debate_metadata or {}
    return meta.get("version") != version or meta.get("input_hash") != data.input_hash


def run(*, limit=0, bill_id=None, force=False, dry_run=False, model=None, host=None,
        timeout=None, num_ctx=DEFAULT_NUM_CTX, num_predict=DEFAULT_NUM_PREDICT,
        chat_fn=None, prompt=None, session_factory=None, now_fn=utcnow, log=print) -> dict:
    session_factory = session_factory or SessionLocal
    model = model or DEFAULT_MODEL
    prompt = prompt or load_prompt()
    version = debate_version(prompt, model)
    stats = {"due": 0, "ok": 0, "failed": 0}
    session = session_factory()
    try:
        query = session.query(Bill).filter(
            session.query(BillSource.id).filter(BillSource.bill_id == Bill.id).exists()
        )
        if bill_id:
            query = query.filter(Bill.id == bill_id)
        bills = query.order_by(Bill.voted_date.desc().nulls_last(), Bill.id).all()
        now = now_fn()
        due = []
        for bill in bills:
            data = load_input(session, bill)
            if force or bill_id or is_due(bill, data, version, now):
                due.append((bill, data))
        if limit:
            due = due[:limit]
        stats["due"] = len(due)
        log(f"Debate summaries: {len(due)} bill(s) due ({version}).")
        if not due:
            return stats
        if chat_fn is None:
            chat_fn = llm_runtime.make_chat_fn(
                model, host or DEFAULT_HOST, timeout or DEFAULT_TIMEOUT_SECONDS,
                num_ctx, num_predict, timeout_env="DEBATE_TIMEOUT_SECONDS",
            )
        for index, (bill, data) in enumerate(due, start=1):
            log(f"[{index}/{len(due)}] {bill.id}: {len(data.sources)} source(s)")
            bill.debate_attempted_at = now_fn()
            try:
                result = summarize_debate(data, prompt=prompt, chat_fn=chat_fn)
            except Exception as exc:  # model, parse, or validation failure
                stats["failed"] += 1
                log(f"  FAILED: {exc}")
                if not dry_run:
                    bill.debate_status = STATUS_FAILED
                    session.commit()
                continue
            result.update(model=model, version=version, generated_at=now_fn().isoformat() + "Z")
            log(f"  key dispute: {result['key_dispute']}")
            for side in ("supporters", "opponents"):
                for point in result[side]:
                    log(f"  [{side}] {point['speaker']} ({point['party']}): {point['point']}")
            stats["ok"] += 1
            if dry_run:
                log(json.dumps(result, indent=2))
                continue
            bill.debate_metadata = result
            bill.debate_status = STATUS_OK
            session.commit()
        if dry_run:
            session.rollback()
        return stats
    finally:
        session.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Summarize each side's arguments on voted bills with a local Ollama model.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum bills this run (default 0 = all due).")
    parser.add_argument("--bill-id", help="Summarize one bill even if it is not due.")
    parser.add_argument("--force", action="store_true", help="Re-run every bill with sources.")
    parser.add_argument("--dry-run", action="store_true", help="Call the model and print the result; write nothing.")
    parser.add_argument("--model", default=None, help=f"Ollama model (default {DEFAULT_MODEL}; DEBATE_MODEL).")
    parser.add_argument("--host", default=None, help=f"Ollama host (default {DEFAULT_HOST}).")
    parser.add_argument("--timeout", type=float, default=None, help="Ollama request timeout seconds.")
    parser.add_argument("--num-ctx", type=int, default=DEFAULT_NUM_CTX)
    parser.add_argument("--num-predict", type=int, default=DEFAULT_NUM_PREDICT)
    args = parser.parse_args(argv)
    ensure_schema()
    try:
        with llm_runtime.run_lock(LOCK_PATH, "debate worker"):
            stats = run(
                limit=args.limit, bill_id=args.bill_id, force=args.force, dry_run=args.dry_run,
                model=args.model, host=args.host, timeout=args.timeout,
                num_ctx=args.num_ctx, num_predict=args.num_predict,
            )
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"Done: due={stats['due']} ok={stats['ok']} failed={stats['failed']}")
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
