# Deploying Politmus

How production is put together and how each part ships. Keep this current when
the deploy changes.

## What runs where

Three Fly apps in `ord` (Chicago):

| App | What it is | Config |
|---|---|---|
| `politmus-web` | nginx serving the Expo app's static web export (politmus.com) and proxying `/api/` to the API | `apps/app/fly.toml`, `apps/app/Dockerfile`, `apps/app/nginx.conf` |
| `politmus-api` | FastAPI | `backend/fly.toml` |
| `politmus-db` | Postgres | created by `scripts/fly-setup.sh` |

The API has no public address. Everything reaches it through the website at
`https://politmus.com/api/...`: the site itself (same origin), the iOS and
Android apps, and the health check. nginx reaches it over Flycast
(`API_UPSTREAM = "politmus-api.flycast:80"`) and sets `X-Politmus-Client-IP`
from Fly's `Fly-Client-IP`, which the API's rate limiter trusts.

## Website (`politmus-web`)

Deploy from the **repo root**. The build needs the npm workspace (`apps/app`
and `packages/core`), so the root is the Docker build context:

```bash
fly deploy . --config apps/app/fly.toml --dockerfile apps/app/Dockerfile
```

What the build does:

1. `npm ci` for `apps/app` and `packages/core` only (see `.dockerignore`).
2. `expo export --platform web` with the live Clerk key from `apps/app/fly.toml`
   (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, a build arg) and an empty
   `EXPO_PUBLIC_API_URL`, so the site calls `/api` on its own origin.
   `EXPO_PUBLIC_*` values are compiled in: changing one needs a new deploy.
3. Copies the export into `nginx:alpine` with `apps/app/nginx.conf`.

### Before deploying

```bash
npm run lint && npm run typecheck && npm test && npm run build   # repo root
```

To check the production image itself without deploying:

```bash
docker build -f apps/app/Dockerfile \
  --build-arg EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsucG9saXRtdXMuY29tJA \
  -t politmus-web-check .
docker run --rm -p 8095:8080 politmus-web-check   # then open http://localhost:8095
```

Pages and assets load locally; `/api` won't, since Flycast only exists on Fly.

### After deploying

- `https://politmus.com/home` shows the landing page while signed out, with
  Privacy Policy and Terms links in the footer.
- Sign in and sign up work (Clerk modal).
- An address lookup on My Reps returns representatives (the `/api` proxy).
- A shared profile link such as `https://politmus.com/member/P000197` opens.
- `https://politmus.com/api/health` returns 200.

`fly releases -a politmus-web` lists deploys; `fly logs -a politmus-web` shows
nginx.

### Rolling back

To an earlier release of the Expo site, find its image with
`fly releases -a politmus-web --image`, then run it again:

```bash
fly deploy --config apps/app/fly.toml --image <image reference>
```

The previous Vite site is still buildable as a last resort:

```bash
fly deploy . --config apps/web/fly.toml --dockerfile apps/web/Dockerfile
```

## API (`politmus-api`)

```bash
( cd backend && fly deploy )
```

Secrets (`CONGRESS_GOV_API_KEY`, `OPENSTATES_API_KEY`, `GOOGLE_CIVIC_API_KEY`,
`FEC_API_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`) are Fly secrets on
`politmus-api`; scheduled ingest runs from GitHub Actions over `fly ssh` (see
the root README).

## Election results (`/results`)

The results page doesn't use the API. The **Election Results** workflow
(`.github/workflows/election-results.yml`) runs `backend/election_results.py`
on GitHub's runners every 5 minutes. The script reads each state's
unofficial counts from its election office's site and force-pushes the
snapshot as the only commit on the `election-results-data` branch. The page
loads it from
`https://raw.githubusercontent.com/Walastik/politmus-data-workers/election-results-data/2026-11-03.json`
(`RESULTS_SNAPSHOT_URL` in `packages/core/src/electionResults.ts`).

- New counts need no deploy. GitHub's raw CDN caches which commit a
  branch points to for about five minutes, so the page can trail a run by
  five to ten minutes. Changing the page, or where it reads
  the snapshot from, does.
- States we can't read directly (Texas, California, Michigan and others) fall
  back to [civicAPI](https://civicapi.org), an independent aggregator. The page
  marks those states (dashed ring, "civicAPI" tag, a note in the state panel)
  and credits civicAPI in the footer, which its terms require. Its counts can
  trail the states by hours and it doesn't name its sources; its race calls
  are ignored. `--no-civicapi` skips the fallback.
- **How it keeps running:** GitHub's scheduler runs this repo's schedules
  hours late (on Election Night a `*/5` schedule never fired), so the
  workflow doesn't rely on it. Each run refreshes every 5 minutes for about
  5½ hours (`REFRESH_SECONDS`, `LOOP_MINUTES`), then starts the next run
  itself, just before GitHub's 6-hour job limit. The `*/5` schedule is only a
  backup that restarts the chain if it breaks. One run goes at a time; an
  extra run waits behind it. A pass that fails (a site down) is logged as a
  warning and the loop carries on; a state whose site fails keeps its
  previous counts.
- **Starting it:** if no Election Results run is in progress, start one from
  the Actions tab (**Election Results**, `states` blank) or
  `gh workflow run election-results.yml`.
- **One-off refresh:** a manual run with a comma-separated `states` list
  refreshes just those states once and doesn't loop. It waits for the running
  loop to finish first, so for a quick refresh, cancel the loop, run it, then
  start the loop again.
- Locally: `cd backend && python election_results.py --out ../apps/app/public/dev-results.json`,
  then set `EXPO_PUBLIC_RESULTS_URL=/dev-results.json` in
  `apps/app/.env.local` to read that file instead (it's git- and
  Docker-ignored, so it never ships). The iOS and Android apps need a full
  URL on the dev server, such as `http://<your Mac's LAN IP>:8081/dev-results.json`
  (`localhost` works from the iOS simulator but not the Android emulator).
- **Stopping it:** once states certify, disable the workflow (Actions tab, or
  `gh workflow disable election-results.yml`), then cancel the run in
  progress. A loop left running keeps refreshing until its 5½ hours are up;
  its hand-off is then refused, which shows as a failed last step. To
  run it from the Mac mini instead, run the same script there and publish to
  the same branch, or point `RESULTS_SNAPSHOT_URL` somewhere else and deploy.

## Sign-in (Clerk) and Google OAuth

- Production Clerk instance: `clerk.politmus.com` (the `pk_live_` key in
  `apps/app/fly.toml`). Local development and Expo Go use the `pk_test_`
  instance from `.env.local`.
- "Allow users to delete their accounts" must stay on in Clerk: the native
  Account sheet relies on it (it falls back to the contact email if it's off).
- Google sign-in uses our own Google OAuth client. Its Branding page in Google
  Auth Platform points at:
  - app name `Politmus`
  - home page `https://politmus.com/home` (not `/`, which is the Work in
    Progress page until launch)
  - privacy policy `https://politmus.com/privacy`, terms
    `https://politmus.com/terms`
  - authorized domain `politmus.com`, verified in Google Search Console by an
    account that owns the Cloud project

  Google's branding check reads the pages' HTML, so keep the landing page,
  `/privacy` and `/terms` public and prerendered, and keep the name "Politmus"
  in their titles. Changing any of these means re-running the verification.

## iOS and Android apps

Not released yet. Before the first store build:

- Set up EAS (`npx eas-cli@latest build:configure`) for builds, submission and
  over-the-air updates.
- Register the native app with the production Clerk instance (bundle ID and
  package `com.politmus.app`, URL scheme `politmus`) so hosted sign-in can
  return to the app.
- Point `EXPO_PUBLIC_API_URL` at `https://politmus.com` and the Clerk key at
  `pk_live_` in the EAS build profile.
- The privacy policy URL for the stores is `https://politmus.com/privacy`.

The backend needs nothing for the apps: they use the same `/api` proxy as the
site.

## When to launch at `/`

`HOME_PATH` in `packages/core/src/site.ts` is `/home` while `/` shows the Work
in Progress page. To launch: set it to `/`, delete the WIP pages
(`apps/app/src/app/index.tsx`'s web branch), deploy, then update the Google
OAuth home page URL and re-verify.
