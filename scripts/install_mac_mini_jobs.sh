#!/usr/bin/env bash
# Installs the Mac Mini's LaunchAgents: the LLM worker pass every 6 hours and
# the 07:00 health report. Re-run after pulling changes to scripts/launchd/.
#
#   ./scripts/install_mac_mini_jobs.sh              install or reinstall
#   ./scripts/install_mac_mini_jobs.sh --uninstall  remove both jobs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${POLITMUS_LOG_DIR:-$HOME/Library/Logs/politmus}"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LABELS=(com.politmus.mac-mini-cycle com.politmus.mac-mini-report)

for label in "${LABELS[@]}"; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then
    echo "Removed ${LABELS[*]}."
    exit 0
fi

mkdir -p "$AGENTS" "$LOG_DIR"
for label in "${LABELS[@]}"; do
    target="$AGENTS/$label.plist"
    sed -e "s#__REPO__#$REPO_ROOT#g" -e "s#__LOGS__#$LOG_DIR#g" \
        "$SCRIPT_DIR/launchd/$label.plist" > "$target"
    plutil -lint -s "$target"
    launchctl bootstrap "$DOMAIN" "$target"
    echo "Installed $label"
done
echo "Logs: $LOG_DIR"
echo "Run a pass now: launchctl kickstart $DOMAIN/com.politmus.mac-mini-cycle"
