import os
import unittest
from datetime import date
from decimal import Decimal
import unittest.mock
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
    fec_ids_for_office,
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
STATES = [
    {"state": "CA", "total": 500.0, "count": 10},
    {"state": "VT", "total": 300.0, "count": 6},
    {"state": "NY", "total": 200.0, "count": 4},
]


def fake_fec_get(path, params=None):
    if path.startswith("/candidate/"):
        return {"results": [TOTALS_2030, TOTALS_2024]}
    if "by_size" in path:
        return {"results": SIZES}
    if "by_state" in path:
        return {"results": STATES}
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


class RouteOrderingTests(unittest.TestCase):
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
        from models import Official, OfficialFinanceTotal

        session = self.SessionLocal()
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
                stats = fec_client.sync_official_finance(session, official)
            session.commit()
            return stats, mock_get
        finally:
            session.close()

    def test_sync_is_idempotent_and_skips_fresh_breakdowns(self):
        stats, first = self._sync()
        self.assertEqual(stats, {"elections": 2, "breakdowns": 2})
        # One totals call (Senate ID only) plus size + state for each election.
        self.assertEqual(first.call_count, 5)

        stats, second = self._sync()
        self.assertEqual(stats, {"elections": 2, "breakdowns": 0})
        self.assertEqual(second.call_count, 1)

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

    def test_finance_endpoint_404(self):
        response = self.client.get("/api/officials/ZZFEC404/finance")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
