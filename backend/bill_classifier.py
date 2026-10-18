"""Classify congressional bills (TLDR, ELI5, policy intents) with a local
Ollama model, from their CRS summaries.

For each due bill: convert the CRS summary to text, classify it in one call
(short summaries) or per heading-aligned chunk plus a final summaries call
(long ones), keep only intents whose citation is in the summary, merge, and
save bills.classification_metadata plus the matching bill_effects rows.

Idempotent: a bill is re-run only when its summary/title/policy area, the
local prompt, the schema version, or the model change, or when its last run
failed or came back without a TLDR/ELI5 (with backoff). Bills without a CRS
summary are recorded as no_summary without calling the model.

Entry point: scripts/classify_bills.py (./scripts/run_classifier.sh).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import and_, func, literal_column, not_, or_

from database import SessionLocal
from init_db import ensure_schema
from models import Bill
from services import llm_runtime
from services.bill_classification import (
    DEFAULT_CHUNK_CHARS,
    INPUT_HASH_SQL,
    REJECT_BILL_TARGET,
    REJECT_CITATION,
    STATUS_FAILED,
    STATUS_INCOMPLETE,
    STATUS_NO_SUMMARY,
    STATUS_OK,
    BillSnapshot,
    IncompleteSummaries,
    classifier_version,
    classify_bill,
    summary_text,
)
from services.accountability import try_rescore
from services.target_matching import make_matcher, try_refresh
from services.bill_effects import persist_bill_effects
from services.llm_runtime import load_local_module, required_strings

load_dotenv()

FALLBACK_MODEL = "qwen3.6:27b"
DEFAULT_MODEL = os.getenv("BILL_CLASSIFIER_MODEL") or os.getenv("OLLAMA_MODEL") or FALLBACK_MODEL
DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
# Not OLLAMA_TIMEOUT_SECONDS (180s): a dense 27B model needs ~2 minutes per
# 10k-character chunk with two requests in parallel.
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("BILL_CLASSIFIER_TIMEOUT_SECONDS", "900"))
DEFAULT_NUM_CTX = 16384
DEFAULT_NUM_PREDICT = 4096
DEFAULT_CONCURRENCY = 2
DEFAULT_MAX_AGE_DAYS = 30
DEFAULT_DELAY = 1.5
FAILED_BACKOFF_HOURS = 6
MAX_FAILED_ATTEMPTS = 5
LOCK_PATH = os.getenv(
    "BILL_CLASSIFIER_LOCK",
    os.path.join(tempfile.gettempdir(), "politmus_bill_classifier.lock"),
)

# Gitignored local prompts (see scripts/llm_config.example.py).
LOCAL_CONFIG_PATH = Path(__file__).resolve().parent / "scripts" / "llm_config.py"

RETRY_STATUSES = (STATUS_FAILED, STATUS_INCOMPLETE)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass(frozen=True)
class Prompts:
    system: str
    summary: str | None = None

    def for_version(self) -> tuple[str, ...]:
        return (self.system,) if not self.summary else (self.system, self.summary)


def load_local_prompts(path: Path = LOCAL_CONFIG_PATH, log=None) -> Prompts:
    """SYSTEM_PROMPT (and optional SUMMARY_PROMPT, for the TLDR/ELI5 call)
    from the gitignored backend/scripts/llm_config.py, loaded by path."""
    config = load_local_module(path, example="llm_config.example.py")
    system = required_strings(config, ("SYSTEM_PROMPT",))["SYSTEM_PROMPT"]
    summary = getattr(config, "SUMMARY_PROMPT", None)
    if summary is not None and not (isinstance(summary, str) and summary.strip()):
        summary = None
    if log and hasattr(config, "ClassificationMetadata"):
        log(
            f"Note: {path.name} defines ClassificationMetadata; it is no longer used "
            "(the output schema is services/bill_classification.py)."
        )
    return Prompts(system, summary)


# -- selection ---------------------------------------------------------------


@dataclass(frozen=True)
class BillState:
    """A bill's classifier state, read without loading its summary."""

    id: str
    has_summary: bool
    has_metadata: bool
    metadata_complete: bool
    status: str | None = None
    version: str | None = None
    input_hash: str | None = None
    current_hash: str | None = None
    attempts: int = 0
    attempted_at: datetime | None = None
    voted_date: date | None = None
    introduced_date: date | None = None

    @property
    def never_attempted(self) -> bool:
        return not self.has_metadata and self.status in (None, STATUS_NO_SUMMARY)


def is_due(
    state: BillState,
    *,
    now: datetime,
    version: str,
    max_age_days: float = DEFAULT_MAX_AGE_DAYS,
    force: bool = False,
) -> bool:
    """Whether a bill should be (re)classified this run.

    Bills without a summary are due once, to be recorded as no_summary; they
    are due again for the model when a summary appears.
    """
    if not state.has_summary:
        return not state.has_metadata and state.status != STATUS_NO_SUMMARY
    if force:
        return True
    if state.status in RETRY_STATUSES:
        last = state.attempted_at
        if last is None:
            return True
        if state.attempts >= MAX_FAILED_ATTEMPTS:
            return last <= now - timedelta(days=max_age_days)
        return last <= now - timedelta(hours=FAILED_BACKOFF_HOURS * max(1, state.attempts))
    if not state.has_metadata or not state.metadata_complete:
        return True
    if state.version != version:
        return True
    return state.input_hash != state.current_hash


def _sort_key(state: BillState):
    # Never attempted first, then re-runs of classified bills, then retries;
    # within each, voted bills (newest vote first), then newest introduced.
    bucket = 0 if state.never_attempted else 2 if state.status in RETRY_STATUSES else 1
    return (
        bucket,
        state.voted_date is None,
        -(state.voted_date.toordinal() if state.voted_date else 0),
        state.introduced_date is None,
        -(state.introduced_date.toordinal() if state.introduced_date else 0),
        _reverse(state.id),
    )


def _reverse(value: str) -> tuple:
    """Sort key for descending string order."""
    return tuple(-ord(c) for c in value)


# Summary has text once tags are removed (empty CRS stubs are common).
HAS_SUMMARY = func.coalesce(
    func.trim(func.regexp_replace(Bill.summary, "<[^>]*>", "", "g")), ""
) != ""
HAS_METADATA = Bill.classification_metadata.isnot(None)
METADATA_COMPLETE = and_(
    func.coalesce(func.trim(Bill.classification_metadata["tldr"].astext), "") != "",
    func.coalesce(func.trim(Bill.classification_metadata["eli5"].astext), "") != "",
    func.jsonb_typeof(Bill.classification_metadata["intents"]) == "array",
)
CURRENT_HASH = literal_column(INPUT_HASH_SQL)


def load_states(session, bill_ids: list[str] | None = None) -> list[BillState]:
    query = session.query(
        Bill.id,
        HAS_SUMMARY,
        HAS_METADATA,
        func.coalesce(METADATA_COMPLETE, False),
        Bill.classification_status,
        Bill.classification_version,
        Bill.classification_input_hash,
        CURRENT_HASH,
        Bill.classification_attempts,
        Bill.classification_attempted_at,
        Bill.voted_date,
        Bill.introduced_date,
    )
    if bill_ids is not None:
        query = query.filter(Bill.id.in_(bill_ids))
    return [
        BillState(
            id=row[0],
            has_summary=bool(row[1]),
            has_metadata=bool(row[2]),
            metadata_complete=bool(row[3]),
            status=row[4],
            version=row[5],
            input_hash=row[6],
            current_hash=row[7],
            attempts=row[8] or 0,
            attempted_at=row[9],
            voted_date=row[10],
            introduced_date=row[11],
        )
        for row in query.all()
    ]


def select_bills(
    states: list[BillState],
    *,
    version: str,
    now: datetime,
    limit: int | None = None,
    force: bool = False,
    existing_only: bool = False,
    only_incomplete: bool = False,
    max_age_days: float = DEFAULT_MAX_AGE_DAYS,
) -> tuple[list[BillState], int]:
    """Due bills with a summary, in processing order, and how many bills
    with a summary are not due (unchanged)."""
    candidates = [s for s in states if s.has_summary]
    if existing_only:
        candidates = [s for s in candidates if s.has_metadata]
    if only_incomplete:
        candidates = [
            s for s in candidates
            if s.status == STATUS_INCOMPLETE or (s.has_metadata and not s.metadata_complete)
        ]
    due = [
        s for s in candidates
        if is_due(s, now=now, version=version, max_age_days=max_age_days, force=force)
    ]
    due.sort(key=_sort_key)
    unchanged = len(candidates) - len(due)
    if limit and limit > 0:
        due = due[:limit]
    return due, unchanged


def record_missing_summaries(session, now: datetime, bill_ids: list[str] | None = None) -> int:
    """Mark unclassified bills with no CRS summary as no_summary (no model
    call), so --report can count them. Returns how many were newly marked."""
    query = session.query(Bill).filter(
        not_(HAS_SUMMARY),
        Bill.classification_metadata.is_(None),
        or_(Bill.classification_status.is_(None), Bill.classification_status != STATUS_NO_SUMMARY),
    )
    if bill_ids is not None:
        query = query.filter(Bill.id.in_(bill_ids))
    return query.update(
        {
            Bill.classification_status: STATUS_NO_SUMMARY,
            Bill.classification_attempted_at: now,
            Bill.classification_error: None,
            Bill.classification_attempts: 0,
            Bill.classification_input_hash: CURRENT_HASH,
        },
        synchronize_session=False,
    )


# -- run ---------------------------------------------------------------------


def _empty_stats(model: str, dry_run: bool) -> dict:
    return {
        "selected": 0,
        "ok": 0,
        "incomplete": 0,
        "failed": 0,
        "no_summary": 0,
        "unchanged": 0,
        "intents_saved": 0,
        "chunks": 0,
        "rejected_citation": 0,
        "rejected_bill_target": 0,
        "dry_run": dry_run,
        "model": model,
        "prompt": None,
        "version": None,
    }


def run_classifier(
    *,
    limit: int | None = None,
    bill_id: str | None = None,
    bill_ids: list[str] | None = None,
    force: bool = False,
    dry_run: bool = False,
    existing_only: bool = False,
    only_incomplete: bool = False,
    max_age_days: float = DEFAULT_MAX_AGE_DAYS,
    concurrency: int = DEFAULT_CONCURRENCY,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    delay: float = 0.0,
    model: str | None = None,
    host: str | None = None,
    timeout: float | None = None,
    num_ctx: int = DEFAULT_NUM_CTX,
    num_predict: int = DEFAULT_NUM_PREDICT,
    think: bool = False,
    prompts: Prompts | None = None,
    chat_fn=None,
    matcher=None,
    session_factory=None,
    now_fn=utcnow,
    log=print,
) -> dict:
    """Classify due bills. bill_id processes one bill whether or not it is
    due; bill_ids only narrows the due selection (used by tests)."""
    model_name = model or DEFAULT_MODEL
    stats = _empty_stats(model_name, dry_run)
    if session_factory is None:
        ensure_schema()
    session = (session_factory or SessionLocal)()
    try:
        prompts = prompts or load_local_prompts(log=log)
        version = classifier_version(prompts.for_version(), model_name)
        stats["version"] = version
        stats["prompt"] = f"scripts/{LOCAL_CONFIG_PATH.name} ({version.split('|')[1]})"
        now = now_fn()

        scope = [bill_id] if bill_id else bill_ids
        if not dry_run:
            stats["no_summary"] += record_missing_summaries(session, now, scope)
            session.commit()

        states = load_states(session, scope)
        if bill_id:
            if not states:
                log(f"Bill {bill_id} not found.")
                stats["failed"] += 1
                return stats
            selected = [s for s in states if s.has_summary]
            if not selected:
                log(f"Bill {bill_id} has no CRS summary yet; nothing to classify.")
        else:
            selected, stats["unchanged"] = select_bills(
                states,
                version=version,
                now=now,
                limit=limit,
                force=force,
                existing_only=existing_only,
                only_incomplete=only_incomplete,
                max_age_days=max_age_days,
            )
        # Only reads since the last commit; end the transaction so no
        # connection is held while the model runs.
        session.rollback()
        stats["selected"] = len(selected)
        log(
            f"Selected {len(selected)} bill(s) (model={model_name}, version={version}); "
            f"{stats['unchanged']} unchanged, {stats['no_summary']} newly marked no_summary."
        )
        if not selected:
            return stats

        if chat_fn is None:
            if matcher is None and not dry_run:
                matcher = make_matcher(host or DEFAULT_HOST)
            chat_fn = llm_runtime.make_chat_fn(
                model_name,
                host or DEFAULT_HOST,
                timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS,
                num_ctx,
                num_predict,
                think=think,
                timeout_env="BILL_CLASSIFIER_TIMEOUT_SECONDS",
            )

        started = time.monotonic()
        for index, state in enumerate(selected):
            log(
                f"[{index + 1}/{len(selected)}] {state.id}"
                f"{llm_runtime.progress(index, len(selected), time.monotonic() - started)}"
            )
            called_model = _process_bill(
                session,
                state.id,
                stats=stats,
                prompts=prompts,
                chat_fn=chat_fn,
                matcher=matcher,
                version=version,
                model_name=model_name,
                dry_run=dry_run,
                concurrency=concurrency,
                chunk_chars=chunk_chars,
                now_fn=now_fn,
                log=log,
            )
            if called_model and delay > 0 and index + 1 < len(selected):
                time.sleep(delay)
        return stats
    finally:
        try:
            session.close()
        except Exception as exc:  # a dropped idle connection must not mask the results
            log(f"(ignored error closing the DB session: {type(exc).__name__})")


def _process_bill(
    session,
    bill_id: str,
    *,
    stats,
    prompts: Prompts,
    chat_fn,
    version,
    model_name,
    dry_run,
    matcher=None,
    concurrency,
    chunk_chars,
    now_fn,
    log,
) -> bool:
    """Classify and save one bill. Returns whether the model was called.
    One bill's failure is recorded and never ends the run."""
    now = now_fn()
    snapshot = None
    try:
        bill = session.get(Bill, bill_id)
        if bill is None:
            raise LookupError(f"bill {bill_id} no longer exists")
        snapshot = BillSnapshot.of(bill)
        # Model calls take minutes; hold no DB connection meanwhile.
        session.rollback()
        log(f"  {snapshot.title or 'Untitled'}")
        text = summary_text(snapshot.summary)
        if not text:
            stats["no_summary"] += 1
            log("  -> no summary text; recorded as no_summary")
            if not dry_run:
                _record(session, bill_id, status=STATUS_NO_SUMMARY, now=now, input_hash=snapshot.input_hash)
            return False

        t0 = time.time()
        result = classify_bill(
            snapshot,
            text,
            prompt=prompts.system,
            summary_prompt=prompts.summary,
            chat_fn=chat_fn,
            concurrency=concurrency,
            chunk_chars=chunk_chars,
            log=log,
        )
    except IncompleteSummaries as exc:
        _failed(session, bill_id, STATUS_INCOMPLETE, exc, now, stats, dry_run, log)
        return True
    except Exception as exc:
        _failed(session, bill_id, STATUS_FAILED, exc, now, stats, dry_run, log)
        return snapshot is not None

    stats["chunks"] += result.chunks
    stats["rejected_citation"] += result.rejected.get(REJECT_CITATION, 0)
    stats["rejected_bill_target"] += result.rejected.get(REJECT_BILL_TARGET, 0)
    reasons = ", ".join(f"{n} {reason}" for reason, n in result.rejected.items() if n) or "none"
    log(f"  [TL;DR] {result.tldr}")
    log(f"  [ELI5]  {result.eli5}")
    log(
        f"  -> {len(result.intents)} intent(s) from {result.chunks} chunk(s) "
        f"in {time.time() - t0:.1f}s (rejected: {reasons})"
    )
    metadata = result.metadata(model=model_name, version=version, classified_at=now.isoformat() + "Z")
    if dry_run:
        log(json.dumps(metadata, indent=2))
        stats["ok"] += 1
        return True

    try:
        bill = session.get(Bill, bill_id)
        if bill is None:
            raise LookupError(f"bill {bill_id} no longer exists")
        bill.classification_metadata = metadata
        bill.classification_status = STATUS_OK
        bill.classification_version = version
        bill.classification_input_hash = snapshot.input_hash
        bill.classification_attempts = 0
        bill.classification_error = None
        bill.classification_attempted_at = now
        bill.classified_at = now
        persist_bill_effects(session, bill, result.effects_output(), replace_existing=True)
        session.commit()
    except Exception as exc:
        _failed(session, bill_id, STATUS_FAILED, exc, now, stats, dry_run, log, prefix="save failed: ")
        return True
    stats["ok"] += 1
    stats["intents_saved"] += len(result.intents)
    try_refresh(matcher, session, log=log)
    try_rescore(session, bill_ids=[bill_id], log=log)
    return True


def _record(session, bill_id, *, status, now, error=None, input_hash=None, failed=False):
    values = {
        Bill.classification_status: status,
        Bill.classification_error: error,
        Bill.classification_attempted_at: now,
        Bill.classification_attempts: (Bill.classification_attempts + 1) if failed else 0,
    }
    if input_hash is not None:
        values[Bill.classification_input_hash] = input_hash
    session.query(Bill).filter(Bill.id == bill_id).update(values, synchronize_session=False)
    session.commit()


def _failed(session, bill_id, status, exc, now, stats, dry_run, log, prefix=""):
    """Record a failed/incomplete attempt; existing metadata is kept."""
    try:
        session.rollback()
    except Exception:
        pass
    stats[status] += 1
    message = f"{prefix}{type(exc).__name__}: {exc}"
    log(f"  -> {status.upper()}: {message}")
    if dry_run:
        return
    try:
        _record(session, bill_id, status=status, now=now, error=message[:2000], failed=True)
    except Exception as record_exc:
        session.rollback()
        log(f"  (could not record the failure: {type(record_exc).__name__}: {record_exc})")


# -- report / show -----------------------------------------------------------


def report(session_factory=None, *, prompts: Prompts | None = None, model: str | None = None, now_fn=utcnow, log=print) -> dict:
    """Counts that answer "why wasn't every bill classified?"."""
    session = (session_factory or SessionLocal)()
    try:
        rows = (
            session.query(
                Bill.level,
                HAS_SUMMARY,
                Bill.classification_status,
                HAS_METADATA,
                func.coalesce(METADATA_COMPLETE, False),
                func.count(),
            )
            .group_by(Bill.level, HAS_SUMMARY, Bill.classification_status, HAS_METADATA, func.coalesce(METADATA_COMPLETE, False))
            .all()
        )
        maxed = (
            session.query(func.count())
            .filter(
                Bill.classification_status.in_(RETRY_STATUSES),
                Bill.classification_attempts >= MAX_FAILED_ATTEMPTS,
            )
            .scalar()
        )
        errors = (
            session.query(Bill.classification_error, func.count())
            .filter(Bill.classification_status.in_(RETRY_STATUSES))
            .group_by(Bill.classification_error)
            .order_by(func.count().desc())
            .limit(5)
            .all()
        )
        versions = (
            session.query(Bill.classification_version, func.count())
            .filter(Bill.classification_status == STATUS_OK)
            .group_by(Bill.classification_version)
            .order_by(func.count().desc())
            .all()
        )
        due = None
        if prompts is not None:
            version = classifier_version(prompts.for_version(), model or DEFAULT_MODEL)
            due_states, _ = select_bills(load_states(session), version=version, now=now_fn())
            due = (version, len(due_states))
    finally:
        session.close()

    counts: dict[str, int] = {}
    by_level: dict[str, dict[str, int]] = {}
    for level, has_summary, status, has_metadata, complete, n in rows:
        if status:
            key = status
        elif not has_summary:
            key = "no summary (not yet recorded)"
        elif has_metadata:
            key = "legacy (pre-v2)"
        else:
            key = "not yet classified"
        counts[key] = counts.get(key, 0) + n
        level_counts = by_level.setdefault(level or "?", {"total": 0, "with summary": 0})
        level_counts["total"] += n
        level_counts["with summary"] += n if has_summary else 0
        if has_metadata and not complete:
            counts["metadata missing TLDR/ELI5/intents"] = counts.get("metadata missing TLDR/ELI5/intents", 0) + n

    log("Bill classification report")
    for level, c in sorted(by_level.items()):
        log(f"  {level:<10} bills: {c['total']:>7,}   with CRS summary: {c['with summary']:>7,}   without: {c['total'] - c['with summary']:>7,}")
    log("  By status:")
    for key in (STATUS_OK, "legacy (pre-v2)", "not yet classified", STATUS_INCOMPLETE, STATUS_FAILED,
                STATUS_NO_SUMMARY, "no summary (not yet recorded)"):
        if counts.get(key):
            log(f"    {key:<32} {counts[key]:>7,}")
    if counts.get("metadata missing TLDR/ELI5/intents"):
        log(f"    {'(metadata missing TLDR/ELI5/intents)':<32} {counts['metadata missing TLDR/ELI5/intents']:>7,}")
    if maxed:
        log(f"  Failed/incomplete at {MAX_FAILED_ATTEMPTS}+ attempts (retried after --max-age-days): {maxed:,}")
    if errors:
        log("  Most common errors:")
        for error, n in errors:
            log(f"    {n:>5,}  {(error or '')[:160]}")
    if versions:
        log("  Classified (ok) by version:")
        for version, n in versions:
            log(f"    {n:>7,}  {version}")
    if due is not None:
        log(f"  Due now for {due[0]}: {due[1]:,}")
    return {"counts": counts, "by_level": by_level, "due": due[1] if due else None}


def show_bill(bill_id: str, session_factory=None) -> int:
    session = (session_factory or SessionLocal)()
    try:
        bill = session.get(Bill, bill_id)
        if bill is None:
            print(f"Bill {bill_id} not found.")
            return 1
        print(f"{bill.id} {bill.title or ''}")
        print(
            f"  status={bill.classification_status} attempts={bill.classification_attempts} "
            f"classified_at={bill.classified_at} version={bill.classification_version}"
        )
        print(f"  summary: {len(summary_text(bill.summary)):,} chars of text")
        if bill.classification_error:
            print(f"  error={bill.classification_error}")
        print(json.dumps(bill.classification_metadata, indent=2) if bill.classification_metadata else "  No classification stored.")
        return 0
    finally:
        session.close()


def print_stats(stats: dict) -> None:
    print("\nBill classification summary")
    print(f"  Bills selected:        {stats['selected']}")
    print(f"  OK (saved):            {stats['ok']}")
    print(f"  Incomplete (no TLDR):  {stats['incomplete']}")
    print(f"  Failed:                {stats['failed']}")
    print(f"  No summary:            {stats['no_summary']}")
    print(f"  Unchanged (skipped):   {stats['unchanged']}")
    print(f"  Intents saved:         {stats['intents_saved']}")
    print(f"  Chunks sent to model:  {stats['chunks']}")
    print(f"  Rejected (citation):   {stats['rejected_citation']}")
    print(f"  Rejected (bill name):  {stats['rejected_bill_target']}")
    print(f"  Model:                 {stats['model']}")
    print(f"  Prompt:                {stats['prompt'] or 'none'}")
    if stats.get("dry_run"):
        print("  Mode:                  dry-run (nothing written)")


# -- CLI ---------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Classify congressional bills (TLDR, ELI5, policy intents) from their CRS "
            "summaries with a local Ollama model."
        )
    )
    parser.add_argument("--limit", type=int, default=0, help="Maximum bills this run (default 0 = all due).")
    parser.add_argument("--bill-id", help="Classify one bill (e.g. 119-hr-1) even if it is not due.")
    parser.add_argument("--force", action="store_true", help="Re-classify every selected bill even when unchanged.")
    parser.add_argument("--dry-run", action="store_true", help="Call the model and print the JSON; write nothing.")
    parser.add_argument(
        "--existing-only", "--already-classified", dest="existing_only", action="store_true",
        help="Only bills that already have classification metadata (and are due).",
    )
    parser.add_argument(
        "--only-incomplete", action="store_true",
        help="Only bills missing a TLDR/ELI5/intents or last marked incomplete (and due).",
    )
    parser.add_argument("--report", action="store_true", help="Print counts by status and exit.")
    parser.add_argument("--show", metavar="BILL_ID", help="Print one bill's stored classification and exit.")
    parser.add_argument("--model", default=None, help=f"Ollama model (default {DEFAULT_MODEL}; BILL_CLASSIFIER_MODEL, then OLLAMA_MODEL).")
    parser.add_argument("--host", default=None, help=f"Ollama host (default {DEFAULT_HOST}).")
    parser.add_argument(
        "--timeout", type=float, default=None,
        help=f"Ollama request timeout seconds (default {int(DEFAULT_TIMEOUT_SECONDS)}; BILL_CLASSIFIER_TIMEOUT_SECONDS).",
    )
    parser.add_argument("--num-ctx", type=int, default=DEFAULT_NUM_CTX, help=f"Ollama context window (default {DEFAULT_NUM_CTX}).")
    parser.add_argument("--num-predict", type=int, default=DEFAULT_NUM_PREDICT, help=f"Max output tokens per call; retries double it (default {DEFAULT_NUM_PREDICT}).")
    parser.add_argument("--think", action="store_true", help="Let reasoning models think before answering (slower; off by default).")
    parser.add_argument(
        "--concurrency", type=int, default=DEFAULT_CONCURRENCY,
        help=f"Parallel chunk calls for long bills (default {DEFAULT_CONCURRENCY}; match OLLAMA_NUM_PARALLEL).",
    )
    parser.add_argument("--chunk-chars", type=int, default=DEFAULT_CHUNK_CHARS, help=f"Summaries longer than this are chunked (default {DEFAULT_CHUNK_CHARS}).")
    parser.add_argument(
        "--max-age-days", type=float, default=DEFAULT_MAX_AGE_DAYS,
        help=f"After {MAX_FAILED_ATTEMPTS} failed attempts, retry a bill only this often (default {DEFAULT_MAX_AGE_DAYS}).",
    )
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Seconds to pause between bills (default {DEFAULT_DELAY}).")
    args = parser.parse_args(argv)

    if args.show:
        return show_bill(args.show)
    if args.report:
        try:
            prompts = load_local_prompts()
        except RuntimeError as exc:
            print(f"(due count skipped: {exc})")
            prompts = None
        report(prompts=prompts, model=args.model)
        return 0

    try:
        with llm_runtime.run_lock(LOCK_PATH, "bill classifier"):
            stats = run_classifier(
                limit=args.limit,
                bill_id=args.bill_id,
                force=args.force,
                dry_run=args.dry_run,
                existing_only=args.existing_only,
                only_incomplete=args.only_incomplete,
                max_age_days=args.max_age_days,
                concurrency=args.concurrency,
                chunk_chars=args.chunk_chars,
                delay=args.delay,
                model=args.model,
                host=args.host,
                timeout=args.timeout,
                num_ctx=args.num_ctx,
                num_predict=args.num_predict,
                think=args.think,
            )
    except KeyboardInterrupt:
        print("\nStopped. Bills already finished are saved.")
        return 130
    except Exception as exc:
        print(f"Bill classification run failed: {exc}", file=sys.stderr)
        return 1
    print_stats(stats)
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
