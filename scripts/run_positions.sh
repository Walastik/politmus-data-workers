#!/usr/bin/env bash
set -e

# Resolve repository root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Activate virtual environment
if [ -f "$REPO_ROOT/backend/venv/bin/activate" ]; then
    source "$REPO_ROOT/backend/venv/bin/activate"
elif [ -f "$REPO_ROOT/venv/bin/activate" ]; then
    source "$REPO_ROOT/venv/bin/activate"
else
    echo "Warning: No virtual environment found in backend/venv or venv. Using system python."
fi

# Print output as it happens, even when piped to tee or a log file.
export PYTHONUNBUFFERED=1

# Run the official stated-positions worker with all passed arguments
exec python "$REPO_ROOT/backend/official_positions.py" "$@"
