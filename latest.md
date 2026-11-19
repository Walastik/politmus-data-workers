# Mac Mini report: Thu Nov 19, 2026

✅ Healthy: 4 of 4 passes ran and every step finished. 1 item(s) failed and will retry on their own.

Covers Nov 18 07:00 to Nov 19 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 37 bills selected · 37 ok (saved) · 119 intents saved |
| Debates | 3 due · 3 ok |
| Officials' positions | 31 officials selected · 20 extracted · 2 no positions found · 860 stances saved · 1 failed |
| Candidates' positions | 25 officials selected · 1 extracted · 1 no positions found · 1 blocked · 23 failed |
| Target matching |  |
| Scoring | 3,245 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 24 | 2 | +22 |
| Candidates due | 0 | 0 | +0 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Model timeouts (1)

- Officials' positions M001225: RuntimeError: chunk 1/16 https://kevinmullin.house.gov/2025/02/04/rep-mullin-fights-back-against-trumps-harmful-policies-chaos/: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in M001225; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 07:30 | 2h11m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 13:30 | 1h37m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 19:30 | 2h17m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 01:30 | 3h21m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ some items failed | ✅ | ✅ |

Code: Now at 24ae25a Skeleton placeholders instead of the P loader while content loads (#116)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: none
- Code: 24ae25a Skeleton placeholders instead of the P loader while content loads (#116) (2026-11-15)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
