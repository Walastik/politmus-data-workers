"""Parsing for the sources that explain how a bill was received: floor
speeches in the Congressional Record, minority / dissenting views in
committee reports, and amendment text. No network or database here (see
bill_context.py).

The Record marks each turn with the speaker's honorific and capitalized
surname at the start of a line ("  Mr. VAN HOLLEN. Mr. President, ..."),
optionally with a state when two members share a name ("Mr. KING of
Maine."). Presiding officers and clerks ("The PRESIDING OFFICER.") end a
turn without starting a speech.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass

# Turns shorter than this are yields, unanimous consent requests, Rule XIV
# calendar formalities, and the like.
MIN_SPEECH_WORDS = 60
MAX_SPEECH_CHARS = 20_000
MAX_VIEWS_CHARS = 20_000
AMENDMENT_EXCERPT_CHARS = 1_500

_TAG_RE = re.compile(r"<[^>]+>")
_PAGE_RE = re.compile(r"\[\[Page [A-Z]?\d+\]\]")
_TIME_RE = re.compile(r"\{time\}\s*\d+")
_SPACES_RE = re.compile(r"[ \t]+")

_SPEAKER_RE = re.compile(
    r"^[ \t]{0,4}(?:Mr|Ms|Mrs|Miss|Dr)\.[ \t]+"
    r"(?P<name>[A-Z][A-Z'\-]+(?:[ \t]+[A-Z][A-Z'\-]+)*)"
    r"(?:[ \t]+of[ \t]+(?P<state>[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)*))?"
    r"\.[ \t]",
    re.MULTILINE,
)
# Officers and the clerk: they end a speaker's turn.
_OFFICER_RE = re.compile(
    r"^[ \t]{0,4}The[ \t]+(?:SPEAKER|PRESIDING OFFICER|ACTING PRESIDENT|PRESIDENT|"
    r"CHAIR|CHAIRMAN|CHAIRWOMAN|Clerk|CLERK|VICE PRESIDENT)\b[^\n]*?\.[ \t]",
    re.MULTILINE,
)
# Text the speaker has read into the Record, not their own words.
_INSERTED_TEXT_RE = re.compile(
    r"(?:The text of the (?:bill|amendment|resolution) is as follows:|"
    r"I ask unanimous consent that the text of[^.]*be printed in the Record|"
    r"There being no objection, the material was ordered to be printed in the Record)",
    re.IGNORECASE,
)

_VIEWS_HEADING_RE = re.compile(
    r"^[ \t]*(?P<heading>(?:MINORITY|DISSENTING|ADDITIONAL|SUPPLEMENTAL)[ \t]+VIEWS)[ \t]*$",
    re.MULTILINE,
)

_BILL_LABELS = {
    "hr": "H.R.",
    "s": "S.",
    "hjres": "H.J.Res.",
    "sjres": "S.J.Res.",
    "hres": "H.Res.",
    "sres": "S.Res.",
    "hconres": "H.Con.Res.",
    "sconres": "S.Con.Res.",
}


@dataclass(frozen=True)
class Speech:
    """One member's words in one Record article (their turns joined)."""

    speaker: str  # surname as printed, title-cased: "Van Hollen"
    state: str | None
    text: str


def html_to_text(page: str | None) -> str:
    """Congressional Record / committee report HTML as plain text, keeping
    line breaks (the speaker markers depend on them)."""
    text = html_lib.unescape(_TAG_RE.sub("", page or ""))
    text = _PAGE_RE.sub("", text)
    text = _TIME_RE.sub("", text)
    lines = [_SPACES_RE.sub(" ", line.rstrip()) for line in text.splitlines()]
    return "\n".join(lines)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _title_name(name: str) -> str:
    return " ".join(part.capitalize() if "'" not in part else part.title() for part in name.split())


def parse_speeches(text: str, *, min_words: int = MIN_SPEECH_WORDS) -> list[Speech]:
    """Members' speeches in one article, in order of first appearance.

    Each member's turns are joined; text they read into the Record (bill
    or amendment text) is cut, and turns shorter than min_words are dropped.
    """
    markers = [(m.start(), m.end(), m) for m in _SPEAKER_RE.finditer(text)]
    markers += [(m.start(), m.end(), None) for m in _OFFICER_RE.finditer(text)]
    markers.sort(key=lambda item: item[0])

    turns: dict[tuple[str, str | None], list[str]] = {}
    for index, (_start, end, match) in enumerate(markers):
        if match is None:
            continue
        stop = markers[index + 1][0] if index + 1 < len(markers) else len(text)
        body = text[end:stop]
        inserted = _INSERTED_TEXT_RE.search(body)
        if inserted:
            body = body[: inserted.start()]
        body = _clean(body.replace("____________________", ""))
        if not body:
            continue
        key = (_title_name(match.group("name")), match.group("state"))
        turns.setdefault(key, []).append(body)

    speeches = []
    for (speaker, state), parts in turns.items():
        joined = " ".join(parts)
        if len(joined.split()) < min_words:
            continue
        speeches.append(Speech(speaker, state, joined[:MAX_SPEECH_CHARS]))
    return speeches


def bill_label(bill_id: str) -> str | None:
    """'119-hr-9340' -> 'H.R. 9340'."""
    parts = str(bill_id).split("-")
    if len(parts) < 3 or parts[1] not in _BILL_LABELS:
        return None
    return f"{_BILL_LABELS[parts[1]]} {parts[2]}"


def _norm_title(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", (value or "").upper()).strip()


def article_matches(article_title: str, short_titles: list[str], label: str | None) -> bool:
    """True when a Record article is about the bill: its heading (before any
    "--Motion to Proceed" or "; Congressional Record..." suffix) is one of
    the bill's short titles, or it names the bill's number."""
    title = (article_title or "").split(";", 1)[0]
    heading = _norm_title(title.split("--", 1)[0])
    if heading and any(heading == _norm_title(short) for short in short_titles if len(short) >= 8):
        return True
    if label:
        # "H.R. 9340" also matches "H.R.9340" and "HR 9340", not "H.R. 93401".
        prefix, number = label.rsplit(" ", 1)
        letters = r"\.?\s*".join(re.escape(c) for c in prefix.replace(".", ""))
        pattern = rf"(?<![A-Za-z0-9]){letters}\.?\s*{number}(?!\d)"
        return bool(re.search(pattern, title, re.IGNORECASE))
    return False


def extract_views(report_text: str) -> list[tuple[str, str]]:
    """(heading, text) for each MINORITY / DISSENTING / ADDITIONAL /
    SUPPLEMENTAL VIEWS section of a committee report. The table of
    contents is skipped because its lines carry dotted page leaders."""
    matches = list(_VIEWS_HEADING_RE.finditer(report_text or ""))
    out = []
    for index, match in enumerate(matches):
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(report_text)
        body = _clean(report_text[match.end():stop])
        if len(body.split()) < MIN_SPEECH_WORDS:
            continue
        heading = " ".join(match.group("heading").split()).title()
        out.append((heading, body[:MAX_VIEWS_CHARS]))
    return out


def amendment_excerpt(text: str, number: str | int, *, limit: int = AMENDMENT_EXCERPT_CHARS) -> str | None:
    """The start of an amendment's text from its Record page ("SA 6840. Mr.
    VAN HOLLEN ... submitted an amendment ...; as follows: <text>")."""
    clean = _clean(text)
    start = re.search(rf"\b(?:SA|S\.\s*Amdt\.|H\.\s*Amdt\.|Amendment No\.)\s*{number}\b", clean)
    if not start:
        return None
    rest = clean[start.start():]
    follows = re.search(r"as follows:\s*", rest)
    body = rest[follows.end():] if follows else rest
    nxt = re.search(r"\bSA \d+\.\s", body)
    if nxt:
        body = body[: nxt.start()]
    body = body.strip()
    return body[:limit] if body else None
