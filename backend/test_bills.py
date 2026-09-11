import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from api.filters import classify_bipartisan_type
from api.routes.bills import _bill_detail, _chamber_for_office, _empty_chamber_summaries
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


if __name__ == "__main__":
    unittest.main()
