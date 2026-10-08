#!/bin/zsh
# Packages the app for sending to someone.
#
# Builds it for Apple silicon and Intel, checks it, and writes into Releases/:
#   FPV-Hangar-v<version>.zip   the app and its read-me
#   latest.json                 what the app's update check reads
#   notes.md                    the release's description
# The release workflow on GitHub runs this and attaches the first two to the release. On your own
# Mac it is a way to try a package first. ./publish.sh is what starts a release.
set -e
cd "${0:A:h}"
VERSION="$(< VERSION)"

# One number, in three places.
grep -q "let toolVersion = \"$VERSION\"" "Lap Timer/laptimer.swift" || { echo "Lap Timer/laptimer.swift gives a different version from VERSION ($VERSION)."; exit 1 }
grep -q "^## v$VERSION " CHANGELOG.md || { echo "CHANGELOG.md has no entry for v$VERSION."; exit 1 }

WORK="$(mktemp -d)"
STAGE="$WORK/FPV Hangar v$VERSION"
mkdir -p "$STAGE"
APP_DIR="$STAGE" ARCHS="arm64 x86_64" Dashboard/build.sh
APP="$STAGE/FPV Hangar.app"

# The read-me is written by the app itself, from the same text as its welcome note.
"$APP/Contents/MacOS/FPV Hangar" --read-me > "$STAGE/Read Me First.txt"
grep -q "GETTING STARTED" "$STAGE/Read Me First.txt" || { echo "The app didn't write its read-me."; exit 1 }

# Checks before anything is written to Releases/.
for binary in "$APP/Contents/MacOS/FPV Hangar" "$APP/Contents/MacOS/laptimer"; do
  [[ "$(lipo -archs "$binary")" == *arm64* && "$(lipo -archs "$binary")" == *x86_64* ]] || { echo "$binary isn't built for both kinds of Mac."; exit 1 }
  # Nothing of whoever built it should ride along.
  if strings -a "$binary" | grep -q "/Users/"; then echo "$binary has a home folder path in it."; exit 1; fi
done
codesign --verify --deep --strict "$APP"
[[ "$("$APP/Contents/MacOS/laptimer" --version)" == "laptimer $VERSION" ]] || { echo "The lap timer inside the app isn't v$VERSION."; exit 1 }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" == "$VERSION" ]] || { echo "The app isn't v$VERSION."; exit 1 }

mkdir -p Releases
ZIP="FPV-Hangar-v$VERSION.zip"
rm -f "Releases/$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$STAGE" "Releases/$ZIP"
SHA="$(shasum -a 256 "Releases/$ZIP" | cut -d' ' -f1)"

python3 - "$VERSION" "$ZIP" "$SHA" <<'EOF'
import json, re, sys
version, archive, sha = sys.argv[1:4]
log = open("CHANGELOG.md", encoding="utf-8").read()
entry = re.search(r"^## v" + re.escape(version) + r" [^\n]*\n(.*?)(?=^## |\Z)", log, re.S | re.M).group(1).strip()
json.dump({"version": version, "file": archive, "sha256": sha, "notes": entry}, open("Releases/latest.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open("Releases/notes.md", "w", encoding="utf-8").write(f"""Download **{archive}** below, unzip it, and open "Read Me First". It needs macOS 14 or newer.

If you already have FPV Hangar, it offers this version by itself: look for the yellow update button in the sidebar.

## What's new

{entry}
""")
EOF

rm -rf "$WORK"
echo "Packaged Releases/$ZIP ($(du -h "Releases/$ZIP" | cut -f1 | tr -d ' '))"
