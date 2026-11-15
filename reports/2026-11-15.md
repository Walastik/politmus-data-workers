# Mac Mini report: Sun Nov 15, 2026

✅ Healthy: 4 of 4 passes ran and every step finished.

Covers Nov 14 07:00 to Nov 15 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 1 bills selected · 1 ok (saved) · 6 intents saved |
| Debates |  |
| Officials' positions |  |
| Candidates' positions | 75 officials selected · 62 extracted · 16 no positions found · 1,225 stances saved · 2 blocked · 6 failed |
| Target matching |  |
| Scoring | 2,159 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 8 | 0 | +8 |
| Candidates due | 293 | 1,144 | -851 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Another run was going (2)

- Officials' positions: Official positions run failed: another official_positions run holds /var/folders/hs/zjssbmtj65x473x7st8d6cnc0000gp/T/politmus_official_positions.lock
- Candidates' positions: Official positions run failed: another official_positions run holds /var/folders/hs/zjssbmtj65x473x7st8d6cnc0000gp/T/politmus_official_positions.lock

```bash
A manual or lab run held that worker's lock, so the step skipped this pass. Nothing to fix unless it repeats.
```

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 07:30 | 1h51m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 13:30 | 3h39m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 19:30 | 2h43m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 01:30 | 1m | ✅ | ✅ | ✅ | ✅ | skipped: busy | skipped: busy | ✅ | ✅ |

Code: Now at 49e8f70 Congress page: key vote numbers behind an info button (#111); Now at d68ca33 Candidates after Election Day: only winners and runners-up (#112)

## Machine

- Disk free: 812 GB
- Ollama 0.33.3, loaded now: qwen3.6:27b
- Code: d68ca33 Candidates after Election Day: only winners and runners-up (#112) (2026-11-14)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
