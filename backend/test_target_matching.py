import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from test_accountability import _test_database_available

DIMS = 256
# The two voter targets are close, the tax credit is not.
VECTORS = {
    "Zztm Voter Registration": [1.0, 0.0, 0.0],
    "Zztm Automatic Voter Registration": [0.95, 0.31, 0.0],
    "Zztm Child Tax Credit": [0.0, 0.0, 1.0],
}


def fake_embed(calls):
    """Known names get VECTORS; any other target in the test database gets
    its own axis, so it matches nothing."""
    axes = {}

    def vector(name):
        if name in VECTORS:
            values = VECTORS[name]
        else:
            values = [0.0] * (3 + axes.setdefault(name, len(axes))) + [1.0]
        return values + [0.0] * (DIMS - len(values))

    def embed(names):
        calls.append(list(names))
        return [vector(name) for name in names]

    return embed


@unittest.skipUnless(_test_database_available(), "needs a reachable *_test Postgres database")
class TargetMatcherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()

    def setUp(self):
        from database import SessionLocal

        self.session = SessionLocal()
        self._cleanup()

    def tearDown(self):
        self._cleanup()
        self.session.close()

    def _cleanup(self):
        from sqlalchemy import text

        from models import PolicyTarget

        self.session.query(PolicyTarget).filter(PolicyTarget.slug.like("zztm-%")).delete(synchronize_session=False)
        self.session.execute(text("DELETE FROM target_matches"))
        self.session.execute(text("DELETE FROM target_embeddings"))
        self.session.commit()

    def _add(self, *names):
        from models import PolicyTarget

        targets = [PolicyTarget(name=name, slug=name.lower().replace(" ", "-")) for name in names]
        self.session.add_all(targets)
        self.session.commit()
        return {t.name: t.id for t in targets}

    def _matches(self):
        from services.target_matching import neighbors

        return neighbors(self.session, "Zztm Voter Registration")

    def test_stores_near_pairs_once_and_only_embeds_new_targets(self):
        from services.target_matching import TargetMatcher

        calls = []
        matcher = TargetMatcher(fake_embed(calls), "fake", floor=0.9)
        self._add("Zztm Voter Registration", "Zztm Child Tax Credit")
        first = matcher.refresh(self.session)
        self.assertGreaterEqual(first["embedded"], 2)
        self.assertEqual(first["pairs"], 0)

        self._add("Zztm Automatic Voter Registration")
        self.assertEqual(matcher.refresh(self.session), {"embedded": 1, "pairs": 1})
        self.assertEqual(calls[-1], ["Zztm Automatic Voter Registration"])
        [(name, similarity)] = self._matches()
        self.assertEqual(name, "Zztm Automatic Voter Registration")
        self.assertAlmostEqual(similarity, 0.95, places=2)

        self.assertEqual(matcher.refresh(self.session), {"embedded": 0, "pairs": 0})

    def test_try_refresh_logs_instead_of_raising(self):
        from services.target_matching import TargetMatcher, try_refresh

        def broken(_names):
            raise ConnectionError("ollama is down")

        self._add("Zztm Voter Registration")
        messages = []
        self.assertIsNone(try_refresh(TargetMatcher(broken, "fake"), self.session, log=messages.append))
        self.assertIn("ollama is down", messages[0])


if __name__ == "__main__":
    unittest.main()
