"""Embed policy target names, store near matches, and review the ones that
could score (services/target_matching.py).

Run on the Mac Mini (needs Ollama, the embedding model, default
nomic-embed-text: `ollama pull nomic-embed-text`, and a chat model for
reviews). The bill classifier and positions worker do this after each item;
run it by hand to backfill, after changing a model, or to inspect matches:

    python match_targets.py                           # embed new targets
    python match_targets.py --official-id B001267     # also review that official's pairs (repeatable)
    python match_targets.py --bill-id 119-hr-22       # also review that bill's pairs (repeatable)
    python match_targets.py --review-all              # review every pair that could score (slow)
    python match_targets.py --rereview --review-all   # forget verdicts, then review again
    python match_targets.py --rebuild                 # re-embed everything (drops verdicts)
    python match_targets.py --neighbors "Voter Registration"

Then rescore (score_officials.py) so scores pick up the changes.
"""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import text

from database import SessionLocal
from init_db import ensure_schema
from services.accountability import TARGET_MATCH_THRESHOLD
from services.target_matching import (
    DEFAULT_EMBED_MODEL,
    MATCH_FLOOR,
    REVIEW_FLOOR,
    make_matcher,
    neighbors,
)

load_dotenv()

DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_REVIEW_MODEL = os.getenv("TARGET_REVIEW_MODEL") or os.getenv("OLLAMA_MODEL") or "qwen3.6:27b"


def show_neighbors(session, name: str) -> None:
    rows = neighbors(session, name, limit=30)
    if not rows:
        print(f"No stored matches for {name!r} (floor {MATCH_FLOOR}).")
    for other, similarity, verdict in rows:
        if verdict:
            status = f"{verdict} (reviewed)"
        else:
            status = "match" if similarity >= TARGET_MATCH_THRESHOLD else "-"
        print(f"  {similarity:.3f}  {status:<20} {other}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--official-id", action="append", help="Review pairs that could score for this official (repeatable).")
    parser.add_argument("--bill-id", action="append", help="Review pairs that could score on this bill (repeatable).")
    parser.add_argument("--review-all", action="store_true", help="Review every unreviewed pair that could score.")
    parser.add_argument("--rereview", action="store_true", help="Forget stored verdicts first (after changing the review model).")
    parser.add_argument("--rebuild", action="store_true", help="Drop stored embeddings, matches, and verdicts, then embed every target.")
    parser.add_argument("--neighbors", metavar="NAME", help="Print the stored matches for one target name and exit.")
    parser.add_argument("--model", default=None, help=f"Embedding model (default {DEFAULT_EMBED_MODEL}; TARGET_EMBED_MODEL).")
    parser.add_argument(
        "--review-model", default=DEFAULT_REVIEW_MODEL,
        help=f"Chat model for reviews (default {DEFAULT_REVIEW_MODEL}; TARGET_REVIEW_MODEL, then OLLAMA_MODEL).",
    )
    parser.add_argument("--host", default=None, help=f"Ollama host (default {DEFAULT_HOST}).")
    args = parser.parse_args(argv)

    session = SessionLocal()
    try:
        if args.neighbors:
            show_neighbors(session, args.neighbors)
            return 0

        ensure_schema()
        matcher = make_matcher(args.host or DEFAULT_HOST, args.model, review_model=args.review_model)
        log = lambda line: print(line, flush=True)  # noqa: E731
        if args.rereview:
            session.execute(text("UPDATE target_matches SET verdict = NULL WHERE verdict IS NOT NULL"))
            session.commit()
        print(f"Embedding target names with {matcher.model} (a first run embeds every target)...", flush=True)
        if args.rebuild:
            stats = matcher.rebuild(session, log)
        else:
            stats = matcher.embed_new(session, log)
        stats["reviewed"] = 0
        if args.official_id or args.bill_id or args.review_all:
            print(f"Reviewing name pairs with {args.review_model}...", flush=True)
            stats["reviewed"] = matcher.review(session, log, official_ids=args.official_id, bill_ids=args.bill_id)
    except Exception as exc:
        session.rollback()
        print(f"Target matching failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Target matching ({matcher.model})")
    print(f"  Targets embedded:  {stats['embedded']}")
    print(f"  Pairs stored:      {stats['pairs']} (similarity >= {MATCH_FLOOR})")
    print(f"  Pairs reviewed:    {stats['reviewed']} (similarity >= {REVIEW_FLOOR})")
    print(f"  Scoring threshold: {TARGET_MATCH_THRESHOLD} for unreviewed pairs (TARGET_MATCH_THRESHOLD)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
