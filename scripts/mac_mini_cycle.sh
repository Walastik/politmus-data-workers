#!/usr/bin/env bash
# One Mac Mini pass of the local-LLM workers, run every 6 hours by launchd
# (scripts/launchd/com.politmus.mac-mini-cycle.plist, installed with
# scripts/install_mac_mini_jobs.sh). Steps run one after another so Ollama has
# one model loaded at a time; a failed step is logged and the pass goes on.
#
# Each step's output goes to $LOG_DIR/steps/<pass>-<step>.log, and one JSON line
# per step to $LOG_DIR/events.jsonl, which backend/mac_mini_report.py turns
# into the daily report. Batch sizes come from CYCLE_*_LIMIT in the environment
# or the repo's .env (e.g. CYCLE_BILL_LIMIT=100).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${POLITMUS_LOG_DIR:-$HOME/Library/Logs/politmus}"
STEP_DIR="$LOG_DIR/steps"
EVENTS="$LOG_DIR/events.jsonl"
mkdir -p "$STEP_DIR"

event() {  # cycle step start end exit log
    printf '{"cycle":"%s","step":"%s","start":%d,"end":%d,"exit":%d,"log":"%s"}\n' "$@" >> "$EVENTS"
}

# One pass at a time: when the previous pass still holds the lock, this one
# records that it was skipped and exits. caffeinate keeps the Mac awake.
if [ -z "${POLITMUS_CYCLE_LOCKED:-}" ]; then
    export POLITMUS_CYCLE_LOCKED=1
    started=$(date +%s)
    /usr/bin/lockf -s -t 0 "$LOG_DIR/cycle.lock" /usr/bin/caffeinate -i /bin/bash "$0" "$@"
    code=$?
    if [ "$code" -eq 75 ]; then
        event "$(date +%Y%m%d-%H%M%S)" lock "$started" "$(date +%s)" 75 ""
    fi
    exit "$code"
fi

# Everything below is in a function so bash reads it all before running it:
# the update step can rewrite this file mid-pass.
main() {
    cd "$REPO_ROOT/backend" || exit 1
    local python="$REPO_ROOT/backend/venv/bin/python"
    [ -x "$python" ] || python=python3
    export PYTHONUNBUFFERED=1
    CYCLE=$(date +%Y%m%d-%H%M%S)

    # Only digits are read from .env, so nothing in it is run as shell.
    if [ -f "$REPO_ROOT/.env" ]; then
        eval "$(grep -E '^CYCLE_[A-Z_]+=[0-9]+$' "$REPO_ROOT/.env")"
    fi

    # Parallel model calls per bill or official; match OLLAMA_NUM_PARALLEL.
    local parallel="${CYCLE_CONCURRENCY:-2}"

    step update update_code
    if ! "$python" mac_mini_report.py preflight > /dev/null 2>&1; then
        restart_db_proxy
    fi
    step preflight "$python" mac_mini_report.py preflight || exit 1
    step classifier "$python" bill_classifier.py --limit "${CYCLE_BILL_LIMIT:-60}" --concurrency "$parallel"
    step debate "$python" debate_worker.py --limit "${CYCLE_DEBATE_LIMIT:-30}"
    step positions "$python" official_positions.py --limit "${CYCLE_OFFICIAL_LIMIT:-25}" --concurrency "$parallel"
    step candidates "$python" official_positions.py --level candidate --limit "${CYCLE_CANDIDATE_LIMIT:-25}" --concurrency "$parallel"
    # The workers match and rescore as they go; these catch anything that failed partway.
    step matching "$python" match_targets.py
    step scoring "$python" score_officials.py
    return 0
}

step() {  # name command...
    local name=$1 log start code
    shift
    log="$STEP_DIR/$CYCLE-$name.log"
    start=$(date +%s)
    echo "$(date '+%F %T') $CYCLE $name: started" >> "$LOG_DIR/cycle.log"
    "$@" > "$log" 2>&1
    code=$?
    event "$CYCLE" "$name" "$start" "$(date +%s)" "$code" "$log"
    echo "$(date '+%F %T') $CYCLE $name: exit $code" >> "$LOG_DIR/cycle.log"
    return "$code"
}

# A flyctl proxy can stay running with a dead tunnel. When the checks fail,
# restart the proxy job (if it's installed) and give it time to connect.
restart_db_proxy() {
    local label="gui/$(id -u)/com.politmus.fly-db-proxy"
    launchctl print "$label" > /dev/null 2>&1 || return 0
    echo "$(date '+%F %T') $CYCLE preflight failed; restarting the Fly proxy" >> "$LOG_DIR/cycle.log"
    launchctl kickstart -k "$label"
    sleep 15
}

# Follow main, but never touch a checkout someone is working in.
update_code() {
    local branch
    branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD) || return 1
    if [ "$branch" != main ]; then
        echo "Skipped git pull: on branch $branch, not main."
        return 0
    fi
    if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
        echo "Skipped git pull: uncommitted changes."
        return 0
    fi
    git -C "$REPO_ROOT" pull --ff-only --quiet || return 1
    git -C "$REPO_ROOT" log -1 --format='Now at %h %s'
}

main "$@"
