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
   # Mac Mini workers (official_positions.py crawler): pip install -r backend/requirements-worker.txt
   # For running tests: pip install -r backend/requirements-dev.txt
   ```

3. Copy environment variables into `.env` in the project root:

   ```
   DATABASE_URL=postgresql://postgres:postgres_password@localhost:5432/politmus_local
   CONGRESS_GOV_API_KEY=your_key_here
   OPENSTATES_API_KEY=your_key_here
   FEC_API_KEY=your_key_here
   GOOGLE_CIVIC_API_KEY=your_google_civic_api_key_here
   CIVIC_ELECTION_ID_OVERRIDE=
   CLIENT_IP_HEADER=
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=qwen2.5-coder:32b
   OLLAMA_TIMEOUT_SECONDS=180
   ```

   - Get a Congress.gov API key at [api.congress.gov/sign-up](https://api.congress.gov/sign-up/).
   - Get an OpenStates API key from [openstates.org/accounts/signup](https://openstates.org/accounts/signup/).
   - Get a free OpenFEC key at [api.data.gov/signup](https://api.data.gov/signup/) (1,000 requests/hour). Without one `fec_client.py` uses `DEMO_KEY`, which runs out after a handful of requests.
   - **Google Civic Information API key**: Needed for voting location lookups (`POST /api/voter-info`).
     - Enable the **Google Civic Information API** in the [Google Cloud Console](https://console.cloud.google.com/).
     - Create an API key and **restrict the key** under "API restrictions" to only allow calls to the *Google Civic Information API* to minimize risk.
     - Optional: Set `CIVIC_ELECTION_ID_OVERRIDE` to target a specific election ID (such as `2000` for VIP test election).
     - `CLIENT_IP_HEADER` names the header the voter-info rate limiter trusts for the client IP. Leave it empty locally (the socket peer is used). In production it is set in `backend/fly.toml` to `X-Politmus-Client-IP`, which `frontend/nginx.conf` overwrites from Fly's `Fly-Client-IP` on every request. This is only safe because the API has no public IP (Flycast only); `X-Forwarded-For` is never trusted.
   - Representative address lookup (`GET /api/lookup`) uses the Census geocoder plus the local `officials` table and does not require Google API credentials.
   - `OLLAMA_*`, `BILL_CLASSIFIER_*` and `OFFICIAL_POSITIONS_*` are only needed on the machine that runs the local Ollama workers.
   - **Privacy Policy Notice**: Addresses entered for voting location lookups are proxied to the Google Civic Information API. Ensure the public privacy policy explicitly discloses that user addresses are sent upstream for polling place resolution.

4. Create (or update) tables:

   ```bash
   cd backend
   python init_db.py
   ```

   This creates `officials`, `bills`, `roll_calls`, `votes`, `policy_targets`, `bill_effects`, `extraction_guidelines`, `official_stances`, `official_source_pages`, and `official_position_sync`, and adds any new columns that an older database is missing.

   Re-running `init_db.py` after the roll-call schema change drops the old `votes` table (member positions used to hang directly off `bills`). Re-run `congress_client.py bills` and `senate-votes` to backfill.

## Scripts

Run these from `backend/` with the venv active (`cd backend`).

### `init_db.py`

Creates the Postgres tables used by the rest of the pipeline. Safe to re-run for additive column changes. The roll-call migration is an exception: if `votes` still has a `bill_id` column, that table is dropped so member positions can hang off `roll_calls` instead. Re-run the bills and senate-votes ingest after that one-time reset.

```bash
python init_db.py
```

### `congress_client.py`

Talks to Congress.gov and writes into Postgres. Commands:

**Current member roster** — fetches current members, then each member’s detail record (Capitol phone, DC office address, official website, and the name parts `first_name`, `middle_name`, `last_name`, `suffix_name`, `nickname` and `honorific_name`), and upserts them into `officials` (id is the member’s Bioguide ID). `name` keeps Congress.gov’s inverted form ("Adams, Alma S.") for sorting and Senate matching. The API's `display_name` ("Alma S. Adams") is built from the parts in `Official.display_name`, so the display format can change without re-ingesting:

```bash
python congress_client.py members
```

**Name-part backfill** — one-off: fills the name parts for federal officials stored before those columns existed, including former members added as bill sponsors, which `members` does not revisit. Safe to re-run; it only fetches officials still missing a last name:

```bash
python congress_client.py backfill-name-parts
```

**Recent bills and roll-call votes** (default) — fetches the latest bills for the 119th Congress, upserts them into `bills` (including introduced date, Congress.gov `latestAction`, and a derived `status` such as Became Law / Vetoed / Passed House), then loads House member votes from Congress.gov and Senate member votes from Senate.gov XML. Each roll call is stored in `roll_calls` (question, result, and required threshold when the source publishes one); member positions go in `votes` linked to that roll call:

```bash
python congress_client.py
python congress_client.py bills --limit 50
python congress_client.py bills --skip-votes
python congress_client.py bills --congress 119 --limit 20
```

If a bill has a sponsor who is not in `officials`, the row is still saved. `sponsor_id` is left null (so the foreign key stays valid), and the Congress.gov name and Bioguide ID are stored on the bill. The script logs a warning and lists those gaps in the summary.

**Votes for one bill** — loads House roll-call positions from Congress.gov and Senate member votes from Senate.gov XML, storing each roll call's outcome in `roll_calls`:

```bash
python congress_client.py votes --congress 119 --bill-type hr --bill-number 1
```

**One Senate roll call** — fetches the official Senate.gov XML for a specific vote, matches senators in `officials` by last name and state, upserts the roll-call outcome (`<vote_result>`, `<vote_question_text>`, `<majority_requirement>`) into `roll_calls`, and stores member positions in `votes`:

```bash
python congress_client.py senate-votes --congress 119 --session 1 --vote-number 1
```

**Backfill / incremental Senate votes** — reads the Senate.gov vote menu (the list of every roll call in a session), compares it to the `senate_roll_calls` cursor table, and only fetches XML for votes we have not already handled. Nominations are recorded without a member-vote download. If a legislation vote names a bill that is not in Postgres yet, the script creates that bill from the Senate XML (title and vote date) and stores the roll call and member votes on it. Run `enrich` afterward to fill CRS summaries and policy areas. Oldest-first so `voted_date` on a bill advances to the latest roll call.

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

**House votes catch-up** — the `bills` command only sees recently updated bills, so House roll calls on bills it missed never arrived (the Senate has its own menu sweep). This compares each session's Congress.gov `house-vote` list to `roll_calls` and fetches only the missing ones, creating bills that are not stored yet. The first run backfills every House vote of the congress; later runs are two list requests per session:

```bash
python congress_client.py house-votes --congress 119 --all-sessions
```

**Bill context** (`bill_context.py`) — for voted bills, stores what explains how a bill was received: amendments filed (`bill_amendments`: sponsor, party, latest action, the start of their text), floor speeches from the Congressional Record and committee report minority / dissenting / additional views (`bill_sources`: speaker, party, text), the full action list (`bills.actions`), and links to committee reports and CBO estimates (`bills.documents`). Speeches come from Record articles headed with the bill's short title or number, on the days of its floor actions (and the days between actions up to two weeks apart); speakers are matched to officials by surname, chamber and state. A bill is re-fetched only when its latest action changes:

```bash
python congress_client.py context --limit 40
python congress_client.py context --bill-id 119-hr-9340
```

**Extract bill effects (superseded)** — the bill classifier (`scripts/classify_bills.py`, below) now writes `bill_effects` from the same run as the drawer's intents; stop this worker's cron once the classifier has run. It sends CRS summaries to a local [Ollama](https://ollama.com/) model and stores normalized policy facts: a growing `policy_targets` catalog (the nouns, e.g. ICE, Voting Eligibility) and one `bill_effects` row per fact (`mechanism`, `direction`, `magnitude`, `rationale`). Only bills with a summary and no effects yet are processed, unless you pass `--force`. Extraction rules live in `extraction_guidelines` so you can update the prompt in Postgres without changing worker code.

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

### `bill_classifier.py` (run as `scripts/classify_bills.py`)

Writes the TLDR, ELI5 and policy intents shown in the bill drawer (`bills.classification_metadata`) and the matching `bill_effects` rows used for vote scoring, from each bill's CRS summary, with a local Ollama model. Runs on the Mac Mini against the same `DATABASE_URL` (the Fly database). Launch it with `./scripts/run_classifier.sh [args]` from the repo root (activates the venv) or `python scripts/classify_bills.py [args]` from `backend/`.

1. **Input.** The CRS summary HTML is turned into text with `## ` headings (bold-only paragraphs such as `TITLE I--…` / `Subtitle A--…`), and is never truncated. Summaries up to `--chunk-chars` (default 10,000) go to the model in one call that returns `tldr`, `eli5` and `intents`. Longer ones are split at headings into chunks of about that size; each chunk gets its own intents-only call (`--concurrency 2` in parallel), and one final call writes `tldr` and `eli5` from the opening of the summary plus the merged intent list.
2. **Schema.** The output schema is in the repo (`services/bill_classification.py`): `tldr` and `eli5` are required and must be at least 20 characters, and each intent is `citation` (first), `target`, `mechanism`, `direction`, `magnitude`, `relation`, `rationale`, with the same enums as `bill_effects`. `relation` is `core` (part of the bill's stated purpose) or `secondary` (an unrelated add-on); it is stored on `bill_effects.relation`, and chunks after the first get the summary's opening as context for it. The bill drawer flags broad bills (10 or more effects) and lists secondary effects as unrelated provisions. If a full answer comes back without a TLDR/ELI5, one TLDR/ELI5-only call fills them in; if they are still missing the bill is saved as `incomplete` (never `ok`) and retried later.
3. **Verification.** An intent is dropped when its `citation` is not in the text the model saw (ignoring whitespace, curly quotes, markdown and case; no ellipses) or its target is a bill name or number. Long-standing laws used as programs (Affordable Care Act, Clean Water Act, …) are allowed. Duplicates by (target, mechanism) are merged: the higher magnitude is kept and directions vote, weighted by magnitude; only an exact tie becomes `mixed`. At most 60 intents are kept, strongest first.
4. **Saving.** Each bill is saved in its own transaction: `classification_metadata` (the frontend keys plus `model`, `version`, `classified_at`, `chunks`, `rejected`), and its `bill_effects` rows are replaced with the verified intents (citation appended to the rationale), so the drawer and vote scoring come from the same run. No database connection is held while the model runs. A failure or incomplete answer records the status and error and keeps the previous metadata and effects.

**State and re-runs.** Each bill records `classification_status` (`ok`, `incomplete`, `failed`, `no_summary`), `classification_version` (schema version + hash of the local prompts + model), `classification_input_hash` (title, policy area and summary; status and latest action are left out so a bill moving through Congress is not re-classified at every step), `classification_attempts`, `classification_error`, `classification_attempted_at` and `classified_at`. A bill is due when it has never been classified, its stored metadata lacks a TLDR/ELI5/intents list (older runs saved those), the version changed (new prompt, model or schema), its summary/title/policy area changed, or a failed/incomplete attempt is past its backoff (6 hours × attempts; after 5 attempts only every `--max-age-days`, default 30). Otherwise it is skipped without calling the model. Order: never-classified bills first, then re-runs, then retries; within each, voted bills (newest vote first), then newest introduced. Bills without a CRS summary are marked `no_summary` without a model call; they become due when `congress_client.py enrich` fills in a summary. A lock file stops overlapping runs.

Switching the model (or editing a prompt) changes the version, so every classified bill is redone over the following runs; existing metadata stays visible until each bill is redone.

```bash
python scripts/classify_bills.py --report                              # counts by status, bills without a summary, what is due
python scripts/classify_bills.py --bill-id 119-hr-1 --dry-run          # call the model, print the JSON, write nothing
python scripts/classify_bills.py --limit 5                             # classify a few
python scripts/classify_bills.py --show 119-hr-1                       # print one bill's stored classification
python scripts/classify_bills.py --only-incomplete                     # just the bills missing a TLDR/ELI5
```

Other options: `--limit` (default 0 = all due), `--force`, `--existing-only`, `--model` (default `BILL_CLASSIFIER_MODEL`, then `OLLAMA_MODEL`, then `qwen3.6:27b`), `--host`, `--timeout` (default `BILL_CLASSIFIER_TIMEOUT_SECONDS`, 900), `--num-ctx` (16384, fixed for every call so the model is not reloaded), `--num-predict` (4096; an empty answer is retried once with double), `--think` (off by default), `--concurrency`, `--chunk-chars`, `--max-age-days`, `--delay`.

**Full backfill.** Each bill is saved as soon as it finishes, so Ctrl+C is safe and a re-run picks up where it stopped. Keep the Mac awake and keep a log:

```bash
caffeinate -i ./scripts/run_classifier.sh --limit 0 2>&1 | tee -a ~/bill_classifier.log
```

On the Mac Mini, set `OLLAMA_NUM_PARALLEL=2` for Ollama to match `--concurrency`, and check `ollama list` shows the model tag.

**Legal force.** Each intent also has a `legal_force` (`binding`, `conditional`, `advisory`, `expresses_view`), and the request tells the model to keep it in the TLDR and ELI5, so a bill that "requires states to consider" a standard is not summarized as one that requires the standard. That rule is in the request (`services/bill_classification.py`), not the local prompts. Scoring leaves advisory and sense-of-Congress provisions out (`non_binding_provision`).

### `debate_worker.py` (run as `scripts/run_debate.sh`)

Writes "Where the sides disagree" in the bill drawer (`bills.debate_metadata`): one neutral sentence naming the dispute and each side's main arguments, from the floor speeches and committee views `congress_client.py context` stored, with a local Ollama model (same defaults as the classifier; `DEBATE_MODEL` overrides). The rules are in `services/bill_debate.py`, and neutrality is enforced in code: every argument must quote its source word for word or it is dropped; the speaker, party and Record link come from the stored source, not the model; sides are assigned by what members argued, not by party; both sides keep the same number of points; loaded wording outside quotes drops the point. A bill is due when its sources, the prompt, or the model change. The prompt is `DEFAULT_DEBATE_PROMPT` unless the gitignored `backend/scripts/debate_llm_config.py` defines `DEBATE_PROMPT`.

```bash
./scripts/run_debate.sh --bill-id 119-hr-9340 --dry-run
./scripts/run_debate.sh --limit 50
```

**Prompts are local, not in the repo.** The worker reads `SYSTEM_PROMPT` (and optionally `SUMMARY_PROMPT`, for the TLDR/ELI5 call) from `backend/scripts/llm_config.py`, which is gitignored. A `ClassificationMetadata` class left in that file is ignored; the schema is in the repo. To start from scratch:

```bash
cp backend/scripts/llm_config.example.py backend/scripts/llm_config.py   # then write the prompts
```

### `official_positions.py`

Builds a citable record of what each official **says** they stand for, so it can later be compared with how they vote. For each current federal member with a `website_url` it:

1. **Crawls** the official site (from Congress.gov). It follows nav links that look like an issues section (`Issues`, `Priorities`, `On the Issues`, `In Congress`, …) and then the issue pages beneath them. If none are found it tries common paths (`/issues`, `/priorities`, …), then asks the model to pick from the homepage's links. Press releases, news, contact forms, constituent services, community-project / appropriations request lists, contests and nomination forms are skipped, and pages with identical text (e.g. `?page=0` copies) are kept once. The crawler stays on the official's own host, obeys `robots.txt` (a `robots.txt` that redirects to an error page counts as having no rules, as with major search engines), skips error pages that missing paths redirect to (e.g. `/404?notfound=/issues`), waits 3 seconds between requests to a site, fetches at most 20 HTML pages, does not run JavaScript, and identifies itself with an honest User-Agent (`POLITMUS_CRAWLER_UA`). Sites that answer 403 are recorded as `blocked` and are not worked around.
2. **Extracts** positions with the local Ollama model. Page text (markdown with headings kept) is split at headings into chunks of about 10,000 characters, and each chunk is its own small request (fixed `num_ctx`, default 16k; `--concurrency 2` parallel requests). Thinking is off by default (`--think` turns it on), because reasoning models like Nemotron otherwise spend the output budget on hidden reasoning and return an empty answer. An empty or cut-off answer (output limit reached before the JSON ends) is retried once with double `--num-predict` (default 4096). If it is still cut off, the chunk is split in half at paragraph/sentence boundaries and each half is extracted, down to about 2,000 characters. If it is still empty, the error says why. The prompts come from the gitignored `backend/scripts/positions_llm_config.py` (see below). Each request also gets the most-used bill target names so both sides reuse the same nouns.
3. **Verifies** every position: its `evidence_quote` must appear on the page (ignoring whitespace, curly quotes, markdown, and case). Positions whose quote is not on the page are discarded and counted as "Rejected (bad quote)". Positions whose target is a bill name or number ("National Defense Authorization Act", "H.R. 1976") are discarded as "Rejected (bill name)", because a bill name says nothing about which policy moves which way. Long-standing laws people treat as programs (Affordable Care Act, Voting Rights Act, …) are allowed. Statements about the same target and mechanism are merged by an emphasis-weighted vote on the official's direction; only an exact tie becomes `mixed`.
4. **Saves** one row per (target, mechanism) in `official_stances`. The model labels the policy action the text talks about the same way a bill effect is labelled (target, mechanism, direction), plus whether the official `supports` or `opposes` it. The code then works out what the official wants: "fights cuts to Medicaid" is stored as `direction=increase`, with `stance=opposes` and `policy_direction=decrease` kept for display. Each row has `target_id` (shared `policy_targets`, joins `bill_effects`), `target_name`/`target_slug` (joins `bills.classification_metadata` intents), `policy_area` (CRS area, joins `bills.policy_area`; treat it as a grouping hint, since local models pick it less reliably than the target), `mechanism`, `direction`, `emphasis` (how directly the quote states the change: `high` names it, `medium` clearly implies it, `low` is inferred from a slogan or value statement), `scope` (`local` for one district, state, facility, or project; otherwise `national`; any national statement makes a merged position national), `issue_label`, `summary`, `evidence_quote`, and `source_url`. Crawled page text goes in `official_source_pages`. `GET /api/officials/{id}` returns the rows as `stated_positions`.

Re-running is idempotent. `official_position_sync` records each official's status (`ok`, `no_positions`, `no_issue_pages`, `blocked`, `needs_js` (a JavaScript app shell with no readable text), `thin_site` (a server-rendered site with almost no text and no issue pages), `no_website`, `failed`), a hash of their pages, and the extractor version (schema, prompt row, and model). An official is only picked up when never processed, older than `--max-age-days` (default 30), a prompt or the model changed, or a failure is past its backoff. If the pages are unchanged, the model is not called. Each official is written in one transaction, so a failed run keeps their previous positions. A lock file stops overlapping runs.

```bash
python official_positions.py --limit 20 --crawl-only        # see which pages are found; no model calls
python official_positions.py --official-id O000172 --dry-run # crawl + model, print JSON, write nothing (--official-id is repeatable)
python official_positions.py --limit 3                      # test on a few
python official_positions.py --show O000172                 # print stored positions
python official_positions.py --extract-only --force         # re-run the model on stored pages
python official_positions.py --limit 0                      # everything due
```

Other options: `--force`, `--max-age-days`, `--concurrency`, `--chunk-chars`, `--crawl-delay`, `--max-pages`, `--model` (default `OFFICIAL_POSITIONS_MODEL`, then `OLLAMA_MODEL`), `--host`, `--timeout` (default `OFFICIAL_POSITIONS_TIMEOUT_SECONDS`, 900; separate from the bill classifier's `BILL_CLASSIFIER_TIMEOUT_SECONDS`), `--num-ctx`, `--num-predict`, `--think`, `--level`.

**Choosing a model.** Changing `--model` (or `OFFICIAL_POSITIONS_MODEL`) changes the extractor version, so compare models with `--dry-run` on the same official before switching: `python official_positions.py --official-id O000172 --dry-run --model <tag>`. Count positions whose `official_direction`, mechanism, or target is wrong, and note the time per official.

On the Mac Mini, set `OLLAMA_NUM_PARALLEL=2` for Ollama to match `--concurrency`.

**Full backfill, back to back.** `--limit 0` processes everyone due in one run. Each official is saved as soon as it finishes, so you can stop with Ctrl+C at any time and re-run to pick up where it left off; the progress line shows elapsed time and an estimate of what is left. Keep the Mac awake and keep a log:

```bash
caffeinate -i ./scripts/run_positions.sh --limit 0 2>&1 | tee -a ~/official_positions.log
```

Officials that failed are retried by later runs after a 6-hour backoff (`--force` retries them now). After the backfill, a nightly run only redoes officials older than `--max-age-days` or whose pages changed:

```
15 2 * * * cd /path/to/politmus-data-workers && ./scripts/run_positions.sh --limit 40 >> /tmp/official_positions.log 2>&1
```

**Candidates.** `--level candidate` reads the campaign sites of people running this cycle (see Candidates below): anyone with a candidacy this cycle who is on the general-election ballot or raised at least $50,000, and has a website. Their stances are saved with `source_type='campaign_site'` and the prompt describes them as candidates, not office holders. Members running again keep their `official_site` positions. A separate nightly line keeps them apart from the member run:

```
45 3 * * * cd /path/to/politmus-data-workers && ./scripts/run_positions.sh --level candidate --limit 40 >> /tmp/candidate_positions.log 2>&1
```

**Prompts are local, not in the repo.** Like `backend/scripts/llm_config.py` for the bill classifier, the worker reads `POSITIONS_SYSTEM_PROMPT` and `LINK_SELECTION_PROMPT` from `backend/scripts/positions_llm_config.py`, which is gitignored. Create it on the machine that runs the worker:

```bash
cp backend/scripts/positions_llm_config.example.py backend/scripts/positions_llm_config.py   # then write the prompts
```

Without it, every mode except `--crawl-only` stops with an error saying the file is missing. Editing either prompt changes the extractor version (a hash of both prompts plus the model), so each official is re-extracted on their next run, or right away from stored pages with `--extract-only`.

### `score_officials.py` (accountability / litmus score)

Scores whether officials vote for what they say they want. Each classified bill intent (`bill_effects`) that matches one of the official's stated positions (`official_stances`, same `mechanism` and the same target or a near match, see below) is scored against their passage vote on that bill:

| Stance vs. bill intent | Yes | No |
|---|---|---|
| Same direction (wants increase, bill increases) | +1 | −1 |
| Opposite direction (wants increase, bill cuts) | −1 | +1 |
| Either side `maintain` / `mixed` | 0 | 0 |

Not every match counts. A match is kept (with a `reason`, shown in the drawer) but not counted when:

- the position is `low` emphasis (`low_emphasis`);
- the position is `local` and the bill is broad, 10 or more effects (`local_on_broad_bill`);
- the position is not `high` emphasis and the effect is an unrelated add-on, `relation = secondary` (`unrelated_provision`), or anything but a `high`-magnitude effect of a broad bill (`minor_provision`). High-emphasis positions name the change, so they count on any provision; a counted secondary effect is labelled "via an unrelated provision";
- a later vote in the same Congress matched the same policy (target, mechanism, and effect direction), so a chamber's version and the final bill count once (`later_vote`).

Each vote then scores once: its counted matches net to +1, −1, or 0, so a vote touching several matching intents is one point, and one whose matches cancel out is neither aligned nor conflicting. Not Voting and Present never score. Only passage-type votes count (On Passage, Suspend the Rules and Pass/Agree, Agreeing to the Resolution, conference reports, concurring in the other chamber's amendment, veto overrides); procedural motions (recommit, previous question, cloture, table, …) and amendment votes do not. When a bill has several passage votes in one chamber, only the official's latest Yes/No counts. Bills must have `classification_status = ok`.

Results go in `vote_alignments` (one row per match, counted or not, with `counted`, `reason`, the bill's effect and the official's quote, so every point has a receipt) and `official_scores` (raw `points`, `aligned` and `conflicting` votes, `alignment_pct` = aligned ÷ scored votes, a per-policy-area breakdown). Officials with positions but no scored votes get a zero row; officials without positions get none. The API returns `score_points` / `score_pct` / `score_matches` on `GET /api/officials` and the full `accountability` + `alignments` on `GET /api/officials/{id}`; the UI hides the percentage below 5 scored votes.

No model calls, so a full run takes seconds. It is idempotent: each official's computed rows are hashed (with `ENGINE_VERSION` in `services/accountability.py`) and only changed officials are rewritten. It runs on its own when inputs change: the bill classifier rescores everyone who voted on each bill it classifies, the positions worker rescores each official it saves, and the ingest workflows run it after new votes. Bump `ENGINE_VERSION` when the rules change.

```bash
./scripts/run_scoring.sh                       # incremental: only officials whose inputs changed
./scripts/run_scoring.sh --all                 # rewrite everyone
./scripts/run_scoring.sh --official-id O000172 # one official (repeatable)
./scripts/run_scoring.sh --bill-id 119-hr-105  # everyone who voted on a bill (repeatable)
./scripts/run_scoring.sh --dry-run             # compute and report, write nothing
./scripts/run_scoring.sh --show O000172        # print one official's score and matches
```

#### Target matching (`match_targets.py`)

The bill classifier and the positions extractor name targets independently, and the names drift between runs ("Voter Registration" on a bill, "Automatic Voter Registration" in a position). So targets also match by meaning: the workers embed every target name with a local Ollama embedding model (`TARGET_EMBED_MODEL`, default `nomic-embed-text`) and store each pair with cosine similarity of at least 0.75 in `target_matches`. Similar names are not always the same policy ("Naval Petroleum Reserves" is not the "Strategic Petroleum Reserve"), and some point opposite ways (more "Voter Registration Requirements" means less "Automatic Voter Registration"). So each pair that could score (a bill intent's target and the position target of an official who voted on that bill, same mechanism, similarity at least `TARGET_REVIEW_FLOOR`, default 0.8) is reviewed once by the worker's chat model and stored with a verdict: `same`, `inverse` (scoring flips the bill's direction before comparing), or `unrelated`. A verdict decides; an unreviewed pair counts when its similarity is at least `TARGET_MATCH_THRESHOLD` (default 0.85). An exact target always wins over a near one, and the match row records the position's own target, the similarity, and whether it was inverse (the drawer shows "their position is on …"). Scoring itself never calls a model, so it still runs on Fly and in CI; targets not embedded yet only match exactly.

Setup on the worker machine: `pip install -r backend/requirements-worker.txt` (numpy) and `ollama pull nomic-embed-text`. The workers embed and review after each bill or official (the review uses the worker's own model, `TARGET_REVIEW_MODEL` by hand); after changing the model, or to backfill, run it by hand and rescore:

```bash
cd backend
python match_targets.py                                # embed targets added since the last run
python match_targets.py --rebuild                      # re-embed everything
python match_targets.py --official-id B001267         # also review that official's pairs (repeatable; --bill-id too)
python match_targets.py --review-all                   # review every pair that could score (slow)
python match_targets.py --neighbors "Voter Registration"   # stored matches and verdicts for one name
../scripts/run_scoring.sh
```

The lab report lists each fixture official's near misses (similar names just below the threshold) for tuning it; try a threshold with `TARGET_MATCH_THRESHOLD=0.8 ./scripts/lab.sh grade`.

### `lab.py` (scoring lab)

A fast loop for tuning the bill prompt, the positions prompt, and scoring on a small fixed set: one broad and one narrow bill (plus a bill for any chamber those two miss) and three officials per party, each party with at least one senator and one representative who voted on them. It runs the real workers against the `DATABASE_URL` database, so the fixture rows are updated in place.

```bash
./scripts/lab.sh pick             # choose the fixture (edit ~/politmus-lab/fixture.json to swap anything)
./scripts/lab.sh report           # snapshot what is stored now (use first, as the baseline)
./scripts/lab.sh bills            # re-classify the fixture bills, regrade, report
./scripts/lab.sh positions        # re-extract the fixture officials from stored pages (no crawl), regrade, report
./scripts/lab.sh grade            # regrade only, report
./scripts/lab.sh all              # bills, positions, grade, report
./scripts/lab.sh positions -- --model gemma3:27b   # arguments after -- go to the worker
```

Each report is saved under `~/politmus-lab/runs/<time>/` (`report.md`, `snapshot.json`, `diff.txt`, set `LAB_DIR` to move it) with the git commit and a hash of each local prompt file, and prints what changed since the previous run: effects and positions added, removed, or relabelled, and score and match changes. `positions` takes the same lock as a full positions run, so stop a full run first.

### `openstates_client.py`

Talks to the [OpenStates API](https://docs.openstates.org/api-v3/) and upserts active state legislators and the current governor into `officials` with `level='state'` and an `openstates_id`. Governors are stored with `office='Governor'` and no district. Re-running is idempotent.

**Current state legislators and governor** — for one state, or every postal abbreviation in `TARGET_STATES`, lists `/people` with `org_classification=legislature` (OpenStates' current-role filter; one paginated set for both chambers, including Nebraska's unicameral body) plus `org_classification=executive`. `include=offices,links` puts phone, address, and website on that list so ingest does not GET each person. Only the sitting governor is saved from the executive list; remaining executive pages are skipped once that governor is found. OpenStates requests retry with exponential backoff on HTTP 429 and 5xx.

```bash
python openstates_client.py members --state TX
python openstates_client.py members --state Texas
python openstates_client.py members --all-states
```

`--all-states` continues if a single state fails and prints a per-state summary. Free-tier OpenStates keys are often limited (~500 requests/day, ~10/min), so all-states ingest is meant for the 12-hour GitHub Action rather than frequent local runs.

**State bills** — lists `/bills` for one state (newest `latest_action` first), stores them with `level='state'` and an OpenStates `ocd-bill/…` id, and maps `latest_action_description` to the same `status` labels used for Congress.gov. Default 50 bills; pass `--limit` to cap. These rows do not appear on the federal explorer feed (`GET /api/bills` defaults to `level=federal`).

```bash
python openstates_client.py bills --state TX
python openstates_client.py bills --state Texas --limit 20
```

### `fec_client.py`

Campaign finance for current members of Congress from the [OpenFEC API](https://api.open.fec.gov/developers/). None of the other sources (Congress.gov, OpenStates, Google Civic) carry contribution data, and the OpenSecrets API has been retired. State legislators are not covered: there is no reliable free API for state campaign finance.

**Crosswalk** — downloads `legislators-current.json` from [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) (CC0) and sets `officials.fec_candidate_ids` and `opensecrets_id` by bioguide ID. One request; re-run after `congress_client.py members` picks up new members.

**Totals** — for each current federal official, fetches `/candidate/{id}/totals/` for the FEC IDs matching their seat (S… for senators, H… otherwise) and upserts one `official_finance_totals` row per election: receipts, individual (itemized/unitemized), PAC, party and self-funding, spending, cash on hand and debts. The two most recent elections also get donation-size (`by_size`) and donor-state (`by_state`, itemized only) breakdowns from Schedule A, plus outside spending (Schedule E independent expenditures for and against the candidate, with the top spenders on each side). Breakdowns are only re-fetched when FEC's `coverage_end_date` moves. Outside spending for a race still under way is re-fetched whenever the official is synced, since groups can spend at any time; a finished race's is fetched once. Requests are paced at `FEC_REQUEST_PAUSE_SECONDS` (default 3.6s, under the 1,000/hour key limit). If the key runs out (Retry-After over 10 minutes), the run stops; the next run continues.

**PACs** — after `totals`, fetches every itemized gift from a PAC or other political committee (Schedule A, Form 3 line 11C) for the same two most recent elections into `pac_contributions`. Each PAC is categorized from its FEC codes (`services/finance_insights.pac_category`): corporate, labor, trade, membership or cooperative by its sponsor type; leadership PACs and other candidates' campaigns as politicians; sponsor-less PACs as ideological/issue; anything FEC doesn't classify as other. Gifts are fetched per campaign committee and two-year period (`pac_contribution_sync`): a finished period once after it closes, the current period again only when the election's `coverage_end_date` moves. A period whose gifts lag the filing (FEC is still processing them) is checked again once a day for up to 90 days. Officials go least recently synced first, and only after their totals have synced. The itemized sum matches FEC's reported PAC total (checked for Klobuchar 2024: $1,368,278 both ways).

**Who is due** — `totals` and `pacs` work through current members (default), this cycle's candidacies with at least $50,000 raised (`--candidates`), or both (`--all`). A sitting member who is running is synced once, through their candidacy, with their other IDs for the seat they hold. `totals` skips anyone with nothing new:

- a candidacy is due when `candidates` (run daily) moves its `coverage_end_date` past `candidacies.detail_coverage_end_date`, the one last synced, or when its outside spending is stale: every 2 days for candidates on the general-election ballot in a race's last 60 days, weekly otherwise;
- a member not on this cycle's ballot is due weekly;
- `--official-id` syncs that official regardless.

`--max-requests` caps a run's OpenFEC calls and `--max-minutes` its time; either way the run stops starting new officials and the next run continues. The **FEC Finance Detail** workflow runs `totals --all` and `pacs --all` every 3 hours with 800 requests between them, so a first load of everyone takes about two days of runs and later runs mostly finish in minutes.

```bash
python fec_client.py crosswalk
python fec_client.py totals                          # members due
python fec_client.py totals --all --max-requests 500 # members and candidacies due
python fec_client.py totals --official-id S000033
python fec_client.py totals --limit 10
python fec_client.py pacs --all --max-requests 300
python fec_client.py pacs --official-id K000367
```

`GET /api/officials/{id}/finance` returns the stored elections (newest first) with a funding mix that adds up to receipts (small donors, larger donors, joint fundraising transfers, PACs, party, candidate, other), small-donor, PAC and in-state shares, top donor states, outside spending, and links to the FEC and OpenSecrets pages. It also returns `peer_comparison`: percentiles for the member's most recent finished election against current members of the same chamber, and of the same party within it, computed from stored rows (`services/finance_insights.py`). Senate and House are never mixed because their totals cover six and two years. PAC gifts are served by `GET /api/officials/{id}/finance/pacs` (total, category breakdown, top 10), `/finance/pacs/list` (search with `q`, `category`, `sort=amount|gifts|recent|name`, `limit`/`offset`) and `/finance/pacs/gifts` (one PAC's gifts with filing links), each taking `fec_candidate_id` and `election_year`.

### Candidates (`fec_client.py candidates`, `wikidata_client.py`)

Everyone running for the House or Senate in the current cycle, including challengers who hold no office. `candidates` sweeps OpenFEC `/candidates/totals/` (candidates with money raised, about 50 requests) into `candidacies`, one row per FEC candidate ID and election with the race (state, office, district), party, incumbent/challenger/open seat and a totals snapshot. A candidate ID held by a member (from the crosswalk) links to that member's row; anyone else gets an `officials` row with `level='candidate'` and the FEC ID as its id, so every finance table, endpoint and the member drawer work for them unchanged, while the roster, lookup and peer comparisons (all scoped by level) never see them; the positions worker reads their campaign sites only when run with `--level candidate`. FEC records no primary results, so the sweep also flags candidacies whose campaign filed a pre-general (12G) report: once that deadline has passed, races show only those, the candidates on the general-election ballot. Before then a race shows everyone who raised at least $5,000.

`totals --candidates` and `pacs --candidates` (or `--all`, with members) fetch the same detail as for members for candidacies with at least $50,000 raised, when due (see above). `totals` also takes each candidate's campaign website from the committee registration (Form 1) on `/candidate/{id}/committees/`, one cached request per candidate; social profiles and donation pages are skipped, and Wikidata's website is used only when FEC has none. `wikidata_client.py` matches officials on FEC ID (Wikidata P1839) for a bio (description, birth date, occupations, education, offices held) and Wikipedia link; candidates also take their name and portrait from it. Few challengers have P1839, so funded candidates without a match get a name search ("Nickname Last", then "First Last", then the full legal name), accepted only when exactly one hit is a person whose offices, districts or description name their state. A candidate is searched at most once every 30 days (`officials.wikidata_searched_at`), and a run searches at most `--max-names` (default 300), least recently searched first. Requests are paced at 1 second and wait out Wikidata's 429s; a long block ends the run. **FEC Ingestion** runs `crosswalk` and `candidates` daily, **FEC Finance Detail** the finance detail every 3 hours, and **Wikidata Candidates Ingestion** the Wikidata match daily.

```bash
python fec_client.py candidates                     # this cycle, House and Senate
python fec_client.py candidates --state TX --office S
python fec_client.py totals --candidates --state TX --max-requests 200
python fec_client.py pacs --candidates --max-requests 200
python wikidata_client.py --level candidate --max-names 100
```

`GET /api/candidates/races` lists races with their candidates, richest first (`state`, `office=S|H`, `district`, `party`, `q`, `all=true` for every filer, `limit`/`offset`). A state lists the Senate race and then districts in order; nationwide lists the most expensive races first. `GET /api/officials/{id}` adds `candidacies`, `bio` and `wikipedia_url`, and `/finance` adds `race_comparison`, the official's race this cycle.

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

Scheduled ingest SSHs into `politmus-api` and runs the Python clients there (private Postgres, no public DB URL). Congress.gov runs every 6 hours; OpenStates runs every 12 hours; Senate.gov roll calls run every 2 hours (and again after Congress ingest succeeds) in their own workflow so a catch-up does not block the others. FEC campaign finance runs weekly (Monday 07:30 UTC), with PAC gifts in a second job capped at 300 minutes; FEC candidates run daily (09:30 UTC) and queue behind it. Add one GitHub Actions secret:

```bash
fly tokens create org
gh secret set FLY_API_TOKEN
```

Use an org or personal token, not a deploy-only token (`fly ssh` rejects those). Set `OPENSTATES_API_KEY` on the Fly app (not as a GitHub secret):

```bash
fly secrets set OPENSTATES_API_KEY=your_key_here GOOGLE_CIVIC_API_KEY=your_civic_key FEC_API_KEY=your_fec_key -a politmus-api
```

Then run **Congress Data Ingestion**, **OpenStates Data Ingestion**, **Senate Votes Ingestion**, **FEC Ingestion**, **FEC Finance Detail** or **Wikidata Candidates Ingestion** from the Actions tab, or load data once by hand:

```bash
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py members"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py bills"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py enrich"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py senate-votes --congress 119 --all-sessions"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py house-votes --congress 119 --all-sessions"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/congress_client.py context --limit 200"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/openstates_client.py members --all-states"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/fec_client.py crosswalk"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/fec_client.py candidates"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/fec_client.py totals --all --max-requests 500"
fly ssh console -a politmus-api -C "/usr/local/bin/python /app/fec_client.py pacs --all --max-requests 300"
```
