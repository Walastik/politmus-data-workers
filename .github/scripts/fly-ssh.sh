#!/usr/bin/env bash
# Run a command on the Fly API machine over `flyctl ssh console`, retrying
# when flyctl can't reach Fly's API or open the WireGuard tunnel.
#
# Only connection errors that happen before the remote command starts are
# retried, so a script that runs and then fails is never run a second time.
#
# Usage: fly-ssh.sh "/usr/local/bin/python /app/congress_client.py members"
# Requires FLY_API_APP (and FLY_API_TOKEN for flyctl).
set -uo pipefail

cmd="$1"
attempts="${FLY_SSH_ATTEMPTS:-4}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# flyctl errors seen when the tunnel or SSH connection never comes up.
retryable='tunnel unavailable|Error contacting Fly\.io API|error connecting to SSH server|failed probing'

for attempt in $(seq 1 "$attempts"); do
  flyctl ssh console -a "$FLY_API_APP" -C "$cmd" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if ! grep -qE "$retryable" "$log"; then
    exit "$status"
  fi

  if [ "$attempt" -lt "$attempts" ]; then
    delay=$((attempt * 30))
    echo "::warning::Fly connection failed (attempt $attempt/$attempts); retrying in ${delay}s"
    sleep "$delay"
  fi
done

echo "::error::Fly connection failed after $attempts attempts"
exit "$status"
