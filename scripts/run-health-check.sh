#!/bin/bash
# Run the selector check and raise a macOS notification if anything broke.
# Called by launchd; see install-health-check.sh.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "--- $(date '+%Y-%m-%d %H:%M') ---"

# The check needs the signed-in debug browser. If it is not running there is
# nothing to check — say so quietly rather than crying wolf about selectors.
if ! curl -s --max-time 3 http://127.0.0.1:9334/json/version >/dev/null 2>&1; then
  echo "Debug browser not running; skipped. Start it with: npm run browser"
  exit 0
fi

OUTPUT="$(npm run --silent health:watch 2>&1)"
STATUS=$?
echo "$OUTPUT"

if [[ $STATUS -ne 0 ]]; then
  BROKEN="$(echo "$OUTPUT" | grep broken | awk '{print $1}' | paste -sd, -)"
  osascript -e "display notification \"$BROKEN — fix config/selectors.json and push\" with title \"whileAI: a site changed\" sound name \"Basso\"" 2>/dev/null || true
fi
