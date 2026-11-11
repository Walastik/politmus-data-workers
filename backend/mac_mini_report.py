"""Mac Mini schedule: the preflight check and the daily health report.

scripts/mac_mini_cycle.sh runs the LLM workers every 6 hours and appends one
JSON line per step to LOG_DIR/events.jsonl (cycle, step, start, end, exit, log).
This reads those lines and the step logs:

    mac_mini_report.py preflight      Ollama answers, the models are pulled, the DB answers
    mac_mini_report.py show           print the last 24 hours' report (writes nothing)
    mac_mini_report.py write [--push] save today's report and prune logs older than
                                      KEEP_DAYS; --push commits the reports to the
                                      mac-mini-reports branch on GitHub

LOG_DIR is ~/Library/Logs/politmus unless POLITMUS_LOG_DIR is set. The report
reads the database (what is still due) but writes nothing to it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
LOG_DIR = Path(os.getenv("POLITMUS_LOG_DIR", Path.home() / "Library" / "Logs" / "politmus"))
REPORT_BRANCH = os.getenv("MAC_MINI_REPORT_BRANCH", "mac-mini-reports")
KEEP_DAYS = 7
EXPECTED_CYCLES = 4  # the cycle runs every 6 hours
LOCK_SKIPPED = 75  # lockf's exit code when the previous pass still holds the lock
PROMPT_FILES = ("llm_config.py", "positions_llm_config.py", "debate_llm_config.py")

# Order of the cycle's steps, and how the report names them.
STEPS = {
    "update": "Code update",
    "preflight": "Preflight",
    "classifier": "Bills",
    "debate": "Debates",
    "positions": "Officials' positions",
    "candidates": "Candidates' positions",
    "matching": "Target matching",
    "scoring": "Scoring",
}
# The summary counts worth showing for each step (each worker prints more).
HEADLINE = {
    "classifier": ("Bills selected", "OK (saved)", "Incomplete (no TLDR)", "Failed", "Intents saved"),
    "debate": ("due", "ok", "failed"),
    "positions": ("Officials selected", "Extracted", "No positions found", "Stances saved", "Blocked", "Failed"),
    "candidates": ("Officials selected", "Extracted", "No positions found", "Stances saved", "Blocked", "Failed"),
    "matching": ("Targets embedded", "Pairs reviewed"),
    "scoring": ("Updated", "Unchanged", "Removed"),
}
# Failed items retry on their own; this re-runs one with more room.
RETRY = {
    "classifier": './scripts/run_classifier.sh --bill-id "$id"',
    "debate": './scripts/run_debate.sh --bill-id "$id"',
    "positions": './scripts/run_positions.sh --official-id "$id" --force',
    "candidates": './scripts/run_positions.sh --official-id "$id" --force',
}


# -- step logs ---------------------------------------------------------------


ITEM_RE = re.compile(r"^\[\d+/\d+\] (\S+?):?(?:\s|$)")
ITEM_FAILED_RE = re.compile(r"^\s*(?:-> )?(?:FAILED|INCOMPLETE): (.*)$")
STEP_ERROR_RE = re.compile(
    r"(target matching failed|accountability rescore failed|another .+? run holds .*|"
    r"[A-Z][\w ]* run failed|Traceback \(most recent call last\))",
    re.IGNORECASE,
)
PROBLEM_RE = re.compile(r"^PROBLEM: (.*)$")
STAT_RE = re.compile(r"^ {2}([A-Z][^:]{0,40}?):\s+([\d,]+)(?=\s|$)")
DONE_RE = re.compile(r"\b(\w+)=(\d+)\b")


@dataclass
class Failure:
    step: str
    message: str
    item: str | None = None


@dataclass
class StepLog:
    stats: dict[str, int] = field(default_factory=dict)
    failures: list[Failure] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def finished(self) -> bool:
        """Workers print their summary counts only when the run completes."""
        return bool(self.stats)


def parse_step_log(step: str, text: str, exit_code: int) -> StepLog:
    """Summary counts, failed items (with the id being worked on), and notes."""
    parsed = StepLog()
    item = None
    lines = text.splitlines()
    for line in lines:
        if match := ITEM_RE.match(line):
            item = match.group(1)
        elif match := ITEM_FAILED_RE.match(line):
            parsed.failures.append(Failure(step, match.group(1).strip(), item))
        elif match := PROBLEM_RE.match(line):
            parsed.failures.append(Failure(step, match.group(1).strip()))
        elif match := STEP_ERROR_RE.search(line):
            if not match.group(1).startswith("Traceback"):
                parsed.failures.append(Failure(step, line.strip()))
        elif match := STAT_RE.match(line):
            parsed.stats[match.group(1).strip()] = int(match.group(2).replace(",", ""))
        elif line.startswith("Done:"):
            parsed.stats.update({k: int(v) for k, v in DONE_RE.findall(line)})
        elif line.startswith("Skipped ") or line.startswith("Now at "):
            parsed.notes.append(line.strip())
    # Workers exit 1 when any item failed; only a step without its summary died.
    if exit_code not in (0, LOCK_SKIPPED) and not parsed.finished and not any(f.item is None for f in parsed.failures):
        # The step died; its last line (usually the exception) says why.
        last = [line.strip() for line in lines if line.strip()]
        parsed.failures.append(Failure(step, last[-1] if last else f"exited with code {exit_code}, no output"))
    return parsed


# -- errors, grouped by what fixes them --------------------------------------


@dataclass(frozen=True)
class Kind:
    key: str
    title: str
    pattern: str


KINDS = (
    Kind("database", "Database connection", r"OperationalError|connection to server|could not connect to server|server closed the connection|Database:"),
    Kind("ollama_down", "Ollama isn't answering", r"Connection refused|ConnectError|Ollama is not answering|\[Errno 61\]"),
    Kind("model_missing", "A model isn't pulled", r"model ['\"]?[\w.:/-]+['\"]? not found"),
    Kind("timeout", "Model timeouts", r"did not answer within|TimeoutError|timed out"),
    Kind("truncated", "Answers cut off", r"TruncatedOutputError|cut off before the JSON ended"),
    Kind("empty", "Empty answers", r"returned an empty response"),
    Kind("lock", "Another run was going", r"another .+? run holds"),
    Kind("matching", "Matching or rescoring failed partway", r"target matching failed|rescore failed"),
    Kind("other", "Other errors", r""),
)
MODEL_RE = re.compile(r"model ['\"]?([\w.:/-]+?)['\"]? not found")


def kind_of(failure: Failure) -> Kind:
    for kind in KINDS:
        if kind.pattern and re.search(kind.pattern, failure.message, re.IGNORECASE):
            return kind
    return KINDS[-1]


def _retry_loop(step: str, ids: list[str], extra: str) -> str:
    return f"for id in {' '.join(ids)}; do {RETRY[step]} {extra}; done"


def fixes(kind: Kind, failures: list[Failure]) -> list[str]:
    """Commands (or one-line advice) that fix this kind of error."""
    if kind.key in ("timeout", "truncated", "empty"):
        extra = "--timeout 3600" if kind.key == "timeout" else "--num-predict 8192"
        by_step: dict[str, list[str]] = defaultdict(list)
        for f in failures:
            if f.item and f.step in RETRY and f.item not in by_step[f.step]:
                by_step[f.step].append(f.item)
        lines = [_retry_loop(step, ids, extra) for step, ids in by_step.items()]
        return lines or ["Re-run the step by hand with --timeout 3600 or --num-predict 8192."]
    if kind.key == "model_missing":
        models = sorted({m for f in failures for m in MODEL_RE.findall(f.message)})
        return [f"ollama pull {m}" for m in models] or ["ollama list   # then ollama pull the missing tag"]
    advice = {
        "database": "Check DATABASE_URL in .env and the Fly connection (fly status -a politmus-db); the next pass retries.",
        "ollama_down": "open -a Ollama   # or: brew services restart ollama; check with curl -s localhost:11434/api/version",
        "lock": "A manual or lab run held that worker's lock, so the step skipped this pass. Nothing to fix unless it repeats.",
        "matching": "cd backend && venv/bin/python match_targets.py && cd .. && ./scripts/run_scoring.sh",
    }
    return [advice[kind.key]] if kind.key in advice else []


# -- events ------------------------------------------------------------------


def load_events(path: Path, since: float, until: float) -> list[dict]:
    """Event lines whose step ended inside [since, until), oldest first."""
    if not path.is_file():
        return []
    events = []
    for line in path.read_text().splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if since <= event.get("end", 0) < until:
            events.append(event)
    return sorted(events, key=lambda e: (e["start"], e["end"]))


def read_step_log(event: dict) -> StepLog:
    path = Path(event.get("log") or "")
    text = path.read_text(errors="replace") if path.is_file() else ""
    return parse_step_log(event["step"], text, event["exit"])


# -- backlog and machine (live reads; each one is optional) -----------------


def backlog() -> dict[str, int]:
    """How many bills and officials the workers would pick up now."""
    from database import SessionLocal

    import bill_classifier
    import official_positions
    from services.candidate_races import CANDIDATE_LEVEL

    session = SessionLocal()
    try:
        prompts = bill_classifier.load_local_prompts()
        version = bill_classifier.classifier_version(prompts.for_version(), bill_classifier.DEFAULT_MODEL)
        bills, _ = bill_classifier.select_bills(
            bill_classifier.load_states(session), version=version, now=bill_classifier.utcnow()
        )
        prompts = official_positions.load_local_prompts()
        version = official_positions.extractor_version(
            (prompts.positions, prompts.link_selection), official_positions.DEFAULT_MODEL
        )
        now = official_positions.utcnow()
        counts = {"Bills due": len(bills)}
        for label, level in (("Officials due", "federal"), ("Candidates due", CANDIDATE_LEVEL)):
            counts[label] = len(official_positions.select_officials(
                session, version=version, now=now, limit=None, level=level
            ))
        return counts
    finally:
        session.close()


def prompt_hashes() -> dict[str, str]:
    hashes = {}
    for name in PROMPT_FILES:
        path = BACKEND_DIR / "scripts" / name
        if path.is_file():
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
    return hashes


def ollama_host() -> str:
    return os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")


def machine() -> dict:
    import httpx

    info = {
        "host": socket.gethostname().split(".")[0],
        "disk_free_gb": round(shutil.disk_usage(Path.home()).free / 1e9),
        "prompts": prompt_hashes(),
    }
    try:
        info["git"] = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "log", "-1", "--format=%h %s (%cd)", "--date=short"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        info["ollama"] = httpx.get(f"{ollama_host()}/api/version", timeout=5).json().get("version")
        info["ollama_loaded"] = [m["name"] for m in httpx.get(f"{ollama_host()}/api/ps", timeout=5).json().get("models", [])]
    except Exception as exc:  # the report still goes out when Ollama is down
        info["ollama_error"] = f"{type(exc).__name__}: {exc}"
    return info


# -- report ------------------------------------------------------------------


def _busy(log: StepLog) -> bool:
    """The worker's own lock was held (a manual or lab run), so it skipped."""
    return any(kind_of(f).key == "lock" for f in log.failures)


def _died(event: dict, log: StepLog) -> bool:
    return event["exit"] != 0 and not log.finished and not _busy(log)


def _clock(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%H:%M")


def _duration(seconds: float) -> str:
    minutes = int(seconds // 60)
    return f"{minutes // 60}h{minutes % 60:02d}m" if minutes >= 60 else f"{minutes}m"


def _counts(step: str, stats: dict[str, int]) -> str:
    keys = HEADLINE.get(step) or tuple(stats)
    return " · ".join(f"{stats[k]:,} {k.lower()}" for k in keys if stats.get(k))


def build_report(
    events: list[dict],
    *,
    now: datetime,
    hours: float = 24,
    backlog_now: dict | None = None,
    backlog_error: str | None = None,
    machine_info: dict | None = None,
    previous: dict | None = None,
    logs: dict[int, StepLog] | None = None,
) -> tuple[str, dict]:
    """(Markdown, summary dict saved next to it for tomorrow's comparison).

    logs maps id(event) to its parsed log (tests pass them in; otherwise each
    event's log file is read)."""
    machine_info = machine_info or {}
    parsed = {id(e): (logs or {}).get(id(e)) or read_step_log(e) for e in events}
    cycles: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        cycles[event["cycle"]].append(event)
    skipped = [c for c, evs in cycles.items() if any(e["step"] == "lock" for e in evs)]
    ran = {c: evs for c, evs in cycles.items() if c not in skipped}
    got_past_preflight = [
        c for c, evs in ran.items() if any(e["step"] == "preflight" and e["exit"] == 0 for e in evs)
    ]
    failed_steps = [e for evs in ran.values() for e in evs if _died(e, parsed[id(e)])]
    failures = [f for e in events for f in parsed[id(e)].failures]
    item_failures = [f for f in failures if f.item]

    if not ran:
        status = ("❌", f"No passes ran in the last {hours:g} hours. Check that the Mini is awake and the "
                  "job is loaded: launchctl print gui/$(id -u)/com.politmus.mac-mini-cycle")
    elif not got_past_preflight:
        status = ("❌", f"{len(ran)} pass(es) started and every one stopped at the preflight check.")
    elif failed_steps or len(got_past_preflight) < EXPECTED_CYCLES - 1:
        status = ("⚠️", f"Degraded: {len(got_past_preflight)} of {EXPECTED_CYCLES} passes ran, "
                  f"{len(failed_steps)} step(s) failed.")
    else:
        status = ("✅", f"Healthy: {len(got_past_preflight)} of {EXPECTED_CYCLES} passes ran and every step finished.")
    status_line = f"{status[0]} {status[1]}"
    if item_failures:
        status_line += f" {len(item_failures)} item(s) failed and will retry on their own."
    if skipped:
        status_line += f" {len(skipped)} pass(es) skipped because the previous one was still running."

    start = now - timedelta(hours=hours)
    host = machine_info.get("host", "the Mac Mini")
    out = [
        f"# Mac Mini report: {now:%a %b %-d, %Y}",
        "",
        status_line,
        "",
        f"Covers {start:%b %-d %H:%M} to {now:%b %-d %H:%M} ({now.astimezone().tzname()}). "
        f"Written by {host} at {now:%H:%M}.",
        "",
        "## What got done",
        "",
    ]
    totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for event in events:
        for key, value in parsed[id(event)].stats.items():
            totals[event["step"]][key] += value
    rows = [(STEPS[s], _counts(s, totals[s])) for s in STEPS if s in HEADLINE and totals.get(s)]
    if rows:
        out += ["| Step | Last 24 hours |", "|---|---|"] + [f"| {name} | {counts} |" for name, counts in rows]
    else:
        out.append("Nothing was processed.")

    out += ["", "## Backlog", ""]
    if backlog_now:
        before = (previous or {}).get("backlog") or {}
        out += ["| | Now | Last report | Change |", "|---|---:|---:|---:|"]
        for label, count in backlog_now.items():
            if label in before:
                change = count - before[label]
                out.append(f"| {label} | {count:,} | {before[label]:,} | {change:+,} |")
            else:
                out.append(f"| {label} | {count:,} | | |")
        out += ["", "Due means what the next pass would pick up: new, changed, failed and waiting to retry, "
                "or older than 30 days."]
    else:
        out.append(f"Couldn't count what's due ({backlog_error or 'not checked'}).")

    out += ["", "## Errors", ""]
    if not failures:
        out.append("None.")
    grouped: dict[str, list[Failure]] = defaultdict(list)
    for failure in failures:
        grouped[kind_of(failure).key].append(failure)
    for kind in KINDS:
        group = grouped.get(kind.key)
        if not group:
            continue
        out += [f"### {kind.title} ({len(group)})", ""]
        seen: dict[tuple, int] = defaultdict(int)
        for f in group:
            seen[(f.step, f.item, f.message[:300])] += 1
        for (step, item, message), times in list(seen.items())[:15]:
            where = f"{STEPS.get(step, step)}{' ' + item if item else ''}"
            repeat = f" ({times} passes)" if times > 1 else ""
            out.append(f"- {where}{repeat}: {message}")
        if len(seen) > 15:
            out.append(f"- …and {len(seen) - 15} more in the step logs")
        lines = fixes(kind, group)
        if lines:
            if kind.key in ("timeout", "truncated", "empty"):
                out += ["", "Failed items retry on their own (up to 5 attempts). If an id keeps showing up, "
                        "run this from the repo root:"]
            out += ["", "```bash", *lines, "```"]
        out.append("")

    out += ["## Passes", ""]
    if cycles:
        out += ["| Pass | Took | " + " | ".join(STEPS.values()) + " |", "|---" * (len(STEPS) + 2) + "|"]
        for cycle, evs in sorted(cycles.items()):
            began, ended = min(e["start"] for e in evs), max(e["end"] for e in evs)
            if cycle in skipped:
                out.append(f"| {_clock(began)} | | skipped: previous pass still running |" + " |" * (len(STEPS) - 1))
                continue
            by_step = {e["step"]: e for e in evs}
            cells = []
            for step in STEPS:
                event = by_step.get(step)
                if event is None:
                    cells.append("")
                elif event["exit"] == 0:
                    cells.append("✅")
                elif _busy(parsed[id(event)]):
                    cells.append("skipped: busy")
                elif not _died(event, parsed[id(event)]):
                    cells.append("✅ some items failed")
                else:
                    cells.append(f"❌ exit {event['exit']}")
            out.append(f"| {_clock(began)} | {_duration(ended - began)} | " + " | ".join(cells) + " |")
    else:
        out.append("None.")
    notes = [n for e in events for n in parsed[id(e)].notes]
    if notes:
        out += ["", "Code: " + "; ".join(dict.fromkeys(notes))]

    out += ["", "## Machine", ""]
    out.append(f"- Disk free: {machine_info.get('disk_free_gb', '?')} GB")
    if "ollama_error" in machine_info:
        out.append(f"- Ollama: not answering ({machine_info['ollama_error']})")
    elif machine_info.get("ollama"):
        loaded = ", ".join(machine_info.get("ollama_loaded") or []) or "none"
        out.append(f"- Ollama {machine_info['ollama']}, loaded now: {loaded}")
    if machine_info.get("git"):
        out.append(f"- Code: {machine_info['git']}")
    prompts = machine_info.get("prompts") or {}
    if prompts:
        changed = [n for n, h in prompts.items() if (previous or {}).get("prompts", {}).get(n) not in (None, h)]
        listed = ", ".join(f"{n} {h}" for n, h in prompts.items())
        out.append(f"- Prompts: {listed}" + (f" (changed since the last report: {', '.join(changed)})" if changed else ""))

    summary = {
        "date": now.strftime("%Y-%m-%d"),
        "status": status[0],
        "passes": len(got_past_preflight),
        "failed_steps": len(failed_steps),
        "item_failures": len(item_failures),
        "totals": {step: dict(stats) for step, stats in totals.items()},
        "backlog": backlog_now or {},
        "prompts": prompts,
    }
    return "\n".join(out).rstrip() + "\n", summary


def previous_summary(reports_dir: Path, today: str) -> dict | None:
    older = sorted(p for p in reports_dir.glob("*.json") if p.stem < today) if reports_dir.is_dir() else []
    return json.loads(older[-1].read_text()) if older else None


def make_report(now: datetime, hours: float) -> tuple[str, dict]:
    events = load_events(LOG_DIR / "events.jsonl", (now - timedelta(hours=hours)).timestamp(), now.timestamp())
    counts, error = None, None
    try:
        counts = backlog()
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    return build_report(
        events,
        now=now,
        hours=hours,
        backlog_now=counts,
        backlog_error=error,
        machine_info=machine(),
        previous=previous_summary(LOG_DIR / "reports", now.strftime("%Y-%m-%d")),
    )


# -- housekeeping and publishing --------------------------------------------


def prune(log_dir: Path, now: datetime, keep_days: int = KEEP_DAYS) -> None:
    """Drop step logs, event lines and local reports older than keep_days."""
    cutoff = (now - timedelta(days=keep_days)).timestamp()
    for path in list((log_dir / "steps").glob("*.log")) + list((log_dir / "reports").glob("*.*")):
        if path.stat().st_mtime < cutoff:
            path.unlink()
    events = log_dir / "events.jsonl"
    if events.is_file():
        kept = [line for line in events.read_text().splitlines() if _event_end(line) >= cutoff]
        events.write_text("".join(f"{line}\n" for line in kept))


def _event_end(line: str) -> float:
    try:
        return float(json.loads(line).get("end", 0))
    except (ValueError, AttributeError):
        return 0


BRANCH_README = """\
# Mac Mini reports

Written each morning by the Mac Mini's scheduled LLM workers
(scripts/mac_mini_cycle.sh and backend/mac_mini_report.py on main).
latest.md is the newest report; reports/ keeps one per day. No report for a
day means the Mini or its schedule is down. This branch is never merged.
"""


def _git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, check=check, capture_output=True, text=True, timeout=120)


def publish(reports_dir: Path, work_dir: Path, remote_url: str, branch: str = REPORT_BRANCH) -> bool:
    """Commit every local report to `branch` and push it. Returns whether a
    commit was pushed. Reports that failed to go out before go out now."""
    if not (work_dir / ".git").is_dir():
        work_dir.mkdir(parents=True, exist_ok=True)
        _git(work_dir, "init", "-q", "-b", branch)
        _git(work_dir, "remote", "add", "origin", remote_url)
    _git(work_dir, "remote", "set-url", "origin", remote_url)
    if _git(work_dir, "ls-remote", "--heads", "origin", branch).stdout.strip():
        _git(work_dir, "fetch", "-q", "origin", branch)
        _git(work_dir, "checkout", "-q", "-f", "-B", branch, "FETCH_HEAD")
        _git(work_dir, "clean", "-fdq")
    reports = sorted(reports_dir.glob("*.md"))
    if not reports:
        return False
    (work_dir / "reports").mkdir(exist_ok=True)
    for path in reports + sorted(reports_dir.glob("*.json")):
        shutil.copy2(path, work_dir / "reports" / path.name)
    shutil.copy2(reports[-1], work_dir / "latest.md")
    (work_dir / "README.md").write_text(BRANCH_README)
    _git(work_dir, "add", "README.md", "latest.md", "reports")
    if _git(work_dir, "diff", "--cached", "--quiet", check=False).returncode == 0:
        return False
    _git(
        work_dir,
        "-c", "user.name=Politmus Mac Mini", "-c", "user.email=mac-mini@politmus.invalid",
        "commit", "-q", "-m", f"Mac Mini report {reports[-1].stem}",
    )
    _git(work_dir, "push", "-q", "origin", f"HEAD:{branch}")
    return True


# -- preflight ---------------------------------------------------------------


def _tag(name: str) -> str:
    return name if ":" in name else f"{name}:latest"


def required_models() -> dict[str, str]:
    import bill_classifier
    import debate_worker
    import match_targets
    import official_positions
    from services.target_matching import DEFAULT_EMBED_MODEL

    return {
        "bill classifier": bill_classifier.DEFAULT_MODEL,
        "debate": debate_worker.DEFAULT_MODEL,
        "positions": official_positions.DEFAULT_MODEL,
        "target review": match_targets.DEFAULT_REVIEW_MODEL,
        "embeddings": DEFAULT_EMBED_MODEL,
    }


def preflight() -> int:
    """Print each check; non-zero when the cycle can't do useful work."""
    import httpx
    from sqlalchemy import text

    problems = []
    try:
        tags = httpx.get(f"{ollama_host()}/api/tags", timeout=10).json().get("models", [])
        pulled = {_tag(m["name"]) for m in tags}
        print(f"Ollama answers at {ollama_host()} ({len(pulled)} models pulled).")
        for use, model in required_models().items():
            if _tag(model) not in pulled:
                problems.append(f'model "{model}" not found for {use} (ollama pull {model})')
    except Exception as exc:
        problems.append(f"Ollama is not answering at {ollama_host()}: {type(exc).__name__}: {exc}")
    try:
        from database import SessionLocal

        session = SessionLocal()
        try:
            session.execute(text("SELECT 1"))
        finally:
            session.close()
        print("Database answers.")
    except Exception as exc:
        problems.append(f"Database: {type(exc).__name__}: {str(exc).splitlines()[0]}")
    for problem in problems:
        print(f"PROBLEM: {problem}")
    return 1 if problems else 0


# -- main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight", help="Check Ollama, the models and the database.")
    show = sub.add_parser("show", help="Print the report for the last --hours (writes nothing).")
    write = sub.add_parser("write", help="Save today's report, prune old logs, optionally push.")
    for p in (show, write):
        p.add_argument("--hours", type=float, default=24, help="Hours the report covers (default 24).")
    write.add_argument("--push", action="store_true", help=f"Commit the reports to the {REPORT_BRANCH} branch.")
    args = parser.parse_args(argv)

    if args.command == "preflight":
        return preflight()
    now = datetime.now().astimezone()
    markdown, summary = make_report(now, args.hours)
    if args.command == "show":
        print(markdown)
        return 0

    reports_dir = LOG_DIR / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / f"{summary['date']}.md").write_text(markdown)
    (reports_dir / f"{summary['date']}.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Report: {reports_dir / (summary['date'] + '.md')}")
    print(markdown.splitlines()[2])
    prune(LOG_DIR, now)
    if args.push:
        try:
            url = _git(REPO_ROOT, "remote", "get-url", "origin").stdout.strip()
            pushed = publish(reports_dir, LOG_DIR / "report-branch", url)
            print(f"Pushed to {REPORT_BRANCH}." if pushed else "Nothing new to push.")
        except subprocess.CalledProcessError as exc:
            print(f"Push failed (the report stays in {reports_dir} and goes out next time): "
                  f"{(exc.stderr or exc.stdout or '').strip()}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
