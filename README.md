# FPV Hangar

A Mac app for FPV pilots: a hangar of tools, opened from one first screen. The first tool is the Video Creator, which turns a goggle recording into lap times, finished videos with a timer and music on them, and a filled-in race entry form. Right now it is set up for the [RaceGOW](https://www.racegow.com/home) whoop series, where the fastest three consecutive laps are judged from a submitted video.

## Download

**[Get the latest version](https://github.com/DrunkCookies0/fpv-hanger/releases/latest)**. It needs macOS 14 or newer.

The app is not from the App Store, so macOS asks before opening it the first time. The read-me in the download says how to let it through. After that the app updates itself from this repository's releases.

## What it does

- **Set up in two questions.** Your pilot name, and whether you fly RaceGOW6. If you do, the app finds your registration number on the series' public pilot list.
- **Follow the season.** For RaceGOW6, each track appears on the day it opens, with its deadline and its own entry form, read from what the series publishes.
- **Add clips.** Choose your recordings, or drop them onto a track's page. One added by itself opens straight into marking.
- **Mark laps.** Step through a clip frame by frame and press M each time you cross the start/finish gate. The lap timer shows over the picture as you go, exactly as the video will have it.
- **Rank runs.** Each track's runs are listed fastest first by best three laps in a row.
- **Make videos.** A 16:9 video for YouTube and a 9:16 one for Shorts, TikTok and Reels, with the timer, your name and the event drawn in. The 9:16 timer is built around your best three laps in a row.
- **Add music.** Songs go into one library, for every track, and the marks you put in a song stay with it. The app works out a song's tempo and finds its drops, and puts a drop on the start gate with one press. Or place the song against the laps yourself on a timeline, mark points in it on a big sound wave, and drag its ends to choose where the music comes in and stops.
- **Submit.** The app checks your answers with you, then fills the track's Google Form in. For RaceGOW6 it finds each track's form by itself; for anything else, paste the link. You press Submit yourself.
- **Keep events apart.** Tracks are grouped by event, a race or a series, each with its own name on the timer, its own ID number, and a logo of your choosing on its videos.

## Coming soon

These are marked "Coming soon" in the app and do nothing yet:

- Upload to YouTube, TikTok and Instagram
- Season leaderboards

## Building it

You need a Mac with Apple's Command Line Tools (`xcode-select --install`). Nothing else: no Xcode project and no packages.

```sh
Dashboard/build.sh
```

That writes `FPV Hangar.app` into this folder, built for the Mac you are on, with the lap timer inside it.

| Path | What it is |
|---|---|
| `Dashboard/Dashboard.swift` | The app, in SwiftUI, one file |
| `Dashboard/build.sh` | Builds the app and puts the lap timer inside it |
| `Lap Timer/laptimer.swift` | The lap timer: a command-line tool that does all the timing and rendering, and listens to songs for their tempo and drops. `./laptimer --help` lists its options. Its source is compiled into the app too, for drawing the timer |
| `VERSION` | The version number, used by everything |
| `CHANGELOG.md` | What changed in each version |
| `package.sh`, `publish.sh` | Package the app, and start a release |
| `.github/workflows/release.yml` | Builds and publishes a release when a version tag is pushed |

A copy of the app that sits in a folder with a `dashboard.json` or a `Lap Timer` folder keeps its tracks in that folder. Any other copy keeps them in `~/Movies/FPV Hangar`. Inside that library, each event is a folder with its tracks inside, and a track is known by its path there, such as `RaceGOW6/Track 1`. Songs are in a `Songs` folder beside the events.

### Things to keep

- `build.sh` passes an explicit `-target …-macos14.0`. Without it the compiler stamps the app with its own SDK's version and older systems refuse to open it.
- New fields in `dashboard.json` must be optional in the Swift structs. A required field that an older file lacks makes the whole file fail to load, and the next save then overwrites it.
- The marker editor takes its keys through a local event monitor, and takes the keyboard away from any text field underneath when it opens. Without that, keys are typed into the hidden field.
- A song is opened with exact timing (`AVURLAssetPreferPreciseDurationAndTimingKey`) everywhere it is read: listened to, drawn, played and cut into a video. A drop only lands on a gate if all four agree on where it is.
- The timer is drawn by one piece of code. `build.sh` compiles `laptimer.swift` into the app as well, with `-D EMBEDDED`, which leaves out the lap timer's own entry point. The marker editor draws the timer over the picture with it, so what it shows is what the video gets. `--check-editor` compares the two, pixel for pixel. This is also why `laptimer.swift` has no code at the top level and is built with `-parse-as-library`.
- Nothing in either file may call `fatalError` or `precondition`: they put the source file's full path into the app, and `package.sh` refuses an app with a home folder path in it.

## Releasing a version

Versions are `0.MINOR.PATCH`: the middle number for something new, the last for fixes.

1. Put the new number in `VERSION` and in `toolVersion` at the top of `Lap Timer/laptimer.swift`, and add an entry to `CHANGELOG.md`.
2. Commit, then `./publish.sh`. It pushes `main` and a `v<version>` tag.
3. The tag starts the release workflow, which runs `./package.sh` on GitHub (building the app for Apple silicon and Intel) and publishes a release with the zip and `latest.json` attached. Copies of the app read `latest.json` from the newest release and offer the update.

`./package.sh` also works on your own Mac, to try a package before releasing it. It writes into `Releases/`, which is not part of the repository.

### Trying a change first

```sh
APP_NAME="FPV Hangar Test" APP_ID=local.fpvhangar.test Dashboard/build.sh
```

That builds a second copy beside the first, under its own identifier, so it has its own settings and never touches the released app. It says TEST COPY on the first screen and leaves updates alone. Beside a library it opens that library. Moved anywhere else, such as the Applications folder, it starts a library of its own in `~/Movies/FPV Hangar`, which is how to try a first run.

The app can also check itself without showing a window. `--root <folder>` points any of these at a copy of a library:

- `--check-fresh <recording> <song> <gate crossings in seconds…>` goes from an empty folder to finished videos the way a new pilot does.
- `--check-clicks [WIDTHxHEIGHT]` works the first screen, the editor and the sound wave window with real clicks, drags and keys, in a window put up off-screen.
- `--check-editor` checks frame-exact seeking, the marker keys, what is heard in a song, and that the timer drawn over the picture is the video's.
- `--check-pilots [names or numbers…]` checks the pilot list lookup, and `--check-season` the reading of the season's schedule and forms and the way a library fills with its tracks.
- `--snapshot out.png <page> [WIDTHxHEIGHT]` draws a page to a picture. The lap timer checks its own ear with `laptimer --check-listening`, which `package.sh` runs before it packages.
