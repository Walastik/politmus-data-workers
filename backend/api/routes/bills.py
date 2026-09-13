from collections import defaultdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, nulls_first, nulls_last
from sqlalchemy.orm import Session

from api.filters import classify_bipartisan_type, normalize_party
from api.schemas import BillDetailOut, BillVoterOut, BillVotersOut, RollCallOut
from database import get_db
from models import Bill, Official, RollCall, Vote

router = APIRouter()

HOUSE_OFFICES = ("Representative", "Delegate", "Resident Commissioner")
SENATE_OFFICES = ("Senator",)
CHAMBERS = ("house", "senate")
VOTE_SORT_ORDER = {
    "Yes": 0,
    "No": 1,
    "Present": 2,
    "Not Voting": 3,
}


def _chamber_for_office(office: str | None) -> str | None:
    if office in SENATE_OFFICES:
        return "senate"
    if office in HOUSE_OFFICES:
        return "house"
    return None


def _empty_chamber_summaries() -> dict[str, dict[str, int]]:
    return {chamber: {} for chamber in CHAMBERS}


def _empty_party_summaries() -> dict[str, dict[str, dict[str, int]]]:
    return {chamber: {} for chamber in CHAMBERS}


def _roll_call_out(row: RollCall) -> RollCallOut:
    return RollCallOut(
        id=row.id,
        chamber=row.chamber,
        date=row.date,
        question=row.question,
        result=row.result,
        requires=row.requires,
        source_roll_call_id=row.source_roll_call_id,
    )


def _roll_calls_by_bill(db: Session, bill_ids: list[str]) -> dict[str, list[RollCall]]:
    grouped: dict[str, list[RollCall]] = defaultdict(list)
    if not bill_ids:
        return grouped
    rows = (
        db.query(RollCall)
        .filter(RollCall.bill_id.in_(bill_ids))
        .order_by(
            nulls_last(desc(RollCall.date)),
            desc(RollCall.id),
        )
        .all()
    )
    for row in rows:
        grouped[row.bill_id].append(row)
    return grouped


def _latest_roll_call_ids(roll_calls: list[RollCall]) -> list[int]:
    """One latest roll call per chamber so tallies are not mixed across votes."""
    latest: dict[str, int] = {}
    for row in roll_calls:
        chamber = (row.chamber or "").strip().lower()
        if chamber not in CHAMBERS or chamber in latest:
            continue
        latest[chamber] = row.id
    return list(latest.values())


def _latest_roll_call_for_chamber(
    roll_calls: list[RollCall], chamber: str
) -> RollCall | None:
    wanted = chamber.strip().lower()
    for row in roll_calls:
        if (row.chamber or "").strip().lower() == wanted:
            return row
    return None


def _party_bucket(party: str | None) -> str:
    return normalize_party(party) or "Unknown"


def last_name_from_official_name(name: str | None) -> str:
    """Last name from inverted Congress.gov names ('Adams, Alma S.') or a display name."""
    if not name:
        return ""
    text = str(name).strip()
    if "," in text:
        return text.split(",", 1)[0].strip()
    parts = text.split()
    return parts[-1] if parts else ""


def _vote_sort_key(position: str | None, name: str | None) -> tuple[int, str, str]:
    order = VOTE_SORT_ORDER.get(position or "", 9)
    last = last_name_from_official_name(name).casefold()
    full = (name or "").strip().casefold()
    return (order, last, full)


def sort_bill_voters(voters: list[BillVoterOut]) -> list[BillVoterOut]:
    return sorted(
        voters,
        key=lambda voter: _vote_sort_key(voter.position, voter.name),
    )


def bills_feed_order():
    """Unvoted bills first (by introduced date desc), then most recent vote."""
    return (
        nulls_first(desc(Bill.voted_date)),
        nulls_last(desc(Bill.introduced_date)),
        desc(Bill.id),
    )


def bill_feed_sort_key(bill: Bill) -> tuple:
    """Python equivalent of `bills_feed_order` for unit tests."""
    unvoted = 0 if bill.voted_date is None else 1
    voted_desc = -bill.voted_date.toordinal() if bill.voted_date else 0
    introduced_desc = (
        -bill.introduced_date.toordinal() if bill.introduced_date else 0
    )
    return (unvoted, voted_desc, introduced_desc, bill.id or "")


def _record_vote_count(
    summaries: dict[str, dict[str, dict[str, int]]],
    party_summaries: dict[str, dict[str, dict[str, dict[str, int]]]],
    bill_id: str,
    office: str | None,
    party: str | None,
    position: str | None,
    count: int,
) -> None:
    chamber = _chamber_for_office(office)
    if not chamber or not position:
        return
    summaries[bill_id][chamber][position] = (
        summaries[bill_id][chamber].get(position, 0) + count
    )
    party_name = _party_bucket(party)
    chamber_parties = party_summaries[bill_id][chamber]
    if party_name not in chamber_parties:
        chamber_parties[party_name] = {}
    chamber_parties[party_name][position] = (
        chamber_parties[party_name].get(position, 0) + count
    )


def _vote_summaries(
    db: Session,
    bill_ids: list[str],
    roll_calls_by_bill: dict[str, list[RollCall]] | None = None,
) -> tuple[
    dict[str, dict[str, dict[str, int]]],
    dict[str, dict[str, dict[str, dict[str, int]]]],
]:
    summaries: dict[str, dict[str, dict[str, int]]] = defaultdict(
        _empty_chamber_summaries
    )
    party_summaries: dict[str, dict[str, dict[str, dict[str, int]]]] = defaultdict(
        _empty_party_summaries
    )
    if not bill_ids:
        return summaries, party_summaries

    if roll_calls_by_bill is None:
        roll_calls_by_bill = _roll_calls_by_bill(db, bill_ids)

    latest_ids = []
    for bill_id in bill_ids:
        latest_ids.extend(
            _latest_roll_call_ids(roll_calls_by_bill.get(bill_id) or [])
        )
    if not latest_ids:
        return summaries, party_summaries

    vote_counts = (
        db.query(
            RollCall.bill_id,
            Official.office,
            Official.party,
            Vote.position,
            func.count(Vote.id),
        )
        .join(RollCall, RollCall.id == Vote.roll_call_id)
        .join(Official, Official.id == Vote.official_id)
        .filter(Vote.roll_call_id.in_(latest_ids))
        .group_by(RollCall.bill_id, Official.office, Official.party, Vote.position)
        .all()
    )
    for bill_id, office, party, position, count in vote_counts:
        _record_vote_count(
            summaries, party_summaries, bill_id, office, party, position, count
        )
    return summaries, party_summaries


def _bill_detail(
    bill: Bill,
    votes_summary: dict[str, dict[str, int]],
    votes_by_party: dict[str, dict[str, dict[str, int]]] | None = None,
    roll_calls: list[RollCall] | None = None,
) -> BillDetailOut:
    return BillDetailOut(
        id=bill.id,
        title=bill.title,
        sponsor_id=bill.sponsor_id,
        sponsor_bioguide_id=bill.sponsor_bioguide_id,
        sponsor_name=bill.sponsor_name,
        sponsor_party=bill.sponsor_party,
        cosponsor_party_breakdown=bill.cosponsor_party_breakdown,
        bipartisan_type=(
            classify_bipartisan_type(
                bill.sponsor_party, bill.cosponsor_party_breakdown
            )
            or bill.bipartisan_type
        ),
        policy_area=bill.policy_area,
        summary=bill.summary,
        introduced_date=bill.introduced_date,
        voted_date=bill.voted_date,
        days_to_vote=bill.days_to_vote,
        velocity_bucket=bill.velocity_bucket,
        latest_action_date=bill.latest_action_date,
        latest_action_text=bill.latest_action_text,
        status=bill.status,
        level=bill.level or "federal",
        votes_summary=votes_summary or _empty_chamber_summaries(),
        votes_by_party=votes_by_party or _empty_party_summaries(),
        roll_calls=[_roll_call_out(row) for row in (roll_calls or [])],
    )


@router.get("", response_model=list[BillDetailOut])
def list_bills(
    limit: int = Query(default=100, ge=1, le=500),
    level: Optional[str] = Query(
        default="federal",
        description="Bill level to list (federal or state). Omit all with level=all.",
    ),
    db: Session = Depends(get_db),
):
    query = db.query(Bill)
    if level and level.strip().lower() not in {"all", "*"}:
        query = query.filter(Bill.level.ilike(level.strip()))
    bills = query.order_by(*bills_feed_order()).limit(limit).all()
    bill_ids = [bill.id for bill in bills]
    roll_calls_by_bill = _roll_calls_by_bill(db, bill_ids)
    summaries, party_summaries = _vote_summaries(
        db, bill_ids, roll_calls_by_bill
    )
    return [
        _bill_detail(
            bill,
            summaries.get(bill.id) or _empty_chamber_summaries(),
            party_summaries.get(bill.id) or _empty_party_summaries(),
            roll_calls_by_bill.get(bill.id) or [],
        )
        for bill in bills
    ]


@router.get("/{bill_id}/votes", response_model=BillVotersOut)
def list_bill_votes(
    bill_id: str,
    chamber: Literal["house", "senate"] = Query(...),
    party: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    wanted_party = _party_bucket(party)
    roll_calls = _roll_calls_by_bill(db, [bill_id]).get(bill_id) or []
    latest = _latest_roll_call_for_chamber(roll_calls, chamber)
    if latest is None:
        return BillVotersOut(
            bill_id=bill_id,
            chamber=chamber,
            party=wanted_party,
            voters=[],
        )

    rows = (
        db.query(Official.id, Official.name, Official.office, Official.party, Vote.position)
        .join(Vote, Vote.official_id == Official.id)
        .filter(Vote.roll_call_id == latest.id)
        .all()
    )
    voters = [
        BillVoterOut(
            official_id=official_id,
            name=name or official_id,
            position=position,
        )
        for official_id, name, office, member_party, position in rows
        if _chamber_for_office(office) == chamber
        and _party_bucket(member_party) == wanted_party
    ]
    return BillVotersOut(
        bill_id=bill_id,
        chamber=chamber,
        party=wanted_party,
        voters=sort_bill_voters(voters),
    )


@router.get("/{bill_id}", response_model=BillDetailOut)
def get_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    roll_calls_by_bill = _roll_calls_by_bill(db, [bill_id])
    summaries, party_summaries = _vote_summaries(
        db, [bill_id], roll_calls_by_bill
    )
    return _bill_detail(
        bill,
        summaries.get(bill_id) or _empty_chamber_summaries(),
        party_summaries.get(bill_id) or _empty_party_summaries(),
        roll_calls_by_bill.get(bill_id) or [],
    )
