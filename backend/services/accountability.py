"""Accountability engine: do officials vote for what they say they want?

Each bill intent (bill_effects) an official has a stated position on
(official_stances, same mechanism and the same target, or a target whose
name means nearly the same thing: see services/target_matching.py) is
scored against the official's passage vote on that bill. A pair reviewed as
inverse (more of one is less of the other) matches with the bill's
direction flipped:

    stance vs intent          Yes   No
    same direction            +1    -1
    opposite direction        -1    +1
    maintain / mixed either    0     0

Only Yes/No votes on passage-type questions count (see is_passage_question),
and only the latest one per official, bill and chamber, so a bill voted on
twice is not double counted. Bills must be classified (status ok).

Not every match counts (apply_rules keeps the rest, with a reason, so the
drawer can show them):
- low-emphasis positions (inferred from a slogan or value statement);
- local positions (one district, state, facility) on a broad bill;
- medium-emphasis positions on an unrelated add-on (relation secondary), or
  on anything but a high-magnitude provision of a broad bill. High-emphasis
  positions, which name the change, count on any provision;
- a match on the same policy (target, mechanism, effect direction) as a
  later vote in the same Congress, so companion bills (a chamber's version
  and the final one) count once.

Each vote then scores once: its counted matches net to +1, -1, or 0, so one
vote on a bill with several matching provisions is one point.

Scores are derived data: rescore() rewrites an official's vote_alignments and
official_scores rows only when the hash of their computed rows changes, so it
is safe (and cheap, no LLM) to run after every ingest or worker run.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from typing import Callable, Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import OfficialScore, OfficialStance, RollCall, Vote, VoteAlignment

# Bump when scoring rules or the stored row shape change; every official is
# rewritten on the next run.
ENGINE_VERSION = "accountability-v3"

# Unreviewed target_matches pairs at least this similar count as the same
# target; reviewed pairs follow their verdict. An exact target match always
# wins over a near one.
TARGET_MATCH_THRESHOLD = float(os.getenv("TARGET_MATCH_THRESHOLD", "0.85"))

# A bill with this many classified effects is broad (omnibus, NDAA,
# reconciliation): one vote on it says little about any single provision.
BROAD_BILL_MIN_EFFECTS = 10

REASON_LOW_EMPHASIS = "low_emphasis"
REASON_LOCAL_ON_BROAD = "local_on_broad_bill"
REASON_UNRELATED_PROVISION = "unrelated_provision"
REASON_MINOR_PROVISION = "minor_provision"
REASON_LATER_VOTE = "later_vote"

SCORED_POSITIONS = ("Yes", "No")
_OPPOSITES = {("increase", "decrease"), ("decrease", "increase")}
_EMPHASIS_RANK = {"high": 0, "medium": 1, "low": 2}

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


def alignment_points(stance_direction: str | None, effect_direction: str | None, position: str | None) -> int:
    """+1 when the vote moves the target the way the official says they
    want, -1 when it moves it the other way, 0 when it can't be judged."""
    if position not in SCORED_POSITIONS:
        return 0
    if stance_direction == effect_direction and stance_direction in ("increase", "decrease"):
        agrees = True
    elif (stance_direction, effect_direction) in _OPPOSITES:
        agrees = False
    else:
        return 0
    return 1 if agrees == (position == "Yes") else -1


@dataclass(frozen=True)
class Alignment:
    """One computed match, before it is stored."""

    official_id: str
    bill_id: str
    roll_call_id: int
    chamber: str | None
    vote_date: date | None
    vote_position: str
    target_id: int
    target_name: str | None
    mechanism: str
    effect_direction: str
    effect_magnitude: str | None
    effect_rationale: str | None
    stance_direction: str
    stance_emphasis: str | None
    stance_summary: str | None
    stance_evidence_quote: str | None
    stance_source_url: str | None
    policy_area: str | None
    points: int
    effect_relation: str | None = None
    stance_scope: str | None = None
    bill_effect_count: int | None = None
    counted: bool = True
    reason: str | None = None
    stance_target_id: int | None = None
    stance_target_name: str | None = None
    match_similarity: float | None = None
    match_inverse: bool = False

    @property
    def compared_direction(self) -> str:
        """The bill's direction as it applies to the position's target."""
        if self.match_inverse:
            return {"increase": "decrease", "decrease": "increase"}.get(self.effect_direction, self.effect_direction)
        return self.effect_direction

    @property
    def broad_bill(self) -> bool:
        return (self.bill_effect_count or 0) >= BROAD_BILL_MIN_EFFECTS

    def key(self) -> tuple:
        return (self.bill_id, self.roll_call_id, self.target_id, self.mechanism)

    def fingerprint(self) -> list:
        return [
            self.bill_id, self.roll_call_id, self.chamber,
            self.vote_date.isoformat() if self.vote_date else None,
            self.vote_position, self.target_id, self.target_name, self.mechanism,
            self.effect_direction, self.effect_magnitude, self.effect_rationale,
            self.stance_direction, self.stance_emphasis, self.stance_summary,
            self.stance_evidence_quote, self.stance_source_url, self.policy_area,
            self.points, self.effect_relation, self.stance_scope, self.bill_effect_count,
            self.counted, self.reason, self.stance_target_id, self.stance_target_name,
            self.match_similarity, self.match_inverse,
        ]


def inputs_hash(alignments: Iterable[Alignment]) -> str:
    rows = sorted((a.fingerprint() for a in alignments), key=lambda r: json.dumps(r, default=str))
    payload = json.dumps([ENGINE_VERSION, rows], default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def rule_reason(a: Alignment) -> str | None:
    """Why a match is kept out of the score, or None if it counts."""
    if a.stance_emphasis == "low":
        return REASON_LOW_EMPHASIS
    if a.broad_bill and a.stance_scope == "local":
        return REASON_LOCAL_ON_BROAD
    if a.stance_emphasis != "high":
        if a.effect_relation == "secondary":
            return REASON_UNRELATED_PROVISION
        if a.broad_bill and a.effect_magnitude != "high":
            return REASON_MINOR_PROVISION
    return None


def _congress(bill_id: str) -> str:
    return bill_id.split("-", 1)[0]


def apply_rules(alignments: list[Alignment]) -> list[Alignment]:
    """One official's matches with counted / reason set (see module doc)."""
    out = [replace(a, counted=False, reason=r) if (r := rule_reason(a)) else a for a in alignments]
    latest: dict[tuple, Alignment] = {}
    for a in out:
        if not a.counted:
            continue
        # Keyed by the position's target, so companion bills whose intents
        # are named differently but match the same position count once.
        policy = (_congress(a.bill_id), a.stance_target_id or a.target_id, a.mechanism, a.compared_direction)
        current = latest.get(policy)
        if current is None or (a.vote_date or date.min, a.roll_call_id) > (
            current.vote_date or date.min, current.roll_call_id
        ):
            latest[policy] = a
    keep = {id(a) for a in latest.values()}
    return [
        a if not a.counted or id(a) in keep else replace(a, counted=False, reason=REASON_LATER_VOTE)
        for a in out
    ]


def vote_results(alignments: list[Alignment]) -> list[tuple[list[Alignment], int]]:
    """Counted matches grouped by vote, each with its net result (+1, -1, 0)."""
    votes: dict[tuple, list[Alignment]] = defaultdict(list)
    for a in alignments:
        if a.counted:
            votes[(a.bill_id, a.roll_call_id)].append(a)
    out = []
    for rows in votes.values():
        net = sum(a.points for a in rows)
        out.append((rows, (net > 0) - (net < 0)))
    return out


def summarize(alignments: list[Alignment]) -> dict:
    """Totals for official_scores. aligned / conflicting count votes, not
    matches: a vote whose counted matches cancel out is neither."""
    results = vote_results(alignments)
    aligned = sum(1 for _rows, result in results if result > 0)
    conflicting = sum(1 for _rows, result in results if result < 0)
    areas: dict[str, dict[str, int]] = defaultdict(lambda: {"points": 0, "aligned": 0, "conflicting": 0})
    for rows, result in results:
        if not result:
            continue
        # The area of the matches that decided the vote.
        deciding = [a.policy_area or "Other" for a in rows if a.points == result]
        area = areas[max(sorted(set(deciding)), key=deciding.count)]
        area["points"] += result
        area["aligned" if result > 0 else "conflicting"] += 1
    matches = aligned + conflicting
    return {
        "points": aligned - conflicting,
        "aligned": aligned,
        "conflicting": conflicting,
        "bills_scored": len({rows[0].bill_id for rows, result in results if result}),
        "stances_matched": len({
            (a.stance_target_id or a.target_id, a.mechanism) for rows, _r in results for a in rows
        }),
        "alignment_pct": round(100.0 * aligned / matches, 1) if matches else None,
        "by_policy_area": dict(sorted(areas.items())),
    }


# -- queries -----------------------------------------------------------------


def passage_roll_call_ids(session: Session) -> list[int]:
    rows = session.query(RollCall.id, RollCall.question).all()
    return [rc_id for rc_id, question in rows if is_passage_question(question)]


_ALIGNMENTS_SQL = """
WITH bill_sizes AS (
    SELECT bill_id, count(*) AS effects FROM bill_effects GROUP BY bill_id
),
latest_votes AS (
    SELECT DISTINCT ON (v.official_id, rc.bill_id, rc.chamber)
        v.official_id, v.position, rc.id AS roll_call_id, rc.bill_id,
        rc.chamber, rc.date
    FROM votes v
    JOIN roll_calls rc ON rc.id = v.roll_call_id
    WHERE rc.id = ANY(:roll_call_ids)
      AND v.position = ANY(:positions)
      {official_filter}
    ORDER BY v.official_id, rc.bill_id, rc.chamber,
             rc.date DESC NULLS LAST, rc.id DESC
),
stances AS (
    -- One stance per target + mechanism (several source types may repeat it).
    SELECT DISTINCT ON (s.official_id, s.target_id, s.mechanism)
        s.official_id, s.target_id, s.mechanism, s.direction, s.emphasis,
        s.summary, s.evidence_quote, s.source_url, s.policy_area, s.scope,
        CASE s.emphasis WHEN 'high' THEN 0 WHEN 'medium' THEN 1
                        WHEN 'low' THEN 2 ELSE 3 END AS emphasis_rank
    FROM official_stances s
    WHERE TRUE {stance_filter}
    ORDER BY s.official_id, s.target_id, s.mechanism, emphasis_rank, s.id
),
-- Each target, and each near match in both directions: a reviewed pair by
-- its verdict, an unreviewed one by the threshold.
near AS (
    SELECT target_a, target_b, similarity, verdict = 'inverse' AS inverse
    FROM target_matches
    WHERE verdict IN ('same', 'inverse') OR (verdict IS NULL AND similarity >= :threshold)
),
links AS (
    SELECT id AS effect_target, id AS stance_target, NULL::float AS similarity, false AS inverse
    FROM policy_targets
    UNION ALL
    SELECT target_a, target_b, similarity, inverse FROM near
    UNION ALL
    SELECT target_b, target_a, similarity, inverse FROM near
),
pairs AS (
    -- One stance per vote and bill intent: the exact target first, then
    -- the most similar name, then the most explicit position.
    SELECT DISTINCT ON (lv.official_id, lv.roll_call_id, e.id)
        lv.official_id, lv.bill_id, lv.roll_call_id, lv.chamber, lv.date,
        lv.position, e.target_id, e.mechanism, e.direction AS effect_direction,
        e.magnitude, e.rationale, e.relation, s.direction, s.emphasis, s.summary,
        s.evidence_quote, s.source_url, COALESCE(s.policy_area, b.policy_area) AS policy_area,
        s.scope, s.target_id AS stance_target_id, l.similarity, l.inverse
    FROM latest_votes lv
    JOIN bills b ON b.id = lv.bill_id AND b.classification_status = 'ok'
    JOIN bill_effects e ON e.bill_id = lv.bill_id
    JOIN links l ON l.effect_target = e.target_id
    JOIN stances s ON s.official_id = lv.official_id
                  AND s.target_id = l.stance_target
                  AND s.mechanism = e.mechanism
    ORDER BY lv.official_id, lv.roll_call_id, e.id,
             l.similarity DESC NULLS FIRST, s.emphasis_rank
)
SELECT p.official_id, p.bill_id, p.roll_call_id, p.chamber, p.date,
       p.position, p.target_id, t.name, p.mechanism, p.effect_direction,
       p.magnitude, p.rationale, p.direction, p.emphasis, p.summary,
       p.evidence_quote, p.source_url, p.policy_area,
       p.relation, p.scope, bs.effects, p.stance_target_id, st.name, p.similarity,
       p.inverse
FROM pairs p
JOIN bill_sizes bs ON bs.bill_id = p.bill_id
JOIN policy_targets t ON t.id = p.target_id
JOIN policy_targets st ON st.id = p.stance_target_id
"""


def compute_alignments(
    session: Session, official_ids: list[str] | None = None, *, threshold: float | None = None
) -> dict[str, list[Alignment]]:
    """Matches per official with rules applied (only officials with at
    least one match appear). official_ids=None computes everyone in one
    query. threshold overrides TARGET_MATCH_THRESHOLD."""
    roll_call_ids = passage_roll_call_ids(session)
    if not roll_call_ids:
        return {}
    params: dict = {
        "roll_call_ids": roll_call_ids,
        "positions": list(SCORED_POSITIONS),
        "threshold": TARGET_MATCH_THRESHOLD if threshold is None else threshold,
    }
    official_filter = stance_filter = ""
    if official_ids is not None:
        if not official_ids:
            return {}
        params["official_ids"] = list(official_ids)
        official_filter = "AND v.official_id = ANY(:official_ids)"
        stance_filter = "AND s.official_id = ANY(:official_ids)"
    sql = _ALIGNMENTS_SQL.format(official_filter=official_filter, stance_filter=stance_filter)

    out: dict[str, list[Alignment]] = defaultdict(list)
    for row in session.execute(text(sql), params):
        alignment = Alignment(
            official_id=row[0], bill_id=row[1], roll_call_id=row[2], chamber=row[3],
            vote_date=row[4], vote_position=row[5], target_id=row[6], target_name=row[7],
            mechanism=row[8], effect_direction=row[9], effect_magnitude=row[10],
            effect_rationale=row[11], stance_direction=row[12], stance_emphasis=row[13],
            stance_summary=row[14], stance_evidence_quote=row[15], stance_source_url=row[16],
            policy_area=row[17], effect_relation=row[18],
            stance_scope=row[19], bill_effect_count=row[20], stance_target_id=row[21],
            stance_target_name=row[22], match_similarity=row[23], match_inverse=bool(row[24]),
            points=0,
        )
        points = alignment_points(alignment.stance_direction, alignment.compared_direction, alignment.vote_position)
        if points == 0:
            continue
        out[row[0]].append(replace(alignment, points=points))
    return {
        official_id: sorted(apply_rules(rows), key=Alignment.key)
        for official_id, rows in out.items()
    }


def officials_with_stances(session: Session, official_ids: list[str] | None = None) -> set[str]:
    query = session.query(OfficialStance.official_id).distinct()
    if official_ids is not None:
        query = query.filter(OfficialStance.official_id.in_(official_ids))
    return {row[0] for row in query}


def voters_on_bills(session: Session, bill_ids: list[str]) -> list[str]:
    rows = (
        session.query(Vote.official_id)
        .join(RollCall, RollCall.id == Vote.roll_call_id)
        .filter(RollCall.bill_id.in_(bill_ids))
        .distinct()
        .all()
    )
    return [row[0] for row in rows]


# -- persistence -------------------------------------------------------------


def _write(session: Session, official_id: str, alignments: list[Alignment], digest: str, now: datetime) -> None:
    session.query(VoteAlignment).filter(VoteAlignment.official_id == official_id).delete(
        synchronize_session=False
    )
    for a in alignments:
        session.add(VoteAlignment(
            official_id=a.official_id, bill_id=a.bill_id, roll_call_id=a.roll_call_id,
            chamber=a.chamber, vote_date=a.vote_date, vote_position=a.vote_position,
            target_id=a.target_id, target_name=a.target_name, mechanism=a.mechanism,
            effect_direction=a.effect_direction, effect_magnitude=a.effect_magnitude,
            effect_rationale=a.effect_rationale, stance_direction=a.stance_direction,
            stance_emphasis=a.stance_emphasis, stance_summary=a.stance_summary,
            stance_evidence_quote=a.stance_evidence_quote,
            stance_source_url=a.stance_source_url, policy_area=a.policy_area,
            effect_relation=a.effect_relation, stance_scope=a.stance_scope,
            bill_effect_count=a.bill_effect_count, stance_target_id=a.stance_target_id,
            stance_target_name=a.stance_target_name, match_similarity=a.match_similarity,
            match_inverse=a.match_inverse, points=a.points,
            counted=a.counted, reason=a.reason, computed_at=now,
        ))
    totals = summarize(alignments)
    score = session.get(OfficialScore, official_id)
    if score is None:
        score = OfficialScore(official_id=official_id)
        session.add(score)
    for field, value in totals.items():
        setattr(score, field, value)
    score.engine_version = ENGINE_VERSION
    score.inputs_hash = digest
    score.computed_at = now


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def rescore(
    session: Session,
    official_ids: list[str] | None = None,
    *,
    force: bool = False,
    dry_run: bool = False,
    now_fn: Callable[[], datetime] = _utcnow,
) -> dict:
    """Recompute scores for official_ids (None = everyone) and commit.

    Officials with stated positions get a score row (zero matches included,
    so the UI can say "no matching votes yet"); officials who no longer have
    any stances lose theirs. Rows are only rewritten when the inputs hash
    changed, unless force.
    """
    now = now_fn()
    computed = compute_alignments(session, official_ids)
    eligible = officials_with_stances(session, official_ids) | set(computed)

    existing_query = session.query(OfficialScore.official_id, OfficialScore.inputs_hash)
    if official_ids is not None:
        existing_query = existing_query.filter(OfficialScore.official_id.in_(official_ids))
    existing = dict(existing_query.all())

    stats = {"officials": len(eligible), "updated": 0, "unchanged": 0, "removed": 0,
             "matches": sum(a.counted for rows in computed.values() for a in rows),
             "not_counted": sum(not a.counted for rows in computed.values() for a in rows)}
    for official_id in sorted(eligible):
        alignments = computed.get(official_id, [])
        digest = inputs_hash(alignments)
        if not force and existing.get(official_id) == digest:
            stats["unchanged"] += 1
            continue
        stats["updated"] += 1
        if not dry_run:
            _write(session, official_id, alignments, digest, now)

    stale = [official_id for official_id in existing if official_id not in eligible]
    stats["removed"] = len(stale)
    if stale and not dry_run:
        session.query(VoteAlignment).filter(VoteAlignment.official_id.in_(stale)).delete(
            synchronize_session=False
        )
        session.query(OfficialScore).filter(OfficialScore.official_id.in_(stale)).delete(
            synchronize_session=False
        )

    if dry_run:
        session.rollback()
    else:
        session.commit()
    return stats


def rescore_bill_voters(session: Session, bill_ids: list[str], **kwargs) -> dict:
    """Rescore everyone who voted on these bills (after a classification)."""
    return rescore(session, voters_on_bills(session, bill_ids), **kwargs)


def try_rescore(
    session: Session,
    *,
    official_ids: list[str] | None = None,
    bill_ids: list[str] | None = None,
    log: Callable[[str], None] = print,
) -> dict | None:
    """rescore() for workers, scoped to official_ids or to the voters on
    bill_ids. A scoring error is logged, never raised, so it can't fail the
    ingest or LLM run that triggered it."""
    try:
        if bill_ids is not None:
            official_ids = voters_on_bills(session, bill_ids)
        if official_ids is None:
            raise ValueError("try_rescore needs official_ids or bill_ids")
        return rescore(session, official_ids)
    except Exception as exc:
        session.rollback()
        log(f"  accountability rescore failed: {type(exc).__name__}: {exc}")
        return None
