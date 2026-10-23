"""Where supporters and opponents of a bill disagree, from their own words.

Input: the CRS summary, the bill's roll calls with party tallies, amendments
filed, and the floor speeches / committee views stored by bill_context.py.
Output (bills.debate_metadata): one neutral sentence naming the dispute, and
each side's main arguments, every one tied to a verbatim quote from a stored
source.

Neutrality is enforced in code, not only asked for in the prompt:
- every point must quote its source word for word (quote_in_text), or it is
  dropped; the speaker, party and link come from the stored source, never
  from the model;
- sides are assigned by what the speaker argued, not by party;
- when both sides have points, each side keeps the same number;
- loaded wording outside quotes ("toothless", "common-sense", ...) drops the
  point, or the key dispute sentence;
- nothing is generated for a bill with no stored sources.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel, ConfigDict, Field

from services.bill_classification import load_json
from services.official_positions import clean_quote, quote_in_text
from services.vote_questions import vote_kind

# Bump when the prompt, schema, input, or validation rules change.
DEBATE_VERSION = "debate-v1"

MAX_POINTS_PER_SIDE = 4
# Speech text sent to the model: per source, and in total (num_ctx 16384
# tokens is about 48k characters; this leaves room for the rest).
MAX_SOURCE_CHARS = 3_000
MAX_TOTAL_SOURCE_CHARS = 30_000
MAX_SUMMARY_CHARS = 4_000
MAX_AMENDMENTS = 15

STATUS_OK = "ok"
STATUS_FAILED = "failed"
STATUS_NO_SOURCES = "no_sources"

# Words that take a side when used by the narrator (fine inside a quote).
LOADED_WORDS = (
    "toothless", "flimsy", "shoddy", "weak", "feeble", "sham", "gimmick", "hollow",
    "common-sense", "commonsense", "common sense", "no-brainer", "radical",
    "reckless", "disastrous", "heroic", "landmark", "partisan stunt",
    "messaging bill", "job-killing", "giveaway", "handout", "slush fund", "unbelievable",
)
_LOADED_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in LOADED_WORDS) + r")\b", re.IGNORECASE)

DEFAULT_DEBATE_PROMPT = """You are a neutral legislative analyst. You explain why members of \
Congress disagreed about a bill, using only what they said on the floor or wrote in \
committee reports. You never say who is right, and you describe both sides with equal care.

You are given the bill's CRS summary, its roll call votes, the amendments filed to it, \
and numbered sources: floor speeches and committee views, each with the speaker's party.

Return:
- key_dispute: one sentence naming what the two sides disagree about, in neutral terms \
(e.g. "Members disagreed over whether the standard should be advisory for states or \
mandatory."). Do not say which side is right. Null if the sources show no disagreement.
- supporters: the main arguments made FOR passing the bill as written.
- opponents: the main arguments made AGAINST it, including that it does not go far enough.
Assign a speaker to a side by what they argued, never by party. Members of the same party \
can be on different sides.

Each argument:
- source_id: the number of the source it comes from.
- quote: one or two consecutive sentences copied word for word from that source. Do not \
paraphrase, shorten, or join sentences. Arguments whose quote is not in the source are discarded.
- point: one plain sentence stating the argument, starting with a verb such as "Says" or \
"Argues" (e.g. "Says the bill only asks states to consider the standard and does not \
require data centers to pay."). Describe the claim; do not judge it. Never use loaded \
words such as "toothless", "common-sense", "radical", or "weak" outside the quote.

Give at most {max_points} arguments per side, one per distinct argument, preferring \
different speakers. If a side made no arguments in the sources, return an empty list for it. \
Do not use anything you know about the bill beyond the text provided.
Output strictly valid JSON matching the schema."""


class DebatePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: int = Field(description="Number of the source the quote is from.")
    quote: str = Field(description="One or two consecutive sentences copied verbatim from that source.")
    point: str = Field(description="One neutral sentence stating the argument, starting with 'Says' or 'Argues'.")


class BillDebate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key_dispute: str | None = Field(description="One neutral sentence naming the disagreement, or null.")
    supporters: list[DebatePoint] = Field(description="Arguments for passing the bill as written.")
    opponents: list[DebatePoint] = Field(description="Arguments against it, including that it does not go far enough.")


@dataclass(frozen=True)
class DebateSource:
    id: int
    kind: str
    speaker: str | None
    party: str | None
    state: str | None
    chamber: str | None
    date: str | None
    title: str | None
    text: str
    url: str | None


@dataclass(frozen=True)
class DebateInput:
    bill_id: str
    title: str | None
    summary: str
    roll_calls: list[dict]  # {chamber, date, question, result, by_party: {party: {Yes, No}}}
    amendments: list[dict]  # {chamber, sponsor_name, sponsor_party, latest_action_text, text_excerpt}
    sources: list[DebateSource]

    @property
    def input_hash(self) -> str:
        payload = json.dumps(
            [self.title, self.summary, self.roll_calls, self.amendments,
             [(s.id, s.speaker, s.party, s.text) for s in self.sources]],
            sort_keys=True, default=str,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def debate_version(prompt: str, model: str) -> str:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
    return f"{DEBATE_VERSION}|p{digest}|{model}"


def _speaker_label(source: DebateSource) -> str:
    if source.kind == "committee_views":
        return source.title or "Committee views"
    parts = [source.party[0] if source.party else None, source.state]
    tag = "-".join(p for p in parts if p)
    tag = f" ({tag})" if tag else ""
    return f"{source.chamber or ''} {source.speaker or 'Unknown speaker'}{tag}".strip()


def balanced_sources(sources: list[DebateSource]) -> list[DebateSource]:
    """Sources that fit the budget, taken round-robin across parties so a
    side with more speakers cannot crowd out the other."""
    by_party: dict[str, list[DebateSource]] = {}
    for source in sources:
        by_party.setdefault(source.party or "", []).append(source)
    queues = list(by_party.values())
    picked, used = [], 0
    while any(queues):
        for queue in queues:
            if not queue:
                continue
            source = queue.pop(0)
            size = min(len(source.text), MAX_SOURCE_CHARS)
            if used + size > MAX_TOTAL_SOURCE_CHARS:
                continue
            picked.append(source)
            used += size
    return sorted(picked, key=lambda s: s.id)


def build_messages(prompt: str, data: DebateInput, sources: list[DebateSource]) -> list[dict[str, str]]:
    votes = []
    for rc in data.roll_calls:
        parties = ", ".join(
            f"{party} {counts.get('Yes', 0)}-{counts.get('No', 0)}"
            for party, counts in sorted((rc.get("by_party") or {}).items())
        )
        votes.append(
            f"- {rc.get('chamber')} {rc.get('date') or ''}: {rc.get('question') or 'vote'} "
            f"[{vote_kind(rc.get('question'))}] -> {rc.get('result') or 'unknown'}"
            + (f" (Yes-No by party: {parties})" if parties else "")
        )
    amendments = [
        f"- {a.get('chamber') or ''} amendment by {a.get('sponsor_name') or 'unknown'}"
        f" ({a.get('sponsor_party') or 'party unknown'}): "
        f"{(a.get('text_excerpt') or a.get('purpose') or 'no text')[:300]}"
        f" [{a.get('latest_action_text') or 'no action recorded'}]"
        for a in data.amendments[:MAX_AMENDMENTS]
    ]
    blocks = [
        f"<source id=\"{s.id}\" speaker=\"{_speaker_label(s)}\" date=\"{s.date or ''}\">\n"
        f"{s.text[:MAX_SOURCE_CHARS]}\n</source>"
        for s in sources
    ]
    user = (
        f"Bill: {data.bill_id} {data.title or ''}\n\n"
        f"CRS summary:\n<summary>\n{data.summary[:MAX_SUMMARY_CHARS]}\n</summary>\n\n"
        "Roll call votes:\n" + ("\n".join(votes) or "- none") + "\n\n"
        "Amendments filed:\n" + ("\n".join(amendments) or "- none") + "\n\n"
        "Sources:\n" + "\n\n".join(blocks) + "\n\n"
        "Each quote must be copied word for word from the source whose id you give. "
        "Return JSON matching the schema."
    )
    return [
        {"role": "system", "content": prompt.replace("{max_points}", str(MAX_POINTS_PER_SIDE))},
        {"role": "user", "content": user},
    ]


def _verified(points: list[DebatePoint], sources: dict[int, DebateSource], rejected: dict[str, int]) -> list[dict]:
    out, seen = [], set()
    for point in points:
        source = sources.get(point.source_id)
        if source is None or not quote_in_text(point.quote, source.text):
            rejected["quote not in source"] = rejected.get("quote not in source", 0) + 1
            continue
        if _LOADED_RE.search(point.point or ""):
            rejected["loaded wording"] = rejected.get("loaded wording", 0) + 1
            continue
        if (source.id, point.quote) in seen:
            continue
        seen.add((source.id, point.quote))
        out.append({
            "point": point.point.strip(),
            "quote": clean_quote(point.quote),
            "source_id": source.id,
            "speaker": source.speaker,
            "party": source.party,
            "state": source.state,
            "chamber": source.chamber,
            "kind": source.kind,
            "title": source.title,
            "date": source.date,
            "url": source.url,
        })
    # Prefer one point per speaker, keeping the model's order.
    first, rest, speakers = [], [], set()
    for item in out:
        (rest if item["source_id"] in speakers else first).append(item)
        speakers.add(item["source_id"])
    return (first + rest)[:MAX_POINTS_PER_SIDE]


def summarize_debate(data: DebateInput, *, prompt: str, chat_fn: Callable) -> dict:
    """bills.debate_metadata content (without model/version provenance).
    Raises ValueError when there are no sources or the model output is
    unusable."""
    if not data.sources:
        raise ValueError("bill has no floor speeches or committee views")
    sources = balanced_sources(data.sources)
    raw = chat_fn(build_messages(prompt, data, sources), BillDebate.model_json_schema())
    debate = BillDebate.model_validate(load_json(raw))
    by_id = {s.id: s for s in sources}
    rejected: dict[str, int] = {}
    supporters = _verified(debate.supporters, by_id, rejected)
    opponents = _verified(debate.opponents, by_id, rejected)
    if supporters and opponents:
        n = min(len(supporters), len(opponents))
        supporters, opponents = supporters[:n], opponents[:n]
    key_dispute = (debate.key_dispute or "").strip() or None
    if key_dispute and _LOADED_RE.search(key_dispute):
        rejected["loaded wording"] = rejected.get("loaded wording", 0) + 1
        key_dispute = None
    if not (supporters and opponents):
        # A dispute needs two sides on the record.
        key_dispute = None
    return {
        "key_dispute": key_dispute,
        "supporters": supporters,
        "opponents": opponents,
        "sources_considered": len(sources),
        "sources_total": len(data.sources),
        "rejected": rejected,
        "input_hash": data.input_hash,
    }
