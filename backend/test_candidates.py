import os
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from fastapi.testclient import TestClient

import fec_client
import wikidata_client
from api.main import app
from fec_client import candidacy_values, fec_ids_for_office, fec_party, parse_fec_name
from services import candidate_races
from wikidata_client import campaign_website, label_name_parts, names_state, portrait_url


def totals_row(candidate_id, name, receipts, office="S", state="ZZ", district=0, party="DEM",
               incumbent="C", year=2098):
    return {
        "candidate_id": candidate_id,
        "name": name,
        "office": office,
        "state": state,
        "district_number": district,
        "party": party,
        "party_full": "DEMOCRATIC PARTY" if party == "DEM" else "REPUBLICAN PARTY",
        "incumbent_challenge": incumbent,
        "candidate_status": "C",
        "candidate_election_year": year,
        "election_year": year,
        "receipts": receipts,
        "disbursements": receipts / 2,
        "cash_on_hand_end_period": str(receipts / 4),
        "coverage_end_date": "2098-09-30",
    }


class NameParsingTests(unittest.TestCase):
    def test_legal_names(self):
        self.assertEqual(
            parse_fec_name("PAXTON, WARREN KENNETH JR."),
            {"first_name": "Warren", "middle_name": "Kenneth", "last_name": "Paxton",
             "suffix_name": "Jr.", "nickname": None},
        )
        self.assertEqual(parse_fec_name("MCCAUL, MICHAEL T. MR.")["middle_name"], "T.")
        self.assertEqual(parse_fec_name("MCCAUL, MICHAEL T. MR.")["last_name"], "McCaul")
        self.assertEqual(parse_fec_name("DR. JONES, ANN")["last_name"], "Jones")
        self.assertEqual(parse_fec_name("SMITH JR., JOHN")["suffix_name"], "Jr.")
        self.assertEqual(parse_fec_name("DE LA CRUZ, MONICA")["last_name"], "De La Cruz")
        self.assertEqual(parse_fec_name("JACKSON-LEE, SHEILA")["last_name"], "Jackson-Lee")

    def test_nicknames(self):
        self.assertEqual(parse_fec_name('CRUZ, RAFAEL EDWARD "TED"')["nickname"], "Ted")
        parts = parse_fec_name("O'ROURKE, ROBERT (BETO)")
        self.assertEqual((parts["first_name"], parts["last_name"], parts["nickname"]),
                         ("Robert", "O'Rourke", "Beto"))

    def test_party(self):
        self.assertEqual(fec_party("DEM"), "Democratic")
        self.assertEqual(fec_party("rep"), "Republican")
        self.assertEqual(fec_party("XYZ", "AMERICAN SOLIDARITY PARTY"), "American Solidarity")
        self.assertIsNone(fec_party(None))

    def test_candidacy_values(self):
        values = candidacy_values(totals_row("H8ZZ01001", "DOE, JANE", 1234.5, office="H", district=7))
        self.assertEqual(values["office"], "H")
        self.assertEqual(values["district"], 7)
        self.assertEqual(values["party"], "Democratic")
        self.assertEqual(values["receipts"], Decimal("1234.50"))
        self.assertEqual(values["coverage_end_date"], date(2098, 9, 30))
        # Senate races carry no district; presidential rows are skipped.
        self.assertEqual(candidacy_values(totals_row("S8ZZ00001", "DOE, JANE", 1, district=3))["district"], 0)
        self.assertIsNone(candidacy_values(totals_row("P8ZZ00001", "DOE, JANE", 1, office="P")))

    def test_candidate_offices_pick_their_fec_ids(self):
        self.assertEqual(fec_ids_for_office(["S8ZZ00001"], "Senate candidate"), ["S8ZZ00001"])
        self.assertEqual(fec_ids_for_office(["H8ZZ01001"], "House candidate"), ["H8ZZ01001"])


class RaceRuleTests(unittest.TestCase):
    def test_general_election_date(self):
        self.assertEqual(candidate_races.general_election_date(2026), date(2026, 11, 3))
        self.assertEqual(candidate_races.general_election_date(2028), date(2028, 11, 7))
        # Nov 1 is a Tuesday: the election is the Tuesday after the first Monday.
        self.assertEqual(candidate_races.general_election_date(2022), date(2022, 11, 8))

    def test_ballot_known_after_pre_general_grace(self):
        self.assertFalse(candidate_races.ballot_known(2026, today=date(2026, 10, 21)))
        self.assertTrue(candidate_races.ballot_known(2026, today=date(2026, 10, 27)))

    def _race(self):
        row = lambda receipts, general: SimpleNamespace(
            election_year=2026, receipts=Decimal(receipts), in_general_election=general
        )
        return [row(100, False), row(9_000_000, False), row(20_000, True), row(4_000, True), row(3_000, False)]

    def test_before_deadline_shows_funded_and_ballot_filers(self):
        shown, filtered = candidate_races.visible_candidacies(self._race(), today=date(2026, 10, 21))
        self.assertFalse(filtered)
        self.assertEqual([int(c.receipts) for c in shown], [9_000_000, 20_000, 4_000])

    def test_after_deadline_shows_only_ballot_filers(self):
        shown, filtered = candidate_races.visible_candidacies(self._race(), today=date(2026, 10, 30))
        self.assertTrue(filtered)
        self.assertEqual([int(c.receipts) for c in shown], [20_000, 4_000])

    def test_show_all(self):
        shown, filtered = candidate_races.visible_candidacies(self._race(), show_all=True)
        self.assertFalse(filtered)
        self.assertEqual(len(shown), 5)

    def test_labels(self):
        self.assertEqual(candidate_races.race_label("S", 0), "U.S. Senate")
        self.assertEqual(candidate_races.race_label("H", 0), "U.S. House · At-large")
        self.assertEqual(candidate_races.race_label("H", 21), "U.S. House · District 21")


class WikidataParsingTests(unittest.TestCase):
    def test_label_name_parts(self):
        self.assertEqual(
            label_name_parts("Ken Paxton", "Paxton"),
            {"first_name": "Ken", "middle_name": None, "last_name": "Paxton", "suffix_name": None},
        )
        self.assertEqual(label_name_parts("Debbie Wasserman Schultz", "Wasserman Schultz")["last_name"],
                         "Wasserman Schultz")
        self.assertEqual(label_name_parts("Martin Luther King Jr.")["suffix_name"], "Jr.")

    def test_campaign_website_prefers_non_gov(self):
        self.assertEqual(
            campaign_website(["https://house.texas.gov/members/3685", "https://jamestalarico.com/"]),
            "https://jamestalarico.com/",
        )
        self.assertEqual(campaign_website(["https://castro.house.gov/"]), "https://castro.house.gov/")
        self.assertIsNone(campaign_website([]))

    def test_portrait_url_is_scaled(self):
        self.assertEqual(
            portrait_url("http://commons.wikimedia.org/wiki/Special:FilePath/K%20Paxton.jpg"),
            "https://commons.wikimedia.org/wiki/Special:FilePath/K%20Paxton.jpg?width=400",
        )

    def test_names_state(self):
        person = {
            "bio": {"positions_held": ["Texas Attorney General"], "description": "Candidate for US Senate"},
            "districts": [],
        }
        self.assertTrue(names_state(person, "Texas"))
        self.assertFalse(names_state(person, "Ohio"))


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
class CandidateSyncTests(unittest.TestCase):
    CYCLE = 2098
    MEMBER_ID = "ZZCAND01"
    IDS = ("ZZCAND01", "S8ZZ00001", "S8ZZ00002", "S8ZZ00003", "H8ZZ01001")

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal
        from models import Official

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        session.add(
            Official(
                id=self.MEMBER_ID,
                name="Member, Sitting",
                first_name="Sitting",
                last_name="Member",
                state="Texas",
                office="Senator",
                party="Republican",
                current_member=True,
                level="federal",
                fec_candidate_ids=["S8ZZ00003"],
            )
        )
        session.commit()
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Candidacy, Official, OfficialFinanceTotal

        session = self.SessionLocal()
        session.query(Candidacy).filter(Candidacy.official_id.in_(self.IDS)).delete(synchronize_session=False)
        session.query(OfficialFinanceTotal).filter(
            OfficialFinanceTotal.official_id.in_(self.IDS)
        ).delete(synchronize_session=False)
        session.query(Official).filter(Official.id.in_(self.IDS)).delete(synchronize_session=False)
        session.commit()
        session.close()

    def _sync(self, rows):
        session = self.SessionLocal()
        try:
            stats, _ = fec_client.sync_candidacies(session, rows)
            session.commit()
            return stats
        finally:
            session.close()

    def _load_race(self):
        return self._sync([
            totals_row("S8ZZ00001", "TALARICO, JAMES", 128_000_000.0, state="TX"),
            totals_row("S8ZZ00002", "PAXTON, WARREN KENNETH JR.", 19_000_000.0, state="TX", party="REP"),
            totals_row("S8ZZ00003", "MEMBER, SITTING", 14_000_000.0, state="TX", party="REP", incumbent="I"),
            totals_row("H8ZZ01001", "DOE, JANE", 1_000.0, office="H", state="TX", district=1),
        ])

    def test_sync_links_members_and_creates_candidates(self):
        from models import Candidacy, Official

        stats = self._load_race()
        self.assertEqual((stats["members"], stats["candidates"]), (1, 3))
        # Re-running updates in place.
        self._load_race()

        session = self.SessionLocal()
        try:
            member = session.get(Candidacy, ("S8ZZ00003", self.CYCLE))
            self.assertEqual(member.official_id, self.MEMBER_ID)
            self.assertIsNone(session.get(Official, "S8ZZ00003"))

            paxton = session.get(Official, "S8ZZ00002")
            self.assertEqual(paxton.level, "candidate")
            self.assertFalse(paxton.current_member)
            self.assertEqual(paxton.display_name, "Warren Kenneth Paxton Jr.")
            self.assertEqual((paxton.state, paxton.office, paxton.party), ("Texas", "Senate candidate", "Republican"))
            self.assertEqual(paxton.fec_candidate_ids, ["S8ZZ00002"])
            self.assertEqual(session.query(Candidacy).filter(Candidacy.official_id.in_(self.IDS)).count(), 4)
        finally:
            session.close()

    def test_wikidata_label_survives_resync(self):
        from models import Official

        self._load_race()
        session = self.SessionLocal()
        official = session.get(Official, "S8ZZ00002")
        wikidata_client.apply_person(official, {
            "wikidata_id": "Q6388290",
            "label": "Ken Paxton",
            "wikipedia_url": "https://en.wikipedia.org/wiki/Ken_Paxton",
            "portrait_url": "https://commons.wikimedia.org/wiki/Special:FilePath/K.jpg?width=400",
            "websites": ["http://kenpaxton.com/"],
            "bio": {"description": "Candidate for US Senate", "birth_date": "1962-12-23",
                    "occupations": ["lawyer"], "education": [], "positions_held": ["Texas Attorney General"]},
        })
        session.commit()
        session.close()

        self._load_race()
        session = self.SessionLocal()
        try:
            official = session.get(Official, "S8ZZ00002")
            self.assertEqual(official.display_name, "Ken Paxton")
            self.assertEqual(official.website_url, "http://kenpaxton.com/")
        finally:
            session.close()

    def test_candidates_stay_off_the_roster(self):
        self._load_race()
        response = self.client.get("/api/officials", params={"level": "federal", "q": "Paxton"})
        self.assertNotIn("S8ZZ00002", [row["id"] for row in response.json()])

    def test_races_endpoint(self):
        self._load_race()
        response = self.client.get(
            "/api/candidates/races", params={"cycle": self.CYCLE, "state": "Texas"}
        )
        self.assertEqual(response.status_code, 200)
        races = response.json()["items"]
        # The $1,000 House filer is below the list threshold, so only the Senate race shows.
        self.assertEqual([race["label"] for race in races], ["U.S. Senate"])
        senate = races[0]
        self.assertEqual(senate["state_name"], "Texas")
        self.assertEqual(senate["election_date"], "2098-11-04")
        self.assertEqual(
            [(c["official_id"], c["is_member"]) for c in senate["candidates"]],
            [("S8ZZ00001", False), ("S8ZZ00002", False), (self.MEMBER_ID, True)],
        )

        everyone = self.client.get(
            "/api/candidates/races", params={"cycle": self.CYCLE, "state": "TX", "all": "true"}
        ).json()["items"]
        self.assertEqual([race["label"] for race in everyone], ["U.S. Senate", "U.S. House · District 1"])

        by_name = self.client.get(
            "/api/candidates/races", params={"cycle": self.CYCLE, "q": "talarico"}
        ).json()["items"]
        self.assertEqual(len(by_name), 1)
        self.assertEqual(len(by_name[0]["candidates"]), 3)

        self.assertEqual(self.client.get("/api/candidates/races", params={"office": "X"}).status_code, 422)

    def test_official_detail_and_race_comparison(self):
        self._load_race()
        detail = self.client.get("/api/officials/S8ZZ00002").json()
        self.assertEqual(detail["level"], "candidate")
        self.assertEqual(detail["votes"], [])
        self.assertEqual(
            [(c["fec_candidate_id"], c["race_label"]) for c in detail["candidacies"]],
            [("S8ZZ00002", "U.S. Senate")],
        )

        with patch("api.routes.officials.current_cycle", return_value=self.CYCLE):
            finance = self.client.get(f"/api/officials/{self.MEMBER_ID}/finance").json()
        race = finance["race_comparison"]
        self.assertEqual(race["key"], f"{self.CYCLE}-TX-S")
        self.assertEqual(len(race["candidates"]), 3)


if __name__ == "__main__":
    unittest.main()
