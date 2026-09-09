import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from api.census import _legislative_district, _match_from_payload, _parse_sld_code
from openstates_client import (
    classifications_for_state,
    district_from_role,
    office_from_role,
    official_from_person,
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

    def test_skips_non_legislators(self):
        person = {
            "id": "ocd-person/gov",
            "name": "A Governor",
            "party": "Republican",
            "current_role": {"title": "Governor", "org_classification": "executive"},
        }
        self.assertIsNone(official_from_person(person, "Texas"))

    def test_bicameral_skips_legislature(self):
        self.assertEqual(classifications_for_state("TX"), ("upper", "lower"))
        self.assertEqual(classifications_for_state("Texas"), ("upper", "lower"))

    def test_nebraska_uses_legislature(self):
        self.assertEqual(classifications_for_state("NE"), ("legislature",))
        self.assertEqual(classifications_for_state("Nebraska"), ("legislature",))


class SyncAllStatesTests(unittest.TestCase):
    @patch(
        "openstates_client.STATE_NAME_BY_ABBR",
        {"TX": "Texas", "NE": "Nebraska", "CA": "California"},
    )
    @patch("openstates_client.sync_state_members")
    def test_continues_after_state_failure(self, mock_sync):
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
        self.assertEqual([call.args[0] for call in mock_sync.call_args_list], ["CA", "NE", "TX"])
        self.assertEqual(len(results), 2)
        self.assertEqual({item["state"] for item in results}, {"CA", "TX"})
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["state"], "NE")
        self.assertIn("rate limited", failures[0]["error"])


if __name__ == "__main__":
    unittest.main()
