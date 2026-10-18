import os
import unittest
from datetime import date, datetime

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from services.accountability import (
    ENGINE_VERSION,
    REASON_LATER_VOTE,
    REASON_LOCAL_ON_BROAD,
    REASON_LOW_EMPHASIS,
    REASON_MINOR_PROVISION,
    REASON_UNRELATED_PROVISION,
    Alignment,
    alignment_points,
    apply_rules,
    inputs_hash,
    is_passage_question,
    summarize,
)


class AlignmentPointsTests(unittest.TestCase):
    def test_same_direction_yes_is_plus_one_and_no_is_minus_one(self):
        self.assertEqual(alignment_points("increase", "increase", "Yes"), 1)
        self.assertEqual(alignment_points("increase", "increase", "No"), -1)
        self.assertEqual(alignment_points("decrease", "decrease", "Yes"), 1)

    def test_opposite_direction_yes_is_minus_one_and_no_is_plus_one(self):
        self.assertEqual(alignment_points("increase", "decrease", "Yes"), -1)
        self.assertEqual(alignment_points("increase", "decrease", "No"), 1)
        self.assertEqual(alignment_points("decrease", "increase", "Yes"), -1)

    def test_maintain_and_mixed_never_score(self):
        for stance, effect in (
            ("maintain", "maintain"),
            ("mixed", "mixed"),
            ("increase", "maintain"),
            ("mixed", "decrease"),
        ):
            for position in ("Yes", "No"):
                self.assertEqual(alignment_points(stance, effect, position), 0, (stance, effect, position))

    def test_stored_house_positions_score(self):
        # Regression: the prototype checked Yea/Nay, which ingest never stores.
        self.assertNotEqual(alignment_points("increase", "increase", "Yes"), 0)
        self.assertEqual(alignment_points("increase", "increase", "Yea"), 0)

    def test_absent_votes_never_score(self):
        for position in ("Not Voting", "Present", None):
            self.assertEqual(alignment_points("increase", "increase", position), 0)


class PassageQuestionTests(unittest.TestCase):
    def test_passage_votes(self):
        for question in (
            "On Passage",
            "On Passage of the Bill",
            "On Motion to Suspend the Rules and Pass",
            "On Motion to Suspend the Rules and Pass, as Amended",
            "On Motion to Suspend the Rules and Agree",
            "On Agreeing to the Resolution",
            "On the Joint Resolution",
            "On the Concurrent Resolution",
            "On the Conference Report",
            "On Agreeing to the Conference Report",
            "On Motion to Concur in the Senate Amendment",
            "On Concurring in Senate Amendment",
            "On Motion to Suspend the Rules and Concur in the Senate Amendment",
            "On Motion to Agree to the Senate Amendment",
            "On Overriding the Veto",
            "Passage, Objections of the President Notwithstanding",
        ):
            self.assertTrue(is_passage_question(question), question)

    def test_procedural_and_amendment_votes(self):
        for question in (
            "On Motion to Recommit",
            "On Motion to Commit with Instructions",
            "On Ordering the Previous Question",
            "On the Cloture Motion",
            "On the Motion to Proceed",
            "On the Motion to Table",
            "On Agreeing to the Amendment",
            "On the Amendment",
            "On Motion to Reconsider",
            "",
            None,
        ):
            self.assertFalse(is_passage_question(question), question)


def _alignment(points, bill="119-hr-1", target=1, area="Health", roll_call=None, **fields):
    base = dict(
        official_id="O1", bill_id=bill, roll_call_id=roll_call or abs(hash(bill)) % 10_000,
        chamber="House", vote_date=date(2026, 1, 1), vote_position="Yes", target_id=target,
        target_name="Medicaid", mechanism="funding", effect_direction="increase",
        effect_magnitude="high", effect_rationale=None, stance_direction="increase",
        stance_emphasis="high", stance_summary=None, stance_evidence_quote=None,
        stance_source_url=None, policy_area=area, points=points,
        effect_relation="core", stance_scope="national", bill_effect_count=3,
    )
    base.update(fields)
    return Alignment(**base)


class SummaryTests(unittest.TestCase):
    def test_each_vote_scores_once_by_its_net_matches(self):
        totals = summarize([
            _alignment(1, bill="119-hr-1", roll_call=1),
            # Two matches on one vote that cancel out: neither aligned nor conflicting.
            _alignment(1, bill="119-hr-2", roll_call=2, target=2),
            _alignment(-1, bill="119-hr-2", roll_call=2, target=3, area="Immigration"),
            # Two contradictions and one agreement on one vote: one conflicting vote.
            _alignment(-1, bill="119-hr-3", roll_call=3, target=4, area="Immigration"),
            _alignment(-1, bill="119-hr-3", roll_call=3, target=5, area="Immigration"),
            _alignment(1, bill="119-hr-3", roll_call=3, target=6),
            # Not counted: ignored.
            _alignment(-1, bill="119-hr-4", roll_call=4, counted=False, reason=REASON_LOW_EMPHASIS),
        ])
        self.assertEqual(totals["points"], 0)
        self.assertEqual(totals["aligned"], 1)
        self.assertEqual(totals["conflicting"], 1)
        self.assertEqual(totals["bills_scored"], 2)
        self.assertEqual(totals["stances_matched"], 6)
        self.assertEqual(totals["alignment_pct"], 50.0)
        self.assertEqual(
            totals["by_policy_area"],
            {
                "Health": {"points": 1, "aligned": 1, "conflicting": 0},
                "Immigration": {"points": -1, "aligned": 0, "conflicting": 1},
            },
        )

    def test_no_matches_has_no_percentage(self):
        self.assertIsNone(summarize([])["alignment_pct"])

    def test_hash_ignores_order_and_tracks_content(self):
        a, b = _alignment(1), _alignment(-1, bill="119-hr-2")
        self.assertEqual(inputs_hash([a, b]), inputs_hash([b, a]))
        self.assertNotEqual(inputs_hash([a]), inputs_hash([a, b]))


BROAD = 12


class RuleTests(unittest.TestCase):
    def reasons(self, *alignments):
        return [a.reason for a in apply_rules(list(alignments))]

    def test_explicit_national_position_on_a_core_provision_counts(self):
        [a] = apply_rules([_alignment(1)])
        self.assertTrue(a.counted)
        self.assertIsNone(a.reason)

    def test_low_emphasis_never_counts(self):
        self.assertEqual(self.reasons(_alignment(1, stance_emphasis="low")), [REASON_LOW_EMPHASIS])

    def test_local_position_counts_only_on_a_narrow_bill(self):
        self.assertEqual(self.reasons(_alignment(1, stance_scope="local")), [None])
        self.assertEqual(
            self.reasons(_alignment(1, stance_scope="local", bill_effect_count=BROAD)),
            [REASON_LOCAL_ON_BROAD],
        )

    def test_unrelated_provision_counts_only_for_explicit_positions(self):
        self.assertEqual(
            self.reasons(_alignment(1, effect_relation="secondary", stance_emphasis="medium")),
            [REASON_UNRELATED_PROVISION],
        )
        self.assertEqual(self.reasons(_alignment(1, effect_relation="secondary")), [None])

    def test_broad_bill_minor_provision_counts_only_for_explicit_positions(self):
        minor = dict(bill_effect_count=BROAD, effect_magnitude="medium")
        self.assertEqual(
            self.reasons(_alignment(1, stance_emphasis="medium", **minor)), [REASON_MINOR_PROVISION]
        )
        self.assertEqual(self.reasons(_alignment(1, **minor)), [None])
        self.assertEqual(
            self.reasons(_alignment(1, stance_emphasis="medium", bill_effect_count=BROAD)), [None]
        )

    def test_same_policy_counts_once_per_congress_on_the_latest_vote(self):
        senate_version = _alignment(1, bill="119-s-2296", roll_call=1, vote_date=date(2025, 10, 9))
        final = _alignment(-1, bill="119-s-1071", roll_call=2, vote_date=date(2025, 12, 17),
                           vote_position="No")
        other_congress = _alignment(1, bill="118-hr-2670", roll_call=3, vote_date=date(2023, 7, 14))
        cut = _alignment(1, bill="119-hr-4", roll_call=4, effect_direction="decrease",
                         vote_position="No", vote_date=date(2025, 7, 17))
        self.assertEqual(
            self.reasons(senate_version, final, other_congress, cut),
            [REASON_LATER_VOTE, None, None, None],
        )

    def test_a_match_kept_out_by_a_rule_does_not_supersede_an_earlier_vote(self):
        earlier = _alignment(1, bill="119-s-2296", roll_call=1, vote_date=date(2025, 10, 9))
        later_low = _alignment(-1, bill="119-s-1071", roll_call=2, vote_date=date(2025, 12, 17),
                               stance_emphasis="low")
        self.assertEqual(self.reasons(earlier, later_low), [None, REASON_LOW_EMPHASIS])


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
class AccountabilityEngineTests(unittest.TestCase):
    PREFIX = "ZZACC"
    ALICE = "ZZACC001"  # stances, votes on everything
    BOB = "ZZACC002"  # stance, but did not vote
    CAROL = "ZZACC003"  # votes, no stances
    IDS = [ALICE, BOB, CAROL]

    BILL_MIXED = "ZZACC-hr1-119"  # Medicaid +, Border Patrol +, unrelated tax cut
    BILL_TWICE = "ZZACC-hr2-119"  # Medicaid cut, voted on twice in the House
    BILL_UNCLASSIFIED = "ZZACC-hr3-119"
    BILL_MAINTAIN = "ZZACC-hr4-119"

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from api.main import app
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal

        self.SessionLocal = SessionLocal
        self._cleanup()
        self._seed()
        self.session = SessionLocal()

    def tearDown(self):
        self.session.close()
        self._cleanup()

    def _cleanup(self):
        from models import (
            Bill, BillEffect, Official, OfficialScore, OfficialStance,
            PolicyTarget, RollCall, Vote, VoteAlignment,
        )

        session = self.SessionLocal()
        pattern = f"{self.PREFIX}%"
        session.query(VoteAlignment).filter(VoteAlignment.official_id.like(pattern)).delete(synchronize_session=False)
        session.query(OfficialScore).filter(OfficialScore.official_id.like(pattern)).delete(synchronize_session=False)
        session.query(Vote).filter(Vote.official_id.like(pattern)).delete(synchronize_session=False)
        session.query(RollCall).filter(RollCall.bill_id.like(pattern)).delete(synchronize_session=False)
        session.query(BillEffect).filter(BillEffect.bill_id.like(pattern)).delete(synchronize_session=False)
        session.query(Bill).filter(Bill.id.like(pattern)).delete(synchronize_session=False)
        session.query(OfficialStance).filter(OfficialStance.official_id.like(pattern)).delete(synchronize_session=False)
        session.query(Official).filter(Official.id.like(pattern)).delete(synchronize_session=False)
        session.query(PolicyTarget).filter(PolicyTarget.slug.like("zzacc-%")).delete(synchronize_session=False)
        session.commit()
        session.close()

    def _seed(self):
        from models import (
            Bill, BillEffect, Official, OfficialStance, PolicyTarget, RollCall, Vote,
        )

        session = self.SessionLocal()
        for official_id, name in ((self.ALICE, "Zzacc Alice"), (self.BOB, "Zzacc Bob"), (self.CAROL, "Zzacc Carol")):
            session.add(Official(
                id=official_id, name=name, state="Ohio", party="Independent",
                office="Representative", district=1, current_member=True, level="federal",
            ))
        targets = {}
        for name in ("Medicaid", "Border Patrol", "Clean Energy Credits"):
            target = PolicyTarget(name=f"Zzacc {name}", slug=f"zzacc-{name.lower().replace(' ', '-')}")
            session.add(target)
            targets[name] = target
        session.flush()
        self.targets = {name: t.id for name, t in targets.items()}

        def stance(official_id, target, direction, emphasis="high", area="Health"):
            session.add(OfficialStance(
                official_id=official_id, target_id=targets[target].id, mechanism="funding",
                direction=direction, stance="supports", policy_direction=direction,
                target_name=target, emphasis=emphasis, policy_area=area,
                summary=f"Wants {target} funding to {direction}.",
                evidence_quote=f"I will fight for {target}.",
                source_url="https://example.house.gov/issues",
                source_type="official_site",
            ))

        stance(self.ALICE, "Medicaid", "increase")
        stance(self.ALICE, "Border Patrol", "decrease", emphasis="medium", area="Immigration")
        stance(self.BOB, "Medicaid", "increase")

        def bill(bill_id, status, effects):
            session.add(Bill(
                id=bill_id, title=f"Title {bill_id}", policy_area="Health",
                classification_status=status, level="federal",
            ))
            session.flush()
            for target, mechanism, direction in effects:
                session.add(BillEffect(
                    bill_id=bill_id, target_id=targets[target].id, mechanism=mechanism,
                    direction=direction, magnitude="high", rationale=f"{target} {direction}.",
                ))

        bill(self.BILL_MIXED, "ok", [
            ("Medicaid", "funding", "increase"),
            ("Border Patrol", "funding", "increase"),
            ("Clean Energy Credits", "taxation", "decrease"),
        ])
        bill(self.BILL_TWICE, "ok", [("Medicaid", "funding", "decrease")])
        bill(self.BILL_UNCLASSIFIED, "failed", [("Medicaid", "funding", "increase")])
        bill(self.BILL_MAINTAIN, "ok", [("Medicaid", "funding", "maintain")])

        roll_numbers = iter(range(1, 100))

        def roll_call(bill_id, question, when, votes):
            rc = RollCall(
                bill_id=bill_id, chamber="House", date=when, question=question,
                result="Passed", source_roll_call_id=f"{self.PREFIX}-{next(roll_numbers)}",
            )
            session.add(rc)
            session.flush()
            for official_id, position in votes.items():
                session.add(Vote(roll_call_id=rc.id, official_id=official_id, position=position))

        # Procedural: Alice's No here must not count.
        roll_call(self.BILL_MIXED, "On Motion to Recommit", date(2026, 3, 1),
                  {self.ALICE: "No", self.BOB: "Yes", self.CAROL: "Yes"})
        roll_call(self.BILL_MIXED, "On Passage", date(2026, 3, 1),
                  {self.ALICE: "Yes", self.BOB: "Not Voting", self.CAROL: "Yes"})
        # Two passage votes; only the later No counts.
        roll_call(self.BILL_TWICE, "On Passage", date(2026, 4, 1), {self.ALICE: "Yes"})
        roll_call(self.BILL_TWICE, "On Motion to Concur in the Senate Amendment", date(2026, 5, 1),
                  {self.ALICE: "No"})
        roll_call(self.BILL_UNCLASSIFIED, "On Passage", date(2026, 6, 1), {self.ALICE: "Yes"})
        roll_call(self.BILL_MAINTAIN, "On Passage", date(2026, 7, 1), {self.ALICE: "Yes"})
        session.commit()
        session.close()

    def _rescore(self, **kwargs):
        from services.accountability import rescore

        return rescore(self.session, list(self.IDS), **kwargs)

    def _score(self, official_id):
        from models import OfficialScore

        self.session.expire_all()
        return self.session.get(OfficialScore, official_id)

    def _alignments(self, official_id):
        from models import VoteAlignment

        return {
            (a.bill_id, a.target_name): (a.vote_position, a.points)
            for a in self.session.query(VoteAlignment).filter(VoteAlignment.official_id == official_id)
        }

    def test_scores_each_matching_intent_on_the_latest_passage_vote(self):
        stats = self._rescore()

        self.assertEqual(stats["updated"], 2)
        self.assertEqual(
            self._alignments(self.ALICE),
            {
                # Yes on a Medicaid increase she wants: +1.
                (self.BILL_MIXED, "Zzacc Medicaid"): ("Yes", 1),
                # Yes on a Border Patrol increase when she wants a cut: -1.
                (self.BILL_MIXED, "Zzacc Border Patrol"): ("Yes", -1),
                # Latest vote: No on a Medicaid cut: +1.
                (self.BILL_TWICE, "Zzacc Medicaid"): ("No", 1),
            },
        )
        score = self._score(self.ALICE)
        # The mixed bill's +1 and -1 are one vote that nets to 0, so only the
        # Medicaid cut vote scores.
        self.assertEqual(
            (score.points, score.aligned, score.conflicting, score.bills_scored, score.stances_matched),
            (1, 1, 0, 1, 2),
        )
        self.assertEqual(score.alignment_pct, 100.0)
        self.assertEqual(score.engine_version, ENGINE_VERSION)

    def _near_match(self, similarity):
        """Carol (and Alice, opposite) state positions on "Zzacc Medicaid
        Program", a near match for the bills' "Zzacc Medicaid"."""
        from models import OfficialStance, PolicyTarget, TargetMatch

        program = PolicyTarget(name="Zzacc Medicaid Program", slug="zzacc-medicaid-program")
        self.session.add(program)
        self.session.flush()
        for official_id, direction in ((self.CAROL, "increase"), (self.ALICE, "decrease")):
            self.session.add(OfficialStance(
                official_id=official_id, target_id=program.id, mechanism="funding",
                direction=direction, stance="supports", policy_direction=direction,
                target_name=program.name, emphasis="high", policy_area="Health",
                source_type="official_site",
            ))
        a, b = sorted((self.targets["Medicaid"], program.id))
        self.session.add(TargetMatch(target_a=a, target_b=b, similarity=similarity))
        self.session.commit()

    def test_near_target_names_match_above_the_threshold(self):
        from services.accountability import compute_alignments

        self._near_match(0.9)
        rows = compute_alignments(self.session, [self.CAROL], threshold=0.85)[self.CAROL]
        self.assertEqual(
            [(a.bill_id, a.target_name, a.stance_target_name, a.match_similarity, a.points) for a in rows],
            [(self.BILL_MIXED, "Zzacc Medicaid", "Zzacc Medicaid Program", 0.9, 1)],
        )
        self.assertEqual(compute_alignments(self.session, [self.CAROL], threshold=0.95), {})

    def test_exact_target_wins_over_a_near_match(self):
        from services.accountability import compute_alignments

        self._near_match(0.9)
        rows = compute_alignments(self.session, [self.ALICE], threshold=0.85)[self.ALICE]
        medicaid = [a for a in rows if a.target_name == "Zzacc Medicaid"]
        self.assertTrue(medicaid)
        for a in medicaid:
            self.assertEqual((a.stance_target_name, a.match_similarity), ("Zzacc Medicaid", None))

    def test_official_with_positions_but_no_scored_votes_gets_an_empty_score(self):
        self._rescore()
        score = self._score(self.BOB)
        self.assertIsNotNone(score)
        self.assertEqual((score.points, score.aligned, score.conflicting), (0, 0, 0))
        self.assertIsNone(score.alignment_pct)
        self.assertIsNone(self._score(self.CAROL))

    def test_rerun_is_a_noop_until_inputs_change(self):
        from models import OfficialStance

        self._rescore()
        self.assertEqual(self._rescore()["updated"], 0)

        # Alice now says she wants Border Patrol funding increased.
        self.session.query(OfficialStance).filter_by(
            official_id=self.ALICE, target_id=self.targets["Border Patrol"]
        ).update({"direction": "increase"})
        self.session.commit()

        stats = self._rescore()
        self.assertEqual((stats["updated"], stats["unchanged"]), (1, 1))
        score = self._score(self.ALICE)
        self.assertEqual((score.points, score.alignment_pct), (2, 100.0))

    def test_force_rewrites_everyone(self):
        self._rescore()
        self.assertEqual(self._rescore(force=True)["updated"], 2)

    def test_dry_run_writes_nothing(self):
        stats = self._rescore(dry_run=True)
        self.assertEqual(stats["updated"], 2)
        self.assertIsNone(self._score(self.ALICE))

    def test_removes_scores_when_positions_are_gone(self):
        from models import OfficialStance

        self._rescore()
        self.session.query(OfficialStance).filter_by(official_id=self.BOB).delete()
        self.session.commit()

        self.assertEqual(self._rescore()["removed"], 1)
        self.assertIsNone(self._score(self.BOB))

    def test_try_rescore_by_bill_scores_its_voters(self):
        from services.accountability import try_rescore

        stats = try_rescore(self.session, bill_ids=[self.BILL_TWICE], log=lambda _: None)
        self.assertEqual(stats["updated"], 1)
        self.assertEqual(self._score(self.ALICE).points, 1)
        self.assertIsNone(self._score(self.BOB))

    def test_try_rescore_logs_instead_of_raising(self):
        from services.accountability import try_rescore

        messages = []
        self.assertIsNone(try_rescore(self.session, log=messages.append))
        self.assertIn("rescore failed", messages[0])

    def test_api_exposes_score_and_alignments(self):
        self._rescore()

        detail = self.client.get(f"/api/officials/{self.ALICE}").json()
        self.assertEqual(detail["score_points"], 1)
        self.assertEqual(detail["score_pct"], 100.0)
        self.assertEqual(detail["score_matches"], 1)
        self.assertEqual(detail["accountability"]["aligned"], 1)
        self.assertEqual(
            detail["accountability"]["by_policy_area"],
            {"Health": {"points": 1, "aligned": 1, "conflicting": 0}},
        )
        first = detail["alignments"][0]
        self.assertEqual(first["bill_id"], self.BILL_TWICE)  # newest vote first
        self.assertEqual(first["bill_title"], f"Title {self.BILL_TWICE}")
        self.assertEqual((first["vote_position"], first["points"]), ("No", 1))
        self.assertEqual((first["counted"], first["reason"], first["bill_effect_count"]), (True, None, 1))
        self.assertEqual(first["stance_evidence_quote"], "I will fight for Medicaid.")

        unscored = self.client.get(f"/api/officials/{self.CAROL}").json()
        self.assertIsNone(unscored["accountability"])
        self.assertEqual(unscored["alignments"], [])

        listing = {o["id"]: o for o in self.client.get("/api/officials", params={"q": "Zzacc"}).json()}
        self.assertEqual(
            (listing[self.ALICE]["score_points"], listing[self.ALICE]["score_pct"], listing[self.ALICE]["score_matches"]),
            (1, 100.0, 1),
        )
        self.assertEqual(listing[self.BOB]["score_matches"], 0)
        self.assertIsNone(listing[self.CAROL]["score_points"])


if __name__ == "__main__":
    unittest.main()
