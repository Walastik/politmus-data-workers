# Mac Mini report: Sun Nov 22, 2026

✅ Healthy: 3 of 4 passes ran and every step finished.

Covers Nov 21 07:00 to Nov 22 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 103 bills selected · 103 ok (saved) · 289 intents saved |
| Debates | 7 due · 7 ok |
| Officials' positions | 100 officials selected · 59 extracted · 10 no positions found · 1,812 stances saved · 1 blocked |
| Candidates' positions |  |
| Target matching |  |
| Scoring | 3,256 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 84 | -84 |
| Officials due | 75 | 41 | +34 |
| Candidates due | 0 | 0 | +0 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Database connection (1)

- Bills: accountability rescore failed: OperationalError: (psycopg2.errors.DiskFull) could not write to file "base/pgsql_tmp/pgsql_tmp11604.5": No space left on device

```bash
Check DATABASE_URL in .env and the Fly connection (fly status -a politmus-db); the next pass retries.
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 03:18 | 4h16m |  |  |  |  | ✅ | ✅ | ✅ | ✅ |
| 13:30 | 5h58m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 19:30 | 5h33m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 01:30 | 4h12m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Code: Now at 24ae25a Skeleton placeholders instead of the P loader while content loads (#116)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: none
- Code: 24ae25a Skeleton placeholders instead of the P loader while content loads (#116) (2026-11-15)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
