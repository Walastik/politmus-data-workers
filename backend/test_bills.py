import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from api.routes.bills import _chamber_for_office, _empty_chamber_summaries


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


if __name__ == "__main__":
    unittest.main()
