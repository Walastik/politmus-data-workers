from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.filters import classify_bipartisan_type, normalize_party
from api.schemas import BillDetailOut
from database import get_db
from models import Bill, Official, Vote

router = APIRouter()

HOUSE_OFFICES = ("Representative", "Delegate", "Resident Commissioner")
SENATE_OFFICES = ("Senator",)
CHAMBERS = ("house", "senate")


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


def _party_bucket(party: str | None) -> str:
    return normalize_party(party) or "Unknown"


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
    db: Session, bill_ids: list[str]
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

    vote_counts = (
        db.query(
            Vote.bill_id,
            Official.office,
            Official.party,
            Vote.position,
            func.count(Vote.id),
        )
        .join(Official, Official.id == Vote.official_id)
        .filter(Vote.bill_id.in_(bill_ids))
        .group_by(Vote.bill_id, Official.office, Official.party, Vote.position)
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
        votes_summary=votes_summary or _empty_chamber_summaries(),
        votes_by_party=votes_by_party or _empty_party_summaries(),
    )


@router.get("", response_model=list[BillDetailOut])
def list_bills(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    bills = db.query(Bill).order_by(Bill.id.desc()).limit(limit).all()
    summaries, party_summaries = _vote_summaries(db, [bill.id for bill in bills])
    return [
        _bill_detail(
            bill,
            summaries.get(bill.id) or _empty_chamber_summaries(),
            party_summaries.get(bill.id) or _empty_party_summaries(),
        )
        for bill in bills
    ]


@router.get("/{bill_id}", response_model=BillDetailOut)
def get_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    summaries, party_summaries = _vote_summaries(db, [bill_id])
    return _bill_detail(
        bill,
        summaries.get(bill_id) or _empty_chamber_summaries(),
        party_summaries.get(bill_id) or _empty_party_summaries(),
    )
