import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/politmus_test",
)

from mac_mini_report import (
    Failure,
    build_report,
    fixes,
    kind_of,
    load_events,
    ollama_host,
    parse_step_log,
    prune,
    publish,
)

CLASSIFIER_LOG = """\
Selected 3 bill(s) (model=qwen3.6:27b, version=v2|pabc|qwen3.6:27b); 10 unchanged, 0 newly marked no_summary.
[1/3] 119-hr-1
  One Big Bill
  -> FAILED: TimeoutError: Ollama did not answer within 900s; raise --timeout (or BILL_CLASSIFIER_TIMEOUT_SECONDS) for slower models or --think
[2/3] 119-s-5
  Small Bill
  [TL;DR] Does a thing.
[3/3] 119-hr-22
  -> INCOMPLETE: TruncatedOutputError: Ollama output was cut off before the JSON ended (attempt 1: cut off)

Bill classification summary
  Bills selected:        3
  OK (saved):            1
  Incomplete (no TLDR):  1
  Failed:                1
  Intents saved:         4
  Model:                 qwen3.6:27b
"""

POSITIONS_LOG = """\
Selected 2 official(s) (model=nemotron, version=v1|pdef|nemotron).
[1/2] O000172 Alexandria Ocasio-Cortez - https://ocasio-cortez.house.gov
  -> FAILED: ConnectError: [Errno 61] Connection refused
[2/2] S000148 Charles Schumer - https://www.schumer.senate.gov
  target matching failed: OperationalError: connection to server at "x" failed

Official stated-positions summary
  Officials selected:   2
  Extracted:            1
  Stances saved:        7
  Failed:               1
"""

DEBATE_LOG = """\
Debate summaries: 1 bill(s) due (v1|p1|qwen3.6:27b).
[1/1] 119-hr-9340: 4 source(s)
  key dispute: Whether to fund it.
Done: due=1 ok=1 failed=0
"""


def ev(cycle, step, start, exit_code=0, log=""):
    return {"cycle": cycle, "step": step, "start": start, "end": start + 60, "exit": exit_code, "log": log}


class ParseStepLogTests(unittest.TestCase):
    def test_classifier_failures_carry_the_bill_and_stats_parse(self):
        parsed = parse_step_log("classifier", CLASSIFIER_LOG, 1)
        self.assertEqual(parsed.stats["Bills selected"], 3)
        self.assertEqual(parsed.stats["OK (saved)"], 1)
        self.assertNotIn("Model", parsed.stats)
        self.assertEqual([(f.item, kind_of(f).key) for f in parsed.failures],
                         [("119-hr-1", "timeout"), ("119-hr-22", "truncated")])
        # Exit 1 with a summary means it finished with failed items, not that it died.
        self.assertTrue(parsed.finished)

    def test_positions_failures_and_step_level_errors(self):
        parsed = parse_step_log("positions", POSITIONS_LOG, 1)
        self.assertEqual([(f.item, kind_of(f).key) for f in parsed.failures],
                         [("O000172", "ollama_down"), (None, "database")])

    def test_debate_done_line(self):
        parsed = parse_step_log("debate", DEBATE_LOG, 0)
        self.assertEqual(parsed.stats, {"due": 1, "ok": 1, "failed": 0})
        self.assertEqual(parsed.failures, [])

    def test_a_step_that_died_reports_its_last_line(self):
        log = "Traceback (most recent call last):\n  File x\nRuntimeError: scripts/llm_config.py is missing.\n"
        parsed = parse_step_log("classifier", log, 1)
        self.assertFalse(parsed.finished)
        self.assertEqual([f.message for f in parsed.failures], ["RuntimeError: scripts/llm_config.py is missing."])

    def test_lock_and_preflight_problems(self):
        lock = parse_step_log("classifier", "another bill classifier run holds /tmp/x.lock\n", 1)
        self.assertEqual([kind_of(f).key for f in lock.failures], ["lock"])
        pre = parse_step_log(
            "preflight",
            'Ollama answers at http://localhost:11434 (3 models pulled).\n'
            'PROBLEM: model "nomic-embed-text" not found for embeddings (ollama pull nomic-embed-text)\n'
            "PROBLEM: Database: OperationalError: could not connect to server\n",
            1,
        )
        self.assertEqual([kind_of(f).key for f in pre.failures], ["model_missing", "database"])

    def test_code_update_notes(self):
        parsed = parse_step_log("update", "Skipped git pull: uncommitted changes.\n", 0)
        self.assertEqual(parsed.notes, ["Skipped git pull: uncommitted changes."])


class FixTests(unittest.TestCase):
    def test_timeouts_become_a_retry_loop_per_worker(self):
        failures = [
            Failure("classifier", "TimeoutError: did not answer within 900s", "119-hr-1"),
            Failure("classifier", "TimeoutError: did not answer within 900s", "119-hr-1"),
            Failure("classifier", "TimeoutError: did not answer within 900s", "119-s-5"),
            Failure("candidates", "TimeoutError: did not answer within 900s", "H6XX01234"),
        ]
        self.assertEqual(fixes(kind_of(failures[0]), failures), [
            'for id in 119-hr-1 119-s-5; do ./scripts/run_classifier.sh --bill-id "$id" --timeout 3600; done',
            'for id in H6XX01234; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done',
        ])

    def test_missing_models_become_pulls(self):
        failure = Failure("preflight", 'model "qwen3.6:27b" not found for bill classifier (ollama pull qwen3.6:27b)')
        self.assertEqual(fixes(kind_of(failure), [failure]), ["ollama pull qwen3.6:27b"])


class BuildReportTests(unittest.TestCase):
    now = datetime(2026, 11, 9, 7, 0).astimezone()

    def report(self, events, logs=None, **kwargs):
        logs = {id(e): parse_step_log(e["step"], text, e["exit"]) for e, text in (logs or [])}
        return build_report(events, now=self.now, logs=logs, machine_info={"host": "dexter-mini"}, **kwargs)

    def healthy_pass(self, cycle, start):
        return [ev(cycle, step, start + i * 60) for i, step in enumerate(
            ("update", "preflight", "classifier", "debate", "positions", "candidates", "matching", "scoring"))]

    def test_nothing_ran_is_the_alarm(self):
        markdown, summary = self.report([])
        self.assertIn("❌ No passes ran", markdown)
        self.assertEqual(summary["status"], "❌")

    def test_healthy_day_with_failed_items_and_backlog_change(self):
        base = self.now.timestamp() - 20 * 3600
        events = [e for i in range(4) for e in self.healthy_pass(f"c{i}", base + i * 6 * 3600)]
        classifier = next(e for e in events if e["step"] == "classifier")
        classifier["exit"] = 1  # finished, but one bill failed
        markdown, summary = self.report(
            events,
            logs=[(classifier, CLASSIFIER_LOG)],
            backlog_now={"Bills due": 900, "Officials due": 40},
            previous={"backlog": {"Bills due": 1000}},
        )
        self.assertTrue(markdown.splitlines()[2].startswith("✅ Healthy: 4 of 4 passes ran"))
        self.assertIn("2 item(s) failed and will retry", markdown)
        self.assertIn("| Bills due | 900 | 1,000 | -100 |", markdown)
        self.assertIn("| Officials due | 40 | | |", markdown)
        self.assertIn("3 bills selected · 1 ok (saved)", markdown)
        self.assertIn("### Model timeouts (1)", markdown)
        self.assertIn('./scripts/run_classifier.sh --bill-id "$id" --timeout 3600', markdown)
        self.assertIn("✅ some items failed", markdown)
        self.assertEqual(summary["totals"]["classifier"]["Bills selected"], 3)

    def test_a_died_step_and_a_skipped_pass_degrade(self):
        base = self.now.timestamp() - 20 * 3600
        events = [e for i in range(4) for e in self.healthy_pass(f"c{i}", base + i * 6 * 3600)]
        died = next(e for e in events if e["step"] == "debate")
        died["exit"] = 1
        events.append(ev("c9", "lock", base + 3600, 75))
        markdown, summary = self.report(events, logs=[(died, "RuntimeError: boom\n")], backlog_error="no prompts")
        self.assertIn("⚠️ Degraded: 4 of 4 passes ran, 1 step(s) failed.", markdown)
        self.assertIn("1 pass(es) skipped because the previous one was still running", markdown)
        self.assertIn("- Debates: RuntimeError: boom", markdown)
        self.assertIn("Couldn't count what's due (no prompts)", markdown)
        self.assertEqual(summary["failed_steps"], 1)

    def test_a_busy_worker_is_skipped_not_failed(self):
        base = self.now.timestamp() - 20 * 3600
        events = [e for i in range(4) for e in self.healthy_pass(f"c{i}", base + i * 6 * 3600)]
        busy = next(e for e in events if e["step"] == "classifier")
        busy["exit"] = 1
        markdown, summary = self.report(
            events, logs=[(busy, "Bill classification run failed: another bill classifier run holds /tmp/x.lock\n")]
        )
        self.assertTrue(markdown.splitlines()[2].startswith("✅ Healthy"))
        self.assertIn("skipped: busy", markdown)
        self.assertIn("### Another run was going (1)", markdown)
        self.assertEqual(summary["failed_steps"], 0)

    def test_every_pass_stopped_at_preflight(self):
        start = self.now.timestamp() - 3600
        events = [ev("c1", "update", start), ev("c1", "preflight", start + 60, 1)]
        markdown, _ = self.report(events, logs=[(events[1], "PROBLEM: Ollama is not answering at x: ConnectError\n")])
        self.assertIn("❌ 1 pass(es) started and every one stopped at the preflight check.", markdown)
        self.assertIn("open -a Ollama", markdown)


class FilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_load_events_keeps_the_window_and_skips_bad_lines(self):
        path = self.dir / "events.jsonl"
        path.write_text("\n".join([json.dumps(ev("a", "update", 100)), "not json", json.dumps(ev("b", "update", 900))]))
        self.assertEqual([e["cycle"] for e in load_events(path, 0, 500)], ["a"])

    def test_prune_drops_old_logs_events_and_reports(self):
        now = datetime(2026, 11, 9, 7, 0)
        old, new = (now - timedelta(days=8)).timestamp(), (now - timedelta(days=1)).timestamp()
        (self.dir / "steps").mkdir()
        (self.dir / "reports").mkdir()
        for name, ts in (("steps/old.log", old), ("steps/new.log", new), ("reports/2026-11-01.md", old)):
            (self.dir / name).write_text("x")
            os.utime(self.dir / name, (ts, ts))
        (self.dir / "events.jsonl").write_text(json.dumps(ev("a", "update", old)) + "\n" + json.dumps(ev("b", "update", new)) + "\n")
        prune(self.dir, now)
        self.assertEqual(sorted(p.name for p in (self.dir / "steps").iterdir()), ["new.log"])
        self.assertEqual(list((self.dir / "reports").iterdir()), [])
        self.assertEqual([json.loads(l)["cycle"] for l in (self.dir / "events.jsonl").read_text().splitlines()], ["b"])

    def test_publish_commits_reports_to_the_branch_each_day(self):
        remote = self.dir / "remote.git"
        subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        reports = self.dir / "reports"
        reports.mkdir()
        (reports / "2026-11-08.md").write_text("day one\n")
        self.assertTrue(publish(reports, self.dir / "work", str(remote), branch="mac-mini-reports"))
        self.assertFalse(publish(reports, self.dir / "work", str(remote), branch="mac-mini-reports"))

        # A fresh work dir (e.g. a reinstall) picks up the branch and adds to it.
        (reports / "2026-11-09.md").write_text("day two\n")
        self.assertTrue(publish(reports, self.dir / "work2", str(remote), branch="mac-mini-reports"))
        log = subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "mac-mini-reports"],
                             capture_output=True, text=True, check=True).stdout.split("\n")
        self.assertEqual(log[:2], ["Mac Mini report 2026-11-09", "Mac Mini report 2026-11-08"])
        latest = subprocess.run(["git", "--git-dir", str(remote), "show", "mac-mini-reports:latest.md"],
                                capture_output=True, text=True, check=True).stdout
        self.assertEqual(latest, "day two\n")


class OllamaHostTests(unittest.TestCase):
    def test_adds_scheme_and_port_like_ollama(self):
        cases = {
            None: "http://localhost:11434",
            "0.0.0.0:11434": "http://0.0.0.0:11434",
            "0.0.0.0": "http://0.0.0.0:11434",
            "http://10.0.0.5:11434/": "http://10.0.0.5:11434",
        }
        for value, expected in cases.items():
            env = {} if value is None else {"OLLAMA_HOST": value}
            with mock.patch.dict(os.environ, env, clear=False):
                if value is None:
                    os.environ.pop("OLLAMA_HOST", None)
                self.assertEqual(ollama_host(), expected, value)


if __name__ == "__main__":
    unittest.main()
