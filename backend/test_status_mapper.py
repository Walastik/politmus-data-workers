import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from status_mapper import (
    STATUS_BECAME_LAW,
    STATUS_FAILED,
    STATUS_INTRODUCED,
    STATUS_PASSED_BOTH,
    STATUS_PASSED_HOUSE,
    STATUS_PASSED_SENATE,
    STATUS_TO_EXECUTIVE,
    STATUS_VETOED,
    derive_bill_status,
    origin_chamber_from_bill_id,
    origin_chamber_from_identifier,
)


class OriginChamberTests(unittest.TestCase):
    def test_federal_bill_ids(self):
        self.assertEqual(origin_chamber_from_bill_id("119-hr-1"), "house")
        self.assertEqual(origin_chamber_from_bill_id("119-s-5"), "senate")
        self.assertEqual(origin_chamber_from_bill_id("119-hjres-12"), "house")
        self.assertIsNone(origin_chamber_from_bill_id("ocd-bill/example"))

    def test_state_identifiers(self):
        self.assertEqual(origin_chamber_from_identifier("HB 1"), "house")
        self.assertEqual(origin_chamber_from_identifier("SB 12"), "senate")
        self.assertEqual(origin_chamber_from_identifier("AB 5"), "house")


class DeriveBillStatusTests(unittest.TestCase):
    def test_became_public_law(self):
        self.assertEqual(
            derive_bill_status("Became Public Law No: 119-5."),
            STATUS_BECAME_LAW,
        )
        self.assertEqual(
            derive_bill_status("Signed by President."),
            STATUS_BECAME_LAW,
        )
        self.assertEqual(
            derive_bill_status("Signed by Governor."),
            STATUS_BECAME_LAW,
        )

    def test_vetoed(self):
        self.assertEqual(
            derive_bill_status("Vetoed by President."),
            STATUS_VETOED,
        )
        self.assertEqual(
            derive_bill_status("Pocket vetoed by President."),
            STATUS_VETOED,
        )

    def test_passed_senate_and_house_phrases(self):
        self.assertEqual(
            derive_bill_status("Passed/agreed to in Senate: On passage Passed"),
            STATUS_PASSED_SENATE,
        )
        self.assertEqual(
            derive_bill_status("Passed/agreed to in House: On passage Passed"),
            STATUS_PASSED_HOUSE,
        )

    def test_house_bill_passing_senate_is_both_chambers(self):
        self.assertEqual(
            derive_bill_status(
                "Passed/agreed to in Senate: On passage Passed",
                origin_chamber="house",
            ),
            STATUS_PASSED_BOTH,
        )
        self.assertEqual(
            derive_bill_status(
                "Passed/agreed to in House",
                origin_chamber="senate",
            ),
            STATUS_PASSED_BOTH,
        )

    def test_to_president_or_governor(self):
        self.assertEqual(
            derive_bill_status("Presented to President."),
            STATUS_TO_EXECUTIVE,
        )
        self.assertEqual(
            derive_bill_status("Sent to Governor."),
            STATUS_TO_EXECUTIVE,
        )

    def test_failed_of_passage(self):
        self.assertEqual(
            derive_bill_status("Failed of passage/not agreed to in Senate."),
            STATUS_FAILED,
        )

    def test_defaults_to_introduced(self):
        self.assertEqual(derive_bill_status(""), STATUS_INTRODUCED)
        self.assertEqual(
            derive_bill_status("Referred to the Committee on Judiciary."),
            STATUS_INTRODUCED,
        )

    def test_roll_calls_can_raise_introduced_to_passage(self):
        status = derive_bill_status(
            "Received in the Senate.",
            origin_chamber="house",
            roll_calls=[
                {
                    "chamber": "House",
                    "question": "On Passage",
                    "result": "Passed",
                }
            ],
        )
        self.assertEqual(status, STATUS_PASSED_HOUSE)

    def test_roll_calls_both_chambers_beat_one_chamber_action(self):
        status = derive_bill_status(
            "Passed/agreed to in House: On passage Passed",
            origin_chamber="house",
            roll_calls=[
                {
                    "chamber": "House",
                    "question": "On Passage",
                    "result": "Passed",
                },
                {
                    "chamber": "Senate",
                    "question": "On Passage of the Bill",
                    "result": "Passed",
                },
            ],
        )
        self.assertEqual(status, STATUS_PASSED_BOTH)

    def test_law_is_not_overridden_by_roll_calls(self):
        status = derive_bill_status(
            "Became Public Law No: 119-1.",
            roll_calls=[
                {
                    "chamber": "House",
                    "question": "On Passage",
                    "result": "Passed",
                }
            ],
        )
        self.assertEqual(status, STATUS_BECAME_LAW)


if __name__ == "__main__":
    unittest.main()
