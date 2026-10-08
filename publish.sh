#!/bin/zsh
# Publishes what package.sh made.
#
# Pushes the Releases folder to the "downloads" branch of the app's repository on GitHub. That branch
# holds only the packaged app, latest.json and a short page, and it is where every copy of the app
# looks for a newer version. So once this has run, copies in use will offer the update.
set -e
cd "${0:A:h}"
VERSION="$(< VERSION)"
[[ -f "Releases/FPV-Hangar-v$VERSION.zip" && -f Releases/latest.json ]] || { echo "Run ./package.sh first."; exit 1 }
grep -q "\"version\": \"$VERSION\"" Releases/latest.json || { echo "Releases/latest.json isn't for v$VERSION. Run ./package.sh again."; exit 1 }
REMOTE="$(git remote get-url origin)"
NAME="$(git config user.name)"
EMAIL="$(git config user.email)"

cd Releases
if [[ ! -d .git ]]; then
  git init -q -b downloads
  git remote add origin "$REMOTE"
  git config user.name "$NAME"
  git config user.email "$EMAIL"
  # Carry on from what is already published, if anything is.
  if git fetch -q origin downloads 2>/dev/null; then git reset -q --soft FETCH_HEAD; fi
fi
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to publish."
  exit 0
fi
git commit -q -m "${MESSAGE:-FPV Hangar v$VERSION}"
git push -q -u origin downloads
echo "Published v$VERSION. Copies of the app will offer it within a few minutes."
