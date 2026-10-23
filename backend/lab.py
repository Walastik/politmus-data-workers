"""Scoring lab: a small fixed set of bills and officials for tuning the bill
classifier, the stated-positions extractor, and accountability scoring.

    lab.py pick      choose the fixture (1 broad + 1 narrow bill, 3 officials per party)
    lab.py bills     re-classify the fixture bills
    lab.py positions re-extract the fixture officials from stored pages (no crawl)
    lab.py grade     embed new target names, review the fixture officials' name pairs, rescore
    lab.py all       bills, positions, grade, then report
    lab.py report    snapshot what is in the database now and diff it with the last run

The fixture and run snapshots live in LAB_DIR (default ~/politmus-lab), not in
the repo. Arguments after "--" go to the workers, e.g.
    lab.py positions -- --model gemma3:27b
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from database import SessionLocal
from services.accountability import (
    TARGET_MATCH_THRESHOLD,
    compute_alignments,
    passage_roll_call_ids,
    summarize,
    vote_results,
)

BACKEND_DIR = Path(__file__).resolve().parent
LAB_DIR = Path(os.getenv("LAB_DIR", Path.home() / "politmus-lab"))
FIXTURE_PATH = LAB_DIR / "fixture.json"
RUNS_DIR = LAB_DIR / "runs"
PROMPT_FILES = {
    "bills": BACKEND_DIR / "scripts" / "llm_config.py",
    "positions": BACKEND_DIR / "scripts" / "positions_llm_config.py",
}

BROAD_MIN_EFFECTS = 10
NARROW_MAX_EFFECTS = 6
PARTIES = ("Democratic", "Republican")


def chamber_of(office: str | None) -> str:
    return "Senate" if (office or "").lower().startswith("sen") else "House"


# -- pick --------------------------------------------------------------------


_OVERLAP_SQL = """
SELECT v.official_id, rc.bill_id, count(DISTINCT (e.target_id, e.mechanism)) AS overlaps
FROM votes v
JOIN roll_calls rc ON rc.id = v.roll_call_id
LEFT JOIN bill_effects e ON e.bill_id = rc.bill_id
LEFT JOIN official_stances s ON s.official_id = v.official_id
                            AND s.target_id = e.target_id
                            AND s.mechanism = e.mechanism
WHERE rc.id = ANY(:roll_call_ids) AND rc.bill_id = ANY(:bill_ids)
  AND v.position IN ('Yes', 'No')
  AND s.id IS NOT NULL
GROUP BY v.official_id, rc.bill_id
"""


def pick(args) -> int:
    session = SessionLocal()
    try:
        rc_ids = passage_roll_call_ids(session)
        chambers: dict[str, set[str]] = defaultdict(set)
        for bill_id, chamber in session.execute(
            text("SELECT bill_id, chamber FROM roll_calls WHERE id = ANY(:ids)"), {"ids": rc_ids}
        ):
            chambers[bill_id].add(chamber)
        effects = dict(session.execute(text(
            "SELECT b.id, count(e.id) FROM bills b JOIN bill_effects e ON e.bill_id = b.id "
            "WHERE b.classification_status = 'ok' GROUP BY b.id"
        )).all())
        candidates = [b for b in effects if chambers.get(b)]
        if not candidates:
            print("No classified bill has a passage vote.")
            return 1

        overlaps: dict[str, dict[str, int]] = defaultdict(dict)  # bill -> official -> n
        for official_id, bill_id, n in session.execute(
            text(_OVERLAP_SQL), {"roll_call_ids": rc_ids, "bill_ids": candidates}
        ):
            overlaps[bill_id][official_id] = n

        def best(pool):
            # Passed both chambers first, then most officials with an
            # overlapping position, then most overlaps.
            return max(
                pool,
                key=lambda b: (len(chambers[b]), len(overlaps[b]), sum(overlaps[b].values()), effects[b]),
                default=None,
            )

        kinds = {}
        broad = args.broad or best([b for b in candidates if effects[b] >= BROAD_MIN_EFFECTS])
        narrow = args.narrow or best([b for b in candidates if effects[b] <= NARROW_MAX_EFFECTS])
        for bill_id, kind in ((broad, "broad"), (narrow, "narrow")):
            if bill_id:
                kinds[bill_id] = kind
        # Senators and representatives both need a vote to grade: add a bill
        # for any chamber the picks do not cover.
        for chamber in ("Senate", "House"):
            if not any(chamber in chambers.get(b, ()) for b in kinds):
                extra = best([b for b in candidates if chamber in chambers[b] and b not in kinds])
                if extra:
                    kinds[extra] = f"{chamber.lower()} vote"
        bills = list(kinds)

        voted = defaultdict(set)  # official -> fixture bills voted Yes/No on
        for official_id, bill_id in session.execute(text(
            "SELECT DISTINCT v.official_id, rc.bill_id FROM votes v "
            "JOIN roll_calls rc ON rc.id = v.roll_call_id "
            "WHERE rc.id = ANY(:rc) AND rc.bill_id = ANY(:bills) AND v.position IN ('Yes', 'No')"
        ), {"rc": rc_ids, "bills": bills}):
            voted[official_id].add(bill_id)
        rows = session.execute(text(
            "SELECT o.id, o.name, o.party, o.office FROM officials o "
            "JOIN official_position_sync p ON p.official_id = o.id AND p.status = 'ok' "
            "WHERE o.id = ANY(:ids) "
            "AND EXISTS (SELECT 1 FROM official_source_pages sp "
            "            WHERE sp.official_id = o.id AND sp.is_current)"
        ), {"ids": list(voted)}).all()
        # Keep officials who voted on every fixture bill their chamber voted on.
        rows = [
            r for r in rows
            if voted[r.id] >= {b for b in bills if chamber_of(r.office) in chambers[b]}
        ]

        def rank(row):
            return -sum(overlaps[b].get(row.id, 0) for b in bills), row.id

        officials = []
        for party in PARTIES:
            pool = sorted((r for r in rows if r.party == party), key=rank)
            chosen = []
            for chamber in ("Senate", "House"):
                match = next((r for r in pool if chamber_of(r.office) == chamber and r not in chosen), None)
                if match:
                    chosen.append(match)
            chosen += [r for r in pool if r not in chosen][: args.per_party - len(chosen)]
            officials += chosen

        fixture = {
            "picked_at": datetime.now().isoformat(timespec="seconds"),
            "bills": [
                {"id": b, "effects": effects[b], "kind": kinds[b], "chambers": sorted(chambers[b])}
                for b in bills
            ],
            "officials": [
                {"id": r.id, "name": r.name, "party": r.party, "chamber": chamber_of(r.office),
                 "overlaps": {b: overlaps[b].get(r.id, 0) for b in bills}}
                for r in officials
            ],
        }
    finally:
        session.close()

    LAB_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"Wrote {FIXTURE_PATH}")
    for b in fixture["bills"]:
        print(f"  {b['kind']:<11} {b['id']}  ({b['effects']} effects, voted in {', '.join(b['chambers'])})")
    for o in fixture["officials"]:
        print(f"  {o['party']:<10} {o['chamber']:<6} {o['id']}  {o['name']}  overlaps={o['overlaps']}")
    print("Edit the file to swap anything, then run: lab.sh report")
    return 0


def load_fixture() -> dict:
    if not FIXTURE_PATH.is_file():
        sys.exit(f"{FIXTURE_PATH} not found. Run: lab.sh pick")
    return json.loads(FIXTURE_PATH.read_text())


# -- run the workers ---------------------------------------------------------


def run(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd), flush=True)
    code = subprocess.call(cmd, cwd=BACKEND_DIR)
    if code != 0:
        print(f"(exit {code})", flush=True)


def run_bills(fixture, extra) -> None:
    for bill in fixture["bills"]:
        run([sys.executable, "bill_classifier.py", "--bill-id", bill["id"], "--force", *extra])


def run_positions(fixture, extra) -> None:
    ids = [arg for o in fixture["officials"] for arg in ("--official-id", o["id"])]
    run([sys.executable, "official_positions.py", *ids, "--extract-only", "--force", *extra])


def run_grade(fixture, extra) -> None:
    ids = [arg for o in fixture["officials"] for arg in ("--official-id", o["id"])]
    run([sys.executable, "match_targets.py", *ids])
    run([sys.executable, "score_officials.py", *ids, *extra])


# -- report ------------------------------------------------------------------


def _row(mapping) -> dict:
    return {k: v for k, v in dict(mapping).items()}


def snapshot(fixture: dict) -> dict:
    bill_ids = [b["id"] for b in fixture["bills"]]
    official_ids = [o["id"] for o in fixture["officials"]]
    session = SessionLocal()
    try:
        bills = {}
        for b in session.execute(text(
            "SELECT id, title, policy_area, classification_status, classification_version, "
            "classification_error, classification_metadata FROM bills WHERE id = ANY(:ids)"
        ), {"ids": bill_ids}).mappings():
            meta = b["classification_metadata"] or {}
            bills[b["id"]] = {
                "title": b["title"],
                "policy_area": b["policy_area"],
                "status": b["classification_status"],
                "version": b["classification_version"],
                "error": b["classification_error"],
                "tldr": meta.get("tldr"),
                "eli5": meta.get("eli5"),
                "effects": {},
            }
        for e in session.execute(text(
            "SELECT e.*, t.name AS target_name FROM bill_effects e "
            "JOIN policy_targets t ON t.id = e.target_id WHERE e.bill_id = ANY(:ids)"
        ), {"ids": bill_ids}).mappings():
            row = _row(e)
            key = f"{row['target_name']} / {row['mechanism']}"
            bills[row["bill_id"]]["effects"][key] = {
                k: row.get(k) for k in ("direction", "magnitude", "relation", "rationale") if k in row
            }

        officials = {}
        for o in session.execute(text(
            "SELECT o.id, o.name, o.party, o.office, p.status, p.extractor_version, p.last_error "
            "FROM officials o LEFT JOIN official_position_sync p ON p.official_id = o.id "
            "WHERE o.id = ANY(:ids)"
        ), {"ids": official_ids}).mappings():
            officials[o["id"]] = {
                "name": o["name"], "party": o["party"], "chamber": chamber_of(o["office"]),
                "status": o["status"], "version": o["extractor_version"], "error": o["last_error"],
                "stances": {},
            }
        for s in session.execute(text(
            "SELECT s.*, t.name AS target FROM official_stances s "
            "JOIN policy_targets t ON t.id = s.target_id WHERE s.official_id = ANY(:ids)"
        ), {"ids": official_ids}).mappings():
            row = _row(s)
            key = f"{row['target']} / {row['mechanism']}"
            officials[row["official_id"]]["stances"][key] = {
                k: row.get(k)
                for k in ("direction", "stance", "policy_direction", "emphasis", "scope",
                          "policy_area", "issue_label", "summary", "evidence_quote", "source_url")
                if k in row
            }

        grading = {}
        alignments = compute_alignments(session, official_ids)
        for official_id in official_ids:
            rows = alignments.get(official_id, [])
            totals = summarize(rows)
            grading[official_id] = {
                "points": totals["points"],
                "alignment_pct": totals["alignment_pct"],
                "matches_total": len(rows),
                "matches": {
                    f"{a.bill_id} / {a.target_name} / {a.mechanism}": {
                        "points": a.points,
                        "vote": a.vote_position,
                        "chamber": a.chamber,
                        "bill_direction": a.effect_direction,
                        "wants": a.stance_direction,
                        "emphasis": a.stance_emphasis,
                        "scope": a.stance_scope,
                        "relation": a.effect_relation,
                        "magnitude": a.effect_magnitude,
                        "counted": a.counted,
                        "reason": a.reason,
                        "position_target": a.stance_target_name,
                        "similarity": a.match_similarity,
                        "inverse": a.match_inverse,
                    }
                    for a in rows
                    if a.bill_id in bill_ids
                },
                "votes": {
                    f"{vote_rows[0].bill_id} ({vote_rows[0].vote_position})": result
                    for vote_rows, result in vote_results(rows)
                    if vote_rows[0].bill_id in bill_ids
                },
                "near_misses": near_misses(session, official_id, bill_ids),
            }
    finally:
        session.close()

    return {
        "taken_at": datetime.now().isoformat(timespec="seconds"),
        "git": _git_rev(),
        "prompts": {name: _file_hash(path) for name, path in PROMPT_FILES.items()},
        "threshold": TARGET_MATCH_THRESHOLD,
        "fixture": fixture,
        "bills": bills,
        "officials": officials,
        "grading": grading,
    }


def near_misses(session, official_id: str, bill_ids: list[str]) -> list[dict]:
    """Stored name pairs between this official's positions and the fixture
    bills' intents (same mechanism) that do not match: reviewed unrelated,
    or unreviewed and below the threshold."""
    rows = session.execute(text(
        "SELECT DISTINCT e.bill_id, te.name AS bill_target, ts.name AS position_target, "
        "e.mechanism, m.similarity, m.verdict "
        "FROM bill_effects e "
        "JOIN official_stances s ON s.official_id = :official AND s.mechanism = e.mechanism "
        "JOIN target_matches m ON (m.target_a, m.target_b) IN ((e.target_id, s.target_id), (s.target_id, e.target_id)) "
        "JOIN policy_targets te ON te.id = e.target_id "
        "JOIN policy_targets ts ON ts.id = s.target_id "
        "WHERE e.bill_id = ANY(:bills) "
        "AND (m.verdict = 'unrelated' OR (m.verdict IS NULL AND m.similarity < :threshold)) "
        "ORDER BY m.similarity DESC"
    ), {"official": official_id, "bills": bill_ids, "threshold": TARGET_MATCH_THRESHOLD}).mappings()
    return [dict(r) for r in rows]


def _git_rev() -> str | None:
    try:
        rev = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=BACKEND_DIR, text=True).strip()
        dirty = subprocess.call(["git", "diff", "--quiet"], cwd=BACKEND_DIR) != 0
        return rev + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return None


def _file_hash(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10] if path.is_file() else None


def _cell(value) -> str:
    return " ".join(str(value if value is not None else "").split()).replace("|", "\\|")


def render(snap: dict) -> str:
    out = [
        f"# Lab run {snap['taken_at']}",
        "",
        f"git `{snap['git']}` · llm_config.py `{snap['prompts']['bills']}` · "
        f"positions_llm_config.py `{snap['prompts']['positions']}`",
        "",
        f"Target match threshold `{TARGET_MATCH_THRESHOLD}`",
        "",
        "## Bills",
    ]
    fixture_bills = {b["id"]: b for b in snap["fixture"]["bills"]}
    targets_by_bill = {}
    for bill_id, b in snap["bills"].items():
        kind = fixture_bills.get(bill_id, {}).get("kind", "")
        targets_by_bill[bill_id] = set(b["effects"])
        out += [
            "",
            f"### {bill_id} ({kind}, {len(b['effects'])} effects) — {b['title']}",
            "",
            f"Status `{b['status']}` · version `{b['version']}`" + (f" · error: {b['error']}" if b["error"] else ""),
            "",
            f"**TLDR:** {b['tldr'] or '—'}",
            "",
            f"**ELI5:** {b['eli5'] or '—'}",
            "",
            "| Target / mechanism | Direction | Magnitude | Relation | Rationale |",
            "|---|---|---|---|---|",
        ]
        for key, e in sorted(b["effects"].items()):
            out.append(
                f"| {_cell(key)} | {_cell(e.get('direction'))} | {_cell(e.get('magnitude'))} | "
                f"{_cell(e.get('relation', '—'))} | {_cell(e.get('rationale'))} |"
            )

    out += ["", "## Officials"]
    all_effect_keys = set().union(*targets_by_bill.values()) if targets_by_bill else set()
    for official_id, o in snap["officials"].items():
        g = snap["grading"].get(official_id, {})
        pct = f"{g['alignment_pct']}%" if g.get("alignment_pct") is not None else "n/a"
        out += [
            "",
            f"### {o['name']} ({o['party']}, {o['chamber']}) `{official_id}`",
            "",
            f"Positions: {len(o['stances'])} · status `{o['status']}` · version `{o['version']}`"
            + (f" · error: {o['error']}" if o["error"] else ""),
            "",
            f"**Score (all bills):** {g.get('points', 0):+d} points, {pct} aligned, "
            f"{g.get('matches_total', 0)} matches",
            "",
            "**Votes on the fixture bills:** "
            + (", ".join(f"{k} {v:+d}" for k, v in sorted(g.get("votes", {}).items())) or "none counted"),
            "",
            "**Matches on the fixture bills:**",
            "",
        ]
        matches = g.get("matches", {})
        if matches:
            out += ["| Pts | Counted | Vote | Bill / target / mechanism | Position target (similarity) "
                    "| Bill does | Magnitude | Relation | Wants | Emphasis | Scope | Reason |",
                    "|---|---|---|---|---|---|---|---|---|---|---|---|"]
            for key, m in sorted(matches.items()):
                position = (
                    f"{m.get('position_target')} ({m['similarity']:.2f}"
                    f"{', inverse' if m.get('inverse') else ''})"
                    if m.get("similarity") is not None else "same"
                )
                out.append(
                    f"| {m['points']:+d} | {'yes' if m.get('counted', True) else 'no'} | {m['vote']} | "
                    f"{_cell(key)} | {_cell(position)} | {m['bill_direction']} | {_cell(m.get('magnitude'))} | "
                    f"{_cell(m.get('relation'))} | {m['wants']} | {_cell(m['emphasis'])} | "
                    f"{_cell(m.get('scope'))} | {_cell(m.get('reason') or '')} |"
                )
        else:
            out.append("None.")
        misses = g.get("near_misses", [])
        if misses:
            out += ["", "**Near misses (similar names that did not match):**", "",
                    "| Similarity | Verdict | Bill | Bill target | Position target | Mechanism |",
                    "|---|---|---|---|---|---|"]
            for n in misses:
                verdict = n.get("verdict") or f"unreviewed, below {snap.get('threshold', TARGET_MATCH_THRESHOLD)}"
                out.append(
                    f"| {n['similarity']:.3f} | {_cell(verdict)} | {n['bill_id']} | {_cell(n['bill_target'])} | "
                    f"{_cell(n['position_target'])} | {n['mechanism']} |"
                )
        overlapping = {k: s for k, s in o["stances"].items() if k in all_effect_keys}
        out += ["", "**Positions on targets the fixture bills touch:**", ""]
        out += _stance_table(overlapping) if overlapping else ["None."]
        out += ["", "<details><summary>All positions</summary>", ""]
        out += _stance_table(o["stances"])
        out += ["", "</details>"]
    return "\n".join(out) + "\n"


def _stance_table(stances: dict) -> list[str]:
    lines = ["| Target / mechanism | Wants | Stance | Emphasis | Scope | Quote |", "|---|---|---|---|---|---|"]
    for key, s in sorted(stances.items()):
        lines.append(
            f"| {_cell(key)} | {_cell(s.get('direction'))} | {_cell(s.get('stance'))} {_cell(s.get('policy_direction'))} | "
            f"{_cell(s.get('emphasis'))} | {_cell(s.get('scope', '—'))} | {_cell(s.get('evidence_quote'))} |"
        )
    return lines


def _brief(value: dict, fields: tuple[str, ...]) -> str:
    return "/".join(str(value.get(f)) for f in fields if f in value)


def diff(old: dict, new: dict) -> list[str]:
    lines = []

    def compare(label, before, after, fields):
        for key in sorted(set(before) | set(after)):
            if key not in before:
                lines.append(f"  + {label}: {key} ({_brief(after[key], fields)})")
            elif key not in after:
                lines.append(f"  - {label}: {key} ({_brief(before[key], fields)})")
            elif _brief(before[key], fields) != _brief(after[key], fields):
                lines.append(f"  ~ {label}: {key}: {_brief(before[key], fields)} -> {_brief(after[key], fields)}")

    for bill_id in sorted(set(old["bills"]) | set(new["bills"])):
        b0, b1 = old["bills"].get(bill_id, {}), new["bills"].get(bill_id, {})
        for field in ("tldr", "eli5"):
            if b0.get(field) != b1.get(field):
                lines.append(f"  ~ {bill_id} {field} changed")
        compare(bill_id, b0.get("effects", {}), b1.get("effects", {}), ("direction", "magnitude", "relation"))
    for official_id in sorted(set(old["officials"]) | set(new["officials"])):
        o0, o1 = old["officials"].get(official_id, {}), new["officials"].get(official_id, {})
        name = o1.get("name") or o0.get("name") or official_id
        n0, n1 = len(o0.get("stances", {})), len(o1.get("stances", {}))
        if n0 != n1:
            lines.append(f"  ~ {name}: {n0} -> {n1} positions")
        compare(f"{name} position", o0.get("stances", {}), o1.get("stances", {}),
                ("direction", "emphasis", "scope"))
        g0, g1 = old["grading"].get(official_id, {}), new["grading"].get(official_id, {})
        if (g0.get("points"), g0.get("alignment_pct")) != (g1.get("points"), g1.get("alignment_pct")):
            lines.append(
                f"  ~ {name} score: {g0.get('points')} ({g0.get('alignment_pct')}%) -> "
                f"{g1.get('points')} ({g1.get('alignment_pct')}%)"
            )
        compare(f"{name} match", g0.get("matches", {}), g1.get("matches", {}),
                ("points", "counted", "reason", "position_target", "inverse"))
        compare(f"{name} vote", {k: {"net": v} for k, v in g0.get("votes", {}).items()},
                {k: {"net": v} for k, v in g1.get("votes", {}).items()}, ("net",))
    return lines


def report(fixture: dict) -> int:
    snap = snapshot(fixture)
    previous = sorted(RUNS_DIR.glob("*/snapshot.json")) if RUNS_DIR.is_dir() else []
    run_dir = RUNS_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "snapshot.json").write_text(json.dumps(snap, indent=2, default=str) + "\n")
    (run_dir / "report.md").write_text(render(snap))
    print(f"\nReport: {run_dir / 'report.md'}")
    for official_id, g in snap["grading"].items():
        o = snap["officials"].get(official_id, {})
        print(f"  {o.get('name', official_id):<28} {g['points']:+d} points, "
              f"{len(o.get('stances', {}))} positions, {len(g['matches'])} fixture matches")
    if previous:
        old = json.loads(previous[-1].read_text())
        changes = diff(old, json.loads(json.dumps(snap, default=str)))
        print(f"\nChanges since {previous[-1].parent.name}:")
        print("\n".join(changes) if changes else "  none")
        (run_dir / "diff.txt").write_text("\n".join(changes) + "\n")
    return 0


# -- main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    extra = []
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        argv = argv[: argv.index("--")]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("pick", help="Choose the fixture bills and officials.")
    p.add_argument("--broad", help="Use this broad bill instead of picking one.")
    p.add_argument("--narrow", help="Use this narrow bill instead of picking one.")
    p.add_argument("--per-party", type=int, default=3, help="Officials per party (default 3).")
    for name in ("bills", "positions", "grade", "all", "report"):
        sub.add_parser(name)
    args = parser.parse_args(argv)

    if args.command == "pick":
        return pick(args)
    fixture = load_fixture()
    if args.command in ("bills", "all"):
        run_bills(fixture, extra)
    if args.command in ("positions", "all"):
        run_positions(fixture, extra)
    if args.command in ("grade", "all", "bills", "positions"):
        run_grade(fixture, [])
    return report(fixture)


if __name__ == "__main__":
    raise SystemExit(main())
