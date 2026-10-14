from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, nulls_last
from sqlalchemy.orm import Session

from api.schemas import ExtractorVersionCountOut, PositionsProgressItemOut, PositionsProgressOut
from database import get_db
from models import Official, OfficialPositionSync, OfficialStance

router = APIRouter()

RECENT_LIMIT = 20
PROBLEMS_LIMIT = 50
PROBLEM_STATUSES = ("failed", "blocked", "needs_js")


def _population_filter():
    """Same population official_positions.select_officials walks."""
    return (
        Official.level == "federal",
        Official.current_member.is_(True),
        Official.website_url.isnot(None),
        Official.website_url != "",
    )


def _items(db: Session, *filters, limit: int) -> list[PositionsProgressItemOut]:
    rows = (
        db.query(Official, OfficialPositionSync)
        .join(OfficialPositionSync, OfficialPositionSync.official_id == Official.id)
        .filter(*_population_filter(), *filters)
        .order_by(nulls_last(desc(OfficialPositionSync.last_attempt_at)), Official.id)
        .limit(limit)
        .all()
    )
    return [
        PositionsProgressItemOut(
            official_id=official.id,
            name=official.name,
            state=official.state,
            party=official.party,
            office=official.office,
            district=official.district,
            status=sync.status,
            stances_saved=sync.stances_saved,
            pages_found=sync.pages_found,
            last_attempt_at=sync.last_attempt_at,
            last_error=sync.last_error,
        )
        for official, sync in rows
    ]


@router.get("/progress", response_model=PositionsProgressOut)
def positions_progress(db: Session = Depends(get_db)):
    """Backfill progress for the stated-positions worker.

    Every count covers only the worker's population: federal, current members
    with a website_url. Sync rows for anyone else (former members, state
    officials, a one-off --official-id run) are left out.
    """
    population = db.query(func.count(Official.id)).filter(*_population_filter()).scalar() or 0

    status_rows = (
        db.query(OfficialPositionSync.status, func.count())
        .join(Official, Official.id == OfficialPositionSync.official_id)
        .filter(*_population_filter())
        .group_by(OfficialPositionSync.status)
        .all()
    )
    by_status = {status: count for status, count in status_rows}
    attempted = sum(by_status.values())

    last_success_at = (
        db.query(func.max(OfficialPositionSync.last_success_at))
        .join(Official, Official.id == OfficialPositionSync.official_id)
        .filter(*_population_filter())
        .scalar()
    )

    version_rows = (
        db.query(OfficialPositionSync.extractor_version, func.count())
        .join(Official, Official.id == OfficialPositionSync.official_id)
        .filter(*_population_filter(), OfficialPositionSync.extractor_version.isnot(None))
        .group_by(OfficialPositionSync.extractor_version)
        .order_by(desc(func.count()))
        .all()
    )

    stances_total = (
        db.query(func.count(OfficialStance.id))
        .join(Official, Official.id == OfficialStance.official_id)
        .filter(*_population_filter())
        .scalar()
        or 0
    )

    return PositionsProgressOut(
        population=population,
        attempted=attempted,
        by_status=by_status,
        not_attempted=max(population - attempted, 0),
        stances_total=stances_total,
        last_success_at=last_success_at,
        current_versions=[
            ExtractorVersionCountOut(extractor_version=version, count=count)
            for version, count in version_rows
        ],
        recent=_items(db, limit=RECENT_LIMIT),
        problems=_items(
            db, OfficialPositionSync.status.in_(PROBLEM_STATUSES), limit=PROBLEMS_LIMIT
        ),
    )
