# politmus-data-workers

Local pipeline that pulls congressional data from the [Congress.gov API](https://api.congress.gov/) and stores it in PostgreSQL.

## Setup

1. Start Postgres (Docker Compose, port 5432):

   ```bash
   docker compose up -d
   ```

2. Create a virtualenv and install dependencies:

   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt
   ```

3. Copy environment variables into `.env` in the project root:

   ```
   DATABASE_URL=postgresql://postgres:postgres_password@localhost:5432/politmus_local
   CONGRESS_GOV_API_KEY=your_key_here
   OPENSTATES_API_KEY=your_key_here
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=qwen2.5-coder:32b
   OLLAMA_TIMEOUT_SECONDS=180
   ```

   Get a Congress.gov API key at [api.congress.gov/sign-up](https://api.congress.gov/sign-up/). Get an OpenStates API key from [openstates.org/accounts/signup](https://openstates.org/accounts/signup/). Address lookup (`GET /api/lookup`) uses the Census geocoder plus the local `officials` table; it does not need a Google API key. `OLLAMA_*` is only required for the local bill classifier.

4. Create (or update) tables:

   ```bash
   cd backend
   python init_db.py
   ```

   This creates `officials`, `bills`, `votes`, `policy_targets`, `bill_effects`, and `extraction_guidelines`, and adds any new bill columns that an older database is missing.

## Scripts

Run these from `backend/` with the venv active (`cd backend`).

### `init_db.py`

Creates the Postgres tables used by the rest of the pipeline. Safe to re-run; it will not wipe existing rows.

```bash
python init_db.py
```

### `congress_client.py`

Talks to Congress.gov and writes into Postgres. Commands:

**Current member roster** — fetches current members, then each member’s detail record (Capitol phone, DC office address, and official website), and upserts them into `officials` (id is the member’s Bioguide ID):

```bash
python congress_client.py members
```

**Recent bills and roll-call votes** (default) — fetches the latest bills for the 119th Congress, upserts them into `bills` (including introduced date and latest recorded-vote date), then loads House member votes from Congress.gov and Senate member votes from Senate.gov XML:

```bash
python congress_client.py
python congress_client.py bills --limit 50
python congress_client.py bills --skip-votes
python congress_client.py bills --congress 119 --limit 20
```

If a bill has a sponsor who is not in `officials`, the row is still saved. `sponsor_id` is left null (so the foreign key stays valid), and the Congress.gov name and Bioguide ID are stored on the bill. The script logs a warning and lists those gaps in the summary.

**Votes for one bill** — loads House roll-call positions from Congress.gov and Senate member votes from Senate.gov XML:

```bash
python congress_client.py votes --congress 119 --bill-type hr --bill-number 1
```

**One Senate roll call** — fetches the official Senate.gov XML for a specific vote, matches senators in `officials` by last name and state, and upserts positions into `votes`:

```bash
python congress_client.py senate-votes --congress 119 --session 1 --vote-number 1
```

**Backfill / incremental Senate votes** — reads the Senate.gov vote menu (the list of every roll call in a session), compares it to the `senate_roll_calls` cursor table, and only fetches XML for votes we have not already handled. Nominations are recorded without a member-vote download. If a legislation vote names a bill that is not in Postgres yet, the script creates that bill from the Senate XML (title and vote date) and stores the member votes on it. Run `enrich` afterward to fill CRS summaries and policy areas. Oldest-first so the latest roll call on a bill wins.

One-time production backfill (SSH into the API machine after deploying this code):

```bash
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py senate-votes --congress 119 --all-sessions"
```

Catch-up after that (same command the GitHub Action runs):

```bash
python congress_client.py senate-votes --incremental
python congress_client.py senate-votes --congress 119 --session 1
```

**Enrich existing bills** — fills missing policy area, CRS summary, introduced date, and latest recorded-vote date:

```bash
python congress_client.py enrich
```

**Extract bill effects** — sends CRS summaries to a local [Ollama](https://ollama.com/) model and stores normalized policy facts: a growing `policy_targets` catalog (the nouns, e.g. ICE, Voting Eligibility) and one `bill_effects` row per fact (`mechanism`, `direction`, `magnitude`, `rationale`). Only bills with a summary and no effects yet are processed, unless you pass `--force`. Extraction rules live in `extraction_guidelines` so you can update the prompt in Postgres without changing worker code.

Requires a running Ollama instance (default `http://localhost:11434`) and a pulled model such as `qwen2.5-coder:32b`. The worker is meant to run on the Mac Mini that hosts Ollama, pointed at the same `DATABASE_URL` as the rest of the pipeline.

```bash
python llm_extractor.py
python llm_extractor.py --limit 20
python llm_extractor.py --bill-id 119-hr-1
python llm_extractor.py --dry-run
python llm_extractor.py --force --limit 5
python congress_client.py extract --limit 20
```

`--limit 0` extracts every matching bill. On timeout or a bad model response the worker logs the error, leaves that bill untouched, and continues. New target names are slugified and reused when the slug already exists.

To change the extraction rules, update the active row in `extraction_guidelines` (the worker loads the newest `is_active` prompt each run):

```sql
UPDATE extraction_guidelines
SET prompt = 'your new instructions',
    updated_at = NOW() AT TIME ZONE 'utc'
WHERE name = 'default';
```

On a Mac Mini, an hourly cron is enough:

```
0 * * * * cd /path/to/politmus-data-workers/backend && /path/to/venv/bin/python llm_extractor.py --limit 50
```

All Congress.gov requests pause briefly between calls and retry with exponential backoff on HTTP 429 and 5xx responses. Re-running these commands is idempotent: existing bills are updated in place, and votes are upserted per official per bill.

### `openstates_client.py`

Talks to the [OpenStates API](https://docs.openstates.org/api-v3/) and upserts active state legislators and the current governor into `officials` with `level='state'` and an `openstates_id`. Governors are stored with `office='Governor'` and no district. Re-running is idempotent.

**Current state legislators and governor** — fetches upper and lower chamber members for one state, or every postal abbreviation in `STATE_NAME_BY_ABBR`, plus `org_classification=executive` (one extra request per state). Only the governor is saved from that executive list. Nebraska (unicameral) uses `org_classification=legislature`; other states skip that extra legislative request. OpenStates requests retry with exponential backoff on HTTP 429 and 5xx.

```bash
python openstates_client.py members --state TX
python openstates_client.py members --state Texas
python openstates_client.py members --all-states
```

`--all-states` continues if a single state fails and prints a per-state summary. Free-tier OpenStates keys are often limited (~500 requests/day, ~10/min), so all-states ingest is meant for the 12-hour GitHub Action rather than frequent local runs.

## Deploy to Fly.io

Production is three Fly apps in `ord` (Chicago): `politmus-db` (Postgres), `politmus-api` (FastAPI), and `politmus-web` (nginx serving the Vite SPA). Local Vite proxies `/api` to `localhost:8000`. Production builds bake in `VITE_API_URL` from `frontend/.env.production` (`https://politmus-api.fly.dev`) so the SPA on [politmus.com](https://politmus.com) can call the API directly. CORS on the API allows `https://politmus.com`, `https://www.politmus.com`, and `https://politmus-web.fly.dev`.

### First-time setup

1. Install the [Fly CLI](https://fly.io/docs/flyctl/install/) if needed, then log in:

   ```bash
   fly auth login
   ```

2. From the repo root, with `CONGRESS_GOV_API_KEY` in `.env` (or exported):

   ```bash
   chmod +x scripts/fly-setup.sh
   ./scripts/fly-setup.sh
   ```

   That creates the Postgres cluster, both apps, attaches `DATABASE_URL`, allocates a private Flycast IP for the API, and deploys. App names are global; if `politmus-*` is taken, change `app` in `backend/fly.toml` and `frontend/fly.toml`, plus `API_UPSTREAM` / `CORS_ORIGINS` and the names in `scripts/fly-setup.sh`.

3. After deploy:

   - Site: `https://politmus.com` (also `https://politmus-web.fly.dev`)
   - API health: `https://politmus-api.fly.dev/api/health`

### Later deploys

```bash
( cd backend && fly deploy )
( cd frontend && fly deploy )
```

### GitHub Actions ingest

Scheduled ingest SSHs into `politmus-api` and runs the Python clients there (private Postgres, no public DB URL). Congress.gov runs every 6 hours; OpenStates runs every 12 hours; Senate.gov roll calls run every 2 hours (and again after Congress ingest succeeds) in their own workflow so a catch-up does not block the others. Add one GitHub Actions secret:

```bash
fly tokens create org
gh secret set FLY_API_TOKEN
```

Use an org or personal token, not a deploy-only token (`fly ssh` rejects those). Set `OPENSTATES_API_KEY` on the Fly app (not as a GitHub secret):

```bash
fly secrets set OPENSTATES_API_KEY=your_key_here -a politmus-api
```

Then run **Congress Data Ingestion**, **OpenStates Data Ingestion**, or **Senate Votes Ingestion** from the Actions tab, or load data once by hand:

```bash
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py members"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py bills"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py enrich"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py senate-votes --congress 119 --all-sessions"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/openstates_client.py members --all-states"
```
