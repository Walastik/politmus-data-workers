import os
import unittest
from datetime import datetime

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import event

from api.main import app
from api.routes.positions import positions_progress
from database import get_db


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


class RouteOrderingTests(unittest.TestCase):
    def test_progress_route_is_not_caught_by_officials_path(self):
        seen = []

        def fake_db(request: Request):
            seen.append(request.scope["endpoint"])
            raise HTTPException(status_code=418)

        app.dependency_overrides[get_db] = fake_db
        try:
            response = TestClient(app).get("/api/positions/progress")
        finally:
            app.dependency_overrides.pop(get_db, None)

        self.assertEqual(response.status_code, 418)
        self.assertEqual(seen, [positions_progress])


@unittest.skipUnless(_test_database_available(), "needs a reachable *_test Postgres database")
class PositionsApiTests(unittest.TestCase):
    PREFIX = "ZZPOS"
    DONE = "ZZPOS001"
    FAILED = "ZZPOS002"
    NEVER = "ZZPOS003"
    FORMER = "ZZPOS004"
    BLOCKED = "ZZPOS005"

    @classmethod
    def setUpClass(cls):
        from init_db import ensure_schema

        ensure_schema()
        cls.client = TestClient(app)

    def setUp(self):
        from database import SessionLocal

        self.SessionLocal = SessionLocal
        self._cleanup()
        self._seed()

    def tearDown(self):
        self._cleanup()

    def _cleanup(self):
        from models import Official, OfficialPositionSync, OfficialStance, PolicyTarget

        session = self.SessionLocal()
        pattern = f"{self.PREFIX}%"
        session.query(OfficialStance).filter(OfficialStance.official_id.like(pattern)).delete(
            synchronize_session=False
        )
        session.query(OfficialPositionSync).filter(
            OfficialPositionSync.official_id.like(pattern)
        ).delete(synchronize_session=False)
        session.query(Official).filter(Official.id.like(pattern)).delete(synchronize_session=False)
        session.query(PolicyTarget).filter(PolicyTarget.slug.like("zzpos-%")).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()

    def _seed(self):
        from models import Official, OfficialPositionSync, OfficialStance, PolicyTarget

        session = self.SessionLocal()

        def official(official_id, name, current=True, website="https://example.house.gov", **parts):
            session.add(Official(
                id=official_id,
                name=name,
                **parts,
                state="New York",
                party="Democratic",
                office="Representative",
                district=1,
                current_member=current,
                website_url=website,
                level="federal",
            ))

        official(self.DONE, "Zzpos Alpha", first_name="Alpha", middle_name="Q.", last_name="Zzpos")
        official(self.FAILED, "Zzpos Bravo")
        official(self.NEVER, "Zzpos Charlie")
        official(self.FORMER, "Zzpos Delta", current=False)
        official(self.BLOCKED, "Zzpos Echo")
        session.flush()

        targets = {}
        for name in ("Medicaid", "Border Patrol", "Clean energy tax credits"):
            target = PolicyTarget(name=f"ZZPOS {name}", slug=f"zzpos-{name.lower().replace(' ', '-')}")
            session.add(target)
            targets[name] = target
        session.flush()

        extracted = datetime(2026, 10, 1, 12, 0, 0)

        def stance(target, mechanism, direction, emphasis, area, **extra):
            session.add(OfficialStance(
                official_id=self.DONE,
                target_id=targets[target].id,
                target_name=target,
                mechanism=mechanism,
                direction=direction,
                emphasis=emphasis,
                policy_area=area,
                summary=f"About {target}",
                evidence_quote=f"I support {target}.",
                source_url="https://example.house.gov/issues/health",
                extracted_at=extracted,
                extractor_version="v-test",
                model="qwen3.6:27b",
                **extra,
            ))

        stance("Clean energy tax credits", "taxation", "increase", "low", "Taxation")
        stance("Border Patrol", "funding", "increase", "medium", "Immigration")
        stance(
            "Medicaid", "funding", "increase", "high", "Health",
            stance="opposes", policy_direction="decrease",
        )

        session.add_all([
            OfficialPositionSync(
                official_id=self.DONE, status="ok", attempts=1, pages_found=4, stances_saved=3,
                extractor_version="v-test",
                last_attempt_at=datetime(2026, 10, 1, 12, 0, 0),
                last_success_at=datetime(2026, 10, 1, 12, 0, 0),
            ),
            OfficialPositionSync(
                official_id=self.FAILED, status="failed", attempts=2,
                last_attempt_at=datetime(2026, 10, 2, 12, 0, 0), last_error="ollama timed out",
            ),
            OfficialPositionSync(
                official_id=self.BLOCKED, status="blocked", attempts=1,
                last_attempt_at=datetime(2026, 10, 3, 12, 0, 0), last_error="HTTP 403",
            ),
            # Outside the worker population: must not be counted.
            OfficialPositionSync(
                official_id=self.FORMER, status="ok", attempts=1, stances_saved=9,
                extractor_version="v-old",
                last_attempt_at=datetime(2026, 10, 4, 12, 0, 0),
                last_success_at=datetime(2026, 10, 4, 12, 0, 0),
            ),
        ])
        session.commit()
        session.close()

    def test_detail_includes_positions_and_sync(self):
        response = self.client.get(f"/api/officials/{self.DONE}")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        positions = body["stated_positions"]
        self.assertEqual(
            [p["target_name"] for p in positions],
            ["Medicaid", "Border Patrol", "Clean energy tax credits"],
        )
        medicaid = positions[0]
        self.assertEqual(medicaid["direction"], "increase")
        self.assertEqual(medicaid["stance"], "opposes")
        self.assertEqual(medicaid["policy_direction"], "decrease")
        self.assertEqual(medicaid["model"], "qwen3.6:27b")
        self.assertEqual(medicaid["extractor_version"], "v-test")

        sync = body["positions_sync"]
        self.assertEqual(sync["status"], "ok")
        self.assertEqual(sync["pages_found"], 4)
        self.assertEqual(sync["stances_saved"], 3)
        self.assertEqual(sync["attempts"], 1)
        self.assertEqual(sync["extractor_version"], "v-test")
        self.assertIsNone(sync["last_error"])

    def test_returns_name_parts_and_searches_them(self):
        detail = self.client.get(f"/api/officials/{self.DONE}").json()
        self.assertEqual(detail["name"], "Zzpos Alpha")
        self.assertEqual(
            (detail["first_name"], detail["middle_name"], detail["last_name"]),
            ("Alpha", "Q.", "Zzpos"),
        )
        self.assertEqual(detail["display_name"], "Alpha Q. Zzpos")

        for query in ("Alpha Zzpos", "Alpha Q. Zzpos"):
            rows = self.client.get("/api/officials", params={"q": query}).json()
            self.assertEqual([row["id"] for row in rows], [self.DONE])
        self.assertEqual(rows[0]["display_name"], "Alpha Q. Zzpos")

        never = self.client.get(f"/api/officials/{self.NEVER}").json()
        self.assertEqual(never["display_name"], "Zzpos Charlie")

    def test_detail_for_official_never_attempted(self):
        response = self.client.get(f"/api/officials/{self.NEVER}")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["stated_positions"], [])
        self.assertIsNone(body["positions_sync"])

    def test_list_includes_positions_status_without_per_row_queries(self):
        from database import engine

        statements = []

        def count(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", count)
        try:
            response = self.client.get("/api/officials", params={"q": "Zzpos"})
            many = len(statements)
            statements.clear()
            single = self.client.get("/api/officials", params={"q": "Zzpos Alpha"})
            one = len(statements)
        finally:
            event.remove(engine, "before_cursor_execute", count)

        self.assertEqual(response.status_code, 200)
        by_id = {row["id"]: row for row in response.json()}
        self.assertEqual(len(by_id), 5)
        self.assertEqual(by_id[self.DONE]["positions_status"], "ok")
        self.assertEqual(by_id[self.DONE]["positions_count"], 3)
        self.assertEqual(by_id[self.FAILED]["positions_status"], "failed")
        self.assertIsNone(by_id[self.NEVER]["positions_status"])
        self.assertIsNone(by_id[self.NEVER]["positions_count"])

        self.assertEqual(single.status_code, 200)
        self.assertEqual(len(single.json()), 1)
        self.assertEqual(many, one)
        self.assertEqual(many, 1)

    def test_progress_counts_only_the_worker_population(self):
        from database import SessionLocal
        from models import Official

        session = SessionLocal()
        population = (
            session.query(Official)
            .filter(
                Official.level == "federal",
                Official.current_member.is_(True),
                Official.website_url.isnot(None),
                Official.website_url != "",
            )
            .count()
        )
        session.close()

        response = self.client.get("/api/positions/progress")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        # The test DB may hold other fixtures, so compare against what we seeded.
        self.assertEqual(body["population"], population)
        self.assertGreaterEqual(body["by_status"].get("ok", 0), 1)
        self.assertEqual(body["attempted"], sum(body["by_status"].values()))
        self.assertEqual(body["not_attempted"], body["population"] - body["attempted"])

        recent_ids = [item["official_id"] for item in body["recent"]]
        self.assertNotIn(self.FORMER, recent_ids)
        self.assertNotIn(self.NEVER, recent_ids)
        ours = [i for i in recent_ids if i.startswith(self.PREFIX)]
        self.assertEqual(ours, [self.BLOCKED, self.FAILED, self.DONE])

        problems = [p for p in body["problems"] if p["official_id"].startswith(self.PREFIX)]
        self.assertEqual([p["official_id"] for p in problems], [self.BLOCKED, self.FAILED])
        self.assertEqual(problems[0]["last_error"], "HTTP 403")
        self.assertEqual(problems[1]["name"], "Zzpos Bravo")

        versions = {v["extractor_version"]: v["count"] for v in body["current_versions"]}
        self.assertNotIn("v-old", versions)
        self.assertGreaterEqual(versions.get("v-test", 0), 1)
        self.assertGreaterEqual(body["stances_total"], 3)

    def test_progress_exact_counts_on_clean_database(self):
        from database import SessionLocal
        from models import Official

        session = SessionLocal()
        others = session.query(Official).filter(~Official.id.like(f"{self.PREFIX}%")).count()
        session.close()
        if others:
            self.skipTest("test database has other officials; exact counts not comparable")

        body = self.client.get("/api/positions/progress").json()
        self.assertEqual(body["population"], 4)
        self.assertEqual(body["attempted"], 3)
        self.assertEqual(body["by_status"], {"ok": 1, "failed": 1, "blocked": 1})
        self.assertEqual(body["not_attempted"], 1)
        self.assertEqual(body["stances_total"], 3)
        self.assertEqual(body["last_success_at"], "2026-10-01T12:00:00")
        self.assertEqual(body["current_versions"], [{"extractor_version": "v-test", "count": 1}])


if __name__ == "__main__":
    unittest.main()
