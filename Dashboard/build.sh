#!/bin/zsh
# Builds "FPV Hangar.app" with the lap timer inside it.
#
#   ./build.sh                          into the project folder (the one above this folder), for this Mac only
#   ARCHS="arm64 x86_64" ./build.sh     for Apple silicon and Intel, which is how package.sh builds it
#   APP_DIR=<folder> ./build.sh         writes the app into another folder
#   APP_ID=<identifier> ./build.sh      a copy with its own identifier, to try things without touching the real one
#   APP_NAME=<name> ./build.sh          what that copy is called
#
# A test copy, to try a change before it is released, built beside the real app:
#   APP_NAME="FPV Hangar Test" APP_ID=local.fpvhangar.test ./build.sh
# A copy under any identifier but the real one says TEST COPY in its sidebar and leaves updates alone.
set -e
cd "${0:A:h}"
VERSION="$(< ../VERSION)"
NAME="${APP_NAME:-FPV Hangar}"
# The identifier keeps the app's first name on purpose: macOS files the app's web session (the Google
# sign-in used for submission forms), its settings and its caches under it, and a new one would start
# those from nothing.
ID="${APP_ID:-local.racegow.dashboard}"
ARCHS=(${=ARCHS:-$(uname -m)})
APP="${APP_DIR:-..}/$NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Compiles one source file for each architecture and joins the results. The finished file is moved
# into place rather than written there, so a copy of the app that is open keeps running.
compile() {
  local source="$1" output="$2"
  shift 2
  local built=()
  for arch in $ARCHS; do
    # Target macOS 14 explicitly: the compiler otherwise stamps the app with its own SDK's version,
    # and macOS then refuses to open the app on anything older than that.
    swiftc -O "$@" -target "$arch-apple-macos14.0" "$source" -o "$output.$arch"
    built+=("$output.$arch")
  done
  if (( ${#built} > 1 )); then
    lipo -create "${built[@]}" -output "$output.new"
    rm -f "${built[@]}"
  else
    mv -f "${built[1]}" "$output.new"
  fi
  mv -f "$output.new" "$output"
}

# The lap timer's source is compiled into the app as well, with its command line left out (EMBEDDED),
# so the timer the marker editor draws is the timer the videos get: one piece of code, not two.
compile Dashboard.swift "$APP/Contents/MacOS/$NAME" -parse-as-library -D EMBEDDED "../Lap Timer/laptimer.swift"
# The app runs this copy of the lap timer, so the two always come from the same source.
compile "../Lap Timer/laptimer.swift" "$APP/Contents/MacOS/laptimer" -parse-as-library
[[ -f AppIcon.icns ]] && cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# The app shows this as its "What's new" note.
cp ../CHANGELOG.md "$APP/Contents/Resources/CHANGELOG.md"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$NAME</string>
    <key>CFBundleDisplayName</key><string>$NAME</string>
    <key>CFBundleIdentifier</key><string>$ID</string>
    <key>CFBundleExecutable</key><string>$NAME</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.video</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

# Signed "ad hoc": enough for the app to run, though macOS still asks before opening a downloaded copy.
codesign --force --sign - "$APP/Contents/MacOS/laptimer"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "Built $APP (v$VERSION, ${ARCHS[*]})"
