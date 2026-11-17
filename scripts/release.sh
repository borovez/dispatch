#!/bin/sh
# Publishes a Dispatch release: bumps the version (patch, minor or major), tags it, pushes, creates
# a GitHub Release with generated notes, and with WITH_DESKTOP=1 attaches the Mac app (.dmg). Installed apps see it within a few hours (or on "Check for
# updates") and offer to update.   Usage: npm run release -- minor
set -eu

BUMP="${1:-patch}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

case "$BUMP" in patch|minor|major) ;; *) echo "Usage: npm run release -- patch|minor|major" >&2; exit 1 ;; esac
command -v gh >/dev/null || { echo "The GitHub CLI (gh) is needed to create the release." >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Release from main." >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit or stash your changes first." >&2; exit 1; }
git pull --ff-only

# Bump package.json (and the lock), and the Mac app's desktop/package.json in the same commit: the
# app build syncs that version too, and a changed file afterwards would block self-updates
VERSION="v$(npm version "$BUMP" --no-git-tag-version | sed 's/^v//')"
node -e 'const f="desktop/package.json",fs=require("fs"),p=JSON.parse(fs.readFileSync(f));p.version=process.argv[1];fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "${VERSION#v}"
# The lock records the desktop workspace's version too: refresh it now, not during the app build
npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
git add package.json package-lock.json desktop/package.json
git commit -m "Release $VERSION"
git tag -a "$VERSION" -m "Release $VERSION"
git push --follow-tags
gh release create "$VERSION" --title "Dispatch $VERSION" --generate-notes

# The Mac app (unsigned .dmg for Apple Silicon and Intel), attached only when asked: WITH_DESKTOP=1
if [ "$(uname)" = "Darwin" ] && [ "${WITH_DESKTOP:-}" = "1" ]; then
  echo "Building the Mac app…"
  npm run desktop:dist:all
  # Only this version's files: desktop/dist keeps older builds
  gh release upload "$VERSION" "desktop/dist/Dispatch-${VERSION#v}-"*.dmg --clobber
fi
echo "Released $VERSION"
