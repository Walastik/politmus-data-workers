import os
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from congress_client import (
    bill_id_from_senate_issue,
    last_name_from_official_name,
    map_senate_document_type,
    normalize_position,
    parse_senate_vote_date,
    parse_senate_vote_menu,
    parse_senate_vote_xml,
    senate_document_to_bill_id,
    senate_menu_has_legislation,
    senate_vote_menu_url,
    senate_vote_url,
    _positions_from_senate_members,
    senator_lookup_key,
)


SAMPLE_SENATE_VOTE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<roll_call_vote>
  <congress>119</congress>
  <session>1</session>
  <vote_number>1</vote_number>
  <vote_date>January 9, 2025,  02:54 PM</vote_date>
  <document>
    <document_congress>119</document_congress>
    <document_type>S.</document_type>
    <document_number>5</document_number>
    <document_name>S. 5</document_name>
    <document_title>A bill to require the Secretary of Homeland Security to take into custody aliens who have been charged in the United States with theft, and for other purposes.</document_title>
  </document>
  <members>
    <member>
      <last_name>Cruz</last_name>
      <first_name>Ted</first_name>
      <state>TX</state>
      <vote_cast>Yea</vote_cast>
    </member>
    <member>
      <last_name>Cornyn</last_name>
      <first_name>John</first_name>
      <state>TX</state>
      <vote_cast>Nay</vote_cast>
    </member>
    <member>
      <last_name>Scott</last_name>
      <first_name>Rick</first_name>
      <state>FL</state>
      <vote_cast>Not Voting</vote_cast>
    </member>
    <member>
      <last_name>Blunt Rochester</last_name>
      <first_name>Lisa</first_name>
      <state>DE</state>
      <vote_cast>Present</vote_cast>
    </member>
  </members>
</roll_call_vote>
"""

SAMPLE_AMENDMENT_VOTE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<roll_call_vote>
  <congress>119</congress>
  <session>1</session>
  <vote_number>567</vote_number>
  <document>
    <document_type>S.Amdt.</document_type>
    <document_number/>
    <document_name/>
  </document>
  <amendment>
    <amendment_number>S.Amdt. 3210</amendment_number>
    <amendment_to_document_number>S. 2296</amendment_to_document_number>
  </amendment>
  <members>
    <member>
      <last_name>Warren</last_name>
      <state>MA</state>
      <vote_cast>Yea</vote_cast>
    </member>
  </members>
</roll_call_vote>
"""

SAMPLE_NOMINATION_VOTE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<roll_call_vote>
  <congress>119</congress>
  <session>1</session>
  <vote_number>659</vote_number>
  <document>
    <document_type>PN</document_type>
    <document_number>373</document_number>
    <document_name>PN373</document_name>
  </document>
  <members></members>
</roll_call_vote>
"""

SAMPLE_VOTE_MENU_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<vote_summary>
  <congress>119</congress>
  <session>1</session>
  <votes>
    <vote>
      <vote_number>00003</vote_number>
      <issue>PN12-1</issue>
    </vote>
    <vote>
      <vote_number>00002</vote_number>
      <issue>H.R. 1</issue>
    </vote>
    <vote>
      <vote_number>00001</vote_number>
      <issue>S. 5</issue>
    </vote>
    <vote>
      <vote_number>00004</vote_number>
      <en_bloc>
        <matter><issue>PN416-9</issue></matter>
        <matter><issue>PN141-12</issue></matter>
      </en_bloc>
    </vote>
    <vote>
      <vote_number>00005</vote_number>
    </vote>
  </votes>
</vote_summary>
"""


class SenateUrlTests(unittest.TestCase):
    def test_pads_vote_number_to_five_digits(self):
        self.assertEqual(
            senate_vote_url(119, 1, 1),
            "https://www.senate.gov/legislative/LIS/roll_call_votes/"
            "vote1191/vote_119_1_00001.xml",
        )

    def test_accepts_already_padded_number(self):
        self.assertEqual(
            senate_vote_url(119, 1, "00012"),
            "https://www.senate.gov/legislative/LIS/roll_call_votes/"
            "vote1191/vote_119_1_00012.xml",
        )


class SenateDocumentMappingTests(unittest.TestCase):
    def test_maps_common_document_types(self):
        self.assertEqual(map_senate_document_type("S."), "s")
        self.assertEqual(map_senate_document_type("H.R."), "hr")
        self.assertEqual(map_senate_document_type("S.J.Res."), "sjres")
        self.assertIsNone(map_senate_document_type("PN"))
        self.assertIsNone(map_senate_document_type("S.Amdt."))

    def test_builds_bill_id(self):
        self.assertEqual(senate_document_to_bill_id(119, "S.", 5), "119-s-5")
        self.assertEqual(senate_document_to_bill_id(119, "H.R.", "1"), "119-hr-1")
        self.assertIsNone(senate_document_to_bill_id(119, "PN", "373"))

    def test_parses_issue_labels(self):
        self.assertEqual(bill_id_from_senate_issue(119, "S. 2296"), "119-s-2296")
        self.assertEqual(bill_id_from_senate_issue(119, "H.R. 1"), "119-hr-1")
        self.assertIsNone(bill_id_from_senate_issue(119, "PN373"))


class SenateXmlParseTests(unittest.TestCase):
    def test_parses_bill_members_and_date(self):
        parsed = parse_senate_vote_xml(SAMPLE_SENATE_VOTE_XML)
        self.assertEqual(parsed["bill_id"], "119-s-5")
        self.assertEqual(parsed["vote_date"], date(2025, 1, 9))
        self.assertIn("custody", (parsed["bill_title"] or "").lower())
        self.assertEqual(len(parsed["members"]), 4)
        self.assertEqual(parsed["members"][0]["last_name"], "Cruz")
        self.assertEqual(parsed["members"][0]["state"], "TX")
        self.assertEqual(parsed["members"][0]["vote_cast"], "Yea")

    def test_amendment_falls_back_to_underlying_bill(self):
        parsed = parse_senate_vote_xml(SAMPLE_AMENDMENT_VOTE_XML)
        self.assertEqual(parsed["bill_id"], "119-s-2296")

    def test_nominations_have_no_bill_id(self):
        parsed = parse_senate_vote_xml(SAMPLE_NOMINATION_VOTE_XML)
        self.assertIsNone(parsed["bill_id"])


class SenatorMatchTests(unittest.TestCase):
    def test_last_name_from_inverted_congress_name(self):
        self.assertEqual(last_name_from_official_name("Cruz, Ted"), "Cruz")
        self.assertEqual(
            last_name_from_official_name("Blunt Rochester, Lisa"),
            "Blunt Rochester",
        )
        self.assertEqual(last_name_from_official_name("Van Hollen, Chris"), "Van Hollen")

    def test_lookup_key_maps_postal_code_to_full_state_name(self):
        xml_key = senator_lookup_key("Cruz", "TX")
        official_key = senator_lookup_key("Cruz", "Texas")
        self.assertEqual(xml_key, ("cruz", "texas"))
        self.assertEqual(xml_key, official_key)

    def test_maps_members_to_official_ids(self):
        lookup = {
            senator_lookup_key("Cruz", "TX"): "C001098",
            senator_lookup_key("Cornyn", "TX"): "C001056",
            senator_lookup_key("Scott", "FL"): "S001217",
            senator_lookup_key("Blunt Rochester", "DE"): "B001316",
        }
        parsed = parse_senate_vote_xml(SAMPLE_SENATE_VOTE_XML)
        positions, unknown = _positions_from_senate_members(parsed["members"], lookup)
        self.assertEqual(unknown, [])
        self.assertEqual(
            positions,
            {
                "C001098": "Yes",
                "C001056": "No",
                "S001217": "Not Voting",
                "B001316": "Present",
            },
        )

    def test_unknown_senator_is_skipped(self):
        parsed = parse_senate_vote_xml(SAMPLE_SENATE_VOTE_XML)
        positions, unknown = _positions_from_senate_members(parsed["members"], {})
        self.assertEqual(positions, {})
        self.assertEqual(len(unknown), 4)


class PositionAndDateTests(unittest.TestCase):
    def test_normalizes_senate_vote_cast(self):
        self.assertEqual(normalize_position("Yea"), "Yes")
        self.assertEqual(normalize_position("Nay"), "No")
        self.assertEqual(normalize_position("Present"), "Present")
        self.assertEqual(normalize_position("Not Voting"), "Not Voting")

    def test_parses_senate_vote_date(self):
        self.assertEqual(
            parse_senate_vote_date("January 9, 2025,  02:54 PM"),
            date(2025, 1, 9),
        )


class SyncSenateVotesTests(unittest.TestCase):
    @patch("congress_client.fetch_senate_vote_xml", return_value=SAMPLE_SENATE_VOTE_XML)
    def test_upserts_by_official_and_bill(self, _mock_fetch):
        from congress_client import sync_senate_votes
        from models import Bill, SenateRollCall, Vote

        bill = Bill(id="119-s-5", title="Test")
        existing = Vote(bill_id="119-s-5", official_id="C001098", position="No")
        session = MagicMock()
        session.get.return_value = bill
        session.query.return_value.filter_by.return_value.all.return_value = [existing]

        lookup = {
            senator_lookup_key("Cruz", "TX"): "C001098",
            senator_lookup_key("Cornyn", "TX"): "C001056",
            senator_lookup_key("Scott", "FL"): "S001217",
            senator_lookup_key("Blunt Rochester", "DE"): "B001316",
        }
        stats = sync_senate_votes(
            119, 1, 1, db_session=session, senator_lookup=lookup, roll_calls={}
        )

        self.assertEqual(stats["bill_id"], "119-s-5")
        self.assertEqual(stats["inserted"], 3)
        self.assertEqual(stats["updated"], 1)
        self.assertEqual(stats["unchanged"], 0)
        added = [call.args[0] for call in session.add.call_args_list]
        self.assertEqual(sum(1 for obj in added if isinstance(obj, Vote)), 3)
        self.assertEqual(sum(1 for obj in added if isinstance(obj, SenateRollCall)), 1)
        self.assertEqual(existing.position, "Yes")
        session.commit.assert_not_called()


class SenateVoteMenuTests(unittest.TestCase):
    def test_menu_url(self):
        self.assertEqual(
            senate_vote_menu_url(119, 1),
            "https://www.senate.gov/legislative/LIS/roll_call_lists/"
            "vote_menu_119_1.xml",
        )

    def test_parses_oldest_first_and_classifies_issues(self):
        parsed = parse_senate_vote_menu(SAMPLE_VOTE_MENU_XML)
        self.assertEqual([row["vote_number"] for row in parsed["votes"]], [1, 2, 3, 4, 5])
        by_number = {row["vote_number"]: row for row in parsed["votes"]}
        self.assertEqual(by_number[1]["bill_ids"], ["119-s-5"])
        self.assertEqual(by_number[2]["bill_ids"], ["119-hr-1"])
        self.assertEqual(by_number[3]["bill_ids"], [])
        self.assertEqual(by_number[4]["issues"], ["PN416-9", "PN141-12"])
        self.assertEqual(by_number[5]["issues"], [])

    def test_skips_nominations_but_keeps_amendments_and_bills(self):
        parsed = parse_senate_vote_menu(SAMPLE_VOTE_MENU_XML)
        keep = [
            row["vote_number"]
            for row in parsed["votes"]
            if senate_menu_has_legislation(row["issues"], 119)
        ]
        self.assertEqual(keep, [1, 2, 5])


class SyncSenateSessionVotesTests(unittest.TestCase):
    @patch("congress_client.sync_senate_votes")
    @patch("congress_client.fetch_senate_vote_menu", return_value=SAMPLE_VOTE_MENU_XML)
    def test_fetches_legislation_for_known_bills_and_unknown_issues(
        self, _mock_menu, mock_sync
    ):
        from congress_client import sync_senate_session_votes

        mock_sync.return_value = {
            "inserted": 1,
            "updated": 0,
            "unchanged": 0,
            "skipped_unknown_officials": 0,
            "not_found": False,
            "skipped_no_bill": False,
        }
        session = MagicMock()
        stats = sync_senate_session_votes(
            119,
            1,
            db_session=session,
            senator_lookup={},
            bill_ids={"119-s-5"},
            roll_calls={},
        )

        fetched_numbers = [call.args[2] for call in mock_sync.call_args_list]
        # Legislation is fetched even when the bill is not already in Postgres.
        # Nominations are skipped. Empty issue (amendment) is still fetched.
        self.assertEqual(fetched_numbers, [1, 2, 5])
        self.assertEqual(stats["skipped_nominations"], 2)
        self.assertEqual(stats["skipped_no_bill"], 0)
        self.assertEqual(stats["fetched"], 3)
        self.assertEqual(stats["inserted"], 3)
        session.commit.assert_not_called()

    @patch("congress_client.sync_senate_votes")
    @patch("congress_client.fetch_senate_vote_menu", return_value=SAMPLE_VOTE_MENU_XML)
    def test_skips_already_ingested_and_retries_skipped_no_bill(
        self, _mock_menu, mock_sync
    ):
        from types import SimpleNamespace

        from congress_client import (
            SENATE_ROLL_CALL_INGESTED,
            SENATE_ROLL_CALL_SKIPPED_NO_BILL,
            senate_roll_call_key,
            sync_senate_session_votes,
        )

        mock_sync.return_value = {
            "inserted": 1,
            "updated": 0,
            "unchanged": 0,
            "skipped_unknown_officials": 0,
            "not_found": False,
            "skipped_no_bill": False,
        }
        roll_calls = {
            senate_roll_call_key(119, 1, 1): SimpleNamespace(
                status=SENATE_ROLL_CALL_INGESTED, bill_id="119-s-5"
            ),
            senate_roll_call_key(119, 1, 2): SimpleNamespace(
                status=SENATE_ROLL_CALL_SKIPPED_NO_BILL, bill_id="119-hr-1"
            ),
        }
        stats = sync_senate_session_votes(
            119,
            1,
            db_session=MagicMock(),
            senator_lookup={},
            bill_ids={"119-s-5", "119-hr-1"},
            roll_calls=roll_calls,
        )
        fetched_numbers = [call.args[2] for call in mock_sync.call_args_list]
        self.assertEqual(fetched_numbers, [2, 5])
        self.assertEqual(stats["already_done"], 1)


class EnsureSenateBillTests(unittest.TestCase):
    def test_creates_stub_when_missing(self):
        from congress_client import ensure_bill_from_senate_vote
        from models import Bill

        created_bill = Bill(id="119-s-5", title="From Senate")
        session = MagicMock()
        session.get.side_effect = [None, None, created_bill]
        bill, created = ensure_bill_from_senate_vote(
            session, "119-s-5", "From Senate", voted_date=date(2025, 1, 9)
        )
        self.assertTrue(created)
        self.assertEqual(bill.id, "119-s-5")
        session.merge.assert_called_once()

    def test_leaves_existing_bill_in_place(self):
        from congress_client import ensure_bill_from_senate_vote
        from models import Bill

        existing = Bill(id="119-hr-1", title="One Big Beautiful Bill Act")
        session = MagicMock()
        session.get.return_value = existing
        bill, created = ensure_bill_from_senate_vote(
            session, "119-hr-1", "A different title"
        )
        self.assertFalse(created)
        self.assertEqual(bill.title, "One Big Beautiful Bill Act")
        session.merge.assert_not_called()


class CosponsorPartisanshipTests(unittest.TestCase):
    def test_maps_congress_party_codes(self):
        from congress_client import _party_name_from_code

        self.assertEqual(_party_name_from_code("D"), "Democratic")
        self.assertEqual(_party_name_from_code("R"), "Republican")
        self.assertEqual(_party_name_from_code("I"), "Independent")
        self.assertEqual(_party_name_from_code("ID"), "Independent")
        self.assertEqual(_party_name_from_code("L"), "Libertarian")
        self.assertEqual(_party_name_from_code("Democratic"), "Democratic")
        self.assertIsNone(_party_name_from_code(None))
        self.assertIsNone(_party_name_from_code("  "))

    def test_counts_current_cosponsors_and_skips_withdrawn(self):
        from congress_client import _cosponsor_party_breakdown

        breakdown = _cosponsor_party_breakdown(
            [
                {"party": "D"},
                {"party": "D"},
                {"party": "R"},
                {"party": "I"},
                {"party": "D", "sponsorshipWithdrawnDate": "2025-02-01"},
                {"party": None},
            ]
        )
        self.assertEqual(
            breakdown,
            {"Democratic": 2, "Independent": 1, "Republican": 1},
        )

    def test_empty_cosponsor_list_is_empty_breakdown(self):
        from congress_client import _cosponsor_party_breakdown

        self.assertEqual(_cosponsor_party_breakdown([]), {})
        self.assertEqual(_cosponsor_party_breakdown(None), {})

    def test_classifies_single_party_bipartisan_and_tripartisan(self):
        from congress_client import classify_bipartisan_type

        self.assertEqual(
            classify_bipartisan_type("Democratic", {}),
            "single_party",
        )
        self.assertEqual(
            classify_bipartisan_type("Democratic", {"Republican": 3}),
            "bipartisan",
        )
        self.assertEqual(
            classify_bipartisan_type(
                "Democratic",
                {"Democratic": 12, "Republican": 3},
            ),
            "bipartisan",
        )
        self.assertEqual(
            classify_bipartisan_type(
                "Democratic",
                {"Democratic": 10, "Independent": 1},
            ),
            "bipartisan",
        )
        self.assertEqual(
            classify_bipartisan_type(
                "Republican",
                {"Independent": 1},
            ),
            "bipartisan",
        )
        self.assertEqual(
            classify_bipartisan_type(
                "Democratic",
                {"Democratic": 10, "Republican": 2, "Independent": 1},
            ),
            "tripartisan",
        )
        self.assertIsNone(classify_bipartisan_type(None, {}))
        self.assertIsNone(classify_bipartisan_type(None, None))

    def test_sponsorship_fields_combine_sponsor_and_cosponsors(self):
        from congress_client import _sponsorship_fields

        sponsor_party, breakdown, bipartisan_type = _sponsorship_fields(
            {"sponsors": [{"party": "R", "fullName": "Rep. Example"}]},
            [{"party": "D"}, {"party": "D"}, {"party": "R"}],
        )
        self.assertEqual(sponsor_party, "Republican")
        self.assertEqual(breakdown, {"Democratic": 2, "Republican": 1})
        self.assertEqual(bipartisan_type, "bipartisan")

    @patch("congress_client.congress_get")
    def test_fetch_bill_cosponsors_follows_pagination(self, mock_get):
        from congress_client import fetch_bill_cosponsors

        mock_get.side_effect = [
            {
                "cosponsors": [{"party": "D"}],
                "pagination": {"next": "https://api.congress.gov/v3/next"},
            },
            {
                "cosponsors": [{"party": "R"}],
                "pagination": {},
            },
        ]
        cosponsors = fetch_bill_cosponsors(119, "hr", 1)
        self.assertEqual(len(cosponsors), 2)
        self.assertEqual(mock_get.call_count, 2)
        first_url = mock_get.call_args_list[0].args[0]
        self.assertIn("/bill/119/hr/1/cosponsors", first_url)

    @patch("congress_client.fetch_bill_cosponsors")
    def test_load_sponsorship_fields_records_counts(self, mock_fetch):
        from congress_client import _load_sponsorship_fields

        mock_fetch.return_value = [{"party": "D"}, {"party": "R"}]
        sponsor_party, breakdown, bipartisan_type = _load_sponsorship_fields(
            119,
            "hr",
            1,
            {"sponsors": [{"party": "D"}]},
        )
        self.assertEqual(sponsor_party, "Democratic")
        self.assertEqual(breakdown, {"Democratic": 1, "Republican": 1})
        self.assertEqual(bipartisan_type, "bipartisan")
        mock_fetch.assert_called_once_with(119, "hr", 1)

    @patch("congress_client.fetch_bill_cosponsors")
    def test_load_sponsorship_fields_keeps_sponsor_when_fetch_fails(
        self, mock_fetch
    ):
        from congress_client import _load_sponsorship_fields

        mock_fetch.side_effect = RuntimeError("rate limited")
        sponsor_party, breakdown, bipartisan_type = _load_sponsorship_fields(
            119,
            "s",
            5,
            {"sponsors": [{"party": "R"}]},
        )
        self.assertEqual(sponsor_party, "Republican")
        self.assertIsNone(breakdown)
        self.assertIsNone(bipartisan_type)


if __name__ == "__main__":
    unittest.main()
