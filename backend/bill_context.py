"""Fetch the sources that explain how a bill was received: its amendments,
floor speeches from the Congressional Record, committee report views, and
links to committee reports and CBO estimates.

A CRS summary says what a bill does; it does not say why members voted the
way they did. These sources do, in the members' own words, so the drawer
and the debate summary (services/bill_debate.py) can show both sides
without anyone needing to look elsewhere.

Runs for bills with recorded votes, newest vote first, and again only when
a bill's latest action changes. Usage:
    python congress_client.py context [--limit 25] [--bill-id 119-hr-9340]
"""

from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta, timezone

import requests
from sqlalchemy import exists

from congress_client import (
    BASE_URL,
    PAGE_SIZE,
    REQUEST_PAUSE_SECONDS,
    compact_actions,
    congress_get,
    fetch_bill_actions,
    fetch_bill_detail,
    last_name_from_official_name,
    parse_bill_id,
    parse_congress_date,
)
from database import SessionLocal
from init_db import ensure_schema
from models import Bill, BillAmendment, BillSource, Official, RollCall
from services.congressional_record import (
    amendment_excerpt,
    article_matches,
    bill_label,
    extract_views,
    html_to_text,
    parse_speeches,
)

# Amendments with full detail per bill (an NDAA can have thousands).
MAX_AMENDMENTS = 100
# Amendments whose text excerpt is fetched from the Record.
MAX_AMENDMENT_TEXTS = 25
# Record issues scanned per bill for floor speeches.
MAX_RECORD_ISSUES = 30
# Floor actions this close together are one debate: every issue between
# them is scanned (speeches often fall on days with no recorded action).
DEBATE_GAP_DAYS = 14

KIND_FLOOR_SPEECH = "floor_speech"
KIND_COMMITTEE_VIEWS = "committee_views"

_SECTION_CHAMBERS = {
    "Senate Section": "Senate",
    "House Section": "House",
    "Extensions of Remarks Section": "House",
}
_HOUSE_OFFICES = ("Representative", "Delegate", "Resident Commissioner")
_REPORT_RE = re.compile(r"\b([HS])\.\s*Rept\.\s*(\d+)-(\d+)")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def context_input(bill: Bill) -> str:
    """What the stored context was fetched for; a new action re-fetches it."""
    return f"{bill.latest_action_date or ''}|{bill.latest_action_text or ''}"


def fetch_page_text(url: str) -> str:
    """Plain text of a congress.gov Record or report page."""
    time.sleep(REQUEST_PAUSE_SECONDS)
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return html_to_text(response.text)


def _paged(url: str, key: str, *, limit: int | None = None) -> list[dict]:
    params = {"limit": PAGE_SIZE, "format": "json"}
    items: list[dict] = []
    while url and (limit is None or len(items) < limit):
        payload = congress_get(url, params=params)
        items.extend(payload.get(key) or [])
        url = (payload.get("pagination") or {}).get("next")
        params = None
    return items if limit is None else items[:limit]


# -- documents ----------------------------------------------------------------


def short_titles(congress, bill_type, number) -> list[str]:
    titles = _paged(f"{BASE_URL}/bill/{congress}/{bill_type}/{number}/titles", "titles")
    out: list[str] = []
    for item in titles:
        kind = item.get("titleType") or ""
        title = (item.get("title") or "").strip()
        if title and ("Short Title" in kind or kind == "Display Title") and title not in out:
            out.append(title)
    return out


def bill_documents(detail: dict, titles: list[str]) -> dict:
    return {
        "short_titles": titles,
        "committee_reports": [
            {"citation": r.get("citation"), "url": r.get("url")}
            for r in detail.get("committeeReports") or []
            if r.get("citation")
        ],
        "cbo_cost_estimates": [
            {
                "title": c.get("title"),
                "description": c.get("description"),
                "date": (c.get("pubDate") or "")[:10] or None,
                "url": c.get("url"),
            }
            for c in detail.get("cboCostEstimates") or []
            if c.get("url")
        ],
    }


# -- speakers -----------------------------------------------------------------


def _surname_key(name: str | None) -> str:
    return re.sub(r"[^A-Z]", "", (name or "").upper())


class SpeakerIndex:
    """Matches a Record speaker (surname, chamber, optional state) to one
    official. Ambiguous names without a state stay unmatched."""

    def __init__(self, officials):
        self._by_key: dict[tuple[str, str], list] = {}
        for official in officials:
            chamber = "Senate" if official.office == "Senator" else (
                "House" if official.office in _HOUSE_OFFICES else None
            )
            surname = official.last_name or last_name_from_official_name(official.name)
            if chamber and surname:
                self._by_key.setdefault((chamber, _surname_key(surname)), []).append(official)

    @classmethod
    def load(cls, session) -> "SpeakerIndex":
        return cls(session.query(Official).filter(Official.level == "federal").all())

    def match(self, surname: str, chamber: str | None, state: str | None = None):
        candidates = self._by_key.get((chamber or "", _surname_key(surname)), [])
        if state:
            candidates = [o for o in candidates if (o.state or "").lower() == state.lower()]
        if len(candidates) > 1:
            candidates = [o for o in candidates if o.current_member] or candidates
        return candidates[0] if len(candidates) == 1 else None


# -- Congressional Record -----------------------------------------------------


class RecordIssues:
    """Daily Congressional Record issues by date, fetched once per run."""

    def __init__(self):
        self._by_date: dict[date, list[tuple[int, int]]] = {}
        self._oldest: date | None = None
        self._next: str | None = f"{BASE_URL}/daily-congressional-record"
        self._params: dict | None = {"limit": PAGE_SIZE, "format": "json"}

    def _load_until(self, since: date) -> None:
        while self._next and (self._oldest is None or self._oldest >= since):
            payload = congress_get(self._next, params=self._params)
            self._params = None
            for issue in payload.get("dailyCongressionalRecord") or []:
                day = parse_congress_date(issue.get("issueDate"))
                if day is None:
                    continue
                key = (int(issue["volumeNumber"]), int(issue["issueNumber"]))
                self._by_date.setdefault(day, []).append(key)
                self._oldest = day if self._oldest is None else min(self._oldest, day)
            self._next = (payload.get("pagination") or {}).get("next")

    def between(self, start: date, end: date) -> list[tuple[date, int, int]]:
        self._load_until(start)
        return sorted(
            (day, volume, number)
            for day, keys in self._by_date.items()
            if start <= day <= end
            for volume, number in keys
        )


def debate_dates(actions: list[dict]) -> list[tuple[date, date]]:
    """Date ranges to scan: each run of floor actions no more than
    DEBATE_GAP_DAYS apart, oldest first."""
    days = sorted({
        d for a in actions
        if (a.get("type") == "Floor" or "CR " in (a.get("text") or ""))
        and (d := parse_congress_date(a.get("actionDate")))
    })
    ranges: list[list[date]] = []
    for day in days:
        if ranges and (day - ranges[-1][1]).days <= DEBATE_GAP_DAYS:
            ranges[-1][1] = day
        else:
            ranges.append([day, day])
    return [(start, end) for start, end in ranges]


def record_articles(volume: int, issue: int) -> list[dict]:
    """[{section, title, url}] for one issue's articles with formatted text."""
    sections = _paged(f"{BASE_URL}/daily-congressional-record/{volume}/{issue}/articles", "articles")
    out = []
    for section in sections:
        for article in section.get("sectionArticles") or []:
            url = next(
                (t.get("url") for t in article.get("text") or [] if t.get("type") == "Formatted Text"),
                None,
            )
            if url:
                out.append({"section": section.get("name"), "title": article.get("title") or "", "url": url})
    return out


def floor_speeches(bill: Bill, actions, titles, issues: RecordIssues, speakers: SpeakerIndex, log=print):
    label = bill_label(bill.id)
    days: list[tuple[date, int, int]] = []
    for start, end in debate_dates(actions):
        days.extend(issues.between(start, end))
    days = sorted(set(days))[-MAX_RECORD_ISSUES:]
    rows: list[BillSource] = []
    for day, volume, issue in days:
        for article in record_articles(volume, issue):
            chamber = _SECTION_CHAMBERS.get(article["section"])
            if chamber is None or not article_matches(article["title"], titles, label):
                continue
            try:
                text = fetch_page_text(article["url"])
            except requests.RequestException as exc:
                log(f"  Record article failed ({article['url']}): {exc}")
                continue
            for speech in parse_speeches(text):
                official = speakers.match(speech.speaker, chamber, speech.state)
                rows.append(BillSource(
                    bill_id=bill.id,
                    kind=KIND_FLOOR_SPEECH,
                    source_key=f"{article['url']}#{speech.speaker}|{speech.state or ''}",
                    date=day,
                    chamber=chamber,
                    title=article["title"].split(";", 1)[0].strip(),
                    speaker_name=speech.speaker,
                    speaker_state=speech.state or (official.state if official else None),
                    speaker_official_id=official.id if official else None,
                    speaker_party=official.party if official else None,
                    text=speech.text,
                    url=article["url"],
                ))
    return rows


# -- committee reports --------------------------------------------------------


def committee_views(bill: Bill, documents: dict, log=print) -> list[BillSource]:
    rows: list[BillSource] = []
    for report in documents.get("committee_reports") or []:
        match = _REPORT_RE.search(report.get("citation") or "")
        if not match:
            continue
        chamber_letter, congress, number = match.groups()
        report_type = "HRPT" if chamber_letter == "H" else "SRPT"
        try:
            versions = _paged(f"{BASE_URL}/committee-report/{congress}/{report_type}/{number}/text", "text")
            url = next(
                (f.get("url") for v in versions for f in v.get("formats") or [] if f.get("type") == "Formatted Text"),
                None,
            )
            if not url:
                continue
            sections = extract_views(fetch_page_text(url))
        except (requests.RequestException, RuntimeError) as exc:
            log(f"  {report['citation']} failed: {exc}")
            continue
        for heading, text in sections:
            rows.append(BillSource(
                bill_id=bill.id,
                kind=KIND_COMMITTEE_VIEWS,
                source_key=f"{report['citation']}#{heading}",
                chamber="House" if chamber_letter == "H" else "Senate",
                title=f"{report['citation']}: {heading}",
                text=text,
                url=url,
            ))
    return rows


# -- amendments ---------------------------------------------------------------


def amendments(bill: Bill, congress, bill_type, number, log=print) -> list[BillAmendment]:
    listed = _paged(f"{BASE_URL}/bill/{congress}/{bill_type}/{number}/amendments", "amendments")
    listed.sort(key=lambda a: int(a.get("number") or 0), reverse=True)
    rows = []
    for index, item in enumerate(listed[:MAX_AMENDMENTS]):
        kind = (item.get("type") or "").lower()
        amendment_number = str(item.get("number") or "")
        if not kind or not amendment_number:
            continue
        base = f"{BASE_URL}/amendment/{item.get('congress') or congress}/{kind}/{amendment_number}"
        try:
            detail = congress_get(base, params={"format": "json"}).get("amendment") or {}
        except (requests.RequestException, RuntimeError) as exc:
            log(f"  amendment {kind} {amendment_number} failed: {exc}")
            continue
        sponsor = (detail.get("sponsors") or [{}])[0]
        latest = detail.get("latestAction") or {}
        text_url = excerpt = None
        if index < MAX_AMENDMENT_TEXTS:
            try:
                versions = _paged(f"{base}/text", "textVersions")
                text_url = next(
                    (f.get("url") for v in versions for f in v.get("formats") or [] if f.get("url")), None
                )
                if text_url:
                    excerpt = amendment_excerpt(fetch_page_text(text_url), amendment_number)
            except (requests.RequestException, RuntimeError) as exc:
                log(f"  amendment {kind} {amendment_number} text failed: {exc}")
        party = {"D": "Democratic", "R": "Republican", "I": "Independent"}.get(
            sponsor.get("party"), sponsor.get("party")
        )
        rows.append(BillAmendment(
            id=f"{item.get('congress') or congress}-{kind}-{amendment_number}",
            bill_id=bill.id,
            chamber=detail.get("chamber") or ("Senate" if kind.startswith("s") else "House"),
            number=amendment_number,
            sponsor_name=sponsor.get("fullName"),
            sponsor_bioguide_id=sponsor.get("bioguideId"),
            sponsor_party=party,
            submitted_date=parse_congress_date(detail.get("submittedDate")),
            purpose=detail.get("purpose") or detail.get("description"),
            latest_action_text=latest.get("text"),
            latest_action_date=parse_congress_date(latest.get("actionDate")),
            text_url=text_url,
            text_excerpt=excerpt,
        ))
    return rows


# -- sync ---------------------------------------------------------------------


def sync_bill_context(session, bill: Bill, *, issues: RecordIssues, speakers: SpeakerIndex, now=None, log=print) -> dict:
    """Replace one bill's amendments and sources, and refresh its actions
    and documents. Raises on Congress.gov errors so the caller can skip the
    bill and retry it next run."""
    parsed = parse_bill_id(bill.id)
    if parsed is None:
        raise ValueError(f"unparseable bill id {bill.id!r}")
    congress, bill_type, number = parsed
    bill_type = str(bill_type).lower()
    detail = fetch_bill_detail(congress, bill_type, number)
    actions = fetch_bill_actions(congress, bill_type, number)
    titles = short_titles(congress, bill_type, number)
    documents = bill_documents(detail, titles)

    amendment_rows = amendments(bill, congress, bill_type, number, log=log)
    source_rows = floor_speeches(bill, actions, titles, issues, speakers, log=log)
    source_rows += committee_views(bill, documents, log=log)
    # One row per source_key (a speaker can be matched twice on one page).
    source_rows = list({row.source_key: row for row in source_rows}.values())

    session.query(BillAmendment).filter(BillAmendment.bill_id == bill.id).delete(synchronize_session=False)
    session.query(BillSource).filter(BillSource.bill_id == bill.id).delete(synchronize_session=False)
    session.add_all(amendment_rows)
    session.add_all(source_rows)
    bill.actions = compact_actions(actions)
    bill.documents = documents
    bill.context_synced_at = now or _utcnow()
    bill.context_input = context_input(bill)
    session.flush()
    return {
        "amendments": len(amendment_rows),
        "floor_speeches": sum(1 for r in source_rows if r.kind == KIND_FLOOR_SPEECH),
        "committee_views": sum(1 for r in source_rows if r.kind == KIND_COMMITTEE_VIEWS),
    }


def bills_due(session, limit: int, bill_ids: list[str] | None = None) -> list[Bill]:
    """Federal bills with a roll call whose context is missing or older
    than their latest action, most recently voted first."""
    query = session.query(Bill).filter(Bill.level == "federal")
    if bill_ids:
        return query.filter(Bill.id.in_(bill_ids)).all()
    voted = exists().where(RollCall.bill_id == Bill.id)
    rows = query.filter(voted).order_by(Bill.voted_date.desc().nulls_last(), Bill.id).all()
    return [b for b in rows if b.context_input != context_input(b)][:limit]


def sync_context(limit: int = 25, bill_ids: list[str] | None = None, log=print) -> dict:
    ensure_schema()
    session = SessionLocal()
    stats = {"bills": 0, "failed": 0, "amendments": 0, "floor_speeches": 0, "committee_views": 0}
    try:
        bills = bills_due(session, limit, bill_ids)
        log(f"Bill context: {len(bills)} bill(s) to fetch.")
        issues = RecordIssues()
        speakers = SpeakerIndex.load(session)
        for index, bill in enumerate(bills, start=1):
            log(f"[{index}/{len(bills)}] {bill.id}")
            try:
                counts = sync_bill_context(session, bill, issues=issues, speakers=speakers, log=log)
            except (requests.RequestException, RuntimeError, ValueError) as exc:
                session.rollback()
                stats["failed"] += 1
                log(f"  FAILED: {exc}")
                continue
            session.commit()
            stats["bills"] += 1
            for key, value in counts.items():
                stats[key] += value
            log(
                f"  amendments={counts['amendments']} floor_speeches={counts['floor_speeches']} "
                f"committee_views={counts['committee_views']}"
            )
        return stats
    finally:
        session.close()
