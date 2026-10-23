"""Group candidacies into races and decide who a race shows.

FEC never records primary results. Until the pre-general report deadline
(12 days before the election) has passed, a race shows everyone who raised
LIST_MIN_RECEIPTS; after it, only the campaigns that filed that report,
which are the ones on the general-election ballot.
"""

from datetime import date, timedelta
from decimal import Decimal

from api.filters import STATE_NAME_BY_ABBR

# Officials who are only running, not serving, have this level and the FEC
# candidate ID as their id.
CANDIDATE_LEVEL = "candidate"
LIST_MIN_RECEIPTS = Decimal("5000")
# Candidates below this keep their candidacy row (the "all filers" view) but
# get no finance detail or positions; there are a few thousand of them.
CANDIDATE_DETAIL_MIN_RECEIPTS = Decimal("50000")
PRE_GENERAL_DAYS_BEFORE = 12
# Late and amended pre-general reports keep arriving for a few days.
PRE_GENERAL_GRACE_DAYS = 5
OFFICE_ORDER = {"S": 0, "H": 1}


def current_cycle(today=None):
    today = today or date.today()
    return today.year + today.year % 2


def general_election_date(year):
    """The Tuesday after the first Monday in November."""
    first = date(year, 11, 1)
    first_monday = first + timedelta(days=(0 - first.weekday()) % 7)
    return first_monday + timedelta(days=1)


def ballot_known(year, today=None):
    """True once pre-general reports are in, so non-filers are off the ballot."""
    deadline = general_election_date(year) - timedelta(days=PRE_GENERAL_DAYS_BEFORE)
    return (today or date.today()) >= deadline + timedelta(days=PRE_GENERAL_GRACE_DAYS)


def race_key(candidacy):
    return (candidacy.election_year, candidacy.state, candidacy.office, candidacy.district or 0)


def race_label(office, district):
    if office == "S":
        return "U.S. Senate"
    if not district:
        return "U.S. House · At-large"
    return f"U.S. House · District {district}"


def race_sort_key(key):
    year, state, office, district = key
    return (STATE_NAME_BY_ABBR.get(state, state), OFFICE_ORDER.get(office, 9), district, -year)


def visible_candidacies(candidacies, show_all=False, today=None):
    """Who the race shows, richest first, and whether the ballot filter applied."""
    ranked = sorted(candidacies, key=lambda c: (c.receipts or 0), reverse=True)
    if show_all:
        return ranked, False
    if ranked and ballot_known(ranked[0].election_year, today) and any(
        c.in_general_election for c in ranked
    ):
        return [c for c in ranked if c.in_general_election], True
    return [
        c for c in ranked if c.in_general_election or (c.receipts or 0) >= LIST_MIN_RECEIPTS
    ], False
