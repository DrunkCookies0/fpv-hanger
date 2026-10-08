#!/bin/zsh
# Starts a release of the version in VERSION.
#
# Pushes main and a v<version> tag to GitHub. The tag sets off the release workflow there, which
# packages the app and publishes it on the Releases page a few minutes later. Every copy of the app
# looks at the newest release, so once it is up, copies in use offer the update.
set -e
cd "${0:A:h}"
VERSION="$(< VERSION)"
grep -q "let toolVersion = \"$VERSION\"" "Lap Timer/laptimer.swift" || { echo "Lap Timer/laptimer.swift gives a different version from VERSION ($VERSION)."; exit 1 }
grep -q "^## v$VERSION " CHANGELOG.md || { echo "CHANGELOG.md has no entry for v$VERSION."; exit 1 }
[[ -z "$(git status --porcelain)" ]] || { echo "There are changes that aren't committed yet. Commit them first."; exit 1 }
[[ "$(git branch --show-current)" == "main" ]] || { echo "Releases are made from main."; exit 1 }
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "v$VERSION has already been released. Put a new number in VERSION."
  exit 1
fi
git tag "v$VERSION"
git push -q origin main "v$VERSION"
echo "v$VERSION is on its way: https://github.com/DrunkCookies0/fpv-hanger/actions"
echo "It will be at https://github.com/DrunkCookies0/fpv-hanger/releases in a few minutes."
