"""Bill effect extraction: schema, prompts, target resolution, and upserts."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Bill, BillEffect, ExtractionGuideline, PolicyTarget

MECHANISMS = ("funding", "regulation", "oversight", "taxation")
DIRECTIONS = ("increase", "decrease", "maintain", "mixed")
MAGNITUDES = ("low", "medium", "high")

Mechanism = Literal["funding", "regulation", "oversight", "taxation"]
Direction = Literal["increase", "decrease", "maintain", "mixed"]
Magnitude = Literal["low", "medium", "high"]

DEFAULT_GUIDELINES_NAME = "default"
DEFAULT_EXTRACTION_PROMPT = """\
You extract the policy effects of U.S. federal legislation from its \
Congressional Research Service (CRS) summary.

Break the bill into distinct effects so they can later be compared to a \
representative's stated targets. Include headline provisions and anything \
else the text supports (for example a voting bill that also funds DHS/ICE). \
Do not invent agencies, programs, rights, or dollar amounts that are not in \
the text. If the summary is too thin, return an empty effects list.

Each effect:
- target_name: the noun being acted on. Prefer the most specific name in the \
text (ICE, Voting Eligibility) over vague ones (Federal Agency, Government). \
Reuse the same string for the same noun.
- mechanism: funding | regulation | oversight | taxation
- direction: increase | decrease | maintain | mixed
- magnitude: low | medium | high
- rationale: 1 to 2 sentences citing the summary

mechanism:
- funding: appropriations, spending authorizations, grants, transfers
- taxation: taxes, tariffs, fees
- regulation: rules, eligibility, rights, compliance, criminalization
- oversight: reporting to Congress, inspectors general, audits, disclosure

direction:
- increase: more money, more rules or authority, more tax, more oversight
- decrease: cuts, easing, tax reduction, less oversight
- maintain: continues an existing program or rule without a clear change
- mixed: both directions for the same target and mechanism

Do not emit a row when there is no real effect on that target.
"""

_TAG_RE = re.compile(r"<[^>]+>")
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")


class ExtractedEffect(BaseModel):
    """One policy effect as returned by the model (target as a name, not a DB id)."""

    model_config = ConfigDict(extra="forbid")

    target_name: str = Field(
        description=(
            "Specific noun being acted on, e.g. ICE, DHS, Voting Eligibility."
        )
    )
    mechanism: Mechanism = Field(
        description="funding, regulation, oversight, or taxation."
    )
    direction: Direction = Field(
        description="increase, decrease, maintain, or mixed."
    )
    magnitude: Magnitude = Field(description="low, medium, or high.")
    rationale: str = Field(
        description="1 to 2 sentences citing the summary."
    )


class BillEffectsOutput(BaseModel):
    """Structured list of effects the local model must return."""

    model_config = ConfigDict(extra="forbid")

    effects: list[ExtractedEffect] = Field(default_factory=list)


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


def is_extractable_summary(summary: str | None) -> bool:
    return bool(plain_summary(summary))


def clean_target_name(name: str | None) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def slugify_target(name: str | None) -> str:
    text = clean_target_name(name).lower().replace("&", " and ")
    return _SLUG_STRIP_RE.sub("-", text).strip("-")


def pending_extraction_query(session, force: bool = False, bill_id: str | None = None):
    """Bills with a usable summary, optionally only those with no effects yet."""
    query = session.query(Bill).filter(
        Bill.summary.isnot(None),
        func.trim(Bill.summary) != "",
    )
    if not force:
        query = query.filter(~Bill.effects.any())
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
        "Extract every distinct policy effect. Return JSON matching the schema."
    )
    return [
        {"role": "system", "content": (guidelines or "").strip()},
        {"role": "user", "content": user},
    ]


def parse_effects(raw: str) -> BillEffectsOutput:
    text = (raw or "").strip()
    if not text:
        raise ValueError("model returned an empty extraction")
    text = _FENCE_RE.sub("", text).strip()
    return BillEffectsOutput.model_validate_json(text)


def load_active_guidelines(session) -> ExtractionGuideline | None:
    return (
        session.query(ExtractionGuideline)
        .filter(ExtractionGuideline.is_active.is_(True))
        .order_by(
            ExtractionGuideline.updated_at.desc(),
            ExtractionGuideline.id.desc(),
        )
        .first()
    )


def ensure_default_guidelines(session) -> ExtractionGuideline:
    existing = (
        session.query(ExtractionGuideline)
        .filter(ExtractionGuideline.name == DEFAULT_GUIDELINES_NAME)
        .one_or_none()
    )
    if existing is not None:
        return existing
    row = ExtractionGuideline(
        name=DEFAULT_GUIDELINES_NAME,
        is_active=True,
        prompt=DEFAULT_EXTRACTION_PROMPT,
        updated_at=datetime.now(timezone.utc),
    )
    session.add(row)
    session.flush()
    return row


def extract_one_bill(bill: Bill, prompt: str, chat_fn) -> BillEffectsOutput:
    """Call chat_fn and return parsed effects.

    chat_fn(messages, format_schema) -> JSON string from the model.
    """
    if not is_extractable_summary(bill.summary):
        raise ValueError("bill has no usable summary")
    raw = chat_fn(
        build_messages(prompt, bill),
        BillEffectsOutput.model_json_schema(),
    )
    return parse_effects(raw)


def resolve_or_create_target(session: Session, name: str) -> PolicyTarget:
    """Find a policy target by slug (or name), creating it when missing."""
    cleaned = clean_target_name(name)
    slug = slugify_target(cleaned)
    if not slug:
        raise ValueError(f"invalid target name: {name!r}")

    existing = (
        session.query(PolicyTarget)
        .filter(PolicyTarget.slug == slug)
        .one_or_none()
    )
    if existing is not None:
        return existing

    by_name = (
        session.query(PolicyTarget)
        .filter(func.lower(PolicyTarget.name) == cleaned.lower())
        .one_or_none()
    )
    if by_name is not None:
        return by_name

    target = PolicyTarget(name=cleaned, slug=slug)
    session.add(target)
    session.flush()
    return target


def dedupe_effects(effects: list[ExtractedEffect]) -> list[ExtractedEffect]:
    """Keep the last effect per (slug, mechanism) so the unique constraint holds."""
    seen: dict[tuple[str, str], ExtractedEffect] = {}
    for effect in effects:
        slug = slugify_target(effect.target_name)
        if not slug:
            continue
        seen[(slug, effect.mechanism)] = effect
    return list(seen.values())


def persist_bill_effects(
    session: Session,
    bill: Bill,
    output: BillEffectsOutput,
    *,
    replace_existing: bool = False,
) -> list[BillEffect]:
    """Resolve targets and upsert effect rows for one bill."""
    if replace_existing:
        session.query(BillEffect).filter(BillEffect.bill_id == bill.id).delete()
        session.flush()

    stored: list[BillEffect] = []
    for effect in dedupe_effects(output.effects):
        target = resolve_or_create_target(session, effect.target_name)
        existing = (
            session.query(BillEffect)
            .filter_by(
                bill_id=bill.id,
                target_id=target.id,
                mechanism=effect.mechanism,
            )
            .one_or_none()
        )
        if existing is not None:
            existing.direction = effect.direction
            existing.magnitude = effect.magnitude
            existing.rationale = effect.rationale
            stored.append(existing)
            continue
        row = BillEffect(
            bill_id=bill.id,
            target_id=target.id,
            mechanism=effect.mechanism,
            direction=effect.direction,
            magnitude=effect.magnitude,
            rationale=effect.rationale,
        )
        session.add(row)
        stored.append(row)
    session.flush()
    return stored
