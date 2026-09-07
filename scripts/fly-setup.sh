#!/usr/bin/env bash
# Provision Fly.io apps (Postgres + API + web) and deploy.
# Run from the repo root after: fly auth login
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_APP="${API_APP:-politmus-api}"
WEB_APP="${WEB_APP:-politmus-web}"
DB_APP="${DB_APP:-politmus-db}"
REGION="${REGION:-ord}"

if ! fly auth whoami >/dev/null 2>&1; then
  echo "Not logged in to Fly. Run: fly auth login"
  exit 1
fi

echo "Logged in as $(fly auth whoami)"

if [ -z "${CONGRESS_GOV_API_KEY:-}" ] && [ -f .env ]; then
  CONGRESS_GOV_API_KEY="$(
    python3 - <<'PY'
from pathlib import Path
for line in Path(".env").read_text().splitlines():
    if line.startswith("CONGRESS_GOV_API_KEY="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"), end="")
        break
PY
  )"
fi
if [ -z "${CONGRESS_GOV_API_KEY:-}" ]; then
  echo "CONGRESS_GOV_API_KEY is not set. Export it or add it to .env."
  exit 1
fi

create_app_if_needed() {
  local name="$1"
  if fly status -a "$name" >/dev/null 2>&1; then
    echo "App $name already exists"
  else
    echo "Creating app $name"
    fly apps create "$name" --yes
  fi
}

if fly status -a "$DB_APP" >/dev/null 2>&1; then
  echo "Postgres app $DB_APP already exists"
else
  echo "Creating Postgres cluster $DB_APP in $REGION"
  fly postgres create \
    --name "$DB_APP" \
    --region "$REGION" \
    --initial-cluster-size 1 \
    --vm-size shared-cpu-1x \
    --vm-memory 1024 \
    --volume-size 1
fi

create_app_if_needed "$API_APP"
create_app_if_needed "$WEB_APP"

echo "Attaching $DB_APP to $API_APP (sets DATABASE_URL)"
if fly postgres attach "$DB_APP" -a "$API_APP" --database-name politmus --yes; then
  echo "Attached Postgres"
else
  echo "Attach skipped (already attached or failed); check DATABASE_URL with: fly secrets list -a $API_APP"
fi

echo "Allocating Flycast (private) IPv6 for $API_APP"
fly ips allocate-v6 --private -a "$API_APP" || true

echo "Setting API secrets"
fly secrets set \
  "CONGRESS_GOV_API_KEY=${CONGRESS_GOV_API_KEY}" \
  -a "$API_APP" \
  --stage

echo "Deploying $API_APP"
( cd "$ROOT/backend" && fly deploy --remote-only )

echo "Deploying $WEB_APP"
( cd "$ROOT/frontend" && fly deploy --remote-only )

echo
echo "Done."
echo "  Web:  https://${WEB_APP}.fly.dev"
echo "  API:  https://${API_APP}.fly.dev/api/health"
echo "  Explorer: https://${WEB_APP}.fly.dev/dev-explorer"
echo
echo "Add GitHub secret FLY_API_TOKEN so scheduled ingest can SSH into ${API_APP}:"
echo "  fly tokens create org"
echo "  gh secret set FLY_API_TOKEN"
