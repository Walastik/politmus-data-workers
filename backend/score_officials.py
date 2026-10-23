"""Score officials on whether their passage votes match their stated positions.

Joins classified bill intents (bill_effects) with officials' stated positions
(official_stances) on target + mechanism and scores each passage vote +1/-1
(see services/accountability.py). No LLM; a full run takes seconds.

Idempotent: by default only officials whose computed rows changed are
rewritten. The bill classifier and positions worker rescore the officials
they touch; ingest workflows run this after new votes land.
"""

from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

from database import SessionLocal
from init_db import ensure_schema
from models import Bill, Official, OfficialScore, VoteAlignment
from services.accountability import ENGINE_VERSION, rescore, voters_on_bills

load_dotenv()


def show_official(official_id: str, session_factory=None) -> int:
    session = (session_factory or SessionLocal)()
    try:
        official = session.get(Official, official_id)
        if official is None:
            print(f"Official {official_id} not found.")
            return 1
        print(f"{official.id} {official.name} ({official.party}, {official.state})")
        score = session.get(OfficialScore, official_id)
        if score is None:
            print("  Not scored (no stated positions, or scoring has not run).")
            return 0
        pct = f"{score.alignment_pct:.1f}%" if score.alignment_pct is not None else "n/a"
        print(
            f"  points={score.points:+d} alignment={pct} aligned={score.aligned} "
            f"conflicting={score.conflicting} bills={score.bills_scored} "
            f"stances_matched={score.stances_matched} version={score.engine_version}"
        )
        rows = (
            session.query(VoteAlignment, Bill.title)
            .join(Bill, Bill.id == VoteAlignment.bill_id)
            .filter(VoteAlignment.official_id == official_id)
            .order_by(VoteAlignment.vote_date.desc().nullslast(), VoteAlignment.bill_id)
            .all()
        )
        for a, title in rows:
            mark = f"{a.points:+d}" if a.counted else " 0"
            why = "" if a.counted else f"  [not counted: {a.reason}]"
            if a.match_similarity is not None:
                inverse = ", inverse" if a.match_inverse else ""
                why += f"  [position: {a.stance_target_name}, similarity {a.match_similarity:.2f}{inverse}]"
            print(
                f"  {mark}  {a.vote_position:<3} {a.bill_id} ({a.chamber}, {a.vote_date}) "
                f"{a.target_name} / {a.mechanism}: bill {a.effect_direction}, "
                f"wants {a.stance_direction} ({a.stance_emphasis}){why}  — {title or ''}"
            )
        return 0
    finally:
        session.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Score officials' passage votes against their stated positions "
            "into vote_alignments and official_scores."
        )
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--official-id", action="append", help="Score one official (repeatable).")
    scope.add_argument("--bill-id", action="append", help="Score everyone who voted on this bill (repeatable).")
    parser.add_argument(
        "--force", "--all", dest="force", action="store_true",
        help="Rewrite every selected official even when inputs are unchanged.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Compute and report, write nothing.")
    parser.add_argument("--show", metavar="OFFICIAL_ID", help="Print one official's score and matches and exit.")
    args = parser.parse_args(argv)

    if args.show:
        return show_official(args.show)

    ensure_schema()
    session = SessionLocal()
    try:
        official_ids = args.official_id
        if args.bill_id:
            official_ids = voters_on_bills(session, args.bill_id)
        stats = rescore(session, official_ids, force=args.force, dry_run=args.dry_run)
    except Exception as exc:
        session.rollback()
        print(f"Scoring run failed: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Accountability scoring ({ENGINE_VERSION}){' [dry run]' if args.dry_run else ''}")
    print(f"  Officials with positions: {stats['officials']}")
    print(f"  Updated:                  {stats['updated']}")
    print(f"  Unchanged:                {stats['unchanged']}")
    print(f"  Removed:                  {stats['removed']}")
    print(f"  Counted matches:          {stats['matches']}")
    print(f"  Matches not counted:      {stats['not_counted']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
