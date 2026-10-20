"""PAC gifts to an official (fec_client.py pacs), mounted under /api/officials.

Included before the officials router: its /{official_id:path} would
otherwise swallow these paths.
"""

from datetime import date
from typing import Literal, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from api.schemas import PacCategoryOut, PacGiftOut, PacListOut, PacOut, PacSummaryOut
from database import get_db
from models import Official, OfficialFinanceTotal, PacContribution, PacContributionSync
from services.finance_insights import PAC_CATEGORIES, PAC_CATEGORY_LABELS, share

router = APIRouter()

TOP_PACS = 10

_PAC_KEY = func.coalesce(PacContribution.contributor_committee_id, PacContribution.contributor_name)


def _election(db, official_id, fec_candidate_id, election_year):
    official_id = unquote(official_id)
    if db.get(Official, official_id) is None:
        raise HTTPException(status_code=404, detail="Official not found")
    row = db.get(OfficialFinanceTotal, (official_id, fec_candidate_id, election_year))
    if row is None:
        raise HTTPException(status_code=404, detail="Election not found")
    return row


def _gifts_in_election(db, election):
    """The election's gifts: its coverage start through the end of election year."""
    start = election.coverage_start_date or date(election.election_year - 1, 1, 1)
    return db.query(PacContribution).filter(
        PacContribution.official_id == election.official_id,
        PacContribution.fec_candidate_id == election.fec_candidate_id,
        PacContribution.receipt_date >= start,
        PacContribution.receipt_date <= date(election.election_year, 12, 31),
    )


def _pac_rows(query):
    """One row per PAC with combined totals; callers add filters and ordering."""
    total = func.sum(PacContribution.amount).label("total")
    return query.with_entities(
        _PAC_KEY.label("pac_key"),
        func.max(PacContribution.contributor_committee_id).label("committee_id"),
        func.max(PacContribution.contributor_name).label("name"),
        func.max(PacContribution.category).label("category"),
        total,
        func.count().label("gift_count"),
        func.min(PacContribution.receipt_date).label("first_date"),
        func.max(PacContribution.receipt_date).label("last_date"),
    ).group_by(_PAC_KEY), total


def _pac_out(row):
    return PacOut(
        pac_key=row.pac_key,
        committee_id=row.committee_id,
        name=row.name,
        category=row.category,
        category_label=PAC_CATEGORY_LABELS.get(row.category, row.category),
        total=float(row.total or 0),
        gift_count=row.gift_count,
        first_date=row.first_date,
        last_date=row.last_date,
    )


@router.get("/{official_id:path}/finance/pacs", response_model=PacSummaryOut)
def pac_summary(
    official_id: str,
    fec_candidate_id: str = Query(..., description="FEC candidate ID of the election."),
    election_year: int = Query(..., description="FEC candidate_election_year."),
    db: Session = Depends(get_db),
):
    election = _election(db, official_id, fec_candidate_id, election_year)
    gifts = _gifts_in_election(db, election)

    by_category = {
        row.category: row
        for row in gifts.with_entities(
            PacContribution.category,
            func.sum(PacContribution.amount).label("total"),
            func.count(func.distinct(_PAC_KEY)).label("pac_count"),
            func.count().label("gift_count"),
        ).group_by(PacContribution.category)
    }
    total = sum(float(row.total or 0) for row in by_category.values())
    categories = [
        PacCategoryOut(
            key=key,
            label=label,
            total=float(by_category[key].total or 0),
            share=share(by_category[key].total, total),
            pac_count=by_category[key].pac_count,
            gift_count=by_category[key].gift_count,
        )
        for key, label in PAC_CATEGORIES
        if key in by_category
    ]
    rows, total_column = _pac_rows(gifts)
    top = rows.order_by(desc(total_column), _PAC_KEY).limit(TOP_PACS).all()
    last_fetched_at = (
        db.query(func.max(PacContributionSync.fetched_at))
        .filter(PacContributionSync.official_id == election.official_id)
        .scalar()
    )
    return PacSummaryOut(
        official_id=election.official_id,
        fec_candidate_id=election.fec_candidate_id,
        election_year=election.election_year,
        total=round(total, 2),
        reported_total=float(election.pac_contributions) if election.pac_contributions is not None else None,
        itemized_through=gifts.with_entities(func.max(PacContribution.receipt_date)).scalar(),
        reported_through=election.coverage_end_date,
        gift_count=sum(row.gift_count for row in by_category.values()),
        pac_count=gifts.with_entities(func.count(func.distinct(_PAC_KEY))).scalar() or 0,
        categories=categories,
        top_pacs=[_pac_out(row) for row in top],
        synced=last_fetched_at is not None,
        last_fetched_at=last_fetched_at,
    )


@router.get("/{official_id:path}/finance/pacs/list", response_model=PacListOut)
def pac_list(
    official_id: str,
    fec_candidate_id: str = Query(...),
    election_year: int = Query(...),
    q: Optional[str] = Query(default=None, max_length=100, description="Substring of the PAC name."),
    category: Optional[str] = Query(default=None, description="One of the PAC category keys."),
    sort: Literal["amount", "name", "recent", "gifts"] = Query(default="amount"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    election = _election(db, official_id, fec_candidate_id, election_year)
    gifts = _gifts_in_election(db, election)
    if category:
        gifts = gifts.filter(PacContribution.category == category)
    rows, total_column = _pac_rows(gifts)
    if q and q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = rows.having(
            func.max(PacContribution.contributor_name).ilike(f"%{escaped}%", escape="\\")
        )
    total_count = rows.order_by(None).count()
    order = {
        "amount": (desc(total_column),),
        "name": (func.max(PacContribution.contributor_name),),
        "recent": (desc(func.max(PacContribution.receipt_date)),),
        "gifts": (desc(func.count()), desc(total_column)),
    }[sort]
    items = rows.order_by(*order, _PAC_KEY).offset(offset).limit(limit).all()
    return PacListOut(total_count=total_count, items=[_pac_out(row) for row in items])


@router.get("/{official_id:path}/finance/pacs/gifts", response_model=list[PacGiftOut])
def pac_gifts(
    official_id: str,
    fec_candidate_id: str = Query(...),
    election_year: int = Query(...),
    pac_key: str = Query(..., description="pac_key from the summary or list."),
    db: Session = Depends(get_db),
):
    election = _election(db, official_id, fec_candidate_id, election_year)
    gifts = (
        _gifts_in_election(db, election)
        .filter(_PAC_KEY == pac_key)
        .order_by(desc(PacContribution.receipt_date), PacContribution.sub_id)
        .all()
    )
    return [PacGiftOut.model_validate(gift) for gift in gifts]
