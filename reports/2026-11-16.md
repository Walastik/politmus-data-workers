# Mac Mini report: Mon Nov 16, 2026

✅ Healthy: 4 of 4 passes ran and every step finished.

Covers Nov 15 07:00 to Nov 16 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills |  |
| Debates |  |
| Target matching |  |
| Scoring | 2,694 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 15 | 8 | +7 |
| Candidates due | 66 | 293 | -227 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Another run was going (8)

- Officials' positions (4 passes): Official positions run failed: another official_positions run holds /var/folders/hs/zjssbmtj65x473x7st8d6cnc0000gp/T/politmus_official_positions.lock
- Candidates' positions (4 passes): Official positions run failed: another official_positions run holds /var/folders/hs/zjssbmtj65x473x7st8d6cnc0000gp/T/politmus_official_positions.lock

```bash
A manual or lab run held that worker's lock, so the step skipped this pass. Nothing to fix unless it repeats.
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 07:30 | 1m | ✅ | ✅ | ✅ | ✅ | skipped: busy | skipped: busy | ✅ | ✅ |
| 13:30 | 1m | ✅ | ✅ | ✅ | ✅ | skipped: busy | skipped: busy | ✅ | ✅ |
| 19:30 | 1m | ✅ | ✅ | ✅ | ✅ | skipped: busy | skipped: busy | ✅ | ✅ |
| 01:30 | 1m | ✅ | ✅ | ✅ | ✅ | skipped: busy | skipped: busy | ✅ | ✅ |

Code: Now at 24ae25a Skeleton placeholders instead of the P loader while content loads (#116)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: qwen3.6:27b
- Code: 24ae25a Skeleton placeholders instead of the P loader while content loads (#116) (2026-11-15)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
