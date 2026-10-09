#!/bin/zsh
# Puts FPV Hangar together as an app for this Mac or for Windows. Nothing is compiled: it is
# Electron's own files for that platform, the app's pages and code, and FFmpeg.
#
#   tools/package.sh mac  [name] [folder]    <folder>/<name>.app, for the kind of Mac this is run on
#   tools/package.sh win  [name] [folder]    <folder>/<name>/ and <folder>/<name>-win64.zip
#   tools/package.sh win-setup [name] [folder]
#                                            a small zip for when the whole thing is too big to send:
#                                            the app's own files and a script that fetches Electron
#                                            and FFmpeg on the Windows PC itself and puts it together
#
# The name defaults to "FPV Hangar Test", a copy to try changes in beside the released app. It
# keeps what it remembers under its own name, says TEST COPY, and leaves updates alone.
set -e
cd "${0:A:h}/.."
PLATFORM="${1:?mac or win}"
NAME="${2:-FPV Hangar Test}"
OUT="${3:-dist}"
VERSION="$(< ../VERSION)"
mkdir -p "$OUT"

# The app itself: what is the same on both.
fill() {
  local app="$1" resources="$2"
  mkdir -p "$app"
  cp -R main renderer shared worker "$app/"
  mkdir -p "$app/assets"
  cp -R assets/fonts assets/colour assets/tracks assets/icon.png "$app/assets/"
  cat > "$app/package.json" <<JSON
{ "name": "fpv-hangar", "productName": "$NAME", "version": "$VERSION", "description": "A hangar of tools for FPV pilots, for Windows and Mac.", "private": true, "type": "module", "main": "main/main.js" }
JSON
  # The version and the changelog sit beside the app, where it looks for them.
  cp ../VERSION ../CHANGELOG.md "$resources/"
  find "$app" -name ".DS_Store" -delete
}

if [[ "$PLATFORM" == mac ]]; then
  APP="$OUT/$NAME.app"
  rm -rf "$APP"
  cp -R node_modules/electron/dist/Electron.app "$APP"
  RESOURCES="$APP/Contents/Resources"
  rm -rf "$RESOURCES/default_app.asar"
  fill "$RESOURCES/app" "$RESOURCES"
  mkdir -p "$RESOURCES/ffmpeg"
  cp "vendor/darwin-$(uname -m | sed 's/x86_64/x64/')/ffmpeg" "$RESOURCES/ffmpeg/ffmpeg"
  cp ../Dashboard/AppIcon.icns "$RESOURCES/electron.icns"
  # Electron's own program keeps its name inside the app: its helpers are found by it.
  PLIST="$APP/Contents/Info.plist"
  # A copy to try gets an identity of its own. APP_ID gives the released app's, so that the Mac
  # app before this one takes it for its own next version and updates into it.
  ID="${APP_ID:-local.fpvhangar.$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')}"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" -c "Set :CFBundleDisplayName $NAME" -c "Set :CFBundleIdentifier $ID" \
    -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$PLIST"
  /usr/libexec/PlistBuddy -c "Delete :ElectronAsarIntegrity" "$PLIST" 2>/dev/null || true
  codesign --force --deep --sign - "$APP" 2>/dev/null
  echo "Made $APP (v$VERSION, $(du -sh "$APP" | cut -f1 | tr -d ' '))"
elif [[ "$PLATFORM" == win ]]; then
  FOLDER="$OUT/$NAME"
  ZIP="$OUT/${NAME// /-}-win64.zip"
  rm -rf "$FOLDER" "$ZIP"
  cp -R vendor/electron-win32-x64 "$FOLDER"
  mv "$FOLDER/electron.exe" "$FOLDER/$NAME.exe"
  rm -f "$FOLDER/resources/default_app.asar"
  fill "$FOLDER/resources/app" "$FOLDER/resources"
  mkdir -p "$FOLDER/resources/ffmpeg"
  cp vendor/win32-x64/ffmpeg.exe vendor/win32-x64/FFmpeg-LICENSE.txt "$FOLDER/resources/ffmpeg/"
  printf '%s\r\n' \
    "FPV HANGAR FOR WINDOWS: A COPY TO TRY (v$VERSION)" "" \
    "  1. Unzip the whole folder somewhere, such as your Desktop. Don't run it from inside the zip." \
    "  2. Open \"$NAME.exe\". Windows may say it protected your PC, because this copy isn't signed:" \
    "     press \"More info\", then \"Run anyway\"." \
    "  3. Answer its two questions, open Video Creator, and add a goggle recording to a track." "" \
    "Your tracks, markers and videos are kept in a folder called \"FPV Hangar\" in your Videos folder." \
    "If something goes wrong, Pilot & settings has a button, Show what went wrong, that shows a file" \
    "to send back. The app sends nothing anywhere by itself." "" \
    "The video engine inside it is FFmpeg (ffmpeg.org), which is free software; its licence is in" \
    "resources/ffmpeg. The typeface is Inter (rsms.me/inter), under the SIL Open Font License." \
    "" \
    "TO TEST THIS COPY: double-click \"Test this copy\". The app tries itself out on a made-up" \
    "recording, with no window, for a few minutes, and writes \"Test report.txt\" here. Send that back." \
    > "$FOLDER/READ ME FIRST.txt"
  cat > "$FOLDER/Test this copy.cmd" <<CMD
@echo off
rem Tries the app out from start to finish on a made-up recording, without opening its window,
rem and writes how it went into "Test report.txt" beside this file. Nothing of yours is opened.
cd /d "%~dp0"
echo FPV Hangar is trying itself out on a made-up recording. No window opens.
echo It takes a few minutes. When it is done the report opens: send that file back.
start "" /wait "%~dp0$NAME.exe" --self-test --report "%~dp0Test report.txt"
start "" notepad "%~dp0Test report.txt"
CMD
  perl -pi -e 's/\r?\n/\r\n/' "$FOLDER/Test this copy.cmd"
  (cd "$OUT" && zip -r -X -q "${ZIP:t}" "$NAME" -x "*.DS_Store")
  echo "Made $ZIP (v$VERSION, $(du -h "$ZIP" | cut -f1 | tr -d ' '))"
elif [[ "$PLATFORM" == win-setup ]]; then
  FOLDER="$OUT/$NAME setup"
  ZIP="$OUT/${NAME// /-}-win64-setup.zip"
  rm -rf "$FOLDER" "$ZIP"
  mkdir -p "$FOLDER/resources"
  fill "$FOLDER/resources/app" "$FOLDER/resources"
  cat > "$FOLDER/Set up and run.cmd" <<'CMD'
@echo off
rem Fetches Electron and FFmpeg, puts FPV Hangar together beside this file, and starts it.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo It stopped before it finished. Copy what is written above and send it back.
  pause
)
CMD
  sed "s/__NAME__/$NAME/g" > "$FOLDER/setup.ps1" <<'PS'
# Puts FPV Hangar together on this PC. It downloads two things from their own release pages on
# GitHub, unpacks them beside this file, and starts the app. Nothing is installed: to remove it,
# delete this folder.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "__NAME__"
$out = Join-Path $here $name
$exe = Join-Path $out "$name.exe"

$electronUrl = "https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-win32-x64.zip"
$electronSha = "eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c"
$ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-8.1.zip"

function Fetch($url, $file) {
  if (Test-Path $file) { return }
  $part = "$file.part"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --progress-bar -o $part $url
    if ($LASTEXITCODE -ne 0) { throw "The download of $url didn't finish." }
  } else {
    Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing
  }
  Move-Item $part $file -Force
}

function Unpack($zip, $folder) {
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    & tar.exe -xf $zip -C $folder
    if ($LASTEXITCODE -ne 0) { throw "Couldn't unpack $zip." }
  } else {
    Expand-Archive -Path $zip -DestinationPath $folder -Force
  }
}

if (-not (Test-Path $exe)) {
  Write-Host "1 of 3  Fetching Electron, the browser the app is built on (158 MB)..."
  $electronZip = Join-Path $here "electron-win32-x64.zip"
  Fetch $electronUrl $electronZip
  if ((Get-FileHash $electronZip -Algorithm SHA256).Hash.ToLower() -ne $electronSha) {
    Remove-Item $electronZip -Force
    throw "Electron's download doesn't match its published checksum. Run this again."
  }
  Write-Host "2 of 3  Fetching FFmpeg, the video engine (193 MB)..."
  $ffmpegZip = Join-Path $here "ffmpeg-win64.zip"
  Fetch $ffmpegUrl $ffmpegZip

  Write-Host "3 of 3  Putting it together..."
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  Unpack $electronZip $out
  Rename-Item (Join-Path $out "electron.exe") "$name.exe"
  $default = Join-Path $out "resources\default_app.asar"
  if (Test-Path $default) { Remove-Item $default -Force }
  Copy-Item (Join-Path $here "resources\*") (Join-Path $out "resources") -Recurse -Force
  $unpacked = Join-Path $here "ffmpeg-unpacked"
  if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
  Unpack $ffmpegZip $unpacked
  $found = Get-ChildItem $unpacked -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
  if (-not $found) { throw "FFmpeg's download has no ffmpeg.exe in it." }
  New-Item -ItemType Directory -Path (Join-Path $out "resources\ffmpeg") -Force | Out-Null
  Copy-Item $found.FullName (Join-Path $out "resources\ffmpeg\ffmpeg.exe")
  $licence = Get-ChildItem $unpacked -Recurse -Filter "LICENSE.txt" | Select-Object -First 1
  if ($licence) { Copy-Item $licence.FullName (Join-Path $out "resources\ffmpeg\FFmpeg-LICENSE.txt") }
  Remove-Item $unpacked -Recurse -Force
}

Write-Host "Starting FPV Hangar."
Start-Process $exe
PS
  cat > "$FOLDER/READ ME FIRST.txt" <<TXT
FPV HANGAR FOR WINDOWS: A COPY TO TRY (v$VERSION, small download)

  1. Unzip this whole folder somewhere, such as your Desktop. Don't run it from inside the zip.
  2. Double-click "Set up and run". Windows may say it protected your PC, because this copy isn't
     signed: press "More info", then "Run anyway".
     It downloads two things from their own pages on GitHub, about 350 MB in all: Electron, the
     browser the app is built on, and FFmpeg, the video engine. It checks Electron against its
     published checksum, unpacks both beside this file, and starts the app. Nothing is installed.
  3. Answer the app's two questions, open Video Creator, and add a goggle recording to a track.

Your tracks, markers and videos are kept in a folder called "FPV Hangar" in your Videos folder.
If something goes wrong, Pilot & settings has a button, Show what went wrong, that shows a file to
send back. The app sends nothing anywhere by itself.

TO TEST THIS COPY: once it is set up, double-click "Test this copy". The app tries itself out on a
made-up recording, with no window, for a few minutes, and writes "Test report.txt" here. Send that
back.

To open the app again later, double-click "Set up and run" again: it skips the downloads. Or open
"$NAME.exe" in the "$NAME" folder it made.
To remove everything, delete this folder.

FFmpeg (ffmpeg.org) is free software under the GNU General Public License. The typeface is Inter
(rsms.me/inter), under the SIL Open Font License.
TXT
  # Windows wants its own line endings in a batch file, and Notepad reads them best in the read-me.
  cat > "$FOLDER/Test this copy.cmd" <<CMD
@echo off
rem Tries the app out from start to finish on a made-up recording, without opening its window,
rem and writes how it went into "Test report.txt" beside this file. Nothing of yours is opened.
cd /d "%~dp0"
if not exist "%~dp0$NAME\\$NAME.exe" (
  echo Double-click "Set up and run" first. This tests the copy that puts together.
  pause
  exit /b 1
)
echo FPV Hangar is trying itself out on a made-up recording. No window opens.
echo It takes a few minutes. When it is done the report opens: send that file back.
start "" /wait "%~dp0$NAME\\$NAME.exe" --self-test --report "%~dp0Test report.txt"
start "" notepad "%~dp0Test report.txt"
CMD
  perl -pi -e 's/\r?\n/\r\n/' "$FOLDER/Set up and run.cmd" "$FOLDER/setup.ps1" "$FOLDER/READ ME FIRST.txt" "$FOLDER/Test this copy.cmd"
  (cd "$OUT" && zip -r -X -q "${ZIP:t}" "$NAME setup" -x "*.DS_Store")
  echo "Made $ZIP (v$VERSION, $(du -h "$ZIP" | cut -f1 | tr -d ' '))"
else
  echo "mac, win or win-setup" >&2
  exit 1
fi
