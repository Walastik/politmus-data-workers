import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

import httpx
from fastapi.testclient import TestClient

from api.census import (
    CENSUS_COORDINATES_URL,
    CensusMatch,
    CensusUnavailable,
    _coordinates_match_from_payload,
    geocode_coordinates,
)
from api.main import app
from api.schemas import CivicLookupOut
from database import get_db

FIXTURES_DIR = Path(__file__).parent / "tests" / "fixtures"


def _fixture(name: str):
    return json.loads((FIXTURES_DIR / name).read_text())


class CoordinatesMatchTests(unittest.TestCase):
    def test_parses_live_austin_payload(self):
        match = _coordinates_match_from_payload(_fixture("census_coordinates_austin.json"))
        self.assertEqual(match.state_abbr, "TX")
        self.assertEqual(match.state_name, "Texas")
        self.assertEqual(match.district, 10)
        self.assertEqual(match.sldu, 14)
        self.assertEqual(match.sldl, 49)
        self.assertIsNone(match.line1)
        self.assertIsNone(match.city)
        self.assertIsNone(match.zip)

    def test_at_large_delegate_district_maps_to_zero(self):
        payload = {
            "result": {
                "geographies": {
                    "States": [{"STUSAB": "DC", "NAME": "District of Columbia"}],
                    "120th Congressional Districts": [
                        {
                            "GEOID": "1198",
                            "CD120": "98",
                            "CDSESSN": "120",
                            "NAME": "Delegate District (at Large)",
                        }
                    ],
                }
            }
        }
        match = _coordinates_match_from_payload(payload)
        self.assertEqual(match.state_abbr, "DC")
        self.assertEqual(match.district, 0)

    def test_point_outside_us_returns_none(self):
        # Census answers a point in the ocean with empty geography layers.
        payload = {"result": {"geographies": {"States": [], "120th Congressional Districts": []}}}
        self.assertIsNone(_coordinates_match_from_payload(payload))
        self.assertIsNone(_coordinates_match_from_payload({"result": {"geographies": {}}}))
        self.assertIsNone(_coordinates_match_from_payload({}))

    @patch("api.census.httpx.Client")
    def test_geocode_coordinates_sends_lon_as_x_and_lat_as_y(self, mock_client_cls):
        response = MagicMock(status_code=200)
        response.json.return_value = _fixture("census_coordinates_austin.json")
        client = mock_client_cls.return_value.__enter__.return_value
        client.get.return_value = response

        match = geocode_coordinates(30.2672, -97.7431)

        self.assertEqual(match.district, 10)
        url = client.get.call_args.args[0]
        params = client.get.call_args.kwargs["params"]
        self.assertEqual(url, CENSUS_COORDINATES_URL)
        self.assertEqual(params["x"], -97.7431)
        self.assertEqual(params["y"], 30.2672)
        self.assertEqual(params["benchmark"], "Public_AR_Current")

    @patch("api.census.httpx.Client")
    def test_geocode_coordinates_raises_when_unreachable(self, mock_client_cls):
        client = mock_client_cls.return_value.__enter__.return_value
        client.get.side_effect = httpx.ConnectError("down")
        with self.assertRaises(CensusUnavailable):
            geocode_coordinates(30.0, -97.0)


AUSTIN = CensusMatch(
    line1=None,
    city=None,
    state_abbr="TX",
    state_name="Texas",
    zip=None,
    district=10,
    district_label="Congressional District 10",
)


class LookupRouteCoordinateTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_db] = lambda: None
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.pop(get_db, None)

    @patch("api.routes.lookup._lookup_for_match")
    @patch("api.routes.lookup.geocode_address")
    @patch("api.routes.lookup.geocode_coordinates", return_value=AUSTIN)
    def test_lat_lon_uses_coordinate_geocoder(self, mock_coords, mock_address, mock_lookup):
        mock_lookup.return_value = CivicLookupOut(
            normalized_input=None, divisions=[], representatives=[]
        )
        response = self.client.get("/api/lookup", params={"lat": 30.2672, "lon": -97.7431})
        self.assertEqual(response.status_code, 200)
        mock_coords.assert_called_once_with(30.2672, -97.7431)
        mock_address.assert_not_called()
        self.assertIs(mock_lookup.call_args.args[1], AUSTIN)

    @patch("api.routes.lookup.geocode_coordinates")
    def test_rejects_partial_or_mixed_input(self, mock_coords):
        cases = [
            {"lat": 30.0},
            {"lon": -97.0},
            {"lat": 30.0, "lon": -97.0, "address": "1 Main St"},
            {},
            {"address": "   "},
        ]
        for params in cases:
            with self.subTest(params=params):
                response = self.client.get("/api/lookup", params=params)
                self.assertEqual(response.status_code, 400)
        mock_coords.assert_not_called()

    def test_rejects_out_of_range_coordinates(self):
        for params in ({"lat": 91, "lon": 0}, {"lat": 0, "lon": -181}):
            with self.subTest(params=params):
                response = self.client.get("/api/lookup", params=params)
                self.assertEqual(response.status_code, 422)

    @patch("api.routes.lookup.geocode_coordinates", return_value=None)
    def test_point_outside_us_is_404_with_location_message(self, _coords):
        response = self.client.get("/api/lookup", params={"lat": 51.5, "lon": -0.12})
        self.assertEqual(response.status_code, 404)
        self.assertIn("location", response.json()["detail"])

    @patch("api.routes.lookup.geocode_coordinates", side_effect=CensusUnavailable("down"))
    def test_census_outage_is_502(self, _coords):
        response = self.client.get("/api/lookup", params={"lat": 30.0, "lon": -97.0})
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
