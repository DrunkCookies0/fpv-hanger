#!/bin/zsh
# Fetches what the app is built on and the repository doesn't keep: Electron for Windows, and FFmpeg
# for each kind of computer. Each download is checked against its SHA-256 before anything is taken
# from it, and whatever is here already is left alone. Electron for the Mac this runs on comes
# through npm (npm ci), which checks it the same way.
#
# vendor/README.txt says where each comes from. To move to a newer one, change its address and
# checksum here and there.
set -e
cd "${0:A:h}/.."
mkdir -p vendor/downloads

# fetch <file to keep it as> <address> <sha256>
fetch() {
  local file="vendor/downloads/$1"
  if [[ ! -f "$file" ]] || [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" != "$3" ]]; then
    mkdir -p "${file:h}"
    echo "Fetching ${1:t}"
    curl -L --fail --silent --show-error -o "$file.part" "$2"
    mv "$file.part" "$file"
  fi
  [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" == "$3" ]] || { echo "${1:t} isn't the file it should be: its checksum is wrong."; exit 1 }
}

# Electron for Windows.
if [[ ! -f vendor/electron-win32-x64/electron.exe ]]; then
  fetch electron-win/electron-v44.7.0-win32-x64.zip \
    https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-win32-x64.zip \
    eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c
  rm -rf vendor/electron-win32-x64
  mkdir -p vendor/electron-win32-x64
  unzip -q vendor/downloads/electron-win/electron-v44.7.0-win32-x64.zip -d vendor/electron-win32-x64
fi

# FFmpeg for Apple silicon Macs.
if [[ ! -x vendor/darwin-arm64/ffmpeg ]]; then
  fetch ffmpeg-mac/ffmpeg-darwin-arm64.gz \
    https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz \
    8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa
  mkdir -p vendor/darwin-arm64
  gunzip -c vendor/downloads/ffmpeg-mac/ffmpeg-darwin-arm64.gz > vendor/darwin-arm64/ffmpeg
  chmod +x vendor/darwin-arm64/ffmpeg
fi

# FFmpeg for Windows. The builder keeps a dated build for about two weeks, so this address is moved
# on when a release is made after that: see vendor/README.txt.
if [[ ! -f vendor/win32-x64/ffmpeg.exe ]]; then
  fetch ffmpeg-win/ffmpeg-n8.1.3-14-g330caae0c1-win64-gpl-8.1.zip \
    https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/ffmpeg-n8.1.3-14-g330caae0c1-win64-gpl-8.1.zip \
    6e63b4f8aae35949f4a5b471784f97a51b29b2466038769e3f8ecf513316ec6c
  mkdir -p vendor/win32-x64
  unzip -q -j -o vendor/downloads/ffmpeg-win/ffmpeg-n8.1.3-14-g330caae0c1-win64-gpl-8.1.zip "*/bin/ffmpeg.exe" "*/LICENSE.txt" -d vendor/win32-x64
  mv vendor/win32-x64/LICENSE.txt vendor/win32-x64/FFmpeg-LICENSE.txt
fi

echo "Everything the app is built on is here."
