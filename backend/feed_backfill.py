"""Seed feed_events from rows ingest stored before the feed existed.

Bills introduced or acted on, and roll calls held, within the last --days.
Recorders are idempotent, so this is safe to re-run.

    python feed_backfill.py --days 90
"""

import argparse
from datetime import date, timedelta

from sqlalchemy import or_

from database import SessionLocal
from init_db import ensure_schema
from models import Bill, RollCall
from services.feed_events import record_bill_events, record_vote_held


def backfill_feed(days=90):
    ensure_schema()
    cutoff = date.today() - timedelta(days=days)
    session = SessionLocal()
    stats = {"bills_scanned": 0, "roll_calls_scanned": 0, "events_inserted": 0}
    try:
        bills = (
            session.query(Bill)
            .filter(
                or_(Bill.introduced_date >= cutoff, Bill.latest_action_date >= cutoff)
            )
            .all()
        )
        for bill in bills:
            stats["bills_scanned"] += 1
            stats["events_inserted"] += record_bill_events(session, bill)

        roll_calls = session.query(RollCall).filter(RollCall.date >= cutoff).all()
        for roll_call in roll_calls:
            stats["roll_calls_scanned"] += 1
            stats["events_inserted"] += int(record_vote_held(session, roll_call))

        session.commit()
        return stats
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(description="Seed feed_events from stored bills and votes.")
    parser.add_argument("--days", type=int, default=90, help="Look-back window (default 90).")
    args = parser.parse_args()
    stats = backfill_feed(days=args.days)
    print(
        f"Scanned {stats['bills_scanned']} bills and {stats['roll_calls_scanned']} "
        f"roll calls; inserted {stats['events_inserted']} feed events."
    )


if __name__ == "__main__":
    main()
