"""Extract officials' stated policy positions from their websites with Ollama.

For each due official: crawl the issue pages on website_url, split them into
heading-aligned chunks, ask the local model for positions per chunk, keep only
positions whose quote appears verbatim on the page, merge, and replace the
official's official_site rows in official_stances.

Idempotent: officials whose pages and extractor version are unchanged are
skipped without calling the model. Runs are round-robin by last attempt.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

from database import SessionLocal
from init_db import ensure_schema
from models import Official, OfficialPositionSync, OfficialSourcePage, OfficialStance
from services import llm_runtime
from services.accountability import try_rescore
from services.llm_runtime import TruncatedOutputError, load_local_module, required_strings
from services.official_positions import (
    DEFAULT_CHUNK_CHARS,
    SourceText,
    StatedPositionsOutput,
    build_position_messages,
    chunk_source,
    combined_hash,
    extractor_version,
    make_link_selector,
    merge_positions,
    parse_positions,
    persist_official_stances,
    split_chunk,
    target_vocabulary,
    upsert_source_pages,
    verify_positions,
    REJECT_BILL_TARGET,
    REJECT_QUOTE,
)

load_dotenv()

DEFAULT_MODEL = os.getenv(
    "OFFICIAL_POSITIONS_MODEL",
    os.getenv("OLLAMA_MODEL", "nemotron-3.5-lightning:30b"),
)
DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
# Not OLLAMA_TIMEOUT_SECONDS: the bill classifier's short value is too tight for
# dense models or --think, which can spend several minutes on one chunk.
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("OFFICIAL_POSITIONS_TIMEOUT_SECONDS", "900"))
DEFAULT_NUM_CTX = 16384
DEFAULT_NUM_PREDICT = 4096
DEFAULT_CONCURRENCY = 2
DEFAULT_MAX_AGE_DAYS = 30
FAILED_BACKOFF_HOURS = 6
MAX_FAILED_ATTEMPTS = 5
LOCK_PATH = os.getenv(
    "OFFICIAL_POSITIONS_LOCK",
    os.path.join(tempfile.gettempdir(), "politmus_official_positions.lock"),
)

# Gitignored local prompts, next to scripts/llm_config.py for the bill classifier.
LOCAL_CONFIG_PATH = Path(__file__).resolve().parent / "scripts" / "positions_llm_config.py"

# Statuses where the site was read and the model ran (or had nothing to read).
EXTRACTED_STATUSES = ("ok", "no_positions", "no_issue_pages")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass(frozen=True)
class OfficialSnapshot:
    """Plain copy of the Official fields the worker needs.

    The crawl runs on a background thread; ORM objects must stay on the
    thread that owns the session, because reading an expired attribute
    issues a query on that session.
    """

    id: str
    name: str | None
    party: str | None
    state: str | None
    district: int | None
    office: str | None
    website_url: str | None

    @classmethod
    def of(cls, official) -> "OfficialSnapshot":
        return cls(
            official.id,
            official.name,
            official.party,
            official.state,
            official.district,
            official.office,
            official.website_url,
        )


@dataclass(frozen=True)
class Prompts:
    positions: str
    link_selection: str


def load_local_prompts(path: Path = LOCAL_CONFIG_PATH) -> Prompts:
    """Prompts from the gitignored backend/scripts/positions_llm_config.py.

    Loaded by file path so the worker finds it from any working directory.
    """
    config = load_local_module(path, example="positions_llm_config.example.py")
    values = required_strings(config, ("POSITIONS_SYSTEM_PROMPT", "LINK_SELECTION_PROMPT"))
    return Prompts(values["POSITIONS_SYSTEM_PROMPT"], values["LINK_SELECTION_PROMPT"])


# -- Ollama ------------------------------------------------------------------


def make_chat_fn(*args, **kwargs):
    """services.llm_runtime.make_chat_fn, naming this worker's timeout setting."""
    kwargs.setdefault("timeout_env", "OFFICIAL_POSITIONS_TIMEOUT_SECONDS")
    return llm_runtime.make_chat_fn(*args, **kwargs)


# -- selection ---------------------------------------------------------------


def is_due(
    sync: OfficialPositionSync | None,
    *,
    now: datetime,
    version: str,
    max_age_days: float,
    force: bool = False,
) -> bool:
    """Whether an official should be processed this run."""
    if sync is None or force:
        return True
    max_age = timedelta(days=max_age_days)
    if sync.status == "failed":
        last = sync.last_attempt_at
        if last is None:
            return True
        if (sync.attempts or 0) >= MAX_FAILED_ATTEMPTS:
            return last <= now - max_age
        return last <= now - timedelta(hours=FAILED_BACKOFF_HOURS * max(1, sync.attempts or 1))
    if sync.status in EXTRACTED_STATUSES and sync.extractor_version != version:
        return True
    reference = sync.last_success_at or sync.last_attempt_at
    return reference is None or reference <= now - max_age


def select_officials(
    session,
    *,
    version: str,
    now: datetime,
    limit: int | None,
    official_id: str | list[str] | None = None,
    level: str = "federal",
    force: bool = False,
    max_age_days: float = DEFAULT_MAX_AGE_DAYS,
    require_pages: bool = False,
) -> list[tuple[Official, OfficialPositionSync | None]]:
    """official_id (one id or a list) selects those officials, due or not."""
    query = session.query(Official, OfficialPositionSync).outerjoin(
        OfficialPositionSync, OfficialPositionSync.official_id == Official.id
    )
    if official_id:
        ids = [official_id] if isinstance(official_id, str) else list(official_id)
        return query.filter(Official.id.in_(ids)).order_by(Official.id).all()
    query = query.filter(
        Official.level == level,
        Official.current_member.is_(True),
        Official.website_url.isnot(None),
        Official.website_url != "",
    )
    if require_pages:
        query = query.filter(
            Official.id.in_(
                session.query(OfficialSourcePage.official_id).filter(
                    OfficialSourcePage.is_current.is_(True)
                )
            )
        )
    rows = [
        (official, sync)
        for official, sync in query.all()
        if is_due(sync, now=now, version=version, max_age_days=max_age_days, force=force)
    ]
    # Never-attempted first, then oldest attempt first (round-robin).
    rows.sort(key=lambda row: (
        row[1] is not None,
        row[1].last_attempt_at if row[1] is not None and row[1].last_attempt_at else datetime.min,
        row[0].id,
    ))
    if limit and limit > 0:
        rows = rows[:limit]
    return rows


# -- extraction --------------------------------------------------------------


def extract_positions(
    official,
    sources: list[SourceText],
    *,
    prompt: str,
    chat_fn,
    vocabulary: list[str],
    concurrency: int,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    log=None,
):
    """Map each chunk through the model, verify quotes, and merge.

    A chunk whose answer is cut off at the output limit is split in half and
    each half extracted, recursively. Raises if any chunk still fails, so a
    partial result is never saved.
    Returns (merged positions, chunk count, rejection counts by reason).
    """
    chunks = [chunk for source in sources for chunk in chunk_source(source, chunk_chars)]
    if not chunks:
        return [], 0, {}
    total = len(chunks)
    if log:
        log(f"  sending {total} chunk(s) to the model...")

    def extract(chunk, number):
        try:
            raw = chat_fn(
                build_position_messages(prompt, official, chunk, vocabulary),
                StatedPositionsOutput.model_json_schema(),
            )
        except TruncatedOutputError:
            parts = split_chunk(chunk)
            if len(parts) < 2:
                raise
            if log:
                log(f"    chunk {number}/{total}: output cut off; retrying as {len(parts)} parts")
            kept, rejected = [], {}
            for part in parts:
                part_kept, part_rejected = extract(part, number)
                kept.extend(part_kept)
                for reason, count in part_rejected.items():
                    rejected[reason] = rejected.get(reason, 0) + count
            return kept, rejected
        return verify_positions(parse_positions(raw), chunk)

    def run(numbered):
        number, chunk = numbered
        try:
            result = extract(chunk, number)
        except Exception as exc:
            where = chunk.url + (f" [{chunk.heading}]" if chunk.heading else "")
            raise RuntimeError(f"chunk {number}/{total} {where}: {exc}") from exc
        if log:
            log(f"    chunk {number}/{total}: {len(result[0])} kept, {sum(result[1].values())} rejected")
        return result

    numbered = list(enumerate(chunks, start=1))
    workers = max(1, min(concurrency, total))
    if workers == 1:
        results = [run(item) for item in numbered]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(run, numbered))
    verified = [item for kept, _ in results for item in kept]
    rejected: dict[str, int] = {}
    for _, counts in results:
        for reason, count in counts.items():
            rejected[reason] = rejected.get(reason, 0) + count
    return merge_positions(verified), len(chunks), rejected


_duration = llm_runtime.duration
_progress = llm_runtime.progress


def _record_attempt(session, official_id, sync, *, status, now, error=None, **fields):
    if sync is None:
        sync = OfficialPositionSync(official_id=official_id, status=status, attempts=0)
        session.add(sync)
    sync.status = status
    sync.last_attempt_at = now
    sync.last_error = error
    if status == "failed":
        sync.attempts = (sync.attempts or 0) + 1
    else:
        sync.attempts = 0
    for key, value in fields.items():
        setattr(sync, key, value)
    return sync


def _empty_stats(model, dry_run):
    return {
        "selected": 0,
        "extracted": 0,
        "unchanged": 0,
        "no_positions": 0,
        "stances_saved": 0,
        "rejected_unverified": 0,
        "rejected_bill_target": 0,
        "chunks": 0,
        "crawled_only": 0,
        "blocked": 0,
        "needs_js": 0,
        "thin_site": 0,
        "no_website": 0,
        "failed": 0,
        "dry_run": dry_run,
        "model": model,
        "prompt": None,
        "version": None,
    }


def run_positions(
    *,
    limit: int | None = 5,
    official_id: str | list[str] | None = None,
    level: str = "federal",
    force: bool = False,
    dry_run: bool = False,
    crawl_only: bool = False,
    extract_only: bool = False,
    max_age_days: float = DEFAULT_MAX_AGE_DAYS,
    concurrency: int = DEFAULT_CONCURRENCY,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    model: str | None = None,
    host: str | None = None,
    timeout: float | None = None,
    num_ctx: int = DEFAULT_NUM_CTX,
    num_predict: int = DEFAULT_NUM_PREDICT,
    think: bool = False,
    crawl_config=None,
    prompts: Prompts | None = None,
    chat_fn=None,
    crawler=None,
    session_factory=None,
    now_fn=utcnow,
    log=print,
) -> dict:
    model_name = model or DEFAULT_MODEL
    stats = _empty_stats(model_name, dry_run)
    if session_factory is None:
        ensure_schema()
    factory = session_factory or SessionLocal
    session = factory()
    owns_crawler = False
    try:
        if crawl_only:
            # Never calls the model, so it works without the local prompt file.
            prompts, version = None, "crawl-only"
        else:
            prompts = prompts or load_local_prompts()
            version = extractor_version((prompts.positions, prompts.link_selection), model_name)
            stats["prompt"] = f"scripts/{LOCAL_CONFIG_PATH.name} ({version.split('|')[1]})"
        stats["version"] = version

        rows = select_officials(
            session,
            version=version,
            now=now_fn(),
            limit=limit,
            official_id=official_id,
            level=level,
            force=force or crawl_only,
            max_age_days=max_age_days,
            require_pages=extract_only,
        )
        stats["selected"] = len(rows)
        log(f"Selected {len(rows)} official(s) (model={model_name}, version={version}).")
        if not rows:
            return stats

        if chat_fn is None and not crawl_only:
            chat_fn = make_chat_fn(
                model_name,
                host or DEFAULT_HOST,
                timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS,
                num_ctx,
                num_predict,
                think=think,
            )
        if crawler is None and not extract_only:
            from services.site_crawler import SiteCrawler

            crawler = SiteCrawler(crawl_config, log=log)
            owns_crawler = True
        vocabulary = [] if crawl_only else target_vocabulary(session)
        # Nothing to write yet: end the read transaction so no connection
        # sits open (and gets closed by the server) while crawls and model
        # calls run. Later queries check out a fresh, pre-pinged connection.
        session.rollback()

        # Snapshot before any commit expires the ORM objects.
        rows = [(OfficialSnapshot.of(official), sync) for official, sync in rows]

        def crawl(official: OfficialSnapshot):
            selector = (
                make_link_selector(chat_fn, official, prompts.link_selection)
                if chat_fn is not None and prompts is not None
                else None
            )
            try:
                return crawler.crawl(official.website_url, select_links_fn=selector)
            except Exception as exc:  # one bad site must not end the run
                from services.site_crawler import CrawlResult

                return CrawlResult(
                    status="failed",
                    start_url=official.website_url,
                    error=f"crawler error: {type(exc).__name__}: {exc}",
                )

        # Crawl the next official in the background while the model works on
        # the current one. The crawler is only ever used by this one thread.
        prefetch = ThreadPoolExecutor(max_workers=1) if not extract_only else None
        futures = {}
        run_started = time.monotonic()
        if prefetch is not None:
            futures[0] = prefetch.submit(crawl, rows[0][0])
        try:
            for index, (official, sync) in enumerate(rows):
                if prefetch is not None and index + 1 < len(rows):
                    futures[index + 1] = prefetch.submit(crawl, rows[index + 1][0])
                log(
                    f"[{index + 1}/{len(rows)}] {official.id} {official.name or ''} - "
                    f"{official.website_url}{_progress(index, len(rows), time.monotonic() - run_started)}"
                )
                crawl_future = futures.pop(index, None)
                _process_official(
                    session,
                    official,
                    sync,
                    crawl_result=crawl_future.result() if crawl_future is not None else None,
                    stats=stats,
                    prompt=prompts.positions if prompts else "",
                    chat_fn=chat_fn,
                    vocabulary=vocabulary,
                    version=version,
                    model_name=model_name,
                    force=force,
                    dry_run=dry_run,
                    crawl_only=crawl_only,
                    extract_only=extract_only,
                    concurrency=concurrency,
                    chunk_chars=chunk_chars,
                    now_fn=now_fn,
                    log=log,
                )
        finally:
            if prefetch is not None:
                for future in futures.values():
                    future.cancel()
                prefetch.shutdown(wait=True)
        return stats
    finally:
        if owns_crawler:
            crawler.close()
        try:
            session.close()
        except Exception as exc:  # a dropped idle connection must not mask the results
            log(f"(ignored error closing the DB session: {type(exc).__name__})")


def _process_official(
    session,
    official,
    sync,
    *,
    crawl_result,
    stats,
    prompt,
    chat_fn,
    vocabulary,
    version,
    model_name,
    force,
    dry_run,
    crawl_only,
    extract_only,
    concurrency,
    chunk_chars,
    now_fn,
    log,
):
    now = now_fn()
    try:
        if extract_only:
            stored = (
                session.query(OfficialSourcePage)
                .filter(
                    OfficialSourcePage.official_id == official.id,
                    OfficialSourcePage.is_current.is_(True),
                )
                .order_by(OfficialSourcePage.url)
                .all()
            )
            sources = [SourceText(p.url, p.text or "", p.id, p.title) for p in stored if p.text]
            page_hashes = [(p.url, p.content_hash or "") for p in stored if p.text]
            crawl_status = "ok"
        else:
            crawl_status = crawl_result.status
            for page in crawl_result.pages:
                log(f"  {page.page_kind:<13} {len(page.text):>6} chars  {page.url}")
            if crawl_status in ("no_website", "blocked", "needs_js", "thin_site", "failed"):
                bucket = "failed" if crawl_status == "failed" else crawl_status
                stats[bucket] += 1
                log(f"  -> {crawl_status}: {crawl_result.error or ''}".rstrip())
                if not dry_run and not crawl_only:
                    _record_attempt(session, official.id, sync, status=crawl_status, now=now, error=crawl_result.error)
                    session.commit()
                return
            sources = [SourceText(p.url, p.text, None, p.title) for p in crawl_result.pages]
            page_hashes = [(p.url, p.content_hash) for p in crawl_result.pages]

        if crawl_only:
            stats["crawled_only"] += 1
            if not dry_run:
                upsert_source_pages(session, official.id, crawl_result.pages, now)
                session.commit()
            return

        site_hash = combined_hash(page_hashes)
        if (
            not force
            and sync is not None
            and sync.status in EXTRACTED_STATUSES
            and sync.combined_hash == site_hash
            and sync.extractor_version == version
        ):
            stats["unchanged"] += 1
            log("  -> unchanged since last extraction; skipping model")
            if not dry_run:
                if not extract_only:
                    upsert_source_pages(session, official.id, crawl_result.pages, now)
                _record_attempt(session, official.id, sync, status=sync.status, now=now, last_success_at=now)
                session.commit()
            return

        # Model calls can take many minutes; hold no DB connection meanwhile.
        # Only reads happened above, so there is nothing to lose here.
        session.rollback()
        t0 = time.time()
        positions, chunk_count, rejected = extract_positions(
            official,
            sources,
            prompt=prompt,
            chat_fn=chat_fn,
            vocabulary=vocabulary,
            concurrency=concurrency,
            chunk_chars=chunk_chars,
            log=log,
        )
        stats["chunks"] += chunk_count
        stats["rejected_unverified"] += rejected.get(REJECT_QUOTE, 0)
        stats["rejected_bill_target"] += rejected.get(REJECT_BILL_TARGET, 0)
        reasons = ", ".join(f"{n} {reason}" for reason, n in rejected.items() if n) or "none"
        log(
            f"  -> {len(positions)} position(s) from {chunk_count} chunk(s) "
            f"in {time.time() - t0:.1f}s (rejected: {reasons})"
        )

        if dry_run:
            for item in positions:
                log("     " + json.dumps({
                    **item.position.model_dump(),
                    "official_direction": item.direction,
                    "source_url": item.source_url,
                }))
            stats["extracted"] += 1
            if not positions:
                stats["no_positions"] += 1
            return

        page_ids = {}
        if not extract_only:
            page_rows = upsert_source_pages(session, official.id, crawl_result.pages, now)
            page_ids = {url: row.id for url, row in page_rows.items()}
        saved = persist_official_stances(
            session,
            official.id,
            positions,
            version=version,
            model=model_name,
            extracted_at=now,
            page_ids=page_ids,
        )
        if saved:
            status = "ok"
        else:
            status = "no_issue_pages" if crawl_status == "no_issue_pages" else "no_positions"
            stats["no_positions"] += 1
        _record_attempt(
            session,
            official.id,
            sync,
            status=status,
            now=now,
            last_success_at=now,
            combined_hash=site_hash,
            extractor_version=version,
            pages_found=len(sources),
            stances_saved=len(saved),
        )
        session.commit()
        stats["extracted"] += 1
        stats["stances_saved"] += len(saved)
        try_rescore(session, official_ids=[official.id], log=log)
    except Exception as exc:
        session.rollback()
        stats["failed"] += 1
        log(f"  -> FAILED: {type(exc).__name__}: {exc}")
        if not dry_run and not crawl_only:
            try:
                current = session.get(OfficialPositionSync, official.id)
                _record_attempt(session, official.id, current, status="failed", now=now, error=str(exc)[:2000])
                session.commit()
            except Exception:
                session.rollback()


# -- CLI ---------------------------------------------------------------------


def run_lock(path: str = LOCK_PATH):
    return llm_runtime.run_lock(path, "official_positions")


def show_official(official_id: str, session_factory=None) -> int:
    session = (session_factory or SessionLocal)()
    try:
        official = session.get(Official, official_id)
        if official is None:
            print(f"Official {official_id} not found.")
            return 1
        sync = session.get(OfficialPositionSync, official_id)
        print(f"{official.id} {official.name} - {official.website_url}")
        if sync is not None:
            print(
                f"  status={sync.status} last_success={sync.last_success_at} "
                f"pages={sync.pages_found} stances={sync.stances_saved} version={sync.extractor_version}"
            )
            if sync.last_error:
                print(f"  last_error={sync.last_error}")
        stances = (
            session.query(OfficialStance)
            .filter(OfficialStance.official_id == official_id)
            .order_by(OfficialStance.policy_area, OfficialStance.target_name)
            .all()
        )
        for s in stances:
            print(
                f"\n  [{s.policy_area}] {s.issue_label}: wants {s.target_name} / {s.mechanism} / "
                f"{s.direction} ({s.emphasis}; {s.stance} {s.policy_direction})"
                f"\n    {s.summary}\n    \"{s.evidence_quote}\"\n    {s.source_url}"
            )
        if not stances:
            print("  No stated positions stored.")
        return 0
    finally:
        session.close()


def print_stats(stats: dict) -> None:
    print("\nOfficial stated-positions summary")
    print(f"  Officials selected:   {stats['selected']}")
    print(f"  Extracted:            {stats['extracted']}")
    print(f"  Unchanged (skipped):  {stats['unchanged']}")
    print(f"  No positions found:   {stats['no_positions']}")
    print(f"  Stances saved:        {stats['stances_saved']}")
    print(f"  Chunks sent to model: {stats['chunks']}")
    print(f"  Rejected (bad quote): {stats['rejected_unverified']}")
    print(f"  Rejected (bill name): {stats['rejected_bill_target']}")
    if stats["crawled_only"]:
        print(f"  Crawled only:         {stats['crawled_only']}")
    print(f"  Blocked:              {stats['blocked']}")
    print(f"  Needs JavaScript:     {stats['needs_js']}")
    print(f"  Thin site:            {stats['thin_site']}")
    print(f"  No website:           {stats['no_website']}")
    print(f"  Failed:               {stats['failed']}")
    print(f"  Model:                {stats['model']}")
    print(f"  Prompt:               {stats['prompt'] or 'none'}")
    if stats.get("dry_run"):
        print("  Mode:                 dry-run (nothing written)")


def main(argv: list[str] | None = None) -> int:
    from services.site_crawler import CrawlConfig, DEFAULT_DELAY_SECONDS, DEFAULT_MAX_PAGES, DEFAULT_USER_AGENT

    parser = argparse.ArgumentParser(
        description=(
            "Crawl officials' websites and extract their stated policy positions "
            "into official_stances with a local Ollama model."
        )
    )
    parser.add_argument("--limit", type=int, default=5, help="Maximum officials this run (default 5). 0 for all due.")
    parser.add_argument("--official-id", action="append", help="Process this official by id (e.g. O000172), repeatable. Ignores due checks.")
    parser.add_argument("--level", default="federal", help="Official level to select (default federal).")
    parser.add_argument("--force", action="store_true", help="Re-extract even when pages and version are unchanged.")
    parser.add_argument("--dry-run", action="store_true", help="Crawl and call the model but write nothing; print positions.")
    parser.add_argument("--crawl-only", action="store_true", help="Discover and store pages without calling the model.")
    parser.add_argument("--extract-only", action="store_true", help="Re-run the model on stored pages without crawling.")
    parser.add_argument("--show", metavar="OFFICIAL_ID", help="Print stored positions for one official and exit.")
    parser.add_argument(
        "--max-age-days", type=float, default=DEFAULT_MAX_AGE_DAYS,
        help=f"Re-check officials last processed this many days ago (default {DEFAULT_MAX_AGE_DAYS}).",
    )
    parser.add_argument(
        "--concurrency", type=int, default=DEFAULT_CONCURRENCY,
        help=f"Parallel model calls per official (default {DEFAULT_CONCURRENCY}; match OLLAMA_NUM_PARALLEL).",
    )
    parser.add_argument("--chunk-chars", type=int, default=DEFAULT_CHUNK_CHARS, help=f"Max characters per model call (default {DEFAULT_CHUNK_CHARS}).")
    parser.add_argument("--crawl-delay", type=float, default=DEFAULT_DELAY_SECONDS, help=f"Seconds between requests to a site (default {DEFAULT_DELAY_SECONDS}).")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES, help=f"Max pages fetched per official (default {DEFAULT_MAX_PAGES}).")
    parser.add_argument("--user-agent", default=os.getenv("POLITMUS_CRAWLER_UA", DEFAULT_USER_AGENT), help="Crawler User-Agent.")
    parser.add_argument("--model", default=None, help=f"Ollama model (default {DEFAULT_MODEL}).")
    parser.add_argument("--host", default=None, help=f"Ollama host (default {DEFAULT_HOST}).")
    parser.add_argument("--timeout", type=float, default=None, help=f"Ollama request timeout seconds (default {int(DEFAULT_TIMEOUT_SECONDS)}).")
    parser.add_argument("--num-ctx", type=int, default=DEFAULT_NUM_CTX, help=f"Ollama context window (default {DEFAULT_NUM_CTX}).")
    parser.add_argument("--num-predict", type=int, default=DEFAULT_NUM_PREDICT, help=f"Max output tokens per call; retries double it (default {DEFAULT_NUM_PREDICT}).")
    parser.add_argument("--think", action="store_true", help="Let reasoning models think before answering (slower; off by default).")
    args = parser.parse_args(argv)

    if args.show:
        return show_official(args.show)
    if args.crawl_only and args.extract_only:
        parser.error("--crawl-only and --extract-only are mutually exclusive")

    config = CrawlConfig(
        user_agent=args.user_agent,
        delay_seconds=args.crawl_delay,
        max_pages=args.max_pages,
    )
    try:
        with run_lock():
            stats = run_positions(
                limit=args.limit,
                official_id=args.official_id,
                level=args.level,
                force=args.force,
                dry_run=args.dry_run,
                crawl_only=args.crawl_only,
                extract_only=args.extract_only,
                max_age_days=args.max_age_days,
                concurrency=args.concurrency,
                chunk_chars=args.chunk_chars,
                model=args.model,
                host=args.host,
                timeout=args.timeout,
                num_ctx=args.num_ctx,
                num_predict=args.num_predict,
                think=args.think,
                crawl_config=config,
            )
    except KeyboardInterrupt:
        print("\nStopped. Officials already finished are saved.")
        return 130
    except Exception as exc:
        print(f"Official positions run failed: {exc}", file=sys.stderr)
        return 1
    print_stats(stats)
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
