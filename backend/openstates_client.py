import argparse
import os
import time

import requests
from dotenv import load_dotenv

from api.filters import STATE_ABBR_BY_NAME, STATE_NAME_BY_ABBR, normalize_state
from database import SessionLocal
from init_db import ensure_schema
from models import Official

load_dotenv()

BASE_URL = "https://v3.openstates.org"
API_KEY = os.getenv("OPENSTATES_API_KEY")
PAGE_SIZE = 50
REQUEST_PAUSE_SECONDS = 0.2
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1.0

LEGISLATIVE_CLASSIFICATIONS = ("upper", "lower", "legislature")
STATE_UPPER_OFFICE = "State Senator"
STATE_LOWER_OFFICE = "State Representative"


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


def openstates_get(path, params=None):
    """GET JSON from OpenStates v3 with polite pacing and 429 backoff."""
    _require_api_key()
    url = path if path.startswith("http") else BASE_URL + path

    headers = {"X-API-KEY": API_KEY}
    query = {"apikey": API_KEY}
    if params:
        query.update(params)

    delay = INITIAL_BACKOFF_SECONDS
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_PAUSE_SECONDS)
        try:
            response = requests.get(url, headers=headers, params=query, timeout=30)
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
        return response.json()

    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to fetch {url}")


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


def office_from_role(role):
    """Stable office label used by address lookup to pick a chamber."""
    if not isinstance(role, dict):
        return STATE_LOWER_OFFICE
    classification = str(role.get("org_classification") or "").strip().lower()
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
    if classification not in LEGISLATIVE_CLASSIFICATIONS:
        return None
    return Official(
        id=openstates_id,
        name=_text_or_none(person.get("name")),
        state=state_name,
        party=_party_from_person(person),
        office=office_from_role(role),
        district=district_from_role(role),
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
    """Current legislators for a state, keyed by OpenStates person id."""
    abbr, _state_name = resolve_state(state_code)
    by_id = {}

    for classification in LEGISLATIVE_CLASSIFICATIONS:
        page = 1
        while True:
            print(
                f"  Fetching {abbr} {classification} legislators "
                f"(page {page})..."
            )
            payload = openstates_get(
                "/people",
                params={
                    "jurisdiction": abbr.lower(),
                    "org_classification": classification,
                    "include": ["offices", "links"],
                    "page": page,
                    "per_page": PAGE_SIZE,
                },
            )
            for person in payload.get("results") or []:
                person_id = _text_or_none(person.get("id"))
                if person_id:
                    by_id[person_id] = person
            pagination = payload.get("pagination") or {}
            max_page = pagination.get("max_page") or page
            if page >= max_page:
                break
            page += 1

    return list(by_id.values())


def sync_state_members(state_code):
    """Upsert active state legislators into `officials` for one state."""
    _require_api_key()
    abbr, state_name = resolve_state(state_code)
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
            print(f"  No current legislators saved for {state_name}.")

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


def main():
    parser = argparse.ArgumentParser(
        description="Ingest OpenStates state legislators into officials."
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=["members"],
        default="members",
        help="members: current state legislators (default).",
    )
    parser.add_argument(
        "--state",
        required=True,
        help="State postal abbreviation or name, e.g. TX or Texas.",
    )
    args = parser.parse_args()

    if args.command == "members":
        stats = sync_state_members(args.state)
        _print_member_stats(stats)


if __name__ == "__main__":
    main()
