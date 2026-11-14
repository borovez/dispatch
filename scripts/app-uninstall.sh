#!/bin/sh
# Stops the Dispatch background server and removes it from login items. Your data (~/.dispatch) stays.
set -eu
LABEL="dispatch.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/prdeck.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/prdeck.server.plist"
rm -f "$PLIST"
echo "Dispatch's background server is stopped and won't start at login."
echo "Remove the installed app like any other app (Launchpad, or the app's own menu > Uninstall)."
