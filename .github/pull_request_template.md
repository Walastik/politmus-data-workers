## Summary

<!-- What does this PR change, and why? One or two short paragraphs. Link the issue if there is one (e.g. "Closes #12"). -->

## Changes

<!-- The main changes, one line each. Call out anything a reviewer should look at closely. -->

-

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Data pipeline / ingest (Congress.gov, OpenStates, Senate.gov, Civic API)
- [ ] LLM worker (Mac Mini / Ollama)
- [ ] Refactor or cleanup (no behavior change)
- [ ] Docs, CI, or config only

## How it was tested

<!-- Say what you ran and what you saw. Delete lines that don't apply. -->

- [ ] Backend tests: `cd backend && pytest --ignore=scripts`
- [ ] Frontend: `cd frontend && npm run lint && npm test && npm run build`
- [ ] Ran it by hand (command, page, or endpoint, and the result):
- [ ] Not tested (explain why):

## Database, deploy, and config

<!-- Check what applies and add details. Leave the section empty if nothing here changes. -->

- [ ] Schema change: added to `ensure_schema()` in `backend/init_db.py` and safe to re-run (Fly's release step runs it on every deploy)
- [ ] Needs a data backfill or one-off command after deploy:
- [ ] New or changed env vars / secrets (`.env.example`, `fly secrets set`, or GitHub Actions secrets):
- [ ] Needs a deploy beyond the usual `fly deploy` for `backend/` and `frontend/`, or a change on the Mac Mini (new requirements, cron, Ollama model):
- [ ] Changes scheduled GitHub Actions ingest

## Screenshots

<!-- For UI changes: before / after, including mobile width if layout changed. -->

## Checklist

- [ ] No secrets, API keys, or local-only LLM prompt files (`backend/scripts/*llm_config.py`) are committed
- [ ] README or docs updated if commands, setup, or behavior changed
- [ ] External requests are paced and retry on 429 / 5xx (for new ingest or crawling code)
