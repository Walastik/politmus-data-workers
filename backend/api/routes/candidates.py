from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import tuple_
from sqlalchemy.orm import Session, load_only

from api.filters import STATE_ABBR_BY_NAME, STATE_NAME_BY_ABBR, normalize_party, normalize_state
from api.schemas import BallotNomineeOut, CandidateIssueOut, RaceCandidateOut, RaceOut, RacesPageOut
from database import get_db
from models import Candidacy, Official, OfficialFinanceTotal, OfficialPositionSync, OfficialStance
from services import ballot_nominees, candidate_races, finance_insights
from services.candidate_races import CANDIDATE_LEVEL, current_cycle

router = APIRouter()

OFFICE_ALIASES = {"S": "S", "SENATE": "S", "H": "H", "HOUSE": "H"}


def _office(value):
    if not value:
        return None
    office = OFFICE_ALIASES.get(value.strip().upper())
    if office is None:
        raise HTTPException(status_code=422, detail="office must be S (Senate) or H (House)")
    return office


def _state_abbr(value):
    name = normalize_state(value)
    if not name:
        return None
    return STATE_ABBR_BY_NAME.get(name.lower(), name.upper())


def _finance_by_key(db, candidacies):
    """official_finance_totals rows for these candidacies, keyed like the candidacy."""
    keys = [(c.fec_candidate_id, c.election_year) for c in candidacies]
    if not keys:
        return {}
    rows = (
        db.query(OfficialFinanceTotal)
        .filter(
            tuple_(OfficialFinanceTotal.fec_candidate_id, OfficialFinanceTotal.election_year).in_(keys)
        )
        .options(
            load_only(
                OfficialFinanceTotal.fec_candidate_id,
                OfficialFinanceTotal.election_year,
                OfficialFinanceTotal.individual_contributions,
                OfficialFinanceTotal.individual_unitemized,
                OfficialFinanceTotal.outside_spending,
            )
        )
        .all()
    )
    return {(row.fec_candidate_id, row.election_year): row for row in rows}


TOP_ISSUES = 3
EMPHASIS_RANK = {"high": 0, "medium": 1, "low": 2}
BACKGROUND_ITEMS = 3


def issues_by_official(db, official_ids):
    """Each official's headline issues: one per issue heading, most direct first."""
    if not official_ids:
        return {}
    stances = (
        db.query(OfficialStance)
        .filter(OfficialStance.official_id.in_(list(official_ids)))
        .options(
            load_only(
                OfficialStance.official_id,
                OfficialStance.issue_label,
                OfficialStance.policy_area,
                OfficialStance.summary,
                OfficialStance.source_url,
                OfficialStance.emphasis,
                OfficialStance.scope,
                OfficialStance.id,
            )
        )
        .all()
    )
    stances.sort(key=lambda s: (EMPHASIS_RANK.get(s.emphasis, 3), s.scope != "national", s.id))
    issues = defaultdict(list)
    for stance in stances:
        label = (stance.issue_label or stance.policy_area or "").strip()
        picked = issues[stance.official_id]
        if not label or len(picked) >= TOP_ISSUES or any(i.label.lower() == label.lower() for i in picked):
            continue
        picked.append(CandidateIssueOut(label=label, summary=stance.summary, source_url=stance.source_url))
    return issues


def background(official):
    """Offices held and occupations from Wikidata, e.g. ["Attorney General of Texas", "lawyer"]."""
    bio = official.bio or {}
    items = [p for p in bio.get("positions_held") or [] if p] + [o for o in bio.get("occupations") or [] if o]
    seen = []
    for item in items:
        if item.lower() not in (s.lower() for s in seen):
            seen.append(item)
    return seen[:BACKGROUND_ITEMS]


def _candidate_out(candidacy, official, positions_count, finance, on_ballot=None, issues=(), website=None):
    """on_ballot overrides the FEC filing flag when a hand-maintained ballot decides;
    website fills in when neither FEC nor Wikidata gave one."""
    outside = (finance.outside_spending if finance else None) or {}
    return RaceCandidateOut(
        official_id=official.id,
        fec_candidate_id=candidacy.fec_candidate_id,
        name=official.display_name,
        party=candidacy.party or official.party,
        photo_url=official.photo_url,
        website_url=official.website_url or website,
        incumbent_challenge=candidacy.incumbent_challenge,
        is_member=official.level != CANDIDATE_LEVEL,
        current_member=bool(official.current_member),
        in_general_election=candidacy.in_general_election if on_ballot is None else on_ballot,
        receipts=candidacy.receipts,
        disbursements=candidacy.disbursements,
        cash_on_hand=candidacy.cash_on_hand,
        coverage_end_date=candidacy.coverage_end_date,
        positions_count=positions_count,
        small_donor_share=finance_insights.small_donor_share(finance) if finance else None,
        outside_support=outside.get("support_total"),
        outside_oppose=outside.get("oppose_total"),
        background=background(official),
        wikipedia_url=official.wikipedia_url,
        top_issues=list(issues),
    )


def race_out(key, rows, finance_by_key, show_all=False, today=None, issues=None, ballots=None):
    """rows: (candidacy, official, positions_count) for everyone in the race.

    ballots: ballot_nominees.current_ballots(db); the committed ones if None.
    """
    year, state, office, district = key
    by_candidacy = {id(candidacy): (official, count) for candidacy, official, count in rows}
    candidacies = [candidacy for candidacy, _, _ in rows]
    ballot = ballot_nominees.ballot_for(year, state, office, district, ballots)
    nominee_ids = None
    websites = {}
    unlisted = []
    complete = False
    if ballot:
        nominees, ballot_source, complete = ballot
        nominee_ids = {n.fec_candidate_id for n in nominees if n.fec_candidate_id}
        websites = {n.fec_candidate_id: n.website for n in nominees if n.fec_candidate_id}
        # Campaigns that filed a pre-general report are on the ballot, unless
        # they're from a major party the list already has a nominee for: a
        # primary loser can keep filing (Cornyn). This picks up third parties
        # the source left out.
        listed_major = {n.party for n in nominees} & ballot_nominees.MAJOR_PARTIES
        nominee_ids |= {
            c.fec_candidate_id
            for c in candidacies
            if c.in_general_election and c.party not in listed_major
        }
        filed = {c.fec_candidate_id for c in candidacies}
        unlisted = [
            BallotNomineeOut(name=n.name, party=n.party)
            for n in nominees
            if n.fec_candidate_id not in filed
        ]
        shown = sorted(
            (c for c in candidacies if show_all or c.fec_candidate_id in nominee_ids),
            key=lambda c: c.receipts or 0,
            reverse=True,
        )
        filtered = not show_all
    else:
        ballot_source = None
        shown, filtered = candidate_races.visible_candidacies(candidacies, show_all=show_all, today=today)
    candidates = []
    for candidacy in shown:
        official, count = by_candidacy[id(candidacy)]
        finance = finance_by_key.get((candidacy.fec_candidate_id, candidacy.election_year))
        on_ballot = None if nominee_ids is None else candidacy.fec_candidate_id in nominee_ids
        candidates.append(
            _candidate_out(
                candidacy,
                official,
                count,
                finance,
                on_ballot,
                issues=(issues or {}).get(official.id, ()),
                website=websites.get(candidacy.fec_candidate_id),
            )
        )
    return RaceOut(
        key=f"{year}-{state}-{office}" + (f"-{district}" if office == "H" else ""),
        election_year=year,
        election_date=candidate_races.general_election_date(year),
        state=state,
        state_name=STATE_NAME_BY_ABBR.get(state, state),
        office=office,
        district=district,
        label=candidate_races.race_label(office, district),
        total_receipts=sum(float(c.receipts or 0) for c in shown),
        ballot_filtered=filtered,
        ballot_source=ballot_source,
        ballot_complete=complete,
        hidden_count=len(rows) - len(shown),
        candidates=candidates,
        unlisted_nominees=unlisted,
    )


def _race_rows(db, cycle, filters=()):
    return (
        db.query(Candidacy, Official, OfficialPositionSync.stances_saved)
        .join(Official, Official.id == Candidacy.official_id)
        .outerjoin(OfficialPositionSync, OfficialPositionSync.official_id == Official.id)
        .filter(Candidacy.election_year == cycle, *filters)
        .all()
    )


def race_for(db, candidacy, today=None):
    """The race one candidacy belongs to, as the races list shows it."""
    rows = _race_rows(
        db,
        candidacy.election_year,
        (
            Candidacy.state == candidacy.state,
            Candidacy.office == candidacy.office,
            Candidacy.district == candidacy.district,
        ),
    )
    return race_out(
        candidate_races.race_key(candidacy),
        rows,
        _finance_by_key(db, [c for c, _, _ in rows]),
        today=today,
        issues=issues_by_official(db, {o.id for _, o, _ in rows}),
        ballots=ballot_nominees.current_ballots(db),
    )


@router.get("/races", response_model=RacesPageOut)
def list_races(
    cycle: Optional[int] = Query(default=None, description="Election year (default: the next even year)."),
    state: Optional[str] = Query(default=None, description="Full state name or postal abbreviation."),
    office: Optional[str] = Query(default=None, description="S (Senate) or H (House)."),
    district: Optional[int] = Query(default=None, ge=0),
    party: Optional[str] = Query(default=None, description="Only races with a candidate of this party."),
    q: Optional[str] = Query(default=None, max_length=100, description="Only races with a candidate matching this name."),
    show_all: bool = Query(default=False, alias="all", description="Every filer, not just the ballot / funded ones."),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Races with their candidates, richest first. A state lists Senate then
    districts in order; nationwide lists the most expensive races first."""
    cycle = cycle or current_cycle()
    filters = []
    state_abbr = _state_abbr(state)
    if state_abbr:
        filters.append(Candidacy.state == state_abbr)
    office_code = _office(office)
    if office_code:
        filters.append(Candidacy.office == office_code)
    if district is not None:
        filters.append(Candidacy.district == district)
    rows = _race_rows(db, cycle, filters)

    by_race = defaultdict(list)
    for candidacy, official, count in rows:
        by_race[candidate_races.race_key(candidacy)].append((candidacy, official, count))

    # Name and party narrow which races come back, not who is in them.
    party_value = normalize_party(party)
    needle = (q or "").strip().lower()
    if party_value or needle:

        def wanted(race_rows):
            return any(
                (not party_value or (c.party or "").lower() == party_value.lower())
                and (not needle or needle in (o.display_name or "").lower() or needle in (o.name or "").lower())
                for c, o, _ in race_rows
            )

        by_race = {key: race_rows for key, race_rows in by_race.items() if wanted(race_rows)}

    today = date.today()
    finance_by_key = _finance_by_key(db, [c for race_rows in by_race.values() for c, _, _ in race_rows])
    issues = issues_by_official(db, {o.id for race_rows in by_race.values() for _, o, _ in race_rows})
    ballots = ballot_nominees.current_ballots(db)
    races = [
        race_out(key, race_rows, finance_by_key, show_all=show_all, today=today, issues=issues, ballots=ballots)
        for key, race_rows in by_race.items()
    ]
    races = [race for race in races if race.candidates or race.unlisted_nominees]
    if state_abbr:
        races.sort(key=lambda race: candidate_races.race_sort_key(
            (race.election_year, race.state, race.office, race.district)
        ))
    else:
        races.sort(key=lambda race: race.total_receipts, reverse=True)
    return RacesPageOut(total_count=len(races), items=races[offset:offset + limit])
