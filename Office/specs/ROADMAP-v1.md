# The road to v1.0

By the Product Manager, for Chief and the CEO. 26 October 2026. A proposal, not a plan: the
order is mine, the decisions are the CEO's, and no version here has a date.

What I read: `README.md`, `CHANGELOG.md` from v0.1.0 to v0.27.0, the pages under
`Hangar/renderer/views/`, the words the app uses (`Hangar/renderer/words.js`), what a page can ask
for (`Hangar/main/api.js`), how the series' sheets are read (`Hangar/shared/series.js` and
`leaderboard.js`), how the app is packaged (`Hangar/tools/package.sh`) and what its self-test
covers (`Hangar/main/checks.js`).

## Where the app is

v0.27.0 takes a RaceGOW6 pilot from a goggle recording to a submitted entry: the tracks appear by
themselves, laps are marked frame by frame, two videos are made with the timer and music on them,
each goes up through the site's own page, and the entry form is filled in. Around that sit the
leaderboards, the track in 3D, Find music, the library in Google Drive, the card from the goggles,
Betaflight, ExpressLRS and EdgeTX's tools, and the radio's backups. Twenty-seven versions in
nineteen days, and the whole of it built around one series and one season.

One tile on the first screen still says Coming soon: the Video Creator for any footage. It is the
only thing the read-me promises that the app doesn't do.

## What v1.0 means

A pilot should be able to tell v1.0 from v0.27.0 without reading a changelog. These have to be
true, and each can be checked:

1. **It opens like any other app.** No "More info, Run anyway" on Windows and no warning on a Mac.
   It is in Applications on a Mac and installed on Windows, and it updates itself without the
   pilot noticing.
2. **It is useful whatever you fly.** A RaceGOW pilot, a club racer and someone flying their own
   garden get the same clips, laps, timer, music, videos and uploads. Nothing on the first screen
   says Coming soon.
3. **A new season or another series doesn't need a new version of the app.** RaceGOW7 appears
   when the series opens it, with its tracks, and a series that runs the same way (a sheet, a
   form, a leaderboard) can be followed from its own pages.
4. **It takes the recordings pilots have.** HDZero, DJI, Walksnail, analog DVR and GoPro, on Windows
   and on a Mac, and each kind is tried before every release.
5. **When something goes wrong, the app says what and what to do**, in words a pilot can act on,
   and what the CEO needs to look into it is one press away.
6. **Nothing a pilot made is lost by the app.** Recordings, markers, songs and videos are plain
   files, the app's memory is backed up, and a library can be moved or shared between computers.
   This is true today, and v1.0 keeps it.
7. **The words match the app.** The read-me, the welcome note and How it works describe what the
   app does, no more and no less, with pictures where a picture is quicker.

Everything else is after v1.0, however good.

## The gaps between v0.27.0 and that

**The promise in the read-me.** The Any footage tile is dimmed. Today a video can only be made of
a *run*, which is a clip with its laps marked: a clip with no markers only offers Mark laps. A
pilot with freestyle footage, a practice session or a race with no gates has nowhere to go but a
group that pretends to be a series.

**One season, written into the app.** The season's name, its pilot list, its schedule, the pages
where its forms are posted and the leaderboard sheet are fixed in the source, with a note that a
new season needs them changed there. Each track's 3D drawing ships inside a release (Track 3 came
with v0.26.0). So RaceGOW7, and every track in it, means a new version. The setup question itself
asks "Are you flying RaceGOW6?".

**Recordings.** The welcome note says it: used most with HDZero, an MP4 tried once, others not
tried. The release check runs on recordings the app makes up, which is the right test for frames
and timing and no test at all for a DJI goggles file or an analog DVR.

**Opening it.** Both downloads are unsigned. Windows says it protected your PC; a Mac asks the
pilot to let it through. The Windows read-me still says "a copy to try". On a Mac the app may not
be able to update itself from anywhere but Applications, and nothing tells the pilot it isn't
there. On Windows, running it from inside the zip is a known trap and the app can't tell.

**When things go wrong.** The app writes What went wrong.txt and Show what went wrong opens the
folder. A failed video says "No 16:9 video for clip_0012:" and then whatever FFmpeg said. A
leaderboard that can't be read quotes the network. Those are the right facts in the wrong words:
a pilot needs "try this", and the CEO, on Discord, needs the file, the version, the computer and
the recording's facts in one piece, without talking the pilot through finding them.

**Half-finished, by the changelog's own account.**

- Read the pipes from the video finds 14 of 14 sections on Track 1, "only some" on Track 2 and 8
  of 20 on Track 3 (v0.13.1, v0.26.0). The feature asks the pilot to finish its work by hand.
- Intel Macs stopped at v0.12.1 (v0.13.0). Those pilots still get the first Mac app's files, which
  is why the new app has to keep writing them (Things to keep in the read-me).
- The season's standings "will show once the series fills them in" (v0.13.0). Nobody has seen
  them drawn.
- Two ways to use Google Drive stand side by side: a library in Drive (v0.17.0) and a copy in a
  folder (v0.16.0), each with its own card.
- Give it its own folder (v0.6.0) and Premiere marker exports (v0.1.0) are still in the app for
  libraries from the first weeks.
- The 9:16 video takes about twice as long to make as it did (v0.13.0).

**Around a race day.** The app covers the recording, the laps, the videos, the upload and the
entry. It doesn't cover what pilots do with the result: a thumbnail for YouTube and a picture of
the time to post on Discord, where the pilots are. A run is called what its file is called
(hdz_0012), which is nothing to a pilot a week later. Two pilots in one house, a parent and a
child say, share one computer and one pilot name. A club race day has heats, and each heat is a
clip, which works, but nothing says which heat was which.

## The biggest ideas

One line each on why a pilot would want it.

1. **Video Creator for any footage.** Every pilot has footage that isn't a race entry, and today
   the app has nothing to do with it.
2. **A new season without a new version.** When RaceGOW7 opens, the pilot opens the app and it is
   there, tracks and all.
3. **Any series from its own sheet and form.** A pilot in another video-judged series, or the
   person running one, gets what RaceGOW pilots have without asking the CEO to build it in.
4. **A signed app.** The first thing a new pilot meets is a warning not to open it. For a parent
   installing it for a child, that is often the end.
5. **Recordings from every goggle.** A pilot with DJI goggles should not be the first to find out
   whether their file works.
6. **A thumbnail and a result card.** The video needs a thumbnail on YouTube, and the time wants
   posting on Discord; the app has the frame, the laps and the look already.
7. **Errors a pilot can act on, and a report in one press.** Fewer Discord messages that start
   with "it didn't work".
8. **Another pilot on this computer.** Two pilots in a house race under two names and two IDs, and
   each wants their own races and timer.
9. **Find the gate crossings for me.** Marking laps frame by frame is the slowest step in the
   whole job, and the app already looks at video for the track's pipes. Large, and not needed for
   v1.0: it is listed so the CEO can say otherwise.

## The versions

Numbers follow the rule in the changelog: the middle number for something new. Fixes go out as
patches between them whenever they are ready. Two to five items each; a version that grows past
that is split.

### v0.28.0: Any footage

- The Any footage tile opens on the pilot's own footage: a group of its own, with a session for
  each day's flying, dated, so nothing has to pretend to be a series.
- A video from a clip with no laps marked: the stretch chosen in Markers & music, music with a
  drop on a moment the pilot marks, the pilot's name and the group's logo, and before and after as
  now. The lap timer is off when there are no laps.
- Moments as well as gates: M marks a gate crossing as now, and a second key marks a moment
  (a dive, a gap, a crash) that the music catches on and that the finished video shows nothing
  for.
- Coming soon leaves the first screen, the welcome note, How it works and the read-me.

### v0.29.0: A new season without a new version

- The season as a small file the app fetches from this repository: the season's name, the ID
  label, the pilot list, the schedule, where the forms are posted and the leaderboard sheet. The
  app reads it once a day. A new season is a change to that file, which still goes to the CEO as
  a pull request, and never a release.
- The tracks in 3D fetched the same way, so Track 4's drawing reaches every pilot the day the CEO
  finishes it.
- The setup question asks about the season the file names, and a pilot on RaceGOW6 moves to
  RaceGOW7 by answering it again, keeping RaceGOW6's tracks and entries.
- When a sheet or a page changes shape, the app keeps what it last read, says so on the track
  page, and the file can name the new shape without a release.

### v0.30.0: Any series

- A series of your own: a group that is a series takes a pilot list, a schedule and a forms page,
  or any of the three, and its tracks appear as RaceGOW's do.
- A series file anyone running a series can publish, in the same shape as the season file, so a
  pilot pastes one link. The CEO decides whether any series' file is carried in this repository.
- Leaderboards for any series read from its own sheet, with the pilot's entry picked out as now.
- Name a run: a run is called what the pilot calls it (Heat 3, Second battery), and the file keeps
  its name.

### v0.31.0: Every goggle, every pilot

- A set of real recordings, one from each kind of goggles and camera pilots use, tried by the
  release check on Windows and on a Mac: every frame where it was, a video that starts on the
  frame asked for. Needs recordings from pilots, which is the CEO's to ask for.
- Whatever those recordings show up, fixed: frame rates the goggles claim wrongly, files with
  no sound, HDR, recordings split into parts.
- Another pilot on this computer: a second pilot name, with their own ID in each group and their
  own races, chosen at the top of the Video Creator.
- Intel Macs: in or out, as the CEO decides (see below). In means an Intel package in every
  release and the first Mac app's files left behind; out means saying so in the read-me and
  letting the new app stop writing the first app's files.

### v0.32.0: Around the race

- A thumbnail for YouTube: a frame the pilot picks, with the best three laps on it in the timer's
  look, put beside the video and offered on YouTube's upload page with the title.
- A result card: the same picture at a size Discord shows well, with Copy for Discord beside it,
  the time and the link in a line.
- The season's standings drawn, as soon as the series fills them in, and checked against what the
  series publishes. If the series never fills them in, the card that waits for them goes.

### v0.33.0: Opening it, and when things go wrong

- The Mac app signed with a Developer ID and notarised, so macOS opens it without a word, and the
  update keeps working on a signed app. Costs money and an account: see the decisions below.
- The Windows app signed, in an installer that puts it in Program Files and the Start menu and
  that updates in place. The read-me stops saying "a copy to try".
- First run: a Mac app that isn't in Applications offers to move itself there; a Windows app run
  from inside a zip says so and stops.
- Errors a pilot can act on: each notice that today quotes FFmpeg, the network or the disk says
  what happened and what to try, and keeps the quote for the report.
- Send a report: one press makes one file with What went wrong.txt, the version, the computer, the
  recording's facts and the self-test's result, ready to drop into Discord.

### v0.34.0: The words and the tidying

- How it works with a picture at each step, and the welcome note cut to what a new pilot needs on
  day one. Writer and Designer, once they exist.
- The read-me rewritten for v1.0: what it does, in the order a pilot meets it.
- One Google Drive card, not two: the library in Drive stays; Keep a copy in another folder
  becomes a plain backup to any folder, or goes.
- Give it its own folder and Premiere marker exports retired, with a last version that moves what
  they covered.
- Making a 9:16 video no slower than a 16:9.

### v1.0.0

Nothing new. The release check on the real recordings on both computers, a candidate build tried
by pilots for a fortnight through the CEO, the changelog entry that says what v1.0 means, and the
read-me's first line without "Right now it is set up for the RaceGOW whoop series."

## After v1.0

Find the gate crossings for me. Two runs side by side (a ghost). A second timer layout. A square
video for Instagram's feed. Heats and rounds for a club's race day with results for the whole
club. Each is worth doing and none makes the app finished.

## Decisions for the CEO

1. **Is this the definition of v1.0?** Everything else follows from it.
2. **Signing costs money and an account in someone's name.** Apple's Developer Program is about
   US$99 a year. Windows signing is about US$10 a month through Microsoft's Trusted Signing, or a
   certificate from a certificate authority at a few hundred dollars a year; either way Windows
   warns less as the signed app earns a reputation, not at once. Whose name, and which route.
3. **Intel Macs: in or out.** In costs an Intel package in every release and keeps the old files
   alive; out leaves those pilots on v0.12.1 for good and lets the app shed the first Mac app's
   files.
4. **Asking pilots for recordings.** v0.31 needs real files from DJI, Walksnail, analog and GoPro
   pilots. Asking is public, so it is the CEO's to do, on Discord.
5. **Other series' files in this repository.** Carrying another series' addresses here is a kind
   of endorsement. Yes, no, or only RaceGOW's.
6. **Find the gate crossings for me.** I put it after v1.0. If the CEO wants it in, it is a
   version of its own before v0.33, and large.
