"""Campaign finance for federal officials from the OpenFEC API.

crosswalk: load bioguide -> FEC candidate IDs (and OpenSecrets IDs) from
    unitedstates/congress-legislators onto officials.
totals: fetch per-election totals for each current member, plus donation-size
    and donor-state breakdowns for their most recent elections.
"""

import argparse
import os
import time
from datetime import date, datetime, timezone
from decimal import Decimal

import requests

from api.filters import STATE_ABBR_BY_NAME
from config import FEC_API_KEY
from congress_client import INITIAL_BACKOFF_SECONDS, MAX_RETRIES, _retry_wait_seconds
from database import SessionLocal
from init_db import ensure_schema
from models import Official, OfficialFinanceTotal

BASE_URL = "https://api.open.fec.gov/v1"
CROSSWALK_URL = (
    "https://unitedstates.github.io/congress-legislators/legislators-current.json"
)
API_KEY = FEC_API_KEY or "DEMO_KEY"
# api.data.gov keys allow 1,000 requests an hour; 3.6s keeps a run under that.
REQUEST_PAUSE_SECONDS = float(os.getenv("FEC_REQUEST_PAUSE_SECONDS", "3.6"))
RATE_LIMIT_BACKOFF_SECONDS = 120.0
# A key that is out of requests gets Retry-After in hours; stop instead of sleeping.
MAX_RATE_LIMIT_WAIT_SECONDS = 600.0
# Size and state breakdowns cost two extra calls each, so only the latest
# elections get them (the one in progress and the last one decided).
BREAKDOWN_ELECTIONS = 2
TOP_STATES = 5

# FEC column -> OfficialFinanceTotal column.
TOTALS_FIELDS = {
    "receipts": "receipts",
    "contributions": "contributions",
    "individual_contributions": "individual_contributions",
    "individual_itemized_contributions": "individual_itemized",
    "individual_unitemized_contributions": "individual_unitemized",
    "other_political_committee_contributions": "pac_contributions",
    "political_party_committee_contributions": "party_contributions",
    "candidate_contribution": "candidate_contributions",
    "loans_made_by_candidate": "candidate_loans",
    "disbursements": "disbursements",
    "last_cash_on_hand_end_period": "cash_on_hand",
    "last_debts_owed_by_committee": "debts",
}


class RateLimited(RuntimeError):
    """OpenFEC asked us to wait longer than MAX_RATE_LIMIT_WAIT_SECONDS."""


def fec_get(path, params=None):
    """GET JSON from OpenFEC with pacing and 429/5xx backoff."""
    url = BASE_URL + path
    query = {"api_key": API_KEY}
    if params:
        query.update(params)

    delay = INITIAL_BACKOFF_SECONDS
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_PAUSE_SECONDS)
        try:
            response = requests.get(url, params=query, timeout=30)
        except requests.RequestException as exc:
            last_error = exc
            print(f"  Request error ({exc}); retrying in {delay:.1f}s...")
            time.sleep(delay)
            delay *= 2
            continue

        if response.status_code == 429 or response.status_code >= 500:
            # api.data.gov blocks an over-limit key for up to an hour, so a
            # 429 waits minutes rather than seconds.
            if response.status_code == 429:
                fallback = RATE_LIMIT_BACKOFF_SECONDS * attempt
            else:
                fallback = delay
            wait = _retry_wait_seconds(response, fallback)
            if wait > MAX_RATE_LIMIT_WAIT_SECONDS:
                raise RateLimited(
                    f"OpenFEC rate limit reached; Retry-After is {wait / 60:.0f} minutes"
                )
            print(
                f"  HTTP {response.status_code} from OpenFEC; "
                f"retrying in {wait:.1f}s (attempt {attempt}/{MAX_RETRIES})..."
            )
            time.sleep(wait)
            delay *= 2
            last_error = requests.HTTPError(
                f"{response.status_code} for {url}", response=response
            )
            continue

        response.raise_for_status()
        return response.json()

    if last_error:
        raise last_error


def crosswalk_ids(legislators):
    """Map bioguide -> (FEC candidate IDs, OpenSecrets ID) from congress-legislators."""
    ids_by_bioguide = {}
    for legislator in legislators:
        ids = legislator.get("id") or {}
        bioguide = ids.get("bioguide")
        if not bioguide:
            continue
        ids_by_bioguide[bioguide] = (list(ids.get("fec") or []), ids.get("opensecrets"))
    return ids_by_bioguide


def apply_crosswalk(session, legislators):
    ids_by_bioguide = crosswalk_ids(legislators)
    stats = {"legislators": len(ids_by_bioguide), "updated": 0, "not_in_officials": 0}
    for bioguide, (fec_ids, opensecrets_id) in ids_by_bioguide.items():
        official = session.get(Official, bioguide)
        if official is None:
            stats["not_in_officials"] += 1
            continue
        official.fec_candidate_ids = fec_ids or None
        official.opensecrets_id = opensecrets_id
        stats["updated"] += 1
    return stats


def run_crosswalk():
    ensure_schema()
    response = requests.get(CROSSWALK_URL, timeout=60)
    response.raise_for_status()
    session = SessionLocal()
    try:
        stats = apply_crosswalk(session, response.json())
        session.commit()
    finally:
        session.close()
    print(
        f"Crosswalk: {stats['updated']} officials updated from "
        f"{stats['legislators']} legislators "
        f"({stats['not_in_officials']} not in officials)."
    )
    return stats


def fec_ids_for_office(fec_ids, office):
    """Candidate IDs for the seat the official holds now.

    FEC IDs start with the office sought: S (Senate), H (House, including
    delegates and the resident commissioner) or P (President).
    """
    prefix = "S" if (office or "").strip().lower() == "senator" else "H"
    return [fec_id for fec_id in fec_ids or [] if fec_id.upper().startswith(prefix)]


def _money(value):
    if value is None:
        return None
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _date(value):
    if not value:
        return None
    return date.fromisoformat(str(value)[:10])


def totals_values(result):
    """OfficialFinanceTotal column values from one /candidate/{id}/totals/ row."""
    values = {column: _money(result.get(field)) for field, column in TOTALS_FIELDS.items()}
    values["coverage_start_date"] = _date(result.get("coverage_start_date"))
    values["coverage_end_date"] = _date(result.get("coverage_end_date"))
    return values


def size_breakdown(results):
    return sorted(
        (
            {
                "size": row["size"],
                "total": float(row.get("total") or 0),
                "count": row.get("count"),
            }
            for row in results
            if row.get("size") is not None
        ),
        key=lambda row: row["size"],
    )


def state_breakdown(results, home_state):
    """In-state vs. out-of-state itemized giving, plus the top donor states."""
    rows = [
        {
            "state": row.get("state"),
            "total": float(row.get("total") or 0),
            "count": row.get("count"),
        }
        for row in results
        if row.get("state")
    ]
    total = sum(row["total"] for row in rows)
    in_state = None
    out_of_state = None
    if home_state:
        in_state = sum(row["total"] for row in rows if row["state"] == home_state)
        out_of_state = total - in_state
    rows.sort(key=lambda row: row["total"], reverse=True)
    return {
        "home_state": home_state,
        "in_state": in_state,
        "out_of_state": out_of_state,
        "total": total,
        "top_states": rows[:TOP_STATES],
    }


def _home_state_abbr(state):
    if not state:
        return None
    state = state.strip()
    if len(state) == 2:
        return state.upper()
    return STATE_ABBR_BY_NAME.get(state.lower())


def fetch_totals(fec_id):
    payload = fec_get(
        f"/candidate/{fec_id}/totals/",
        params={"election_full": "true", "per_page": 100, "sort": "-candidate_election_year"},
    )
    return [row for row in payload.get("results") or [] if row.get("candidate_election_year")]


def fetch_breakdowns(fec_id, election_year, home_state):
    params = {
        "candidate_id": fec_id,
        "cycle": election_year,
        "election_full": "true",
        "per_page": 100,
    }
    sizes = fec_get("/schedules/schedule_a/by_size/by_candidate/", params=params)
    states = fec_get("/schedules/schedule_a/by_state/by_candidate/", params=params)
    return (
        size_breakdown(sizes.get("results") or []),
        state_breakdown(states.get("results") or [], home_state),
    )


def sync_official_finance(session, official):
    """Upsert totals for one official; refresh breakdowns that are out of date."""
    stats = {"elections": 0, "breakdowns": 0}
    fec_ids = fec_ids_for_office(official.fec_candidate_ids, official.office)
    home_state = _home_state_abbr(official.state)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    rows = []
    for fec_id in fec_ids:
        for result in fetch_totals(fec_id):
            key = (official.id, fec_id, int(result["candidate_election_year"]))
            row = session.get(OfficialFinanceTotal, key)
            if row is None:
                row = OfficialFinanceTotal(
                    official_id=key[0], fec_candidate_id=key[1], election_year=key[2]
                )
                session.add(row)
            for column, value in totals_values(result).items():
                setattr(row, column, value)
            row.fetched_at = now
            rows.append(row)
    stats["elections"] = len(rows)

    rows.sort(key=lambda row: row.election_year, reverse=True)
    for row in rows[:BREAKDOWN_ELECTIONS]:
        if not row.receipts:
            continue
        if row.size_breakdown is not None and row.breakdown_coverage_end_date == row.coverage_end_date:
            continue
        row.size_breakdown, row.state_breakdown = fetch_breakdowns(
            row.fec_candidate_id, row.election_year, home_state
        )
        row.breakdown_coverage_end_date = row.coverage_end_date
        stats["breakdowns"] += 1
    return stats


def run_totals(official_id=None, limit=None):
    ensure_schema()
    if not FEC_API_KEY:
        print("WARNING: FEC_API_KEY is not set; using DEMO_KEY, which allows only a handful of requests.")
    session = SessionLocal()
    try:
        query = session.query(Official).filter(Official.fec_candidate_ids.isnot(None))
        if official_id:
            query = query.filter(Official.id == official_id)
        else:
            query = query.filter(
                Official.current_member.is_(True), Official.level == "federal"
            )
        officials = query.order_by(Official.id).all()
        if limit:
            officials = officials[:limit]
        if not officials:
            print("No officials with FEC IDs. Run `python fec_client.py crosswalk` first.")
            return

        synced = failed = 0
        for index, official in enumerate(officials, start=1):
            print(f"[{index}/{len(officials)}] {official.id} {official.display_name}")
            try:
                stats = sync_official_finance(session, official)
                session.commit()
            except RateLimited as exc:
                session.rollback()
                print(f"  {exc}. Stopping; re-run later to continue.")
                break
            except Exception as exc:
                session.rollback()
                failed += 1
                print(f"  Failed: {exc}")
                continue
            synced += 1
            print(f"  {stats['elections']} elections, {stats['breakdowns']} breakdowns refreshed")
        print(f"Done: {synced} synced, {failed} failed, {len(officials)} selected.")
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(description="Campaign finance from OpenFEC.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "crosswalk",
        help="Load FEC and OpenSecrets IDs onto officials from congress-legislators.",
    )
    totals = subparsers.add_parser(
        "totals",
        help="Fetch campaign totals and breakdowns for current federal officials.",
    )
    totals.add_argument("--official-id", help="Only this bioguide ID (current or not).")
    totals.add_argument("--limit", type=int, help="Stop after this many officials.")
    args = parser.parse_args()

    if args.command == "crosswalk":
        run_crosswalk()
    elif args.command == "totals":
        run_totals(official_id=args.official_id, limit=args.limit)


if __name__ == "__main__":
    main()
