"""Fetch the bills Congress.gov lists as related to each voted bill.

Accountability scoring uses these links to tell companion bills (a chamber's
version and the final bill, or a bill whose text went into a larger one)
from unrelated bills on the same topic: a later vote supersedes an earlier
match only when the two bills are linked here (see services/accountability.py).

Runs for bills with recorded votes, newest vote first, and again only when
a bill's latest action changes. Usage:
    python congress_client.py related [--limit 50] [--bill-id 119-hr-22]
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

import requests
from sqlalchemy import exists

from congress_client import BASE_URL, PAGE_SIZE, congress_get, make_bill_id, parse_bill_id
from database import SessionLocal
from init_db import ensure_schema
from models import Bill, BillRelation, RollCall
from services.accountability import try_rescore


def related_input(bill: Bill) -> str:
    """What the stored relations were fetched for; a new action re-fetches them."""
    return f"{bill.latest_action_date or ''}|{bill.latest_action_text or ''}"


def fetch_related_bills(congress, bill_type, number) -> list[dict]:
    url = f"{BASE_URL}/bill/{congress}/{str(bill_type).lower()}/{number}/relatedbills"
    params = {"limit": PAGE_SIZE, "format": "json"}
    related = []
    while url:
        payload = congress_get(url, params=params)
        related.extend(payload.get("relatedBills") or [])
        url = (payload.get("pagination") or {}).get("next")
        params = None
    return related


def parse_relations(related: list[dict]) -> dict[str, list[str]]:
    """{related bill id: sorted relationship types} from a relatedbills payload."""
    out: dict[str, set[str]] = defaultdict(set)
    for item in related:
        if not (item.get("congress") and item.get("type") and item.get("number")):
            continue
        bill_id = make_bill_id(item["congress"], item["type"], item["number"])
        for detail in item.get("relationshipDetails") or []:
            if detail.get("type"):
                out[bill_id].add(detail["type"])
    return {bill_id: sorted(types) for bill_id, types in out.items() if types}


def bills_due(session, limit: int, bill_ids: list[str] | None = None) -> list[Bill]:
    """Federal bills with a roll call whose relations are missing or older
    than their latest action, most recently voted first. limit 0 = all."""
    query = session.query(Bill).filter(Bill.level == "federal")
    if bill_ids:
        return query.filter(Bill.id.in_(bill_ids)).all()
    voted = exists().where(RollCall.bill_id == Bill.id)
    rows = query.filter(voted).order_by(Bill.voted_date.desc().nulls_last(), Bill.id).all()
    due = [b for b in rows if b.related_input != related_input(b)]
    return due[:limit] if limit else due


def sync_bill_relations(session, bill: Bill, *, now=None) -> bool:
    """Replace one bill's relations. Returns whether they changed. Raises on
    Congress.gov errors so the caller can skip the bill and retry it next run."""
    parsed = parse_bill_id(bill.id)
    if parsed is None:
        raise ValueError(f"unparseable bill id {bill.id!r}")
    relations = parse_relations(fetch_related_bills(*parsed))
    relations.pop(bill.id, None)
    stored = {
        row.related_bill_id: row.relationships
        for row in session.query(BillRelation).filter(BillRelation.bill_id == bill.id)
    }
    changed = stored != relations
    if changed:
        session.query(BillRelation).filter(BillRelation.bill_id == bill.id).delete(synchronize_session=False)
        session.add_all(
            BillRelation(bill_id=bill.id, related_bill_id=related_id, relationships=types)
            for related_id, types in relations.items()
        )
    bill.related_synced_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    bill.related_input = related_input(bill)
    session.flush()
    return changed


def sync_relations(limit: int = 50, bill_ids: list[str] | None = None, log=print) -> dict:
    ensure_schema()
    session = SessionLocal()
    stats = {"bills": 0, "changed": 0, "failed": 0, "relations": 0}
    changed_bills = []
    try:
        bills = bills_due(session, limit, bill_ids)
        log(f"Related bills: {len(bills)} bill(s) to fetch.")
        for index, bill in enumerate(bills, start=1):
            try:
                changed = sync_bill_relations(session, bill)
            except (requests.RequestException, RuntimeError, ValueError) as exc:
                session.rollback()
                stats["failed"] += 1
                log(f"[{index}/{len(bills)}] {bill.id} FAILED: {exc}")
                continue
            session.commit()
            count = session.query(BillRelation).filter(BillRelation.bill_id == bill.id).count()
            stats["bills"] += 1
            stats["relations"] += count
            if changed:
                stats["changed"] += 1
                changed_bills.append(bill.id)
            log(f"[{index}/{len(bills)}] {bill.id}: {count} related{' (changed)' if changed else ''}")
        if changed_bills:
            # Companion links decide which earlier votes are superseded.
            try_rescore(session, bill_ids=changed_bills, log=log)
        return stats
    finally:
        session.close()
