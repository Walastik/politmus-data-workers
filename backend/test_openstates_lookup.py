import os
import sys
import unittest
from datetime import datetime
from unittest.mock import MagicMock, call, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from api.census import _legislative_district, _match_from_payload, _parse_sld_code
from api.filters import STATE_NAME_BY_ABBR
from api.routes.lookup import _office_roles
from openstates_client import (
    EXCLUDED_JURISDICTIONS,
    TARGET_STATES,
    classifications_for_state,
    district_from_role,
    fetch_state_legislators,
    main,
    mark_state_synced,
    office_from_role,
    official_from_person,
    openstates_get,
    people_classifications_for_state,
    request_with_backoff,
    require_target_state,
    states_due_for_sync,
    sync_all_states,
)


class ParseSldCodeTests(unittest.TestCase):
    def test_strips_leading_zeros(self):
        self.assertEqual(_parse_sld_code("014"), 14)

    def test_rejects_undefined_codes(self):
        self.assertIsNone(_parse_sld_code("ZZZ"))
        self.assertIsNone(_parse_sld_code(""))
        self.assertIsNone(_parse_sld_code("11B"))


class LegislativeDistrictTests(unittest.TestCase):
    def test_reads_census_upper_and_lower_layers(self):
        geographies = {
            "2024 State Legislative Districts - Upper": [
                {
                    "GEOID": "48014",
                    "BASENAME": "14",
                    "SLDU": "014",
                    "NAME": "State Senate District 14",
                }
            ],
            "2024 State Legislative Districts - Lower": [
                {
                    "GEOID": "48049",
                    "SLDL": "049",
                    "BASENAME": "49",
                    "NAME": "State House District 49",
                }
            ],
        }
        self.assertEqual(
            _legislative_district(geographies, "upper"),
            (14, "State Senate District 14"),
        )
        self.assertEqual(
            _legislative_district(geographies, "lower"),
            (49, "State House District 49"),
        )


class CensusMatchTests(unittest.TestCase):
    def test_match_includes_state_legislative_districts(self):
        payload = {
            "result": {
                "addressMatches": [
                    {
                        "matchedAddress": "1100 CONGRESS AVE, AUSTIN, TX, 78701",
                        "addressComponents": {
                            "fromAddress": "1100",
                            "streetName": "CONGRESS",
                            "suffixType": "AVE",
                            "city": "AUSTIN",
                            "state": "TX",
                            "zip": "78701",
                        },
                        "geographies": {
                            "States": [
                                {
                                    "STUSAB": "TX",
                                    "NAME": "Texas",
                                }
                            ],
                            "119th Congressional Districts": [
                                {
                                    "CD119": "37",
                                    "NAME": "Congressional District 37",
                                }
                            ],
                            "2024 State Legislative Districts - Upper": [
                                {
                                    "SLDU": "014",
                                    "NAME": "State Senate District 14",
                                }
                            ],
                            "2024 State Legislative Districts - Lower": [
                                {
                                    "SLDL": "049",
                                    "NAME": "State House District 49",
                                }
                            ],
                        },
                    }
                ]
            }
        }
        match = _match_from_payload(payload)
        self.assertIsNotNone(match)
        self.assertEqual(match.state_abbr, "TX")
        self.assertEqual(match.district, 37)
        self.assertEqual(match.sldu, 14)
        self.assertEqual(match.sldl, 49)
        self.assertEqual(match.sldu_label, "State Senate District 14")
        self.assertEqual(match.sldl_label, "State House District 49")


class OpenStatesMappingTests(unittest.TestCase):
    def test_office_from_chamber(self):
        self.assertEqual(office_from_role({"org_classification": "upper"}), "State Senator")
        self.assertEqual(
            office_from_role({"org_classification": "lower"}), "State Representative"
        )
        self.assertEqual(
            office_from_role({"org_classification": "legislature"}), "State Senator"
        )
        self.assertEqual(
            office_from_role(
                {"org_classification": "executive", "title": "Governor"}
            ),
            "Governor",
        )
        self.assertIsNone(
            office_from_role(
                {
                    "org_classification": "executive",
                    "title": "Lieutenant Governor",
                }
            )
        )

    def test_district_from_role(self):
        self.assertEqual(district_from_role({"district": "15"}), 15)
        self.assertEqual(district_from_role({"district": 15}), 15)
        self.assertIsNone(district_from_role({"district": "11B"}))

    def test_official_from_person(self):
        person = {
            "id": "ocd-person/example",
            "name": "Jane Doe",
            "party": "Democrat",
            "current_role": {
                "title": "Senator",
                "org_classification": "upper",
                "district": "14",
            },
            "offices": [
                {
                    "classification": "capitol",
                    "voice": "512-555-0100",
                    "address": "Capitol Station, Austin, TX",
                }
            ],
            "links": [{"url": "https://senate.example.gov", "note": "homepage"}],
        }
        official = official_from_person(person, "Texas")
        self.assertIsNotNone(official)
        self.assertEqual(official.id, "ocd-person/example")
        self.assertEqual(official.openstates_id, "ocd-person/example")
        self.assertEqual(official.level, "state")
        self.assertEqual(official.state, "Texas")
        self.assertEqual(official.office, "State Senator")
        self.assertEqual(official.district, 14)
        self.assertEqual(official.party, "Democratic")
        self.assertEqual(official.phone, "512-555-0100")
        self.assertEqual(official.website_url, "https://senate.example.gov")
        self.assertTrue(official.current_member)

    def test_maps_governor(self):
        person = {
            "id": "ocd-person/gov",
            "name": "A Governor",
            "party": "Republican",
            "current_role": {
                "title": "Governor",
                "org_classification": "executive",
                "district": "Statewide",
            },
            "offices": [
                {
                    "classification": "capitol",
                    "voice": "512-555-0199",
                    "address": "1100 Congress Ave, Austin, TX",
                }
            ],
            "links": [{"url": "https://gov.example.gov", "note": "official website"}],
        }
        official = official_from_person(person, "Texas")
        self.assertIsNotNone(official)
        self.assertEqual(official.id, "ocd-person/gov")
        self.assertEqual(official.openstates_id, "ocd-person/gov")
        self.assertEqual(official.level, "state")
        self.assertEqual(official.office, "Governor")
        self.assertIsNone(official.district)
        self.assertEqual(official.party, "Republican")
        self.assertEqual(official.phone, "512-555-0199")
        self.assertEqual(official.website_url, "https://gov.example.gov")
        self.assertTrue(official.current_member)

    def test_skips_non_governor_executives(self):
        lieutenant = {
            "id": "ocd-person/ltgov",
            "name": "A Lieutenant Governor",
            "party": "Republican",
            "current_role": {
                "title": "Lieutenant Governor",
                "org_classification": "executive",
            },
        }
        attorney_general = {
            "id": "ocd-person/ag",
            "name": "An Attorney General",
            "party": "Democratic",
            "current_role": {
                "title": "Attorney General",
                "org_classification": "executive",
            },
        }
        self.assertIsNone(official_from_person(lieutenant, "Texas"))
        self.assertIsNone(official_from_person(attorney_general, "Texas"))

    def test_bicameral_skips_legislature(self):
        self.assertEqual(classifications_for_state("TX"), ("upper", "lower"))
        self.assertEqual(classifications_for_state("Texas"), ("upper", "lower"))
        self.assertEqual(
            people_classifications_for_state("TX"),
            ("upper", "lower", "executive"),
        )

    def test_nebraska_uses_legislature(self):
        self.assertEqual(classifications_for_state("NE"), ("legislature",))
        self.assertEqual(classifications_for_state("Nebraska"), ("legislature",))
        self.assertEqual(
            people_classifications_for_state("NE"),
            ("legislature", "executive"),
        )


class FetchPeopleTests(unittest.TestCase):
    @patch("openstates_client.openstates_get")
    def test_requests_executive_after_chambers(self, mock_get):
        mock_get.return_value = {"results": [], "pagination": {"max_page": 1}}
        fetch_state_legislators("TX")
        classifications = [
            call.kwargs["params"]["org_classification"]
            for call in mock_get.call_args_list
        ]
        self.assertEqual(classifications, ["upper", "lower", "executive"])


class LookupRoleTests(unittest.TestCase):
    def test_governor_uses_state_level_without_legislator_roles(self):
        levels, roles = _office_roles("Governor", "state")
        self.assertEqual(levels, ["administrativeArea1"])
        self.assertEqual(roles, [])

    def test_state_legislators_keep_chamber_roles(self):
        self.assertEqual(
            _office_roles("State Senator", "state"),
            (["administrativeArea1"], ["legislatorUpperBody"]),
        )
        self.assertEqual(
            _office_roles("State Representative", "state"),
            (["administrativeArea1"], ["legislatorLowerBody"]),
        )


class TargetStatesTests(unittest.TestCase):
    def test_fifty_standard_states_without_territories(self):
        self.assertEqual(len(TARGET_STATES), 50)
        self.assertEqual(len(set(TARGET_STATES)), 50)
        for abbr in EXCLUDED_JURISDICTIONS:
            self.assertNotIn(abbr, TARGET_STATES)
        expected = [
            abbr
            for abbr in STATE_NAME_BY_ABBR
            if abbr not in EXCLUDED_JURISDICTIONS
        ]
        self.assertEqual(sorted(TARGET_STATES), sorted(expected))

    def test_rejects_dc_and_territories(self):
        for abbr in ("DC", "PR", "GU", "AS", "MP", "VI"):
            with self.assertRaises(ValueError):
                require_target_state(abbr)


class StatesDueForSyncTests(unittest.TestCase):
    @patch("openstates_client.ensure_schema")
    @patch("openstates_client.SessionLocal")
    @patch(
        "openstates_client.TARGET_STATES",
        ["CA", "TX", "NE", "AL", "NY"],
    )
    def test_limit_selects_never_synced_then_oldest(self, mock_session_cls, _schema):
        session = MagicMock()
        mock_session_cls.return_value = session
        now = datetime(2026, 1, 10)
        session.query.return_value.all.return_value = [
            MagicMock(state_code="CA", last_synced_at=now),
            MagicMock(state_code="TX", last_synced_at=datetime(2026, 1, 1)),
            MagicMock(state_code="NE", last_synced_at=datetime(2026, 1, 5)),
        ]

        result = states_due_for_sync(limit=3)

        self.assertEqual(result, ["AL", "NY", "TX"])
        session.close.assert_called_once()

    def test_rejects_non_positive_limit(self):
        with self.assertRaises(ValueError):
            states_due_for_sync(limit=0)

    @patch("openstates_client._utc_now_naive", return_value=datetime(2026, 1, 15, 12, 0, 0))
    def test_mark_state_synced_inserts_and_updates(self, _now):
        session = MagicMock()
        session.get.return_value = None
        mark_state_synced(session, "TX")
        added = session.add.call_args[0][0]
        self.assertEqual(added.state_code, "TX")
        self.assertEqual(added.last_synced_at, datetime(2026, 1, 15, 12, 0, 0))

        existing = MagicMock()
        session.get.return_value = existing
        mark_state_synced(session, "tx")
        self.assertEqual(existing.last_synced_at, datetime(2026, 1, 15, 12, 0, 0))


class RequestBackoffTests(unittest.TestCase):
    @patch("openstates_client.time.sleep")
    @patch("openstates_client.requests.get")
    def test_retries_429_using_retry_after(self, mock_get, mock_sleep):
        limited = MagicMock()
        limited.status_code = 429
        limited.headers = {"Retry-After": "3"}
        ok = MagicMock()
        ok.status_code = 200
        ok.json.return_value = {"ok": True}
        ok.raise_for_status = MagicMock()
        mock_get.side_effect = [limited, ok]

        response = request_with_backoff("https://v3.openstates.org/people")

        self.assertIs(response, ok)
        self.assertEqual(mock_get.call_count, 2)
        self.assertIn(call(3.0), mock_sleep.call_args_list)

    @patch("openstates_client.API_KEY", "test-key")
    @patch("openstates_client.time.sleep")
    @patch("openstates_client.requests.get")
    def test_openstates_get_retries_then_returns_json(self, mock_get, _sleep):
        limited = MagicMock()
        limited.status_code = 429
        limited.headers = {}
        ok = MagicMock()
        ok.status_code = 200
        ok.json.return_value = {"results": []}
        ok.raise_for_status = MagicMock()
        mock_get.side_effect = [limited, ok]

        payload = openstates_get("/people")

        self.assertEqual(payload, {"results": []})
        self.assertEqual(mock_get.call_count, 2)


class SyncAllStatesTests(unittest.TestCase):
    @patch(
        "openstates_client.states_due_for_sync",
        return_value=["CA", "NE", "TX"],
    )
    @patch("openstates_client.sync_state_members")
    def test_continues_after_state_failure(self, mock_sync, _due):
        def fake_sync(state_code):
            if state_code == "NE":
                raise RuntimeError("rate limited")
            return {
                "state": state_code,
                "fetched": 1,
                "saved": 1,
                "skipped": 0,
            }

        mock_sync.side_effect = fake_sync
        results, failures = sync_all_states()
        self.assertEqual(
            [call.args[0] for call in mock_sync.call_args_list],
            ["CA", "NE", "TX"],
        )
        self.assertEqual(len(results), 2)
        self.assertEqual({item["state"] for item in results}, {"CA", "TX"})
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["state"], "NE")
        self.assertIn("rate limited", failures[0]["error"])

    @patch(
        "openstates_client.states_due_for_sync",
        return_value=["AL", "AK", "AZ", "AR", "CA"],
    )
    @patch("openstates_client.sync_state_members")
    def test_limit_syncs_only_selected_states(self, mock_sync, mock_due):
        mock_sync.return_value = {
            "state": "X",
            "fetched": 1,
            "saved": 1,
            "skipped": 0,
        }
        results, failures = sync_all_states(limit=5)
        mock_due.assert_called_once_with(5)
        self.assertEqual(mock_sync.call_count, 5)
        self.assertEqual(len(results), 5)
        self.assertEqual(failures, [])


class OpenStatesCliTests(unittest.TestCase):
    @patch("openstates_client.sync_all_states", return_value=([], []))
    def test_limit_flag_syncs_n_states(self, mock_sync_all):
        with patch.object(
            sys, "argv", ["openstates_client.py", "members", "--limit", "5"]
        ):
            main()
        mock_sync_all.assert_called_once_with(limit=5)


if __name__ == "__main__":
    unittest.main()
