from collections import defaultdict
from datetime import date
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, desc, func, nulls_last, or_
from sqlalchemy.orm import Session, load_only

from api.filters import name_search_pattern, normalize_party, normalize_state
from api.routes.candidates import race_for
from api.schemas import (
    AccountabilityScoreOut,
    CandidacyOut,
    FinanceElectionOut,
    FinanceStateOut,
    FundingMixItemOut,
    OfficialBioOut,
    OfficialDetailOut,
    OfficialFinanceOut,
    OfficialOut,
    OfficialStanceOut,
    OfficialVoteOut,
    OutsideSpendingOut,
    PeerComparisonOut,
    PositionsSyncOut,
    VoteAlignmentOut,
)
from database import get_db
from models import (
    Bill,
    Candidacy,
    Official,
    OfficialFinanceTotal,
    OfficialPositionSync,
    OfficialScore,
    OfficialStance,
    RollCall,
    Vote,
    VoteAlignment,
)
from services import candidate_races, finance_insights
from services.candidate_races import CANDIDATE_LEVEL, current_cycle

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
    # LEFT JOINs for the positions worker status and the accountability
    # score; stances_saved stands in for the stance count so the list never
    # aggregates official_stances.
    query = (
        db.query(
            Official,
            OfficialPositionSync.status,
            OfficialPositionSync.stances_saved,
            OfficialScore,
        )
        .outerjoin(OfficialPositionSync, OfficialPositionSync.official_id == Official.id)
        .outerjoin(OfficialScore, OfficialScore.official_id == Official.id)
    )
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
            update={"positions_status": status, "positions_count": count, **score_fields(score)}
        )
        for official, status, count, score in rows
    ]


def score_fields(score: Optional[OfficialScore]) -> dict:
    if score is None:
        return {}
    return {
        "score_points": score.points,
        "score_pct": score.alignment_pct,
        "score_matches": score.aligned + score.conflicting,
    }


def _finance_election_out(row):
    sizes = row.size_breakdown or []
    states = row.state_breakdown or {}
    small = next((bucket["total"] for bucket in sizes if bucket["size"] == 0), None)
    mix = finance_insights.funding_mix(row)
    return FinanceElectionOut.model_validate(row).model_copy(
        update={
            "small_dollar_share": finance_insights.share(
                small, sum(bucket["total"] for bucket in sizes)
            ),
            "small_donor_share": finance_insights.small_donor_share(row),
            "pac_share": finance_insights.pac_share(row),
            "funding_mix": [FundingMixItemOut(**item) for item in mix] if mix else None,
            "home_state": states.get("home_state"),
            "in_state_share": finance_insights.in_state_share(row),
            "top_states": [FinanceStateOut(**state) for state in states.get("top_states") or []]
            or None,
            "outside_spending": (
                OutsideSpendingOut(**row.outside_spending) if row.outside_spending else None
            ),
        }
    )


def _peer_comparison(db, official):
    """Compare with current federal members' finished elections."""
    if not official.current_member or (official.level or "federal") != "federal":
        return None
    today = date.today()
    peers = (
        db.query(Official)
        .filter(Official.current_member.is_(True), Official.level == "federal")
        .options(load_only(Official.id, Official.office, Official.party))
        .all()
    )
    rows = (
        db.query(OfficialFinanceTotal)
        .join(Official, Official.id == OfficialFinanceTotal.official_id)
        .filter(
            Official.current_member.is_(True),
            Official.level == "federal",
            OfficialFinanceTotal.election_year < today.year,
        )
        .options(
            load_only(
                OfficialFinanceTotal.official_id,
                OfficialFinanceTotal.fec_candidate_id,
                OfficialFinanceTotal.election_year,
                OfficialFinanceTotal.receipts,
                OfficialFinanceTotal.individual_contributions,
                OfficialFinanceTotal.individual_unitemized,
                OfficialFinanceTotal.pac_contributions,
                OfficialFinanceTotal.state_breakdown,
            )
        )
        .all()
    )
    rows_by_official = defaultdict(list)
    for row in rows:
        rows_by_official[row.official_id].append(row)
    comparison = finance_insights.peer_comparison(
        official,
        rows_by_official,
        {peer.id: peer for peer in peers},
        today=today,
    )
    return PeerComparisonOut(**comparison) if comparison else None


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
        peer_comparison=_peer_comparison(db, official),
        race_comparison=_race_comparison(db, official),
    )


def _race_comparison(db, official):
    """This cycle's race, preferring one the official is on the ballot for."""
    candidacies = (
        db.query(Candidacy)
        .filter(Candidacy.official_id == official.id, Candidacy.election_year == current_cycle())
        .order_by(Candidacy.in_general_election.desc(), Candidacy.receipts.desc().nulls_last())
        .all()
    )
    return race_for(db, candidacies[0]) if candidacies else None


def _candidacy_out(candidacy):
    return CandidacyOut.model_validate(candidacy).model_copy(
        update={
            "race_label": candidate_races.race_label(candidacy.office, candidacy.district),
            "election_date": candidate_races.general_election_date(candidacy.election_year),
        }
    )


@router.get("/{official_id:path}", response_model=OfficialDetailOut)
def get_official(official_id: str, db: Session = Depends(get_db)):
    official_id = unquote(official_id)
    official = db.query(Official).filter(Official.id == official_id).first()
    if not official:
        raise HTTPException(status_code=404, detail="Official not found")

    # Candidates have no voting record to look up.
    vote_rows = [] if official.level == CANDIDATE_LEVEL else (
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
    score = db.get(OfficialScore, official_id)
    alignment_rows = (
        db.query(VoteAlignment, Bill.title)
        .join(Bill, Bill.id == VoteAlignment.bill_id)
        .filter(VoteAlignment.official_id == official_id)
        .order_by(
            nulls_last(desc(VoteAlignment.vote_date)),
            VoteAlignment.bill_id,
            VoteAlignment.target_name,
        )
        .all()
    )
    candidacies = (
        db.query(Candidacy)
        .filter(Candidacy.official_id == official_id)
        .order_by(desc(Candidacy.election_year), Candidacy.in_general_election.desc())
        .all()
    )

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
        photo_url=official.photo_url,
        photo_attribution=official.photo_attribution,
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
        **score_fields(score),
        accountability=AccountabilityScoreOut.model_validate(score) if score else None,
        alignments=[
            VoteAlignmentOut.model_validate(alignment).model_copy(update={"bill_title": title})
            for alignment, title in alignment_rows
        ],
        wikipedia_url=official.wikipedia_url,
        bio=OfficialBioOut(**official.bio) if official.bio else None,
        candidacies=[_candidacy_out(candidacy) for candidacy in candidacies],
    )
