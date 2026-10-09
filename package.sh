#!/bin/zsh
# Packages the app for sending to someone: for a Mac and for Windows.
#
# Checks both, and writes into Releases/:
#   FPV-Hangar-v<version>.zip         the Mac app and its read-me
#   FPV-Hangar-v<version>-win64.zip   the Windows app and its read-me
#   latest.json                       what the app's update check reads
#   notes.md                          the release's description
# The release workflow on GitHub runs this and attaches the first three to the release. On your own
# Mac it is a way to try a package first. ./publish.sh is what starts a release.
#
# It runs on an Apple silicon Mac, and needs `npm ci` to have been run in Hangar/ first.
set -e
cd "${0:A:h}"
VERSION="$(< VERSION)"
grep -q "^## v$VERSION " CHANGELOG.md || { echo "CHANGELOG.md has no entry for v$VERSION."; exit 1 }
[[ "$(uname -m)" == arm64 ]] || { echo "The Mac app is built for Apple silicon, on Apple silicon."; exit 1 }
[[ -d Hangar/node_modules/electron/dist/Electron.app ]] || { echo "Electron isn't here yet. Run npm ci in Hangar first."; exit 1 }
Hangar/tools/fetch.sh

WORK="$(mktemp -d)"
# The app is started a few times below, to write its read-mes and to try itself out. It is given a
# library and a memory of its own each time, so that nobody's own are opened.
alone=(--root "$WORK/library" --user-data "$WORK/memory")

# The Mac app, under the identity every copy before it has had: that is how a copy in use knows
# this is its next version.
STAGE="$WORK/FPV Hangar v$VERSION"
APP_ID=local.racegow.dashboard Hangar/tools/package.sh mac "FPV Hangar" "$STAGE"
APP="$STAGE/FPV Hangar.app"
PROGRAM="$APP/Contents/MacOS/Electron"
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist" }
[[ "$(plist CFBundleShortVersionString)" == "$VERSION" ]] || { echo "The Mac app isn't v$VERSION."; exit 1 }
[[ "$(plist CFBundleIdentifier)" == local.racegow.dashboard ]] || { echo "The Mac app has the wrong identity."; exit 1 }
[[ "$(lipo -archs "$PROGRAM")" == arm64 ]] || { echo "The Mac app isn't built for Apple silicon."; exit 1 }
codesign --verify --deep --strict "$APP"
[[ "$("$PROGRAM" --say-version "$WORK/said" >/dev/null 2>&1; cat "$WORK/said")" == "$VERSION" ]] || { echo "The Mac app doesn't say it is v$VERSION."; exit 1 }

# The read-me is written by the app itself, from the same text as its welcome note.
"$PROGRAM" $alone --read-me "$STAGE/Read Me First.txt" --for darwin >/dev/null 2>&1
grep -q "GETTING STARTED" "$STAGE/Read Me First.txt" || { echo "The app didn't write its read-me."; exit 1 }

# Windows: Electron's own files for it, the same pages and code, and FFmpeg.
Hangar/tools/package.sh win "FPV Hangar" "$WORK/win" >/dev/null
WIN="$WORK/win/FPV Hangar"
[[ -f "$WIN/FPV Hangar.exe" && -f "$WIN/resources/ffmpeg/ffmpeg.exe" && "$(< "$WIN/resources/VERSION")" == "$VERSION" ]] || { echo "The Windows app isn't all there."; exit 1 }
"$PROGRAM" $alone --read-me "$WIN/READ ME FIRST.txt" --for win32 >/dev/null 2>&1
grep -q "GETTING STARTED" "$WIN/READ ME FIRST.txt" || { echo "The app didn't write the Windows read-me."; exit 1 }
# The two are the same app: the same pages and code, file for file.
diff -rq "$APP/Contents/Resources/app" "$WIN/resources/app" >/dev/null || { echo "The Mac and Windows apps don't hold the same code."; exit 1 }

# Nothing of whoever built it should ride along.
if grep -rIl -e "/Users/" -e "/home/" "$APP/Contents/Resources/app" "$STAGE/Read Me First.txt" "$WIN/READ ME FIRST.txt"; then echo "A home folder path is in the app."; exit 1; fi

# It works: the app tries itself out from start to finish, on a recording it makes for the purpose,
# and ends by updating a copy of itself. PACKAGE_UNTRIED=1 leaves this out.
if [[ -z "$PACKAGE_UNTRIED" ]]; then
  "$PROGRAM" --self-test --report "$WORK/self-test.txt" >/dev/null 2>&1 || { cat "$WORK/self-test.txt"; echo "The app didn't pass its own test."; exit 1 }
  grep -q "^Everything passed\.$" "$WORK/self-test.txt" || { cat "$WORK/self-test.txt"; echo "The app's own test didn't finish."; exit 1 }
  echo "The app passed its own test ($(grep -c '^ok ' "$WORK/self-test.txt") things)."
fi

mkdir -p Releases
MAC="FPV-Hangar-v$VERSION.zip"
WINDOWS="FPV-Hangar-v$VERSION-win64.zip"
rm -f "Releases/$MAC" "Releases/$WINDOWS"
ditto -c -k --sequesterRsrc --keepParent "$STAGE" "Releases/$MAC"
(cd "$WORK/win" && zip -r -X -q "$OLDPWD/Releases/$WINDOWS" "FPV Hangar" -x "*.DS_Store")

# What the app's update check reads. The first four lines are the Mac's, as they always were, so
# that a copy from before there was a Windows app still finds its update.
node - "$VERSION" "$MAC" "$(shasum -a 256 "Releases/$MAC" | cut -d' ' -f1)" "$WINDOWS" "$(shasum -a 256 "Releases/$WINDOWS" | cut -d' ' -f1)" <<'EOF2'
const fs = require("node:fs");
const [version, mac, macSum, windows, windowsSum] = process.argv.slice(2);
const log = fs.readFileSync("CHANGELOG.md", "utf8");
const escaped = version.replace(/\./g, "\\.");
const entry = new RegExp(`^## v${escaped} [^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(log)[1].trim();
fs.writeFileSync("Releases/latest.json", `${JSON.stringify({ version, file: mac, sha256: macSum, notes: entry, windows: { file: windows, sha256: windowsSum } }, null, 2)}\n`);
fs.writeFileSync("Releases/notes.md", `Download **${mac}** for a Mac (Apple silicon, macOS 13 or newer) or **${windows}** for Windows 10 or 11. Unzip it and open the read-me inside.

If you already have FPV Hangar, it offers this version by itself: look for the yellow update button.

## What's new

${entry}
`);
EOF2

rm -rf "$WORK"
echo "Packaged v$VERSION:"
ls -lh Releases/"$MAC" Releases/"$WINDOWS" Releases/latest.json | awk '{print "  " $5 "  " $9}'
