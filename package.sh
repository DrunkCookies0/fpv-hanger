#!/bin/zsh
# Packages the app for sending to someone.
#
# Builds it for Apple silicon and Intel, checks it, and writes into Releases/:
#   FPV-Hangar-v<version>.zip   the app and its read-me
#   latest.json                 what the app's update check reads
#   README.md                   the page people see on the downloads branch
# Then ./publish.sh sends Releases/ to GitHub.
set -e
cd "${0:A:h}"
VERSION="$(< VERSION)"
PAGE="https://github.com/DrunkCookies0/fpv-hanger"

# One number, in three places.
grep -q "let toolVersion = \"$VERSION\"" "Lap Timer/laptimer.swift" || { echo "Lap Timer/laptimer.swift gives a different version from VERSION ($VERSION)."; exit 1 }
grep -q "^## v$VERSION " CHANGELOG.md || { echo "CHANGELOG.md has no entry for v$VERSION."; exit 1 }

WORK="$(mktemp -d)"
STAGE="$WORK/FPV Hangar v$VERSION"
mkdir -p "$STAGE"
APP_DIR="$STAGE" ARCHS="arm64 x86_64" Dashboard/build.sh
APP="$STAGE/FPV Hangar.app"

# What is planned but not built, straight from the app's own list.
COMING="$(sed -n 's/^        case \.[a-z]*: return "\(.*\)"$/\1/p' Dashboard/Dashboard.swift | awk 'NR<=3 {print "  - " $0}')"
/usr/bin/python3 - "$VERSION" "$PAGE" "$COMING" "$STAGE/Read Me First.txt" <<'EOF'
import sys
version, page, coming, out = sys.argv[1:5]
text = open("Dashboard/Read Me First.txt", encoding="utf-8").read()
open(out, "w", encoding="utf-8").write(text.replace("{VERSION}", version).replace("{PAGE}", page).replace("{COMING}", coming))
EOF

# Checks before anything is written to Releases/.
for binary in "$APP/Contents/MacOS/FPV Hangar" "$APP/Contents/MacOS/laptimer"; do
  [[ "$(lipo -archs "$binary")" == *arm64* && "$(lipo -archs "$binary")" == *x86_64* ]] || { echo "$binary isn't built for both kinds of Mac."; exit 1 }
  # Nothing of the person who built it should ride along.
  if strings -a "$binary" | grep -q -i -E "/Users/|$(id -un)"; then echo "$binary has a personal path in it."; exit 1; fi
done
codesign --verify --deep --strict "$APP"
[[ "$("$APP/Contents/MacOS/laptimer" --version)" == "laptimer $VERSION" ]] || { echo "The lap timer inside the app isn't v$VERSION."; exit 1 }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" == "$VERSION" ]] || { echo "The app isn't v$VERSION."; exit 1 }

mkdir -p Releases
ZIP="FPV-Hangar-v$VERSION.zip"
rm -f "Releases/$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$STAGE" "Releases/$ZIP"
SHA="$(shasum -a 256 "Releases/$ZIP" | cut -d' ' -f1)"

/usr/bin/python3 - "$VERSION" "$ZIP" "$SHA" "$PAGE" <<'EOF'
import json, re, sys
version, archive, sha, page = sys.argv[1:5]
log = open("CHANGELOG.md", encoding="utf-8").read()
entry = re.search(r"^## v" + re.escape(version) + r" [^\n]*\n(.*?)(?=^## |\Z)", log, re.S | re.M).group(1).strip()
json.dump({"version": version, "file": archive, "sha256": sha, "notes": entry}, open("Releases/latest.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open("Releases/README.md", "w", encoding="utf-8").write(f"""# FPV Hangar downloads

**[Download FPV Hangar v{version}]({page}/raw/downloads/{archive})**

Unzip it and open "Read Me First". It needs macOS 14 or newer.

The app checks this page for newer versions by itself, so you only need to download it once.

## What's new in v{version}

{entry}

Earlier versions are the other zip files here. The full list of changes is in the [changelog]({page}/blob/main/CHANGELOG.md).
""")
EOF

rm -rf "$WORK"
echo "Packaged Releases/$ZIP ($(du -h "Releases/$ZIP" | cut -f1 | tr -d ' '))"
echo "Send it with ./publish.sh"
