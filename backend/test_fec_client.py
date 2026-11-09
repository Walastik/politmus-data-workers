import os
import unittest
from datetime import date, datetime
from decimal import Decimal
import unittest.mock
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

import fec_client
from api.main import app
from api.routes.officials import get_official_finance
from database import get_db
from fec_client import (
    crosswalk_ids,
    election_period_start,
    fec_ids_for_office,
    merge_expenditures,
    committees_for_period,
    outside_spending_due,
    outside_spending_summary,
    pac_contribution_values,
    pac_sync_due,
    size_breakdown,
    state_breakdown,
    totals_values,
)


LEGISLATORS = [
    {"id": {"bioguide": "S000033", "fec": ["H8VT01016", "S4VT00033"], "opensecrets": "N00000528"}},
    {"id": {"bioguide": "A000383"}},
    {"id": {"fec": ["H0XX00000"]}},
]

TOTALS_2024 = {
    "candidate_id": "S4VT00033",
    "candidate_election_year": 2024,
    "coverage_start_date": "2019-01-01T00:00:00",
    "coverage_end_date": "2024-12-31T00:00:00",
    "receipts": 26324335.09,
    "contributions": 24931287.33,
    "individual_contributions": 24931260.33,
    "individual_itemized_contributions": 7291657.83,
    "individual_unitemized_contributions": 17639602.5,
    "other_political_committee_contributions": 27.0,
    "political_party_committee_contributions": 0,
    "candidate_contribution": 0,
    "loans_made_by_candidate": 0,
    "transfers_from_other_authorized_committee": 1000000.0,
    "disbursements": 20000000.0,
    "last_cash_on_hand_end_period": 22374564.87,
    "last_debts_owed_by_committee": 0,
}
TOTALS_2030 = dict(
    TOTALS_2024,
    candidate_election_year=2030,
    coverage_start_date="2025-01-01T00:00:00",
    coverage_end_date="2026-09-30T00:00:00",
    receipts=1000.0,
)
SIZES = [
    {"candidate_id": "S4VT00033", "size": 500, "total": 300.0, "count": 1},
    {"candidate_id": "S4VT00033", "size": 0, "total": 900.0, "count": None},
    {"candidate_id": "S4VT00033", "size": 200, "total": 300.0, "count": 2},
]
OUTSIDE = [
    {"committee_id": "C001", "committee_name": "Friends PAC", "support_oppose_indicator": "S", "total": 400.0},
    {"committee_id": "C001", "committee_name": "Friends PAC", "support_oppose_indicator": "S", "total": 100.0},
    {"committee_id": "C002", "committee_name": "Union Fund", "support_oppose_indicator": "S", "total": 200.0},
    {"committee_id": "C003", "committee_name": "Against PAC", "support_oppose_indicator": "O", "total": 50.0},
]


def expenditure(transaction_id, amount, day, side="S", committee_id="C001", name="Friends PAC",
                file_number=1, notice=False, **extra):
    """An itemized Schedule E row as both feeds return it."""
    return {
        "committee_id": committee_id,
        "committee": {"name": name},
        "support_oppose_indicator": side,
        "expenditure_amount": amount,
        "dissemination_date": day,
        "file_number": file_number,
        "transaction_id": transaction_id,
        "is_notice": notice,
        "most_recent": True,
        "memo_code": None,
        **extra,
    }


def efile_filing(file_number, chain=None, coverage_end=None):
    chain = chain or [file_number]
    return {"amendment_chain": chain, "most_recent_filing": chain[-1], "coverage_end_date": coverage_end}


# The in-progress race's itemized rows: same totals as OUTSIDE once merged.
ITEMIZED = [
    expenditure("A1", 400.0, "2029-05-01"),
    expenditure("A2", 100.0, "2029-06-01"),
    expenditure("B1", 200.0, "2029-06-01", committee_id="C002", name="Union Fund"),
    expenditure("C1", 50.0, "2029-06-01", side="O", committee_id="C003", name="Against PAC"),
]
STATES = [
    {"state": "CA", "total": 500.0, "count": 10},
    {"state": "VT", "total": 300.0, "count": 6},
    {"state": "NY", "total": 200.0, "count": 4},
]


COMMITTEES = [
    {"committee_id": "C00411330", "designation": "P", "committee_type": "S", "cycles": [2018, 2020, 2022, 2024, 2026]},
    {"committee_id": "C00555615", "designation": "U", "committee_type": "O", "cycles": [2024]},
    {"committee_id": "C00426650", "designation": "J", "committee_type": "S", "cycles": [2024]},
]


def pac_row(sub_id, amount, date_value, name="LIUNA PAC", committee_id="C00000001", **contributor):
    return {
        "sub_id": sub_id,
        "contributor_id": committee_id,
        "contributor_name": name,
        "contribution_receipt_amount": amount,
        "contribution_receipt_date": f"{date_value}T00:00:00",
        "pdf_url": f"https://docquery.fec.gov/{sub_id}",
        "memo_code": None,
        "contributor": {
            "committee_id": committee_id,
            "name": name,
            "committee_type": "Q",
            "organization_type": "L",
            "designation": "B",
            **contributor,
        },
    }


# Per period, as /schedules/schedule_a/ returns them.
PAC_ROWS = {
    2020: [pac_row("1", 1000, "2020-05-01")],
    2022: [pac_row("2", 2000, "2022-05-01", name="DAIRY PAC", committee_id="C2", organization_type="V")],
    2024: [
        pac_row("3", 5000, "2024-03-01"),
        pac_row("4", 2500, "2024-11-20", name="SENATE FUTURE FUND", committee_id="C3",
                organization_type=None, designation="D"),
        dict(pac_row("5", 9999, "2024-06-01"), memo_code="X"),
    ],
    # After the 2024 election: belongs to the 2030 race. Within 30 days of
    # the 2030 coverage date, so the period counts as caught up.
    2026: [pac_row("6", 4000, "2026-09-15")],
}


def fake_fec_get(path, params=None):
    if path.endswith("/committees/"):
        return {"results": COMMITTEES}
    if path.startswith("/candidate/"):
        return {"results": [TOTALS_2030, TOTALS_2024]}
    if "by_size" in path:
        return {"results": SIZES}
    if "by_state" in path:
        return {"results": STATES}
    if path == "/schedules/schedule_a/":
        return {"results": PAC_ROWS.get(params["two_year_transaction_period"], []), "pagination": {}}
    if path == "/schedules/schedule_e/by_candidate/":
        return {"results": OUTSIDE, "pagination": {"pages": 1}}
    if path == "/schedules/schedule_e/":
        return {"results": ITEMIZED, "pagination": {"last_indexes": None}}
    if path == "/schedules/schedule_e/efile/":
        return {"results": [], "pagination": {"pages": 1}}
    raise AssertionError(path)


class CrosswalkTests(unittest.TestCase):
    def test_maps_bioguide_to_fec_and_opensecrets(self):
        ids = crosswalk_ids(LEGISLATORS)
        self.assertEqual(ids["S000033"], (["H8VT01016", "S4VT00033"], "N00000528"))
        self.assertEqual(ids["A000383"], ([], None))
        self.assertEqual(len(ids), 2)

    def test_picks_ids_for_current_office(self):
        ids = ["H8VT01016", "S4VT00033", "P80003023"]
        self.assertEqual(fec_ids_for_office(ids, "Senator"), ["S4VT00033"])
        self.assertEqual(fec_ids_for_office(ids, "Representative"), ["H8VT01016"])
        self.assertEqual(fec_ids_for_office(ids, "Delegate"), ["H8VT01016"])
        self.assertEqual(fec_ids_for_office(None, "Senator"), [])


class ParsingTests(unittest.TestCase):
    def test_totals_values(self):
        values = totals_values(TOTALS_2024)
        self.assertEqual(values["receipts"], Decimal("26324335.09"))
        self.assertEqual(values["individual_itemized"], Decimal("7291657.83"))
        self.assertEqual(values["pac_contributions"], Decimal("27.00"))
        self.assertEqual(values["cash_on_hand"], Decimal("22374564.87"))
        self.assertEqual(values["coverage_end_date"], date(2024, 12, 31))

    def test_size_breakdown_sorted_by_bucket(self):
        self.assertEqual([row["size"] for row in size_breakdown(SIZES)], [0, 200, 500])

    def test_state_breakdown(self):
        result = state_breakdown(STATES, "VT")
        self.assertEqual(result["in_state"], 300.0)
        self.assertEqual(result["out_of_state"], 700.0)
        self.assertEqual(result["total"], 1000.0)
        self.assertEqual(result["top_states"][0]["state"], "CA")

    def test_state_breakdown_without_home_state(self):
        result = state_breakdown(STATES, None)
        self.assertIsNone(result["in_state"])
        self.assertEqual(result["total"], 1000.0)


class FecGetTests(unittest.TestCase):
    def test_long_retry_after_raises_instead_of_sleeping(self):
        response = unittest.mock.MagicMock(status_code=429, headers={"Retry-After": "14227"})
        with patch.object(fec_client.requests, "get", return_value=response), patch.object(
            fec_client.time, "sleep"
        ) as sleep:
            with self.assertRaises(fec_client.RateLimited):
                fec_client.fec_get("/candidate/S4VT00033/totals/")
        self.assertTrue(all(call.args[0] < 60 for call in sleep.call_args_list))


class PacParsingTests(unittest.TestCase):
    def test_values_and_category(self):
        values = pac_contribution_values(pac_row("3", 5000, "2024-03-01"))
        self.assertEqual(values["sub_id"], "3")
        self.assertEqual(values["amount"], Decimal("5000.00"))
        self.assertEqual(values["receipt_date"], date(2024, 3, 1))
        self.assertEqual(values["category"], "labor")
        self.assertEqual(values["contributor_committee_id"], "C00000001")

    def test_memo_entries_are_dropped(self):
        self.assertIsNone(pac_contribution_values(PAC_ROWS[2024][2]))

    def test_committees_for_period_uses_cycles(self):
        committees = fec_client_committees()
        self.assertEqual(committees_for_period(committees, 2024), ["C00411330"])
        self.assertEqual(committees_for_period(committees, 2010), [])

    def test_keyset_pagination(self):
        pages = [
            {"results": [pac_row(str(i), 1, "2024-01-01") for i in range(100)],
             "pagination": {"last_indexes": {"last_index": "99", "last_contribution_receipt_date": "2024-01-01"}}},
            {"results": [pac_row("100", 1, "2024-01-02")], "pagination": {"last_indexes": {"last_index": "100"}}},
        ]
        with patch.object(fec_client, "fec_get", side_effect=pages) as mock_get:
            results = fec_client.fetch_pac_contributions("C1", 2024)
        self.assertEqual(len(results), 101)
        second_params = mock_get.call_args_list[1].kwargs["params"]
        self.assertEqual(second_params["last_index"], "99")
        self.assertEqual(second_params["line_number"], "F3-11C")

    def test_sync_due_rules(self):
        today = date(2026, 10, 19)
        self.assertTrue(pac_sync_due(None, 2024, date(2024, 12, 31), today))
        stale = SimpleNamespace(fetched_at=datetime(2024, 10, 1), coverage_end_date=date(2024, 9, 30))
        settled = SimpleNamespace(fetched_at=datetime(2025, 3, 1), coverage_end_date=date(2024, 12, 31))
        self.assertTrue(pac_sync_due(stale, 2024, date(2024, 12, 31), today))
        self.assertFalse(pac_sync_due(settled, 2024, date(2024, 12, 31), today))
        current = SimpleNamespace(
            fetched_at=datetime(2026, 10, 1),
            coverage_end_date=date(2026, 9, 30),
            latest_receipt_date=date(2026, 9, 20),
        )
        # New filing moved the coverage date.
        self.assertTrue(pac_sync_due(current, 2026, date(2026, 12, 31), today))
        # Caught up with the filing.
        self.assertFalse(pac_sync_due(current, 2026, date(2026, 9, 30), today))
        # FEC still processing: gifts stop at June while totals run to September.
        lagging = SimpleNamespace(**{**vars(current), "latest_receipt_date": date(2026, 6, 30)})
        self.assertTrue(pac_sync_due(lagging, 2026, date(2026, 9, 30), today))
        # ...once a day, however many runs there are.
        checked_today = SimpleNamespace(**{**vars(lagging), "fetched_at": datetime(2026, 10, 19, 6)})
        self.assertFalse(pac_sync_due(checked_today, 2026, date(2026, 9, 30), today))
        # A new filing is due right away.
        self.assertTrue(pac_sync_due(checked_today, 2026, date(2026, 12, 31), today))
        # ...but not forever: 90 days on, no more gifts are coming.
        self.assertFalse(pac_sync_due(lagging, 2026, date(2026, 9, 30), date(2026, 12, 30)))


def fec_client_committees():
    return [
        {"committee_id": c["committee_id"], "designation": c["designation"], "cycles": c["cycles"]}
        for c in COMMITTEES
        if c["designation"] in ("P", "A")
    ]


class OutsideSpendingTests(unittest.TestCase):
    def test_summary_merges_rows_per_spender_and_side(self):
        summary = outside_spending_summary(OUTSIDE)
        self.assertEqual(summary["support_total"], 700.0)
        self.assertEqual(summary["oppose_total"], 50.0)
        self.assertEqual(summary["support_count"], 2)
        self.assertEqual(
            summary["top_support"][0],
            {"committee_id": "C001", "name": "Friends PAC", "total": 500.0},
        )
        self.assertEqual(summary["top_oppose"][0]["name"], "Against PAC")

    def test_summary_without_spending(self):
        summary = outside_spending_summary([])
        self.assertEqual(summary["support_total"], 0)
        self.assertEqual(summary["top_oppose"], [])

    def test_refresh_rule(self):
        today = date(2026, 10, 19)
        fresh = unittest.mock.MagicMock(outside_spending={"support_total": 1})
        missing = unittest.mock.MagicMock(outside_spending=None)
        fresh.election_year = missing.election_year = 2024
        self.assertFalse(outside_spending_due(fresh, today))
        self.assertTrue(outside_spending_due(missing, today))
        fresh.election_year = 2026
        self.assertTrue(outside_spending_due(fresh, today))

    def test_election_period_start(self):
        self.assertEqual(election_period_start("H6TX01001", 2026), date(2025, 1, 1))
        self.assertEqual(election_period_start("S6TX00388", 2026), date(2021, 1, 1))
        self.assertEqual(election_period_start("P80001571", 2028), date(2025, 1, 1))

    def _merged_totals(self, processed, efiled, start=date(2025, 1, 1)):
        totals = {}
        for row in merge_expenditures(processed, efiled, start):
            key = (row["committee_id"], row["support_oppose_indicator"])
            totals[key] = totals.get(key, 0) + row["total"]
        return totals

    def test_merge_counts_a_transaction_in_both_feeds_once(self):
        row = expenditure("T1", 1000, "2026-09-01", file_number=10)
        efiled = {**row, "filing": efile_filing(10)}
        self.assertEqual(self._merged_totals([row], [efiled]), {("C001", "S"): 1000})

    def test_merge_drops_notices_a_regular_report_repeats(self):
        # The quarterly report (through 9/30) repeats the August notice under
        # a new transaction ID; the October notice comes after it.
        august = expenditure("N1", 500, "2026-08-10", file_number=20, notice=True)
        october = expenditure("N2", 700, "2026-10-20", file_number=21, notice=True)
        quarterly = expenditure("Q1", 500, "2026-08-10", file_number=22,
                                filing=efile_filing(22, coverage_end="2026-09-30"))
        self.assertEqual(
            self._merged_totals([august, october], [quarterly]), {("C001", "S"): 1200}
        )

    def test_merge_uses_regular_report_coverage_not_just_its_dates(self):
        # A notice dated after the report's last item but inside its period is
        # still repeated by it.
        notice = expenditure("N1", 300, "2026-09-20", file_number=30, notice=True)
        quarterly = expenditure("Q1", 300, "2026-09-01", file_number=31,
                                filing=efile_filing(31, coverage_end="2026-09-30"))
        self.assertEqual(self._merged_totals([notice], [quarterly]), {("C001", "S"): 300})

    def test_merge_keeps_only_the_latest_amendment(self):
        original = expenditure("T1", 900, "2026-10-01", file_number=40, notice=True)
        amended = expenditure("T1", 950, "2026-10-01", file_number=41, notice=True,
                              filing=efile_filing(41, chain=[40, 41]))
        # The processed feed has only the original, still marked current.
        self.assertEqual(self._merged_totals([original], [amended]), {("C001", "S"): 950})

    def test_merge_skips_memo_lines_superseded_rows_and_older_periods(self):
        rows = [
            expenditure("M1", 100, "2026-09-01", memo_code="X"),
            expenditure("S1", 200, "2026-09-01", most_recent=False),
            expenditure("P1", 300, "2024-10-01"),
            expenditure("K1", 400, "2026-09-01"),
            expenditure("X1", 500, "2026-09-01", side=None),
        ]
        self.assertEqual(self._merged_totals(rows, []), {("C001", "S"): 400})

    def test_in_progress_race_sums_itemized_rows(self):
        with patch.object(fec_client, "fec_get", side_effect=fake_fec_get) as mock_get:
            summary = fec_client.fetch_outside_spending("S4VT00033", 2030, today=date(2026, 10, 19))
        self.assertEqual(summary["support_total"], 700.0)
        self.assertEqual(summary["top_support"][0], {"committee_id": "C001", "name": "Friends PAC", "total": 500.0})
        calls = [call.args[0] for call in mock_get.call_args_list]
        self.assertEqual(calls, ["/schedules/schedule_e/", "/schedules/schedule_e/efile/"])
        # A Senate race's spending spans its three two-year periods.
        self.assertEqual(mock_get.call_args_list[0].kwargs["params"]["cycle"], [2026, 2028, 2030])

    def test_finished_race_uses_fec_totals(self):
        with patch.object(fec_client, "fec_get", side_effect=fake_fec_get) as mock_get:
            summary = fec_client.fetch_outside_spending("S4VT00033", 2024, today=date(2026, 10, 19))
        self.assertEqual(summary["support_total"], 700.0)
        self.assertEqual(mock_get.call_count, 1)


class RouteOrderingTests(unittest.TestCase):
    def test_pac_routes_are_not_caught_by_official_path(self):
        from api.routes.finance_pacs import pac_gifts, pac_list, pac_summary

        seen = []

        def fake_db(request: Request):
            seen.append(request.scope["endpoint"])
            raise HTTPException(status_code=418)

        app.dependency_overrides[get_db] = fake_db
        try:
            client = TestClient(app)
            params = "?fec_candidate_id=S1&election_year=2024&pac_key=C1"
            for suffix in ("", "/list", "/gifts"):
                client.get(f"/api/officials/S000033/finance/pacs{suffix}{params}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        self.assertEqual(seen, [pac_summary, pac_list, pac_gifts])

    def test_finance_route_is_not_caught_by_official_path(self):
        seen = []

        def fake_db(request: Request):
            seen.append(request.scope["endpoint"])
            raise HTTPException(status_code=418)

        app.dependency_overrides[get_db] = fake_db
        try:
            response = TestClient(app).get("/api/officials/S000033/finance")
        finally:
            app.dependency_overrides.pop(get_db, None)

        self.assertEqual(response.status_code, 418)
        self.assertEqual(seen, [get_official_finance])


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
class FinanceSyncTests(unittest.TestCase):
    OFFICIAL_ID = "ZZFEC001"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal

        self.SessionLocal = SessionLocal
        self._cleanup()
        from models import Official

        session = self.SessionLocal()
        session.add(
            Official(
                id=self.OFFICIAL_ID,
                name="Test, Senator",
                state="Vermont",
                office="Senator",
                current_member=True,
                level="federal",
            )
        )
        session.commit()
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Official, OfficialFinanceTotal, PacContribution, PacContributionSync

        session = self.SessionLocal()
        for model in (PacContribution, PacContributionSync):
            session.query(model).filter(model.official_id == self.OFFICIAL_ID).delete()
        session.query(OfficialFinanceTotal).filter(
            OfficialFinanceTotal.official_id == self.OFFICIAL_ID
        ).delete()
        session.query(Official).filter(Official.id == self.OFFICIAL_ID).delete()
        session.commit()
        session.close()

    def _sync(self):
        from models import Official

        session = self.SessionLocal()
        try:
            official = session.get(Official, self.OFFICIAL_ID)
            official.fec_candidate_ids = ["H8VT01016", "S4VT00033"]
            official.opensecrets_id = "N00000528"
            with patch.object(fec_client, "fec_get", side_effect=fake_fec_get) as mock_get:
                stats = fec_client.sync_official_finance(
                    session, official, today=date(2026, 10, 19)
                )
            session.commit()
            return stats, mock_get
        finally:
            session.close()

    def test_sync_is_idempotent_and_skips_fresh_breakdowns(self):
        stats, first = self._sync()
        self.assertEqual(stats, {"elections": 2, "breakdowns": 2, "outside_spending": 2})
        # One totals call (Senate ID only), then outside spending, size and
        # state for each election; the race under way reads two feeds.
        self.assertEqual(first.call_count, 8)

        # The finished 2024 race keeps its outside spending; 2030 refreshes.
        stats, second = self._sync()
        self.assertEqual(stats, {"elections": 2, "breakdowns": 0, "outside_spending": 1})
        self.assertEqual(second.call_count, 3)

        from models import OfficialFinanceTotal

        session = self.SessionLocal()
        rows = (
            session.query(OfficialFinanceTotal)
            .filter(OfficialFinanceTotal.official_id == self.OFFICIAL_ID)
            .all()
        )
        session.close()
        self.assertEqual(sorted(row.election_year for row in rows), [2024, 2030])
        self.assertTrue(all(row.fec_candidate_id == "S4VT00033" for row in rows))

    def test_finance_endpoint(self):
        self._sync()
        response = self.client.get(f"/api/officials/{self.OFFICIAL_ID}/finance")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["opensecrets_id"], "N00000528")
        self.assertEqual([e["election_year"] for e in body["elections"]], [2030, 2024])
        latest = body["elections"][0]
        self.assertEqual(latest["receipts"], 1000.0)
        self.assertEqual(latest["small_dollar_share"], 0.6)
        self.assertEqual(latest["in_state_share"], 0.3)
        self.assertEqual(latest["top_states"][0]["state"], "CA")
        self.assertEqual(latest["fec_url"], "https://www.fec.gov/data/candidate/S4VT00033/")
        self.assertEqual(latest["home_state"], "VT")
        self.assertEqual(latest["outside_spending"]["support_total"], 700.0)
        mix = {item["key"]: item for item in body["elections"][1]["funding_mix"]}
        self.assertEqual(mix["joint_fundraising"]["amount"], 1000000.0)

        # Peers: the official's own finished election only, nobody else to compare with.
        comparison = body["peer_comparison"]
        self.assertEqual(comparison["election_year"], 2024)
        self.assertEqual(comparison["chamber_label"], "senators")

    def _sync_pacs(self):
        from models import Official

        session = self.SessionLocal()
        try:
            official = session.get(Official, self.OFFICIAL_ID)
            with patch.object(fec_client, "fec_get", side_effect=fake_fec_get) as mock_get:
                stats = fec_client.sync_official_pacs(session, official, today=date(2026, 10, 19))
            session.commit()
            return stats, mock_get
        finally:
            session.close()

    def test_pac_sync_is_idempotent(self):
        self._sync()
        stats, first = self._sync_pacs()
        # Committees once, then 2020/2022/2024 for the 2024 race and 2026 for 2030.
        self.assertEqual(stats, {"periods": 4, "skipped": 0, "gifts": 5})
        self.assertEqual(first.call_count, 5)

        stats, second = self._sync_pacs()
        self.assertEqual(stats, {"periods": 0, "skipped": 4, "gifts": 0})
        self.assertEqual(second.call_count, 0)

    def test_pac_sync_moves_gift_stored_under_another_committee(self):
        from models import PacContribution

        self._sync()
        session = self.SessionLocal()
        session.add(
            PacContribution(
                sub_id="3", official_id=self.OFFICIAL_ID, fec_candidate_id="S4VT00033",
                committee_id="C_OLD", two_year_period=2016, amount=1, category="other",
            )
        )
        session.commit()
        session.close()

        stats, _ = self._sync_pacs()
        self.assertEqual(stats["gifts"], 5)
        session = self.SessionLocal()
        gift = session.get(PacContribution, "3")
        session.close()
        self.assertEqual((gift.committee_id, gift.two_year_period), ("C00411330", 2024))

    def test_pac_endpoints(self):
        self._sync()
        self._sync_pacs()
        base = f"/api/officials/{self.OFFICIAL_ID}/finance/pacs"
        params = {"fec_candidate_id": "S4VT00033", "election_year": 2024}

        summary = self.client.get(base, params=params).json()
        # The memo row is dropped and the 2025 gift belongs to the 2030 race.
        self.assertEqual(summary["total"], 10500.0)
        self.assertEqual(summary["gift_count"], 4)
        self.assertEqual(summary["itemized_through"], "2024-11-20")
        self.assertEqual(summary["reported_through"], "2024-12-31")
        self.assertEqual(summary["pac_count"], 3)
        self.assertTrue(summary["synced"])
        categories = {c["key"]: c for c in summary["categories"]}
        self.assertEqual(categories["labor"]["total"], 6000.0)
        self.assertEqual(categories["cooperative"]["pac_count"], 1)
        self.assertEqual(categories["politicians"]["total"], 2500.0)
        self.assertEqual(summary["top_pacs"][0]["name"], "LIUNA PAC")
        self.assertEqual(summary["top_pacs"][0]["gift_count"], 2)

        listing = self.client.get(f"{base}/list", params={**params, "q": "dairy"}).json()
        self.assertEqual(listing["total_count"], 1)
        self.assertEqual(listing["items"][0]["category_label"], "Cooperatives")
        listing = self.client.get(
            f"{base}/list", params={**params, "category": "politicians", "sort": "name"}
        ).json()
        self.assertEqual([i["name"] for i in listing["items"]], ["SENATE FUTURE FUND"])
        paged = self.client.get(f"{base}/list", params={**params, "limit": 1, "offset": 1}).json()
        self.assertEqual(paged["total_count"], 3)
        self.assertEqual(len(paged["items"]), 1)

        gifts = self.client.get(
            f"{base}/gifts", params={**params, "pac_key": "C00000001"}
        ).json()
        self.assertEqual([g["receipt_date"] for g in gifts], ["2024-03-01", "2020-05-01"])

        later = self.client.get(
            base, params={"fec_candidate_id": "S4VT00033", "election_year": 2030}
        ).json()
        self.assertEqual(later["total"], 4000.0)
        self.assertEqual(
            self.client.get(base, params={**params, "election_year": 1990}).status_code, 404
        )

    def test_finance_endpoint_404(self):
        response = self.client.get("/api/officials/ZZFEC404/finance")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
