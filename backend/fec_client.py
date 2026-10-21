"""Campaign finance for federal officials from the OpenFEC API.

crosswalk: load bioguide -> FEC candidate IDs (and OpenSecrets IDs) from
    unitedstates/congress-legislators onto officials.
totals: fetch per-election totals for each current member, plus donation-size
    and donor-state breakdowns for their most recent elections.
pacs: fetch every itemized PAC gift (Form 3 line 11C) for those elections.
    Needs `totals` first; time-boxed and resumable.
"""

import argparse
import os
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import requests

from api.filters import STATE_ABBR_BY_NAME
from config import FEC_API_KEY
from congress_client import INITIAL_BACKOFF_SECONDS, MAX_RETRIES, _retry_wait_seconds
from database import SessionLocal
from init_db import ensure_schema
from sqlalchemy import func

from models import Official, OfficialFinanceTotal, PacContribution, PacContributionSync
from services.finance_insights import election_periods, is_completed, pac_category

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
TOP_OUTSIDE_SPENDERS = 5
# A two-year period of PAC gifts is a few hundred rows; the cap only guards
# against a pagination loop.
PAC_MAX_PAGES = 100
# FEC processes itemized receipts weeks after a report's totals appear. Until
# the gifts reach within PAC_CAUGHT_UP_DAYS of the coverage date, the current
# period re-fetches each run, for at most PAC_PROCESSING_DAYS.
PAC_CAUGHT_UP_DAYS = 30
PAC_PROCESSING_DAYS = 90
# Campaign committees whose Schedule A holds the candidate's receipts.
CAMPAIGN_COMMITTEE_DESIGNATIONS = {"P", "A"}
# by_candidate aggregates one row per spender and side; a big race can need
# a few pages.
OUTSIDE_SPENDING_MAX_PAGES = 5

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
    "transfers_from_other_authorized_committee": "joint_fundraising_transfers",
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


def outside_spending_summary(results):
    """Support/oppose totals and top spenders from Schedule E by_candidate rows."""
    sides = {"S": {}, "O": {}}
    for row in results:
        side = sides.get(row.get("support_oppose_indicator"))
        if side is None:
            continue
        key = row.get("committee_id") or row.get("committee_name")
        spender = side.setdefault(
            key,
            {"committee_id": row.get("committee_id"), "name": row.get("committee_name"), "total": 0.0},
        )
        spender["total"] += float(row.get("total") or 0)

    summary = {}
    for code, name in (("S", "support"), ("O", "oppose")):
        spenders = sorted(sides[code].values(), key=lambda s: s["total"], reverse=True)
        for spender in spenders:
            spender["total"] = round(spender["total"], 2)
        summary[f"{name}_total"] = round(sum(s["total"] for s in spenders), 2)
        summary[f"{name}_count"] = len(spenders)
        summary[f"top_{name}"] = spenders[:TOP_OUTSIDE_SPENDERS]
    return summary


def fetch_outside_spending(fec_id, election_year):
    results = []
    for page in range(1, OUTSIDE_SPENDING_MAX_PAGES + 1):
        payload = fec_get(
            "/schedules/schedule_e/by_candidate/",
            params={
                "candidate_id": fec_id,
                "cycle": election_year,
                "election_full": "true",
                "per_page": 100,
                "page": page,
            },
        )
        results.extend(payload.get("results") or [])
        pages = (payload.get("pagination") or {}).get("pages") or 1
        if page >= pages:
            break
    return outside_spending_summary(results)


def outside_spending_due(row, today=None):
    """Groups can spend any time, so a race still under way refreshes every run;
    a finished one is fetched once."""
    if row.outside_spending is None:
        return True
    return not is_completed(row.election_year, today)


def sync_official_finance(session, official, today=None):
    """Upsert totals for one official; refresh breakdowns that are out of date."""
    stats = {"elections": 0, "breakdowns": 0, "outside_spending": 0}
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
        if outside_spending_due(row, today):
            row.outside_spending = fetch_outside_spending(row.fec_candidate_id, row.election_year)
            row.outside_spending_fetched_at = now
            stats["outside_spending"] += 1
        if row.size_breakdown is not None and row.breakdown_coverage_end_date == row.coverage_end_date:
            continue
        row.size_breakdown, row.state_breakdown = fetch_breakdowns(
            row.fec_candidate_id, row.election_year, home_state
        )
        row.breakdown_coverage_end_date = row.coverage_end_date
        stats["breakdowns"] += 1
    return stats


def fetch_committees(fec_id):
    payload = fec_get(f"/candidate/{fec_id}/committees/", params={"per_page": 100})
    return [
        {
            "committee_id": row["committee_id"],
            "designation": row.get("designation"),
            "cycles": row.get("cycles") or [],
        }
        for row in payload.get("results") or []
        if row.get("designation") in CAMPAIGN_COMMITTEE_DESIGNATIONS
    ]


def committees_for_period(committees, period):
    return [c["committee_id"] for c in committees or [] if period in (c.get("cycles") or [])]


def pac_contribution_values(result):
    """PacContribution columns for one line 11C row; None for memo entries."""
    if (result.get("memo_code") or "").upper() == "X" or not result.get("sub_id"):
        return None
    contributor = result.get("contributor") or {}
    committee_type = contributor.get("committee_type")
    organization_type = contributor.get("organization_type")
    designation = contributor.get("designation")
    return {
        "sub_id": str(result["sub_id"]),
        "contributor_committee_id": result.get("contributor_id") or contributor.get("committee_id"),
        "contributor_name": contributor.get("name") or result.get("contributor_name"),
        "amount": _money(result.get("contribution_receipt_amount")) or Decimal("0.00"),
        "receipt_date": _date(result.get("contribution_receipt_date")),
        "category": pac_category(committee_type, organization_type, designation),
        "committee_type": committee_type,
        "organization_type": organization_type,
        "designation": designation,
        "pdf_url": result.get("pdf_url"),
    }


def fetch_pac_contributions(committee_id, period):
    """Every line 11C row for one committee and period, following FEC's keyset pages."""
    params = {
        "committee_id": committee_id,
        "two_year_transaction_period": period,
        "line_number": "F3-11C",
        "per_page": 100,
        "sort": "contribution_receipt_date",
    }
    results = []
    for _ in range(PAC_MAX_PAGES):
        payload = fec_get("/schedules/schedule_a/", params=params)
        page = payload.get("results") or []
        results.extend(page)
        last_indexes = (payload.get("pagination") or {}).get("last_indexes")
        if len(page) < params["per_page"] or not last_indexes:
            break
        params = {**params, **last_indexes}
    return results


def pac_sync_due(sync, period, coverage_end_date, today=None):
    """A missing period is due. A finished period is re-fetched once if it was
    last fetched while still open. The current one is due when new filings
    arrive, and again each run while FEC is still processing their gifts."""
    if sync is None:
        return True
    today = today or date.today()
    current_period = today.year + (today.year % 2)
    if period < current_period:
        return sync.fetched_at.date() <= date(period, 12, 31)
    if sync.coverage_end_date != coverage_end_date:
        return True
    if coverage_end_date is None:
        return False
    caught_up = sync.latest_receipt_date is not None and (
        sync.latest_receipt_date >= coverage_end_date - timedelta(days=PAC_CAUGHT_UP_DAYS)
    )
    return not caught_up and today <= coverage_end_date + timedelta(days=PAC_PROCESSING_DAYS)


def pac_targets(session, official, today=None):
    """(fec_id, period, coverage_end_date) for the official's recent elections."""
    fec_ids = fec_ids_for_office(official.fec_candidate_ids, official.office)
    rows = (
        session.query(OfficialFinanceTotal)
        .filter(
            OfficialFinanceTotal.official_id == official.id,
            OfficialFinanceTotal.fec_candidate_id.in_(fec_ids or [""]),
            OfficialFinanceTotal.receipts > 0,
        )
        .order_by(OfficialFinanceTotal.election_year.desc())
        .limit(BREAKDOWN_ELECTIONS)
        .all()
    )
    targets = {}
    for row in rows:
        for period in election_periods(row.coverage_start_date, row.election_year, today):
            key = (row.fec_candidate_id, period)
            end = row.coverage_end_date
            if key not in targets or (end and (targets[key] is None or end > targets[key])):
                targets[key] = end
    return [(fec_id, period, end) for (fec_id, period), end in sorted(targets.items())]


def sync_official_pacs(session, official, today=None):
    """Fetch the PAC gifts that are due for one official; returns stats."""
    stats = {"periods": 0, "skipped": 0, "gifts": 0}
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    targets = pac_targets(session, official, today)
    committees = dict(official.fec_committees or {})
    for fec_id in sorted({fec_id for fec_id, _, _ in targets}):
        if fec_id not in committees:
            committees[fec_id] = fetch_committees(fec_id)
    official.fec_committees = committees

    for fec_id, period, coverage_end_date in targets:
        for committee_id in committees_for_period(committees[fec_id], period):
            key = (official.id, committee_id, period)
            sync = session.get(PacContributionSync, key)
            if not pac_sync_due(sync, period, coverage_end_date, today):
                stats["skipped"] += 1
                continue
            values = [
                v for v in map(pac_contribution_values, fetch_pac_contributions(committee_id, period)) if v
            ]
            session.query(PacContribution).filter(
                PacContribution.official_id == official.id,
                PacContribution.committee_id == committee_id,
                PacContribution.two_year_period == period,
            ).delete(synchronize_session=False)
            seen = set()
            latest = None
            for value in values:
                if value["sub_id"] in seen:
                    continue
                seen.add(value["sub_id"])
                if value["receipt_date"] and (latest is None or value["receipt_date"] > latest):
                    latest = value["receipt_date"]
                session.add(
                    PacContribution(
                        official_id=official.id,
                        fec_candidate_id=fec_id,
                        committee_id=committee_id,
                        two_year_period=period,
                        **value,
                    )
                )
            if sync is None:
                sync = PacContributionSync(
                    official_id=official.id, committee_id=committee_id, two_year_period=period
                )
                session.add(sync)
            sync.coverage_end_date = coverage_end_date
            sync.latest_receipt_date = latest
            sync.row_count = len(seen)
            sync.fetched_at = now
            stats["periods"] += 1
            stats["gifts"] += len(seen)
    return stats


def run_pacs(official_id=None, limit=None, max_minutes=None):
    """Sync PAC gifts, least recently synced officials first, within a time budget."""
    ensure_schema()
    if not FEC_API_KEY:
        print("WARNING: FEC_API_KEY is not set; using DEMO_KEY, which allows only a handful of requests.")
    deadline = time.monotonic() + max_minutes * 60 if max_minutes else None
    session = SessionLocal()
    try:
        last_synced = (
            session.query(
                PacContributionSync.official_id,
                func.max(PacContributionSync.fetched_at).label("last_synced"),
            )
            .group_by(PacContributionSync.official_id)
            .subquery()
        )
        query = (
            session.query(Official)
            .outerjoin(last_synced, last_synced.c.official_id == Official.id)
            .filter(Official.fec_candidate_ids.isnot(None))
        )
        if official_id:
            query = query.filter(Official.id == official_id)
        else:
            query = query.filter(
                Official.current_member.is_(True), Official.level == "federal"
            )
        officials = query.order_by(last_synced.c.last_synced.asc().nulls_first(), Official.id).all()
        if limit:
            officials = officials[:limit]
        if not officials:
            print("No officials with FEC IDs. Run `python fec_client.py crosswalk` first.")
            return

        synced = failed = 0
        for index, official in enumerate(officials, start=1):
            if deadline and time.monotonic() > deadline:
                print(f"Time budget of {max_minutes} minutes used; stopping. Re-run to continue.")
                break
            print(f"[{index}/{len(officials)}] {official.id} {official.display_name}")
            try:
                stats = sync_official_pacs(session, official)
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
            print(
                f"  {stats['periods']} periods fetched ({stats['gifts']} gifts), "
                f"{stats['skipped']} up to date"
            )
        print(f"Done: {synced} synced, {failed} failed, {len(officials)} selected.")
    finally:
        session.close()


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
            print(
                f"  {stats['elections']} elections, {stats['breakdowns']} breakdowns and "
                f"{stats['outside_spending']} outside-spending totals refreshed"
            )
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
    pacs = subparsers.add_parser(
        "pacs",
        help="Fetch every itemized PAC gift for current federal officials (run totals first).",
    )
    pacs.add_argument("--official-id", help="Only this bioguide ID (current or not).")
    pacs.add_argument("--limit", type=int, help="Stop after this many officials.")
    pacs.add_argument(
        "--max-minutes",
        type=float,
        help="Stop starting new officials after this many minutes; the next run continues.",
    )
    args = parser.parse_args()

    if args.command == "crosswalk":
        run_crosswalk()
    elif args.command == "totals":
        run_totals(official_id=args.official_id, limit=args.limit)
    elif args.command == "pacs":
        run_pacs(official_id=args.official_id, limit=args.limit, max_minutes=args.max_minutes)


if __name__ == "__main__":
    main()
