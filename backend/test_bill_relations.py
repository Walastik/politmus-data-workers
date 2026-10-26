import os
import unittest
from datetime import date
from unittest import mock

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from bill_relations import parse_relations

# Trimmed from api.congress.gov/v3/bill/119/hr/22/relatedbills.
RELATED = [
    {"congress": 119, "type": "HR", "number": 7296, "relationshipDetails": [
        {"type": "Related bill", "identifiedBy": "CRS"},
    ]},
    {"congress": 119, "type": "HRES", "number": 282, "relationshipDetails": [
        {"type": "Related bill", "identifiedBy": "House"},
        {"type": "Procedurally related", "identifiedBy": "House"},
        {"type": "Related bill", "identifiedBy": "CRS"},
    ]},
    {"congress": 118, "type": "HR", "number": 8281, "relationshipDetails": [
        {"type": "Cross-Congress related bill", "identifiedBy": "CRS"},
    ]},
    {"congress": 119, "type": "S", "number": 128, "relationshipDetails": []},
]


class ParseRelationsTests(unittest.TestCase):
    def test_keys_by_bill_id_with_unique_relationship_types(self):
        self.assertEqual(
            parse_relations(RELATED),
            {
                "119-hr-7296": ["Related bill"],
                "119-hres-282": ["Procedurally related", "Related bill"],
                "118-hr-8281": ["Cross-Congress related bill"],
            },
        )


def _test_database_available() -> bool:
    url = os.environ.get("DATABASE_URL", "")
    if not url.rstrip("/").endswith("_test"):
        return False
    try:
        from database import engine

        with engine.connect():
            return True
    except Exception:
        return False


@unittest.skipUnless(_test_database_available(), "needs a reachable *_test Postgres database")
class SyncRelationsTests(unittest.TestCase):
    VOTED = "ZZREL-hr1-119"
    UNVOTED = "ZZREL-hr2-119"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()

    def setUp(self):
        from database import SessionLocal
        from models import Bill, RollCall

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        for bill_id in (self.VOTED, self.UNVOTED):
            session.add(Bill(
                id=bill_id, title=bill_id, level="federal",
                latest_action_date=date(2026, 3, 1), latest_action_text="Passed House",
            ))
        session.flush()
        session.add(RollCall(
            bill_id=self.VOTED, chamber="House", date=date(2026, 3, 1), question="On Passage",
            result="Passed", source_roll_call_id="ZZREL-1",
        ))
        session.commit()
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Bill, BillRelation, RollCall

        session = self.SessionLocal()
        session.query(BillRelation).filter(BillRelation.bill_id.like("ZZREL%")).delete(synchronize_session=False)
        session.query(RollCall).filter(RollCall.bill_id.like("ZZREL%")).delete(synchronize_session=False)
        session.query(Bill).filter(Bill.id.like("ZZREL%")).delete(synchronize_session=False)
        session.commit()
        session.close()

    def _sync(self, related):
        from bill_relations import sync_relations

        with mock.patch("bill_relations.fetch_related_bills", return_value=related) as fetch, \
                mock.patch("bill_relations.try_rescore") as rescore:
            stats = sync_relations(limit=0, bill_ids=None, log=lambda _: None)
        return stats, fetch, rescore

    def _stored(self):
        from models import BillRelation

        session = self.SessionLocal()
        try:
            return {
                r.related_bill_id: r.relationships
                for r in session.query(BillRelation).filter(BillRelation.bill_id == self.VOTED)
            }
        finally:
            session.close()

    def test_stores_relations_for_voted_bills_and_rescores_their_voters(self):
        stats, fetch, rescore = self._sync(RELATED)

        fetched = [call.args for call in fetch.call_args_list]
        self.assertIn(("ZZREL", "hr1", "119"), fetched)
        self.assertNotIn(("ZZREL", "hr2", "119"), fetched)
        self.assertEqual(self._stored()["119-hr-7296"], ["Related bill"])
        self.assertIn(self.VOTED, rescore.call_args.kwargs["bill_ids"])
        self.assertGreaterEqual(stats["changed"], 1)

    def test_fetches_again_only_after_a_new_action(self):
        from models import Bill

        self._sync(RELATED)
        _, fetch, rescore = self._sync(RELATED)
        self.assertNotIn(("ZZREL", "hr1", "119"), [call.args for call in fetch.call_args_list])

        session = self.SessionLocal()
        session.get(Bill, self.VOTED).latest_action_text = "Passed Senate"
        session.commit()
        session.close()
        _, fetch, rescore = self._sync(RELATED[:1])
        self.assertIn(("ZZREL", "hr1", "119"), [call.args for call in fetch.call_args_list])
        self.assertEqual(self._stored(), {"119-hr-7296": ["Related bill"]})


if __name__ == "__main__":
    unittest.main()
