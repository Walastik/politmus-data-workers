from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.filters import normalize_party, normalize_state
from api.schemas import OfficialDetailOut, OfficialOut, OfficialVoteOut
from database import get_db
from models import Bill, Official, Vote

router = APIRouter()


@router.get("", response_model=list[OfficialOut])
def list_officials(
    party: Optional[str] = Query(
        default=None,
        description="Party name or short code (D, R, I, Democratic, Republican, Independent).",
    ),
    state: Optional[str] = Query(
        default=None,
        description="Full state name or postal abbreviation (e.g. California or CA).",
    ),
    limit: int = Query(default=600, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(Official)
    party_value = normalize_party(party)
    state_value = normalize_state(state)
    if party_value:
        query = query.filter(Official.party.ilike(party_value))
    if state_value:
        query = query.filter(Official.state.ilike(state_value))

    officials = query.order_by(Official.name).limit(limit).all()
    return officials


@router.get("/{official_id}", response_model=OfficialDetailOut)
def get_official(official_id: str, db: Session = Depends(get_db)):
    official = db.query(Official).filter(Official.id == official_id).first()
    if not official:
        raise HTTPException(status_code=404, detail="Official not found")

    vote_rows = (
        db.query(Vote, Bill)
        .join(Bill, Bill.id == Vote.bill_id)
        .filter(Vote.official_id == official_id)
        .order_by(Bill.id.desc())
        .all()
    )

    return OfficialDetailOut(
        id=official.id,
        name=official.name,
        state=official.state,
        party=official.party,
        votes=[
            OfficialVoteOut(
                bill_id=bill.id,
                bill_title=bill.title,
                position=vote.position,
                sponsor_name=bill.sponsor_name,
            )
            for vote, bill in vote_rows
        ],
    )
