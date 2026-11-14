# Mac Mini report: Sat Nov 14, 2026

✅ Healthy: 4 of 4 passes ran and every step finished. 16 item(s) failed and will retry on their own.

Covers Nov 13 07:00 to Nov 14 07:00 (CST). Written by dexter-mini at 07:00.

## What got done

| Step | Last 24 hours |
|---|---|
| Bills | 96 bills selected · 96 ok (saved) · 234 intents saved |
| Debates | 7 due · 7 ok |
| Officials' positions | 1 officials selected · 1 extracted · 67 stances saved |
| Candidates' positions | 100 officials selected · 50 extracted · 13 no positions found · 674 stances saved · 1 blocked · 41 failed |
| Target matching |  |
| Scoring | 1,841 unchanged |

## Backlog

| | Now | Last report | Change |
|---|---:|---:|---:|
| Bills due | 0 | 0 | +0 |
| Officials due | 0 | 0 | +0 |
| Candidates due | 1,144 | 1,196 | -52 |

Due means what the next pass would pick up: new, changed, failed and waiting to retry, or older than 30 days.

## Errors

### Model timeouts (1)

- Candidates' positions H2IA02111: RuntimeError: chunk 3/4 https://bohannanforcongress.com/priorities/ [Priorities]: Ollama did not answer within 900s; raise --timeout (or OFFICIAL_POSITIONS_TIMEOUT_SECONDS) for slower models or --think

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in H2IA02111; do ./scripts/run_positions.sh --official-id "$id" --force --timeout 3600; done
```

### Empty answers (14)

- Candidates' positions H0CA35146: RuntimeError: chunk 1/1 https://www.cargileforcongress.com/issues: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length',
- Candidates' positions H0CA48172: RuntimeError: chunk 1/1 https://www.burley4congress.com/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', raise --
- Candidates' positions H0GA14048: RuntimeError: chunk 1/1 https://cowanforcongress.com/issues.html [Healthcare That Puts Americans First]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_pred
- Candidates' positions H0NY02267: RuntimeError: chunk 1/1 https://www.mikelipetriforcongress.com/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', r
- Candidates' positions H0TN09061: RuntimeError: chunk 1/1 https://electbergmann.com/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', raise --num-pr
- Candidates' positions H0TX08145: RuntimeError: chunk 1/1 https://www.laura4tx.com/ [ABOUT ME]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', rais
- Candidates' positions H0TX09077: RuntimeError: chunk 1/1 https://www.congressmanstockman.com/ [A Proven Conservative]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_
- Candidates' positions H0TX31030: RuntimeError: chunk 1/1 https://www.garapatifortexas.com/issues [**AMERICA FIRST**]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_r
- Candidates' positions H0WI03159: RuntimeError: chunk 1/1 https://www.ebbenforwisconsin.com/issues: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', 
- Candidates' positions H2AK01158: RuntimeError: chunk 1/6 https://marypeltola.com/priorities/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', raise
- Candidates' positions H2CA00096: RuntimeError: chunk 1/1 https://mikebarkley4congress.com/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', raise -
- Candidates' positions H2CA01268: RuntimeError: chunk 1/1 https://roseforcongress.com/priorities [People. Peace. Planet.]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If do
- Candidates' positions H2CA02142: RuntimeError: chunk 1/1 https://douglamalfa.com/: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason is 'length', raise --num-pred
- Candidates' positions H2CA39086: RuntimeError: chunk 1/1 https://www.hectordelatorreforcongress.com/ [HECTOR]: Ollama returned an empty response (attempt 1: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=4096; attempt 2: done_reason=None, output_tokens=None, thinking_chars=0, num_predict=8192). If done_reason i

Failed items retry on their own (up to 5 attempts). If an id keeps showing up, run this from the repo root:

```bash
for id in H0CA35146 H0CA48172 H0GA14048 H0NY02267 H0TN09061 H0TX08145 H0TX09077 H0TX31030 H0WI03159 H2AK01158 H2CA00096 H2CA01268 H2CA02142 H2CA39086; do ./scripts/run_positions.sh --official-id "$id" --force --num-predict 8192; done
```

### Other errors (1)

- Candidates' positions H0CA17193: RuntimeError: chunk 1/2 https://www.tandonforcongress.com/: 1 validation error for StatedPositionsOutput

## Passes

| Pass | Took | Code update | Preflight | Bills | Debates | Officials' positions | Candidates' positions | Target matching | Scoring |
|---|---|---|---|---|---|---|---|---|---|
| 08:40 | 1h39m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 13:30 | 3h00m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 19:30 | 2h02m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |
| 01:30 | 1h39m | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ some items failed | ✅ | ✅ |

Code: Now at 49e8f70 Congress page: key vote numbers behind an info button (#111)

## Machine

- Disk free: 806 GB
- Ollama 0.33.3, loaded now: none
- Code: 49e8f70 Congress page: key vote numbers behind an info button (#111) (2026-11-11)
- Prompts: llm_config.py 1399bd5e56, positions_llm_config.py 32970a4b10
