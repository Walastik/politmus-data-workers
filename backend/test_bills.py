from datetime import date
import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from api.filters import classify_bipartisan_type
from api.routes.bills import (
    _bill_detail,
    _chamber_for_office,
    _empty_chamber_summaries,
    _empty_party_summaries,
    _tally_roll_call_ids,
    _record_vote_count,
    bill_feed_sort_key,
    bills_feed_order,
    last_name_from_official_name,
    parse_bill_id_query,
    sort_bill_voters,
)
from api.schemas import BillVoterOut, OfficialVoteOut, RollCallOut
from models import Bill


class ChamberVoteSummaryTests(unittest.TestCase):
    def test_maps_federal_offices(self):
        self.assertEqual(_chamber_for_office("Senator"), "senate")
        self.assertEqual(_chamber_for_office("Representative"), "house")
        self.assertEqual(_chamber_for_office("Delegate"), "house")
        self.assertEqual(_chamber_for_office("Resident Commissioner"), "house")

    def test_ignores_state_and_unknown_offices(self):
        self.assertIsNone(_chamber_for_office("State Senator"))
        self.assertIsNone(_chamber_for_office("Governor"))
        self.assertIsNone(_chamber_for_office(None))

    def test_empty_summaries_have_both_chambers(self):
        empty = _empty_chamber_summaries()
        self.assertEqual(set(empty), {"house", "senate"})
        self.assertEqual(empty["house"], {})
        self.assertEqual(empty["senate"], {})


class VotePartySummaryTests(unittest.TestCase):
    def test_groups_counts_by_chamber_and_party(self):
        totals = {"119-hr-1": _empty_chamber_summaries()}
        by_party = {"119-hr-1": _empty_party_summaries()}
        _record_vote_count(
            totals, by_party, "119-hr-1", "Representative", "Democratic", "Yes", 210
        )
        _record_vote_count(
            totals, by_party, "119-hr-1", "Representative", "Republican", "No", 201
        )
        _record_vote_count(
            totals, by_party, "119-hr-1", "Representative", "D", "No", 2
        )
        _record_vote_count(
            totals, by_party, "119-hr-1", "Senator", "Independent", "Yes", 1
        )
        _record_vote_count(
            totals, by_party, "119-hr-1", "Governor", "Democratic", "Yes", 1
        )

        self.assertEqual(totals["119-hr-1"]["house"]["Yes"], 210)
        self.assertEqual(totals["119-hr-1"]["house"]["No"], 203)
        self.assertEqual(by_party["119-hr-1"]["house"]["Democratic"]["Yes"], 210)
        self.assertEqual(by_party["119-hr-1"]["house"]["Democratic"]["No"], 2)
        self.assertEqual(by_party["119-hr-1"]["house"]["Republican"]["No"], 201)
        self.assertEqual(by_party["119-hr-1"]["senate"]["Independent"]["Yes"], 1)
        self.assertEqual(by_party["119-hr-1"]["senate"].get("Democratic"), None)

    def test_bill_detail_includes_party_breakdown(self):
        bill = Bill(id="119-hr-1", title="Test")
        detail = _bill_detail(
            bill,
            {"house": {"Yes": 10}, "senate": {}},
            {"house": {"Democratic": {"Yes": 10}}, "senate": {}},
        )
        self.assertEqual(detail.votes_summary["house"]["Yes"], 10)
        self.assertEqual(detail.votes_by_party["house"]["Democratic"]["Yes"], 10)
        self.assertIsNone(detail.classification_model)

    def test_bill_detail_reports_classification_model(self):
        bill = Bill(id="119-hr-1", title="Test", classification_version="bills-v1|pabc123|qwen3.6:27b")
        detail = _bill_detail(bill, {"house": {}, "senate": {}})
        self.assertEqual(detail.classification_model, "qwen3.6:27b")


class BillVoterSortTests(unittest.TestCase):
    def test_last_name_from_inverted_and_display_names(self):
        self.assertEqual(last_name_from_official_name("Adams, Alma S."), "Adams")
        self.assertEqual(
            last_name_from_official_name("Blunt Rochester, Lisa"),
            "Blunt Rochester",
        )
        self.assertEqual(last_name_from_official_name("Pete Aguilar"), "Aguilar")
        self.assertEqual(last_name_from_official_name(""), "")

    def test_orders_yes_then_no_then_not_voting_then_last_name(self):
        voters = [
            BillVoterOut(official_id="1", name="Smith, John", position="No"),
            BillVoterOut(official_id="2", name="Adams, Alma S.", position="Yes"),
            BillVoterOut(official_id="3", name="Aderholt, Robert B.", position="No"),
            BillVoterOut(official_id="4", name="Young, Don", position="Not Voting"),
            BillVoterOut(official_id="5", name="Aguilar, Pete", position="Not Voting"),
            BillVoterOut(
                official_id="6", name="Blunt Rochester, Lisa", position="Yes"
            ),
        ]
        ordered = [voter.name for voter in sort_bill_voters(voters)]
        self.assertEqual(
            ordered,
            [
                "Adams, Alma S.",
                "Blunt Rochester, Lisa",
                "Aderholt, Robert B.",
                "Smith, John",
                "Aguilar, Pete",
                "Young, Don",
            ],
        )


class BipartisanTypeTests(unittest.TestCase):
    def test_two_parties_including_independent_are_bipartisan(self):
        self.assertEqual(
            classify_bipartisan_type("Democratic", {"Independent": 1}),
            "bipartisan",
        )
        self.assertEqual(
            classify_bipartisan_type(
                "Democratic",
                {"Democratic": 20, "Independent": 1},
            ),
            "bipartisan",
        )

    def test_three_parties_are_tripartisan(self):
        self.assertEqual(
            classify_bipartisan_type(
                "Democratic",
                {"Republican": 2, "Independent": 1},
            ),
            "tripartisan",
        )

    def test_bill_detail_corrects_stale_stored_type(self):
        bill = Bill(
            id="119-s-1",
            title="Test",
            sponsor_party="Democratic",
            cosponsor_party_breakdown={"Democratic": 20, "Independent": 1},
            bipartisan_type="tripartisan",
        )
        detail = _bill_detail(bill, _empty_chamber_summaries())
        self.assertEqual(detail.bipartisan_type, "bipartisan")

    def test_bill_detail_includes_velocity_fields(self):
        bill = Bill(
            id="119-hr-1",
            title="Test",
            days_to_vote=12,
            velocity_bucket="fast",
        )
        detail = _bill_detail(bill, _empty_chamber_summaries())
        self.assertEqual(detail.days_to_vote, 12)
        self.assertEqual(detail.velocity_bucket, "fast")

    def test_bill_detail_includes_roll_calls(self):
        from models import RollCall

        bill = Bill(id="119-hr-1", title="Test")
        roll_call = RollCall(
            id=7,
            bill_id="119-hr-1",
            chamber="House",
            date=date(2026, 9, 2),
            question="On Passage",
            result="Passed",
            requires="1/2",
            source_roll_call_id="house-119-1-00017",
        )
        detail = _bill_detail(
            bill,
            _empty_chamber_summaries(),
            roll_calls=[roll_call],
        )
        self.assertEqual(len(detail.roll_calls), 1)
        self.assertEqual(detail.roll_calls[0].result, "Passed")
        self.assertEqual(detail.roll_calls[0].question, "On Passage")
        self.assertEqual(detail.roll_calls[0].chamber, "House")
        self.assertEqual(detail.roll_calls[0].requires, "1/2")
        self.assertEqual(detail.roll_calls[0].date, date(2026, 9, 2))
        self.assertIsNone(detail.status)

    def test_roll_call_and_official_vote_schemas_accept_dates(self):
        voted = date(2026, 9, 2)
        roll_call = RollCallOut(
            id=7,
            chamber="House",
            date=voted,
            source_roll_call_id="house-119-1-00017",
        )
        vote = OfficialVoteOut(bill_id="119-hr-1", date=voted)
        self.assertEqual(roll_call.date, voted)
        self.assertEqual(vote.date, voted)

    def test_bill_detail_includes_status(self):
        bill = Bill(
            id="119-hr-1",
            title="Test",
            status="Became Law",
            latest_action_text="Became Public Law No: 119-1.",
        )
        detail = _bill_detail(bill, _empty_chamber_summaries())
        self.assertEqual(detail.status, "Became Law")
        self.assertEqual(
            detail.latest_action_text,
            "Became Public Law No: 119-1.",
        )

    def test_tally_roll_call_ids_picks_newest_per_chamber(self):
        from models import RollCall

        house_old = RollCall(id=1, bill_id="119-hr-1", chamber="House")
        senate = RollCall(id=2, bill_id="119-hr-1", chamber="Senate")
        house_new = RollCall(id=3, bill_id="119-hr-1", chamber="House")
        # Helper expects newest-first order, matching _roll_calls_by_bill.
        ids = _tally_roll_call_ids([house_new, senate, house_old])
        self.assertEqual(ids, {"house": 3, "senate": 2})

    def test_tally_prefers_the_latest_passage_vote(self):
        from models import RollCall

        passage = RollCall(id=1, chamber="House", question="On Motion to Suspend the Rules and Pass")
        recommit = RollCall(id=2, chamber="House", question="On Motion to Recommit")
        cloture = RollCall(id=3, chamber="Senate", question="On Cloture on the Motion to Proceed H.R. 1")
        ids = _tally_roll_call_ids([cloture, recommit, passage])
        self.assertEqual(ids, {"house": 1, "senate": 3})


class BillFeedSortTests(unittest.TestCase):
    def test_unvoted_bills_precede_voted_then_dates_desc(self):
        unvoted_new = Bill(
            id="119-hr-3",
            title="Unvoted new",
            introduced_date=date(2026, 3, 1),
        )
        unvoted_old = Bill(
            id="119-hr-2",
            title="Unvoted old",
            introduced_date=date(2026, 1, 1),
        )
        unvoted_no_intro = Bill(id="119-hr-1", title="Unvoted no intro")
        voted_recent_later_intro = Bill(
            id="119-hr-6",
            title="Voted Sep later intro",
            introduced_date=date(2026, 2, 1),
            voted_date=date(2026, 9, 1),
        )
        voted_recent_earlier_intro = Bill(
            id="119-hr-5",
            title="Voted Sep earlier intro",
            introduced_date=date(2026, 1, 1),
            voted_date=date(2026, 9, 1),
        )
        voted_older = Bill(
            id="119-hr-4",
            title="Voted Jun",
            introduced_date=date(2026, 5, 1),
            voted_date=date(2026, 6, 1),
        )
        ordered = sorted(
            [
                voted_older,
                unvoted_no_intro,
                voted_recent_earlier_intro,
                unvoted_old,
                voted_recent_later_intro,
                unvoted_new,
            ],
            key=bill_feed_sort_key,
        )
        self.assertEqual(
            [bill.id for bill in ordered],
            [
                "119-hr-3",
                "119-hr-2",
                "119-hr-1",
                "119-hr-6",
                "119-hr-5",
                "119-hr-4",
            ],
        )

    def test_sql_order_puts_null_voted_dates_first(self):
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.sql import select

        stmt = select(Bill).order_by(*bills_feed_order())
        sql = str(stmt.compile(dialect=postgresql.dialect())).lower()
        self.assertIn("voted_date desc nulls first", sql)
        self.assertIn("introduced_date desc nulls last", sql)


class BillIdQueryTests(unittest.TestCase):
    def test_parses_common_bill_number_spellings(self):
        cases = {
            "H.R. 1": (None, "hr", "1"),
            "hr1": (None, "hr", "1"),
            "HR-0042": (None, "hr", "42"),
            "S. 5": (None, "s", "5"),
            "H.J.Res. 7": (None, "hjres", "7"),
            "S. Con. Res. 3": (None, "sconres", "3"),
            "h res 9": (None, "hres", "9"),
            "119-hr-197": ("119", "hr", "197"),
            "119 S 5": ("119", "s", "5"),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_bill_id_query(text), expected)

    def test_ignores_words_and_bare_numbers(self):
        for text in ("", None, "veterans", "hr", "1234", "tax hr 1", "hr 1 tax"):
            with self.subTest(text=text):
                self.assertIsNone(parse_bill_id_query(text))


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
class BillSearchApiTests(unittest.TestCase):
    # Congress 999 keeps seeded bills apart from real ones.
    PREFIX = "999-"

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from api.main import app
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        session.add_all([
            Bill(
                id="999-hr-4521",
                title="Zzyzx Wildfire Sprinkler Incentive Act",
                sponsor_name="Rep. Quillfeather, Ada [D-ZZ-1]",
                policy_area="Emergency Management",
                summary="<p>This bill funds retrofits in high-rise housing.</p>",
                level="federal",
            ),
            Bill(
                id="999-sjres-12",
                title="Zzyzx joint resolution on tariffs",
                sponsor_name="Sen. Brambleton, Otto [R-ZZ]",
                policy_area="Foreign Trade and International Finance",
                level="federal",
            ),
        ])
        session.commit()
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        session = self.SessionLocal()
        session.query(Bill).filter(Bill.id.like(f"{self.PREFIX}%")).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()

    def _ids(self, q, **params):
        response = self.client.get("/api/bills", params={"q": q, "limit": 500, **params})
        self.assertEqual(response.status_code, 200)
        return [item["id"] for item in response.json()["items"]]

    def test_bill_number_matches_by_id(self):
        self.assertEqual(self._ids("999 H.R. 4521"), ["999-hr-4521"])
        self.assertIn("999-sjres-12", self._ids("S.J.Res. 12"))
        self.assertNotIn("999-hr-4521", self._ids("H.R. 452"))

    def test_bare_number_matches_bill_number(self):
        self.assertIn("999-hr-4521", self._ids("4521"))

    def test_words_match_title_sponsor_policy_area_and_summary(self):
        self.assertIn("999-hr-4521", self._ids("wildfire sprinkler"))
        self.assertIn("999-hr-4521", self._ids("Quillfeather"))
        self.assertIn("999-sjres-12", self._ids("international finance"))
        self.assertIn("999-hr-4521", self._ids("retrofits housing"))

    def test_typos_and_partial_words_match_fuzzily(self):
        self.assertIn("999-hr-4521", self._ids("sprinklr"))
        self.assertIn("999-hr-4521", self._ids("Quilfeather"))
        self.assertIn("999-sjres-12", self._ids("Brambl"))

    def test_relevance_sort_puts_the_better_match_first(self):
        ids = [i for i in self._ids("zzyzx tariffs", sort="relevance") if i.startswith(self.PREFIX)]
        self.assertEqual(ids[0], "999-sjres-12")

    def test_unrelated_words_match_nothing(self):
        self.assertNotIn("999-hr-4521", self._ids("tariffs"))


if __name__ == "__main__":
    unittest.main()
