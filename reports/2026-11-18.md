# Mac Mini report: Wed Nov 18, 2026

✅ Healthy: 4 of 4 passes ran and every step finished. 1 item(s) failed and will retry on their own.

Covers Nov 17 07:00 to Nov 18 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 99 bills selected · 99 ok (saved) · 235 intents saved |
| Debates | 3 due · 3 ok |
| Officials' positions | 10 officials selected · 9 extracted · 5 no positions found · 245 stances saved · 1 failed |
| Candidates' positions | 50 officials selected · 3 extracted · 41 stances saved · 46 failed |
| Target matching |  |
| Scoring | 3,240 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 2 | 0 | +2 |
| Candidates due | 0 | 20 | -20 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Model timeouts (1)

- Officials' positions C001056: RuntimeError: chunk 5/13 https://www.cornyn.senate.gov/key-issues/education/ [Education]: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in C001056; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 07:30 | 7m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 13:30 | 1h09m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 19:30 | 1h25m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 01:30 | 2h42m | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ some items failed | ✅ | ✅ |

Code: Now at 24ae25a Skeleton placeholders instead of the P loader while content loads (#116)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: none
- Code: 24ae25a Skeleton placeholders instead of the P loader while content loads (#116) (2026-11-15)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
