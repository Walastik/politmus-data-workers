import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from congress_client import (
    bill_id_from_senate_issue,
    last_name_from_official_name,
    make_source_roll_call_id,
    map_senate_document_type,
    normalize_position,
    parse_senate_vote_date,
    parse_senate_vote_menu,
    parse_senate_vote_xml,
    senate_document_to_bill_id,
    senate_menu_has_legislation,
    senate_vote_menu_url,
    senate_vote_url,
    _house_roll_call_metadata,
    fetch_recent_bills,
    _positions_from_senate_members,
    senator_lookup_key,
)


SAMPLE_SENATE_VOTE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<roll_call_vote>
  <congress>119</congress>
  <session>1</session>
  <vote_number>1</vote_number>
  <vote_date>January 9, 2025,  02:54 PM</vote_date>
  <vote_question_text>On Cloture on the Motion to Proceed S. 5</vote_question_text>
  <vote_result>Cloture on the Motion to Proceed Agreed to</vote_result>
  <majority_requirement>3/5</majority_requirement>
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
        self.assertEqual(
            parsed["question"],
            "On Cloture on the Motion to Proceed S. 5",
        )
        self.assertEqual(
            parsed["result"],
            "Cloture on the Motion to Proceed Agreed to",
        )
        self.assertEqual(parsed["requires"], "3/5")

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


GARCIA_DETAIL = {
    "directOrderName": 'Jesús G. "Chuy" García',
    "firstName": "Jesús",
    "middleName": 'G. "Chuy"',
    "lastName": "García",
    "nickName": "Chuy",
    "honorificName": "Mr.",
}


class NamePartsTests(unittest.TestCase):
    def test_reads_every_part_congress_gives(self):
        from congress_client import _name_parts_from_member

        self.assertEqual(
            _name_parts_from_member({**GARCIA_DETAIL, "suffixName": "Jr."}),
            {
                "first_name": "Jesús",
                "middle_name": 'G. "Chuy"',
                "last_name": "García",
                "suffix_name": "Jr.",
                "nickname": "Chuy",
                "honorific_name": "Mr.",
            },
        )

    def test_list_payload_has_no_parts(self):
        from congress_client import _name_parts_from_member

        listing = {"bioguideId": "A000370", "name": "Adams, Alma S.", "state": "North Carolina"}
        self.assertEqual(set(_name_parts_from_member(listing).values()), {None})

    def test_official_keeps_inverted_name_and_builds_display_name(self):
        from congress_client import _combine_member_payloads, official_from_member

        listing = {"bioguideId": "A000370", "name": "Adams, Alma S.", "state": "North Carolina"}
        detail = {"firstName": "Alma", "middleName": "S.", "lastName": "Adams"}
        official = official_from_member(_combine_member_payloads(listing, detail))
        self.assertEqual(official.name, "Adams, Alma S.")
        self.assertEqual(
            (official.first_name, official.middle_name, official.last_name),
            ("Alma", "S.", "Adams"),
        )
        self.assertEqual(official.display_name, "Alma S. Adams")

    def test_display_name_formats(self):
        from models import Official

        bishop = Official(
            name="Bishop, Sanford D.", first_name="Sanford", middle_name="D.",
            last_name="Bishop", suffix_name="Jr.",
        )
        self.assertEqual(bishop.display_name, "Sanford D. Bishop Jr.")
        cruz = Official(name="Cruz, Ted", first_name="Ted", last_name="Cruz")
        self.assertEqual(cruz.display_name, "Ted Cruz")
        not_backfilled = Official(name="Adams, Alma S.")
        self.assertEqual(not_backfilled.display_name, "Adams, Alma S.")

    def test_upsert_keeps_stored_parts_when_incoming_has_none(self):
        from congress_client import upsert_official
        from models import Official

        existing = Official(id="A000370", name="Adams, Alma S.", first_name="Alma",
                            middle_name="S.", last_name="Adams")
        session = MagicMock()
        session.get.return_value = existing
        upsert_official(session, Official(id="A000370", name="Adams, Alma S."))
        self.assertEqual(existing.display_name, "Alma S. Adams")

    def test_upsert_replaces_parts_together(self):
        from congress_client import upsert_official
        from models import Official

        existing = Official(id="A000370", name="Adams, Alma S.", first_name="Alma",
                            middle_name="S.", last_name="Adams")
        session = MagicMock()
        session.get.return_value = existing
        upsert_official(
            session,
            Official(id="A000370", name="Adams, Alma", first_name="Alma", last_name="Adams"),
        )
        self.assertIsNone(existing.middle_name)
        self.assertEqual(existing.display_name, "Alma Adams")

    @patch("congress_client._require_api_key")
    @patch("congress_client.ensure_schema")
    @patch("congress_client.fetch_member")
    @patch("congress_client.SessionLocal")
    def test_backfill_fills_missing_name_parts(
        self, mock_session_local, mock_fetch, _ensure, _require_key
    ):
        import requests
        from congress_client import backfill_name_parts
        from models import Official

        garcia = Official(id="G000586", name='García, Jesús G. "Chuy"')
        gone = Official(id="X000001", name="Gone, Former")
        session = MagicMock()
        session.query.return_value.filter.return_value.filter.return_value.all.return_value = [
            garcia,
            gone,
        ]
        mock_session_local.return_value = session

        def fetch(bioguide_id):
            if bioguide_id == "X000001":
                raise requests.HTTPError("404")
            return GARCIA_DETAIL

        mock_fetch.side_effect = fetch
        stats = backfill_name_parts()

        self.assertEqual(stats, {"missing": 2, "filled": 1, "failed": 1})
        self.assertEqual(garcia.nickname, "Chuy")
        self.assertEqual(garcia.honorific_name, "Mr.")
        self.assertEqual(garcia.display_name, 'Jesús G. "Chuy" García')
        self.assertIsNone(gone.last_name)
        session.commit.assert_called_once()


class MemberPhotoTests(unittest.TestCase):
    def test_reads_depiction_url_and_attribution(self):
        from congress_client import official_from_member

        official = official_from_member({
            "bioguideId": "S000033",
            "depiction": {
                "imageUrl": "https://www.congress.gov/img/member/s000033_200.jpg",
                "attribution": "Image courtesy of the Member",
            },
        })
        self.assertEqual(
            official.photo_url, "https://www.congress.gov/img/member/s000033_200.jpg"
        )
        self.assertEqual(official.photo_attribution, "Image courtesy of the Member")

    def test_protocol_relative_url_becomes_https(self):
        from congress_client import _photo_from_member

        url, attribution = _photo_from_member(
            {"depiction": {"imageUrl": "//www.congress.gov/img/member/a000370_200.jpg"}}
        )
        self.assertEqual(url, "https://www.congress.gov/img/member/a000370_200.jpg")
        self.assertIsNone(attribution)

    def test_attribution_html_is_reduced_to_text(self):
        from congress_client import _photo_from_member

        _, attribution = _photo_from_member({"depiction": {
            "imageUrl": "https://www.congress.gov/img/member/s000033_200.jpg",
            "attribution": '<a href="http://www.senate.gov/x.htm">Courtesy U.S. Senate Historical Office</a>',
        }})
        self.assertEqual(attribution, "Courtesy U.S. Senate Historical Office")

    def test_missing_or_empty_depiction_has_no_photo(self):
        from congress_client import _photo_from_member

        self.assertEqual(_photo_from_member({}), (None, None))
        self.assertEqual(_photo_from_member({"depiction": None}), (None, None))
        self.assertEqual(
            _photo_from_member({"depiction": {"imageUrl": "", "attribution": "x"}}),
            (None, None),
        )

    def test_upsert_keeps_stored_photo_when_incoming_has_none(self):
        from congress_client import upsert_official
        from models import Official

        existing = Official(id="A000370", name="Adams, Alma S.",
                            photo_url="https://example.test/a.jpg", photo_attribution="Credit")
        session = MagicMock()
        session.get.return_value = existing
        upsert_official(session, Official(id="A000370", name="Adams, Alma S."))
        self.assertEqual(existing.photo_url, "https://example.test/a.jpg")
        self.assertEqual(existing.photo_attribution, "Credit")

    def test_upsert_replaces_photo_and_credit_together(self):
        from congress_client import upsert_official
        from models import Official

        existing = Official(id="A000370", name="Adams, Alma S.",
                            photo_url="https://example.test/a.jpg", photo_attribution="Credit")
        session = MagicMock()
        session.get.return_value = existing
        upsert_official(
            session,
            Official(id="A000370", name="Adams, Alma S.", photo_url="https://example.test/b.jpg"),
        )
        self.assertEqual(existing.photo_url, "https://example.test/b.jpg")
        self.assertIsNone(existing.photo_attribution)


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


def _senate_response(status, content=b"<xml/>"):
    import requests

    response = requests.Response()
    response.status_code = status
    response._content = content
    response.url = "https://www.senate.gov/x.xml"
    return response


@patch("congress_client.SENATE_REQUEST_PAUSE_SECONDS", 0)
class SenateGetProxyTests(unittest.TestCase):
    PROXY = "http://user:pass@proxy.example:8080"

    def setUp(self):
        patcher = patch("congress_client._senate_direct_blocked", False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _proxies(self, mock_get):
        return [call.kwargs["proxies"] for call in mock_get.call_args_list]

    @patch("congress_client.requests.get")
    def test_goes_direct_while_not_blocked(self, mock_get):
        from congress_client import senate_get

        mock_get.return_value = _senate_response(200)
        with patch.dict(os.environ, {"SENATE_PROXY_URL": self.PROXY}):
            self.assertEqual(senate_get("https://www.senate.gov/x.xml"), b"<xml/>")
        self.assertEqual(self._proxies(mock_get), [None])

    @patch("congress_client.requests.get")
    def test_403_retries_through_proxy_and_stays_on_it(self, mock_get):
        from congress_client import senate_get

        mock_get.side_effect = [
            _senate_response(403),
            _senate_response(200),
            _senate_response(200),
        ]
        with patch.dict(os.environ, {"SENATE_PROXY_URL": self.PROXY}):
            senate_get("https://www.senate.gov/a.xml")
            senate_get("https://www.senate.gov/b.xml")
        proxy = {"http": self.PROXY, "https": self.PROXY}
        self.assertEqual(self._proxies(mock_get), [None, proxy, proxy])

    @patch("congress_client.requests.get")
    def test_use_proxy_skips_the_direct_request(self, mock_get):
        from congress_client import senate_get

        mock_get.return_value = _senate_response(200)
        with patch.dict(os.environ, {"SENATE_PROXY_URL": self.PROXY}):
            senate_get("https://www.senate.gov/x.xml", use_proxy=True)
        proxy = {"http": self.PROXY, "https": self.PROXY}
        self.assertEqual(self._proxies(mock_get), [proxy])

    @patch("congress_client.requests.get")
    def test_403_without_proxy_raises(self, mock_get):
        import requests
        from congress_client import senate_get

        mock_get.return_value = _senate_response(403)
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SENATE_PROXY_URL", None)
            with self.assertRaises(requests.HTTPError):
                senate_get("https://www.senate.gov/x.xml", use_proxy=True)
        self.assertEqual(self._proxies(mock_get), [None])


class SyncSenateVotesTests(unittest.TestCase):
    @patch("congress_client.fetch_senate_vote_xml", return_value=None)
    def test_previously_failed_roll_call_uses_proxy(self, mock_fetch):
        from congress_client import sync_senate_votes
        from models import SenateRollCall

        roll_calls = {
            (119, 1, 1): SenateRollCall(
                congress=119, session=1, vote_number=1, status="failed"
            ),
            (119, 1, 2): SenateRollCall(
                congress=119, session=1, vote_number=2, status="skipped_no_bill"
            ),
        }
        for vote_number in (1, 2, 3):
            sync_senate_votes(
                119, 1, vote_number, db_session=MagicMock(), roll_calls=roll_calls
            )
        self.assertEqual(
            [call.kwargs["use_proxy"] for call in mock_fetch.call_args_list],
            [True, False, False],
        )

    @patch("congress_client.fetch_senate_vote_xml", return_value=SAMPLE_SENATE_VOTE_XML)
    def test_upserts_roll_call_then_member_votes(self, _mock_fetch):
        from congress_client import sync_senate_votes
        from models import Bill, RollCall, SenateRollCall, Vote

        bill = Bill(id="119-s-5", title="Test")
        existing_roll_call = RollCall(
            id=10,
            bill_id="119-s-5",
            chamber="Senate",
            source_roll_call_id="senate-119-1-00001",
        )
        existing = Vote(
            roll_call_id=10,
            official_id="C001098",
            position="No",
        )

        def query(model):
            mocked = MagicMock()
            if model is RollCall:
                mocked.filter_by.return_value.one_or_none.return_value = (
                    existing_roll_call
                )
            elif model is Vote:
                mocked.filter_by.return_value.all.return_value = [existing]
            return mocked

        session = MagicMock()
        session.get.return_value = bill
        session.query.side_effect = query

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
        self.assertEqual(sum(1 for obj in added if isinstance(obj, RollCall)), 0)
        self.assertEqual(existing.position, "Yes")
        self.assertEqual(
            existing_roll_call.result,
            "Cloture on the Motion to Proceed Agreed to",
        )
        self.assertEqual(existing_roll_call.requires, "3/5")
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


class LatestActionTests(unittest.TestCase):
    def test_reads_congress_latest_action(self):
        from congress_client import latest_action_from_congress

        text, action_date = latest_action_from_congress(
            {
                "latestAction": {
                    "actionDate": "2025-07-04",
                    "text": "Became Public Law No: 119-5.",
                }
            }
        )
        self.assertEqual(text, "Became Public Law No: 119-5.")
        self.assertEqual(action_date.isoformat(), "2025-07-04")


class RollCallSourceTests(unittest.TestCase):
    def test_pads_chamber_congress_session_and_number(self):
        self.assertEqual(
            make_source_roll_call_id("Senate", 119, 1, 1),
            "senate-119-1-00001",
        )
        self.assertEqual(
            make_source_roll_call_id("House", 119, 1, 17),
            "house-119-1-00017",
        )


class HouseRollCallMetadataTests(unittest.TestCase):
    def test_reads_question_result_and_date_from_members_payload(self):
        payload = {
            "houseRollCallVoteMemberVotes": {
                "result": "Passed",
                "voteQuestion": "On Passage",
                "startDate": "2025-01-16T11:00:00-05:00",
                "results": [],
            }
        }
        parsed = _house_roll_call_metadata(payload)
        self.assertEqual(parsed["result"], "Passed")
        self.assertEqual(parsed["question"], "On Passage")
        self.assertEqual(parsed["date"].isoformat(), "2025-01-16")
        self.assertIsNone(parsed["requires"])


class SyncHouseVotesTests(unittest.TestCase):
    @patch("congress_client.fetch_house_roll_call")
    @patch("congress_client.fetch_bill_actions")
    def test_stores_house_roll_call_outcome(self, mock_actions, mock_house):
        from congress_client import sync_bill_votes
        from models import Bill, RollCall, Vote

        bill = Bill(id="119-hr-1", title="Test")
        mock_actions.return_value = [
            {
                "recordedVotes": [
                    {
                        "chamber": "House",
                        "congress": 119,
                        "sessionNumber": 1,
                        "rollNumber": 17,
                        "date": "2025-01-16T16:00:00Z",
                    }
                ]
            }
        ]
        mock_house.return_value = (
            [
                {"bioguideID": "A000055", "voteCast": "Yea"},
                {"bioguideID": "B000001", "voteCast": "Nay"},
            ],
            {
                "question": "On Passage",
                "result": "Passed",
                "requires": None,
                "date": date(2025, 1, 16),
            },
        )

        created_roll_call = RollCall(
            id=3,
            bill_id="119-hr-1",
            chamber="House",
            source_roll_call_id="house-119-1-00017",
        )

        def query(model):
            mocked = MagicMock()
            if model is RollCall:
                mocked.filter_by.return_value.one_or_none.return_value = None
            elif model is Vote:
                mocked.filter_by.return_value.all.return_value = []
            return mocked

        session = MagicMock()
        session.get.return_value = bill
        session.query.side_effect = query

        def add(obj):
            if isinstance(obj, RollCall):
                obj.id = created_roll_call.id

        session.add.side_effect = add

        stats = sync_bill_votes(
            119,
            "hr",
            1,
            session=session,
            official_ids={"A000055", "B000001"},
            ensure_bill=False,
        )

        self.assertEqual(stats["house_roll_calls"], 1)
        self.assertEqual(stats["inserted"], 2)
        added = [call.args[0] for call in session.add.call_args_list]
        roll_calls = [obj for obj in added if isinstance(obj, RollCall)]
        votes = [obj for obj in added if isinstance(obj, Vote)]
        self.assertEqual(len(roll_calls), 1)
        self.assertEqual(roll_calls[0].result, "Passed")
        self.assertEqual(roll_calls[0].question, "On Passage")
        self.assertEqual(roll_calls[0].chamber, "House")
        self.assertEqual(roll_calls[0].source_roll_call_id, "house-119-1-00017")
        self.assertEqual({vote.official_id for vote in votes}, {"A000055", "B000001"})
        self.assertTrue(all(vote.roll_call_id == 3 for vote in votes))


class SyncBillSenateVotesTests(unittest.TestCase):
    SENATE_ACTIONS = [
        {
            "recordedVotes": [
                {
                    "chamber": "Senate",
                    "congress": 119,
                    "sessionNumber": 1,
                    "rollNumber": 1,
                    "date": "2025-01-09T19:54:00Z",
                },
                {
                    "chamber": "Senate",
                    "congress": 119,
                    "sessionNumber": 1,
                    "rollNumber": 7,
                    "date": "2025-01-20T19:54:00Z",
                },
            ]
        }
    ]

    def _sync(self):
        from congress_client import sync_bill_votes
        from models import Bill

        session = MagicMock()
        session.get.return_value = Bill(id="119-s-5", title="Laken Riley Act")
        return sync_bill_votes(
            119, "s", 5, session=session, official_ids=set(), ensure_bill=False
        )

    @patch("congress_client.upsert_senate_roll_call")
    @patch("congress_client.load_senator_lookup", return_value={})
    @patch("congress_client.load_senate_roll_calls", return_value={})
    @patch("congress_client.sync_senate_votes")
    @patch("congress_client.fetch_bill_actions")
    def test_senate_gov_block_does_not_abort_bill(
        self, mock_actions, mock_senate, _roll_calls, _lookup, mock_upsert
    ):
        import requests

        mock_actions.return_value = self.SENATE_ACTIONS
        mock_senate.side_effect = [
            requests.HTTPError("403 Client Error: Forbidden"),
            {
                "inserted": 100,
                "updated": 0,
                "unchanged": 0,
                "skipped_unknown_officials": 0,
                "not_found": False,
                "skipped_no_bill": False,
            },
        ]

        stats = self._sync()

        self.assertEqual(mock_senate.call_count, 2)
        self.assertEqual(mock_upsert.call_args.args[2:6], (119, 1, 1, "failed"))
        self.assertEqual(stats["senate_roll_calls_failed"], 1)
        self.assertEqual(stats["senate_roll_calls"], 1)
        self.assertEqual(stats["inserted"], 100)

    @patch("congress_client.load_senator_lookup", return_value={})
    @patch("congress_client.load_senate_roll_calls")
    @patch("congress_client.sync_senate_votes")
    @patch("congress_client.fetch_bill_actions")
    def test_skips_senate_roll_calls_already_ingested(
        self, mock_actions, mock_senate, mock_roll_calls, _lookup
    ):
        from congress_client import SENATE_ROLL_CALL_INGESTED
        from models import SenateRollCall

        mock_actions.return_value = self.SENATE_ACTIONS
        mock_roll_calls.return_value = {
            (119, 1, 1): SenateRollCall(
                congress=119, session=1, vote_number=1,
                status=SENATE_ROLL_CALL_INGESTED,
            ),
            (119, 1, 7): SenateRollCall(
                congress=119, session=1, vote_number=7, status="failed",
            ),
        }
        mock_senate.return_value = {
            "inserted": 0,
            "updated": 0,
            "unchanged": 100,
            "skipped_unknown_officials": 0,
            "not_found": False,
            "skipped_no_bill": False,
        }

        stats = self._sync()

        mock_roll_calls.assert_called_once()
        mock_senate.assert_called_once()
        self.assertEqual(mock_senate.call_args.args[2], 7)
        self.assertEqual(stats["senate_roll_calls_skipped"], 1)
        self.assertEqual(stats["senate_roll_calls"], 1)


class SyncHouseSessionVotesTests(unittest.TestCase):
    @patch("congress_client.refresh_bill_status")
    @patch("congress_client.sync_bill_votes")
    @patch("congress_client.sync_house_roll_call")
    @patch("congress_client.load_official_ids")
    @patch("congress_client.load_house_source_roll_call_ids")
    @patch("congress_client.fetch_house_vote_list")
    def test_fetches_only_missing_roll_calls(
        self, mock_list, mock_stored, mock_officials, mock_roll_call, mock_bill_votes, mock_refresh
    ):
        from congress_client import sync_house_session_votes
        from models import Bill

        def vote(roll, bill_type="HR", number="9340"):
            return {
                "rollCallNumber": roll,
                "legislationType": bill_type,
                "legislationNumber": number,
                "startDate": "2026-09-16T18:53:00-04:00",
            }

        mock_list.return_value = [
            vote(312),
            vote(311),  # already stored
            {"rollCallNumber": 5},  # quorum call: no legislation
            vote(400, number="77"),  # bill not in the database yet
        ]
        # The new bill's sync_bill_votes stores roll 400 itself.
        mock_stored.side_effect = [
            {"house-119-2-00311"},
            {"house-119-2-00311", "house-119-2-00400"},
        ]
        mock_officials.return_value = {"A000055"}
        mock_roll_call.return_value = {"inserted": 3, "updated": 0, "unchanged": 0}
        mock_bill_votes.return_value = {
            "inserted": 2, "updated": 0, "unchanged": 0, "skipped_unknown_officials": 0,
        }
        existing = Bill(id="119-hr-9340", title="Ratepayer Protection Act")
        session = MagicMock()
        session.get.side_effect = lambda model, bill_id: existing if bill_id == "119-hr-9340" else None

        stats = sync_house_session_votes(119, 2, db_session=session)

        self.assertEqual(
            (stats["listed"], stats["already_stored"], stats["no_legislation"]), (4, 1, 1)
        )
        self.assertEqual((stats["fetched"], stats["bills_created"], stats["inserted"]), (2, 1, 5))
        mock_roll_call.assert_called_once()
        self.assertEqual(mock_roll_call.call_args.args[:5], (session, "119-hr-9340", 119, 2, 312))
        mock_bill_votes.assert_called_once()
        self.assertEqual(mock_bill_votes.call_args.args, (119, "HR", "77"))
        self.assertEqual(existing.voted_date, date(2026, 9, 16))
        self.assertEqual(
            sorted(c.args[1] for c in mock_refresh.call_args_list), ["119-hr-77", "119-hr-9340"]
        )


class FetchRecentBillsTests(unittest.TestCase):
    def test_sorts_by_update_and_follows_pagination_until_limit(self):
        pages = [
            {"bills": [{"number": 1}, {"number": 2}], "pagination": {"next": "https://next/1"}},
            {"bills": [{"number": 3}, {"number": 4}], "pagination": {"next": "https://next/2"}},
        ]
        with patch("congress_client.congress_get", side_effect=pages) as get:
            bills = fetch_recent_bills(
                limit=3,
                congress=119,
                since=datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc),
            )

        self.assertEqual([bill["number"] for bill in bills], [1, 2, 3])
        self.assertEqual(get.call_count, 2)
        first_params = get.call_args_list[0].kwargs["params"]
        self.assertEqual(first_params["sort"], "updateDate desc")
        self.assertEqual(first_params["fromDateTime"], "2026-10-19T12:00:00Z")
        self.assertEqual(get.call_args_list[1].args[0], "https://next/1")
        self.assertIsNone(get.call_args_list[1].kwargs["params"])

    def test_stops_when_no_next_page(self):
        with patch(
            "congress_client.congress_get",
            return_value={"bills": [{"number": 1}], "pagination": {}},
        ) as get:
            bills = fetch_recent_bills(limit=50, congress=119)

        self.assertEqual(len(bills), 1)
        self.assertEqual(get.call_count, 1)
        self.assertNotIn("fromDateTime", get.call_args.kwargs["params"])


if __name__ == "__main__":
    unittest.main()
