"""Record feed-worthy changes as ingest notices them.

Every recorder is idempotent: the event's `dedupe_key` is derived from what
happened (bill + status, roll call id, official + day), and inserts that hit
an existing key are dropped. Workers call these on every upsert instead of
diffing old and new rows themselves.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.dialects.postgresql import insert

from models import FeedEvent
from status_mapper import STATUS_INTRODUCED

BILL_INTRODUCED = "bill_introduced"
BILL_STATUS_CHANGED = "bill_status_changed"
VOTE_HELD = "vote_held"
OFFICIAL_SEATED = "official_seated"
OFFICIAL_DEPARTED = "official_departed"

FEED_KINDS = (
    BILL_INTRODUCED,
    BILL_STATUS_CHANGED,
    VOTE_HELD,
    OFFICIAL_SEATED,
    OFFICIAL_DEPARTED,
)


def record_event(
    session,
    *,
    kind,
    occurred_at,
    dedupe_key,
    official_id=None,
    bill_id=None,
    roll_call_id=None,
    state=None,
    level="federal",
    payload=None,
):
    """Insert one event unless its dedupe_key exists. Returns True if inserted."""
    statement = (
        insert(FeedEvent)
        .values(
            kind=kind,
            occurred_at=occurred_at,
            dedupe_key=dedupe_key,
            official_id=official_id,
            bill_id=bill_id,
            roll_call_id=roll_call_id,
            state=state,
            level=level or "federal",
            payload=payload,
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
    )
    return session.execute(statement).rowcount == 1


def record_bill_events(session, bill):
    """Introduction plus the bill's current status (once per distinct status)."""
    inserted = 0
    level = bill.level or "federal"
    if bill.introduced_date is not None:
        inserted += record_event(
            session,
            kind=BILL_INTRODUCED,
            occurred_at=bill.introduced_date,
            dedupe_key=f"{BILL_INTRODUCED}:{bill.id}",
            bill_id=bill.id,
            official_id=bill.sponsor_id,
            level=level,
        )
    if bill.status and bill.status != STATUS_INTRODUCED:
        inserted += record_event(
            session,
            kind=BILL_STATUS_CHANGED,
            occurred_at=bill.latest_action_date or date.today(),
            dedupe_key=f"{BILL_STATUS_CHANGED}:{bill.id}:{bill.status}",
            bill_id=bill.id,
            level=level,
            payload={"status": bill.status, "action": bill.latest_action_text},
        )
    return inserted


def record_vote_held(session, roll_call):
    """One event per roll call, once its date is known."""
    if roll_call.date is None or roll_call.id is None:
        return False
    return record_event(
        session,
        kind=VOTE_HELD,
        occurred_at=roll_call.date,
        dedupe_key=f"{VOTE_HELD}:{roll_call.source_roll_call_id}",
        bill_id=roll_call.bill_id,
        roll_call_id=roll_call.id,
        payload={
            "chamber": roll_call.chamber,
            "question": roll_call.question,
            "result": roll_call.result,
        },
    )


def _official_event(session, kind, official, on):
    on = on or date.today()
    return record_event(
        session,
        kind=kind,
        occurred_at=on,
        dedupe_key=f"{kind}:{official.id}:{on.isoformat()}",
        official_id=official.id,
        state=official.state,
        level=official.level or "federal",
        payload={"office": official.office, "party": official.party},
    )


def record_official_seated(session, official, on=None):
    return _official_event(session, OFFICIAL_SEATED, official, on)


def record_official_departed(session, official, on=None):
    return _official_event(session, OFFICIAL_DEPARTED, official, on)
