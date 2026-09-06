from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.filters import normalize_party, normalize_state
from api.schemas import OfficialOut
from database import get_db
from models import Official

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


@router.get("/{official_id}", response_model=OfficialOut)
def get_official(official_id: str, db: Session = Depends(get_db)):
    official = db.query(Official).filter(Official.id == official_id).first()
    if not official:
        raise HTTPException(status_code=404, detail="Official not found")
    return official
