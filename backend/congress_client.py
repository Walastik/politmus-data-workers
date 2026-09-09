import argparse
import os
import time
from datetime import date, datetime

import requests
from dotenv import load_dotenv
from sqlalchemy import and_, exists, or_

from database import SessionLocal
from init_db import ensure_schema
from models import Bill, Official, Vote

load_dotenv()

BASE_URL = "https://api.congress.gov/v3"
API_KEY = os.getenv("CONGRESS_GOV_API_KEY")
PAGE_SIZE = 250
CURRENT_CONGRESS = 119
REQUEST_PAUSE_SECONDS = 0.2
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1.0

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


def load_official_ids(session):
    return {row[0] for row in session.query(Official.id).all()}


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
    """Fill missing policy area, summary, and bill dates from Congress.gov."""
    _require_api_key()
    ensure_schema()
    session = SessionLocal()
    stats = {
        "bills_pending": 0,
        "policy_areas_set": 0,
        "summaries_set": 0,
        "introduced_dates_set": 0,
        "voted_dates_set": 0,
        "bills_failed": 0,
        "bills_unchanged": 0,
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
                    and_(Bill.voted_date.is_(None), has_votes),
                )
            )
            .order_by(Bill.id)
            .all()
        )
        stats["bills_pending"] = len(bills)
        print(
            f"Found {len(bills)} bill(s) missing policy area, summary, "
            "introduced date, and/or vote date."
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

            if bill.introduced_date is None:
                try:
                    detail = fetch_bill_detail(congress, bill_type, number)
                    introduced_date = _introduced_date_from_detail(detail)
                    if introduced_date:
                        bill.introduced_date = introduced_date
                        stats["introduced_dates_set"] += 1
                        changed = True
                        print(f"  introduced_date={introduced_date.isoformat()}")
                    else:
                        print("  No introducedDate on bill detail.")
                except requests.HTTPError as exc:
                    status = getattr(exc.response, "status_code", "?")
                    print(
                        f"  HTTP {status} fetching bill detail; "
                        "skipping introduced date."
                    )
                    stats["bills_failed"] += 1
                except (requests.RequestException, RuntimeError) as exc:
                    print(f"  Failed to fetch bill detail: {exc}")
                    stats["bills_failed"] += 1

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
        )
    )
    session.flush()


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


def sync_bill_votes(
    congress,
    bill_type,
    bill_number,
    session=None,
    official_ids=None,
    ensure_bill=True,
):
    """Ingest House roll-call positions for a bill into `votes`.

    Senate roll calls are skipped: Congress.gov has no Senate member-vote
    endpoint, and Senate XML uses LIS ids rather than bioguide ids.
    Multiple House roll calls on the same bill collapse to one row per
    official; the latest roll call's position is kept.
    """
    owns_session = session is None
    if owns_session:
        session = SessionLocal()

    stats = {
        "bill_id": make_bill_id(congress, bill_type, bill_number),
        "house_roll_calls": 0,
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
            upsert_bill(
                session,
                bill_id,
                detail.get("title"),
                sponsor_id,
                sponsor_bioguide_id=bioguide_id,
                sponsor_name=sponsor_name,
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

        for vote in recorded:
            chamber = (vote.get("chamber") or "").strip()
            if chamber.lower() != "house":
                stats["senate_roll_calls_skipped"] += 1
                print(
                    f"  Skipping {chamber} roll call {vote.get('rollNumber')} "
                    f"on {bill_id} (no Senate member-vote API)."
                )
                continue

            session_number = vote.get("sessionNumber")
            roll_number = vote.get("rollNumber")
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

        stats["skipped_unknown_officials"] = len(unknown_officials)

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
        "missing_sponsors": [],
        "votes_inserted": 0,
        "votes_updated": 0,
        "votes_unchanged": 0,
        "votes_skipped_unknown_officials": 0,
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

            upsert_bill(
                session,
                bill_id,
                title,
                sponsor_id,
                sponsor_bioguide_id=bioguide_id,
                sponsor_name=sponsor_name,
                introduced_date=_introduced_date_from_detail(detail),
            )
            stats["bills_upserted"] += 1
            if sponsor_id:
                stats["bills_with_sponsor"] += 1
            elif not bioguide_id:
                stats["bills_without_sponsor"] += 1

            title_preview = (title or "")[:80]
            print(
                f"  Upserted {bill_id} sponsor={sponsor_id or 'NULL'} "
                f"sponsor_name={sponsor_name or 'NULL'!r} "
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
    if stats["missing_sponsors"]:
        print("  Missing roster members:")
        for missing in stats["missing_sponsors"]:
            print(
                f"    {missing['bill_id']}: {missing['bioguide_id']} "
                f"({missing['name'] or 'unknown name'})"
            )
    print(f"  House roll calls ingested:  {stats['house_roll_calls']}")
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
    print(f"  Senate roll calls skipped:  {stats['senate_roll_calls_skipped']}")
    print(f"  Votes inserted:             {stats['inserted']}")
    print(f"  Votes updated:              {stats['updated']}")
    print(f"  Votes unchanged:            {stats['unchanged']}")
    print(f"  Votes skipped (no official): {stats['skipped_unknown_officials']}")


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
    print(f"  Unchanged (no data):    {stats['bills_unchanged']}")
    print(f"  Fetch/parse failures:   {stats['bills_failed']}")


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
            "sponsors",
            "backfill-sponsors",
            "enrich",
        ],
        default="bills",
        help="members: current roster. bills: recent bills (default). "
        "votes: roll calls for one bill. "
        "backfill-sponsors: insert missing historical sponsors. "
        "enrich: fill policy area, CRS summary, and dates on existing bills.",
    )
    parser.add_argument("--limit", type=int, default=50, help="Bills to fetch (default 50).")
    parser.add_argument(
        "--congress",
        type=int,
        default=CURRENT_CONGRESS,
        help=f"Congress number for bill/vote sync (default {CURRENT_CONGRESS}).",
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

    bill_stats = sync_recent_bills(
        limit=args.limit,
        congress=args.congress,
        sync_votes=not args.skip_votes,
    )
    _print_bill_stats(bill_stats)


if __name__ == "__main__":
    main()
