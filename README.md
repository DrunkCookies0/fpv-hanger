# FPV Hangar

A Mac app for FPV pilots. It turns a goggle recording into lap times, a timer overlay, finished videos and a filled-in race entry form. Right now it is built around the [RaceGOW](https://www.racegow.com/home) whoop series, where the fastest three consecutive laps are judged from a submitted video.

## Download

**[Get the latest version](https://github.com/DrunkCookies0/fpv-hanger/releases/latest)**. It needs macOS 14 or newer.

The app is not from the App Store, so macOS asks before opening it the first time. The read-me in the download says how to let it through. After that the app updates itself from this repository's releases.

## What it does

- **Add clips.** Choose your recordings, or drop them onto a track's page.
- **Mark laps.** Step through a clip frame by frame and press M each time you cross the start/finish gate.
- **Rank runs.** Each track's runs are listed fastest first by best three laps in a row.
- **Make videos.** A 16:9 video for YouTube and a 9:16 one for Shorts, TikTok and Reels, with the timer, your name and the event drawn in. Or a transparent timer overlay to finish the video in Premiere.
- **Add music.** Place a song against the laps on a timeline and choose where the video starts and ends.
- **Submit.** Paste a track's Google Form link and the app fills the form in. You press Submit yourself.
- **Keep events apart.** Tracks are grouped by event, a race or a series, each with its own name on the timer and its own ID number.

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
| `Lap Timer/laptimer.swift` | The lap timer: a command-line tool that does all the timing and rendering. `./laptimer --help` lists its options |
| `VERSION` | The version number, used by everything |
| `CHANGELOG.md` | What changed in each version |
| `package.sh`, `publish.sh` | Package the app, and start a release |
| `.github/workflows/release.yml` | Builds and publishes a release when a version tag is pushed |

A copy of the app that sits in a folder with a `dashboard.json` or a `Lap Timer` folder keeps its tracks in that folder. Any other copy keeps them in `~/Movies/FPV Hangar`. Inside that library, each event is a folder with its tracks inside, and a track is known by its path there, such as `RaceGOW6/Track 1`.

### Things to keep

- `build.sh` passes an explicit `-target …-macos14.0`. Without it the compiler stamps the app with its own SDK's version and older systems refuse to open it.
- New fields in `dashboard.json` must be optional in the Swift structs. A required field that an older file lacks makes the whole file fail to load, and the next save then overwrites it.
- The marker editor takes its keys through a local event monitor, and takes the keyboard away from any text field underneath when it opens. Without that, keys are typed into the hidden field.

## Releasing a version

Versions are `0.MINOR.PATCH`: the middle number for something new, the last for fixes.

1. Put the new number in `VERSION` and in `toolVersion` at the top of `Lap Timer/laptimer.swift`, and add an entry to `CHANGELOG.md`.
2. Commit, then `./publish.sh`. It pushes `main` and a `v<version>` tag.
3. The tag starts the release workflow, which runs `./package.sh` on GitHub (building the app for Apple silicon and Intel) and publishes a release with the zip and `latest.json` attached. Copies of the app read `latest.json` from the newest release and offer the update.

`./package.sh` also works on your own Mac, to try a package before releasing it. It writes into `Releases/`, which is not part of the repository.
