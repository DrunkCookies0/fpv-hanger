What is in this folder, where it came from, and its checksum. None of it is kept in the repository:
tools/fetch.sh fetches it, checks each file against the checksum written there, and it is carried
inside the packaged app.

  Electron 44.7.0 for Windows
    https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-win32-x64.zip
    sha256 eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c  (matches Electron's SHASUMS256.txt)
    unpacked into electron-win32-x64/

  Electron 44.7.0 for this Mac comes through npm (node_modules/electron).

  FFmpeg for Apple silicon Macs (reports itself as 6.0, with libx264)
    https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz
    sha256 8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa
    unpacked as darwin-arm64/ffmpeg

  FFmpeg 8.1 for Windows, 64-bit (GPL build, with libx264): n8.1.3-14-g330caae0c1, built 8 October 2026
    https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/ffmpeg-n8.1.3-14-g330caae0c1-win64-gpl-8.1.zip
    sha256 6e63b4f8aae35949f4a5b471784f97a51b29b2466038769e3f8ecf513316ec6c
    ffmpeg.exe and its licence unpacked into win32-x64/
    The builder keeps a dated build like this one for about two weeks. For a release made after it
    has gone, take the newest dated build from https://github.com/BtbN/FFmpeg-Builds/releases, put
    its address and checksum here and in tools/fetch.sh, and try the Windows app with it first.

  Inter 4.1, the typeface (SIL Open Font License)
    https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
    sha256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e
    InterVariable.woff2 and its licence are in ../assets/fonts/

FFmpeg is run as a separate program. It is free software under the GNU General Public License; its
licence goes out with the app, and its source is at https://ffmpeg.org.
