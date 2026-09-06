from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.schemas import BillDetailOut, BillOut
from database import get_db
from models import Bill, Vote

router = APIRouter()


@router.get("", response_model=list[BillOut])
def list_bills(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return db.query(Bill).order_by(Bill.id.desc()).limit(limit).all()


@router.get("/{bill_id}", response_model=BillDetailOut)
def get_bill(bill_id: str, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    vote_counts = (
        db.query(Vote.position, func.count(Vote.id))
        .filter(Vote.bill_id == bill_id)
        .group_by(Vote.position)
        .all()
    )

    return BillDetailOut(
        id=bill.id,
        title=bill.title,
        sponsor_id=bill.sponsor_id,
        sponsor_bioguide_id=bill.sponsor_bioguide_id,
        sponsor_name=bill.sponsor_name,
        votes_summary={position: count for position, count in vote_counts if position},
    )
