from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.filters import name_search_pattern, normalize_party, normalize_state
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
    q: Optional[str] = Query(
        default=None,
        max_length=100,
        description="Case-insensitive substring match on official name.",
    ),
    limit: int = Query(default=600, ge=1, le=1000),
    current_member: Optional[bool] = Query(
        default=None,
        description="If true, only current members. If false, only former members.",
    ),
    level: Optional[str] = Query(
        default=None,
        description="If set, only officials at this level (federal or state).",
    ),
    db: Session = Depends(get_db),
):
    query = db.query(Official)
    party_value = normalize_party(party)
    state_value = normalize_state(state)
    name_pattern = name_search_pattern(q)
    if party_value:
        query = query.filter(Official.party.ilike(party_value))
    if state_value:
        query = query.filter(Official.state.ilike(state_value))
    if name_pattern:
        query = query.filter(Official.name.ilike(name_pattern, escape="\\"))
    if current_member is not None:
        query = query.filter(Official.current_member.is_(current_member))
    if level:
        query = query.filter(Official.level.ilike(level.strip()))

    officials = query.order_by(Official.name).limit(limit).all()
    return officials


@router.get("/{official_id:path}", response_model=OfficialDetailOut)
def get_official(official_id: str, db: Session = Depends(get_db)):
    official_id = unquote(official_id)
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
        office=official.office,
        district=official.district,
        current_member=bool(official.current_member),
        phone=official.phone,
        office_address=official.office_address,
        website_url=official.website_url,
        level=official.level or "federal",
        openstates_id=official.openstates_id,
        votes=[
            OfficialVoteOut(
                bill_id=bill.id,
                bill_title=bill.title,
                bill_summary=bill.summary,
                position=vote.position,
                sponsor_name=bill.sponsor_name,
            )
            for vote, bill in vote_rows
        ],
    )
