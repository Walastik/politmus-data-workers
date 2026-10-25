from collections import defaultdict
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, literal, nulls_first, nulls_last, or_
from sqlalchemy.orm import Session

from api.filters import classify_bipartisan_type, normalize_party
from api.schemas import (
    BillAmendmentOut,
    BillDetailOut,
    BillPageOut,
    BillSourceOut,
    BillVoterOut,
    BillVotersOut,
    RollCallOut,
)
from api.auth import get_current_user
from database import get_db
from models import Bill, BillAmendment, BillSource, Official, RollCall, Vote
from services.bill_classification import model_from_version
from services.vote_questions import VOTE_KIND_PASSAGE, vote_kind
from clerk_backend_api.security.types import RequestState

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


# Congress.gov bill types as they appear in bill IDs ("119-hjres-7").
BILL_TYPES = ("hr", "s", "hres", "sres", "hjres", "sjres", "hconres", "sconres")
# After lowercasing and dropping spaces, dots and hyphens: "H.R. 1" -> "hr1",
# "119-s-5" -> "119s5", "S. Con. Res. 3" -> "sconres3".
BILL_ID_QUERY_RE = re.compile(
    r"^(?P<congress>\d{2,3})?(?P<type>" + "|".join(BILL_TYPES) + r")(?P<number>\d+)$"
)


def parse_bill_id_query(q: str | None) -> tuple[str | None, str, str] | None:
    """(congress, type, number) when the search text is a bill number."""
    if not q:
        return None
    compact = re.sub(r"[\s.\-]", "", q.lower())
    match = BILL_ID_QUERY_RE.match(compact)
    if not match:
        return None
    return match["congress"], match["type"], str(int(match["number"]))


def _bill_search(q: str):
    """(filter, relevance) for the bills list search box.

    A bill number matches by ID. Anything else matches the weighted
    full-text document, or fuzzily (trigram word similarity, which also
    catches partial words while typing) the title or sponsor. A bare number
    also matches bill numbers.
    """
    parsed = parse_bill_id_query(q)
    if parsed:
        congress, bill_type, number = parsed
        if congress:
            return Bill.id == f"{congress}-{bill_type}-{number}", None
        return Bill.id.like(f"%-{bill_type}-{number}"), None

    tsquery = func.websearch_to_tsquery("english", q)
    term = literal(q)
    conditions = [
        Bill.search_vector.op("@@")(tsquery),
        term.op("<%")(Bill.title),
        term.op("<%")(Bill.sponsor_name),
    ]
    if q.isdigit():
        conditions.append(Bill.id.like(f"%-{int(q)}"))
    relevance = func.ts_rank_cd(Bill.search_vector, tsquery) + func.word_similarity(
        term, func.coalesce(Bill.title, "")
    )
    return or_(*conditions), relevance


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
        vote_kind=vote_kind(row.question),
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


def _tally_roll_call_for_chamber(
    roll_calls: list[RollCall], chamber: str
) -> RollCall | None:
    """The vote a chamber's tally shows: its latest vote on passage, else
    its latest vote of any kind. A later cloture or amendment vote would
    otherwise hide how the chamber voted on the bill itself.
    roll_calls must be newest first (_roll_calls_by_bill)."""
    wanted = chamber.strip().lower()
    rows = [row for row in roll_calls if (row.chamber or "").strip().lower() == wanted]
    passage = next((row for row in rows if vote_kind(row.question) == VOTE_KIND_PASSAGE), None)
    return passage or (rows[0] if rows else None)


def _tally_roll_call_ids(roll_calls: list[RollCall]) -> dict[str, int]:
    """One roll call per chamber so tallies are not mixed across votes."""
    out = {}
    for chamber in CHAMBERS:
        row = _tally_roll_call_for_chamber(roll_calls, chamber)
        if row is not None:
            out[chamber] = row.id
    return out


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
            _tally_roll_call_ids(roll_calls_by_bill.get(bill_id) or []).values()
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
        classification_metadata=bill.classification_metadata,
        classification_model=model_from_version(bill.classification_version),
        votes_summary=votes_summary or _empty_chamber_summaries(),
        votes_by_party=votes_by_party or _empty_party_summaries(),
        roll_calls=[_roll_call_out(row) for row in (roll_calls or [])],
        tally_roll_call_ids=_tally_roll_call_ids(roll_calls or []),
    )


@router.get("", response_model=BillPageOut)
def list_bills(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    level: Optional[str] = Query(
        default="federal",
        description="Bill level to list (federal or state). Omit all with level=all.",
    ),
    vote_status: Optional[str] = Query(None),
    pace: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sponsor_party: Optional[str] = Query(None),
    bipartisan: Optional[str] = Query(None),
    q: Optional[str] = Query(
        default=None,
        max_length=200,
        description="Bill number (H.R. 1, 119-s-5) or words from the title, sponsor, policy area or summary.",
    ),
    sort: Optional[str] = Query("voted_desc"),
    db: Session = Depends(get_db),
):
    query = db.query(Bill)
    relevance = None
    search = (q or "").strip()
    if search:
        search_filter, relevance = _bill_search(search)
        query = query.filter(search_filter)
    if level and level.strip().lower() not in {"all", "*"}:
        query = query.filter(Bill.level.ilike(level.strip()))

    if vote_status == "voted":
        query = query.filter(Bill.voted_date.isnot(None))
    elif vote_status == "pending":
        query = query.filter(Bill.voted_date.is_(None))
        
    if pace:
        query = query.filter(Bill.velocity_bucket == pace)
        
    if status:
        if status.lower() == "passed":
            query = query.filter(Bill.status.ilike("%passed%") | Bill.status.ilike("%became law%"))
        elif status.lower() == "failed":
            query = query.filter(Bill.status.ilike("%failed%") | Bill.status.ilike("%vetoed%"))
        else:
            query = query.filter(Bill.status.ilike(f"%{status}%"))
            
    if sponsor_party:
        query = query.filter(Bill.sponsor_party.ilike(f"{sponsor_party}%"))
        
    if bipartisan:
        query = query.filter(Bill.bipartisan_type == bipartisan)
        
    total = query.count()
        
    if sort == "relevance" and relevance is not None:
        query = query.order_by(desc(relevance), nulls_last(desc(Bill.voted_date)), desc(Bill.id))
    elif sort == "voted_desc":
        query = query.order_by(nulls_last(desc(Bill.voted_date)), desc(Bill.id))
    elif sort == "voted_asc":
        query = query.order_by(nulls_last(Bill.voted_date), desc(Bill.id))
    elif sort == "introduced_desc":
        query = query.order_by(nulls_last(desc(Bill.introduced_date)), desc(Bill.id))
    elif sort == "introduced_asc":
        query = query.order_by(nulls_last(Bill.introduced_date), desc(Bill.id))
    else:
        query = query.order_by(nulls_last(desc(Bill.voted_date)), desc(Bill.id))

    bills = query.offset(offset).limit(limit).all()
    bill_ids = [bill.id for bill in bills]
    roll_calls_by_bill = _roll_calls_by_bill(db, bill_ids)
    summaries, party_summaries = _vote_summaries(
        db, bill_ids, roll_calls_by_bill
    )
    items = [
        _bill_detail(
            bill,
            summaries.get(bill.id) or _empty_chamber_summaries(),
            party_summaries.get(bill.id) or _empty_party_summaries(),
            roll_calls_by_bill.get(bill.id) or [],
        )
        for bill in bills
    ]
    return BillPageOut(items=items, total=total)


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
    latest = _tally_roll_call_for_chamber(roll_calls, chamber)
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
    detail = _bill_detail(
        bill,
        summaries.get(bill_id) or _empty_chamber_summaries(),
        party_summaries.get(bill_id) or _empty_party_summaries(),
        roll_calls_by_bill.get(bill_id) or [],
    )
    amendments = (
        db.query(BillAmendment)
        .filter(BillAmendment.bill_id == bill_id)
        .order_by(nulls_last(desc(BillAmendment.submitted_date)), desc(BillAmendment.id))
        .all()
    )
    sources = (
        db.query(
            BillSource.id, BillSource.kind, BillSource.date, BillSource.chamber,
            BillSource.title, BillSource.speaker_name, BillSource.speaker_state,
            BillSource.speaker_party, func.array_length(func.regexp_split_to_array(BillSource.text, r"\s+"), 1),
            BillSource.url,
        )
        .filter(BillSource.bill_id == bill_id)
        .order_by(nulls_last(BillSource.date), BillSource.id)
        .all()
    )
    detail.amendments = [BillAmendmentOut.model_validate(row) for row in amendments]
    detail.sources = [
        BillSourceOut(
            id=row[0], kind=row[1], date=row[2], chamber=row[3], title=row[4],
            speaker_name=row[5], speaker_state=row[6], speaker_party=row[7],
            words=row[8] or 0, url=row[9],
        )
        for row in sources
    ]
    detail.documents = bill.documents
    detail.debate = bill.debate_metadata
    return detail
