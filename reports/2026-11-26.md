# Mac Mini report: Thu Nov 26, 2026

✅ Healthy: 4 of 4 passes ran and every step finished. 2 item(s) failed and will retry on their own.

Covers Nov 25 07:00 to Nov 26 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 71 bills selected · 71 ok (saved) · 164 intents saved |
| Debates | 2 due · 2 ok |
| Officials' positions | 7 officials selected · 1 extracted · 137 stances saved · 4 blocked · 2 failed |
| Candidates' positions |  |
| Target matching |  |
| Scoring | 3,240 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 1 | 2 | -1 |
| Candidates due | 0 | 0 | +0 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Model timeouts (2)

- Officials' positions M001225: RuntimeError: chunk 1/17 https://kevinmullin.house.gov/2025/02/04/rep-mullin-fights-back-against-trumps-harmful-policies-chaos/: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think
- Officials' positions E000299: RuntimeError: chunk 8/21 https://escobar.house.gov/issues/issue/?IssueID=15496 [Immigration]: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in M001225 E000299; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 07:30 | 27m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ | ✅ |
| 13:30 | 1h06m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ | ✅ |
| 19:30 | 1h40m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 01:30 | 1h11m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Code: Now at e38768a Rescore without filling the database disk (#117)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: none
- Code: e38768a Rescore without filling the database disk (#117) (2026-11-22)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
