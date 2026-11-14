#!/bin/sh
# Updates a Dispatch installed from source: pulls the latest code, installs dependencies, rebuilds the
# web app and restarts the background server. Run by the app's "Update and restart" button (output in
# ~/Library/Logs/Dispatch-update.log), or by hand with `npm run app:update`.
set -eu

LABEL="dispatch.server"
REPO="${DISPATCH_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"

# git pull may replace this very file while it runs: run from a copy
if [ -z "${DISPATCH_UPDATE_COPY:-}" ]; then
  COPY="$(mktemp -t dispatch-update)"
  cp "$0" "$COPY"
  DISPATCH_UPDATE_COPY=1 DISPATCH_REPO="$REPO" exec sh "$COPY"
fi
cd "$REPO"

echo "== $(date '+%Y-%m-%d %H:%M:%S') updating Dispatch in $REPO"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Not updating: this checkout has local changes. Commit or stash them, then update." >&2
  exit 2
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git fetch --tags origin
git pull --ff-only origin "$BRANCH"
# The server runs with NODE_ENV=production, which makes npm skip dev dependencies (vite, vue-tsc,
# tsx): install and build without it
env -u NODE_ENV npm install --include=dev --no-audit --no-fund
env -u NODE_ENV npm run build --silent

# The background service picks up the new code on restart; a dev server reloads by itself
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Restarting the background server…"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
elif launchctl print "gui/$(id -u)/prdeck.server" >/dev/null 2>&1; then
  # Installed before the rename to Dispatch: reinstall under the new name (removes prdeck.server)
  echo "Moving the background server to dispatch.server…"
  sh "$REPO/scripts/app-install.sh"
fi
echo "== updated to $(node -p "require('./package.json').version") ($(git rev-parse --short HEAD))"
rm -f "$0"
