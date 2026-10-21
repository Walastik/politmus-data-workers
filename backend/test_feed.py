import os
import unittest
from datetime import date

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from fastapi.testclient import TestClient

from api.main import app


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


class FeedKindValidationTests(unittest.TestCase):
    def test_unknown_kind_is_rejected(self):
        from api.routes.feed import _parse_kinds
        from fastapi import HTTPException

        self.assertEqual(_parse_kinds("vote_held, bill_introduced"), ["vote_held", "bill_introduced"])
        with self.assertRaises(HTTPException):
            _parse_kinds("vote_held,gossip")


@unittest.skipUnless(_test_database_available(), "needs a reachable *_test Postgres database")
class FeedEventsTests(unittest.TestCase):
    PREFIX = "ZZFEED"
    STATE = "Zzland"
    BILL = "ZZFEED-hr-1"
    SENATOR_R = "ZZFEED001"
    SENATOR_D = "ZZFEED002"
    NEWCOMER = "ZZFEED003"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal

        self.SessionLocal = SessionLocal
        self._cleanup()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Bill, FeedEvent, Official, RollCall, Vote

        session = self.SessionLocal()
        pattern = f"{self.PREFIX}%"
        session.query(FeedEvent).filter(
            FeedEvent.dedupe_key.like(f"%{self.PREFIX}%")
        ).delete(synchronize_session=False)
        roll_call_ids = [
            row.id
            for row in session.query(RollCall).filter(RollCall.bill_id.like(pattern))
        ]
        if roll_call_ids:
            session.query(Vote).filter(Vote.roll_call_id.in_(roll_call_ids)).delete(
                synchronize_session=False
            )
        session.query(RollCall).filter(RollCall.bill_id.like(pattern)).delete(
            synchronize_session=False
        )
        session.query(Bill).filter(Bill.id.like(pattern)).delete(synchronize_session=False)
        session.query(Official).filter(Official.id.like(pattern)).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()

    def _events(self, session, kind=None):
        from models import FeedEvent

        query = session.query(FeedEvent).filter(
            FeedEvent.dedupe_key.like(f"%{self.PREFIX}%")
        )
        if kind:
            query = query.filter(FeedEvent.kind == kind)
        return query.all()

    def _official(self, session, official_id, party, current=True):
        from models import Official

        session.add(Official(
            id=official_id,
            name=f"Member, {official_id}",
            first_name="Test",
            last_name=official_id,
            state=self.STATE,
            party=party,
            office="Senator",
            current_member=current,
            level="federal",
        ))
        session.flush()

    def test_bill_upserts_record_introduction_and_each_status_once(self):
        from congress_client import upsert_bill

        session = self.SessionLocal()
        try:
            for _ in range(2):
                upsert_bill(
                    session, self.BILL, "Zz Act", None,
                    introduced_date=date(2026, 9, 1),
                    latest_action_text="Introduced in House",
                    latest_action_date=date(2026, 9, 1),
                )
            upsert_bill(
                session, self.BILL, "Zz Act", None,
                latest_action_text="Became Public Law No: 119-99.",
                latest_action_date=date(2026, 10, 1),
            )
            upsert_bill(
                session, self.BILL, "Zz Act", None,
                latest_action_text="Became Public Law No: 119-99.",
                latest_action_date=date(2026, 10, 1),
            )
            session.commit()

            introduced = self._events(session, "bill_introduced")
            status = self._events(session, "bill_status_changed")
            self.assertEqual(len(introduced), 1)
            self.assertEqual(introduced[0].occurred_at, date(2026, 9, 1))
            self.assertEqual([e.payload["status"] for e in status], ["Became Law"])
            self.assertEqual(status[0].occurred_at, date(2026, 10, 1))
        finally:
            session.close()

    def test_roll_call_upsert_records_one_vote_event(self):
        from congress_client import upsert_bill, upsert_roll_call

        session = self.SessionLocal()
        try:
            upsert_bill(session, self.BILL, "Zz Act", None)
            # No date yet: nothing to place on the timeline.
            upsert_roll_call(
                session, bill_id=self.BILL, chamber="Senate",
                source_roll_call_id=f"{self.PREFIX}-senate-1",
            )
            self.assertEqual(self._events(session, "vote_held"), [])
            for _ in range(2):
                upsert_roll_call(
                    session, bill_id=self.BILL, chamber="Senate",
                    source_roll_call_id=f"{self.PREFIX}-senate-1",
                    date=date(2026, 10, 2), result="Passed",
                )
            session.commit()
            self.assertEqual(len(self._events(session, "vote_held")), 1)
        finally:
            session.close()

    def test_feed_pages_newest_first_with_filters_and_tallies(self):
        from congress_client import upsert_bill, upsert_roll_call
        from models import Official, Vote
        from services.feed_events import record_official_seated

        session = self.SessionLocal()
        self._official(session, self.SENATOR_R, "Republican")
        self._official(session, self.SENATOR_D, "Democratic")
        self._official(session, self.NEWCOMER, "Independent")
        upsert_bill(session, self.BILL, "Zz Act", None)
        roll_call = upsert_roll_call(
            session, bill_id=self.BILL, chamber="Senate",
            source_roll_call_id=f"{self.PREFIX}-senate-2",
            date=date(2026, 10, 3), question="On Passage", result="Passed",
        )
        session.add_all([
            Vote(roll_call_id=roll_call.id, official_id=self.SENATOR_R, position="Yes"),
            Vote(roll_call_id=roll_call.id, official_id=self.SENATOR_D, position="No"),
        ])
        for day, official_id in (
            (date(2026, 10, 1), self.SENATOR_R),
            (date(2026, 10, 2), self.SENATOR_D),
            (date(2026, 10, 4), self.NEWCOMER),
        ):
            official = session.get(Official, official_id)
            record_official_seated(session, official, on=day)
        session.commit()
        session.close()

        first = self.client.get(f"/api/feed?state={self.STATE}&limit=2").json()
        self.assertEqual(
            [item["official"]["id"] for item in first["items"]],
            [self.NEWCOMER, self.SENATOR_D],
        )
        self.assertEqual(first["items"][0]["subline"], f"Took office · Senator, {self.STATE}")
        self.assertIsNotNone(first["next_cursor"])

        second = self.client.get(
            f"/api/feed?state={self.STATE}&limit=2&cursor={first['next_cursor']}"
        ).json()
        self.assertEqual([item["official"]["id"] for item in second["items"]], [self.SENATOR_R])
        self.assertIsNone(second["next_cursor"])

        departed = self.client.get(f"/api/feed?state={self.STATE}&kinds=official_departed")
        self.assertEqual(departed.json()["items"], [])

        votes = self.client.get("/api/feed?kinds=vote_held&limit=100").json()["items"]
        vote = next(item for item in votes if item["bill"] and item["bill"]["id"] == self.BILL)
        self.assertEqual(vote["headline"], "Zz Act")
        self.assertEqual(vote["subline"], "On Passage")
        self.assertEqual(
            vote["tally_by_party"],
            {"Republican": {"Yes": 1}, "Democratic": {"No": 1}},
        )

        self.assertEqual(self.client.get("/api/feed?kinds=gossip").status_code, 422)
        self.assertEqual(self.client.get("/api/feed?cursor=nope").status_code, 422)


if __name__ == "__main__":
    unittest.main()
