"""Bill classification (TLDR, ELI5, policy intents) from CRS summaries:
output schema, CRS HTML to text, short/long-bill model calls, citation
verification, merging, and versioning.

Intents use the same target / mechanism / direction / magnitude vocabulary as
bill_effects (services/bill_effects.py), so validated intents can also be
stored there for vote scoring.

The prompts are not in the repo: they live in the gitignored
backend/scripts/llm_config.py (see llm_config.example.py there). The output
schema below is public, like the frontend type it feeds
(frontend/src/types.ts ClassificationMetadata).
"""

from __future__ import annotations

import hashlib
import html as html_lib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from services.bill_effects import (
    BillEffectsOutput,
    Direction,
    ExtractedEffect,
    Magnitude,
    Mechanism,
    clean_target_name,
    slugify_target,
)
from services.official_positions import (
    SourceText,
    chunk_source,
    clean_quote,
    is_bill_name,
    quote_in_text,
)

# Bump when the output schema, input text, or validation rules change so
# every bill is re-classified on the next run.
SCHEMA_VERSION = "bills-v1"

DEFAULT_CHUNK_CHARS = 10_000
MIN_SUMMARY_CHARS = 20
MAX_INTENTS = 60
SOURCE_CRS_SUMMARY = "crs_summary"

REJECT_CITATION = "citation not in summary"
REJECT_BILL_TARGET = "bill name as target"

STATUS_OK = "ok"
STATUS_INCOMPLETE = "incomplete"
STATUS_FAILED = "failed"
STATUS_NO_SUMMARY = "no_summary"


# -- schema ------------------------------------------------------------------


class BillIntent(BaseModel):
    """One policy intent. citation comes first so the model quotes the
    summary before it labels anything."""

    model_config = ConfigDict(extra="forbid")

    citation: str = Field(description="One or two consecutive sentences copied verbatim from the summary.")
    target: str = Field(description="Policy noun acted on, e.g. ICE, Medicaid, Voting Eligibility. Never a bill name.")
    mechanism: Mechanism = Field(description="funding, regulation, oversight, or taxation.")
    direction: Direction = Field(description="increase, decrease, maintain, or mixed.")
    magnitude: Magnitude = Field(description="low, medium, or high.")
    rationale: str = Field(description="One sentence on why this label fits the citation.")


def _required_text(value: str) -> str:
    value = (value or "").strip()
    if len(value) < MIN_SUMMARY_CHARS:
        raise ValueError(f"must be at least {MIN_SUMMARY_CHARS} characters")
    return value


class BillSummaries(BaseModel):
    """TLDR and ELI5 only: the final call for long bills, and the retry when
    a full classification came back without them."""

    model_config = ConfigDict(extra="forbid")

    tldr: str = Field(min_length=MIN_SUMMARY_CHARS, description="One or two plain sentences on what the bill does.")
    eli5: str = Field(min_length=MIN_SUMMARY_CHARS, description="The bill explained simply for a non-expert.")

    @field_validator("tldr", "eli5")
    @classmethod
    def strip_and_require(cls, value: str) -> str:
        return _required_text(value)


class BillClassification(BillSummaries):
    """Full output for a bill whose summary fits in one call. tldr and eli5
    come before intents so a long intent list cannot crowd them out."""

    intents: list[BillIntent] = Field(description="Distinct policy intents, each with a verbatim citation.")


class BillIntentsOnly(BaseModel):
    """Output for one chunk of a long summary."""

    model_config = ConfigDict(extra="forbid")

    intents: list[BillIntent] = Field(description="Distinct policy intents in this part, each with a verbatim citation.")


class IncompleteSummaries(ValueError):
    """The model returned intents but a blank or missing tldr/eli5."""


@dataclass(frozen=True)
class BillSnapshot:
    """Plain copy of the Bill fields the classifier needs.

    Model calls run on worker threads and outlive any DB transaction, so
    they never see ORM objects.
    """

    id: str
    title: str | None = None
    policy_area: str | None = None
    sponsor_name: str | None = None
    sponsor_party: str | None = None
    bipartisan_type: str | None = None
    status: str | None = None
    latest_action_text: str | None = None
    summary: str | None = None

    @classmethod
    def of(cls, bill) -> "BillSnapshot":
        return cls(
            bill.id,
            bill.title,
            bill.policy_area,
            bill.sponsor_name,
            bill.sponsor_party,
            bill.bipartisan_type,
            bill.status,
            bill.latest_action_text,
            bill.summary,
        )

    @property
    def input_hash(self) -> str:
        return input_hash(self.title, self.policy_area, self.summary)


@dataclass
class ClassificationResult:
    tldr: str
    eli5: str
    intents: list[BillIntent]
    rejected: dict[str, int] = field(default_factory=dict)
    chunks: int = 1

    def metadata(self, *, model: str, version: str, classified_at: str) -> dict:
        """JSON for bills.classification_metadata. tldr / eli5 / intents are
        what the frontend reads; the rest is provenance."""
        return {
            "tldr": self.tldr,
            "eli5": self.eli5,
            "intents": [
                {
                    "target": i.target,
                    "mechanism": i.mechanism,
                    "direction": i.direction,
                    "magnitude": i.magnitude,
                    "rationale": i.rationale,
                    "citation": i.citation,
                }
                for i in self.intents
            ],
            "model": model,
            "version": version,
            "classified_at": classified_at,
            "source": SOURCE_CRS_SUMMARY,
            "chunks": self.chunks,
            "rejected": {reason: n for reason, n in self.rejected.items() if n},
        }

    def effects_output(self) -> BillEffectsOutput:
        """The intents as bill_effects rows (citation kept in the rationale)."""
        return BillEffectsOutput(effects=[
            ExtractedEffect(
                target_name=i.target,
                mechanism=i.mechanism,
                direction=i.direction,
                magnitude=i.magnitude,
                rationale=f'{i.rationale.strip()} "{i.citation}"'.strip(),
            )
            for i in self.intents
        ])


# -- hashing / versions ------------------------------------------------------


def input_hash(title: str | None, policy_area: str | None, summary: str | None) -> str:
    """What the classification depends on. Status and latest action are left
    out so a bill moving through Congress is not re-classified each step.
    Must match INPUT_HASH_SQL."""
    value = f"{title or ''}\n{policy_area or ''}\n{summary or ''}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


INPUT_HASH_SQL = (
    "encode(sha256(convert_to("
    "coalesce(bills.title, '') || chr(10) || coalesce(bills.policy_area, '') "
    "|| chr(10) || coalesce(bills.summary, ''), 'UTF8')), 'hex')"
)


def classifier_version(prompts: tuple[str, ...], model: str) -> str:
    """Changes whenever the schema, a local prompt, or the model changes."""
    digest = hashlib.sha256("\0".join(prompts).encode("utf-8")).hexdigest()[:12]
    return f"{SCHEMA_VERSION}|p{digest}|{model}"


def model_from_version(version: str | None) -> str | None:
    """The model part of a classifier_version string, or None if it has none."""
    parts = (version or "").split("|", 2)
    if len(parts) < 3 or not parts[2].strip():
        return None
    return parts[2].strip()


def metadata_is_complete(metadata) -> bool:
    """Legacy rows were saved without checks; these lack a TLDR/ELI5/intents."""
    if not isinstance(metadata, dict):
        return False
    return (
        isinstance(metadata.get("intents"), list)
        and bool(str(metadata.get("tldr") or "").strip())
        and bool(str(metadata.get("eli5") or "").strip())
    )


# -- CRS summary HTML -> text with headings ----------------------------------

_HEADING_TAG_RE = re.compile(r"<h[1-6][^>]*>(.*?)</h[1-6]\s*>", re.IGNORECASE | re.DOTALL)
# A paragraph that is only bold text: CRS's title / subtitle / section labels.
_BOLD_PARA_RE = re.compile(
    r"<p[^>]*>\s*<(strong|b)\b[^>]*>(.*?)</\1\s*>\s*</p\s*>", re.IGNORECASE | re.DOTALL
)
_LI_RE = re.compile(r"<li\b[^>]*>", re.IGNORECASE)
_BLOCK_RE = re.compile(
    r"</?(p|div|ul|ol|li|h[1-6]|table|tr|blockquote|section)\b[^>]*>|<br\s*/?>", re.IGNORECASE
)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACES_RE = re.compile(r"[ \t\r\f\v ]+")
_MAX_HEADING_CHARS = 200


def _inline(fragment: str) -> str:
    text = html_lib.unescape(_TAG_RE.sub("", fragment))
    return _SPACES_RE.sub(" ", text).strip()


def summary_text(summary: str | None) -> str:
    """CRS summary HTML as plain text with "## " heading lines.

    Bold-only paragraphs and <h*> become headings (consecutive headings,
    e.g. a title and its first subtitle, are joined), so chunk_source can
    split at title/subtitle boundaries; every other paragraph, including
    each "(Sec. 101)" paragraph, stays a paragraph, so long sections split
    between provisions. Nothing is truncated.
    """
    if not summary or not summary.strip():
        return ""

    def heading(match, group):
        text = _inline(match.group(group))
        if not text or len(text) > _MAX_HEADING_CHARS:
            return f"\n\n{text}\n\n"
        return f"\n\n## {text}\n\n"

    value = _HEADING_TAG_RE.sub(lambda m: heading(m, 1), summary)
    value = _BOLD_PARA_RE.sub(lambda m: heading(m, 2), value)
    value = _LI_RE.sub("\n- ", value)
    value = _BLOCK_RE.sub("\n\n", value)
    value = html_lib.unescape(_TAG_RE.sub("", value))
    lines = [_SPACES_RE.sub(" ", line).strip() for line in value.splitlines()]

    # Paragraphs separated by one blank line; consecutive headings joined.
    blocks: list[str] = []
    current: list[str] = []
    for line in lines + [""]:
        if line:
            current.append(line)
            continue
        if current:
            blocks.append(" ".join(current) if not current[0].startswith("- ") else "\n".join(current))
            current = []
    merged: list[str] = []
    for block in blocks:
        if block.startswith("## ") and merged and merged[-1].startswith("## "):
            merged[-1] = f"{merged[-1]} / {block[3:]}"
        else:
            merged.append(block)
    text = "\n\n".join(merged).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


# -- prompts -----------------------------------------------------------------


def describe_bill(bill: BillSnapshot) -> str:
    parts = [f"Bill ID: {bill.id}"]
    if bill.title:
        parts.append(f"Title: {bill.title}")
    if bill.policy_area:
        parts.append(f"Policy Area: {bill.policy_area}")
    if bill.sponsor_name:
        sponsor = bill.sponsor_name + (f" ({bill.sponsor_party})" if bill.sponsor_party else "")
        parts.append(f"Sponsor: {sponsor}")
    if bill.bipartisan_type:
        parts.append(f"Bipartisan Status: {bill.bipartisan_type}")
    if bill.status:
        parts.append(f"Legislative Status: {bill.status}")
    if bill.latest_action_text:
        parts.append(f"Latest Action: {bill.latest_action_text}")
    return "\n".join(parts)


_CITATION_RULE = (
    "Each intent's citation must be copied word for word from the summary text "
    "above (one or two consecutive sentences, no ellipses); intents whose citation "
    "is not in the text are discarded. Targets are policy nouns, never bill names."
)
_SUMMARY_RULE = f"tldr and eli5 are required and must each be at least {MIN_SUMMARY_CHARS} characters."
_RETRY_NOTE = "Your previous answer left tldr or eli5 empty or too short. Write both."


def _messages(system: str, user: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": (system or "").strip()},
        {"role": "user", "content": user},
    ]


def build_full_messages(prompt: str, bill: BillSnapshot, text: str) -> list[dict[str, str]]:
    user = (
        f"Analyze this bill:\n{describe_bill(bill)}\n\n"
        f"Congressional Research Service (CRS) Summary:\n<summary>\n{text}\n</summary>\n\n"
        f"{_SUMMARY_RULE} {_CITATION_RULE} Return JSON matching the schema."
    )
    return _messages(prompt, user)


def build_chunk_messages(prompt: str, bill: BillSnapshot, chunk, number: int, total: int) -> list[dict[str, str]]:
    where = f"Part {number} of {total} of the CRS summary" + (f", section: {chunk.heading}" if chunk.heading else "")
    user = (
        f"Analyze this bill:\n{describe_bill(bill)}\n\n{where}.\n<summary>\n{chunk.text}\n</summary>\n\n"
        "Return only the policy intents found in this part; the TLDR and ELI5 are written "
        f"separately. {_CITATION_RULE} Return JSON matching the schema."
    )
    return _messages(prompt, user)


def build_summary_messages(
    prompt: str,
    bill: BillSnapshot,
    overview: str,
    intents: list[BillIntent],
    *,
    retry: bool = False,
) -> list[dict[str, str]]:
    listing = "\n".join(
        f"- {i.target} / {i.mechanism} / {i.direction} ({i.magnitude})" for i in intents
    ) or "- (none found)"
    user = (
        f"Analyze this bill:\n{describe_bill(bill)}\n\n"
        f"Beginning of the CRS summary:\n<summary>\n{overview}\n</summary>\n\n"
        f"Policy intents found across the whole summary:\n{listing}\n\n"
        f"Write the tldr and eli5 for the whole bill. {_SUMMARY_RULE} Return JSON matching the schema."
    )
    if retry:
        user += f"\n\n{_RETRY_NOTE}"
    return _messages(prompt, user)


# -- parsing -----------------------------------------------------------------

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def load_json(raw: str) -> dict:
    content = (raw or "").strip()
    if not content:
        raise ValueError("model returned an empty response")
    data = json.loads(_FENCE_RE.sub("", content).strip())
    if not isinstance(data, dict):
        raise ValueError("model returned JSON that is not an object")
    return data


def parse_intents(data: dict) -> list[BillIntent]:
    if "intents" not in data:
        raise ValueError("model output has no intents list")
    return BillIntentsOnly.model_validate({"intents": data["intents"]}).intents


def parse_summaries(data: dict) -> BillSummaries | None:
    """tldr and eli5, or None when either is missing, blank, or too short."""
    try:
        return BillSummaries.model_validate({"tldr": data.get("tldr") or "", "eli5": data.get("eli5") or ""})
    except ValidationError:
        return None


# -- verification and merge --------------------------------------------------


def verify_intents(intents: list[BillIntent], source_text: str) -> tuple[list[BillIntent], dict[str, int]]:
    """Keep intents whose citation is in source_text and whose target is a
    usable policy noun. Returns kept intents and rejection counts."""
    kept: list[BillIntent] = []
    rejected = {REJECT_CITATION: 0, REJECT_BILL_TARGET: 0}
    for intent in intents:
        if not slugify_target(intent.target) or not quote_in_text(intent.citation, source_text):
            rejected[REJECT_CITATION] += 1
            continue
        if is_bill_name(intent.target):
            rejected[REJECT_BILL_TARGET] += 1
            continue
        kept.append(intent.model_copy(update={
            "target": clean_target_name(intent.target),
            "citation": clean_quote(intent.citation),
            "rationale": intent.rationale.strip(),
        }))
    return kept, rejected


_MAGNITUDE_RANK = {"low": 0, "medium": 1, "high": 2}
_MAGNITUDE_WEIGHT = {"low": 1, "medium": 2, "high": 3}


def merge_intents(intents: list[BillIntent], limit: int = MAX_INTENTS) -> list[BillIntent]:
    """One intent per (target slug, mechanism), in first-seen order, then
    stable-sorted by magnitude and capped.

    Directions vote, weighted by magnitude (high 3, medium 2, low 1); an
    exact tie between different directions becomes "mixed". The strongest
    intent in the winning direction supplies the citation and rationale, and
    the group keeps its highest magnitude.
    """
    groups: dict[tuple[str, str], list[BillIntent]] = {}
    for intent in intents:
        groups.setdefault((slugify_target(intent.target), intent.mechanism), []).append(intent)

    out: list[BillIntent] = []
    for items in groups.values():
        weights: dict[str, int] = {}
        for item in items:
            weights[item.direction] = weights.get(item.direction, 0) + _MAGNITUDE_WEIGHT[item.magnitude]
        best = max(weights.values())
        leaders = [d for d, w in weights.items() if w == best]
        direction = leaders[0] if len(leaders) == 1 else "mixed"
        pool = [i for i in items if i.direction == direction] or items
        chosen = max(pool, key=lambda i: _MAGNITUDE_RANK[i.magnitude])
        magnitude = max((i.magnitude for i in items), key=_MAGNITUDE_RANK.__getitem__)
        out.append(chosen.model_copy(update={"direction": direction, "magnitude": magnitude}))
    out.sort(key=lambda i: -_MAGNITUDE_RANK[i.magnitude])
    return out[:limit]


def _add_counts(total: dict[str, int], counts: dict[str, int]) -> None:
    for reason, n in counts.items():
        total[reason] = total.get(reason, 0) + n


# -- classification ----------------------------------------------------------


def _write_summaries(chat_fn, prompt, bill, overview, intents, *, retry_only=False) -> BillSummaries:
    """The BillSummaries call, retried once with a note (retry_only: just the
    retry); raises IncompleteSummaries when tldr/eli5 are still missing."""
    for retry in ((True,) if retry_only else (False, True)):
        data = load_json(chat_fn(
            build_summary_messages(prompt, bill, overview, intents, retry=retry),
            BillSummaries.model_json_schema(),
        ))
        summaries = parse_summaries(data)
        if summaries is not None:
            return summaries
    raise IncompleteSummaries(
        f"tldr/eli5 still missing or under {MIN_SUMMARY_CHARS} characters after a retry"
    )


def classify_bill(
    bill: BillSnapshot,
    text: str,
    *,
    prompt: str,
    summary_prompt: str | None = None,
    chat_fn: Callable,
    concurrency: int = 2,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    log: Callable[[str], None] | None = None,
) -> ClassificationResult:
    """Classify one bill from its summary text.

    Short summaries (<= chunk_chars): one full call; if it lacks tldr/eli5,
    one summaries-only call fills them in. Long summaries: one intents call
    per heading-aligned chunk (in parallel), merge, then one summaries call
    with the opening chunk and the merged intents. Citations are checked
    against the text the call saw. Raises on any failed call, so partial
    results are never returned; IncompleteSummaries when tldr/eli5 could not
    be produced.
    """
    if not text.strip():
        raise ValueError("bill has no summary text")
    summary_prompt = summary_prompt or prompt
    rejected: dict[str, int] = {}

    if len(text) <= chunk_chars:
        data = load_json(chat_fn(build_full_messages(prompt, bill, text), BillClassification.model_json_schema()))
        kept, counts = verify_intents(parse_intents(data), text)
        _add_counts(rejected, counts)
        intents = merge_intents(kept)
        summaries = parse_summaries(data)
        if summaries is None:
            if log:
                log("    tldr/eli5 missing; asking for them separately...")
            summaries = _write_summaries(chat_fn, summary_prompt, bill, text, intents, retry_only=True)
        return ClassificationResult(summaries.tldr, summaries.eli5, intents, rejected, 1)

    chunks = chunk_source(SourceText(bill.id, text), chunk_chars)
    total = len(chunks)
    if log:
        log(f"  long summary ({len(text):,} chars): {total} chunk(s)...")

    def run(numbered):
        number, chunk = numbered
        try:
            data = load_json(chat_fn(
                build_chunk_messages(prompt, bill, chunk, number, total),
                BillIntentsOnly.model_json_schema(),
            ))
            result = verify_intents(parse_intents(data), chunk.text)
        except Exception as exc:
            where = f" [{chunk.heading}]" if chunk.heading else ""
            raise RuntimeError(f"chunk {number}/{total}{where}: {exc}") from exc
        if log:
            log(f"    chunk {number}/{total}: {len(result[0])} kept, {sum(result[1].values())} rejected")
        return result

    numbered = list(enumerate(chunks, start=1))
    workers = max(1, min(concurrency, total))
    if workers == 1:
        results = [run(item) for item in numbered]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(run, numbered))
    kept = [intent for intents, _ in results for intent in intents]
    for _, counts in results:
        _add_counts(rejected, counts)
    intents = merge_intents(kept)
    try:
        summaries = _write_summaries(chat_fn, summary_prompt, bill, chunks[0].text, intents)
    except IncompleteSummaries:
        raise
    except Exception as exc:
        raise RuntimeError(f"summary call: {exc}") from exc
    return ClassificationResult(summaries.tldr, summaries.eli5, intents, rejected, total)
