import os
import unittest
from datetime import date

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from services.bill_analytics import (
    AVERAGE,
    FAST,
    SLOW,
    VERY_FAST,
    VERY_SLOW,
    days_between,
    distribution_params,
    score_vote_delays,
    velocity_bucket,
)


class DaysBetweenTests(unittest.TestCase):
    def test_counts_calendar_days(self):
        self.assertEqual(days_between(date(2025, 1, 1), date(2025, 1, 11)), 10)

    def test_same_day_is_zero(self):
        self.assertEqual(days_between(date(2025, 3, 4), date(2025, 3, 4)), 0)

    def test_missing_dates_are_none(self):
        self.assertIsNone(days_between(None, date(2025, 1, 11)))
        self.assertIsNone(days_between(date(2025, 1, 1), None))


class VelocityBucketTests(unittest.TestCase):
    def test_five_tiers_from_standard_deviations(self):
        mu, sigma = 10.0, 4.0
        self.assertEqual(velocity_bucket(3, mu, sigma), VERY_FAST)
        self.assertEqual(velocity_bucket(4, mu, sigma), FAST)
        self.assertEqual(velocity_bucket(7, mu, sigma), FAST)
        self.assertEqual(velocity_bucket(8, mu, sigma), AVERAGE)
        self.assertEqual(velocity_bucket(12, mu, sigma), AVERAGE)
        self.assertEqual(velocity_bucket(13, mu, sigma), SLOW)
        self.assertEqual(velocity_bucket(16, mu, sigma), SLOW)
        self.assertEqual(velocity_bucket(17, mu, sigma), VERY_SLOW)

    def test_zero_spread_is_average(self):
        self.assertEqual(velocity_bucket(10, 10.0, 0.0), AVERAGE)
        self.assertEqual(velocity_bucket(99, 10.0, 0.0), AVERAGE)

    def test_distribution_params_use_population_std(self):
        mu, sigma = distribution_params([4, 10, 16])
        self.assertAlmostEqual(mu, 10.0)
        self.assertAlmostEqual(sigma, 4.898979, places=5)

    def test_single_value_has_zero_std(self):
        self.assertEqual(distribution_params([12]), (12.0, 0.0))

    def test_empty_values_have_no_params(self):
        self.assertIsNone(distribution_params([]))


class ScoreVoteDelaysTests(unittest.TestCase):
    def test_assigns_buckets_from_corpus(self):
        rows = [
            ("very-fast", date(2025, 1, 1), date(2025, 1, 1)),
            ("avg-a", date(2025, 1, 1), date(2025, 1, 11)),
            ("avg-b", date(2025, 1, 1), date(2025, 1, 11)),
            ("avg-c", date(2025, 1, 1), date(2025, 1, 11)),
            ("very-slow", date(2025, 1, 1), date(2025, 1, 21)),
        ]
        scored, params = score_vote_delays(rows)
        by_id = {bill_id: (days, bucket) for bill_id, days, bucket in scored}
        self.assertEqual(by_id["very-fast"], (0, VERY_FAST))
        self.assertEqual(by_id["avg-a"], (10, AVERAGE))
        self.assertEqual(by_id["very-slow"], (20, VERY_SLOW))
        self.assertIsNotNone(params)

    def test_skips_rows_missing_a_date(self):
        scored, params = score_vote_delays(
            [
                ("ok", date(2025, 1, 1), date(2025, 1, 2)),
                ("missing-vote", date(2025, 1, 1), None),
            ]
        )
        self.assertEqual(scored, [("ok", 1, AVERAGE)])
        self.assertEqual(params, (1.0, 0.0))


if __name__ == "__main__":
    unittest.main()
