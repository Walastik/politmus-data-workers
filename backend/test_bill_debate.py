import json
import unittest

from services.bill_debate import (
    MAX_TOTAL_SOURCE_CHARS,
    DebateInput,
    DebateSource,
    balanced_sources,
    build_messages,
    summarize_debate,
)

HEINRICH = (
    "It is not enough to merely tell States to consider making utilities charge data centers. "
    "This bill has no requirement that data centers actually pay for their own grid upgrades. "
    "I would urge my colleagues to vote no."
)
VAN_HOLLEN = (
    "I cannot vote for a bill that promises protection but lacks the enforcement mechanisms "
    "needed to deliver on lowering Americans' electric bills. Republicans have provided no "
    "guarantees that we would consider amendments."
)
HUSTED = (
    "My bill ensures that large data centers pay their fair share of electricity costs. "
    "It passed the House 417 to 3."
)
HAGERTY = (
    "Communities should be in the driver's seat. Localities should be able to decide when, "
    "where, and whether they should permit these facilities."
)


def source(id, speaker, party, text, chamber="Senate"):
    return DebateSource(
        id=id, kind="floor_speech", speaker=speaker, party=party, state=None, chamber=chamber,
        date="2026-09-30", title="RATEPAYER PROTECTION ACT", text=text, url=f"https://cr/{id}",
    )


DATA = DebateInput(
    bill_id="119-hr-9340",
    title="Ratepayer Protection Act",
    summary="The bill requires states to consider implementing a standard.",
    roll_calls=[{
        "chamber": "Senate", "date": "2026-09-30",
        "question": "On Cloture on the Motion to Proceed H.R. 9340",
        "result": "Cloture on the Motion to Proceed Rejected",
        "by_party": {"Democratic": {"Yes": 4, "No": 40}, "Republican": {"Yes": 53}},
    }],
    amendments=[{"chamber": "Senate", "sponsor_name": "Sen. Van Hollen", "sponsor_party": "Democratic",
                 "text_excerpt": "SEC. 2. SENSE OF CONGRESS.", "latest_action_text": None}],
    sources=[
        source(1, "Heinrich", "Democratic", HEINRICH),
        source(2, "Van Hollen", "Democratic", VAN_HOLLEN),
        source(3, "Husted", "Republican", HUSTED),
        source(4, "Hagerty", "Republican", HAGERTY),
    ],
)


def model(payload):
    calls = []

    def chat_fn(messages, schema):
        calls.append(messages)
        return json.dumps(payload)

    chat_fn.calls = calls
    return chat_fn


def point(source_id, quote, text="Says the bill does something."):
    return {"source_id": source_id, "quote": quote, "point": text}


class SummarizeDebateTests(unittest.TestCase):
    def test_verified_points_get_speaker_and_party_from_the_source(self):
        chat = model({
            "key_dispute": "Members disagreed over whether the standard should be advisory or mandatory.",
            "supporters": [point(3, "It passed the House 417 to 3.", "Says the bill passed the House 417 to 3.")],
            "opponents": [point(1, "This bill has no requirement that data centers actually pay for their own grid upgrades.",
                                "Says the bill does not require data centers to pay for grid upgrades.")],
        })
        result = summarize_debate(DATA, prompt="P {max_points}", chat_fn=chat)
        self.assertEqual(result["supporters"][0]["speaker"], "Husted")
        self.assertEqual(result["supporters"][0]["party"], "Republican")
        self.assertEqual(result["opponents"][0]["party"], "Democratic")
        self.assertEqual(result["opponents"][0]["url"], "https://cr/1")
        self.assertIsNotNone(result["key_dispute"])
        system, user = chat.calls[0][0]["content"], chat.calls[0][1]["content"]
        self.assertEqual(system, "P 4")
        self.assertIn("[procedural]", user)
        self.assertIn('<source id="1" speaker="Senate Heinrich (D)"', user)

    def test_invented_quotes_and_loaded_wording_are_dropped(self):
        chat = model({
            "key_dispute": "Democrats blocked a common-sense bill.",
            "supporters": [
                point(3, "This quote was never said on the floor by anyone."),
                point(4, "Communities should be in the driver's seat."),
            ],
            "opponents": [
                point(1, "I would urge my colleagues to vote no.", "Says the toothless bill should fail."),
                point(2, VAN_HOLLEN.split(". ")[0] + "."),
            ],
        })
        result = summarize_debate(DATA, prompt="P", chat_fn=chat)
        self.assertEqual([p["source_id"] for p in result["supporters"]], [4])
        self.assertEqual([p["source_id"] for p in result["opponents"]], [2])
        self.assertIsNone(result["key_dispute"])
        self.assertEqual(result["rejected"], {"quote not in source": 1, "loaded wording": 2})

    def test_sides_keep_the_same_number_of_points(self):
        chat = model({
            "key_dispute": "Members disagreed over local control.",
            "supporters": [point(3, "It passed the House 417 to 3."), point(4, "Communities should be in the driver's seat.")],
            "opponents": [point(1, "I would urge my colleagues to vote no.")],
        })
        result = summarize_debate(DATA, prompt="P", chat_fn=chat)
        self.assertEqual((len(result["supporters"]), len(result["opponents"])), (1, 1))

    def test_one_sided_record_has_no_key_dispute(self):
        chat = model({
            "key_dispute": "Members disagreed.",
            "supporters": [point(3, "It passed the House 417 to 3.")],
            "opponents": [],
        })
        result = summarize_debate(DATA, prompt="P", chat_fn=chat)
        self.assertEqual(len(result["supporters"]), 1)
        self.assertIsNone(result["key_dispute"])

    def test_no_sources_raises(self):
        empty = DebateInput("119-hr-1", None, "", [], [], [])
        with self.assertRaises(ValueError):
            summarize_debate(empty, prompt="P", chat_fn=model({}))


class BalancedSourcesTests(unittest.TestCase):
    def test_round_robin_across_parties_within_budget(self):
        long_text = "x" * 3_000
        many_r = [source(i, f"R{i}", "Republican", long_text) for i in range(1, 20)]
        two_d = [source(100 + i, f"D{i}", "Democratic", long_text) for i in range(2)]
        picked = balanced_sources(many_r + two_d)
        parties = [s.party for s in picked]
        self.assertEqual(parties.count("Democratic"), 2)
        self.assertLessEqual(len(picked) * 3_000, MAX_TOTAL_SOURCE_CHARS)

    def test_messages_list_amendments(self):
        user = build_messages("P", DATA, DATA.sources)[1]["content"]
        self.assertIn("amendment by Sen. Van Hollen (Democratic): SEC. 2. SENSE OF CONGRESS.", user)


if __name__ == "__main__":
    unittest.main()


def _test_database_available() -> bool:
    import os

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
class DebateWorkerDatabaseTests(unittest.TestCase):
    BILL_ID = "zztest-hr-9340"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()

    def setUp(self):
        from database import SessionLocal
        from models import Bill, BillSource

        self.SessionLocal = SessionLocal
        self._cleanup()
        session = SessionLocal()
        session.add(Bill(id=self.BILL_ID, title="Ratepayer Protection Act", level="federal",
                         summary="<p>The bill requires states to consider a standard.</p>"))
        session.flush()
        for speaker, party, text in (("Husted", "Republican", HUSTED), ("Heinrich", "Democratic", HEINRICH)):
            session.add(BillSource(bill_id=self.BILL_ID, kind="floor_speech", chamber="Senate",
                                   source_key=f"zztest#{speaker}", speaker_name=speaker,
                                   speaker_party=party, text=text))
        session.commit()
        self.source_ids = {s.speaker_name: s.id for s in session.query(BillSource).filter_by(bill_id=self.BILL_ID)}
        session.close()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Bill, BillSource

        session = self.SessionLocal()
        session.query(BillSource).filter(BillSource.bill_id == self.BILL_ID).delete(synchronize_session=False)
        session.query(Bill).filter(Bill.id == self.BILL_ID).delete(synchronize_session=False)
        session.commit()
        session.close()

    def test_run_stores_the_debate_and_skips_it_when_unchanged(self):
        from debate_worker import run
        from models import Bill

        chat = model({
            "key_dispute": "Members disagreed over whether the standard should be mandatory.",
            "supporters": [point(self.source_ids["Husted"], "It passed the House 417 to 3.")],
            "opponents": [point(self.source_ids["Heinrich"], "I would urge my colleagues to vote no.")],
        })
        kwargs = dict(bill_id=None, model="m", prompt="P", chat_fn=chat, log=lambda *_: None)
        stats = run(**kwargs)
        self.assertGreaterEqual(stats["ok"], 1)
        session = self.SessionLocal()
        bill = session.get(Bill, self.BILL_ID)
        self.assertEqual(bill.debate_status, "ok")
        self.assertEqual(bill.debate_metadata["opponents"][0]["speaker"], "Heinrich")
        self.assertTrue(bill.debate_metadata["version"].startswith("debate-v1|p"))
        session.close()

        calls = len(chat.calls)
        run(**kwargs)
        self.assertEqual(len(chat.calls), calls)
