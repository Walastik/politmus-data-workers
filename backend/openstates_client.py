import argparse
import os
import sys
import time
from datetime import date, datetime, timezone

import requests
from dotenv import load_dotenv

from api.filters import STATE_ABBR_BY_NAME, STATE_NAME_BY_ABBR, normalize_state
from database import SessionLocal
from init_db import ensure_schema
from models import Official, StateSyncLog
from status_mapper import (
    derive_bill_status,
    origin_chamber_from_identifier,
)

load_dotenv()

BASE_URL = "https://v3.openstates.org"
API_KEY = os.getenv("OPENSTATES_API_KEY")
PAGE_SIZE = 50
REQUEST_PAUSE_SECONDS = 0.2
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1.0

# org_classification on /people filters by current role, so these queries
# return active members instead of a state's full historical roster.
# "legislature" merges upper and lower into one paginated set (Nebraska's
# unicameral body uses the same value). A second "executive" request is
# how we find the sitting governor without storing other executives.
# include=offices,links puts contact fields on the list payload so we do
# not follow up with a GET per person.
LEGISLATIVE_CLASSIFICATIONS = ("upper", "lower", "legislature")
CURRENT_LEGISLATIVE_CLASSIFICATION = "legislature"
EXECUTIVE_CLASSIFICATION = "executive"
PEOPLE_INCLUDES = ("offices", "links")
STATE_UPPER_OFFICE = "State Senator"
STATE_LOWER_OFFICE = "State Representative"
GOVERNOR_OFFICE = "Governor"

# Standard 50 US states only. DC and territories (AS, GU, MP, PR, VI) are
# excluded so all-states / --limit ingest stays within OpenStates rate limits.
TARGET_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]
TARGET_STATE_SET = frozenset(TARGET_STATES)
EXCLUDED_JURISDICTIONS = frozenset({"AS", "GU", "MP", "PR", "VI", "DC"})


def _require_api_key():
    if not API_KEY:
        raise RuntimeError("OPENSTATES_API_KEY is not set")


def _retry_wait_seconds(response, delay):
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return float(retry_after)
        except ValueError:
            pass
    return delay


def _utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def request_with_backoff(url, headers=None, params=None):
    """GET with exponential backoff on HTTP 429 and 5xx.

    Honors `Retry-After` when OpenStates sends it; otherwise doubles the wait
    after each retry. Exhausting MAX_RETRIES still raises so a single-state
    failure can be recorded without aborting the rest of a batch.
    """
    delay = INITIAL_BACKOFF_SECONDS
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_PAUSE_SECONDS)
        try:
            response = requests.get(
                url, headers=headers, params=params, timeout=30
            )
        except requests.RequestException as exc:
            last_error = exc
            print(f"  Request error ({exc}); retrying in {delay:.1f}s...")
            time.sleep(delay)
            delay *= 2
            continue

        if response.status_code == 429 or response.status_code >= 500:
            wait = _retry_wait_seconds(response, delay)
            print(
                f"  HTTP {response.status_code} from OpenStates; "
                f"retrying in {wait:.1f}s (attempt {attempt}/{MAX_RETRIES})..."
            )
            time.sleep(wait)
            delay *= 2
            last_error = requests.HTTPError(
                f"{response.status_code} for {url}", response=response
            )
            continue

        response.raise_for_status()
        return response

    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to fetch {url}")


def openstates_get(path, params=None):
    """GET JSON from OpenStates v3 with polite pacing and 429 backoff."""
    _require_api_key()
    url = path if path.startswith("http") else BASE_URL + path

    headers = {"X-API-KEY": API_KEY}
    query = {"apikey": API_KEY}
    if params:
        query.update(params)

    return request_with_backoff(url, headers=headers, params=query).json()


def classifications_for_state(state_code):
    """Current-legislator OpenStates org_classification for a jurisdiction."""
    resolve_state(state_code)
    return (CURRENT_LEGISLATIVE_CLASSIFICATION,)


def people_classifications_for_state(state_code):
    """Current legislators plus one executive request for the governor."""
    return classifications_for_state(state_code) + (EXECUTIVE_CLASSIFICATION,)


def people_list_params(state_abbr, classification, page):
    """Query params for one page of current people in a jurisdiction."""
    return {
        "jurisdiction": state_abbr.lower(),
        "org_classification": classification,
        "include": list(PEOPLE_INCLUDES),
        "page": page,
        "per_page": PAGE_SIZE,
    }


def resolve_state(state_code):
    """Return (postal abbreviation, full name) for a state code or name."""
    stripped = (state_code or "").strip()
    if not stripped:
        raise ValueError("state is required")
    name = normalize_state(stripped)
    abbr = STATE_ABBR_BY_NAME.get(name.lower())
    if abbr:
        return abbr, name
    if len(stripped) == 2:
        abbr = stripped.upper()
        return abbr, STATE_NAME_BY_ABBR.get(abbr, abbr)
    return stripped.upper(), stripped


def require_target_state(state_code):
    """Resolve a jurisdiction and reject DC / territories."""
    abbr, state_name = resolve_state(state_code)
    if abbr in EXCLUDED_JURISDICTIONS or abbr not in TARGET_STATE_SET:
        raise ValueError(
            f"{abbr} is not a standard US state; "
            "OpenStates ingest skips DC and territories (AS, GU, MP, PR, VI)."
        )
    return abbr, state_name


def _text_or_none(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def _party_from_person(person):
    party = _text_or_none(person.get("party"))
    if not party:
        return None
    if party.lower() == "democrat":
        return "Democratic"
    return party


def _normalize_url(url):
    url = _text_or_none(url)
    if not url:
        return None
    if url.startswith("//"):
        return f"https:{url}"
    if not url.lower().startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def _website_from_person(person):
    links = person.get("links") or []
    preferred = []
    fallback = []
    for link in links:
        if not isinstance(link, dict):
            continue
        url = _normalize_url(link.get("url"))
        if not url:
            continue
        note = (link.get("note") or "").strip().lower()
        if any(token in note for token in ("home", "official", "website")):
            preferred.append(url)
        else:
            fallback.append(url)
    return (preferred or fallback or [None])[0]


def _offices_from_person(person):
    offices = person.get("offices") or []
    return [office for office in offices if isinstance(office, dict)]


def _ranked_offices(person):
    rank = {"capitol": 0, "district": 1}
    offices = _offices_from_person(person)
    return sorted(
        offices,
        key=lambda office: rank.get(
            str(office.get("classification") or "").strip().lower(), 2
        ),
    )


def _phone_from_person(person):
    for office in _ranked_offices(person):
        phone = _text_or_none(office.get("voice"))
        if phone:
            return phone
    return None


def _office_address_from_person(person):
    for office in _ranked_offices(person):
        address = _text_or_none(office.get("address"))
        if address:
            return address
    return None


def district_from_role(role):
    """Numeric district when OpenStates uses a Census-compatible code."""
    if not isinstance(role, dict):
        return None
    raw = role.get("district")
    text = _text_or_none(raw)
    if not text:
        return None
    try:
        value = int(text)
    except (TypeError, ValueError):
        return None
    if value < 0:
        return None
    return value


def _role_title(role):
    if not isinstance(role, dict):
        return ""
    return str(role.get("title") or "").strip().lower()


def is_governor_role(role):
    """True for a sitting governor, not lieutenant governor or other executives."""
    if not isinstance(role, dict):
        return False
    classification = str(role.get("org_classification") or "").strip().lower()
    if classification != EXECUTIVE_CLASSIFICATION:
        return False
    title = _role_title(role)
    if not title:
        return False
    if "lieutenant" in title or title.startswith("lt.") or title.startswith("lt "):
        return False
    return title == "governor" or title.startswith("governor")


def office_from_role(role):
    """Stable office label used by address lookup to pick a chamber or executive."""
    if not isinstance(role, dict):
        return STATE_LOWER_OFFICE
    classification = str(role.get("org_classification") or "").strip().lower()
    if classification == EXECUTIVE_CLASSIFICATION:
        if is_governor_role(role):
            return GOVERNOR_OFFICE
        return None
    if classification in {"upper", "legislature"}:
        return STATE_UPPER_OFFICE
    return STATE_LOWER_OFFICE


def official_from_person(person, state_name):
    openstates_id = _text_or_none(person.get("id"))
    if not openstates_id:
        return None
    role = person.get("current_role")
    if not isinstance(role, dict):
        return None
    classification = str(role.get("org_classification") or "").strip().lower()
    if classification == EXECUTIVE_CLASSIFICATION:
        if not is_governor_role(role):
            return None
        office = GOVERNOR_OFFICE
        district = None
    elif classification in LEGISLATIVE_CLASSIFICATIONS:
        office = office_from_role(role)
        district = district_from_role(role)
    else:
        return None
    return Official(
        id=openstates_id,
        name=_text_or_none(person.get("name")),
        state=state_name,
        party=_party_from_person(person),
        office=office,
        district=district,
        current_member=True,
        phone=_phone_from_person(person),
        office_address=_office_address_from_person(person),
        website_url=_website_from_person(person),
        level="state",
        openstates_id=openstates_id,
    )


def upsert_official(session, incoming):
    """Insert or update a state official without wiping stored contact fields."""
    existing = None
    if incoming.openstates_id:
        existing = (
            session.query(Official)
            .filter(Official.openstates_id == incoming.openstates_id)
            .one_or_none()
        )
    if existing is None:
        existing = session.get(Official, incoming.id)
    if existing is None:
        session.add(incoming)
        return incoming

    existing.name = incoming.name
    existing.state = incoming.state
    existing.party = incoming.party
    existing.office = incoming.office
    existing.district = incoming.district
    existing.current_member = incoming.current_member
    existing.level = incoming.level
    existing.openstates_id = incoming.openstates_id
    if incoming.phone:
        existing.phone = incoming.phone
    if incoming.office_address:
        existing.office_address = incoming.office_address
    if incoming.website_url:
        existing.website_url = incoming.website_url
    return existing


def fetch_state_legislators(state_code):
    """Current legislators and governor for a state, keyed by OpenStates person id.

    Uses /people list filters only: org_classification limits results to
    active members, and include=offices,links supplies contact fields so
    ingest never issues a follow-up GET per person.
    """
    abbr, _state_name = resolve_state(state_code)
    by_id = {}

    for classification in people_classifications_for_state(abbr):
        page = 1
        found_governor = False
        while True:
            print(
                f"  Fetching {abbr} {classification} people "
                f"(page {page})..."
            )
            payload = openstates_get(
                "/people",
                params=people_list_params(abbr, classification, page),
            )
            for person in payload.get("results") or []:
                if not isinstance(person.get("current_role"), dict):
                    continue
                person_id = _text_or_none(person.get("id"))
                if person_id:
                    by_id[person_id] = person
                if is_governor_role(person.get("current_role")):
                    found_governor = True
            pagination = payload.get("pagination") or {}
            max_page = pagination.get("max_page") or page
            if page >= max_page:
                break
            # Executive lists include many current statewide officials we
            # skip later; stop paging once the sitting governor is in hand.
            if classification == EXECUTIVE_CLASSIFICATION and found_governor:
                break
            page += 1

    return list(by_id.values())


def mark_state_synced(session, state_code):
    """Record a successful ingest so --limit can round-robin stale states."""
    abbr, _state_name = resolve_state(state_code)
    now = _utc_now_naive()
    row = session.get(StateSyncLog, abbr)
    if row is None:
        session.add(StateSyncLog(state_code=abbr, last_synced_at=now))
    else:
        row.last_synced_at = now


def states_due_for_sync(limit=None):
    """TARGET_STATES ordered by oldest last_synced_at, optionally capped.

    Never-synced states (missing or null timestamps) come first so a new
    `--limit` run fills gaps before refreshing recently synced states.
    """
    if limit is not None and limit < 1:
        raise ValueError("--limit must be a positive integer")

    ensure_schema()
    session = SessionLocal()
    try:
        logs = {
            row.state_code: row.last_synced_at
            for row in session.query(StateSyncLog).all()
        }
        ranked = sorted(
            TARGET_STATES,
            key=lambda abbr: (
                logs.get(abbr) is not None,
                logs.get(abbr) or datetime.min,
                abbr,
            ),
        )
        if limit is None:
            return ranked
        return ranked[:limit]
    finally:
        session.close()


def sync_state_members(state_code):
    """Upsert active state legislators and the governor into `officials`."""
    _require_api_key()
    abbr, state_name = require_target_state(state_code)
    ensure_schema()
    people = fetch_state_legislators(abbr)
    session = SessionLocal()
    saved = 0
    skipped = 0
    current_ids = []

    try:
        total = len(people)
        print(f"Fetched {total} OpenStates people for {state_name}.")
        for index, person in enumerate(people, start=1):
            official = official_from_person(person, state_name)
            if official is None:
                skipped += 1
                continue
            print(
                f"[{index}/{total}] {official.name} "
                f"{official.office} district={official.district}"
            )
            upsert_official(session, official)
            current_ids.append(official.id)
            saved += 1

        if current_ids:
            former = (
                session.query(Official)
                .filter(Official.level == "state")
                .filter(Official.state.ilike(state_name))
                .filter(~Official.id.in_(current_ids))
                .filter(Official.current_member.is_(True))
                .update(
                    {Official.current_member: False},
                    synchronize_session=False,
                )
            )
            if former:
                print(
                    f"  Marked {former} {state_name} state official(s) "
                    "as not current."
                )
        elif saved == 0:
            print(f"  No current state officials saved for {state_name}.")

        mark_state_synced(session, abbr)
        session.commit()
        return {
            "state": state_name,
            "fetched": total,
            "saved": saved,
            "skipped": skipped,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _print_member_stats(stats):
    print("\nOpenStates ingest summary")
    print(f"  State:    {stats['state']}")
    print(f"  Fetched:  {stats['fetched']}")
    print(f"  Upserted: {stats['saved']}")
    print(f"  Skipped:  {stats['skipped']}")


def _print_all_states_summary(results, failures):
    print("\nOpenStates all-states ingest summary")
    print(f"  Succeeded: {len(results)}")
    print(f"  Failed:    {len(failures)}")
    print(f"  Fetched:   {sum(item['fetched'] for item in results)}")
    print(f"  Upserted:  {sum(item['saved'] for item in results)}")
    print(f"  Skipped:   {sum(item['skipped'] for item in results)}")
    if results:
        print("  States:")
        for stats in results:
            print(
                f"    {stats['state']}: fetched={stats['fetched']} "
                f"upserted={stats['saved']} skipped={stats['skipped']}"
            )
    if failures:
        print("  Failures:")
        for item in failures:
            print(f"    {item['state']}: {item['error']}")


def sync_all_states(limit=None):
    """Upsert legislators and governors for standard US states.

    When `limit` is set, only the N states with the oldest `last_synced_at`
    timestamps are processed (round-robin). DC and territories are never
    included.
    """
    results = []
    failures = []
    abbreviations = states_due_for_sync(limit)
    total = len(abbreviations)
    scope = f"{total} state(s)" if limit else f"{total} states"
    print(f"Syncing OpenStates legislators and governors for {scope}...")

    for index, abbr in enumerate(abbreviations, start=1):
        state_name = STATE_NAME_BY_ABBR[abbr]
        print(f"\n=== [{index}/{total}] {abbr} ({state_name}) ===")
        try:
            stats = sync_state_members(abbr)
            _print_member_stats(stats)
            results.append(stats)
        except Exception as exc:
            print(f"  FAILED {abbr} ({state_name}): {exc}")
            failures.append({"state": abbr, "error": str(exc)})

    _print_all_states_summary(results, failures)
    return results, failures


def parse_openstates_date(value):
    """Parse OpenStates date strings such as 2025-05-01."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def bill_fields_from_openstates(payload):
    """Map an OpenStates /bills list row to upsert fields."""
    payload = payload if isinstance(payload, dict) else {}
    bill_id = _text_or_none(payload.get("id"))
    identifier = _text_or_none(payload.get("identifier"))
    action_text = _text_or_none(payload.get("latest_action_description"))
    action_date = parse_openstates_date(payload.get("latest_action_date"))
    subjects = payload.get("subject") or []
    policy_area = None
    if isinstance(subjects, list):
        for item in subjects:
            if isinstance(item, str) and item.strip():
                policy_area = item.strip()
                break
    origin = origin_chamber_from_identifier(identifier)
    return {
        "id": bill_id,
        "title": _text_or_none(payload.get("title")),
        "introduced_date": parse_openstates_date(payload.get("first_action_date")),
        "latest_action_text": action_text,
        "latest_action_date": action_date,
        "policy_area": policy_area,
        "status": derive_bill_status(action_text, origin_chamber=origin),
        "level": "state",
    }


def fetch_state_bills(state_code, limit=50):
    """Recent bills for one jurisdiction, newest latest_action first."""
    if limit < 1:
        raise ValueError("bill limit must be a positive integer")
    abbr, state_name = require_target_state(state_code)
    results = []
    page = 1
    while len(results) < limit:
        remaining = limit - len(results)
        print(
            f"  Fetching {abbr} bills (page {page}, up to {remaining})..."
        )
        payload = openstates_get(
            "/bills",
            params={
                "jurisdiction": abbr.lower(),
                "sort": "latest_action_desc",
                "page": page,
                "per_page": min(PAGE_SIZE, remaining),
            },
        )
        batch = [
            item for item in (payload.get("results") or []) if isinstance(item, dict)
        ]
        if not batch:
            break
        results.extend(batch)
        pagination = payload.get("pagination") or {}
        max_page = pagination.get("max_page") or page
        if page >= max_page:
            break
        page += 1
    return results[:limit], abbr, state_name


def sync_state_bills(state_code, limit=50):
    """Upsert OpenStates bills for one state, including status from latest action."""
    from congress_client import upsert_bill

    _require_api_key()
    abbr, state_name = require_target_state(state_code)
    ensure_schema()
    bills, abbr, state_name = fetch_state_bills(abbr, limit=limit)
    session = SessionLocal()
    saved = 0
    skipped = 0
    try:
        total = len(bills)
        print(f"Fetched {total} OpenStates bills for {state_name}.")
        for index, payload in enumerate(bills, start=1):
            fields = bill_fields_from_openstates(payload)
            if not fields["id"]:
                skipped += 1
                continue
            upsert_bill(
                session,
                fields["id"],
                fields["title"] or fields["id"],
                sponsor_id=None,
                policy_area=fields["policy_area"],
                introduced_date=fields["introduced_date"],
                latest_action_text=fields["latest_action_text"],
                latest_action_date=fields["latest_action_date"],
                status=fields["status"],
                level="state",
            )
            saved += 1
            print(
                f"[{index}/{total}] {payload.get('identifier') or fields['id']} "
                f"status={fields['status']!r}"
            )
        session.commit()
        return {
            "state": state_name,
            "fetched": total,
            "saved": saved,
            "skipped": skipped,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Ingest OpenStates state legislators, governors, and bills."
        )
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=["members", "bills"],
        default="members",
        help=(
            "members: current state legislators and governor (default). "
            "bills: recent state legislation and status from latest action."
        ),
    )
    parser.add_argument(
        "--state",
        help="State postal abbreviation or name, e.g. TX or Texas.",
    )
    parser.add_argument(
        "--all-states",
        action="store_true",
        help=(
            "With members: ingest every standard US state in TARGET_STATES "
            "(excludes DC and territories). Continues after a single-state failure."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        metavar="N",
        help=(
            "With members: ingest the N states with the oldest last_synced_at "
            "(round-robin). With bills: ingest the N newest bills for --state. "
            "Example: --limit 5."
        ),
    )
    args = parser.parse_args()

    if args.state and args.all_states:
        parser.error("--state and --all-states cannot be combined")

    if args.command == "bills":
        if args.all_states:
            parser.error("bills requires --state (not --all-states)")
        if not args.state:
            parser.error("bills requires --state")
        bill_limit = 50 if args.limit is None else args.limit
        if bill_limit < 1:
            parser.error("--limit must be a positive integer")
        stats = sync_state_bills(args.state, limit=bill_limit)
        print("\nOpenStates bill ingest summary")
        print(f"  State:    {stats['state']}")
        print(f"  Fetched:  {stats['fetched']}")
        print(f"  Upserted: {stats['saved']}")
        print(f"  Skipped:  {stats['skipped']}")
        return

    if args.limit is not None and args.state:
        parser.error("members --limit cannot be combined with --state")
    if args.command == "members":
        if args.all_states:
            _results, failures = sync_all_states()
            if failures:
                sys.exit(1)
        elif args.limit is not None:
            if args.limit < 1:
                parser.error("--limit must be a positive integer")
            _results, failures = sync_all_states(limit=args.limit)
            if failures:
                sys.exit(1)
        elif args.state:
            stats = sync_state_members(args.state)
            _print_member_stats(stats)
        else:
            parser.error("members requires --state, --all-states, or --limit")


if __name__ == "__main__":
    main()
