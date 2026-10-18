"""Embed policy target names and store near matches for scoring.

Run on the Mac Mini (needs Ollama and the embedding model, default
nomic-embed-text: `ollama pull nomic-embed-text`). The bill classifier and
positions worker do this after each item; run it by hand after changing
TARGET_EMBED_MODEL, or to inspect matches:

    python match_targets.py                     # embed new targets
    python match_targets.py --rebuild           # re-embed everything
    python match_targets.py --neighbors "Voter Registration"

Then rescore (score_officials.py) so scores pick up new matches.
"""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv

from database import SessionLocal
from init_db import ensure_schema
from services.accountability import TARGET_MATCH_THRESHOLD
from services.target_matching import DEFAULT_EMBED_MODEL, MATCH_FLOOR, make_matcher, neighbors

load_dotenv()

DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rebuild", action="store_true", help="Drop stored embeddings and matches, then embed every target.")
    parser.add_argument("--neighbors", metavar="NAME", help="Print the stored matches for one target name and exit.")
    parser.add_argument("--model", default=None, help=f"Embedding model (default {DEFAULT_EMBED_MODEL}; TARGET_EMBED_MODEL).")
    parser.add_argument("--host", default=None, help=f"Ollama host (default {DEFAULT_HOST}).")
    args = parser.parse_args(argv)

    session = SessionLocal()
    try:
        if args.neighbors:
            rows = neighbors(session, args.neighbors, limit=30)
            if not rows:
                print(f"No stored matches for {args.neighbors!r} (floor {MATCH_FLOOR}).")
            for name, similarity in rows:
                mark = "match" if similarity >= TARGET_MATCH_THRESHOLD else "     "
                print(f"  {similarity:.3f} {mark}  {name}")
            return 0

        ensure_schema()
        matcher = make_matcher(args.host or DEFAULT_HOST, args.model)
        log = lambda line: print(line, flush=True)  # noqa: E731
        print(f"Embedding target names with {matcher.model} (first run embeds every target)...", flush=True)
        stats = matcher.rebuild(session, log) if args.rebuild else matcher.refresh(session, log)
    except Exception as exc:
        session.rollback()
        print(f"Target matching failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Target matching ({matcher.model})")
    print(f"  Targets embedded: {stats['embedded']}")
    print(f"  Pairs stored:     {stats['pairs']} (similarity >= {MATCH_FLOOR})")
    print(f"  Scoring threshold: {TARGET_MATCH_THRESHOLD} (TARGET_MATCH_THRESHOLD)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
