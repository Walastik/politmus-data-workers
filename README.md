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
   pip install -r requirements.txt
   ```

3. Copy environment variables into `.env` in the project root:

   ```
   DATABASE_URL=postgresql://postgres:postgres_password@localhost:5432/politmus_local
   CONGRESS_GOV_API_KEY=your_key_here
   ```

   Get an API key at [api.congress.gov/sign-up](https://api.congress.gov/sign-up/).

4. Create (or update) tables:

   ```bash
   python init_db.py
   ```

   This creates `officials`, `bills`, and `votes`, and adds any new bill columns that an older database is missing.

## Scripts

Run these from the project root with the venv active.

### `init_db.py`

Creates the Postgres tables used by the rest of the pipeline. Safe to re-run; it will not wipe existing rows.

```bash
python init_db.py
```

### `congress_client.py`

Talks to Congress.gov and writes into Postgres. Commands:

**Current member roster** — fetches current members and upserts them into `officials` (id is the member’s Bioguide ID):

```bash
python congress_client.py members
```

**Recent bills and House roll-call votes** (default) — fetches the latest bills for the 119th Congress, upserts them into `bills`, then loads House member votes into `votes` when a bill has roll calls:

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

All Congress.gov requests pause briefly between calls and retry with exponential backoff on HTTP 429 and 5xx responses. Re-running these commands is idempotent: existing bills are updated in place, and votes are upserted per official per bill.
