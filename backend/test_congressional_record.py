import unittest
from datetime import date
from types import SimpleNamespace

from bill_context import SpeakerIndex, bill_documents, debate_dates
from services.congressional_record import (
    amendment_excerpt,
    article_matches,
    bill_label,
    extract_views,
    html_to_text,
    parse_speeches,
)

WORDS = " ".join(["word"] * 70)

RECORD_HTML = f"""<pre>
[Pages S5198-S5199]
From the Congressional Record Online through the Government Publishing Office [www.gpo.gov]

                        RATEPAYER PROTECTION ACT

  Mr. HEINRICH. Mr. President, I rise in opposition to the motion to
proceed to H.R. 9340. {WORDS}
  The PRESIDING OFFICER. The Senator from Maryland.
  Mr. VAN HOLLEN. Mr. President, I cannot vote for a bill that promises
protection {WORDS} [[Page S5199]] and more.
  Mr. HEINRICH. Mr. President, I yield the floor.
  Mrs. MILLER of Illinois. Madam Speaker, {WORDS}
  Mr. GUTHRIE. Mr. Speaker, I move to suspend the rules and pass the bill.
  The Clerk read the title of the bill.
  The text of the bill is as follows:
  SECTION 1. SHORT TITLE. {WORDS}
  Ms. LUMMIS. Madam President, I ask for its first reading.
</pre>"""


class ParseSpeechesTests(unittest.TestCase):
    def test_turns_are_joined_per_speaker_and_short_ones_dropped(self):
        speeches = parse_speeches(html_to_text(RECORD_HTML))
        self.assertEqual(
            [(s.speaker, s.state) for s in speeches],
            [("Heinrich", None), ("Van Hollen", None), ("Miller", "Illinois")],
        )
        heinrich = speeches[0].text
        self.assertTrue(heinrich.startswith("Mr. President, I rise in opposition"))
        self.assertTrue(heinrich.endswith("I yield the floor."))
        self.assertNotIn("The Senator from Maryland", heinrich)
        self.assertNotIn("[[Page", speeches[1].text)

    def test_text_read_into_the_record_is_not_a_speech(self):
        # Guthrie's turn is the motion only; the bill text is the clerk's.
        speakers = [s.speaker for s in parse_speeches(html_to_text(RECORD_HTML), min_words=1)]
        self.assertIn("Guthrie", speakers)
        guthrie = next(s for s in parse_speeches(html_to_text(RECORD_HTML), min_words=1) if s.speaker == "Guthrie")
        self.assertNotIn("SHORT TITLE", guthrie.text)


class ArticleMatchTests(unittest.TestCase):
    def test_short_title_and_number(self):
        titles = ["Ratepayer Protection Act"]
        label = bill_label("119-hr-9340")
        self.assertEqual(label, "H.R. 9340")
        for title in (
            "RATEPAYER PROTECTION ACT; Congressional Record Vol. 172, No. 155",
            "RATEPAYER PROTECTION ACT--Motion to Proceed; Congressional Record Vol. 172",
            "PROVIDING FOR CONSIDERATION OF H.R. 9340, AND FOR OTHER PURPOSES",
            "MEASURE READ THE FIRST TIME--H.R.9340",
        ):
            self.assertTrue(article_matches(title, titles, label), title)
        for title in (
            "RATEPAYER PROTECTION ACT OF 2027",
            "H.R. 93401",
            "S. 9340",
            "Cloture Motion; Congressional Record",
        ):
            self.assertFalse(article_matches(title, titles, label), title)


class ViewsAndAmendmentTests(unittest.TestCase):
    def test_extract_views_skips_contents_and_short_sections(self):
        report = (
            "CONTENTS\nDissenting Views.......... 20\n\n"
            "Background and Need for Legislation\n" + WORDS + "\n\n"
            "                          DISSENTING VIEWS\n\n" + WORDS + "\n\n"
            "                          ADDITIONAL VIEWS\n\nToo short.\n"
        )
        self.assertEqual([h for h, _ in extract_views(report)], ["Dissenting Views"])

    def test_amendment_excerpt(self):
        page = (
            "SA 6840. Mr. VAN HOLLEN (for himself, Ms. Alsobrooks) submitted an amendment "
            "intended to be proposed by him to the bill H.R. 9340; which was ordered to lie "
            "on the table; as follows: Insert after section 1 the following: SEC. 2. SENSE OF "
            "CONGRESS. SA 6841. Mr. LEE submitted an amendment"
        )
        self.assertEqual(
            amendment_excerpt(page, 6840),
            "Insert after section 1 the following: SEC. 2. SENSE OF CONGRESS.",
        )
        self.assertIsNone(amendment_excerpt(page, 9999))


class BillContextHelperTests(unittest.TestCase):
    def test_debate_dates_join_nearby_floor_actions(self):
        actions = [
            {"actionDate": "2026-09-30", "type": "Floor", "text": "Cloture not invoked."},
            {"actionDate": "2026-09-28", "type": "Floor", "text": "Motion to proceed made."},
            {"actionDate": "2026-09-15", "type": "Floor", "text": "Considered under suspension."},
            {"actionDate": "2026-07-21", "type": "Committee", "text": "Ordered to be reported."},
            {"actionDate": "2026-06-18", "type": "IntroReferral", "text": "Introduced (CR H4126)."},
        ]
        self.assertEqual(
            debate_dates(actions),
            [(date(2026, 6, 18), date(2026, 6, 18)), (date(2026, 9, 15), date(2026, 9, 30))],
        )

    def test_speaker_index_needs_a_unique_match(self):
        def official(id, office, last, state, current=True):
            return SimpleNamespace(
                id=id, office=office, last_name=last, name=None, state=state,
                current_member=current, party="Democratic",
            )

        index = SpeakerIndex([
            official("V1", "Senator", "Van Hollen", "Maryland"),
            official("K1", "Senator", "King", "Maine"),
            official("K2", "Representative", "King", "Iowa", current=False),
            official("J1", "Representative", "Johnson", "Louisiana"),
            official("J2", "Representative", "Johnson", "Georgia"),
        ])
        self.assertEqual(index.match("Van Hollen", "Senate").id, "V1")
        self.assertEqual(index.match("King", "Senate").id, "K1")
        self.assertEqual(index.match("King", "House").id, "K2")
        self.assertIsNone(index.match("Johnson", "House"))
        self.assertEqual(index.match("Johnson", "House", "Georgia").id, "J2")
        self.assertIsNone(index.match("Nobody", "House"))

    def test_bill_documents(self):
        detail = {
            "committeeReports": [{"citation": "H. Rept. 119-814", "url": "u"}],
            "cboCostEstimates": [{"title": "H.R. 9340", "pubDate": "2026-09-09T16:39:00Z", "url": "c"}],
        }
        docs = bill_documents(detail, ["Ratepayer Protection Act"])
        self.assertEqual(docs["committee_reports"], [{"citation": "H. Rept. 119-814", "url": "u"}])
        self.assertEqual(docs["cbo_cost_estimates"][0]["date"], "2026-09-09")


if __name__ == "__main__":
    unittest.main()
