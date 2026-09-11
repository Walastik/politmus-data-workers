"""Bill summary classification: schema, prompts, and record shaping."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func

from models import Bill, ClassificationGuideline

IMPACT_LEVELS = ("none", "low", "medium", "high")
ImpactLevel = Literal["none", "low", "medium", "high"]

DEFAULT_GUIDELINES_NAME = "default"
DEFAULT_GUIDELINES_PROMPT = """\
You are classifying U.S. federal legislation from its Congressional Research \
Service (CRS) summary.

Score each dimension independently. Use only the bill title, policy area, and \
summary. Do not invent facts that are not in the text.

funding_impact — new or changed public money: appropriations, authorizations of \
spending, taxes, tariffs, fees, or transfers.
- none: no spending, tax, or transfer effect
- low: studies, reports, small targeted grants, or technical budget language
- medium: a meaningful program, tax change, or funding stream for a defined group
- high: major appropriations, large tax or tariff policy, or broad budget impact

regulatory_impact — new or changed government rules, agency powers, rights, or \
compliance duties.
- none: no regulatory change
- low: reporting, studies, sense-of-Congress, or minor technical adjustments
- medium: new requirements or authorities for a specific sector or agency
- high: a new regulatory regime, major agency authority, or broad compliance change

reasoning — 1 to 3 concise sentences that cite the summary. If the summary is \
too thin to judge a dimension, choose none for that dimension and say so.
"""

_TAG_RE = re.compile(r"<[^>]+>")
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class BillImpactClassification(BaseModel):
    """Structured impact scores the local model must return."""

    model_config = ConfigDict(extra="forbid")

    funding_impact: ImpactLevel = Field(
        description=(
            "Public-money impact: spending, appropriations, taxes, tariffs, "
            "or transfers."
        )
    )
    regulatory_impact: ImpactLevel = Field(
        description=(
            "How much the bill creates or changes rules, agencies, rights, "
            "or compliance duties."
        )
    )
    reasoning: str = Field(
        description=(
            "1 to 3 sentences citing the summary. Do not speculate beyond "
            "the text."
        )
    )


def plain_summary(html: str | None) -> str:
    """Strip CRS HTML so the model sees readable text."""
    if not html:
        return ""
    text = (
        html.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    text = _TAG_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


def is_classifiable_summary(summary: str | None) -> bool:
    return bool(plain_summary(summary))


def pending_classification_query(session, force: bool = False, bill_id: str | None = None):
    """Bills with a usable summary, optionally only those still unclassified."""
    query = session.query(Bill).filter(
        Bill.summary.isnot(None),
        func.trim(Bill.summary) != "",
    )
    if not force:
        query = query.filter(Bill.classification.is_(None))
    if bill_id:
        query = query.filter(Bill.id == bill_id)
    return query.order_by(Bill.id)


def build_messages(guidelines: str, bill: Bill) -> list[dict[str, str]]:
    summary = plain_summary(bill.summary)
    title = (bill.title or "").strip() or bill.id
    policy_area = (bill.policy_area or "").strip() or "unknown"
    user = (
        f"Bill ID: {bill.id}\n"
        f"Title: {title}\n"
        f"Policy area: {policy_area}\n\n"
        f"Summary:\n{summary}\n\n"
        "Classify this bill. Return JSON matching the schema."
    )
    return [
        {"role": "system", "content": (guidelines or "").strip()},
        {"role": "user", "content": user},
    ]


def parse_classification(raw: str) -> BillImpactClassification:
    text = (raw or "").strip()
    if not text:
        raise ValueError("model returned an empty classification")
    text = _FENCE_RE.sub("", text).strip()
    return BillImpactClassification.model_validate_json(text)


def classification_record(
    result: BillImpactClassification,
    *,
    model: str,
    guideline: ClassificationGuideline,
    classified_at: datetime | None = None,
) -> dict:
    """JSON stored on Bill.classification, including worker metadata."""
    stamped = classified_at or datetime.now(timezone.utc)
    payload = result.model_dump()
    payload["model"] = model
    payload["classified_at"] = stamped.isoformat()
    payload["guidelines_id"] = guideline.id
    updated = guideline.updated_at
    if updated is not None:
        payload["guidelines_updated_at"] = updated.isoformat()
    return payload


def load_active_guidelines(session) -> ClassificationGuideline | None:
    return (
        session.query(ClassificationGuideline)
        .filter(ClassificationGuideline.is_active.is_(True))
        .order_by(
            ClassificationGuideline.updated_at.desc(),
            ClassificationGuideline.id.desc(),
        )
        .first()
    )


def ensure_default_guidelines(session) -> ClassificationGuideline:
    existing = (
        session.query(ClassificationGuideline)
        .filter(ClassificationGuideline.name == DEFAULT_GUIDELINES_NAME)
        .one_or_none()
    )
    if existing is not None:
        return existing
    row = ClassificationGuideline(
        name=DEFAULT_GUIDELINES_NAME,
        is_active=True,
        prompt=DEFAULT_GUIDELINES_PROMPT,
        updated_at=datetime.now(timezone.utc),
    )
    session.add(row)
    session.flush()
    return row


def classify_one_bill(bill: Bill, guideline: ClassificationGuideline, model: str, chat_fn) -> dict:
    """Call chat_fn and return the JSON record to store on the bill.

    chat_fn(messages, format_schema) -> JSON string from the model.
    """
    if not is_classifiable_summary(bill.summary):
        raise ValueError("bill has no usable summary")
    raw = chat_fn(
        build_messages(guideline.prompt, bill),
        BillImpactClassification.model_json_schema(),
    )
    result = parse_classification(raw)
    return classification_record(result, model=model, guideline=guideline)
