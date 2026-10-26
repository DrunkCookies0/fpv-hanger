# FPV Hangar

An app for FPV pilots, for Windows and Mac: a hangar of tools, opened from one first screen. The first tool is the Video Creator, which turns a goggle recording into lap times, finished videos with a timer and music on them, and a filled-in race entry form. Right now it is set up for the RaceGOW whoop series.

## Download

**[Get the latest version](https://github.com/DrunkCookies0/fpv-hanger/releases/latest)**: one zip for a Mac with Apple silicon (macOS 13 or newer), one for Windows 10 or 11.

The app is not signed, so macOS and Windows both ask before opening it the first time. The read-me in each download says how to let it through. After that the app updates itself from this repository's releases.

## What it does

- **Set up in two questions.** Your pilot name, and whether you fly RaceGOW6. If you do, the app finds your registration number on the series' public pilot list.
- **Your groups and races at a glance.** The Video Creator opens on Your flying: your groups, races and runs, the season's next track, what is waiting on you (clips to mark, entries to send) and your latest races. Your groups sit down the left, each with its logo, and choosing one shows its races beside it.
- **Follow the season.** For RaceGOW6, each track appears on the day it opens, with its deadline and its own entry form, read from what the series publishes.
- **Add clips.** Choose your recordings, or drop them onto a track's page. One added by itself opens straight into marking.
- **Mark laps.** Step through a clip frame by frame and press M each time you cross the start/finish gate. The lap timer shows over the picture as you go, exactly as the video will have it.
- **Rank runs.** Each track's runs are listed fastest first by best three laps in a row.
- **Make videos.** A 16:9 video for YouTube and a 9:16 one for Shorts, TikTok and Reels, with the timer, your name, the event and the race's date drawn in, in a colour you choose. A RaceGOW track has no date. A clip or a picture of your own can go before and after.
- **Add music.** Songs go into one library, for every track, and the marks you put in a song stay with it. The app works out a song's tempo and finds its drops, and puts a drop on the start gate with one press.
- **Find music.** Songs for a run from your song library, your Spotify's Liked Songs, NCS's catalog and SoundScout's (Monstercat's), ranked by whether they last the video with a drop on the start gate and whether your gates land on their beat, and by how near they are to what you listen to. Each says whether it is free to use, cleared with a SoundScout plan, not cleared, or copyrighted. An NCS song is added with the credit it asks for, which goes into your videos' descriptions; a SoundScout song is downloaded there with a plan and added as a file. Spotify is connected with a free app of your own in Spotify for Developers, which needs Spotify Premium.
- **Upload.** Send a finished video to YouTube, YouTube Shorts, TikTok or Instagram through each site's own upload page: TikTok's and Instagram's shown in the app, which puts the video in, and YouTube's in your own browser, since Google doesn't allow signing in inside an app. The app writes a title and description or a caption for each site from the run, and keeps each video's link with its run, so the run shows where it went up and the entry form has the YouTube link. With a free YouTube key of your own, each run shows its YouTube views, likes and comments. You sign in on the site's own page, and its own button posts it.
- **Submit.** The app checks your answers with you, then fills the track's Google Form in. You press Submit yourself.
- **See the track in 3D.** A track's pipes on their grid with the lap flown round them. Build one by clicking sections into place, or have the app read the pipes out of the track's video.
- **Leaderboards.** Every entry on each track as the series has it, with yours picked out.
- **One library on two computers.** Keep your library in Google Drive and your Mac and your PC open the same one. Google's own Drive for desktop carries it between them, so the app never signs in to anything.
- **Set up your radio.** EdgeTX Companion, under Radio on the first screen, for a RadioMaster TX15 Max or any radio that runs EdgeTX: its models, mixes, switches, telemetry and screens, tried out in a simulator and written to the radio, and its firmware updated. The app fetches Companion from EdgeTX's Releases page, checks it against the checksum GitHub keeps for it, and says when a newer one is out.
- **Back up your radio.** Whenever the radio is plugged in with USB Storage (SD) chosen on it, the app copies everything on its SD card, where EdgeTX keeps all its models and settings, into Documents/EdgeTX/backups. A new backup is kept only when something on the card has changed. Its sheet lists them and says how to put one back.
- **Groups and races.** Races are grouped by series or club, each group with its own name on the timer, its own ID number, and a logo of your choosing on its videos. Each race has its own name and the day it was flown.

## Coming soon

These are marked "Coming soon" in the app and do nothing yet:

- A Video Creator for any footage, without a race series

## Building it

The app is in `Hangar/`. It is [Electron](https://www.electronjs.org) with plain JavaScript modules and no build step, and it runs [FFmpeg](https://ffmpeg.org) as a separate program. You need Node 22 or newer, and an Apple silicon Mac to package it.

```sh
cd Hangar
npm ci              # Electron's package
npx install-electron  # and its program, for the computer you are on
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
| `.github/workflows/release.yml` | Builds a release, has the Mac app try itself out on a Mac and the Windows app on Windows, and publishes it when both pass: when a version tag is pushed, or when it is run by hand with Publish ticked |
| `Dashboard/`, `Lap Timer/` | The first Mac app, in Swift, as it was at v0.12.1. Releases are no longer built from it. A copy of it updates into the new app by itself |

The library is a folder, `FPV Hangar` in your Movies or Videos folder unless you choose another. Each event is a folder in it with its tracks inside, and a track's recordings, markers and finished videos are plain files. `dashboard.json` and `settings.json` hold what the app remembers.

### Things to keep

- `dashboard.json` and `settings.json` are also read and written by the first Mac app, which writes them out with only the fields it knows. Anything new the app has to remember goes in `hangar.json` beside them.
- The timer is drawn by one piece of code, `shared/panel.js`, for the marker editor and for the videos, so the two can't differ.
- A video is made in one run of FFmpeg. Nothing given to it may go on without end: the run is cut at its own last frame, and a still picture is given once and held, not looped. One that did kept FFmpeg running for ever whenever the music ended before the picture.
- Recordings are lightened and everything laid over them is mixed in light (`shared/video.js`), so that videos look as the first Mac app's did. `Hangar/dev/colour/` has what measured that.
- Nothing from the series' spreadsheets or anybody's library is in the source or the tests. The app reads them when it runs.
- SoundScout's catalog is read from `www.soundscout.com/api/catalog`, the address its own player reads it from, which needs no sign-in. It isn't offered to other programs: it can change or close without warning, and SoundScout's terms (section 8.1(f)) ask for its written permission to read the catalog by a program. It is read a page at a time, at most once a week, and the app never plays or fetches SoundScout's music. NCS's site has no such rule; it is read the same way.
- The key Spotify gives for a pilot's account is kept in the app's own `config.json` on each computer, never in the library, which may be in Google Drive.
- A track's video is read at 480 lines on purpose: the search for pipes was worked out on a picture that soft.
- A radio's card is only read, as a card from the goggles is. A backup that is put back is put back by the pilot, or by Companion.

## Releasing a version

Versions are `0.MINOR.PATCH`: the middle number for something new, the last for fixes.

1. Put the new number in `VERSION` and add an entry to `CHANGELOG.md`.
2. Commit and push `main`.
3. On the Actions page, open Release, press Run workflow on `main` and tick Publish. Or run `./publish.sh`, which pushes `main` and a `v<version>` tag that starts the same workflow.
4. The workflow runs the tests and `./package.sh` on GitHub, and once they pass it publishes a release with the Mac zip, the Windows zip and `latest.json` attached, making the tag itself when there isn't one. Copies of the app read `latest.json` to find a newer version.

`./package.sh` also works on your own Mac, to try the packages before releasing them. It writes into `Releases/`, which is not part of the repository. Run from the Actions page with Publish left unticked, the workflow does everything but publish.

FFmpeg is free software under the GNU General Public License. It is carried inside the app as a separate program, with its licence, and its source is at https://ffmpeg.org. The typeface is Inter, under the SIL Open Font License.

The tools under Firmware & setup and Radio are other projects' and are not part of FPV Hangar. The Betaflight app (https://github.com/betaflight/betaflight-configurator) and the ExpressLRS Web Flasher (https://github.com/ExpressLRS/web-flasher) are opened from those projects' own sites, in a window of the app. The ExpressLRS Configurator (https://github.com/ExpressLRS/ExpressLRS-Configurator) and EdgeTX Companion (https://github.com/EdgeTX/edgetx) are fetched from those projects' own Releases pages onto your computer, where each stays a program of its own. Nothing of theirs is in this repository or in the app's downloads. Betaflight, ExpressLRS and EdgeTX are those projects' names; FPV Hangar is not connected with any of them or endorsed by them.
