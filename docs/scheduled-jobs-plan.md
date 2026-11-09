# Scheduled jobs: put the Mac Mini to work, fix late ingests, keep the private-repo option

Updated 2026-11-05 against `main` at `6d2abdb`. Replaces the 2026-10-30 "private repo migration" plan.

## Status
- **Done (2026-11-09):** step 1 (Mac Mini schedule and daily report) and step 2 (Ballot Nominees removed). The setup on the Mini is in the README under "Mac Mini schedule". The watchdog Action was left out for now.
  - Built as planned, except:
    - The status script is `./scripts/mac_mini_report.sh show`, not a separate `mac_mini_status.sh`.
    - The report runs at 07:00, before the 07:30 pass.
    - A worker exits 1 when any item fails, so the report treats a step that printed its summary as finished with failed items, not as failed.
- **Next:** run it on the Mini for a week or two, then step 3.

## Why
- **The Mac Mini (`dexter-mini`) sits idle.**
  - The LLM workers (bill classifier, debate, official and candidate positions, target matching) only run when someone starts them by hand.
  - So bill summaries and intents, "Where the sides disagree", stated positions and scores fall behind the ingested data.
  - Nothing schedules them. There's no crontab and no LaunchAgent for them.
- **GitHub runs this repo's schedules hours late.**
  - PR #90 found the `*/5` Election Results schedule never fired on Election Night, and the daily Wikidata ingest ran 7.5 hours late.
  - Every ingest workflow has the same problem, whether or not the repo goes private.
- **Going private is still undecided.** This plan keeps that option open without depending on it.

## What changed on `main` since the last plan
- **Election Results** (`.github/workflows/election-results.yml`, `backend/election_results.py`, PRs #85 and #90):
  - It runs on GitHub's runners in a self-chaining 5.5-hour loop, which is about **1,440 Actions minutes a day** while it runs. A run is in progress now.
  - It publishes to the `election-results-data` branch, and the `/results` page reads it from `raw.githubusercontent.com/Walastik/politmus-data-workers/...` (`RESULTS_SNAPSHOT_URL` in `packages/core/src/electionResults.ts`).
  - **That URL stops working if the repo goes private,** so this is now a hard blocker for going private (step 7).
  - `docs/deploy.md` already notes it could run from the Mac Mini instead.
- **Ballot Nominees** (`ballot-nominees.yml`) does nothing after Election Day, and its own comment says to remove the schedule then.
- The website moved to `apps/app` (Expo). Deploys are documented in `docs/deploy.md`. None of this affects the backend jobs.
- Actions usage, 2026-10-29 to 11-05 (before the election loop got going): about 1,584 min/week. That's FEC Finance Detail 992, Congress 384, FEC 91, Ballot 55, Wikidata 25, Senate 16, OpenStates 15.

## Where each job should run

| Work | Where | Status |
|---|---|---|
| Bill classifier, debate, positions (officials and candidates), target-matching catch-up, rescoring | **Mac Mini**, launchd, local Ollama | New (step 1). **Do first** |
| Congress, FEC, OpenStates, Wikidata ingests | **`politmus-api` Fly machine**, supercronic beside uvicorn, off hours | Step 3: fixes late GitHub schedules. Still on Actions until then |
| Ballot Nominees | Retire | Step 2 |
| Senate votes | Actions while the repo is public (16 min/week, free). Mac Mini if it goes private | Step 6 |
| Election results | Actions until certification, then disable. Mac Mini if it has to run longer or the repo goes private | Step 7 |
| Full reprocess after a prompt or model change | Mac Mini Ollama by default. Hosted API (OpenRouter or DeepSeek) only if a backfill would take days | Step 5, optional |

## Steps

### 1. Mac Mini LLM schedule (do first)
Goal: the Mini keeps everything the models write up to date without anyone starting it.

**Before scheduling, check the Mini by hand.** Today it isn't reachable from the laptop: SSH and Ollama on `100.111.217.18:11434` time out, which is expected if Ollama only listens on localhost.
- `cd ~/…/politmus-data-workers && git pull`. Check `backend/venv` exists and `pip install -r backend/requirements.txt -r backend/requirements-worker.txt`.
- Check that `.env` has `DATABASE_URL` pointing at Fly, as `docs/scoring-tuning.md` assumes. Note how it connects: a `flyctl proxy` that has to be running, or a WireGuard peer. A scheduled job needs it to work unattended. If it uses `flyctl proxy`, the wrapper must start the proxy (the retry loop in `.github/workflows/senate-votes-ingest.yml` does this).
- Check the prompt files are present and match the laptop: `shasum backend/scripts/llm_config.py backend/scripts/positions_llm_config.py | cut -c1-10`.
- `ollama list` shows `BILL_CLASSIFIER_MODEL` (`qwen3.6:27b`), `OFFICIAL_POSITIONS_MODEL` (`nemotron-3.5-lightning:30b`) and `nomic-embed-text`. Ollama has `OLLAMA_NUM_PARALLEL=2`.
- `pmset -g` shows `sleep 0` (system sleep off). launchd doesn't run jobs while the Mac is asleep.
- See how far behind it is: `./scripts/run_classifier.sh --report`, and the positions report.

**Catch up once by hand, before turning the schedule on.** These are the existing commands from the README and `docs/scoring-tuning.md`:
```bash
caffeinate -i ./scripts/run_classifier.sh 2>&1 | tee -a ~/bill_classifier.log
caffeinate -i ./scripts/run_debate.sh 2>&1 | tee -a ~/debate.log
caffeinate -i ./scripts/run_positions.sh --limit 0 2>&1 | tee -a ~/official_positions.log
caffeinate -i ./scripts/run_positions.sh --level candidate --limit 0 2>&1 | tee -a ~/candidate_positions.log
cd backend && venv/bin/python match_targets.py && cd .. && ./scripts/run_scoring.sh
```

**New files (repo):**
- `scripts/mac_mini_cycle.sh`: one pass, run in order so only one model is loaded at a time.
  1. Hold a lock (`/usr/bin/lockf -t 0 ~/Library/Caches/politmus/cycle.lock`) so passes never overlap. Each worker's own `run_lock` stays as a second guard.
  2. Run `git pull --ff-only` on `main`, and skip it if the tree is dirty or on another branch. The Mini then follows merged code, and the gitignored prompts aren't affected.
  3. Check first and stop with a clear log line if a check fails: Ollama answers on `/api/tags`, and the DB is reachable (`python -c` with `SELECT 1`).
  4. Bills:
     - `run_classifier.sh --limit 60`: due bills only, newest first.
     - `run_debate.sh --limit 30`.
  5. Positions:
     - `run_positions.sh --limit 25`, for officials whose pages are due under `--max-age-days`.
     - `run_positions.sh --level candidate --limit 25`.
  6. Catch-up:
     - `match_targets.py`, then `run_scoring.sh`. Incremental, with no model calls for scoring.
  7. Logging:
     - Each step's exit code goes to `~/Library/Logs/politmus/cycle.log`.
     - A failed step is logged and the pass moves on, like the election loop does.
  - The limits keep one pass to about 2-3 hours on the Mini. They're env-overridable (`CYCLE_BILL_LIMIT`, etc.) so you can tune them without editing the script.
- `scripts/launchd/com.politmus.mac-mini-cycle.plist`:
  - `StartCalendarInterval` every 6 hours (01:30, 07:30, 13:30, 19:30 Central). That lands after the 00:00/12:00 UTC Congress ingest even when it runs late.
  - The script wraps itself in `caffeinate -i`.
  - stdout and stderr go to `~/Library/Logs/politmus/`.
  - `RunAtLoad` is false. A missed time (Mac off) runs once at wake, which is launchd's default for calendar jobs.
- `scripts/install_mac_mini_jobs.sh`:
  - Fills the repo path into the plist and copies it to `~/Library/LaunchAgents/`.
  - Runs `launchctl bootout` then `bootstrap gui/$(id -u)`.
  - `--uninstall` removes it.
- `scripts/mac_mini_status.sh`: shows the last 5 cycle results from the log, plus `run_classifier.sh --report` and the positions report, so "is it stale?" takes one command.
- README section "Mac Mini schedule", and the matching line in `docs/scoring-tuning.md`: "stop full runs first" now also means `launchctl bootout` the cycle, or let the lock refuse you.

**Daily health report, pushed to GitHub.**
You'll read it on GitHub, so local disk space isn't a concern, and a missing report is itself the alarm.
- **Where it goes:**
  - The `mac-mini-reports` branch, which never merges into main. It holds `latest.md`, overwritten daily, plus `reports/YYYY-MM-DD.md`.
  - Each day is one normal commit, so git keeps the history and the files stay tiny.
  - Read it at `github.com/Walastik/politmus-data-workers/blob/mac-mini-reports/latest.md`, or with `gh api`/`git log origin/mac-mini-reports`.
- **Why a branch instead of a daily PR:**
  - Nothing to merge, and no daily commits on `main`.
  - No pile-up of conflicting PRs on days you don't check.
  - "Protect main" doesn't apply to it, and it still works if the repo goes private.
- **Structured events from the cycle:** `mac_mini_cycle.sh` appends one JSON line per step to `~/Library/Logs/politmus/events.jsonl`, with:
  - cycle id, step, start, end, exit code
  - the step's log file
  - the worker's final stats line (processed, failed, skipped counts; every worker already prints one)
- **The report script, `backend/mac_mini_report.py`:** run daily at 07:00 local time (before the 07:30 pass) by `com.politmus.mac-mini-report.plist`. It turns the last 24 hours of events and logs into Markdown:
  - **Status line:** ✅ healthy, ⚠️ degraded (some steps failed), or ❌ nothing ran or every pass failed.
  - **Cycles:** each pass's time, duration, and each step's ok/failed and counts.
  - **Totals:** bills classified, debates written, officials and candidates extracted, matches, rescored officials, failures.
  - **Backlog:**
    - due bills and officials, from `run_classifier.sh --report` and the positions report. These are read-only queries; nothing new is written to the DB.
    - the change since yesterday's report, so you can see whether it's catching up.
  - **Errors grouped by kind, with the fix:** the script matches known log patterns:

    | Error | Suggested fix |
    |---|---|
    | Ollama timeout on a bill or official | The `--timeout 3600` retry command with the IDs filled in |
    | Truncated output | Raise `--num-predict` |
    | Ollama down | `brew services restart ollama` / open Ollama.app |
    | Model missing | `ollama pull <tag>` |
    | DB unreachable | Check the Fly connection |
    | Lock held | A long run is still going |
    | `git pull` skipped | Dirty tree or wrong branch |
    | `target matching failed` / `rescore failed` | Catch-up commands |

    Anything unrecognized goes in a raw "Other errors" list with the last few lines.
  - **Machine:** free disk space, Ollama version and loaded models, git commit, prompt file hashes, and whether they changed since the last report.
- **Cleanup in the same job:**
  - Delete local step logs and event lines older than 7 days.
  - Push with the Mini's own credentials: a fine-grained token limited to this repo's contents, or `gh auth login` on the Mini.
  - If the push fails, the report stays in `~/Library/Logs/politmus/reports/` and goes out with the next day's push.
- **Optional watchdog, so you hear about it without checking:** a small daily GitHub Action that opens or updates an issue (which notifies you) when the newest commit on `mac-mini-reports` is more than 30 hours old. It uses about 1 minute a day. GitHub's late schedules don't matter at that threshold, and you can drop it if the repo goes private.

**Verify:**
- `backend/scripts/mac_mini_report.py --dry-run` prints a report from the current logs. Tests use a fixture `events.jsonl` with one healthy pass, one failed step, and one timeout, and check the grouping and the fix commands.
- `scripts/mac_mini_cycle.sh` run by hand completes one pass, and `launchctl kickstart gui/$(id -u)/com.politmus.mac-mini-cycle` does the same through launchd.
- The next morning, `mac_mini_status.sh` shows passes at the scheduled times and fewer bills and officials due.
- The next morning, `mac-mini-reports/latest.md` on GitHub shows those passes. Stop Ollama for one cycle and check that the next report flags it with the restart command.
- `lab.sh` still works. It refuses to run while a cycle holds the worker lock, which is the existing behavior.

### 2. Retire Ballot Nominees
Delete `.github/workflows/ballot-nominees.yml`. Election Day has passed and the script no longer does anything. Keep `ballot_wikipedia.py` for the next cycle.

### 3. Ingest cron on the existing `politmus-api` machine (fixes late schedules)
This is unchanged from the last plan. It's now worth doing even if the repo stays public, because it fixes the late GitHub schedules.
- Add `backend/crontab`, porting `ingest.yml`, `fec-ingest.yml`, `fec-finance.yml`, `openstates-ingest.yml` and `wikidata-ingest.yml`.
  - Replace each `fly-ssh.sh "…"` with a direct `python /app/…` call, wrapped in `flock -n /tmp/<group>.lock` to match the current `concurrency` groups (`fec-ingest` covers fec-ingest and fec-finance).
  - Move the times to US off hours where the job allows. FEC Finance keeps its every-3-hours pace, because the FEC key's 1,000 requests/hour budget sets it.
- In `backend/Dockerfile`, install supercronic (pinned version and checksum). Add `backend/start.sh`: `supercronic /app/crontab &` then `exec uvicorn …`.
- One machine (`min_machines_running = 1`), so each job runs once. A deploy restarts a running job, and every job resumes where it stopped.
- You deploy (see `docs/deploy.md`). Watch `fly logs -a politmus-api` for a week, then delete the ported workflows and `.github/scripts/fly-ssh.sh`.
- Order it after step 1, so the Mini's 6-hour cycle picks up new bills a few hours after ingest.

### 4. Lab: compare models quickly and cheaply
Extend `backend/lab.py` / `scripts/lab.sh`, which already exist (fixture of 1 broad and 1 narrow bill plus 3 officials per party; bills → positions from stored pages → grade → report and diff):
- Add `--provider/--model/--label`.
  - The `ollama` preset is today's setup. `openrouter` and `deepseek` come with step 5.
  - The model and provider go into `snapshot.json` and `report.md`.
  - The run folder is named `<time>-<label>`.
- `lab.sh crawl` re-crawls only the fixture officials (`--crawl-only`).
- `lab.sh compare <runA> <runB>` reuses `diff()` on any two saved runs.
- When usage is logged (step 5), the report shows tokens, seconds and dollars, plus a projected full-reprocess cost.
- Useful even with Ollama only: comparing `qwen3.6:27b` against another local model, or one prompt against another, is the same loop.

### 5. Hosted-model backend (optional: only for big backfills)
Unchanged from the last plan. Do it only when a prompt or model change makes a full reprocess too slow on the Mini.
- In `backend/services/llm_runtime.py`, add an `openai` provider next to Ollama.
  - It's driven by env (`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_USAGE_LOG`).
  - It maps the schema to `response_format`, `num_predict` to `max_tokens`, and `finish_reason=length` to the existing truncation retry.
  - It keeps the existing errors.
- Call sites: `bill_classifier.py:390`, `official_positions.py:147/426`, `debate_worker.py:164`, `services/target_matching.py:107`. Embeddings stay on Ollama.
- Compare on the lab first: OpenRouter with Qwen3.6 27B (the same model as today), against DeepSeek V4.1 Flash direct (cheapest off-peak).
- Changing the model makes everything due again (it's part of each worker's version). So the scheduled Mini cycle must use the same model as the backfill. Pick one model for both.

### 6. Senate votes
- While public: leave it on Actions.
- If going private: add `scripts/run_senate_votes.sh` (with the `flyctl proxy` retry loop from the workflow) as a step in `mac_mini_cycle.sh`, or as its own plist twice a day. The Mini's residential IP is what Senate.gov accepts. Then delete `senate-votes-ingest.yml`.

### 7. Going private (when you decide)
Blockers, in order:
1. **The election results page reads the snapshot from public raw GitHub.** Either retire the page and loop after certification, or move the snapshot first. The simplest move is an API endpoint that serves the latest snapshot stored in Postgres, with the writer running on the Mac Mini or the Fly cron. Then update `RESULTS_SNAPSHOT_URL` and deploy the site.
2. **Actions minutes.** After steps 2, 3 and 6, plus the election loop off, Actions uses about 0 min/month.
3. **The "Protect main" ruleset isn't enforced on a private repo** on a personal Free account (Pro is about $4/month). There's one public fork (`ccNatang/politmus-data-workers`, 2026-09-08), and it stays public.

## Notes for implementation
- Base the branch on current `main`. This worktree (`Walastik/kahawai`) is at `3a14b94`, so rebase or recreate it before starting.
- Ruled out earlier:
  - OpenCode Go: its terms say it's for coding-agent traffic, and it allows 160 requests per 5h on Qwen3.8 Max.
  - A Tailscale/Mullvad VPN for the Mini: Senate.gov blocks VPN and datacenter IPs, and the other APIs limit by key, not IP.
- You deploy Fly yourself (`docs/deploy.md`). Steps 1, 2 and 4 need no deploy. Step 3 does.
