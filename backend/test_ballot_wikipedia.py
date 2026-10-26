import os
import unittest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

import ballot_wikipedia as bw
from services import ballot_nominees


def box(title, *candidates):
    lines = [f"{{{{Election box begin|title={title}}}}}"]
    for party, name in candidates:
        lines.append(
            "{{Election box candidate with party link\n"
            f"  |party      = {party}\n  |candidate  = {name}\n  |votes      = \n}}}}"
        )
    lines.append("{{Election box end}}")
    return "\n".join(lines)


DEM = "Democratic Party (United States)"
REP = "Republican Party (United States)"
LIB = "Libertarian Party (United States)"

HOUSE_ARTICLE = "\n".join([
    "{{Infobox election | election_name = 2024 Ohio's 1st congressional district election}}",
    "Stray {{unclosed template",
    "== District 1 ==",
    "=== Republican primary ===",
    "==== Results ====",
    box("Republican primary results", (REP, "Eric Conroy"), (REP, "Loser Smith")),
    "=== General election ===",
    "==== Results ====",
    box(
        "2026 Ohio's 1st congressional district election",
        (DEM, "[[Greg Landsman]] (incumbent)"),
        (REP, "Eric Conroy <ref>x</ref>"),
        (LIB, "Nathan Weise"),
        (LIB, "Jason Stoops ''(write-in)''"),
    ),
    "== District 2 ==",
    "{{Infobox election",
    "| election_name = 2026 Ohio's 2nd congressional district election",
    "| nominee1 = [[David Taylor (Ohio politician)|David Taylor]]",
    "| party1 = Republican Party (United States)",
    "| candidate2 = Jen Mazzuckelli",
    "| party2 = Democratic Party (United States)",
    "}}",
    "=== Post-primary endorsements ===",
    "== District 3 ==",
    "=== Post-primary endorsements ===",
    "==== Results ====",
    box("General election", (DEM, "Joyce Beatty"), (REP, "Cleophus Dulaney")),
    "==External links==",
    ";Official campaign websites for 1st district candidates",
    "*[https://ericconroy.com/ Eric Conroy (R)]",
    "*[https://www.landsmanforcongress.com/ Greg Landsman (D)]",
    ";Official campaign websites for 3rd district candidates",
    "*[https://beattyforcongress.com/ Joyce Beaty (D)]",
])


class WikitextTests(unittest.TestCase):
    def test_general_boxes_skip_primaries_and_write_ins(self):
        races = bw.general_boxes(HOUSE_ARTICLE, 2026, "H")
        self.assertEqual(races[1], [
            ("Greg Landsman", "Democratic"),
            ("Eric Conroy", "Republican"),
            ("Nathan Weise", "Libertarian"),
        ])
        # A "Post-primary" heading is still the general election.
        self.assertEqual(races[3], [("Joyce Beatty", "Democratic"), ("Cleophus Dulaney", "Republican")])
        self.assertNotIn(2, races)

    def test_infobox_names_nominees_before_a_results_box(self):
        races = bw.infobox_nominees(HOUSE_ARTICLE, 2026, "H")
        self.assertEqual(races[2], [("David Taylor", "Republican"), ("Jen Mazzuckelli", "Democratic")])
        self.assertNotIn(1, races)  # the 2024 infobox

    def test_fusion_lines_collapse_to_the_first_party(self):
        text = box(
            "2026 New York's 1st congressional district election",
            (REP, "''Nick LaLota''"),
            ("Conservative Party of New York State", "''Nick LaLota''"),
            ("Total", "[[Nick LaLota]] (incumbent)"),
            (DEM, "Chris Gallant"),
        )
        self.assertEqual(bw.general_boxes(text, 2026, "H"), {
            1: [("Nick LaLota", "Republican"), ("Chris Gallant", "Democratic")],
        })

    def test_at_large_and_senate_races_are_district_zero(self):
        text = box("2026 United States House of Representatives election in Wyoming", (REP, "Harriet Hageman"))
        self.assertEqual(bw.general_boxes(text, 2026, "H", at_large=True), {0: [("Harriet Hageman", "Republican")]})
        self.assertEqual(bw.general_boxes(text, 2026, "S"), {0: [("Harriet Hageman", "Republican")]})

    def test_party_names(self):
        self.assertEqual(bw.party_name("Minnesota Democratic–Farmer–Labor Party"), "Democratic")
        self.assertEqual(bw.party_name("North Dakota Democratic–Nonpartisan League Party"), "Democratic")
        self.assertEqual(bw.party_name("Green Party of the United States"), "Green")
        self.assertEqual(bw.party_name("Independent politician"), "Independent")
        self.assertEqual(bw.party_name("Constitution Party (United States)"), "Constitution")

    def test_campaign_websites_by_district(self):
        sites = bw.campaign_websites(HOUSE_ARTICLE)
        self.assertEqual(
            bw.race_websites(["Greg Landsman", "Eric Conroy", "Nathan Weise"], 1, sites),
            ["https://www.landsmanforcongress.com/", "https://ericconroy.com/", None],
        )
        # A label with a misspelled first name matches on a unique last name
        # ("Marguette Greene-Scott"); a misspelled last name doesn't.
        self.assertEqual(bw.race_websites(["Joy Dulaney", "Joyce Beatty"], 3, {3: {"cleophus dulaney": "a"}}), ["a", None])
        self.assertEqual(bw.race_websites(["Joyce Beatty"], 3, sites), [None])

    def test_split_articles(self):
        title = "2026 United States House of Representatives elections in California"
        text = f"==Districts 1–26==\n{{{{main|{title} (districts 1–26)}}}}\n{{{{main|Redistricting in California}}}}"
        self.assertEqual(bw.sub_articles(text, title), [f"{title} (districts 1–26)"])


class OtherCandidateTests(unittest.TestCase):
    ARTICLE = "\n".join([
        "== District 2 ==",
        "=== Republican primary ===",
        "==== Declared ====",
        "*Primary Loser, businessman",
        "=== Independent candidates ===",
        "==== Declared ====",
        "*Bruce Fine<ref name=\"May15\"/>",
        "*[[Adam Heimerman]], teacher",
        "==== Withdrawn ====",
        "*Quit Early",
        "=== Third-party candidates ===",
        "==== Filed paperwork ====",
        "* Demile James (American Independent Party), HR recruiter",
        "=== Libertarian Party ===",
        "==== Nominee ====",
        "*Tom Schmitz, engineer",
        "=== General election ===",
        "== District 3 ==",
        "=== Green Party ===",
        "*Matthew Arndt",
    ])

    def test_running_candidates_outside_major_party_primaries(self):
        self.assertEqual(bw.other_candidates(self.ARTICLE, "H"), {
            2: [("Bruce Fine", "Independent"), ("Adam Heimerman", "Independent"), ("Tom Schmitz", "Libertarian")],
            3: [("Matthew Arndt", "Green")],
        })

    def test_infobox_races_add_other_candidates_and_are_marked_partial(self):
        text = "\n".join([
            "{{Infobox election",
            "| election_name = 2026 Ohio's 2nd congressional district election",
            "| nominee1 = David Taylor | party1 = Republican Party (United States)",
            "}}",
            self.ARTICLE,
        ])
        title = "2026 United States House of Representatives elections in Ohio"
        found, _, partial = bw.office_races(2026, "H", title, text, None)
        self.assertEqual(found[2], [
            ("David Taylor", "Republican"), ("Bruce Fine", "Independent"),
            ("Adam Heimerman", "Independent"), ("Tom Schmitz", "Libertarian"),
        ])
        self.assertEqual(partial, {2})

        ballot = ballot_nominees.ballot_from_data("Test", [
            {"office": "H", "district": 2, "complete": False, "nominees": []},
            {"office": "H", "district": 3, "complete": True, "nominees": []},
        ])
        self.assertEqual(ballot.partial, {("H", 2)})
        # Generated ballots are never complete, results box or not.
        ballots = {(2026, "OH"): ballot}
        self.assertFalse(ballot_nominees.ballot_for(2026, "OH", "H", 2, ballots)[2])
        self.assertFalse(ballot_nominees.ballot_for(2026, "OH", "H", 3, ballots)[2])
        self.assertTrue(ballot_nominees.ballot_for(2026, "TX", "S", 0, ballot_nominees.HAND_MAINTAINED)[2])

    def test_a_read_that_loses_a_race_keeps_the_last_one(self):
        old = {"races": [{"office": "S", "district": 0}, {"office": "H", "district": 1}]}
        self.assertEqual(bw.regression(old, {"races": [{"office": "H", "district": 1}]}), "lost S-0")
        self.assertIsNone(bw.regression(old, {"races": old["races"] + [{"office": "H", "district": 2}]}))
        self.assertIsNone(bw.regression(None, {"races": []}))


def fec(candidate_id, name, district="01", raised=True, filed="2025-01-01"):
    return {"candidate_id": candidate_id, "name": name, "district": district,
            "has_raised_funds": raised, "first_file_date": filed}


class MatchingTests(unittest.TestCase):
    def test_names_match_regardless_of_fec_order(self):
        self.assertEqual(bw.name_match("Ashley Hinson", "ARENHOLZ, ASHLEY HINSON"), "full")
        self.assertEqual(bw.name_match("Nick LaLota", "NICK, LALOTA"), "full")
        self.assertEqual(bw.name_match("Ted Brown", "BROWN, THEODORE E. JR."), "full")
        self.assertEqual(bw.name_match("Carlos De La Cruz", "DE LA CRUZ, CARLOS"), "full")
        self.assertEqual(bw.name_match("Ami Bera", "BERA, AMERISH"), "last")
        self.assertIsNone(bw.name_match("Ami Bera", "SMITH, AMI"))

    def test_each_fec_candidate_is_used_once(self):
        candidates = [fec("S4AK00214", "SULLIVAN, DAN", "00"), fec("S6AK00326", "SULLIVAN, DANIEL J", "00")]
        self.assertEqual(
            bw.match_race(["Dan S. Sullivan", "Daniel J. Sullivan Jr."], 0, "S", candidates),
            [("S4AK00214", ""), ("S6AK00326", "")],
        )
        candidates = [fec("H2ID01192", "PETERSON, KAYLEE")]
        self.assertEqual(
            bw.match_race(["Kaylee Peterson", "Sarah Zabel Peterson"], 1, "H", candidates),
            [("H2ID01192", ""), (None, "no FEC match")],
        )

    def test_district_match_wins_and_other_districts_need_full_names(self):
        candidates = [
            fec("H6TX08175", "TOTH, STEVE", "08"),
            fec("H6TX02999", "TOTH, ROBERT", "02"),
        ]
        self.assertEqual(
            bw.match_race(["Steve Toth"], 2, "H", candidates),
            [("H6TX08175", "FEC lists district 8")],
        )
        self.assertEqual(bw.match_race(["Jane Toth"], 3, "H", candidates), [(None, "no FEC match")])


class GeneratedBallotTests(unittest.TestCase):
    def test_generated_ballots_load_and_hand_maintained_wins(self):
        generated = ballot_nominees.load_generated(2026)
        states = {state for _, state in generated}
        self.assertGreaterEqual(len(states), 49)
        self.assertNotIn("DC", states)
        self.assertIs(ballot_nominees.BALLOTS[(2026, "TX")], ballot_nominees.HAND_MAINTAINED[(2026, "TX")])
        self.assertEqual(ballot_nominees.BALLOTS[(2026, "OH")].source, generated[(2026, "OH")].source)

    def test_generated_ballots_are_consistent(self):
        ids = []
        for (_, state), ballot in ballot_nominees.load_generated(2026).items():
            for (office, district), nominees in ballot.races.items():
                self.assertIn(office, ("H", "S"))
                self.assertTrue(nominees, (state, office, district))
                if office == "S":
                    self.assertEqual(district, 0)
                for n in nominees:
                    if n.fec_candidate_id:
                        self.assertEqual(n.fec_candidate_id[0], office, n)
                        ids.append(n.fec_candidate_id)
        self.assertEqual(len(ids), len(set(ids)))


if __name__ == "__main__":
    unittest.main()
