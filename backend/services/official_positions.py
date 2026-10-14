"""Stated policy positions from officials' websites: schema, prompt, chunking,
quote verification, merging, and persistence.

Positions use the same target / mechanism / direction vocabulary as
bill_effects (see services/bill_effects.py) so the accountability engine can
compare what an official says with how they vote.

The prompts themselves are not in the repo: they live in the gitignored
backend/scripts/positions_llm_config.py (see positions_llm_config.example.py there).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from models import BillEffect, OfficialSourcePage, OfficialStance, PolicyTarget
from services.bill_effects import (
    Direction,
    Magnitude,
    Mechanism,
    clean_target_name,
    resolve_or_create_target,
    slugify_target,
)

# Bump when the output schema or verification rules change so every official
# is re-extracted on the next run.
SCHEMA_VERSION = "positions-v3"
SOURCE_OFFICIAL_SITE = "official_site"

DEFAULT_CHUNK_CHARS = 10_000
MIN_QUOTE_CHARS = 12
MAX_STANCES_PER_OFFICIAL = 100
MAX_VOCABULARY_TARGETS = 150

# Congress.gov / CRS policy areas, the same values stored on bills.policy_area
# (minus Private Legislation and the catch-all geographic/history areas).
PolicyArea = Literal[
    "Agriculture and Food",
    "Animals",
    "Armed Forces and National Security",
    "Arts, Culture, Religion",
    "Civil Rights and Liberties, Minority Issues",
    "Commerce",
    "Congress",
    "Crime and Law Enforcement",
    "Economics and Public Finance",
    "Education",
    "Emergency Management",
    "Energy",
    "Environmental Protection",
    "Families",
    "Finance and Financial Sector",
    "Foreign Trade and International Finance",
    "Government Operations and Politics",
    "Health",
    "Housing and Community Development",
    "Immigration",
    "International Affairs",
    "Labor and Employment",
    "Law",
    "Native Americans",
    "Public Lands and Natural Resources",
    "Science, Technology, Communications",
    "Social Welfare",
    "Sports and Recreation",
    "Taxation",
    "Transportation and Public Works",
    "Water Resources Development",
]
POLICY_AREAS = get_args(PolicyArea)

Stance = Literal["supports", "opposes"]

# What the official wants, given the policy action and their stance on it.
_OPPOSED_DIRECTION = {
    "increase": "decrease",
    "decrease": "increase",
    # Opposing "keep as is" or a mixed change says change is wanted, not which way.
    "maintain": "mixed",
    "mixed": "mixed",
}


class StatedPosition(BaseModel):
    """One position as returned by the model.

    The model describes the policy action the text talks about (target,
    mechanism, direction, labelled like a bill effect) and whether the
    official supports or opposes it. The official's own desired direction is
    derived in code (see official_direction), so the model never has to
    invert "fights cuts to Medicaid" itself.
    """

    model_config = ConfigDict(extra="forbid")

    issue_label: str = Field(description="Heading the position sits under, copied from the text.")
    evidence_quote: str = Field(description="One or two consecutive sentences copied verbatim from the text.")
    target_name: str = Field(description="Policy noun acted on, e.g. Medicaid, Renewable Energy. Never a bill name.")
    mechanism: Mechanism = Field(description="funding, regulation, oversight, or taxation.")
    direction: Direction = Field(description="Direction of the policy action described, as a bill effect would be labelled.")
    stance: Stance = Field(description="Whether the official supports or opposes that policy action.")
    emphasis: Magnitude = Field(description="low, medium, or high.")
    policy_area: PolicyArea = Field(description="Closest CRS policy area.")
    summary: str = Field(description="One plain sentence stating the official's position.")


def official_direction(position: StatedPosition) -> str:
    """The direction the official wants for the target and mechanism."""
    if position.stance == "supports":
        return position.direction
    return _OPPOSED_DIRECTION[position.direction]


class StatedPositionsOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[StatedPosition] = Field(default_factory=list)


class LinkSelectionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    link_numbers: list[int] = Field(default_factory=list)


@dataclass
class SourceText:
    """A page's cleaned text as handed to the extractor."""

    url: str
    text: str
    page_id: int | None = None
    title: str | None = None


@dataclass
class Chunk:
    url: str
    heading: str | None
    text: str
    page_id: int | None = None


@dataclass
class VerifiedPosition:
    position: StatedPosition
    source_url: str
    page_id: int | None
    # What the official wants; "mixed" after merging conflicting statements.
    direction: str = ""

    def __post_init__(self):
        if not self.direction:
            self.direction = official_direction(self.position)


# -- hashing / versions ------------------------------------------------------


def combined_hash(pages: list[tuple[str, str]]) -> str:
    """Stable hash over (url, content_hash) pairs, independent of order."""
    digest = hashlib.sha256()
    for url, page_hash in sorted(pages):
        digest.update(f"{url}\n{page_hash}\n".encode("utf-8"))
    return digest.hexdigest()


def extractor_version(prompts: tuple[str, ...], model: str) -> str:
    """Changes whenever the schema, either local prompt, or the model changes."""
    digest = hashlib.sha256("\0".join(prompts).encode("utf-8")).hexdigest()[:12]
    return f"{SCHEMA_VERSION}|p{digest}|{model}"


# -- chunking ----------------------------------------------------------------

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")


def _sections(text: str) -> list[tuple[str | None, str]]:
    """Split markdown-ish text into (heading, section text) at headings."""
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in text.splitlines():
        match = _HEADING_RE.match(line)
        if match:
            sections.append((match.group(2).strip(), [line]))
        else:
            sections[-1][1].append(line)
    out = []
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if body:
            out.append((heading, body))
    return out


def _split_long(text: str, max_chars: int) -> list[str]:
    """Split on paragraphs, then sentences, then hard character cuts."""
    if len(text) <= max_chars:
        return [text]
    pieces: list[str] = []
    for unit in re.split(r"\n\s*\n", text):
        if len(unit) <= max_chars:
            pieces.append(unit)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", unit)
        for sentence in sentences:
            while len(sentence) > max_chars:
                pieces.append(sentence[:max_chars])
                sentence = sentence[max_chars:]
            if sentence:
                pieces.append(sentence)
    out: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if len(candidate) > max_chars and current:
            out.append(current)
            current = piece
        else:
            current = candidate
    if current:
        out.append(current)
    return out


def _has_content(body: str) -> bool:
    """False for a section that is only a heading line."""
    return any(line.strip() and not _HEADING_RE.match(line) for line in body.splitlines())


def chunk_source(source: SourceText, max_chars: int = DEFAULT_CHUNK_CHARS) -> list[Chunk]:
    """Pack heading sections into chunks no larger than max_chars.

    Sections are never split unless one alone exceeds max_chars, so a
    position and its heading stay in the same model call.
    """
    chunks: list[Chunk] = []
    current: list[str] = []
    current_heading: str | None = None
    size = 0

    def flush():
        nonlocal current, size, current_heading
        if current:
            chunks.append(Chunk(source.url, current_heading, "\n\n".join(current), source.page_id))
        current, size, current_heading = [], 0, None

    for heading, body in _sections(source.text):
        if not _has_content(body):
            continue
        if len(body) > max_chars:
            flush()
            # Repeat the heading line on every part so each call keeps context.
            first, _, rest = body.partition("\n")
            prefix = first if _HEADING_RE.match(first) else ""
            content = rest.strip() if prefix else body
            budget = max(200, max_chars - len(prefix) - 2)
            for part in _split_long(content, budget):
                part_text = f"{prefix}\n\n{part}" if prefix else part
                chunks.append(Chunk(source.url, heading, part_text, source.page_id))
            continue
        if size + len(body) + 2 > max_chars:
            flush()
        if not current:
            current_heading = heading
        current.append(body)
        size += len(body) + 2
    flush()
    return chunks


# -- prompts -----------------------------------------------------------------


def describe_official(official) -> str:
    parts = [official.name or official.id]
    detail = ", ".join(
        p for p in (
            official.party,
            official.state,
            f"district {official.district}" if official.district else None,
        ) if p
    )
    if detail:
        parts.append(f"({detail})")
    if official.office:
        parts.append(f"- {official.office}")
    return " ".join(parts)


def build_position_messages(
    prompt: str,
    official,
    chunk: Chunk,
    vocabulary: list[str] | None = None,
) -> list[dict[str, str]]:
    lines = [
        f"Official: {describe_official(official)}",
        f"Page: {chunk.url}",
    ]
    if chunk.heading:
        lines.append(f"Section: {chunk.heading}")
    if vocabulary:
        lines.append("Known targets (reuse a name only when the text is about that same thing): " + "; ".join(vocabulary))
    user = (
        "\n".join(lines)
        + f"\n\n<page>\n{chunk.text}\n</page>\n\n"
        + "Extract the official's stated policy positions. Return JSON matching the schema."
    )
    return [
        {"role": "system", "content": (prompt or "").strip()},
        {"role": "user", "content": user},
    ]


def build_link_selection_messages(prompt: str, official, candidates) -> list[dict[str, str]]:
    listing = "\n".join(
        f"{i}. {(c.text or '(no text)')[:80]} -> {c.url}" for i, c in enumerate(candidates, start=1)
    )
    return [
        {"role": "system", "content": (prompt or "").strip()},
        {
            "role": "user",
            "content": f"Official: {describe_official(official)}\n\nLinks:\n{listing}\n\nReturn JSON matching the schema.",
        },
    ]


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_positions(raw: str) -> StatedPositionsOutput:
    content = (raw or "").strip()
    if not content:
        raise ValueError("model returned an empty response")
    return StatedPositionsOutput.model_validate_json(_FENCE_RE.sub("", content).strip())


def make_link_selector(chat_fn, official, prompt: str):
    """Fallback used by SiteCrawler when no nav link looks like an issues page."""

    def select(candidates) -> list[str]:
        raw = chat_fn(
            build_link_selection_messages(prompt, official, candidates),
            LinkSelectionOutput.model_json_schema(),
        )
        parsed = LinkSelectionOutput.model_validate_json(_FENCE_RE.sub("", (raw or "").strip()))
        return [
            candidates[n - 1].url
            for n in parsed.link_numbers[:5]
            if 1 <= n <= len(candidates)
        ]

    return select


# -- verification and merge --------------------------------------------------

_QUOTE_CHARS = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "–": "-", "—": "-", "−": "-", " ": " ",
})
_LIST_MARKER_RE = re.compile(r"(?m)^\s*(?:[-*+]|\d+[.)])\s+")
_MARKDOWN_RE = re.compile(r"[*_#`>|]")
_SPACE_RE = re.compile(r"\s+")


def normalize_for_match(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").translate(_QUOTE_CHARS)
    value = _LIST_MARKER_RE.sub("", value)
    value = _MARKDOWN_RE.sub(" ", value)
    value = _SPACE_RE.sub(" ", value).strip().lower()
    return value.strip(" \"'")


_HEADING_MARKER_RE = re.compile(r"(?m)^\s*#{1,6}\s+")


def clean_quote(quote: str) -> str:
    """Quote for storage: drop markdown heading/list markers, collapse space."""
    value = _HEADING_MARKER_RE.sub("", quote or "")
    value = _LIST_MARKER_RE.sub("", value)
    return _SPACE_RE.sub(" ", value).strip().lstrip("# ").strip()


def quote_in_text(quote: str, source_text: str) -> bool:
    """True when the quote appears in the text, ignoring whitespace,
    typographic quote/dash style, markdown markup, and case."""
    needle = normalize_for_match(quote).rstrip(".!?;:,")
    if len(needle) < MIN_QUOTE_CHARS:
        return False
    return needle in normalize_for_match(source_text)


# Bill or act names ("National Defense Authorization Act", "Medicare for All
# Act of 2021", "H.R. 1976") say nothing about which policy moves which way, so
# they can never be matched to a bill effect. Amendments ("Faircloth
# Amendment") are kept: they name a standing provision.
_BILL_NAME_RE = re.compile(
    r"(\b(Act|Bill)(\s+of\s+\d{4})?$)|(^(H\.?\s?R|S|H\.?\s?Res|S\.?\s?Res)\.?\s?\d+\b)",
    re.IGNORECASE,
)

REJECT_QUOTE = "quote not on page"
REJECT_BILL_TARGET = "bill name as target"


# Long-standing laws that people treat as the program itself ("protect the
# ACA"); bills and recent acts are still rejected.
STANDING_LAW_TARGETS = frozenset(
    slugify_target(name)
    for name in (
        "Affordable Care Act",
        "Americans with Disabilities Act",
        "Civil Rights Act",
        "Clean Air Act",
        "Clean Water Act",
        "Endangered Species Act",
        "Fair Housing Act",
        "Fair Labor Standards Act",
        "Freedom of Information Act",
        "National Environmental Policy Act",
        "Safe Drinking Water Act",
        "Voting Rights Act",
    )
)


def is_bill_name(target_name: str) -> bool:
    name = clean_target_name(target_name)
    if slugify_target(name) in STANDING_LAW_TARGETS:
        return False
    return bool(_BILL_NAME_RE.search(name))


def verify_positions(
    output: StatedPositionsOutput, chunk: Chunk
) -> tuple[list[VerifiedPosition], dict[str, int]]:
    """Keep positions whose quote is in the chunk and whose target is usable.

    Returns the kept positions and rejection counts by reason.
    """
    kept: list[VerifiedPosition] = []
    rejected = {REJECT_QUOTE: 0, REJECT_BILL_TARGET: 0}
    for position in output.positions:
        if not slugify_target(position.target_name) or not quote_in_text(position.evidence_quote, chunk.text):
            rejected[REJECT_QUOTE] += 1
            continue
        if is_bill_name(position.target_name):
            rejected[REJECT_BILL_TARGET] += 1
            continue
        position.target_name = clean_target_name(position.target_name)
        position.evidence_quote = clean_quote(position.evidence_quote)
        kept.append(VerifiedPosition(position, chunk.url, chunk.page_id))
    return kept, rejected


_EMPHASIS_RANK = {"low": 0, "medium": 1, "high": 2}
_EMPHASIS_WEIGHT = {"low": 1, "medium": 2, "high": 3}


def merge_positions(verified: list[VerifiedPosition]) -> list[VerifiedPosition]:
    """One position per (target slug, mechanism).

    Statements about the same target and mechanism vote on the official's
    desired direction, weighted by emphasis (high 3, medium 2, low 1). The
    winner's strongest statement supplies the summary and quote; a tie
    between different directions becomes "mixed". Result is capped and
    sorted by emphasis.
    """
    groups: dict[tuple[str, str], list[VerifiedPosition]] = {}
    for item in verified:
        key = (slugify_target(item.position.target_name), item.position.mechanism)
        groups.setdefault(key, []).append(item)

    out = []
    for items in groups.values():
        weights: dict[str, int] = {}
        for item in items:
            weights[item.direction] = weights.get(item.direction, 0) + _EMPHASIS_WEIGHT[item.position.emphasis]
        best = max(weights.values())
        leaders = [d for d, w in weights.items() if w == best]
        direction = leaders[0] if len(leaders) == 1 else "mixed"
        pool = [i for i in items if i.direction == direction] or items
        chosen = max(pool, key=lambda i: _EMPHASIS_RANK[i.position.emphasis])
        out.append(VerifiedPosition(chosen.position.model_copy(), chosen.source_url, chosen.page_id, direction))
    out.sort(key=lambda v: (-_EMPHASIS_RANK[v.position.emphasis], v.position.policy_area, v.position.target_name))
    return out[:MAX_STANCES_PER_OFFICIAL]


# -- database ----------------------------------------------------------------


def target_vocabulary(session: Session, limit: int = MAX_VOCABULARY_TARGETS) -> list[str]:
    """Most-used bill target names, so officials and bills share nouns.

    Draws from bill_effects (policy_targets) and from the free-text targets in
    bills.classification_metadata intents.
    """
    names: list[str] = []
    rows = (
        session.query(PolicyTarget.name, func.count(BillEffect.id).label("uses"))
        .join(BillEffect, BillEffect.target_id == PolicyTarget.id)
        .group_by(PolicyTarget.name)
        .order_by(func.count(BillEffect.id).desc(), PolicyTarget.name)
        .limit(limit)
        .all()
    )
    names.extend(name for name, _ in rows)
    try:
        intent_rows = session.execute(text(
            """
            SELECT intent->>'target' AS target, COUNT(*) AS uses
            FROM bills,
                 jsonb_array_elements(
                     CASE WHEN jsonb_typeof(classification_metadata->'intents') = 'array'
                          THEN classification_metadata->'intents' ELSE '[]'::jsonb END
                 ) AS intent
            WHERE classification_metadata IS NOT NULL
              AND COALESCE(intent->>'target', '') <> ''
            GROUP BY 1
            ORDER BY 2 DESC, 1
            LIMIT :limit
            """
        ), {"limit": limit}).all()
        names.extend(row[0] for row in intent_rows)
    except Exception:
        session.rollback()
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        cleaned = clean_target_name(name)
        slug = slugify_target(cleaned)
        if slug and slug not in seen:
            seen.add(slug)
            out.append(cleaned)
        if len(out) >= limit:
            break
    return out


def upsert_source_pages(session: Session, official_id: str, pages, fetched_at: datetime) -> dict[str, OfficialSourcePage]:
    """Store crawled pages; pages no longer found are marked not current."""
    existing = {
        row.url: row
        for row in session.query(OfficialSourcePage).filter(OfficialSourcePage.official_id == official_id).all()
    }
    stored: dict[str, OfficialSourcePage] = {}
    for page in pages:
        row = existing.get(page.url)
        if row is None:
            row = OfficialSourcePage(official_id=official_id, url=page.url)
            session.add(row)
        row.page_kind = page.page_kind
        row.title = page.title
        row.http_status = page.http_status
        row.content_hash = page.content_hash
        row.text = page.text
        row.fetched_at = fetched_at
        row.is_current = True
        row.error = None
        stored[page.url] = row
    for url, row in existing.items():
        if url not in stored:
            row.is_current = False
    session.flush()
    return stored


def persist_official_stances(
    session: Session,
    official_id: str,
    positions: list[VerifiedPosition],
    *,
    version: str,
    model: str,
    extracted_at: datetime,
    page_ids: dict[str, int] | None = None,
    source_type: str = SOURCE_OFFICIAL_SITE,
) -> list[OfficialStance]:
    """Replace this official's stances from one source type."""
    session.query(OfficialStance).filter(
        OfficialStance.official_id == official_id,
        OfficialStance.source_type == source_type,
    ).delete(synchronize_session=False)
    session.flush()

    stored: list[OfficialStance] = []
    used: set[tuple[int, str]] = set()
    for item in positions:
        p = item.position
        target = resolve_or_create_target(session, p.target_name)
        key = (target.id, p.mechanism)
        if key in used:
            continue
        used.add(key)
        row = OfficialStance(
            official_id=official_id,
            target_id=target.id,
            mechanism=p.mechanism,
            direction=item.direction,
            stance=p.stance,
            policy_direction=p.direction,
            target_name=p.target_name,
            target_slug=slugify_target(p.target_name),
            emphasis=p.emphasis,
            policy_area=p.policy_area,
            issue_label=p.issue_label.strip()[:200] or None,
            summary=p.summary.strip(),
            evidence_quote=p.evidence_quote,
            source_url=item.source_url,
            source_page_id=(page_ids or {}).get(item.source_url, item.page_id),
            source_type=source_type,
            extracted_at=extracted_at,
            extractor_version=version,
            model=model,
        )
        session.add(row)
        stored.append(row)
    session.flush()
    return stored
