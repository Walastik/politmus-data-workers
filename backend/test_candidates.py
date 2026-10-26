import os
import unittest
from datetime import date, datetime
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
from services import ballot_nominees, candidate_races
from wikidata_client import campaign_website, label_name_parts, names_state, portrait_url, search_names


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

    def test_committee_websites(self):
        from fec_client import committee_website, normalize_website

        self.assertEqual(normalize_website("WWW.KENPAXTON.COM"), "https://www.kenpaxton.com")
        self.assertEqual(normalize_website(" HTTPS://WWW.DANFORUSA.COM/ "), "https://www.danforusa.com/")
        for value in (None, "", "N/A", "JOHN@EXAMPLE.COM", "FACEBOOK.COM/JANEDOE", "secure.actblue.com/donate/x"):
            self.assertIsNone(normalize_website(value), value)
        self.assertEqual(
            committee_website([
                {"designation": "A", "website": "joint-fund.com"},
                {"designation": "P", "website": None},
                {"designation": "P", "website": "JANEFORCONGRESS.COM"},
            ]),
            "https://janeforcongress.com",
        )
        self.assertIsNone(committee_website([]))

    def test_refresh_candidate_website_caches_committees(self):
        official = SimpleNamespace(fec_committees=None, website_url="http://old-wikidata-site.com/")
        committees = [{"committee_id": "C1", "designation": "P", "cycles": [2026], "website": "KENPAXTON.COM"}]
        with patch.object(fec_client, "fetch_committees", return_value=committees) as fetch:
            self.assertEqual(fec_client.refresh_candidate_website(official, "S6TX00388"), "https://kenpaxton.com")
            fec_client.refresh_candidate_website(official, "S6TX00388")
        fetch.assert_called_once_with("S6TX00388")
        # FEC registration wins over Wikidata.
        self.assertEqual(official.website_url, "https://kenpaxton.com")
        self.assertEqual(official.fec_committees, {"S6TX00388": committees})

        stale = SimpleNamespace(fec_committees={"S6TX00388": [{"committee_id": "C1", "designation": "P"}]},
                                website_url=None)
        with patch.object(fec_client, "fetch_committees", return_value=committees) as fetch:
            fec_client.refresh_candidate_website(stale, "S6TX00388")
        fetch.assert_called_once_with("S6TX00388")
        self.assertEqual(stale.website_url, "https://kenpaxton.com")

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


class BallotNomineeDataTests(unittest.TestCase):
    def test_texas_2026_is_complete_and_consistent(self):
        races = ballot_nominees.BALLOTS[(2026, "TX")].races
        self.assertEqual(sorted(races), [("H", d) for d in range(1, 39)] + [("S", 0)])
        ids = [n.fec_candidate_id for nominees in races.values() for n in nominees if n.fec_candidate_id]
        self.assertEqual(len(ids), len(set(ids)))
        for (office, _), nominees in races.items():
            parties = [n.party for n in nominees]
            self.assertEqual(len(parties), len(set(parties)), nominees)
            for n in nominees:
                if n.fec_candidate_id:
                    self.assertEqual(n.fec_candidate_id[0], office, n)
        senate = [n.name for n in races[("S", 0)]]
        self.assertEqual(senate, ["Ken Paxton", "James Talarico", "Ted Brown"])


class FinanceQueueRuleTests(unittest.TestCase):
    TODAY = date(2026, 10, 22)

    def _candidacy(self, **values):
        defaults = {
            "election_year": 2026,
            "in_general_election": False,
            "coverage_end_date": date(2026, 9, 30),
            "detail_coverage_end_date": date(2026, 9, 30),
            "detail_fetched_at": datetime(2026, 10, 21, 9),
        }
        return fec_client.FinanceTarget(None, ["H6ZZ01001"], SimpleNamespace(**{**defaults, **values}))

    def test_candidacies_are_due_on_new_filings(self):
        due = fec_client.totals_due
        self.assertFalse(due(self._candidacy(), None, self.TODAY))
        self.assertTrue(due(self._candidacy(detail_fetched_at=None), None, self.TODAY))
        self.assertTrue(due(self._candidacy(coverage_end_date=date(2026, 10, 14)), None, self.TODAY))

    def test_outside_spending_refresh(self):
        due = fec_client.totals_due
        two_days = datetime(2026, 10, 20, 9)
        # On the general ballot in the final weeks: every two days.
        self.assertTrue(due(self._candidacy(detail_fetched_at=two_days, in_general_election=True), None, self.TODAY))
        # Otherwise weekly.
        self.assertFalse(due(self._candidacy(detail_fetched_at=two_days), None, self.TODAY))
        self.assertTrue(due(self._candidacy(detail_fetched_at=datetime(2026, 10, 15)), None, self.TODAY))
        # A finished race only re-syncs on new filings.
        self.assertFalse(due(self._candidacy(detail_fetched_at=datetime(2026, 10, 1)), None, date(2027, 1, 5)))

    def test_members_not_running_refresh_weekly(self):
        member = fec_client.FinanceTarget(None, ["S4ZZ00001"])
        due = fec_client.totals_due
        self.assertTrue(due(member, None, self.TODAY))
        self.assertFalse(due(member, datetime(2026, 10, 16, 7), self.TODAY))
        self.assertTrue(due(member, datetime(2026, 10, 15, 7), self.TODAY))

    def test_request_budget_stops_fec_get(self):
        response = SimpleNamespace(status_code=200, json=lambda: {"results": []}, raise_for_status=lambda: None)
        fec_client.set_request_budget(2)
        try:
            with patch.object(fec_client.requests, "get", return_value=response) as get, \
                    patch.object(fec_client.time, "sleep"):
                fec_client.fec_get("/x/")
                fec_client.fec_get("/x/")
                with self.assertRaises(fec_client.BudgetSpent):
                    fec_client.fec_get("/x/")
            self.assertEqual(get.call_count, 2)
            self.assertEqual(fec_client.requests_left(), 0)
        finally:
            fec_client.set_request_budget(None)


def fake_detail_fec_get(path, params=None):
    """One 2098 election per candidate ID, with nothing else to report."""
    if path.startswith("/candidate/") and path.endswith("/totals/"):
        return {"results": [{
            "candidate_election_year": 2098,
            "coverage_start_date": "2097-01-01T00:00:00",
            "coverage_end_date": "2098-09-30T00:00:00",
            "receipts": 100000.0,
        }]}
    if path.endswith("/committees/"):
        return {"results": []}
    if "schedule_e" in path:
        return {"results": [], "pagination": {"pages": 1}}
    if "by_size" in path or "by_state" in path:
        return {"results": []}
    raise AssertionError(path)


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

    def test_search_names_try_short_names_first(self):
        official = SimpleNamespace(
            first_name="Warren", middle_name="Kenneth", last_name="Paxton", suffix_name="Jr.",
            nickname="Ken", display_name="Warren Kenneth Paxton Jr.",
        )
        self.assertEqual(
            search_names(official), ["Ken Paxton", "Warren Paxton", "Warren Kenneth Paxton Jr."]
        )
        official = SimpleNamespace(first_name=None, last_name=None, nickname=None, display_name="Doe, Jane")
        self.assertEqual(search_names(official), ["Doe, Jane"])

    def test_find_person_moves_to_the_next_name_until_one_fits(self):
        official = SimpleNamespace(
            first_name="Seth", last_name="Harp", nickname=None, display_name="Seth Allan Harp",
            state="Tennessee",
        )
        harp = {"wikidata_id": "Q1", "bio": {"positions_held": [], "description": "Tennessee politician"},
                "districts": []}
        hits = {"Seth Harp": ["Q1"], "Seth Allan Harp": []}
        with patch.object(wikidata_client, "search_items", side_effect=hits.get) as search, \
                patch.object(wikidata_client, "people_by_item", return_value={"Q1": harp}):
            self.assertIs(wikidata_client.find_person(official), harp)
        self.assertEqual(search.call_count, 1)

    def _response(self, status, headers=None, body=None):
        return SimpleNamespace(
            status_code=status, headers=headers or {}, json=lambda: body,
            raise_for_status=lambda: None,
        )

    def test_wikidata_get_waits_out_429(self):
        responses = [self._response(429, {"Retry-After": "7"}), self._response(200, body={"search": []})]
        with patch.object(wikidata_client.requests, "get", side_effect=responses), \
                patch.object(wikidata_client.time, "sleep") as sleep:
            self.assertEqual(wikidata_client.wikidata_get("https://example.test", {}), {"search": []})
        self.assertIn(7.0, [call.args[0] for call in sleep.call_args_list])

    def test_wikidata_get_stops_on_long_block(self):
        with patch.object(wikidata_client.requests, "get",
                          return_value=self._response(429, {"Retry-After": "3600"})), \
                patch.object(wikidata_client.time, "sleep"):
            with self.assertRaises(wikidata_client.RateLimited):
                wikidata_client.wikidata_get("https://example.test", {})


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
    IDS = ("ZZCAND01", "ZZCAND02", "S8ZZ00001", "S8ZZ00002", "S8ZZ00003", "S8ZZ00004", "H8ZZ01001")

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
        # Not on this cycle's ballot.
        session.add(
            Official(
                id="ZZCAND02",
                name="Member, Resting",
                state="Texas",
                office="Representative",
                current_member=True,
                level="federal",
                fec_candidate_ids=["S8ZZ09999", "H8ZZ02002"],
            )
        )
        session.commit()
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Candidacy, Official, OfficialFinanceTotal, OfficialStance, PolicyTarget

        session = self.SessionLocal()
        session.query(OfficialStance).filter(OfficialStance.official_id.in_(self.IDS)).delete(synchronize_session=False)
        session.query(PolicyTarget).filter(PolicyTarget.slug.like("zzcand-%")).delete(synchronize_session=False)
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

    def test_name_search_skips_recent_misses(self):
        from models import Official

        self._load_race()
        session = self.SessionLocal()
        try:
            # Jane Doe raised too little to search; the cap leaves Paxton for later.
            with patch.object(wikidata_client, "find_person", return_value=None) as find:
                self.assertEqual(wikidata_client.match_by_name(session, list(self.IDS), max_names=1), 0)
                self.assertEqual([c.args[0].id for c in find.call_args_list], ["S8ZZ00001"])
                wikidata_client.match_by_name(session, list(self.IDS))
                self.assertEqual(find.call_args_list[-1].args[0].id, "S8ZZ00002")
                self.assertEqual(find.call_count, 2)
                wikidata_client.match_by_name(session, list(self.IDS))
                self.assertEqual(find.call_count, 2)
            self.assertIsNotNone(session.get(Official, "S8ZZ00001").wikidata_searched_at)
            self.assertIsNone(session.get(Official, "H8ZZ01001").wikidata_searched_at)
        finally:
            session.close()

    def test_name_search_takes_big_fundraisers_first(self):
        # A House ID sorts before a Senate ID, but the Senate candidate raised more.
        self._sync([
            totals_row("H8ZZ01001", "DOE, JANE", 50_000.0, office="H", state="TX", district=1),
            totals_row("S8ZZ00002", "PAXTON, WARREN KENNETH JR.", 19_000_000.0, state="TX", party="REP"),
        ])
        session = self.SessionLocal()
        try:
            due = wikidata_client.name_search_due(session, list(self.IDS))
            self.assertEqual([o.id for o in due], ["S8ZZ00002", "H8ZZ01001"])
        finally:
            session.close()

    def test_finance_targets_merge_members_and_candidacies(self):
        self._load_race()
        session = self.SessionLocal()
        try:
            targets = fec_client.finance_targets(session, {"candidates", "members"}, cycle=self.CYCLE)
            ours = {t.official.id: (t.fec_ids, t.candidacy is not None) for t in targets if t.official.id in self.IDS}
        finally:
            session.close()
        # The $1,000 filer is left out; the running member goes through their
        # candidacy (and Senate seat) only; the resting member by their House ID.
        self.assertEqual(ours, {
            "S8ZZ00001": (["S8ZZ00001"], True),
            "S8ZZ00002": (["S8ZZ00002"], True),
            self.MEMBER_ID: (["S8ZZ00003"], True),
            "ZZCAND02": (["H8ZZ02002"], False),
        })

    def _run_totals(self, **kwargs):
        def get(url, params=None, timeout=None):
            body = fake_detail_fec_get(url.removeprefix(fec_client.BASE_URL), params)
            return SimpleNamespace(status_code=200, json=lambda: body, raise_for_status=lambda: None)

        # Patch the HTTP call rather than fec_get, so the request budget counts.
        with patch.object(fec_client.requests, "get", side_effect=get) as http, \
                patch.object(fec_client.time, "sleep"):
            fec_client.run_finance("totals", {"candidates"}, cycle=self.CYCLE, state="TX", **kwargs)
        return http.call_count

    def test_totals_sync_only_new_filings(self):
        from models import Candidacy

        self._load_race()
        # Three candidacies: totals, outside spending and both breakdowns,
        # plus committees once for the two who are only candidates.
        self.assertEqual(self._run_totals(), 14)
        self.assertEqual(self._run_totals(), 0)

        session = self.SessionLocal()
        candidacy = session.get(Candidacy, ("S8ZZ00002", self.CYCLE))
        self.assertEqual(candidacy.detail_coverage_end_date, date(2098, 9, 30))
        candidacy.coverage_end_date = date(2098, 10, 15)
        session.commit()
        session.close()
        # Paxton filed again: committees are cached, and the breakdowns are
        # current with the totals row FEC returns.
        self.assertEqual(self._run_totals(), 2)

    def test_pacs_wait_for_totals(self):
        def pac_due():
            session = self.SessionLocal()
            try:
                targets = fec_client.finance_targets(session, {"candidates"}, cycle=self.CYCLE, state="TX")
                return [t.official.id for t in fec_client.due_targets(session, "pacs", targets, date.today())]
            finally:
                session.close()

        self._load_race()
        self.assertEqual(pac_due(), [])
        self._run_totals()
        self.assertEqual(sorted(pac_due()), sorted(["S8ZZ00001", "S8ZZ00002", self.MEMBER_ID]))

    def test_totals_stop_at_request_budget(self):
        self._load_race()
        # The reserve leaves room for one candidacy, not two.
        self.assertEqual(self._run_totals(max_requests=fec_client.TARGET_REQUEST_RESERVE + 2), 5)
        fec_client.set_request_budget(None)

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

    def test_hand_maintained_ballot_decides_the_race(self):
        self._load_race()
        Nominee = ballot_nominees.Nominee
        ballot = ballot_nominees.StateBallot(
            source="Test source",
            races={
                ("S", 0): (
                    Nominee("S8ZZ00002", "Ken Paxton", "Republican"),
                    Nominee("S8ZZ00001", "James Talarico", "Democratic"),
                    Nominee(None, "Ted Brown", "Libertarian"),
                ),
            },
        )
        with patch.dict(ballot_nominees.BALLOTS, {(self.CYCLE, "TX"): ballot}):
            senate = self.client.get(
                "/api/candidates/races", params={"cycle": self.CYCLE, "state": "TX", "office": "S"}
            ).json()["items"][0]
            everyone = self.client.get(
                "/api/candidates/races",
                params={"cycle": self.CYCLE, "state": "TX", "office": "S", "all": "true"},
            ).json()["items"][0]

        # The sitting member filed with FEC but lost the primary: off the ballot.
        self.assertEqual([c["official_id"] for c in senate["candidates"]], ["S8ZZ00001", "S8ZZ00002"])
        self.assertTrue(all(c["in_general_election"] for c in senate["candidates"]))
        self.assertEqual(senate["unlisted_nominees"], [{"name": "Ted Brown", "party": "Libertarian"}])
        self.assertEqual((senate["ballot_filtered"], senate["ballot_source"], senate["hidden_count"]),
                         (True, "Test source", 1))
        self.assertFalse(everyone["ballot_filtered"])
        on_ballot = {c["official_id"]: c["in_general_election"] for c in everyone["candidates"]}
        self.assertEqual(on_ballot[self.MEMBER_ID], False)

    def _file_pre_general(self, *fec_ids):
        from models import Candidacy

        session = self.SessionLocal()
        session.query(Candidacy).filter(Candidacy.fec_candidate_id.in_(fec_ids)).update(
            {Candidacy.in_general_election: True}, synchronize_session=False
        )
        session.commit()
        session.close()

    def _senate(self):
        return self.client.get(
            "/api/candidates/races", params={"cycle": self.CYCLE, "state": "TX", "office": "S"}
        ).json()["items"][0]

    def test_ballot_adds_third_party_filers_and_reports_completeness(self):
        self._load_race()
        self._sync([totals_row("S8ZZ00004", "LIBERTY, LARA", 9_000.0, state="TX", party="LIB")])
        # The member lost the primary but filed a pre-general report anyway.
        self._file_pre_general("S8ZZ00001", "S8ZZ00002", "S8ZZ00003", "S8ZZ00004")
        Nominee = ballot_nominees.Nominee
        races = {("S", 0): (
            Nominee("S8ZZ00002", "Ken Paxton", "Republican"),
            Nominee("S8ZZ00001", "James Talarico", "Democratic"),
        )}
        partial = ballot_nominees.StateBallot(source="Test", races=races, partial=frozenset({("S", 0)}))
        with patch.dict(ballot_nominees.BALLOTS, {(self.CYCLE, "TX"): partial}):
            senate = self._senate()
        self.assertEqual([c["official_id"] for c in senate["candidates"]], ["S8ZZ00001", "S8ZZ00002", "S8ZZ00004"])
        self.assertFalse(senate["ballot_complete"])

        complete = ballot_nominees.StateBallot(source="Test", races=races)
        with patch.dict(ballot_nominees.BALLOTS, {(self.CYCLE, "TX"): complete}):
            self.assertTrue(self._senate()["ballot_complete"])
        # Races decided by FEC filings alone are never complete.
        self.assertFalse(self._senate()["ballot_complete"])

    def test_ballot_snapshots_override_the_committed_ballots(self):
        from models import BallotSnapshot

        self._load_race()
        session = self.SessionLocal()
        session.merge(BallotSnapshot(
            cycle=self.CYCLE, state="TX", source="Snapshot source", articles=[], fetched_at=datetime(2098, 10, 1),
            races=[{"office": "S", "district": 0, "complete": True, "nominees": [
                {"fec_candidate_id": "S8ZZ00001", "name": "James Talarico", "party": "Democratic", "website": None},
            ]}],
        ))
        session.commit()
        ballot_nominees.clear_snapshot_cache()
        try:
            senate = self._senate()
        finally:
            session.query(BallotSnapshot).filter_by(cycle=self.CYCLE).delete()
            session.commit()
            session.close()
            ballot_nominees.clear_snapshot_cache()
        self.assertEqual(senate["ballot_source"], "Snapshot source")
        self.assertEqual([c["official_id"] for c in senate["candidates"]], ["S8ZZ00001"])
        self.assertTrue(senate["ballot_complete"])

    def test_race_cards_carry_background_issues_and_nominee_websites(self):
        from api.routes.candidates import issues_by_official
        from models import Official, OfficialStance, PolicyTarget

        self._load_race()
        session = self.SessionLocal()
        paxton = session.get(Official, "S8ZZ00002")
        paxton.bio = {"positions_held": ["Texas Attorney General"], "occupations": ["lawyer", "Lawyer"]}
        target = PolicyTarget(name="Zzcand Border", slug="zzcand-border")
        session.add(target)
        session.flush()

        def stance(label, emphasis, mechanism, summary):
            return OfficialStance(
                official_id="S8ZZ00002", target_id=target.id, mechanism=mechanism, direction="increase",
                issue_label=label, emphasis=emphasis, scope="national", summary=summary,
                source_type="campaign_site",
            )

        session.add_all([
            stance("Energy", "low", "regulation", "Drill more."),
            stance("Border", "high", "funding", "Fund the wall."),
            stance("border", "medium", "enforcement", "Duplicate heading."),
        ])
        session.commit()
        issues = issues_by_official(session, {"S8ZZ00002", "S8ZZ00001"})
        session.close()
        self.assertEqual([(i.label, i.summary) for i in issues["S8ZZ00002"]],
                         [("Border", "Fund the wall."), ("Energy", "Drill more.")])
        self.assertNotIn("S8ZZ00001", issues)

        Nominee = ballot_nominees.Nominee
        ballot = ballot_nominees.StateBallot(source="Test", races={("S", 0): (
            Nominee("S8ZZ00002", "Ken Paxton", "Republican", "https://kenpaxton.example"),
            Nominee("S8ZZ00001", "James Talarico", "Democratic"),
        )})
        with patch.dict(ballot_nominees.BALLOTS, {(self.CYCLE, "TX"): ballot}):
            senate = self.client.get(
                "/api/candidates/races", params={"cycle": self.CYCLE, "state": "TX", "office": "S"}
            ).json()["items"][0]
            session = self.SessionLocal()
            self.assertEqual(ballot_nominees.fill_websites(session), 1)
            session.commit()
            self.assertEqual(session.get(Official, "S8ZZ00002").website_url, "https://kenpaxton.example")
            session.close()

        card = next(c for c in senate["candidates"] if c["official_id"] == "S8ZZ00002")
        self.assertEqual(card["background"], ["Texas Attorney General", "lawyer"])
        self.assertEqual(card["website_url"], "https://kenpaxton.example")
        self.assertEqual([i["label"] for i in card["top_issues"]], ["Border", "Energy"])

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
