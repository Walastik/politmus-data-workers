import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from services.finance_insights import (
    chamber_for_office,
    funding_mix,
    is_completed,
    latest_completed,
    peer_comparison,
    percentile,
)

TODAY = date(2026, 10, 19)


def row(official_id="A", election_year=2024, receipts=1000, **overrides):
    values = {
        "official_id": official_id,
        "fec_candidate_id": f"S{official_id}",
        "election_year": election_year,
        "receipts": Decimal(receipts) if receipts is not None else None,
        "individual_contributions": Decimal(600),
        "individual_unitemized": Decimal(200),
        "individual_itemized": Decimal(400),
        "joint_fundraising_transfers": Decimal(100),
        "pac_contributions": Decimal(150),
        "party_contributions": Decimal(0),
        "candidate_contributions": Decimal(20),
        "candidate_loans": Decimal(30),
        "state_breakdown": {"home_state": "MN", "in_state": 120.0, "total": 400.0},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def official(official_id, office="Senator", party="Democratic"):
    return SimpleNamespace(id=official_id, office=office, party=party)


class FundingMixTests(unittest.TestCase):
    def test_slices_add_up_to_receipts(self):
        mix = {item["key"]: item for item in funding_mix(row())}
        self.assertEqual(mix["small_donors"]["amount"], 200.0)
        self.assertEqual(mix["large_donors"]["amount"], 400.0)
        self.assertEqual(mix["joint_fundraising"]["amount"], 100.0)
        self.assertEqual(mix["pacs"]["amount"], 150.0)
        self.assertEqual(mix["candidate"]["amount"], 50.0)
        self.assertEqual(mix["other"]["amount"], 100.0)
        self.assertEqual(sum(item["amount"] for item in mix.values()), 1000.0)
        self.assertEqual(mix["small_donors"]["share"], 0.2)

    def test_other_never_negative(self):
        mix = {item["key"]: item for item in funding_mix(row(receipts=500))}
        self.assertEqual(mix["other"]["amount"], 0.0)

    def test_no_receipts(self):
        self.assertIsNone(funding_mix(row(receipts=0)))
        self.assertIsNone(funding_mix(row(receipts=None)))


class ElectionSelectionTests(unittest.TestCase):
    def test_election_is_completed_after_its_year(self):
        self.assertTrue(is_completed(2024, TODAY))
        self.assertFalse(is_completed(2026, TODAY))

    def test_latest_completed_skips_current_and_empty_races(self):
        rows = [row(election_year=2030), row(election_year=2024), row(election_year=2018),
                row(election_year=2022, receipts=0)]
        self.assertEqual(latest_completed(rows, TODAY).election_year, 2024)
        self.assertIsNone(latest_completed([row(election_year=2026)], TODAY))


class PercentileTests(unittest.TestCase):
    def test_counts_strictly_lower_values(self):
        self.assertEqual(percentile(5, [1, 2, 5, 9]), 0.5)
        self.assertEqual(percentile(10, [1, 2]), 1.0)
        self.assertEqual(percentile(0, [1, 2]), 0.0)

    def test_needs_a_value_and_peers(self):
        self.assertIsNone(percentile(None, [1]))
        self.assertIsNone(percentile(5, []))
        self.assertIsNone(percentile(5, [None]))


class PeerComparisonTests(unittest.TestCase):
    def test_compares_within_chamber_and_party(self):
        officials = {
            "A": official("A"),
            "B": official("B"),
            "C": official("C", party="Republican"),
            "H": official("H", office="Representative"),
        }
        rows = {
            "A": [row("A", receipts=3000), row("A", election_year=2030, receipts=99999)],
            "B": [row("B", receipts=1000)],
            "C": [row("C", receipts=2000, individual_unitemized=Decimal(500))],
            "H": [row("H", receipts=999999)],
        }
        result = peer_comparison(officials["A"], rows, officials, today=TODAY)
        self.assertEqual(result["election_year"], 2024)
        self.assertEqual(result["chamber_label"], "senators")
        metrics = {metric["key"]: metric for metric in result["metrics"]}
        receipts = metrics["receipts"]
        self.assertEqual(receipts["value"], 3000.0)
        self.assertEqual(receipts["chamber_percentile"], 1.0)
        self.assertEqual(receipts["chamber_count"], 2)
        self.assertEqual(receipts["party_count"], 1)
        small = metrics["small_donor_share"]
        self.assertEqual(small["chamber_percentile"], 0.0)

    def test_no_finished_election(self):
        officials = {"A": official("A")}
        rows = {"A": [row("A", election_year=2026)]}
        self.assertIsNone(peer_comparison(officials["A"], rows, officials, today=TODAY))

    def test_house_chamber(self):
        self.assertEqual(chamber_for_office("Delegate"), "house")
        self.assertEqual(chamber_for_office("Senator"), "senate")


if __name__ == "__main__":
    unittest.main()
