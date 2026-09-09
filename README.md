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
   ```

   Get a Congress.gov API key at [api.congress.gov/sign-up](https://api.congress.gov/sign-up/). Get an OpenStates API key from [openstates.org/accounts/signup](https://openstates.org/accounts/signup/). Address lookup (`GET /api/lookup`) uses the Census geocoder plus the local `officials` table; it does not need a Google API key.

4. Create (or update) tables:

   ```bash
   cd backend
   python init_db.py
   ```

   This creates `officials`, `bills`, and `votes`, and adds any new bill columns that an older database is missing.

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

**Recent bills and House roll-call votes** (default) — fetches the latest bills for the 119th Congress, upserts them into `bills` (including introduced date and latest recorded-vote date), then loads House member votes into `votes` when a bill has roll calls:

```bash
python congress_client.py
python congress_client.py bills --limit 50
python congress_client.py bills --skip-votes
python congress_client.py bills --congress 119 --limit 20
```

If a bill has a sponsor who is not in `officials`, the row is still saved. `sponsor_id` is left null (so the foreign key stays valid), and the Congress.gov name and Bioguide ID are stored on the bill. The script logs a warning and lists those gaps in the summary.

**Votes for one bill** — loads House roll-call positions for a specific bill. Senate roll calls are skipped (Congress.gov has no Senate member-vote API):

```bash
python congress_client.py votes --congress 119 --bill-type hr --bill-number 1
```

**Enrich existing bills** — fills missing policy area, CRS summary, introduced date, and latest recorded-vote date:

```bash
python congress_client.py enrich
```

All Congress.gov requests pause briefly between calls and retry with exponential backoff on HTTP 429 and 5xx responses. Re-running these commands is idempotent: existing bills are updated in place, and votes are upserted per official per bill.

### `openstates_client.py`

Talks to the [OpenStates API](https://docs.openstates.org/api-v3/) and upserts active state legislators into `officials` with `level='state'` and an `openstates_id`. Re-running is idempotent.

**Current state legislators** — fetches upper and lower chamber members for one state, or every postal abbreviation in `STATE_NAME_BY_ABBR`. Nebraska (unicameral) uses `org_classification=legislature`; other states skip that extra request. OpenStates requests retry with exponential backoff on HTTP 429 and 5xx.

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

Scheduled ingest SSHs into `politmus-api` and runs the Python clients there (private Postgres, no public DB URL). Congress.gov runs every 6 hours; OpenStates runs every 12 hours in a separate workflow and concurrency group so a long state ingest does not block Congress. Add one GitHub Actions secret:

```bash
fly tokens create org
gh secret set FLY_API_TOKEN
```

Use an org or personal token, not a deploy-only token (`fly ssh` rejects those). Set `OPENSTATES_API_KEY` on the Fly app (not as a GitHub secret):

```bash
fly secrets set OPENSTATES_API_KEY=your_key_here -a politmus-api
```

Then run **Congress Data Ingestion** or **OpenStates Data Ingestion** from the Actions tab, or load data once by hand:

```bash
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py members"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py bills"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py enrich"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/openstates_client.py members --all-states"
```
