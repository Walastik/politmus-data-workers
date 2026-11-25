# Mac Mini report: Wed Nov 25, 2026

✅ Healthy: 3 of 4 passes ran and every step finished. 3 item(s) failed and will retry on their own.

Covers Nov 24 07:00 to Nov 25 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 18 bills selected · 18 ok (saved) · 35 intents saved |
| Debates | 1 due · 1 ok |
| Officials' positions | 57 officials selected · 43 extracted · 7 no positions found · 1,380 stances saved · 4 blocked · 3 failed |
| Candidates' positions |  |
| Target matching |  |
| Scoring | 3,240 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 2 | 19 | -17 |
| Candidates due | 0 | 0 | +0 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Model timeouts (3)

- Officials' positions E000299 (2 passes): RuntimeError: chunk 8/21 https://escobar.house.gov/issues/issue/?IssueID=15496 [Immigration]: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think
- Officials' positions M001225: RuntimeError: chunk 1/17 https://kevinmullin.house.gov/2025/02/04/rep-mullin-fights-back-against-trumps-harmful-policies-chaos/: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in E000299 M001225; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 01:32 | 7h55m |  |  |  |  | ✅ some items failed | ✅ | ✅ | ✅ |
| 13:30 | 2h54m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ | ✅ |
| 19:30 | 2h25m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ | ✅ |
| 01:30 | 2h38m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Code: Now at e38768a Rescore without filling the database disk (#117)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: none
- Code: e38768a Rescore without filling the database disk (#117) (2026-11-22)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
