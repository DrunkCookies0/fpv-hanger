# FPV Hangar

An app for FPV pilots, for Windows and Mac: a hangar of tools, opened from one first screen. The first tool is the Video Creator, which turns a goggle recording into lap times, finished videos with a timer and music on them, and a filled-in race entry form. Right now it is set up for the RaceGOW whoop series.

## Download

**[Get the latest version](https://github.com/DrunkCookies0/fpv-hanger/releases/latest)**: one zip for a Mac with Apple silicon (macOS 13 or newer), one for Windows 10 or 11.

The app is not signed, so macOS and Windows both ask before opening it the first time. The read-me in each download says how to let it through. After that the app updates itself from this repository's releases.

## What it does

- **Set up in two questions.** Your pilot name, and whether you fly RaceGOW6. If you do, the app finds your registration number on the series' public pilot list.
- **Follow the season.** For RaceGOW6, each track appears on the day it opens, with its deadline and its own entry form, read from what the series publishes.
- **Add clips.** Choose your recordings, or drop them onto a track's page. One added by itself opens straight into marking.
- **Mark laps.** Step through a clip frame by frame and press M each time you cross the start/finish gate. The lap timer shows over the picture as you go, exactly as the video will have it.
- **Rank runs.** Each track's runs are listed fastest first by best three laps in a row.
- **Make videos.** A 16:9 video for YouTube and a 9:16 one for Shorts, TikTok and Reels, with the timer, your name and the event drawn in, in a colour you choose. A clip or a picture of your own can go before and after.
- **Add music.** Songs go into one library, for every track, and the marks you put in a song stay with it. The app works out a song's tempo and finds its drops, and puts a drop on the start gate with one press.
- **Submit.** The app checks your answers with you, then fills the track's Google Form in. You press Submit yourself.
- **See the track in 3D.** A track's pipes on their grid with the lap flown round them. Build one by clicking sections into place, or have the app read the pipes out of the track's video.
- **Leaderboards.** Every entry on each track as the series has it, with yours picked out.
- **Keep events apart.** Tracks are grouped by event, a race or a series, each with its own name on the timer, its own ID number, and a logo of your choosing on its videos.

## Coming soon

These are marked "Coming soon" in the app and do nothing yet:

- Upload to YouTube, TikTok and Instagram
- A Video Creator for any footage, without a race series

## Building it

The app is in `Hangar/`. It is [Electron](https://www.electronjs.org) with plain JavaScript modules and no build step, and it runs [FFmpeg](https://ffmpeg.org) as a separate program. You need Node 22 or newer, and an Apple silicon Mac to package it.

```sh
cd Hangar
npm ci              # Electron, for the computer you are on
tools/fetch.sh      # Electron for Windows, and FFmpeg for both: fetched and checked, not kept here
npx electron .      # the app, run from its source
npm test            # its tests
```

`npx electron . --self-test --report report.txt` has the app try itself out from start to finish, with no window, on a library and a recording it makes for the purpose.

| Path | What it is |
|---|---|
| `Hangar/main/` | The main process: the library on disk, FFmpeg, videos, updates, and the one list of things a page can ask for (`api.js`) |
| `Hangar/renderer/` | The window's pages. They have no access to files or programs: they ask the main process |
| `Hangar/shared/` | What both use and the tests cover: timing, the timer's drawing, the video's instructions for FFmpeg, the series' pages, tracks |
| `Hangar/worker/` | Draws the timer for every frame of a video and hands the frames to FFmpeg |
| `Hangar/assets/` | The typeface, the colour table that makes videos match the first Mac app's, the icon, and the tracks that come with the app |
| `Hangar/tools/` | `fetch.sh`, and `package.sh`, which puts the app together for a Mac or for Windows |
| `Hangar/test/` | The tests. Their pilots, times and links are made up |
| `VERSION`, `CHANGELOG.md` | The version number, used by everything, and what changed in each version |
| `package.sh`, `publish.sh` | Package both apps for release, and start a release |
| `.github/workflows/release.yml` | Builds and publishes a release when a version tag is pushed |
| `Dashboard/`, `Lap Timer/` | The first Mac app, in Swift, as it was at v0.12.1. Releases are no longer built from it. A copy of it updates into the new app by itself |

The library is a folder, `FPV Hangar` in your Movies or Videos folder unless you choose another. Each event is a folder in it with its tracks inside, and a track's recordings, markers and finished videos are plain files. `dashboard.json` and `settings.json` hold what the app remembers.

### Things to keep

- `dashboard.json` and `settings.json` are also read and written by the first Mac app, which writes them out with only the fields it knows. Anything new the app has to remember goes in `hangar.json` beside them.
- The timer is drawn by one piece of code, `shared/panel.js`, for the marker editor and for the videos, so the two can't differ.
- A video is made in one run of FFmpeg. Nothing given to it may go on without end: the run is cut at its own last frame, and a still picture is given once and held, not looped. One that did kept FFmpeg running for ever whenever the music ended before the picture.
- Recordings are lightened and everything laid over them is mixed in light (`shared/video.js`), so that videos look as the first Mac app's did. `Hangar/dev/colour/` has what measured that.
- Nothing from the series' spreadsheets or anybody's library is in the source or the tests. The app reads them when it runs.
- A track's video is read at 480 lines on purpose: the search for pipes was worked out on a picture that soft.

## Releasing a version

Versions are `0.MINOR.PATCH`: the middle number for something new, the last for fixes.

1. Put the new number in `VERSION` and add an entry to `CHANGELOG.md`.
2. Commit, then `./publish.sh`. It pushes `main` and a `v<version>` tag.
3. The tag starts the release workflow, which runs `./package.sh` on GitHub and publishes a release with the Mac zip, the Windows zip and `latest.json` attached. Copies of the app read `latest.json` to find a newer version.

`./package.sh` also works on your own Mac, to try the packages before releasing them. It writes into `Releases/`, which is not part of the repository. Run from the Actions page by hand, the workflow does everything but publish.

FFmpeg is free software under the GNU General Public License. It is carried inside the app as a separate program, with its licence, and its source is at https://ffmpeg.org. The typeface is Inter, under the SIL Open Font License.
