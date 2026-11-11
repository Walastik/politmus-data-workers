import unittest
from datetime import date
from types import SimpleNamespace

from services.leadership import (
    HOUSE_MAJORITY_LEADER,
    HOUSE_MINORITY_LEADER,
    SENATE_MAJORITY_LEADER,
    SENATE_MINORITY_LEADER,
    SPEAKER,
    congress_gov_post,
    congress_gov_types,
    legislators_post,
    majority_party,
    resolve,
)

TODAY = date(2026, 11, 10)


def member(id, office, party, legislators=None, congress_gov=()):
    return SimpleNamespace(
        id=id,
        display_name=id,
        office=office,
        party=party,
        legislators_leadership=legislators,
        congress_gov_leadership=list(congress_gov) if congress_gov is not None else None,
    )


# The 119th Congress as both sources described it in November 2026.
def congress():
    return [
        member("Johnson", "Representative", "Republican", SPEAKER, ["Speaker of the House"]),
        member("Scalise", "Representative", "Republican", HOUSE_MAJORITY_LEADER, ["Majority Leader"]),
        member("Jeffries", "Representative", "Democratic", HOUSE_MINORITY_LEADER, ["Minority Leader"]),
        member("Clark", "Representative", "Democratic", None, ["Minority Whip"]),
        member("Neguse", "Representative", "Democratic", None, ["Assistant Leader"]),
        member("Rep R", "Representative", "Republican"),
        member("Thune", "Senator", "Republican", SENATE_MAJORITY_LEADER, ["Majority Leader"]),
        member("Schumer", "Senator", "Democratic", SENATE_MINORITY_LEADER,
               ["Democratic Leader Chair of the Conference"]),
        member("Grassley", "Senator", "Republican", None, ["President Pro Tempore"]),
        member("Sanders", "Senator", "Independent"),
        member("Rep R2", "Representative", "Republican"),
    ]


class LegislatorsPostTests(unittest.TestCase):
    def test_current_top_post(self):
        legislator = {"leadership_roles": [
            {"title": "House Majority Whip", "chamber": "house", "start": "2015-01-06", "end": "2019-01-03"},
            {"title": "House Majority Leader", "chamber": "house", "start": "2025-01-03"},
        ]}
        self.assertEqual(legislators_post(legislator, TODAY), HOUSE_MAJORITY_LEADER)

    def test_ignores_lesser_posts_and_ended_roles(self):
        whip = {"leadership_roles": [{"title": "Senate Majority Whip", "start": "2025-01-03"}]}
        self.assertIsNone(legislators_post(whip, TODAY))
        ended = {"leadership_roles": [{"title": SPEAKER, "start": "2023-01-07", "end": "2023-10-03"}]}
        self.assertIsNone(legislators_post(ended, TODAY))
        # The end date is the day the next Congress convenes.
        ending = {"leadership_roles": [{"title": SPEAKER, "start": "2025-01-03", "end": "2027-01-03"}]}
        self.assertEqual(legislators_post(ending, date(2027, 1, 2)), SPEAKER)
        self.assertIsNone(legislators_post(ending, date(2027, 1, 3)))
        self.assertIsNone(legislators_post({}, TODAY))


class CongressGovTests(unittest.TestCase):
    def test_current_types(self):
        detail = {"leadership": [
            {"congress": 118, "type": "Whip"},
            {"congress": 119, "current": True, "type": "Majority Leader"},
        ]}
        self.assertEqual(congress_gov_types(detail), ["Majority Leader"])
        self.assertEqual(congress_gov_types({}), [])

    def test_maps_types_to_posts(self):
        self.assertEqual(congress_gov_post(["Speaker of the House"], "House", "Republican"), SPEAKER)
        self.assertEqual(congress_gov_post(["Majority Leader"], "Senate", "Republican"), SENATE_MAJORITY_LEADER)
        self.assertEqual(congress_gov_post(["Minority Leader"], "House", "Republican"), HOUSE_MINORITY_LEADER)
        party_leader = ["Democratic Leader Chair of the Conference"]
        self.assertEqual(congress_gov_post(party_leader, "Senate", "Republican"), SENATE_MINORITY_LEADER)
        self.assertEqual(congress_gov_post(party_leader, "Senate", "Democratic"), SENATE_MAJORITY_LEADER)
        for kind in ("Assistant Leader", "Majority Whip", "Democratic Whip", "President Pro Tempore"):
            self.assertIsNone(congress_gov_post([kind], "Senate", "Republican"), kind)

    def test_majority_party_ignores_independents(self):
        self.assertEqual(majority_party(congress(), "Senate"), "Republican")
        self.assertEqual(majority_party(congress(), "House"), "Republican")


class ResolveTests(unittest.TestCase):
    def test_sources_agree(self):
        holders, problems = resolve(congress())
        self.assertEqual(holders, {
            "Johnson": SPEAKER,
            "Scalise": HOUSE_MAJORITY_LEADER,
            "Jeffries": HOUSE_MINORITY_LEADER,
            "Thune": SENATE_MAJORITY_LEADER,
            "Schumer": SENATE_MINORITY_LEADER,
        })
        self.assertEqual(problems, [])

    def test_disagreement_keeps_congress_legislators_and_reports_it(self):
        members = congress()
        members[0].congress_gov_leadership = []
        members[5].congress_gov_leadership = ["Speaker of the House"]
        holders, problems = resolve(members)
        self.assertEqual(holders["Johnson"], SPEAKER)
        self.assertNotIn("Rep R", holders)
        self.assertEqual(problems, [
            "Speaker of the House: congress-legislators lists Johnson, Congress.gov lists Rep R",
        ])

    def test_congress_gov_fills_a_post_congress_legislators_lacks(self):
        members = congress()
        members[0].legislators_leadership = None
        holders, problems = resolve(members)
        self.assertEqual(holders["Johnson"], SPEAKER)
        self.assertEqual(len(problems), 1)

    def test_vacant_post(self):
        members = congress()
        members[0].legislators_leadership = None
        members[0].congress_gov_leadership = []
        holders, problems = resolve(members)
        self.assertNotIn(SPEAKER, holders.values())
        self.assertEqual(problems, [])

    def test_two_holders_in_congress_legislators_is_not_shown(self):
        members = congress()
        members[5].legislators_leadership = SPEAKER
        members[5].congress_gov_leadership = None
        holders, problems = resolve(members)
        self.assertEqual(holders["Johnson"], SPEAKER)  # Congress.gov breaks the tie
        members[0].congress_gov_leadership = []
        holders, _ = resolve(members)
        self.assertNotIn(SPEAKER, holders.values())

    def test_no_comparison_before_congress_gov_is_loaded(self):
        members = congress()
        for official in members:
            official.congress_gov_leadership = None
        holders, problems = resolve(members)
        self.assertEqual(len(holders), 5)
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
