# Tuning accountability scoring

How to change the bill prompt, the positions prompt, or the scoring rules and
see the effect on a few officials and bills in minutes, before paying for a
full sweep. Run everything on the Mac Mini from the repo root (it has Ollama
and `DATABASE_URL` pointing at Fly). The commands and options are described in
the README under `score_officials.py`, target matching, and `lab.py`.

## Before you start

1. **Code changes:** make them on the laptop, push, then `git pull` on the Mac
   Mini.
2. **Prompt changes:** the prompts are gitignored local files. Edit them on the
   laptop and paste the whole files onto the Mac Mini:
   - `backend/scripts/llm_config.py` (bills)
   - `backend/scripts/positions_llm_config.py` (positions)

   Check that both machines have the same copy by comparing hashes:

   ```bash
   shasum backend/scripts/llm_config.py backend/scripts/positions_llm_config.py | cut -c1-10
   ```

   Each lab report records these hashes, so you can tell which prompt produced
   which result.
3. **Stop full worker runs first.** The lab runs the same workers against the
   same database, and `lab.sh positions` takes the positions worker's lock.

## The fixture

The lab works on a fixed set saved in `~/politmus-lab/fixture.json`: one broad
bill, one narrow bill, a bill for any chamber those miss, and three officials
per party who voted on them.

```bash
./scripts/lab.sh pick                                         # let it choose
./scripts/lab.sh pick --broad 119-s-1071 --narrow 119-hr-22   # choose the bills yourself
./scripts/lab.sh pick --per-party 4                           # more officials
```

To test a specific case (an official or bill that scored wrong), edit
`fixture.json` and copy an existing entry's shape. Picking again overwrites the
file, so save a copy first if you've edited it by hand.

## The loop

1. **Baseline:** snapshot what is stored now, before changing anything.

   ```bash
   ./scripts/lab.sh report
   ```

2. **Make one change,** then run only the step it affects:

   | You changed | Run | What it does |
   |---|---|---|
   | Bill prompt (`llm_config.py`) or the classifier | `./scripts/lab.sh bills` | Re-classifies the fixture bills, then regrades |
   | Positions prompt (`positions_llm_config.py`) or the extractor | `./scripts/lab.sh positions` | Re-extracts the fixture officials from stored pages (no crawl), then regrades |
   | Scoring rules (`services/accountability.py`) or target matching | `./scripts/lab.sh grade` | Reviews the fixture's near-name pairs and rescores (no model calls except the pair review) |
   | Several of these | `./scripts/lab.sh all` | Bills, positions, grade |

   Arguments after `--` go to the worker, for example a longer timeout for a
   big bill or a different model:

   ```bash
   ./scripts/lab.sh bills -- --timeout 3600
   ./scripts/lab.sh positions -- --model gemma3:27b --timeout 1800
   ```

3. **Read the diff.** Each run prints what changed since the previous run and
   saves it under `~/politmus-lab/runs/<time>/`:
   - `diff.txt`: effects and positions added, removed, or relabelled, and
     score and vote changes;
   - `report.md`: the full picture per official, including near misses (similar
     target names that did not match) and their review verdicts.

   Lines to look for: `~ <bill>: Target / mechanism: increase -> decrease` (a
   label flipped), `~ <official> vote: <bill> (Yes): -1 -> 1` (a score
   flipped), and `+`/`-` positions.

4. Repeat steps 2 and 3 until the diff only shows changes you meant to make.

**Expect some noise.** The model runs at temperature 0, but positions still
vary a little between extractions. When a position unrelated to your change
flips direction, re-run the same step once before deciding your change caused
it.

## Quick checks without the lab

```bash
cd backend
venv/bin/python official_positions.py --show O000172            # one official's stored positions
venv/bin/python bill_classifier.py --show 119-hr-22             # one bill's stored effects
venv/bin/python match_targets.py --neighbors "Voter Registration"   # near names and verdicts
cd ..
./scripts/run_scoring.sh --show O000172                         # score and every match, with reasons
./scripts/run_scoring.sh --official-id O000172 --dry-run        # rescore one official, write nothing
TARGET_MATCH_THRESHOLD=0.8 ./scripts/lab.sh grade               # try a different near-match threshold
```

`lab.sh positions` re-reads stored pages only. To re-crawl one official's site
first: `./scripts/run_positions.sh --official-id O000172 --force`.

## Rolling a change out to everyone

Once the lab diff looks right:

1. **Scoring rule change:** bump `ENGINE_VERSION` in
   `backend/services/accountability.py`, merge, then run
   `./scripts/run_scoring.sh --all`. This takes seconds and makes no model
   calls.
2. **Prompt change:** paste the final prompt files onto the Mac Mini. A prompt
   change makes every bill or official due again. Run whichever side changed:

   ```bash
   caffeinate -i ./scripts/run_classifier.sh 2>&1 | tee -a ~/bill_classifier.log
   caffeinate -i ./scripts/run_positions.sh --limit 0 --concurrency 4 --timeout 1800 2>&1 | tee -a ~/official_positions.log
   ```

   To re-extract positions from stored pages without crawling, add
   `--extract-only` to the positions run.
3. **Catch-up pass** after either full run:

   ```bash
   cd backend && venv/bin/python match_targets.py && cd ..
   ./scripts/run_scoring.sh
   ```

   The workers rescore and match as they go. This pass picks up anything that
   failed partway. Search the logs for `target matching failed` or
   `rescore failed` first.
4. **Retry single failures** (usually timeouts on long bills) with a longer
   timeout:

   ```bash
   for id in 119-hr-1 119-hr-5371; do
     ./scripts/run_classifier.sh --bill-id "$id" --timeout 3600
   done
   ./scripts/run_positions.sh --official-id O000172 --force --timeout 3600
   ```
