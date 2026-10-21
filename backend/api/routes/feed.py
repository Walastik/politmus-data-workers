from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import desc, func, tuple_
from sqlalchemy.orm import Session

from api.filters import normalize_party, normalize_state
from api.routes.bills import _roll_call_out
from api.routes.voter_info import all_upcoming_elections, elections_cache, us_today
from api.schemas import (
    BillOut,
    ElectionOut,
    FeedItemOut,
    FeedPageOut,
    OfficialOut,
    UpcomingElectionsOut,
)
from config import get_google_civic_api_key
from database import get_db
from models import Bill, FeedEvent, Official, RollCall, Vote
from services.bill_classification import model_from_version
from services.feed_events import (
    BILL_INTRODUCED,
    BILL_STATUS_CHANGED,
    FEED_KINDS,
    OFFICIAL_DEPARTED,
    OFFICIAL_SEATED,
    VOTE_HELD,
)

router = APIRouter()

UPCOMING_LIMIT = 6


def _encode_cursor(event: FeedEvent) -> str:
    return f"{event.occurred_at.isoformat()}:{event.id}"


def _decode_cursor(cursor: str) -> tuple[date, int]:
    try:
        day, event_id = cursor.split(":", 1)
        return date.fromisoformat(day), int(event_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid cursor.")


def _parse_kinds(kinds: Optional[str]) -> list[str]:
    if not kinds:
        return []
    requested = [kind.strip() for kind in kinds.split(",") if kind.strip()]
    unknown = sorted(set(requested) - set(FEED_KINDS))
    if unknown:
        raise HTTPException(
            status_code=422, detail=f"Unknown feed kinds: {', '.join(unknown)}."
        )
    return requested


def _office_line(official: Official) -> str:
    parts = [official.office or "Official"]
    if official.state:
        parts.append(official.state)
    if official.district is not None:
        parts.append(f"District {official.district}")
    return ", ".join(parts)


def _headline(event: FeedEvent, bill: Optional[Bill], official: Optional[Official],
              roll_call: Optional[RollCall]) -> tuple[str, Optional[str]]:
    payload = event.payload or {}
    if event.kind in (OFFICIAL_SEATED, OFFICIAL_DEPARTED) and official is not None:
        verb = "Took office" if event.kind == OFFICIAL_SEATED else "Left office"
        return official.display_name or official.id, f"{verb} · {_office_line(official)}"

    title = (bill.title if bill else None) or event.bill_id or "Untitled bill"
    if event.kind == BILL_INTRODUCED:
        sponsor = bill.sponsor_name if bill else None
        return title, f"Introduced by {sponsor}" if sponsor else None
    if event.kind == BILL_STATUS_CHANGED:
        return title, payload.get("action")
    if event.kind == VOTE_HELD:
        question = roll_call.question if roll_call else payload.get("question")
        return title, question
    return title, None


def _bill_out(bill: Bill) -> BillOut:
    out = BillOut.model_validate(bill)
    out.classification_model = model_from_version(bill.classification_version)
    return out


def _tallies_by_party(db: Session, roll_call_ids: list[int]) -> dict[int, dict[str, dict[str, int]]]:
    tallies: dict[int, dict[str, dict[str, int]]] = defaultdict(dict)
    if not roll_call_ids:
        return tallies
    rows = (
        db.query(Vote.roll_call_id, Official.party, Vote.position, func.count(Vote.id))
        .join(Official, Official.id == Vote.official_id)
        .filter(Vote.roll_call_id.in_(roll_call_ids))
        .group_by(Vote.roll_call_id, Official.party, Vote.position)
        .all()
    )
    for roll_call_id, party, position, count in rows:
        party_name = normalize_party(party) or "Unknown"
        by_position = tallies[roll_call_id].setdefault(party_name, {})
        by_position[position] = by_position.get(position, 0) + count
    return tallies


@router.get("", response_model=FeedPageOut)
def list_feed(
    limit: int = Query(default=30, ge=1, le=100),
    cursor: Optional[str] = Query(None, description="next_cursor from the previous page."),
    kinds: Optional[str] = Query(None, description="Comma-separated event kinds."),
    level: Optional[str] = Query(None, description="federal or state; omit for both."),
    state: Optional[str] = Query(None, description="State name or abbreviation."),
    db: Session = Depends(get_db),
):
    query = db.query(FeedEvent)
    requested_kinds = _parse_kinds(kinds)
    if requested_kinds:
        query = query.filter(FeedEvent.kind.in_(requested_kinds))
    if level and level.strip().lower() not in {"all", "*"}:
        query = query.filter(FeedEvent.level.ilike(level.strip()))
    if state:
        query = query.filter(FeedEvent.state.ilike(normalize_state(state)))
    if cursor:
        cursor_day, cursor_id = _decode_cursor(cursor)
        query = query.filter(
            tuple_(FeedEvent.occurred_at, FeedEvent.id) < tuple_(cursor_day, cursor_id)
        )

    # One extra row tells us whether another page exists.
    events = (
        query.order_by(desc(FeedEvent.occurred_at), desc(FeedEvent.id))
        .limit(limit + 1)
        .all()
    )
    has_more = len(events) > limit
    events = events[:limit]

    bill_ids = {event.bill_id for event in events if event.bill_id}
    official_ids = {event.official_id for event in events if event.official_id}
    roll_call_ids = [event.roll_call_id for event in events if event.roll_call_id]
    bills = {
        row.id: row for row in db.query(Bill).filter(Bill.id.in_(bill_ids)).all()
    } if bill_ids else {}
    officials = {
        row.id: row
        for row in db.query(Official).filter(Official.id.in_(official_ids)).all()
    } if official_ids else {}
    roll_calls = {
        row.id: row
        for row in db.query(RollCall).filter(RollCall.id.in_(roll_call_ids)).all()
    } if roll_call_ids else {}
    tallies = _tallies_by_party(db, roll_call_ids)

    items = []
    for event in events:
        bill = bills.get(event.bill_id)
        official = officials.get(event.official_id)
        roll_call = roll_calls.get(event.roll_call_id)
        headline, subline = _headline(event, bill, official, roll_call)
        items.append(
            FeedItemOut(
                id=event.id,
                kind=event.kind,
                occurred_at=event.occurred_at,
                detected_at=event.detected_at,
                headline=headline,
                subline=subline,
                level=event.level,
                state=event.state,
                bill=_bill_out(bill) if bill else None,
                official=OfficialOut.model_validate(official) if official else None,
                roll_call=_roll_call_out(roll_call) if roll_call else None,
                tally_by_party=tallies.get(event.roll_call_id) if roll_call else None,
                payload=event.payload,
            )
        )

    return FeedPageOut(
        items=items,
        next_cursor=_encode_cursor(events[-1]) if has_more and events else None,
    )


@router.get("/upcoming", response_model=UpcomingElectionsOut)
async def upcoming(request: Request):
    """Upcoming real elections nationwide, from the shared Civic elections cache."""
    api_key = get_google_civic_api_key()
    if not api_key:
        return UpcomingElectionsOut(elections=[])
    client = getattr(request.app.state, "http_client", None)
    elections = await elections_cache.get(client, api_key) or []
    return UpcomingElectionsOut(
        elections=[
            ElectionOut(
                id=str(e.get("id", "")),
                name=str(e.get("name", "")),
                date=e.get("electionDay") or None,
            )
            for e in all_upcoming_elections(elections, us_today())[:UPCOMING_LIMIT]
        ]
    )
