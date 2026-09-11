"""Bill velocity: days from introduction to a recorded vote, plus speed buckets."""

from __future__ import annotations

import statistics
from datetime import date

from sqlalchemy import or_

from models import Bill

VERY_FAST = "very_fast"
FAST = "fast"
AVERAGE = "average"
SLOW = "slow"
VERY_SLOW = "very_slow"

VELOCITY_BUCKETS = (VERY_FAST, FAST, AVERAGE, SLOW, VERY_SLOW)


def days_between(introduced: date | None, voted: date | None) -> int | None:
    """Calendar days from introduction to the recorded vote date."""
    if introduced is None or voted is None:
        return None
    return (voted - introduced).days


def distribution_params(values: list[int]) -> tuple[float, float] | None:
    """Population mean and standard deviation of vote delays.

    A single observation has σ = 0 so it lands in the average bucket.
    """
    if not values:
        return None
    mu = statistics.mean(values)
    sigma = statistics.pstdev(values) if len(values) > 1 else 0.0
    return mu, sigma


def velocity_bucket(days: int, mu: float, sigma: float) -> str:
    """Map a delay onto the five-tier bell-curve buckets.

    * Very fast: < μ − 1.5σ
    * Fast: [μ − 1.5σ, μ − 0.5σ)
    * Average: [μ − 0.5σ, μ + 0.5σ]
    * Slow: (μ + 0.5σ, μ + 1.5σ]
    * Very slow: > μ + 1.5σ
    """
    if sigma <= 0:
        return AVERAGE
    if days < mu - 1.5 * sigma:
        return VERY_FAST
    if days < mu - 0.5 * sigma:
        return FAST
    if days <= mu + 0.5 * sigma:
        return AVERAGE
    if days <= mu + 1.5 * sigma:
        return SLOW
    return VERY_SLOW


def score_vote_delays(
    rows: list[tuple[str, date | None, date | None]],
) -> tuple[list[tuple[str, int, str]], tuple[float, float] | None]:
    """Return (bill_id, days_to_vote, bucket) for every row with both dates."""
    delays: list[tuple[str, int]] = []
    for bill_id, introduced, voted in rows:
        days = days_between(introduced, voted)
        if days is None:
            continue
        delays.append((bill_id, days))

    params = distribution_params([days for _, days in delays])
    if params is None:
        return [], None

    mu, sigma = params
    scored = [
        (bill_id, days, velocity_bucket(days, mu, sigma))
        for bill_id, days in delays
    ]
    return scored, params


def vote_delay_query(session):
    """SQLAlchemy query for introduction-to-vote dates on bills that have both."""
    return session.query(Bill.id, Bill.introduced_date, Bill.voted_date).filter(
        Bill.introduced_date.isnot(None),
        Bill.voted_date.isnot(None),
    )


def refresh_bill_velocity(session) -> dict[str, int | float | None]:
    """Write `days_to_vote` and `velocity_bucket` from stored bill dates.

    The corpus mean and standard deviation are recomputed each run so buckets
    stay relative to the current set of voted bills.
    """
    session.flush()
    stats: dict[str, int | float | None] = {
        "bills_scored": 0,
        "days_to_vote_set": 0,
        "velocity_buckets_set": 0,
        "stale_cleared": 0,
        "mean": None,
        "std": None,
    }

    scored, params = score_vote_delays(vote_delay_query(session).all())
    if params is not None:
        stats["mean"], stats["std"] = params

    scored_ids = {bill_id for bill_id, _, _ in scored}
    if scored:
        bills_by_id = {
            bill.id: bill
            for bill in session.query(Bill).filter(Bill.id.in_(scored_ids)).all()
        }
        for bill_id, days, bucket in scored:
            bill = bills_by_id.get(bill_id)
            if bill is None:
                continue
            stats["bills_scored"] += 1
            if bill.days_to_vote != days:
                bill.days_to_vote = days
                stats["days_to_vote_set"] += 1
            if bill.velocity_bucket != bucket:
                bill.velocity_bucket = bucket
                stats["velocity_buckets_set"] += 1

    stale = session.query(Bill).filter(
        or_(Bill.days_to_vote.isnot(None), Bill.velocity_bucket.isnot(None)),
    )
    if scored_ids:
        stale = stale.filter(Bill.id.notin_(scored_ids))
    for bill in stale.all():
        bill.days_to_vote = None
        bill.velocity_bucket = None
        stats["stale_cleared"] += 1

    return stats
