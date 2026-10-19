"""Match policy targets by meaning, not exact name.

Bills and officials are extracted separately, and the model names the same
thing differently from run to run ("Voter Registration" on a bill,
"Automatic Voter Registration" in a position). The accountability engine
only scores a vote when the bill effect and the stated position share a
target, so name drift alone would add and drop matches.

Workers (Mac Mini, with Ollama) embed every target name with a small local
embedding model and store each pair of targets at or above MATCH_FLOOR in
target_matches. Scoring (no LLM, runs anywhere) treats pairs at or above
TARGET_MATCH_THRESHOLD as the same target. The floor is lower than the
threshold so the threshold can be tuned without re-embedding.

Similar names are not always the same policy: "Naval Petroleum Reserves"
is not the "Strategic Petroleum Reserve", and more "Voter Registration
Requirements" means less "Automatic Voter Registration". So the workers'
chat model reviews each pair that could score (a bill intent's target and a
position target of an official who voted on that bill, same mechanism, at or
above REVIEW_FLOOR) once, and stores a verdict: same, inverse (one goes up
when the other goes down, so scoring flips the bill's direction), or
unrelated. A verdict overrides the threshold; unreviewed pairs fall back to
it.

Embeddings are only comparable within one model: switching
TARGET_EMBED_MODEL drops the stored embeddings and matches and rebuilds them.
"""

from __future__ import annotations

import json
import os
from typing import Callable, Literal

from pydantic import BaseModel

from sqlalchemy import text
from sqlalchemy.orm import Session

DEFAULT_EMBED_MODEL = os.getenv("TARGET_EMBED_MODEL", "nomic-embed-text")
MATCH_FLOOR = 0.75
# Closest names kept per target, so a generic name can't flood the table.
MAX_NEIGHBORS = 20
EMBED_BATCH = 128
# Rows of new targets compared against everything at once (memory bound).
COMPARE_BATCH = 512
# Rows per INSERT: one round trip each, since the database may be remote.
WRITE_BATCH = 2000
# Pairs at or above this get a model review when they could score.
REVIEW_FLOOR = float(os.getenv("TARGET_REVIEW_FLOOR", "0.8"))
REVIEW_BATCH = 25

VERDICTS = ("same", "inverse", "unrelated")

EmbedFn = Callable[[list[str]], list[list[float]]]
# [(bill target name, position target name)] -> a verdict per pair (None if unanswered).
ReviewFn = Callable[[list[tuple[str, str]]], list[str | None]]

REVIEW_PROMPT = """You compare short names of policy targets. One name comes from a \
U.S. bill's effects, the other from a politician's stated position. Both use \
"increase" and "decrease" for more or less of the named thing. For each \
numbered pair, decide:

- same: the same program, agency, policy, right, or tax, or one is a part or \
form of the other, and more of one means more of the other ("Voter \
Registration" and "Online Voter Registration"; "Debt Limit" and "Statutory \
Debt Limit"; "ICE" and "Immigration and Customs Enforcement").
- inverse: the same subject, but more of one means less of the other \
("Voter Registration Documentation Requirements" and "Automatic Voter \
Registration": more paperwork makes registering harder; "Gun Restrictions" \
and "Gun Rights").
- unrelated: different things, even if the names look alike ("Strategic \
Petroleum Reserve" and "Naval Petroleum Reserves"; "Department of Defense" \
and "Department of Energy"; "Child Tax Credit" and "Earned Income Tax \
Credit").

Answer with one verdict for every pair number."""


class PairVerdict(BaseModel):
    pair: int
    verdict: Literal["same", "inverse", "unrelated"]


class ReviewOutput(BaseModel):
    verdicts: list[PairVerdict]


def make_embed_fn(model: str, host: str, timeout_seconds: float = 120.0) -> EmbedFn:
    from services.llm_runtime import make_ollama_client

    client = make_ollama_client(host, timeout_seconds)

    def embed(names: list[str]) -> list[list[float]]:
        response = client.embed(model=model, input=names)
        embeddings = getattr(response, "embeddings", None)
        if embeddings is None:
            embeddings = response["embeddings"]
        return [list(vector) for vector in embeddings]

    return embed


def make_review_fn(model: str, host: str, *, timeout: float = 900.0, num_ctx: int = 16384) -> ReviewFn:
    """Review pairs with the workers' chat model. num_ctx matches the
    workers' so Ollama does not reload the model between them."""
    from services.llm_runtime import make_chat_fn

    chat_fn = make_chat_fn(model, host, timeout, num_ctx, 2048)
    schema = ReviewOutput.model_json_schema()

    def review(pairs: list[tuple[str, str]]) -> list[str | None]:
        lines = "\n".join(
            f"{number}. bill: {bill} | position: {position}"
            for number, (bill, position) in enumerate(pairs, start=1)
        )
        content = chat_fn(
            [{"role": "system", "content": REVIEW_PROMPT}, {"role": "user", "content": lines}],
            schema,
        )
        answers = {v.pair: v.verdict for v in ReviewOutput.model_validate(json.loads(content)).verdicts}
        return [answers.get(number) for number in range(1, len(pairs) + 1)]

    return review


class TargetMatcher:
    """Keeps target_embeddings and target_matches current for one model.

    Embeddings are loaded once per process; refresh() then only embeds
    targets added since and compares them against everything, and reviews
    the new pairs that could score for the officials or bills it was given.
    """

    def __init__(
        self,
        embed_fn: EmbedFn,
        model: str = DEFAULT_EMBED_MODEL,
        *,
        floor: float = MATCH_FLOOR,
        max_neighbors: int = MAX_NEIGHBORS,
        review_fn: ReviewFn | None = None,
        review_floor: float = REVIEW_FLOOR,
    ):
        self.embed_fn = embed_fn
        self.review_fn = review_fn
        self.review_floor = review_floor
        self.model = model
        self.floor = floor
        self.max_neighbors = max_neighbors
        self._ids: list[int] = []
        self._matrix = None  # numpy (n, dims), rows L2-normalized
        self._loaded = False

    def rebuild(self, session: Session, log: Callable[[str], None] | None = None) -> dict:
        session.execute(text("DELETE FROM target_matches"))
        session.execute(text("DELETE FROM target_embeddings"))
        session.commit()
        self._ids, self._matrix, self._loaded = [], None, False
        return self.refresh(session, log)

    def refresh(
        self,
        session: Session,
        log: Callable[[str], None] | None = None,
        *,
        official_ids: list[str] | None = None,
        bill_ids: list[str] | None = None,
        review_all: bool = False,
    ) -> dict:
        """Embed new targets, then review unreviewed pairs that could score
        for official_ids or bill_ids (everyone with review_all). log gets
        progress lines (by-hand runs embed thousands)."""
        stats = self.embed_new(session, log)
        stats["reviewed"] = 0
        if self.review_fn is not None and (official_ids or bill_ids or review_all):
            stats["reviewed"] = self.review(session, log, official_ids=official_ids, bill_ids=bill_ids)
        return stats

    def review(
        self,
        session: Session,
        log: Callable[[str], None] | None = None,
        *,
        official_ids: list[str] | None = None,
        bill_ids: list[str] | None = None,
    ) -> int:
        scope, params = "", {"floor": self.review_floor}
        if official_ids:
            scope += " AND v.official_id = ANY(:officials)"
            params["officials"] = list(official_ids)
        if bill_ids:
            scope += " AND e.bill_id = ANY(:bills)"
            params["bills"] = list(bill_ids)
        rows = session.execute(text(f"""
            SELECT DISTINCT ON (m.target_a, m.target_b)
                m.target_a, m.target_b, te.name AS bill_name, ts.name AS position_name
            FROM bill_effects e
            JOIN roll_calls rc ON rc.bill_id = e.bill_id
            JOIN votes v ON v.roll_call_id = rc.id
            JOIN official_stances s ON s.official_id = v.official_id AND s.mechanism = e.mechanism
            JOIN target_matches m ON m.target_a = LEAST(e.target_id, s.target_id)
                                 AND m.target_b = GREATEST(e.target_id, s.target_id)
            JOIN policy_targets te ON te.id = e.target_id
            JOIN policy_targets ts ON ts.id = s.target_id
            WHERE m.verdict IS NULL AND m.similarity >= :floor {scope}
            ORDER BY m.target_a, m.target_b
        """), params).all()
        session.rollback()  # model calls take a while; hold no transaction
        reviewed = 0
        for start in range(0, len(rows), REVIEW_BATCH):
            batch = rows[start:start + REVIEW_BATCH]
            verdicts = self.review_fn([(r.bill_name, r.position_name) for r in batch])
            answered = [
                {"a": r.target_a, "b": r.target_b, "v": verdict}
                for r, verdict in zip(batch, verdicts)
                if verdict in VERDICTS
            ]
            if answered:
                session.execute(text(
                    "UPDATE target_matches SET verdict = :v WHERE target_a = :a AND target_b = :b"
                ), answered)
                session.commit()
            reviewed += len(answered)
            if log:
                log(f"  reviewed {min(start + REVIEW_BATCH, len(rows))}/{len(rows)} name pairs")
        return reviewed

    def embed_new(self, session: Session, log: Callable[[str], None] | None = None) -> dict:
        """Embed targets added since the last call and store their near matches."""
        import numpy as np

        if not self._loaded:
            self._load(session)
        new = session.execute(text(
            "SELECT t.id, t.name FROM policy_targets t "
            "WHERE NOT EXISTS (SELECT 1 FROM target_embeddings x WHERE x.target_id = t.id) "
            "ORDER BY t.id"
        )).all()
        stats = {"embedded": 0, "pairs": 0}
        if not new:
            session.rollback()
            return stats

        vectors = []
        for start in range(0, len(new), EMBED_BATCH):
            batch = new[start:start + EMBED_BATCH]
            vectors.extend(self.embed_fn([name for _id, name in batch]))
            if log:
                log(f"  embedded {min(start + EMBED_BATCH, len(new))}/{len(new)}")
        new_ids = [target_id for target_id, _name in new]
        new_matrix = _normalize(np.asarray(vectors, dtype=np.float32))

        all_ids = self._ids + new_ids
        all_matrix = new_matrix if self._matrix is None else np.vstack([self._matrix, new_matrix])
        offset = len(self._ids)
        pairs: dict[tuple[int, int], float] = {}
        keep = min(self.max_neighbors + 1, len(all_ids))  # +1: a target is its own closest
        for start in range(0, len(new_ids), COMPARE_BATCH):
            sims = new_matrix[start:start + COMPARE_BATCH] @ all_matrix.T
            closest = np.argpartition(-sims, keep - 1, axis=1)[:, :keep]
            for row, cols in enumerate(closest):
                i = offset + start + row
                for col in cols:
                    j = int(col)
                    similarity = float(sims[row, j])
                    if i == j or similarity < self.floor:
                        continue
                    # Sorted, so a new-vs-new pair found from both ends is stored once.
                    a, b = sorted((all_ids[i], all_ids[j]))
                    pairs[(a, b)] = round(similarity, 4)
        if log:
            log(f"  saving {len(new_ids)} embeddings and {len(pairs)} near pairs")

        for start in range(0, len(new_ids), WRITE_BATCH):
            ids = new_ids[start:start + WRITE_BATCH]
            session.execute(text(
                "INSERT INTO target_embeddings (target_id, model, vector) "
                "SELECT id, :model, vector FROM unnest(CAST(:ids AS integer[]), CAST(:vectors AS bytea[])) AS u(id, vector) "
                "ON CONFLICT (target_id) DO UPDATE SET model = EXCLUDED.model, vector = EXCLUDED.vector"
            ), {
                "model": self.model,
                "ids": ids,
                "vectors": [new_matrix[k].tobytes() for k in range(start, start + len(ids))],
            })
        items = sorted(pairs.items())
        for start in range(0, len(items), WRITE_BATCH):
            batch = items[start:start + WRITE_BATCH]
            session.execute(text(
                "INSERT INTO target_matches (target_a, target_b, similarity) "
                "SELECT * FROM unnest(CAST(:a AS integer[]), CAST(:b AS integer[]), CAST(:s AS double precision[])) "
                "ON CONFLICT (target_a, target_b) DO UPDATE SET similarity = EXCLUDED.similarity"
            ), {"a": [a for (a, _b), _s in batch], "b": [b for (_a, b), _s in batch], "s": [s for _p, s in batch]})
        session.commit()

        self._ids, self._matrix = all_ids, all_matrix
        stats["embedded"], stats["pairs"] = len(new_ids), len(pairs)
        return stats

    def _load(self, session: Session) -> None:
        import numpy as np

        stale = session.execute(
            text("SELECT count(*) FROM target_embeddings WHERE model <> :model"), {"model": self.model}
        ).scalar()
        if stale:
            # Another model's vectors can't be compared with this one's.
            session.execute(text("DELETE FROM target_matches"))
            session.execute(text("DELETE FROM target_embeddings"))
            session.commit()
        rows = session.execute(text("SELECT target_id, vector FROM target_embeddings ORDER BY target_id")).all()
        self._ids = [target_id for target_id, _vector in rows]
        self._matrix = (
            np.vstack([np.frombuffer(bytes(vector), dtype=np.float32) for _id, vector in rows])
            if rows else None
        )
        self._loaded = True


def _normalize(matrix):
    import numpy as np

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def make_matcher(host: str, model: str | None = None, *, review_model: str | None = None) -> TargetMatcher:
    """review_model is the chat model that reviews pairs (the worker's own
    model, already loaded); None skips reviews."""
    model = model or DEFAULT_EMBED_MODEL
    review_fn = make_review_fn(review_model, host) if review_model else None
    return TargetMatcher(make_embed_fn(model, host), model, review_fn=review_fn)


def try_refresh(
    matcher: TargetMatcher | None,
    session: Session,
    log: Callable[[str], None] = print,
    **scope,
) -> dict | None:
    """refresh() for workers: an embedding or review error is logged, never
    raised. Scoring then falls back to exact matches for unembedded targets
    and to the threshold for unreviewed pairs."""
    if matcher is None:
        return None
    try:
        return matcher.refresh(session, **scope)
    except Exception as exc:
        session.rollback()
        log(f"  target matching failed: {type(exc).__name__}: {exc}")
        return None


def neighbors(session: Session, name: str, limit: int = 20) -> list[tuple[str, float, str | None]]:
    """Stored matches for one target name, most similar first, with the
    review verdict (None if unreviewed)."""
    rows = session.execute(text(
        "SELECT o.name, m.similarity, m.verdict FROM policy_targets t "
        "JOIN target_matches m ON t.id IN (m.target_a, m.target_b) "
        "JOIN policy_targets o ON o.id = CASE WHEN m.target_a = t.id THEN m.target_b ELSE m.target_a END "
        "WHERE lower(t.name) = lower(:name) ORDER BY m.similarity DESC LIMIT :limit"
    ), {"name": name, "limit": limit}).all()
    return [(other, similarity, verdict) for other, similarity, verdict in rows]
