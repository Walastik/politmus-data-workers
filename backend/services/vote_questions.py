"""What a roll call's question votes on: the bill itself, an amendment, or a
procedure. Shared by bill status (status_mapper), accountability scoring,
and the bill drawer's vote labels, so all three read a question the same way.
"""

from __future__ import annotations

VOTE_KIND_PASSAGE = "passage"
VOTE_KIND_PROCEDURAL = "procedural"
VOTE_KIND_AMENDMENT = "amendment"
VOTE_KIND_OTHER = "other"

# Procedural motions: a Yes here is not a vote for the bill's contents.
_PROCEDURAL = (
    "recommit",
    "commit",
    "previous question",
    "table",
    "proceed",
    "cloture",
    "adjourn",
    "reconsider",
    "postpone",
    "instruct",
    "waive",
    "point of order",
    "quorum",
    "consider",
    "rule",
)
_PASSAGE = (
    "passage",
    "pass",
    "agree to the resolution",
    "agreeing to the resolution",
    "the resolution",
    "joint resolution",
    "concurrent resolution",
    "conference report",
    "concur",
    "overrid",
    "objections of the president notwithstanding",
)


def is_passage_question(question: str | None) -> bool:
    """True for votes on the bill itself: passage, suspension passage,
    adopting the resolution or conference report, concurring in the other
    chamber's amendment, and veto overrides. Procedural motions and votes
    on amendments are excluded."""
    q = " ".join((question or "").lower().split())
    if not q:
        return False
    # Accepting the other chamber's amendment is the bill's final passage.
    other_chamber = "concur" in q or "senate amendment" in q or "house amendment" in q
    if "amendment" in q and not other_chamber:
        return False
    # Suspension votes pass the bill outright despite containing "rules".
    if q.startswith("on motion to suspend the rules and"):
        return True
    if any(word in q for word in _PROCEDURAL):
        return False
    return other_chamber or any(word in q for word in _PASSAGE)


def vote_kind(question: str | None) -> str:
    """passage (see is_passage_question), procedural (cloture, motions to
    proceed, table, recommit, waive..., including motions about an
    amendment), amendment (a vote on the amendment itself), or other when
    the question says neither."""
    if is_passage_question(question):
        return VOTE_KIND_PASSAGE
    q = " ".join((question or "").lower().split())
    if not q:
        return VOTE_KIND_OTHER
    if any(word in q for word in _PROCEDURAL):
        return VOTE_KIND_PROCEDURAL
    if "amendment" in q or "amdt" in q:
        return VOTE_KIND_AMENDMENT
    return VOTE_KIND_OTHER
