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

Embeddings are only comparable within one model: switching
TARGET_EMBED_MODEL drops the stored embeddings and matches and rebuilds them.
"""

from __future__ import annotations

import os
from typing import Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

DEFAULT_EMBED_MODEL = os.getenv("TARGET_EMBED_MODEL", "nomic-embed-text")
MATCH_FLOOR = 0.75
EMBED_BATCH = 128
# Rows of new targets compared against everything at once (memory bound).
COMPARE_BATCH = 512

EmbedFn = Callable[[list[str]], list[list[float]]]


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


class TargetMatcher:
    """Keeps target_embeddings and target_matches current for one model.

    Embeddings are loaded once per process; refresh() then only embeds
    targets added since and compares them against everything.
    """

    def __init__(self, embed_fn: EmbedFn, model: str = DEFAULT_EMBED_MODEL, *, floor: float = MATCH_FLOOR):
        self.embed_fn = embed_fn
        self.model = model
        self.floor = floor
        self._ids: list[int] = []
        self._matrix = None  # numpy (n, dims), rows L2-normalized
        self._loaded = False

    def rebuild(self, session: Session) -> dict:
        session.execute(text("DELETE FROM target_matches"))
        session.execute(text("DELETE FROM target_embeddings"))
        session.commit()
        self._ids, self._matrix, self._loaded = [], None, False
        return self.refresh(session)

    def refresh(self, session: Session) -> dict:
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
        new_ids = [target_id for target_id, _name in new]
        new_matrix = _normalize(np.asarray(vectors, dtype=np.float32))

        all_ids = self._ids + new_ids
        all_matrix = new_matrix if self._matrix is None else np.vstack([self._matrix, new_matrix])
        offset = len(self._ids)
        pairs: dict[tuple[int, int], float] = {}
        for start in range(0, len(new_ids), COMPARE_BATCH):
            sims = new_matrix[start:start + COMPARE_BATCH] @ all_matrix.T
            for row, col in zip(*np.nonzero(sims >= self.floor)):
                i, j = offset + start + int(row), int(col)
                # New-vs-new pairs show up twice; keep one, and skip self.
                if i == j or (j >= offset and j < i):
                    continue
                a, b = sorted((all_ids[i], all_ids[j]))
                pairs[(a, b)] = round(float(sims[row, col]), 4)

        for target_id, vector in zip(new_ids, new_matrix):
            session.execute(text(
                "INSERT INTO target_embeddings (target_id, model, vector) VALUES (:id, :model, :vector) "
                "ON CONFLICT (target_id) DO UPDATE SET model = EXCLUDED.model, vector = EXCLUDED.vector"
            ), {"id": target_id, "model": self.model, "vector": vector.tobytes()})
        if pairs:
            session.execute(text(
                "INSERT INTO target_matches (target_a, target_b, similarity) VALUES (:a, :b, :s) "
                "ON CONFLICT (target_a, target_b) DO UPDATE SET similarity = EXCLUDED.similarity"
            ), [{"a": a, "b": b, "s": s} for (a, b), s in pairs.items()])
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


def make_matcher(host: str, model: str | None = None) -> TargetMatcher:
    model = model or DEFAULT_EMBED_MODEL
    return TargetMatcher(make_embed_fn(model, host), model)


def try_refresh(matcher: TargetMatcher | None, session: Session, log: Callable[[str], None] = print) -> dict | None:
    """refresh() for workers: an embedding error is logged, never raised.
    Scoring then falls back to exact target matches for the new targets."""
    if matcher is None:
        return None
    try:
        return matcher.refresh(session)
    except Exception as exc:
        session.rollback()
        log(f"  target matching failed: {type(exc).__name__}: {exc}")
        return None


def neighbors(session: Session, name: str, limit: int = 20) -> list[tuple[str, float]]:
    """Stored matches for one target name, most similar first."""
    rows = session.execute(text(
        "SELECT o.name, m.similarity FROM policy_targets t "
        "JOIN target_matches m ON t.id IN (m.target_a, m.target_b) "
        "JOIN policy_targets o ON o.id = CASE WHEN m.target_a = t.id THEN m.target_b ELSE m.target_a END "
        "WHERE lower(t.name) = lower(:name) ORDER BY m.similarity DESC LIMIT :limit"
    ), {"name": name, "limit": limit}).all()
    return [(other, similarity) for other, similarity in rows]
