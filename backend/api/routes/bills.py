from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.schemas import BillDetailOut
from database import get_db
from models import Bill, Vote

router = APIRouter()


def _vote_summaries(db: Session, bill_ids: list[str]) -> dict[str, dict[str, int]]:
    summaries: dict[str, dict[str, int]] = defaultdict(dict)
    if not bill_ids:
        return summaries

    vote_counts = (
        db.query(Vote.bill_id, Vote.position, func.count(Vote.id))
        .filter(Vote.bill_id.in_(bill_ids))
        .group_by(Vote.bill_id, Vote.position)
        .all()
    )
    for bill_id, position, count in vote_counts:
        if position:
            summaries[bill_id][position] = count
    return summaries


def _bill_detail(bill: Bill, votes_summary: dict[str, int]) -> BillDetailOut:
    return BillDetailOut(
        id=bill.id,
        title=bill.title,
        sponsor_id=bill.sponsor_id,
        sponsor_bioguide_id=bill.sponsor_bioguide_id,
        sponsor_name=bill.sponsor_name,
        policy_area=bill.policy_area,
        summary=bill.summary,
        votes_summary=votes_summary,
    )


@router.get("", response_model=list[BillDetailOut])
def list_bills(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    bills = db.query(Bill).order_by(Bill.id.desc()).limit(limit).all()
    summaries = _vote_summaries(db, [bill.id for bill in bills])
    return [_bill_detail(bill, summaries.get(bill.id, {})) for bill in bills]


@router.get("/{bill_id}", response_model=BillDetailOut)
def get_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    summaries = _vote_summaries(db, [bill_id])
    return _bill_detail(bill, summaries.get(bill_id, {}))
