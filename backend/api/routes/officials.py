from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, desc, func, nulls_last, or_
from sqlalchemy.orm import Session

from api.filters import name_search_pattern, normalize_party, normalize_state
from api.schemas import (
    FinanceElectionOut,
    FinanceStateOut,
    OfficialDetailOut,
    OfficialFinanceOut,
    OfficialOut,
    OfficialStanceOut,
    OfficialVoteOut,
    PositionsSyncOut,
)
from database import get_db
from models import (
    Bill,
    Official,
    OfficialFinanceTotal,
    OfficialPositionSync,
    OfficialStance,
    RollCall,
    Vote,
)

router = APIRouter()

# high -> medium -> low -> unset
_EMPHASIS_ORDER = case(
    {"high": 0, "medium": 1, "low": 2},
    value=OfficialStance.emphasis,
    else_=3,
)


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
        description="Case-insensitive substring match on the stored name or first/last name.",
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
    # One LEFT JOIN for the positions worker status; stances_saved stands in
    # for the stance count so the list never aggregates official_stances.
    query = db.query(
        Official, OfficialPositionSync.status, OfficialPositionSync.stances_saved
    ).outerjoin(OfficialPositionSync, OfficialPositionSync.official_id == Official.id)
    party_value = normalize_party(party)
    state_value = normalize_state(state)
    name_pattern = name_search_pattern(q)
    if party_value:
        query = query.filter(Official.party.ilike(party_value))
    if state_value:
        query = query.filter(Official.state.ilike(state_value))
    if name_pattern:
        # The stored name, plus first-name-first forms with and without the
        # middle name, so "Alma Adams" and "Alma S. Adams" both match.
        searchable = (
            Official.name,
            func.concat_ws(" ", Official.first_name, Official.middle_name, Official.last_name),
            func.concat_ws(" ", Official.first_name, Official.last_name),
        )
        query = query.filter(
            or_(*(column.ilike(name_pattern, escape="\\") for column in searchable))
        )
    if current_member is not None:
        query = query.filter(Official.current_member.is_(current_member))
    if level:
        query = query.filter(Official.level.ilike(level.strip()))

    rows = query.order_by(Official.name).limit(limit).all()
    return [
        OfficialOut.model_validate(official).model_copy(
            update={"positions_status": status, "positions_count": count}
        )
        for official, status, count in rows
    ]


def _share(part, whole):
    if part is None or not whole:
        return None
    return round(part / whole, 4)


def _finance_election_out(row):
    sizes = row.size_breakdown or []
    states = row.state_breakdown or {}
    small = next((bucket["total"] for bucket in sizes if bucket["size"] == 0), None)
    return FinanceElectionOut.model_validate(row).model_copy(
        update={
            "small_dollar_share": _share(small, sum(bucket["total"] for bucket in sizes)),
            "in_state_share": _share(states.get("in_state"), states.get("total")),
            "top_states": [FinanceStateOut(**state) for state in states.get("top_states") or []]
            or None,
        }
    )


# Registered before get_official: its {official_id:path} would swallow /finance.
@router.get("/{official_id:path}/finance", response_model=OfficialFinanceOut)
def get_official_finance(official_id: str, db: Session = Depends(get_db)):
    official_id = unquote(official_id)
    official = db.get(Official, official_id)
    if not official:
        raise HTTPException(status_code=404, detail="Official not found")

    rows = (
        db.query(OfficialFinanceTotal)
        .filter(OfficialFinanceTotal.official_id == official_id)
        .order_by(
            desc(OfficialFinanceTotal.election_year),
            OfficialFinanceTotal.fec_candidate_id,
        )
        .all()
    )
    return OfficialFinanceOut(
        official_id=official.id,
        fec_candidate_ids=official.fec_candidate_ids or [],
        opensecrets_id=official.opensecrets_id,
        opensecrets_url=(
            f"https://www.opensecrets.org/members-of-congress/summary?cid={official.opensecrets_id}"
            if official.opensecrets_id
            else None
        ),
        elections=[_finance_election_out(row) for row in rows],
    )


@router.get("/{official_id:path}", response_model=OfficialDetailOut)
def get_official(official_id: str, db: Session = Depends(get_db)):
    official_id = unquote(official_id)
    official = db.query(Official).filter(Official.id == official_id).first()
    if not official:
        raise HTTPException(status_code=404, detail="Official not found")

    vote_rows = (
        db.query(Vote, Bill, RollCall)
        .join(RollCall, RollCall.id == Vote.roll_call_id)
        .join(Bill, Bill.id == RollCall.bill_id)
        .filter(Vote.official_id == official_id)
        .order_by(nulls_last(desc(RollCall.date)), desc(RollCall.id))
        .all()
    )

    stances = (
        db.query(OfficialStance)
        .filter(OfficialStance.official_id == official_id)
        .order_by(
            _EMPHASIS_ORDER,
            nulls_last(OfficialStance.policy_area),
            OfficialStance.target_name,
        )
        .all()
    )
    sync = db.get(OfficialPositionSync, official_id)

    return OfficialDetailOut(
        id=official.id,
        name=official.name,
        display_name=official.display_name,
        first_name=official.first_name,
        middle_name=official.middle_name,
        last_name=official.last_name,
        suffix_name=official.suffix_name,
        nickname=official.nickname,
        honorific_name=official.honorific_name,
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
                roll_call_id=roll_call.id,
                chamber=roll_call.chamber,
                question=roll_call.question,
                result=roll_call.result,
                date=roll_call.date,
            )
            for vote, bill, roll_call in vote_rows
        ],
        stated_positions=[OfficialStanceOut.model_validate(s) for s in stances],
        positions_sync=PositionsSyncOut.model_validate(sync) if sync else None,
    )
