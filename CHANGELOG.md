# Changelog

Versions are `0.MINOR.PATCH` while the app is young. The middle number goes up when something is added or the way you use the app changes. The last number goes up for fixes only. The number lives in the `VERSION` file.

## v0.8.0 (7 October 2026)

- Deleting is harder to do by accident. An empty track goes to the Trash straight away. A track with anything in it asks you to type **I UNDERSTAND** first. An event can only be deleted once its tracks are.
- Right-click a marker, in the laps list or on the timeline, to delete it or to delete all markers.
- Premiere's marker keys work in the editor: M adds a marker, ⇧M and ⇧⌘M go to the next and the previous, ⌥M clears the one you are on, and ⌥⌘M clears them all. They are in a new Markers menu too.

## v0.7.0 (7 October 2026)

- **Add clips** on a track's page copies your recordings into the track. Choose them, or drop them onto the page. The originals stay where they are.
- Tracks and events can be moved to the Trash from the app: the bin button on a track's page, the bin beside an event in Pilot & settings, or a right-click in the sidebar. It asks first and says what is inside. If you put one back from the Trash, what the app remembered about it comes back too.
- Submitting has its own step for the YouTube link. The form can't be sent until the video is online, so the link gets a box at the top with a Paste button, a check that it is a YouTube link, and a shortcut to YouTube's upload page. The link is kept as you type it.
- Fixed: multiple-choice questions that mention a lap time were mistaken for the lap time itself, which left them unanswered on the form.
- A new event can't take the name of one you already have.

## v0.6.0 (7 October 2026)

- Tracks are now grouped into **events**. An event is a race or a series, with its own tracks, its own name on the timer and its own ID number. **New event** in the sidebar makes one.
- Pilot & settings has an Events section, where each event's name on the timer and your ID for it are set.
- Tracks you already had show under their event as before. In Pilot & settings, **Give it its own folder** moves them into a folder like any other event's. That part is up to you.

## v0.5.0 (7 October 2026)

- Pilot & settings shows a preview of the timer in the corner you pick, with your name, ID and event on it, over a frame of your own footage when there is one. Click a corner of the preview to move the timer there.

## v0.4.0 (7 October 2026)

- A welcome note opens the first time you run the app, with how to get started.
- After an update, a **What's new** note opens with what changed.
- Both notes stay under How it works, where you can open them again.

## v0.3.1 (7 October 2026)

- New versions now come from the repository's Releases page. A copy of v0.3.0 can't see them and has to be downloaded once more.

## v0.3.0 (7 October 2026)

The first version packaged to share.

- The app is self-contained: the lap timer is inside it, and it runs from the Applications folder.
- Your tracks live in a library folder, "FPV Hangar" in Movies to start with. Pilot & settings shows it and can change it.
- Check for updates in Pilot & settings downloads a newer version and installs it in place. The app also looks when it opens.
- Features that are planned but not built are marked "Coming soon": uploading to YouTube, TikTok and Instagram, season leaderboards, and events other than RaceGOW.
- The version number shows in the sidebar and in Pilot & settings.
- Built for both Apple silicon and Intel Macs.
- A new track gets its `overlays` folder when the first video is made, so finished videos land in the right place.

## v0.2.0 (7 October 2026)

- Mark laps inside the app: step through a clip frame by frame and press M on each gate crossing. Premiere is no longer needed.
- Markers & music: move markers, choose the stretch a finished video shows, and place a song against the laps on a timeline.
- Renamed from RaceGOW Dashboard to FPV Hangar, with a new icon.

## v0.1.0 (7 October 2026)

- RaceGOW Dashboard: ranks a track's runs by best three laps in a row from Premiere marker exports.
- Makes timer overlays for Premiere and finished 16:9 and 9:16 videos.
- Fills in a track's Google Form for you to submit.
