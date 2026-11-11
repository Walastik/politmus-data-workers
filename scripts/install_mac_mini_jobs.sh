#!/usr/bin/env bash
# Installs the Mac Mini's LaunchAgents: the LLM worker pass every 6 hours, the
# 07:00 health report and, when .env's DATABASE_URL points at localhost, a
# `flyctl proxy` to the Fly database that stays open. Re-run after pulling
# changes to scripts/launchd/.
#
#   ./scripts/install_mac_mini_jobs.sh              install or reinstall
#   ./scripts/install_mac_mini_jobs.sh --uninstall  remove all three jobs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${POLITMUS_LOG_DIR:-$HOME/Library/Logs/politmus}"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
PROXY=com.politmus.fly-db-proxy
LABELS=("$PROXY" com.politmus.mac-mini-cycle com.politmus.mac-mini-report)

for label in "${LABELS[@]}"; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then
    echo "Removed ${LABELS[*]}."
    exit 0
fi

# The proxy is only needed when DATABASE_URL goes through localhost.
db_url=$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" || true)
db_hostport=$(printf '%s' "$db_url" | sed -E 's#^[^@]*@([^/?]*).*#\1#')
db_host=${db_hostport%%:*}
db_port=5432
case "$db_hostport" in *:*) db_port=${db_hostport##*:} ;; esac
if [ "$db_host" = localhost ] || [ "$db_host" = 127.0.0.1 ]; then
    if ! PATH="$HOME/.fly/bin:$PATH" command -v flyctl >/dev/null; then
        echo "flyctl not found; install it and run 'flyctl auth login' first." >&2
        exit 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$db_port") 2>/dev/null; then
        echo "Something is already listening on port $db_port. Stop the flyctl proxy you started by hand, then run this again." >&2
        exit 1
    fi
else
    echo "DATABASE_URL doesn't go through localhost, so the Fly proxy job isn't needed."
    LABELS=(com.politmus.mac-mini-cycle com.politmus.mac-mini-report)
fi

mkdir -p "$AGENTS" "$LOG_DIR"
for label in "${LABELS[@]}"; do
    target="$AGENTS/$label.plist"
    sed -e "s#__REPO__#$REPO_ROOT#g" -e "s#__LOGS__#$LOG_DIR#g" \
        -e "s#__HOME__#$HOME#g" -e "s#__PORT__#$db_port#g" \
        "$SCRIPT_DIR/launchd/$label.plist" > "$target"
    plutil -lint -s "$target"
    launchctl bootstrap "$DOMAIN" "$target"
    echo "Installed $label"
done
echo "Logs: $LOG_DIR"
echo "Run a pass now: launchctl kickstart $DOMAIN/com.politmus.mac-mini-cycle"
