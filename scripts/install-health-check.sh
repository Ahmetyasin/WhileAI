#!/bin/bash
# Install (or remove) a daily selector health check on this Mac.
#
#   bash scripts/install-health-check.sh          # install
#   bash scripts/install-health-check.sh --remove # uninstall
#
# Why launchd and not GitHub Actions: the check needs a browser that is
# SIGNED IN to five AI services. That cannot live on a build server without
# handing it credentials, which is exactly what this project refuses to do.
# It runs on your machine, against your own session, and reports to you.
#
# It only notifies when something is BROKEN. A check that speaks up daily is
# a check you stop reading.

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.whileai.healthcheck"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "${1:-}" == "--remove" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed. No more daily checks."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/run-health-check.sh</string>
  </array>
  <!-- Once a day, at 10:00. Not hourly: the sites do not change that often,
       and a notification you see every day stops being a notification. -->
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$REPO/.health-check.log</string>
  <key>StandardErrorPath</key><string>$REPO/.health-check.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. It runs at 10:00 daily and only speaks up when something breaks."
echo "Log: $REPO/.health-check.log"
echo "Remove with: bash scripts/install-health-check.sh --remove"
