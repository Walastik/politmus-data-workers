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

from datetime import date

from api import census
from api.census import (
    CENSUS_LOCATIONS_URL,
    TIGERWEB_LEGISLATIVE_URL,
    CensusMatch,
    CensusUnavailable,
    _district_layer_ids,
    geocode_address,
    geocode_coordinates,
    sitting_congress,
)
from api.main import app
from api.schemas import CivicLookupOut
from database import get_db

FIXTURES_DIR = Path(__file__).parent / "tests" / "fixtures"


def _fixture(name: str):
    return json.loads((FIXTURES_DIR / name).read_text())


# The TIGERweb Legislative layer list as published in October 2026.
LEGISLATIVE_LAYERS = [
    (0, "120th Congressional Districts"),
    (1, "2026 State Legislative Districts - Upper"),
    (2, "2026 State Legislative Districts - Lower"),
    (3, "BAS 2026"),
    (4, "119th Congressional Districts"),
    (5, "2024 State Legislative Districts - Upper"),
    (6, "2024 State Legislative Districts - Lower"),
    (7, "ACS 2025"),
    (8, "119th Congressional Districts"),
    (9, "2024 State Legislative Districts - Upper"),
    (10, "2024 State Legislative Districts - Lower"),
    (11, "Census 2020"),
    (12, "116th Congressional Districts"),
    (13, "2018 State Legislative Districts - Upper"),
    (14, "2018 State Legislative Districts - Lower"),
    (15, "Voting Districts"),
]

ADDRESS_PAYLOAD = {
    "result": {
        "addressMatches": [
            {
                "matchedAddress": "100 CONGRESS AVE, AUSTIN, TX, 78701",
                "coordinates": {"x": -97.7431, "y": 30.2672},
                "addressComponents": {"state": "TX", "city": "AUSTIN", "zip": "78701"},
            }
        ]
    }
}


def _fake_census(identify_payload):
    """A stand-in for _get_json that answers the geocoder, the layer list and identify."""
    calls = []

    def get_json(url, params, service):
        calls.append((url, params))
        if url == CENSUS_LOCATIONS_URL:
            return ADDRESS_PAYLOAD
        if url == TIGERWEB_LEGISLATIVE_URL:
            return {"layers": [{"id": i, "name": n} for i, n in LEGISLATIVE_LAYERS]}
        if url == f"{TIGERWEB_LEGISLATIVE_URL}/identify":
            return identify_payload
        raise AssertionError(f"unexpected url {url}")

    return get_json, calls


class SittingCongressTests(unittest.TestCase):
    def test_new_congress_is_seated_january_3_of_odd_years(self):
        self.assertEqual(sitting_congress(date(2025, 1, 2)), 118)
        self.assertEqual(sitting_congress(date(2025, 1, 3)), 119)
        self.assertEqual(sitting_congress(date(2026, 10, 28)), 119)
        self.assertEqual(sitting_congress(date(2026, 12, 31)), 119)
        self.assertEqual(sitting_congress(date(2027, 1, 2)), 119)
        self.assertEqual(sitting_congress(date(2027, 1, 3)), 120)


class DistrictLayerTests(unittest.TestCase):
    def test_119th_congress_uses_its_maps_not_the_next_ones(self):
        self.assertEqual(_district_layer_ids(LEGISLATIVE_LAYERS, 119), [4, 5, 6])

    def test_switches_to_120th_maps_when_it_is_seated(self):
        self.assertEqual(_district_layer_ids(LEGISLATIVE_LAYERS, 120), [0, 1, 2])

    def test_falls_back_to_latest_published_maps(self):
        # Census has not published 121st Congress districts yet.
        self.assertEqual(_district_layer_ids(LEGISLATIVE_LAYERS, 121), [0, 1, 2])

    def test_no_usable_layer_is_unavailable(self):
        with self.assertRaises(CensusUnavailable):
            _district_layer_ids([(3, "BAS 2026")], 119)


@patch("api.census.sitting_congress", return_value=119)
class GeocodeTests(unittest.TestCase):
    def setUp(self):
        census._layer_cache = None

    def test_coordinates_read_live_tigerweb_districts(self, _congress):
        get_json, calls = _fake_census(_fixture("tigerweb_identify_austin.json"))
        with patch("api.census._get_json", side_effect=get_json):
            match = geocode_coordinates(30.2672, -97.7431)

        self.assertEqual(match.state_abbr, "TX")
        self.assertEqual(match.state_name, "Texas")
        # Downtown Austin is TX-37 on the 119th map (TX-10 on the 120th).
        self.assertEqual(match.district, 37)
        self.assertEqual(match.sldu, 14)
        self.assertEqual(match.sldl, 49)
        self.assertIsNone(match.line1)
        self.assertEqual((match.latitude, match.longitude), (30.2672, -97.7431))
        identify_params = calls[-1][1]
        self.assertEqual(identify_params["geometry"], "-97.7431,30.2672")
        self.assertEqual(identify_params["layers"], "all:4,5,6")

    def test_address_geocodes_then_reads_districts_at_that_point(self, _congress):
        get_json, calls = _fake_census(_fixture("tigerweb_identify_austin.json"))
        with patch("api.census._get_json", side_effect=get_json):
            match = geocode_address("100 Congress Ave, Austin, TX")

        self.assertEqual(calls[0][0], CENSUS_LOCATIONS_URL)
        self.assertEqual(calls[0][1]["address"], "100 Congress Ave, Austin, TX")
        self.assertEqual((match.state_abbr, match.district), ("TX", 37))
        self.assertEqual(match.city, "AUSTIN")
        self.assertEqual((match.latitude, match.longitude), (30.2672, -97.7431))

    def test_unmatched_address_skips_tigerweb(self, _congress):
        no_match = {"result": {"addressMatches": []}}
        with patch("api.census._get_json", return_value=no_match) as mock_get:
            self.assertIsNone(geocode_address("nowhere"))
        mock_get.assert_called_once()

    def test_dc_delegate_district_maps_to_zero(self, _congress):
        identify = {
            "results": [
                {
                    "layerName": "119th Congressional Districts",
                    "attributes": {
                        "CD119": "98",
                        "CDSESSN": "119",
                        "GEOID": "1198",
                        "NAME": "Delegate District (at Large)",
                        "STATE": "11",
                    },
                }
            ]
        }
        get_json, _ = _fake_census(identify)
        with patch("api.census._get_json", side_effect=get_json):
            match = geocode_coordinates(38.8977, -77.0365)
        self.assertEqual((match.state_abbr, match.district), ("DC", 0))

    def test_point_outside_us_returns_none(self, _congress):
        get_json, _ = _fake_census({"results": []})
        with patch("api.census._get_json", side_effect=get_json):
            self.assertIsNone(geocode_coordinates(30.0, -40.0))

    def test_layer_list_is_cached(self, _congress):
        get_json, calls = _fake_census({"results": []})
        with patch("api.census._get_json", side_effect=get_json):
            geocode_coordinates(30.0, -40.0)
            geocode_coordinates(30.0, -40.0)
        layer_list_calls = [url for url, _ in calls if url == TIGERWEB_LEGISLATIVE_URL]
        self.assertEqual(len(layer_list_calls), 1)

    @patch("api.census.httpx.Client")
    def test_unreachable_census_is_unavailable(self, mock_client_cls, _congress):
        client = mock_client_cls.return_value.__enter__.return_value
        client.get.side_effect = httpx.ConnectError("down")
        with self.assertRaises(CensusUnavailable):
            geocode_coordinates(30.0, -97.0)

    @patch("api.census.httpx.Client")
    def test_arcgis_error_in_200_is_unavailable(self, mock_client_cls, _congress):
        response = MagicMock(status_code=200)
        response.json.return_value = {"error": {"code": 500, "message": "Service down"}}
        mock_client_cls.return_value.__enter__.return_value.get.return_value = response
        with self.assertRaisesRegex(CensusUnavailable, "Service down"):
            geocode_coordinates(30.0, -97.0)


AUSTIN = CensusMatch(
    line1=None,
    city=None,
    state_abbr="TX",
    state_name="Texas",
    zip=None,
    district=37,
    district_label="Congressional District 37",
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
        with self.assertLogs("api.routes.lookup", level="WARNING") as logs:
            response = self.client.get("/api/lookup", params={"lat": 30.0, "lon": -97.0})
        self.assertEqual(response.status_code, 502)
        self.assertIn("try again", response.json()["detail"])
        self.assertIn("down", logs.output[0])


if __name__ == "__main__":
    unittest.main()
