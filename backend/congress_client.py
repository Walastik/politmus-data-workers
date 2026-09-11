import argparse
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

import requests
from dotenv import load_dotenv
from sqlalchemy import and_, exists, or_

from api.filters import classify_bipartisan_type, normalize_party, normalize_state
from database import SessionLocal
from init_db import ensure_schema
from models import Bill, Official, SenateRollCall, Vote
from services.bill_analytics import refresh_bill_velocity

load_dotenv()

BASE_URL = "https://api.congress.gov/v3"
SENATE_VOTE_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_votes/"
    "vote{congress}{session}/vote_{congress}_{session}_{vote_number}.xml"
)
SENATE_VOTE_MENU_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_lists/"
    "vote_menu_{congress}_{session}.xml"
)
SENATE_SESSIONS = (1, 2)
SENATE_ROLL_CALL_INGESTED = "ingested"
SENATE_ROLL_CALL_SKIPPED_NOMINATION = "skipped_nomination"
SENATE_ROLL_CALL_SKIPPED_NO_BILL = "skipped_no_bill"
SENATE_ROLL_CALL_NOT_FOUND = "not_found"
SENATE_ROLL_CALL_FAILED = "failed"
SENATE_ROLL_CALL_TERMINAL = {
    SENATE_ROLL_CALL_INGESTED,
    SENATE_ROLL_CALL_SKIPPED_NOMINATION,
}
SENATE_USER_AGENT = "politmus-data-workers (https://politmus.com)"
API_KEY = os.getenv("CONGRESS_GOV_API_KEY")
PAGE_SIZE = 250
CURRENT_CONGRESS = 119
REQUEST_PAUSE_SECONDS = 0.2
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1.0

# Senate.gov <document_type> values, stripped of spaces and periods.
SENATE_DOCUMENT_TYPE_MAP = {
    "s": "s",
    "hr": "hr",
    "hjres": "hjres",
    "sjres": "sjres",
    "hconres": "hconres",
    "sconres": "sconres",
    "hres": "hres",
    "sres": "sres",
}

POSITION_MAP = {
    "yea": "Yes",
    "aye": "Yes",
    "yes": "Yes",
    "nay": "No",
    "no": "No",
    "present": "Present",
    "not voting": "Not Voting",
    "notvoting": "Not Voting",
}


def _require_api_key():
    if not API_KEY:
        raise RuntimeError("CONGRESS_GOV_API_KEY is not set")


def _retry_wait_seconds(response, delay):
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return float(retry_after)
        except ValueError:
            pass
    return delay


def congress_get(url, params=None):
    """GET JSON from Congress.gov with polite pacing and 429 backoff."""
    _require_api_key()
    if url.startswith("/"):
        url = BASE_URL + url

    headers = {"X-Api-Key": API_KEY}
    query = {"format": "json", "api_key": API_KEY}
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
                f"  HTTP {response.status_code} from Congress.gov; "
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


def make_bill_id(congress, bill_type, number):
    return f"{congress}-{str(bill_type).lower()}-{number}"


def parse_bill_id(bill_id):
    """Split a stored id like 119-hr-1 into (congress, bill_type, number)."""
    parts = str(bill_id).split("-")
    if len(parts) < 3:
        return None
    congress, bill_type, number = parts[0], parts[1], "-".join(parts[2:])
    if not congress or not bill_type or not number:
        return None
    return congress, bill_type, number


def normalize_position(vote_cast):
    if not vote_cast:
        return None
    mapped = POSITION_MAP.get(str(vote_cast).strip().lower())
    if mapped:
        return mapped
    return str(vote_cast).strip()


def _xml_text(element, tag):
    if element is None:
        return None
    text = element.findtext(tag)
    if text is None:
        return None
    stripped = text.strip()
    return stripped or None


def senate_vote_url(congress, session, vote_number):
    """Build the Senate.gov roll-call XML URL (vote numbers are 5-digit padded)."""
    padded = f"{int(vote_number):05d}"
    return SENATE_VOTE_URL.format(
        congress=int(congress),
        session=int(session),
        vote_number=padded,
    )


def senate_vote_menu_url(congress, session):
    return SENATE_VOTE_MENU_URL.format(
        congress=int(congress),
        session=int(session),
    )


def map_senate_document_type(document_type):
    """Map Senate.gov document_type (e.g. 'S.', 'H.R.') to a bills.id type."""
    if not document_type:
        return None
    key = "".join(
        ch for ch in str(document_type).strip().lower() if ch not in " ."
    )
    return SENATE_DOCUMENT_TYPE_MAP.get(key)


def senate_document_to_bill_id(congress, document_type, document_number):
    """Return a stored bill id like 119-s-5, or None for nominations/treaties."""
    mapped = map_senate_document_type(document_type)
    if congress in (None, "") or mapped is None or document_number in (None, ""):
        return None
    number = str(document_number).strip()
    if not number:
        return None
    return make_bill_id(congress, mapped, number)


SENATE_ISSUE_RE = re.compile(
    r"^(?P<type>S\.J\.Res\.|H\.J\.Res\.|S\.Con\.Res\.|H\.Con\.Res\.|"
    r"S\.Res\.|H\.Res\.|H\.R\.|S\.)\s*(?P<number>\d+)\s*$",
    re.IGNORECASE,
)


def bill_id_from_senate_issue(congress, issue_text):
    """Parse labels like 'S. 5' or 'H.R. 1' into a stored bill id."""
    if not issue_text:
        return None
    text = re.sub(r"\s+", " ", str(issue_text).strip())
    match = SENATE_ISSUE_RE.match(text)
    if not match:
        return None
    return senate_document_to_bill_id(
        congress, match.group("type"), match.group("number")
    )


def senate_menu_issues(vote_el):
    """Collect issue labels from a vote_menu <vote>, including en_bloc matters."""
    issues = []
    issue = _xml_text(vote_el, "issue")
    if issue:
        issues.append(issue)
    en_bloc = vote_el.find("en_bloc") if vote_el is not None else None
    if en_bloc is not None:
        for matter in en_bloc.findall("matter"):
            matter_issue = _xml_text(matter, "issue")
            if matter_issue:
                issues.append(matter_issue)
    return issues


def senate_menu_bill_ids(congress, issues):
    return [
        bill_id
        for bill_id in (bill_id_from_senate_issue(congress, issue) for issue in issues)
        if bill_id
    ]


def senate_menu_has_legislation(issues, congress):
    """Whether a menu row might map to a bill (skip nominations/treaties).

    Empty issues are kept: amendment votes often omit <issue> on the menu
    and only name the underlying bill in the roll-call XML.
    """
    if not issues:
        return True
    return bool(senate_menu_bill_ids(congress, issues))


def parse_senate_vote_menu(xml_bytes, congress=None):
    """Parse a Senate.gov vote_menu XML into oldest-first roll-call rows."""
    root = ET.fromstring(xml_bytes)
    xml_congress = _xml_text(root, "congress") or congress
    xml_session = _xml_text(root, "session")
    votes_el = root.find("votes")
    rows = []
    if votes_el is None:
        return {
            "congress": xml_congress,
            "session": xml_session,
            "votes": rows,
        }
    for vote_el in votes_el.findall("vote"):
        raw_number = _xml_text(vote_el, "vote_number")
        if not raw_number:
            continue
        try:
            vote_number = int(raw_number)
        except ValueError:
            continue
        issues = senate_menu_issues(vote_el)
        rows.append(
            {
                "vote_number": vote_number,
                "issue": issues[0] if issues else None,
                "issues": issues,
                "bill_ids": senate_menu_bill_ids(xml_congress, issues),
            }
        )
    rows.sort(key=lambda item: item["vote_number"])
    return {
        "congress": xml_congress,
        "session": xml_session,
        "votes": rows,
    }


def bill_id_from_senate_document(document, congress=None):
    if document is None:
        return None
    doc_congress = _xml_text(document, "document_congress") or congress
    bill_id = senate_document_to_bill_id(
        doc_congress,
        _xml_text(document, "document_type"),
        _xml_text(document, "document_number"),
    )
    if bill_id:
        return bill_id
    return bill_id_from_senate_issue(
        doc_congress, _xml_text(document, "document_name")
    )


def parse_senate_vote_date(value):
    """Parse Senate.gov vote_date strings such as 'January 9, 2025,  02:54 PM'."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = re.sub(r"\s+", " ", str(value).strip())
    if not text:
        return None
    for fmt in ("%B %d, %Y, %I:%M %p", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def last_name_from_official_name(name):
    """Last name from Congress.gov inverted names ('Cruz, Ted') or a display name."""
    if not name:
        return ""
    text = str(name).strip()
    if "," in text:
        return text.split(",", 1)[0].strip()
    parts = text.split()
    return parts[-1] if parts else ""


def senator_lookup_key(last_name, state):
    """Match Senate XML last_name + 2-letter state to officials (full state names)."""
    last = (last_name or "").strip()
    state_name = normalize_state(state)
    if not last or not state_name:
        return None
    return (last.casefold(), state_name.casefold())


def load_senator_lookup(session):
    """Map (last_name, full state name) -> bioguide id for federal senators."""
    officials = (
        session.query(Official)
        .filter(Official.office == "Senator")
        .filter(or_(Official.level == "federal", Official.level.is_(None)))
        .all()
    )
    lookup = {}
    for official in officials:
        key = senator_lookup_key(
            last_name_from_official_name(official.name),
            official.state,
        )
        if key is None:
            continue
        existing_id = lookup.get(key)
        if existing_id is None or official.current_member:
            lookup[key] = official.id
    return lookup


def parse_senate_vote_xml(xml_bytes, congress=None):
    """Parse a Senate.gov roll_call_vote XML document into a dict."""
    root = ET.fromstring(xml_bytes)
    xml_congress = _xml_text(root, "congress") or congress
    document = root.find("document")
    amendment = root.find("amendment")
    members_el = root.find("members")
    members = []
    if members_el is not None:
        for member in members_el.findall("member"):
            members.append(
                {
                    "last_name": _xml_text(member, "last_name"),
                    "first_name": _xml_text(member, "first_name"),
                    "state": _xml_text(member, "state"),
                    "vote_cast": _xml_text(member, "vote_cast"),
                }
            )
    bill_id = bill_id_from_senate_document(document, congress=xml_congress)
    if bill_id is None and amendment is not None:
        bill_id = bill_id_from_senate_issue(
            xml_congress,
            _xml_text(amendment, "amendment_to_document_number"),
        )
    bill_title = None
    if document is not None:
        bill_title = _xml_text(document, "document_title")
    if not bill_title:
        bill_title = _xml_text(root, "vote_document_text") or _xml_text(
            root, "vote_title"
        )
    return {
        "congress": xml_congress,
        "session": _xml_text(root, "session"),
        "vote_number": _xml_text(root, "vote_number"),
        "bill_id": bill_id,
        "bill_title": bill_title,
        "vote_date": parse_senate_vote_date(_xml_text(root, "vote_date")),
        "members": members,
    }


def senate_get(url):
    """GET bytes from Senate.gov with polite pacing and 429/5xx backoff."""
    headers = {"User-Agent": SENATE_USER_AGENT}
    delay = INITIAL_BACKOFF_SECONDS
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        time.sleep(REQUEST_PAUSE_SECONDS)
        try:
            response = requests.get(url, headers=headers, timeout=30)
        except requests.RequestException as exc:
            last_error = exc
            print(f"  Request error ({exc}); retrying in {delay:.1f}s...")
            time.sleep(delay)
            delay *= 2
            continue

        if response.status_code == 404:
            return None

        if response.status_code == 429 or response.status_code >= 500:
            wait = _retry_wait_seconds(response, delay)
            print(
                f"  HTTP {response.status_code} from Senate.gov; "
                f"retrying in {wait:.1f}s (attempt {attempt}/{MAX_RETRIES})..."
            )
            time.sleep(wait)
            delay *= 2
            last_error = requests.HTTPError(
                f"{response.status_code} for {url}", response=response
            )
            continue

        response.raise_for_status()
        return response.content

    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to fetch {url}")


def fetch_senate_vote_xml(congress, session, vote_number):
    """Download one Senate roll-call XML document, or None if it 404s."""
    url = senate_vote_url(congress, session, vote_number)
    return senate_get(url)


def fetch_senate_vote_menu(congress, session):
    """Download the Senate.gov vote menu for a congress/session, or None if 404."""
    url = senate_vote_menu_url(congress, session)
    return senate_get(url)


def _apply_vote_positions(session, bill_id, latest_by_official):
    """Upsert one vote row per official for a bill. Returns insert/update counts."""
    stats = {"inserted": 0, "updated": 0, "unchanged": 0}
    existing_votes = {
        row.official_id: row
        for row in session.query(Vote).filter_by(bill_id=bill_id).all()
    }
    for official_id, position in latest_by_official.items():
        current = existing_votes.get(official_id)
        if current is None:
            session.add(
                Vote(
                    bill_id=bill_id,
                    official_id=official_id,
                    position=position,
                )
            )
            stats["inserted"] += 1
        elif current.position != position:
            current.position = position
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1
    return stats


def _positions_from_senate_members(members, senator_lookup):
    """Map Senate XML members to official_id -> position via last name + state."""
    latest_by_official = {}
    unknown = []
    for member in members:
        key = senator_lookup_key(member.get("last_name"), member.get("state"))
        official_id = senator_lookup.get(key) if key else None
        if not official_id:
            unknown.append(
                f"{member.get('last_name') or '?'} "
                f"({member.get('state') or '?'})"
            )
            continue
        position = normalize_position(member.get("vote_cast"))
        if not position:
            continue
        latest_by_official[official_id] = position
    return latest_by_official, unknown


def load_official_ids(session):
    return {row[0] for row in session.query(Official.id).all()}


def load_bill_ids(session):
    return {row[0] for row in session.query(Bill.id).all()}


def senate_roll_call_key(congress, session, vote_number):
    return (int(congress), int(session), int(vote_number))


def load_senate_roll_calls(session, congress, session_number):
    """Map (congress, session, vote_number) -> SenateRollCall for one session."""
    rows = (
        session.query(SenateRollCall)
        .filter_by(congress=int(congress), session=int(session_number))
        .all()
    )
    return {senate_roll_call_key(row.congress, row.session, row.vote_number): row for row in rows}


def _utc_now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def upsert_senate_roll_call(
    db_session,
    roll_calls,
    congress,
    session,
    vote_number,
    status,
    bill_id=None,
):
    """Insert or update a Senate.gov ingest cursor row."""
    key = senate_roll_call_key(congress, session, vote_number)
    row = roll_calls.get(key)
    now = _utc_now_naive()
    if row is None:
        row = SenateRollCall(
            congress=int(congress),
            session=int(session),
            vote_number=int(vote_number),
            bill_id=bill_id,
            status=status,
            processed_at=now,
        )
        db_session.add(row)
        roll_calls[key] = row
        return row
    row.status = status
    if bill_id:
        row.bill_id = bill_id
    row.processed_at = now
    return row


TERRITORY_HOUSE_OFFICES = {
    "District of Columbia": "Delegate",
    "Guam": "Delegate",
    "American Samoa": "Delegate",
    "Virgin Islands": "Delegate",
    "Northern Mariana Islands": "Delegate",
    "Puerto Rico": "Resident Commissioner",
}


def _term_end(term):
    return term.get("endYear") or term.get("end") or term.get("termEndYear")


def _term_start(term):
    return (
        term.get("startYear")
        or term.get("start")
        or term.get("termBeginYear")
        or term.get("congress")
        or 0
    )


def _latest_term(member):
    terms = member.get("terms")
    items = []
    if isinstance(terms, dict):
        items = terms.get("item") or []
    elif isinstance(terms, list):
        items = terms
    if not items:
        return {}
    current = [term for term in items if not _term_end(term)]
    pool = current or items
    return max(pool, key=_term_start)


def office_from_member(member):
    """Human-readable office for the current term, e.g. Senator or Representative."""
    term = _latest_term(member)
    member_type = (term.get("memberType") or member.get("memberType") or "").strip()
    if member_type:
        return member_type

    chamber = (term.get("chamber") or member.get("chamber") or "").strip().lower()
    if "senate" in chamber:
        return "Senator"
    if "house" in chamber:
        return TERRITORY_HOUSE_OFFICES.get(member.get("state") or "", "Representative")

    if member.get("district") in (None, ""):
        return "Senator"
    return TERRITORY_HOUSE_OFFICES.get(member.get("state") or "", "Representative")


def district_from_member(member):
    """House district number, or None for senators / missing data.

    Congress.gov uses 0 for at-large House seats.
    """
    if office_from_member(member) == "Senator":
        return None
    raw = member.get("district")
    if raw in (None, ""):
        raw = _latest_term(member).get("district")
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def fetch_current_members():
    url = f"{BASE_URL}/member"
    params = {
        "currentMember": "true",
        "limit": PAGE_SIZE,
        "format": "json",
    }
    members = []

    while url:
        payload = congress_get(url, params=params)
        members.extend(payload.get("members", []))
        url = payload.get("pagination", {}).get("next")
        params = None

    return members


def fetch_member(bioguide_id):
    """GET /v3/member/{bioguideId} and return the member object."""
    payload = congress_get(f"/member/{bioguide_id}", params={"format": "json"})
    return payload.get("member") or payload


def _member_bioguide_id(member):
    identifiers = member.get("identifiers") or {}
    return member.get("bioguideId") or identifiers.get("bioguideId")


def _name_from_member(member):
    return (
        member.get("name")
        or member.get("invertedOrderName")
        or member.get("directOrderName")
        or None
    )


def _party_from_member(member):
    party = member.get("partyName") or member.get("party")
    if not party:
        history = member.get("partyHistory") or []
        if history:
            current = [item for item in history if not item.get("endYear")]
            pool = current or history
            latest = max(pool, key=lambda item: item.get("startYear") or 0)
            party = latest.get("partyName")
    if not party:
        return None
    party = str(party).strip()
    if party.lower() == "democrat":
        return "Democratic"
    return party or None


def _current_member_flag(member, default=False):
    if "currentMember" not in member:
        return default
    value = member.get("currentMember")
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return bool(value)


def _text_or_none(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text or None


def _phone_from_member(member):
    address = member.get("addressInformation")
    if not isinstance(address, dict):
        return None
    telephone = address.get("officeTelephone")
    if telephone in (None, ""):
        telephone = address.get("phoneNumber")
    if isinstance(telephone, dict):
        telephone = (
            telephone.get("phoneNumber")
            or telephone.get("number")
            or telephone.get("officeTelephone")
        )
    return _text_or_none(telephone)


def _office_address_from_member(member):
    address = member.get("addressInformation")
    if not isinstance(address, dict):
        return None
    office_address = _text_or_none(address.get("officeAddress"))
    if office_address:
        return office_address
    parts = [
        _text_or_none(address.get("city")),
        _text_or_none(address.get("district")),
        _text_or_none(address.get("zipCode")),
    ]
    composed = " ".join(part for part in parts if part)
    return composed or None


def _website_url_from_member(member):
    url = _text_or_none(
        member.get("officialWebsiteUrl") or member.get("officialUrl")
    )
    if not url:
        return None
    if url.startswith("//"):
        return f"https:{url}"
    if not url.lower().startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def _combine_member_payloads(listing, detail):
    """Prefer detail fields, but keep list identity when detail omits them."""
    if not isinstance(detail, dict) or not detail:
        return listing
    combined = dict(listing)
    for key, value in detail.items():
        if value not in (None, "", []):
            combined[key] = value
    return combined


def official_from_member(member, bioguide_id=None, current_member=None):
    bioguide_id = bioguide_id or _member_bioguide_id(member)
    if not bioguide_id:
        return None
    if current_member is None:
        current_member = _current_member_flag(member, default=False)
    return Official(
        id=bioguide_id,
        name=_name_from_member(member),
        state=member.get("state"),
        party=_party_from_member(member),
        office=office_from_member(member),
        district=district_from_member(member),
        current_member=bool(current_member),
        phone=_phone_from_member(member),
        office_address=_office_address_from_member(member),
        website_url=_website_url_from_member(member),
        level="federal",
    )


def upsert_official(session, incoming):
    """Insert or update an official without wiping stored contact fields.

    List-level member payloads omit phone/address/website. SQLAlchemy merge
    would null those columns, so blank incoming contact is left unchanged.
    """
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
    existing.level = incoming.level or existing.level or "federal"
    if incoming.phone:
        existing.phone = incoming.phone
    if incoming.office_address:
        existing.office_address = incoming.office_address
    if incoming.website_url:
        existing.website_url = incoming.website_url
    return existing


def save_officials(members):
    """Upsert the current roster. Only this path marks officials current.

    Members from GET /member?currentMember=true are stored with
    current_member=True. Anyone already in the table but missing from this
    response is marked current_member=False.

    Contact fields (phone, DC office address, website) are only on
    GET /member/{bioguideId}, so each current member is fetched in detail.
    """
    ensure_schema()
    session = SessionLocal()
    saved = 0
    current_ids = []
    detail_failed = 0

    try:
        total = len(members)
        for index, member in enumerate(members, start=1):
            bioguide_id = _member_bioguide_id(member)
            if not bioguide_id:
                continue

            print(f"[{index}/{total}] Fetching member {bioguide_id}...")
            source = member
            try:
                source = _combine_member_payloads(member, fetch_member(bioguide_id))
            except requests.HTTPError as exc:
                status = getattr(exc.response, "status_code", "?")
                print(f"  HTTP {status} for {bioguide_id}; using list payload.")
                detail_failed += 1
            except (requests.RequestException, RuntimeError) as exc:
                print(f"  Failed to fetch {bioguide_id}: {exc}; using list payload.")
                detail_failed += 1

            official = official_from_member(
                source, bioguide_id=bioguide_id, current_member=True
            )
            if official is None:
                continue

            upsert_official(session, official)
            current_ids.append(official.id)
            saved += 1

        if current_ids:
            former = (
                session.query(Official)
                .filter(~Official.id.in_(current_ids))
                .filter(Official.current_member.is_(True))
                .filter(
                    or_(Official.level == "federal", Official.level.is_(None))
                )
                .update(
                    {Official.current_member: False},
                    synchronize_session=False,
                )
            )
            if former:
                print(
                    f"  Marked {former} official(s) as not current "
                    "(absent from GET /member?currentMember=true)."
                )

        if detail_failed:
            print(
                f"  Member detail fetches failed: {detail_failed} "
                "(contact fields may be missing for those officials)."
            )

        session.commit()
        return saved
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def sync_missing_sponsors():
    """Insert officials for bills with sponsor_id NULL, then close the FK gap."""
    _require_api_key()
    ensure_schema()
    session = SessionLocal()
    stats = {
        "missing_ids": 0,
        "officials_upserted": 0,
        "officials_failed": 0,
        "bills_linked": 0,
    }

    try:
        rows = (
            session.query(Bill.sponsor_bioguide_id)
            .filter(Bill.sponsor_id.is_(None))
            .filter(Bill.sponsor_bioguide_id.isnot(None))
            .distinct()
            .all()
        )
        bioguide_ids = sorted({row[0] for row in rows if row[0]})
        stats["missing_ids"] = len(bioguide_ids)
        print(
            f"Found {len(bioguide_ids)} distinct sponsor bioguide IDs "
            "with sponsor_id=NULL."
        )

        linked_ids = []
        for index, bioguide_id in enumerate(bioguide_ids, start=1):
            print(f"[{index}/{len(bioguide_ids)}] Fetching member {bioguide_id}...")
            try:
                member = fetch_member(bioguide_id)
            except requests.HTTPError as exc:
                status = getattr(exc.response, "status_code", "?")
                print(f"  HTTP {status} for {bioguide_id}; skipping.")
                stats["officials_failed"] += 1
                continue
            except (requests.RequestException, RuntimeError) as exc:
                print(f"  Failed to fetch {bioguide_id}: {exc}")
                stats["officials_failed"] += 1
                continue

            existing = session.get(Official, bioguide_id)
            official = official_from_member(
                member,
                bioguide_id=bioguide_id,
                current_member=bool(existing.current_member) if existing else False,
            )
            if official is None:
                print(f"  No member payload for {bioguide_id}; skipping.")
                stats["officials_failed"] += 1
                continue

            upsert_official(session, official)
            linked_ids.append(bioguide_id)
            stats["officials_upserted"] += 1
            print(
                f"  Upserted official {official.id} "
                f"name={official.name!r} office={official.office!r}"
            )

        session.flush()

        if linked_ids:
            bills = (
                session.query(Bill)
                .filter(Bill.sponsor_id.is_(None))
                .filter(Bill.sponsor_bioguide_id.in_(linked_ids))
                .all()
            )
            for bill in bills:
                bill.sponsor_id = bill.sponsor_bioguide_id
            stats["bills_linked"] = len(bills)

        session.commit()
        return stats
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def fetch_bill_subjects(congress, bill_type, number):
    path = f"/bill/{congress}/{str(bill_type).lower()}/{number}/subjects"
    payload = congress_get(path, params={"format": "json"})
    return payload.get("subjects") or payload


def fetch_bill_summaries(congress, bill_type, number):
    url = f"{BASE_URL}/bill/{congress}/{str(bill_type).lower()}/{number}/summaries"
    params = {"limit": PAGE_SIZE, "format": "json"}
    summaries = []

    while url:
        payload = congress_get(url, params=params)
        summaries.extend(payload.get("summaries") or [])
        url = (payload.get("pagination") or {}).get("next")
        params = None

    return summaries


def _policy_area_from_subjects(subjects):
    if not subjects:
        return None
    area = subjects.get("policyArea") or {}
    if not isinstance(area, dict):
        return None
    name = (area.get("name") or "").strip()
    return name or None


def parse_congress_date(value):
    """Parse Congress.gov date or datetime strings into a date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        pass
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _introduced_date_from_detail(detail):
    if not detail:
        return None
    return parse_congress_date(detail.get("introducedDate"))


def _latest_vote_date(actions):
    latest = None
    for action in actions or []:
        votes = action.get("recordedVotes") or []
        if not votes:
            continue
        action_date = parse_congress_date(action.get("actionDate"))
        for vote in votes:
            parsed = parse_congress_date(vote.get("date")) or action_date
            if parsed is None:
                continue
            if latest is None or parsed > latest:
                latest = parsed
    return latest


def _latest_summary_text(summaries):
    if not summaries:
        return None
    latest = max(
        summaries,
        key=lambda item: item.get("updateDate") or item.get("actionDate") or "",
    )
    text = latest.get("text")
    if not isinstance(text, str):
        return None
    stripped = text.strip()
    return stripped or None


def sync_bill_enrichment():
    """Fill missing policy area, summary, dates, sponsorship, and vote velocity."""
    _require_api_key()
    ensure_schema()
    session = SessionLocal()
    stats = {
        "bills_pending": 0,
        "policy_areas_set": 0,
        "summaries_set": 0,
        "introduced_dates_set": 0,
        "voted_dates_set": 0,
        "sponsor_party_set": 0,
        "cosponsor_breakdowns_set": 0,
        "bills_failed": 0,
        "bills_unchanged": 0,
        "velocity_bills_scored": 0,
        "days_to_vote_set": 0,
        "velocity_buckets_set": 0,
        "velocity_mean": None,
        "velocity_std": None,
    }

    try:
        has_votes = exists().where(Vote.bill_id == Bill.id)
        bills = (
            session.query(Bill)
            .filter(
                or_(
                    Bill.policy_area.is_(None),
                    Bill.summary.is_(None),
                    Bill.introduced_date.is_(None),
                    Bill.sponsor_party.is_(None),
                    Bill.cosponsor_party_breakdown.is_(None),
                    Bill.bipartisan_type.is_(None),
                    and_(Bill.voted_date.is_(None), has_votes),
                )
            )
            .order_by(Bill.id)
            .all()
        )
        stats["bills_pending"] = len(bills)
        print(
            f"Found {len(bills)} bill(s) missing policy area, summary, "
            "dates, and/or sponsorship fields."
        )

        for index, bill in enumerate(bills, start=1):
            parsed = parse_bill_id(bill.id)
            if parsed is None:
                print(f"[{index}/{len(bills)}] Skipping unparseable id {bill.id!r}.")
                stats["bills_failed"] += 1
                continue

            congress, bill_type, number = parsed
            print(f"[{index}/{len(bills)}] {bill.id} — enriching...")
            changed = False
            detail = None

            needs_detail = (
                bill.introduced_date is None
                or bill.sponsor_party is None
                or bill.cosponsor_party_breakdown is None
                or bill.bipartisan_type is None
            )
            if needs_detail:
                try:
                    detail = fetch_bill_detail(congress, bill_type, number)
                except requests.HTTPError as exc:
                    status = getattr(exc.response, "status_code", "?")
                    print(
                        f"  HTTP {status} fetching bill detail; "
                        "skipping introduced date and sponsorship."
                    )
                    stats["bills_failed"] += 1
                except (requests.RequestException, RuntimeError) as exc:
                    print(f"  Failed to fetch bill detail: {exc}")
                    stats["bills_failed"] += 1

            if bill.introduced_date is None and detail is not None:
                introduced_date = _introduced_date_from_detail(detail)
                if introduced_date:
                    bill.introduced_date = introduced_date
                    stats["introduced_dates_set"] += 1
                    changed = True
                    print(f"  introduced_date={introduced_date.isoformat()}")
                else:
                    print("  No introducedDate on bill detail.")

            if detail is not None and (
                bill.sponsor_party is None
                or bill.cosponsor_party_breakdown is None
                or bill.bipartisan_type is None
            ):
                sponsor_party, breakdown, bipartisan_type = _load_sponsorship_fields(
                    congress, bill_type, number, detail
                )
                if bill.sponsor_party is None and sponsor_party:
                    bill.sponsor_party = sponsor_party
                    stats["sponsor_party_set"] += 1
                    changed = True
                    print(f"  sponsor_party={sponsor_party!r}")
                if bill.cosponsor_party_breakdown is None and breakdown is not None:
                    bill.cosponsor_party_breakdown = breakdown
                    stats["cosponsor_breakdowns_set"] += 1
                    changed = True
                    print(f"  cosponsor_party_breakdown={breakdown}")
                if bill.bipartisan_type is None and bipartisan_type:
                    bill.bipartisan_type = bipartisan_type
                    changed = True
                    print(f"  bipartisan_type={bipartisan_type}")

            if bill.policy_area is None:
                try:
                    subjects = fetch_bill_subjects(congress, bill_type, number)
                    policy_area = _policy_area_from_subjects(subjects)
                    if policy_area:
                        bill.policy_area = policy_area
                        stats["policy_areas_set"] += 1
                        changed = True
                        print(f"  policy_area={policy_area!r}")
                    else:
                        print("  No policyArea on subjects response.")
                except requests.HTTPError as exc:
                    status = getattr(exc.response, "status_code", "?")
                    print(f"  HTTP {status} fetching subjects; skipping policy area.")
                    stats["bills_failed"] += 1
                except (requests.RequestException, RuntimeError) as exc:
                    print(f"  Failed to fetch subjects: {exc}")
                    stats["bills_failed"] += 1

            if bill.voted_date is None:
                vote_exists = (
                    session.query(Vote.id).filter_by(bill_id=bill.id).first()
                    is not None
                )
                if vote_exists:
                    try:
                        actions = fetch_bill_actions(congress, bill_type, number)
                        voted_date = _latest_vote_date(actions)
                        if voted_date:
                            bill.voted_date = voted_date
                            stats["voted_dates_set"] += 1
                            changed = True
                            print(f"  voted_date={voted_date.isoformat()}")
                        else:
                            print("  No recorded vote date on actions response.")
                    except requests.HTTPError as exc:
                        status = getattr(exc.response, "status_code", "?")
                        print(
                            f"  HTTP {status} fetching actions; skipping vote date."
                        )
                        stats["bills_failed"] += 1
                    except (requests.RequestException, RuntimeError) as exc:
                        print(f"  Failed to fetch actions: {exc}")
                        stats["bills_failed"] += 1

            if bill.summary is None:
                try:
                    summaries = fetch_bill_summaries(congress, bill_type, number)
                    summary = _latest_summary_text(summaries)
                    if summary:
                        bill.summary = summary
                        stats["summaries_set"] += 1
                        changed = True
                        preview = summary.replace("\n", " ")[:80]
                        print(f"  summary={preview!r}")
                    else:
                        print("  No CRS summary on summaries response.")
                except requests.HTTPError as exc:
                    status = getattr(exc.response, "status_code", "?")
                    print(f"  HTTP {status} fetching summaries; skipping summary.")
                    stats["bills_failed"] += 1
                except (requests.RequestException, RuntimeError) as exc:
                    print(f"  Failed to fetch summaries: {exc}")
                    stats["bills_failed"] += 1

            if changed:
                session.commit()
            else:
                stats["bills_unchanged"] += 1

        velocity_stats = refresh_bill_velocity(session)
        session.commit()
        stats["velocity_bills_scored"] = velocity_stats["bills_scored"]
        stats["days_to_vote_set"] = velocity_stats["days_to_vote_set"]
        stats["velocity_buckets_set"] = velocity_stats["velocity_buckets_set"]
        stats["velocity_mean"] = velocity_stats["mean"]
        stats["velocity_std"] = velocity_stats["std"]
        return stats
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def fetch_recent_bills(limit=50, congress=CURRENT_CONGRESS):
    path = f"/bill/{congress}" if congress else "/bill"
    payload = congress_get(path, params={"limit": limit, "format": "json"})
    return payload.get("bills", [])


def fetch_bill_detail(congress, bill_type, number):
    path = f"/bill/{congress}/{str(bill_type).lower()}/{number}"
    payload = congress_get(path, params={"format": "json"})
    return payload.get("bill") or payload


def fetch_bill_actions(congress, bill_type, number):
    url = f"{BASE_URL}/bill/{congress}/{str(bill_type).lower()}/{number}/actions"
    params = {"limit": PAGE_SIZE, "format": "json"}
    actions = []

    while url:
        payload = congress_get(url, params=params)
        actions.extend(payload.get("actions", []))
        url = payload.get("pagination", {}).get("next")
        params = None

    return actions


def fetch_house_vote_members(congress, session_number, roll_number):
    url = (
        f"{BASE_URL}/house-vote/{congress}/{session_number}/{roll_number}/members"
    )
    params = {"limit": PAGE_SIZE, "format": "json"}
    members = []

    while url:
        payload = congress_get(url, params=params)
        inner = payload.get("houseRollCallVoteMemberVotes") or {}
        members.extend(inner.get("results") or [])
        url = (payload.get("pagination") or {}).get("next")
        if not url:
            url = (inner.get("pagination") or {}).get("next")
        params = None

    return members


def _sponsor_record(detail):
    sponsors = detail.get("sponsors") or []
    if not sponsors:
        return {}
    return sponsors[0] or {}


def _party_name_from_code(value):
    """Map Congress.gov party codes (D, R, I) to stored full names."""
    if not value:
        return None
    stripped = str(value).strip()
    if not stripped:
        return None
    return normalize_party(stripped)


def _is_withdrawn_cosponsor(cosponsor):
    return bool(cosponsor.get("sponsorshipWithdrawnDate"))


def _cosponsor_party_breakdown(cosponsors):
    """Count current (non-withdrawn) cosponsors by party name."""
    counts = {}
    for item in cosponsors or []:
        if _is_withdrawn_cosponsor(item):
            continue
        party = _party_name_from_code(item.get("party") or item.get("partyName"))
        if not party:
            continue
        counts[party] = counts.get(party, 0) + 1
    return dict(sorted(counts.items()))


def _sponsorship_fields(detail, cosponsors):
    sponsor = _sponsor_record(detail)
    sponsor_party = _party_name_from_code(
        sponsor.get("party") or sponsor.get("partyName")
    )
    breakdown = _cosponsor_party_breakdown(cosponsors)
    return sponsor_party, breakdown, classify_bipartisan_type(sponsor_party, breakdown)


def _load_sponsorship_fields(congress, bill_type, number, detail):
    """Sponsor party from bill detail; cosponsor counts from /cosponsors.

    If the cosponsors request fails, still save sponsor_party and leave
    cosponsor counts / bipartisan_type unset so we do not mis-classify.
    """
    sponsor = _sponsor_record(detail)
    sponsor_party = _party_name_from_code(
        sponsor.get("party") or sponsor.get("partyName")
    )
    try:
        cosponsors = fetch_bill_cosponsors(congress, bill_type, number)
    except requests.HTTPError as exc:
        status = getattr(exc.response, "status_code", "?")
        print(f"  HTTP {status} fetching cosponsors; skipping party breakdown.")
        return sponsor_party, None, None
    except (requests.RequestException, RuntimeError) as exc:
        print(f"  Failed to fetch cosponsors: {exc}")
        return sponsor_party, None, None
    return _sponsorship_fields(detail, cosponsors)


def fetch_bill_cosponsors(congress, bill_type, number):
    """All cosponsors for a bill, following Congress.gov pagination."""
    url = f"{BASE_URL}/bill/{congress}/{str(bill_type).lower()}/{number}/cosponsors"
    params = {"limit": PAGE_SIZE, "format": "json"}
    cosponsors = []

    while url:
        payload = congress_get(url, params=params)
        cosponsors.extend(payload.get("cosponsors") or [])
        url = (payload.get("pagination") or {}).get("next")
        params = None

    return cosponsors


def _sponsor_display_name(sponsor):
    if not sponsor:
        return None
    full_name = (sponsor.get("fullName") or "").strip()
    if full_name:
        return full_name
    parts = [
        sponsor.get("firstName"),
        sponsor.get("middleName"),
        sponsor.get("lastName"),
    ]
    joined = " ".join(part for part in parts if part)
    return joined or None


def _resolve_sponsor_id(bioguide_id, official_ids):
    if not bioguide_id:
        return None
    if bioguide_id not in official_ids:
        return None
    return bioguide_id


def upsert_bill(
    session,
    bill_id,
    title,
    sponsor_id,
    sponsor_bioguide_id=None,
    sponsor_name=None,
    sponsor_party=None,
    cosponsor_party_breakdown=None,
    bipartisan_type=None,
    policy_area=None,
    summary=None,
    introduced_date=None,
    voted_date=None,
):
    existing = session.get(Bill, bill_id)
    session.merge(
        Bill(
            id=bill_id,
            title=title,
            sponsor_id=sponsor_id,
            sponsor_bioguide_id=sponsor_bioguide_id,
            sponsor_name=sponsor_name,
            sponsor_party=(
                sponsor_party
                if sponsor_party is not None
                else (existing.sponsor_party if existing else None)
            ),
            cosponsor_party_breakdown=(
                cosponsor_party_breakdown
                if cosponsor_party_breakdown is not None
                else (existing.cosponsor_party_breakdown if existing else None)
            ),
            bipartisan_type=(
                bipartisan_type
                if bipartisan_type is not None
                else (existing.bipartisan_type if existing else None)
            ),
            policy_area=(
                policy_area
                if policy_area is not None
                else (existing.policy_area if existing else None)
            ),
            summary=(
                summary if summary is not None else (existing.summary if existing else None)
            ),
            introduced_date=(
                introduced_date
                if introduced_date is not None
                else (existing.introduced_date if existing else None)
            ),
            voted_date=(
                voted_date
                if voted_date is not None
                else (existing.voted_date if existing else None)
            ),
            days_to_vote=existing.days_to_vote if existing else None,
            velocity_bucket=existing.velocity_bucket if existing else None,
        )
    )
    session.flush()


def ensure_bill_from_senate_vote(session, bill_id, title, voted_date=None):
    """Create a bills row from Senate XML when Congress.gov has not ingested it.

    Existing rows are left in place; voted_date is advanced if the roll call is
    newer. Returns (bill, created).
    """
    existing = session.get(Bill, bill_id)
    if existing is not None:
        if voted_date is not None and (
            existing.voted_date is None or voted_date > existing.voted_date
        ):
            existing.voted_date = voted_date
        return existing, False
    upsert_bill(
        session,
        bill_id,
        title or bill_id,
        sponsor_id=None,
        voted_date=voted_date,
    )
    return session.get(Bill, bill_id), True


def _log_missing_official_sponsor(bill_id, bioguide_id, sponsor_name):
    label = sponsor_name or "unknown name"
    print(
        f"  WARNING: {bill_id} sponsor {bioguide_id} ({label}) is not in officials. "
        "The roster ingest did not include this member. "
        "Saving their Congress.gov identity on the bill with sponsor_id=NULL."
    )


def _recorded_votes_from_actions(actions):
    """Unique roll calls, oldest first so the latest position wins on upsert."""
    seen = set()
    recorded = []
    for action in actions:
        for vote in action.get("recordedVotes") or []:
            key = (
                vote.get("chamber"),
                vote.get("congress"),
                vote.get("sessionNumber"),
                vote.get("rollNumber"),
            )
            if key in seen:
                continue
            seen.add(key)
            recorded.append(vote)
    recorded.sort(key=lambda item: item.get("date") or "")
    return recorded


def sync_senate_votes(
    congress,
    session,
    vote_number,
    db_session=None,
    senator_lookup=None,
    expected_bill_id=None,
    roll_calls=None,
):
    """Fetch one Senate.gov roll-call XML and upsert member positions.

    Senators are matched to `officials` by last name and state (Senate XML
    uses postal abbreviations; Congress.gov stores full state names).
    Positions upsert on (official_id, bill_id) so re-runs are idempotent.
    """
    owns_session = db_session is None
    if owns_session:
        db_session = SessionLocal()
    if roll_calls is None:
        roll_calls = load_senate_roll_calls(db_session, congress, session)

    stats = {
        "congress": congress,
        "session": session,
        "vote_number": vote_number,
        "bill_id": expected_bill_id,
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped_unknown_officials": 0,
        "skipped_no_bill": False,
        "bill_created": False,
        "not_found": False,
    }

    try:
        xml_bytes = fetch_senate_vote_xml(congress, session, vote_number)
        if xml_bytes is None:
            stats["not_found"] = True
            upsert_senate_roll_call(
                db_session,
                roll_calls,
                congress,
                session,
                vote_number,
                SENATE_ROLL_CALL_NOT_FOUND,
                bill_id=expected_bill_id,
            )
            print(
                f"  Senate roll call {vote_number} "
                f"(congress {congress}, session {session}) was not found."
            )
            if owns_session:
                db_session.commit()
            return stats

        parsed = parse_senate_vote_xml(xml_bytes, congress=congress)
        bill_id = expected_bill_id or parsed["bill_id"]
        stats["bill_id"] = bill_id
        if not bill_id:
            stats["skipped_no_bill"] = True
            upsert_senate_roll_call(
                db_session,
                roll_calls,
                congress,
                session,
                vote_number,
                SENATE_ROLL_CALL_SKIPPED_NO_BILL,
            )
            print(
                f"  Skipping Senate roll call {vote_number}; "
                "XML is not tied to a bill (nomination or treaty)."
            )
            if owns_session:
                db_session.commit()
            return stats

        existing_bill, created = ensure_bill_from_senate_vote(
            db_session,
            bill_id,
            parsed.get("bill_title"),
            voted_date=parsed.get("vote_date"),
        )
        if existing_bill is None:
            stats["skipped_no_bill"] = True
            upsert_senate_roll_call(
                db_session,
                roll_calls,
                congress,
                session,
                vote_number,
                SENATE_ROLL_CALL_SKIPPED_NO_BILL,
                bill_id=bill_id,
            )
            print(
                f"  Skipping Senate roll call {vote_number}; "
                f"could not create bills row {bill_id}."
            )
            if owns_session:
                db_session.commit()
            return stats
        if created:
            stats["bill_created"] = True
            print(f"  Created bill {bill_id} from Senate XML.")

        if senator_lookup is None:
            senator_lookup = load_senator_lookup(db_session)

        latest_by_official, unknown = _positions_from_senate_members(
            parsed["members"],
            senator_lookup,
        )
        stats["skipped_unknown_officials"] = len(unknown)
        if unknown:
            preview = ", ".join(unknown[:5])
            extra = f" (+{len(unknown) - 5} more)" if len(unknown) > 5 else ""
            print(
                f"  Senate roll call {vote_number}: "
                f"{len(unknown)} senator(s) not in officials: {preview}{extra}"
            )

        vote_stats = _apply_vote_positions(
            db_session, bill_id, latest_by_official
        )
        stats.update(vote_stats)

        vote_date = parsed.get("vote_date")
        if vote_date is not None:
            if existing_bill.voted_date is None or vote_date > existing_bill.voted_date:
                existing_bill.voted_date = vote_date

        upsert_senate_roll_call(
            db_session,
            roll_calls,
            congress,
            session,
            vote_number,
            SENATE_ROLL_CALL_INGESTED,
            bill_id=bill_id,
        )

        if owns_session:
            db_session.commit()
        return stats
    except Exception:
        if owns_session:
            db_session.rollback()
        raise
    finally:
        if owns_session:
            db_session.close()


def _empty_senate_session_stats(congress, session):
    return {
        "congress": congress,
        "session": session,
        "menu_votes": 0,
        "latest_vote_number": None,
        "fetched": 0,
        "already_done": 0,
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped_nominations": 0,
        "skipped_no_bill": 0,
        "bills_created": 0,
        "skipped_unknown_officials": 0,
        "not_found": 0,
        "failed": 0,
        "menu_missing": False,
    }


def _senate_menu_row_needs_fetch(row, tracked, congress):
    """Return (should_fetch, skip_reason) for one vote-menu row.

    skip_reason is 'done', 'nomination', or None if we should fetch XML.
    Missing bills are no longer skipped: Senate XML creates a stub row.
    """
    if tracked is not None and tracked.status in SENATE_ROLL_CALL_TERMINAL:
        return False, "done"

    if not senate_menu_has_legislation(row["issues"], congress):
        return False, "nomination"

    return True, None


def sync_senate_session_votes(
    congress,
    session,
    db_session=None,
    senator_lookup=None,
    bill_ids=None,
    roll_calls=None,
):
    """Ingest new Senate member votes for one congress/session.

    Compares the Senate.gov vote menu to `senate_roll_calls`. Nominations are
    recorded without fetching XML. Legislation roll calls are fetched if they
    are new, previously failed, or were skipped because the bill was missing.
    Missing bills are created from the Senate XML. Oldest-first so the latest
    roll call on a bill wins.
    """
    owns_session = db_session is None
    if owns_session:
        db_session = SessionLocal()

    stats = _empty_senate_session_stats(congress, session)

    try:
        menu_xml = fetch_senate_vote_menu(congress, session)
        if menu_xml is None:
            stats["menu_missing"] = True
            print(
                f"  Senate vote menu for congress {congress} session {session} "
                "was not found."
            )
            return stats

        menu = parse_senate_vote_menu(menu_xml, congress=congress)
        rows = menu["votes"]
        stats["menu_votes"] = len(rows)
        if rows:
            stats["latest_vote_number"] = rows[-1]["vote_number"]
        print(
            f"Senate vote menu: congress {congress} session {session} "
            f"has {len(rows)} roll calls"
            + (
                f" (latest #{stats['latest_vote_number']})."
                if stats["latest_vote_number"]
                else "."
            )
        )

        if senator_lookup is None:
            senator_lookup = load_senator_lookup(db_session)
        if bill_ids is None:
            bill_ids = load_bill_ids(db_session)
        if roll_calls is None:
            roll_calls = load_senate_roll_calls(db_session, congress, session)

        to_fetch = []
        for row in rows:
            key = senate_roll_call_key(congress, session, row["vote_number"])
            tracked = roll_calls.get(key)
            should_fetch, skip_reason = _senate_menu_row_needs_fetch(
                row, tracked, congress
            )
            if skip_reason == "done":
                stats["already_done"] += 1
                continue
            if skip_reason == "nomination":
                stats["skipped_nominations"] += 1
                upsert_senate_roll_call(
                    db_session,
                    roll_calls,
                    congress,
                    session,
                    row["vote_number"],
                    SENATE_ROLL_CALL_SKIPPED_NOMINATION,
                )
                continue
            if should_fetch:
                to_fetch.append(row)

        print(
            f"  Fetching {len(to_fetch)} new/retry roll calls "
            f"(already done={stats['already_done']}, "
            f"nominations={stats['skipped_nominations']})."
        )
        if owns_session:
            db_session.commit()

        if not to_fetch:
            print("  Caught up; no Senate.gov XML to request.")
            return stats

        for index, row in enumerate(to_fetch, start=1):
            vote_number = row["vote_number"]
            issue = row["issue"] or "unlisted measure"
            print(
                f"[{index}/{len(to_fetch)}] Senate roll call {vote_number} "
                f"({issue})..."
            )
            try:
                vote_stats = sync_senate_votes(
                    congress,
                    session,
                    vote_number,
                    db_session=db_session,
                    senator_lookup=senator_lookup,
                    roll_calls=roll_calls,
                )
            except (requests.RequestException, RuntimeError, ET.ParseError) as exc:
                print(f"  FAILED vote {vote_number}: {exc}")
                stats["failed"] += 1
                if owns_session:
                    db_session.rollback()
                roll_calls.pop(
                    senate_roll_call_key(congress, session, vote_number), None
                )
                upsert_senate_roll_call(
                    db_session,
                    roll_calls,
                    congress,
                    session,
                    vote_number,
                    SENATE_ROLL_CALL_FAILED,
                    bill_id=row["bill_ids"][0] if row["bill_ids"] else None,
                )
                if owns_session:
                    db_session.commit()
                continue

            stats["fetched"] += 1
            stats["inserted"] += vote_stats["inserted"]
            stats["updated"] += vote_stats["updated"]
            stats["unchanged"] += vote_stats["unchanged"]
            stats["skipped_unknown_officials"] += vote_stats[
                "skipped_unknown_officials"
            ]
            if vote_stats["not_found"]:
                stats["not_found"] += 1
            if vote_stats["skipped_no_bill"]:
                stats["skipped_no_bill"] += 1
            if vote_stats.get("bill_created"):
                stats["bills_created"] += 1
            if owns_session:
                db_session.commit()

        return stats
    except Exception:
        if owns_session:
            db_session.rollback()
        raise
    finally:
        if owns_session:
            db_session.close()


def sync_senate_congress_votes(congress, sessions=SENATE_SESSIONS):
    """Backfill Senate member votes for every session of a congress."""
    results = []
    for index, session in enumerate(sessions, start=1):
        print(
            f"\n=== [{index}/{len(sessions)}] Senate congress {congress} "
            f"session {session} ==="
        )
        stats = sync_senate_session_votes(congress, session)
        results.append(stats)
        if stats["menu_missing"]:
            print(f"  No vote menu for session {session}; skipping.")
    return results


def sync_bill_votes(
    congress,
    bill_type,
    bill_number,
    session=None,
    official_ids=None,
    ensure_bill=True,
):
    """Ingest House and Senate roll-call positions for a bill into `votes`.

    House member votes come from Congress.gov. Senate member votes come from
    Senate.gov roll-call XML, matched to officials by last name and state.
    Multiple roll calls on the same bill collapse to one row per official;
    the latest roll call's position is kept.
    """
    owns_session = session is None
    if owns_session:
        session = SessionLocal()

    stats = {
        "bill_id": make_bill_id(congress, bill_type, bill_number),
        "house_roll_calls": 0,
        "senate_roll_calls": 0,
        "senate_roll_calls_skipped": 0,
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped_unknown_officials": 0,
    }

    try:
        if official_ids is None:
            official_ids = load_official_ids(session)

        bill_id = stats["bill_id"]
        existing_bill = session.get(Bill, bill_id)
        if existing_bill is None and ensure_bill:
            detail = fetch_bill_detail(congress, bill_type, bill_number)
            sponsor = _sponsor_record(detail)
            bioguide_id = sponsor.get("bioguideId")
            sponsor_name = _sponsor_display_name(sponsor)
            sponsor_id = _resolve_sponsor_id(bioguide_id, official_ids)
            if bioguide_id and sponsor_id is None:
                _log_missing_official_sponsor(bill_id, bioguide_id, sponsor_name)
            sponsor_party, breakdown, bipartisan_type = _load_sponsorship_fields(
                congress, bill_type, bill_number, detail
            )
            upsert_bill(
                session,
                bill_id,
                detail.get("title"),
                sponsor_id,
                sponsor_bioguide_id=bioguide_id,
                sponsor_name=sponsor_name,
                sponsor_party=sponsor_party,
                cosponsor_party_breakdown=breakdown,
                bipartisan_type=bipartisan_type,
                introduced_date=_introduced_date_from_detail(detail),
            )
        elif existing_bill is None:
            print(f"  Skipping votes for {bill_id}; bill is not in the database.")
            return stats

        actions = fetch_bill_actions(congress, bill_type, bill_number)
        vote_date = _latest_vote_date(actions)
        if vote_date is not None:
            bill_row = session.get(Bill, bill_id)
            if bill_row is not None:
                bill_row.voted_date = vote_date
        recorded = _recorded_votes_from_actions(actions)
        latest_by_official = {}
        unknown_officials = set()
        senator_lookup = None

        for vote in recorded:
            session_number = vote.get("sessionNumber")
            roll_number = vote.get("rollNumber")
            chamber = (vote.get("chamber") or "").strip().lower()

            if chamber == "senate":
                if session_number is None or roll_number is None:
                    stats["senate_roll_calls_skipped"] += 1
                    continue
                if senator_lookup is None:
                    senator_lookup = load_senator_lookup(session)
                stats["senate_roll_calls"] += 1
                print(
                    f"  Senate roll call {roll_number} "
                    f"(congress {vote.get('congress') or congress}, "
                    f"session {session_number})"
                )
                senate_stats = sync_senate_votes(
                    vote.get("congress") or congress,
                    session_number,
                    roll_number,
                    db_session=session,
                    senator_lookup=senator_lookup,
                    expected_bill_id=bill_id,
                )
                stats["inserted"] += senate_stats["inserted"]
                stats["updated"] += senate_stats["updated"]
                stats["unchanged"] += senate_stats["unchanged"]
                stats["skipped_unknown_officials"] += senate_stats[
                    "skipped_unknown_officials"
                ]
                if senate_stats["not_found"] or senate_stats["skipped_no_bill"]:
                    stats["senate_roll_calls_skipped"] += 1
                continue

            if chamber != "house":
                stats["senate_roll_calls_skipped"] += 1
                print(
                    f"  Skipping {vote.get('chamber')} roll call "
                    f"{vote.get('rollNumber')} on {bill_id}."
                )
                continue

            if session_number is None or roll_number is None:
                continue

            stats["house_roll_calls"] += 1
            print(
                f"  House roll call {roll_number} "
                f"(congress {vote.get('congress')}, session {session_number})"
            )
            members = fetch_house_vote_members(
                vote.get("congress") or congress,
                session_number,
                roll_number,
            )
            for member in members:
                bioguide_id = member.get("bioguideID") or member.get("bioguideId")
                if not bioguide_id:
                    continue
                if bioguide_id not in official_ids:
                    unknown_officials.add(bioguide_id)
                    continue
                position = normalize_position(member.get("voteCast"))
                if not position:
                    continue
                latest_by_official[bioguide_id] = position

        stats["skipped_unknown_officials"] += len(unknown_officials)

        house_stats = _apply_vote_positions(
            session, bill_id, latest_by_official
        )
        stats["inserted"] += house_stats["inserted"]
        stats["updated"] += house_stats["updated"]
        stats["unchanged"] += house_stats["unchanged"]

        if owns_session:
            session.commit()
        return stats
    except Exception:
        if owns_session:
            session.rollback()
        raise
    finally:
        if owns_session:
            session.close()


def sync_recent_bills(limit=50, congress=CURRENT_CONGRESS, sync_votes=True):
    """Fetch recent bills, upsert them, and optionally ingest roll-call votes."""
    _require_api_key()
    ensure_schema()
    session = SessionLocal()
    stats = {
        "bills_fetched": 0,
        "bills_upserted": 0,
        "bills_with_sponsor": 0,
        "bills_without_sponsor": 0,
        "bills_missing_official": 0,
        "bills_with_cosponsors": 0,
        "missing_sponsors": [],
        "votes_inserted": 0,
        "votes_updated": 0,
        "votes_unchanged": 0,
        "votes_skipped_unknown_officials": 0,
        "senate_roll_calls": 0,
        "senate_roll_calls_skipped": 0,
        "house_roll_calls": 0,
    }

    try:
        official_ids = load_official_ids(session)
        bills = fetch_recent_bills(limit=limit, congress=congress)
        stats["bills_fetched"] = len(bills)
        print(f"Fetched {len(bills)} bills from Congress.gov.")

        for index, item in enumerate(bills, start=1):
            item_congress = item.get("congress") or congress
            bill_type = item.get("type")
            number = item.get("number")
            if not item_congress or not bill_type or number is None:
                print(f"[{index}/{len(bills)}] Skipping bill with missing identifiers.")
                continue

            bill_id = make_bill_id(item_congress, bill_type, number)
            print(
                f"[{index}/{len(bills)}] {bill_id} — fetching detail..."
            )
            detail = fetch_bill_detail(item_congress, bill_type, number)
            title = detail.get("title") or item.get("title")
            sponsor = _sponsor_record(detail)
            bioguide_id = sponsor.get("bioguideId")
            sponsor_name = _sponsor_display_name(sponsor)
            sponsor_id = _resolve_sponsor_id(bioguide_id, official_ids)
            if bioguide_id and sponsor_id is None:
                _log_missing_official_sponsor(bill_id, bioguide_id, sponsor_name)
                stats["bills_missing_official"] += 1
                stats["missing_sponsors"].append(
                    {
                        "bill_id": bill_id,
                        "bioguide_id": bioguide_id,
                        "name": sponsor_name,
                    }
                )

            sponsor_party, breakdown, bipartisan_type = _load_sponsorship_fields(
                item_congress, bill_type, number, detail
            )
            upsert_bill(
                session,
                bill_id,
                title,
                sponsor_id,
                sponsor_bioguide_id=bioguide_id,
                sponsor_name=sponsor_name,
                sponsor_party=sponsor_party,
                cosponsor_party_breakdown=breakdown,
                bipartisan_type=bipartisan_type,
                introduced_date=_introduced_date_from_detail(detail),
            )
            stats["bills_upserted"] += 1
            if sponsor_id:
                stats["bills_with_sponsor"] += 1
            elif not bioguide_id:
                stats["bills_without_sponsor"] += 1
            if breakdown is not None:
                stats["bills_with_cosponsors"] += 1

            title_preview = (title or "")[:80]
            print(
                f"  Upserted {bill_id} sponsor={sponsor_id or 'NULL'} "
                f"sponsor_name={sponsor_name or 'NULL'!r} "
                f"sponsor_party={sponsor_party or 'NULL'!r} "
                f"bipartisan_type={bipartisan_type or 'NULL'} "
                f"cosponsors={breakdown if breakdown is not None else 'NULL'} "
                f"title={title_preview!r}"
            )

            if sync_votes:
                vote_stats = sync_bill_votes(
                    item_congress,
                    bill_type,
                    number,
                    session=session,
                    official_ids=official_ids,
                    ensure_bill=False,
                )
                stats["votes_inserted"] += vote_stats["inserted"]
                stats["votes_updated"] += vote_stats["updated"]
                stats["votes_unchanged"] += vote_stats["unchanged"]
                stats["votes_skipped_unknown_officials"] += vote_stats[
                    "skipped_unknown_officials"
                ]
                stats["senate_roll_calls"] += vote_stats.get("senate_roll_calls", 0)
                stats["senate_roll_calls_skipped"] += vote_stats[
                    "senate_roll_calls_skipped"
                ]
                stats["house_roll_calls"] += vote_stats["house_roll_calls"]
                print(
                    f"  Votes: inserted={vote_stats['inserted']} "
                    f"updated={vote_stats['updated']} "
                    f"unchanged={vote_stats['unchanged']}"
                )

            session.commit()

        return stats
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _print_bill_stats(stats):
    print("\nIngest summary")
    print(f"  Bills fetched:              {stats['bills_fetched']}")
    print(f"  Bills upserted:             {stats['bills_upserted']}")
    print(f"  Bills with linked official: {stats['bills_with_sponsor']}")
    print(f"  Bills with no sponsor:      {stats['bills_without_sponsor']}")
    print(f"  Sponsors missing from roster: {stats['bills_missing_official']}")
    print(f"  Bills with cosponsor counts: {stats.get('bills_with_cosponsors', 0)}")
    if stats["missing_sponsors"]:
        print("  Missing roster members:")
        for missing in stats["missing_sponsors"]:
            print(
                f"    {missing['bill_id']}: {missing['bioguide_id']} "
                f"({missing['name'] or 'unknown name'})"
            )
    print(f"  House roll calls ingested:  {stats['house_roll_calls']}")
    print(f"  Senate roll calls ingested: {stats.get('senate_roll_calls', 0)}")
    print(f"  Senate roll calls skipped:  {stats['senate_roll_calls_skipped']}")
    print(f"  Votes inserted:             {stats['votes_inserted']}")
    print(f"  Votes updated:              {stats['votes_updated']}")
    print(f"  Votes unchanged:            {stats['votes_unchanged']}")
    print(
        f"  Votes skipped (no official): {stats['votes_skipped_unknown_officials']}"
    )


def _print_vote_stats(stats):
    print("\nVote ingest summary")
    print(f"  Bill:                       {stats['bill_id']}")
    print(f"  House roll calls ingested:  {stats['house_roll_calls']}")
    print(f"  Senate roll calls ingested: {stats.get('senate_roll_calls', 0)}")
    print(f"  Senate roll calls skipped:  {stats['senate_roll_calls_skipped']}")
    print(f"  Votes inserted:             {stats['inserted']}")
    print(f"  Votes updated:              {stats['updated']}")
    print(f"  Votes unchanged:            {stats['unchanged']}")
    print(f"  Votes skipped (no official): {stats['skipped_unknown_officials']}")


def _print_senate_vote_stats(stats):
    print("\nSenate vote ingest summary")
    print(f"  Congress:                   {stats['congress']}")
    print(f"  Session:                    {stats['session']}")
    print(f"  Vote number:                {stats['vote_number']}")
    print(f"  Bill:                       {stats['bill_id'] or 'none'}")
    if stats["not_found"]:
        print("  Result:                     XML not found")
        return
    if stats["skipped_no_bill"]:
        print("  Result:                     skipped (no matching bill)")
        return
    print(f"  Votes inserted:             {stats['inserted']}")
    print(f"  Votes updated:              {stats['updated']}")
    print(f"  Votes unchanged:            {stats['unchanged']}")
    print(f"  Votes skipped (no official): {stats['skipped_unknown_officials']}")


def _print_senate_session_stats(stats):
    print(f"\nSenate session {stats['session']} ingest summary")
    print(f"  Congress:                   {stats['congress']}")
    if stats["menu_missing"]:
        print("  Result:                     vote menu not found")
        return
    print(f"  Menu roll calls:            {stats['menu_votes']}")
    print(f"  Latest vote number:         {stats.get('latest_vote_number') or 'none'}")
    print(f"  Already ingested/skipped:   {stats.get('already_done', 0)}")
    print(f"  XML fetched:                {stats['fetched']}")
    print(f"  Bills created from XML:     {stats.get('bills_created', 0)}")
    print(f"  Skipped nominations:        {stats['skipped_nominations']}")
    print(f"  Skipped (no matching bill): {stats['skipped_no_bill']}")
    print(f"  XML not found:              {stats['not_found']}")
    print(f"  Fetch/parse failures:       {stats['failed']}")
    print(f"  Votes inserted:             {stats['inserted']}")
    print(f"  Votes updated:              {stats['updated']}")
    print(f"  Votes unchanged:            {stats['unchanged']}")
    print(f"  Votes skipped (no official): {stats['skipped_unknown_officials']}")


def _print_senate_congress_stats(results):
    print("\nSenate congress ingest summary")
    print(f"  Sessions:                   {len(results)}")
    print(f"  Menu roll calls:            {sum(item['menu_votes'] for item in results)}")
    print(
        f"  Already ingested/skipped:   "
        f"{sum(item.get('already_done', 0) for item in results)}"
    )
    print(f"  XML fetched:                {sum(item['fetched'] for item in results)}")
    print(
        f"  Bills created from XML:     "
        f"{sum(item.get('bills_created', 0) for item in results)}"
    )
    print(
        f"  Skipped nominations:        "
        f"{sum(item['skipped_nominations'] for item in results)}"
    )
    print(
        f"  Skipped (no matching bill): "
        f"{sum(item['skipped_no_bill'] for item in results)}"
    )
    print(f"  Fetch/parse failures:       {sum(item['failed'] for item in results)}")
    print(f"  Votes inserted:             {sum(item['inserted'] for item in results)}")
    print(f"  Votes updated:              {sum(item['updated'] for item in results)}")
    print(f"  Votes unchanged:            {sum(item['unchanged'] for item in results)}")
    for item in results:
        _print_senate_session_stats(item)


def _print_sponsor_stats(stats):
    print("\nSponsor backfill summary")
    print(f"  Distinct missing bioguide IDs: {stats['missing_ids']}")
    print(f"  Officials upserted:            {stats['officials_upserted']}")
    print(f"  Member fetches failed:         {stats['officials_failed']}")
    print(f"  Bills linked to officials:     {stats['bills_linked']}")


def _print_enrichment_stats(stats):
    print("\nBill enrichment summary")
    print(f"  Bills missing fields:   {stats['bills_pending']}")
    print(f"  Policy areas set:       {stats['policy_areas_set']}")
    print(f"  Summaries set:          {stats['summaries_set']}")
    print(f"  Introduced dates set:   {stats['introduced_dates_set']}")
    print(f"  Vote dates set:         {stats['voted_dates_set']}")
    print(f"  Sponsor parties set:    {stats.get('sponsor_party_set', 0)}")
    print(f"  Cosponsor breakdowns:   {stats.get('cosponsor_breakdowns_set', 0)}")
    print(f"  Unchanged (no data):    {stats['bills_unchanged']}")
    print(f"  Fetch/parse failures:   {stats['bills_failed']}")
    print(f"  Velocity bills scored:  {stats.get('velocity_bills_scored', 0)}")
    print(f"  Days-to-vote set:       {stats.get('days_to_vote_set', 0)}")
    print(f"  Velocity buckets set:   {stats.get('velocity_buckets_set', 0)}")
    mean = stats.get("velocity_mean")
    std = stats.get("velocity_std")
    if mean is not None and std is not None:
        print(f"  Velocity μ/σ:           {mean:.1f} / {std:.1f} days")


def main():
    parser = argparse.ArgumentParser(
        description="Ingest Congress.gov members, bills, and roll-call votes."
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=[
            "members",
            "bills",
            "votes",
            "senate-votes",
            "sponsors",
            "backfill-sponsors",
            "enrich",
        ],
        default="bills",
        help="members: current roster. bills: recent bills (default). "
        "votes: House and Senate roll calls for one bill. "
        "senate-votes: Senate.gov roll-call XML (one vote, one session, "
        "an entire congress, or incremental catch-up). "
        "backfill-sponsors: insert missing historical sponsors. "
        "enrich: fill policy area, CRS summary, dates, sponsorship, "
        "and vote-velocity on existing bills.",
    )
    parser.add_argument("--limit", type=int, default=50, help="Bills to fetch (default 50).")
    parser.add_argument(
        "--congress",
        type=int,
        default=CURRENT_CONGRESS,
        help=f"Congress number for bill/vote sync (default {CURRENT_CONGRESS}).",
    )
    parser.add_argument(
        "--session",
        type=int,
        default=1,
        help="Senate session number for senate-votes (1 or 2, default 1).",
    )
    parser.add_argument(
        "--all-sessions",
        action="store_true",
        help="When using senate-votes without --vote-number, ingest sessions "
        "1 and 2 for the congress.",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Catch up Senate.gov roll calls using the vote menu and "
        "senate_roll_calls cursor. Only fetches new or retryable votes.",
    )
    parser.add_argument(
        "--vote-number",
        type=int,
        help="Senate roll-call number for a single senate-votes ingest. "
        "Omit to backfill every legislation roll call in the session.",
    )
    parser.add_argument(
        "--skip-votes",
        action="store_true",
        help="When syncing bills, do not fetch roll-call votes.",
    )
    parser.add_argument("--bill-type", help="Bill type for the votes command, e.g. hr.")
    parser.add_argument("--bill-number", help="Bill number for the votes command, e.g. 1.")
    args = parser.parse_args()

    if args.command == "members":
        members = fetch_current_members()
        saved = save_officials(members)
        print(f"Fetched {len(members)} members and saved {saved} officials.")
        return

    if args.command in {"sponsors", "backfill-sponsors"}:
        sponsor_stats = sync_missing_sponsors()
        _print_sponsor_stats(sponsor_stats)
        return

    if args.command == "enrich":
        enrichment_stats = sync_bill_enrichment()
        _print_enrichment_stats(enrichment_stats)
        return

    if args.command == "votes":
        if not args.bill_type or not args.bill_number:
            parser.error("votes requires --bill-type and --bill-number")
        ensure_schema()
        vote_stats = sync_bill_votes(args.congress, args.bill_type, args.bill_number)
        _print_vote_stats(vote_stats)
        return

    if args.command == "senate-votes":
        if args.vote_number is not None and (args.all_sessions or args.incremental):
            parser.error(
                "senate-votes --vote-number cannot be combined with "
                "--all-sessions or --incremental"
            )
        ensure_schema()
        if args.vote_number is not None:
            senate_stats = sync_senate_votes(
                args.congress, args.session, args.vote_number
            )
            _print_senate_vote_stats(senate_stats)
            return
        if args.all_sessions or args.incremental:
            congress_stats = sync_senate_congress_votes(args.congress)
            _print_senate_congress_stats(congress_stats)
            return
        session_stats = sync_senate_session_votes(args.congress, args.session)
        _print_senate_session_stats(session_stats)
        return

    bill_stats = sync_recent_bills(
        limit=args.limit,
        congress=args.congress,
        sync_votes=not args.skip_votes,
    )
    _print_bill_stats(bill_stats)


if __name__ == "__main__":
    main()
