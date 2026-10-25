# Changelog

Versions are `0.MINOR.PATCH` while the app is young. The middle number goes up when something is added or the way you use the app changes. The last number goes up for fixes only. The number lives in the `VERSION` file.

## v0.25.0 (25 October 2026)

- **Find music**, in Markers & music: songs for the run that is open, from your song library, your Spotify, NCS and SoundScout, ranked for its laps. The app works out the tempos your gates land on the beat at (a lap that lasts a whole number of bars crosses every gate on a bar line) and says them at the top, and puts first the songs that last the whole video with a drop on the start gate and whose beat your gates land on, then those nearest what you listen to. Each song says why: "4 of 4 gates land on a bar line at 120 BPM", "A lap lasts 8 bars", "By an artist you listen to", "In your Liked Songs".
- Every song says what it may be used for: **Free to use** (NCS, with its credit), **With SoundScout** (Copyright Safe, cleared with a SoundScout plan), **Not cleared for videos** (on SoundScout, but not Copyright Safe), **Copyrighted** (anything else from Spotify: expect the video to be claimed, muted or blocked), or **Licence unknown** for a song added from anywhere else. **Only cleared for videos** leaves only the ones you may use.
- **Use it** makes one of your songs the run's song, with the drop that lasts the video best on the start gate.
- NCS's whole catalog is listed, read from its site once a week. **Add to my songs** gets an NCS song into your song library, as NCS's own download does, with the credit NCS asks for. The credit goes into the description of every video that uses the song, in place of "Music: …". NCS's list doesn't give a song's tempo or length: the app hears them once the song is added.
- SoundScout, which is what Monstercat Gold has become, is listed too: Monstercat's music and other labels', with each song's tempo and length, so they are ranked for the run as your own songs are, and whether it is Copyright Safe. Its catalog is read once a week from the address SoundScout's own player reads it from. A song is downloaded on its page on SoundScout, with a plan, and **Add the file…** brings it in, marked as SoundScout's. Its site can also be opened at the tempos that suit the run.
- **Spotify**, in Pilot & settings: connect it with an app of your own from Spotify for Developers, and Find music has your Liked Songs, and ranks NCS's songs by the artists and the kinds of music you listen to. Spotify only lets an app of your own work for an account with Premium. You sign in on Spotify's own page in your browser, and FPV Hangar only reads your Liked Songs and the artists you play most. The key Spotify gives is kept on this computer, not in your library. Spotify's music can't be saved from Spotify or put in a video, so its songs are named and linked to, not added.
- A race's finished videos show the day it was flown. On a 16:9 video it is in the timer box, at the right of the group's name, with the race's name on the line under them. On a 9:16 video it is in the line above your name, after the group and the race; when that line is too long, the race's name is cut short and the date kept whole. Markers & music and the preview in Pilot & settings show it too. The date is the one the race was given when it was made, or later with Rename or move; a race without one shows none. RaceGOW tracks have no date, since each can be flown any day until its deadline.

## v0.24.4 (24 October 2026)

- A finished video made on Windows straight from a recording has each of its frames once. Videos are made that way from a recording whose frames are stored out of order (B-frames), as some cameras store them, or from one that isn't HEVC or H.264; HDZero recordings are neither, and were right. Wherever the camera had dropped a frame, the video showed the frame before it twice, so it ran a frame longer than the stretch chosen and, from there on, a frame behind its music. After a longer gap it stopped for a moment and then skipped frames. The timer stayed with the picture. Videos made on the Mac were right. Make the video again to get it right.
- Every release is now also tried on a recording with B-frames and dropped frames, on Windows and on a Mac: a video made from it has to have each of its frames once.

## v0.24.3 (24 October 2026)

- A finished video made on Windows from an MP4 recording starts where you set it, and its timer starts as you cross the gate. It could start many seconds away from there, with the timer running over the wrong part of the flight, though Markers & music and Preview showed it right. The copy of the recording that videos are made from had its frames in the wrong places: the FFmpeg the Windows app has reads the times in an MP4 differently from the Mac's. Recordings in a transport stream (.ts), and videos made on the Mac, were right. Make the video again to get it right: the copy is made again by itself.
- On Windows, the lighter copy, and the copy made for a computer that can't play a recording, have every frame where it is in the recording. Where the goggles had dropped a frame, the frames after it came a frame late, so a lap marked there could be a frame out.
- Every release is now tried on an MP4 recording with dropped frames, on Windows and on a Mac, before it is published: each copy has to have every frame where it was, and a video has to start on the frame asked for.

## v0.24.2 (19 October 2026)

- A finished video made on the Mac has all its music. Its music stopped several seconds before the end of the video, though Markers & music and Preview played it to the end: the Mac app's FFmpeg stopped the music as well when it was told how many frames the video has. The video is now cut at its last frame another way. Videos made on Windows had all their music. Make a video again to get all of it.
- A song whose file doesn't say how long it is, as some MP3s don't, is measured by reading it through, as Markers & music already did. Its length was guessed from how the song starts, and could be far too short, so the music stopped where the guess ended.
- A clip can stutter without dropping a frame: every frame is shown, but some stay on the screen too long. Markers & music now notices that as well, and a player that stops to wait for the recording, and offers **Play a lighter copy** for them too.
- **Play a lighter copy** is in the speed menu (the **1×** button) whenever you want it, not only when the app has noticed something, and **Play the full picture** goes back.
- Each clip you play for two seconds or more writes down how it played, evenly or not, in What went wrong.txt: frames dropped or up too long, how often the window was drawn, how long the editor took to draw, the screen's refresh rate and what the graphics can do. **Show what went wrong**, in Pilot & settings, shows that file, to send.

## v0.24.1 (14 October 2026)

- Marking laps on a computer that plays recordings unevenly. When a clip you play in Markers & music drops frames, the app says so above it, with **Play a lighter copy**: a smaller copy of the clip, at most 1280×720, made to play smoothly, with every frame where it is in the recording, so the laps are marked just as exactly. That computer keeps to lighter copies for every clip from then on, and **Full picture** goes back. The finished videos are always made from the recording itself.
- When a clip plays unevenly, the app writes down what the computer's graphics can do, in What went wrong.txt. **Show what went wrong**, in Pilot & settings beside Check for updates, shows that file, to send.

## v0.24.0 (13 October 2026)

- The Video Creator tells groups and races apart. Your groups sit down the left as badges: a group's logo when it has one, or its initials in a colour of its own. Choose one, and its races are listed beside it, each with its date and best time, under the group's name and what it is (a series and its tracks, or a group and its races). The + under the groups makes a new group, and New race under its races makes a race. Right-click a group or a race for the rest, as before.
- The Video Creator opens on a page of its own, **Your flying**: how many groups, races and runs you have, your views on YouTube, the season's next track, what is waiting on you (clips to mark, and RaceGOW entries still to send while they are open), and your latest races. The house at the top of the left side comes back to it.
- Pilot & settings and How it works are at the foot of the left side; a dot on the gear says an update is ready.
- On a small window, a race's buttons go under its name rather than squeezing it.

## v0.23.0 (13 October 2026)

- Each run shows how many views its YouTube and YouTube Shorts videos have: **on YouTube · 1,234 views** under its laps, and the likes and comments too under **Uploaded** in its files.
- It needs a YouTube key of your own, which is free: **Views on YouTube** in Pilot & settings has the three steps for making one in Google Cloud, and buttons that open the pages. Paste the key and press **Use this key**; YouTube is asked first whether it works. The key only reads what anyone can see on YouTube, and nothing is signed in to.
- The counts are read when you open a race's page, at most every ten minutes, and again whenever you press **Refresh**. Without a key, a run with a YouTube link says where to add one.

## v0.22.0 (13 October 2026)

- A run keeps a log of where its videos went up. Under **Uploaded**, at the bottom of a run's files, each site the run is on has its link, with when it was kept, and **Open**, **Copy link**, change and take off. The run itself says **on YouTube**, **on TikTok** and so on under its laps; click one to open the video.
- Links get there by themselves when you upload from FPV Hangar: YouTube's and YouTube Shorts' when you copy the link on YouTube and come back, and TikTok's and Instagram's when you paste the link into the new **Its link** box beside their page, once the video is posted. A YouTube link put into Submit this run counts too, and so does one caught by v0.21.0.
- **Add a link…** keeps the link to a video you uploaded some other way, or before this version: choose the site and paste it. A link that is on the clipboard is put in for you.

## v0.21.0 (13 October 2026)

- Uploading to YouTube and YouTube Shorts happens in your own browser now. Google doesn't let anyone sign in inside an app ("This browser or app may not be secure"), so YouTube's upload page opens in your browser, and FPV Hangar shows the steps beside the words it wrote for you: press **Open YouTube**, drag your video onto YouTube's page from the column on the left (or press **Show in Finder**, or Explorer, and drag it from there), paste the title and the description, and press Publish. The video still goes up named for what it is.
- The link comes back by itself. Press the copy button beside the video's link on YouTube and come back to FPV Hangar: the link is put in and kept with the run, so **Submit this run** has it. It can be pasted or typed in too. Only a link copied by itself is taken, never one inside a description.
- TikTok and Instagram stay in the app. Google turns away TikTok's **Continue with Google** in the same way, so log in to TikTok with your email, phone or username. If Google turns you away, the column says so, above **Use my browser instead**.

## v0.20.1 (13 October 2026)

- Updating on Windows no longer opens black windows saying `find /i ".exe"` while FPV Hangar closes and the new version is put in its place. The update's helper now runs out of sight. The update to this version still shows them, because it is the version you had that does the updating; the ones after it won't.
- Every release from now on is tried out on Windows as well as on a Mac before it is published: the Windows download is unzipped on a Windows computer and runs its full self-test, updating itself included.

## v0.20.0 (13 October 2026)

- **Preview** in Markers & music plays the finished video as it will be: from where the video starts to where it ends, wherever the playhead was, and it stops on the video's last frame. The music is the part of the song the video has, eased in and faded out at the end as it is in the video. It is beside the playback speed, and under Finished video, and P does the same. Press it again, or Space, to stop.
- Play still plays the whole clip from the playhead, for marking laps.

## v0.19.0 (13 October 2026)

- Upload to YouTube, YouTube Shorts, TikTok and Instagram from the app. In a run's files, each finished video has an **Upload** button, and the menu of the run's video button has the same: the 16:9 video goes to YouTube, the 9:16 video to YouTube Shorts, TikTok or Instagram. The **Upload** tile on the first screen takes any video.
- It is each site's own upload page, shown in the app, so there is nothing to set up and no account of FPV Hangar's: sign in on the site's page the first time, and it remembers you. The video goes into the page by itself as soon as the page asks for one, or drag it onto the page from the column on the left. You press the site's own Publish, Post or Share.
- The words are written for you, for each site, from the run: the race and its group, the day, your best laps in a row, your best lap and every lap, your name and number, the song, and hashtags that suit the site. YouTube and YouTube Shorts get a title and a description, each with a Copy button, and the title is on the clipboard as the page opens. TikTok and Instagram get a caption of their own, on the clipboard. Change any of it in the column before you copy it.
- The video goes up named for what it is, such as "RaceGOW6 Track 1 - 28.316 best 3 laps - your name", rather than clip_0001-1, so YouTube's title and TikTok's caption start out right. Your files keep their names.
- **On every one**: lines of your own, such as your gear or your channels, that go on the end of every description and caption, on every site. They are kept for next time.
- On YouTube, the video's link shows on the left as soon as the video starts going up, and is kept with the run: **Submit this run** has it filled in already. In Submit this run, **Upload to YouTube** does the upload from there and comes back with the link in.
- Leaving a page while a video is still going up would stop it, so the app asks first, and closing the window does the same.
- If a site won't let you sign in inside the app, **Use my browser instead** opens its upload page in your own browser, with the video shown in its folder and the caption on the clipboard.

## v0.18.0 (13 October 2026)

- Groups and races. What were events are groups now: a race series or a club you fly with, such as Circle City FPV. **New group** asks for its name, then for its first race. Each race in a group has a name of its own and the day it was flown: **New race** asks for both, and today is filled in for you. Races are listed in the order they were flown, and a race's page shows its group and its date above its name.
- RaceGOW6 works as it did: its tracks appear by themselves, numbered, with their dates and their entry forms. It is the only group with an entry form.
- **Rename or move** a race with the pencil on its page, or by right-clicking it in the sidebar: change its name or its date, or move it to another group. Its recordings, markers, music and videos go with it, and so does everything the app remembered about it. A race that was made as an event of its own, with a Track 1 inside, can be moved into its group this way and given its own name; the empty group it leaves can then be deleted.
- Long names fit on the timer. On a 16:9 video, a group and a race whose names are too long for one line get a line each in the timer box. On a 9:16 video, the line above your name is made smaller to fit, keeping clear of the apps' buttons.

## v0.17.2 (13 October 2026)

- A track that isn't in RaceGOW6 no longer shows the submission form, the Submitted box or Submit this run: a race or a day's flying of your own has no form to send. A track that already has a form link or an entry sent keeps them.

## v0.17.1 (13 October 2026)

- Recordings go into a library in Google Drive. Adding clips to a track that had just been made could fail with "couldn't be added: ENOENT", because Drive was still taking in the new folders while the recordings were being copied into them. A recording is now copied into a folder of FPV Hangar's own first and moved into your library whole, and if Drive has a folder away for a moment, it tries again by itself. A clip that failed before can just be added again: the ones already in the track are skipped.
- The same goes for the rest of what FPV Hangar puts in your library: finished videos, saved markers, an event's logo, the clip or picture before and after a video, songs added to your song library, and the files that hold what the app remembers.

## v0.17.0 (12 October 2026)

- One library on both your computers. In **Pilot & settings**, under **Google Drive**, press **Keep my library in Google Drive** on the computer that has your tracks. FPV Hangar moves your library into a folder called FPV Hangar Library in your Drive and uses it from there. Then press the same button on your other computer: it finds that library and opens it. From then on your Mac and your PC see the same tracks, recordings, markers, music and videos.
- Google's own **Drive for desktop** carries it, on both computers: it uploads what you do on one and brings it down on the other, whether or not FPV Hangar is open. What the other computer did shows when you come back to FPV Hangar's window, or press **Refresh**. A free Google account holds 15 GB, and recordings are most of a library's size.
- Both computers can save at once. When each has changed something different, both changes are kept: a song placed on one and an email typed on the other, say. Only if both change the same thing before Drive has passed it across is the one saved last kept.
- A recording made on the other computer comes down from Drive the first time you open it, which takes as long as downloading it.
- If Drive isn't open or isn't signed in, the Video Creator says so instead of showing an empty library, and nothing is made in its place. It looks again when you come back to the window.
- This takes over from the copy kept in Google Drive in v0.16.0, which only ever went one way. Moving your library stops that copy. Its folder in your Drive, called FPV Hangar, isn't needed once your library is in FPV Hangar Library, and can be deleted to free the space. **Keep a copy in another folder…** still keeps a second copy anywhere else, another disk say.

## v0.16.0 (12 October 2026)

- A second copy of your library in Google Drive. In **Pilot & settings**, under **Google Drive**, press **Keep a copy in Google Drive**. From then on every recording you add and every video you make is copied into a folder called FPV Hangar in your Drive, with its markers and music, laid out as your library is: the event, then the track, then Raw files, landscape, vertical and the rest. It happens by itself after you add recordings, make a video or save markers, and **Copy now** does it when you ask.
- It needs Google's own **Drive for desktop** on your computer, signed in. That program does the uploading, whether or not FPV Hangar is open, so FPV Hangar never signs in to Google and never sees a password. If Drive isn't on the computer the card says so and links to Google's page for it. **Use another folder…** keeps the copy anywhere else instead: another service's folder, or another disk.
- The copy only grows. A file that is new or has changed is copied; one you delete from your library stays in the copy until you delete it there. Recordings are most of a library's size, and a free Google account holds 15 GB, so **Copy the recordings too** can be unticked to leave them out.
- A track's page says how the copy is doing beside its buttons: copying, all copied, or not copied and why, such as Drive not being open.
- Recordings straight from the card. With the card from your goggles or a camera plugged in, a track's page says so, and **Add from the card…** lists the recordings on it, the newest first. The ones you haven't got from your last day of flying are ticked already; one that is in your library already says which track it is in. **Add clips…** offers the card as well as choosing files. The card is only read, never changed.

## v0.15.0 (12 October 2026)

- Betaflight, in the Hangar. Under **Firmware & setup** on the first screen, **Betaflight** opens Betaflight's own app inside FPV Hangar: plug a flight controller in to set it up, tune it and flash it. It comes from Betaflight's own site, so it is always their newest release, and it works without a connection once it has been opened.
- The ExpressLRS Web Flasher, in the Hangar. ExpressLRS's own flasher, the same way: update a transmitter module, a receiver or a backpack over USB or through the flight controller.
- The ExpressLRS Configurator, kept up to date for you. Its tile says which version is on your computer and tells you when ExpressLRS brings out a newer one. **Update** fetches it from ExpressLRS's own Releases page and checks it against the checksum published there. On a Mac it then swaps it in, and the copy you had goes to the Trash. On Windows it starts ExpressLRS's own installer. **Open** starts the Configurator, which stays a program with a window of its own.
- Choosing a device. When one of these tools asks which serial port, USB device or Bluetooth device to use, FPV Hangar shows you the list, and anything you plug in while it is up joins it. On a Mac, the first time one of them looks for devices, macOS asks whether FPV Hangar may use Bluetooth.
- These three tools are Betaflight's and ExpressLRS's, not FPV Hangar's. A link out of one of them, to its documentation or its community, opens in your own browser.

## v0.14.0 (12 October 2026)

- RaceGOW6 Track 2 has its lap. Open **Track in 3D** on Track 2 and it is flown as the series' video flies it: through the start gate and round the back, back through the bottom of the cube, up and sideways through the top, round the pole and in through the roof, sideways through the bottom, up and back through the top, then round and over the start gate into the next lap.
- A lap that passes over itself can be drawn. Through a stack of gates the lap crosses one spot on the floor at several heights, and on the plan from above those points lay on top of each other, where they couldn't be told apart or added to. **Height on the plan** now shows one height at a time: pick 0–1, 1–2 and so on, and only the points that high can be picked and moved, and a click adds one at that height. Picking out a point in the 3D picture brings the plan to its height.
- More ways round a crowded plan. Hold Option (Alt on Windows) and click to put a point right on top of another. Click twice on a pile of points to go from one to the next. Scroll over the plan to zoom in on a tight corner, and **Reset view** brings it back.

## v0.13.1 (9 October 2026)

- Reading a track from its video finds its own way round the video. It works out where the parts lists fade and the build starts, and where anything is laid over the picture afterwards, and looks at the track in between. On RaceGOW6 Track 1 it now finds all 14 sections without being told how many there are. A video that shows a track straight on, as Track 2's does, hides the sections that run away from the camera, and it finds only some of them there: check what it finds against the picture it shows you, and put the rest in by hand.
- RaceGOW6 Track 2 has its parts list and its start gate, from the series' video. Its pipes were right already: they add up to the video's parts lists, part by part.

## v0.13.0 (9 October 2026)

- FPV Hangar for Windows. The app now runs on Windows 10 and 11 as well as on a Mac, and it is the same app on both: the same screens, the same videos, the same library folder. On Windows it comes as a folder you unzip and open, and it updates itself from there.
- On a Mac, this version is that same new app. Your copy updates into it by itself, and your tracks, markers, songs and settings are where you left them. It needs a Mac with Apple silicon (an M1 or later) and macOS 13 or newer: an Intel Mac can't open it, and should stay on v0.12.1. The app is bigger than it was, and a 9:16 video takes about twice as long to make.
- Before and after. A short clip or a picture can go before and after every video you make in an event: a title card, a sign-off. 16:9 and 9:16 videos each have their own pair, so each can be made to fit. A clip keeps its own sound. Choose them in Pilot & settings, under the event.
- The timer's colour is yours to choose. In Pilot & settings, under **The timer on your videos**, pick one of nine colours or any other. It colours the lap bars, the labels, your ID, and the fill when your time is set.
- The track in 3D. A track's page has **Track in 3D**: its pipes on their grid, with the lap flown round them at the pace of your own best lap. Drag to look from any side. RaceGOW6 Track 1 comes with its lap, and Track 2 with its pipes.
- Build a track yourself. **Edit** in the 3D view lets you click sections into place and draw the lap on a plan of the track from above. Or press **Read the pipes from the video**: the app watches the build in the track's video and finds the pipes in it. Tell it how many sections the video's parts list adds up to and it finds more of them.
- The season's leaderboards. The Leaderboard page lists every entry on each track as the series' own spreadsheet has it, with yours picked out and how far you are behind the leader. The season's standings will show there once the series fills them in.

## v0.12.1 (8 October 2026)

- 9:16 videos keep clear of the apps' buttons. On a phone, YouTube Shorts, TikTok and Reels fill the screen with your video, which trims a strip off each side, and they put their own buttons over it. Your name, your ID and the logo now sit further in from the sides and below the bar the apps put across the top, so none of it is cut off or covered. The timer box starts further in on the left and stops short of the column of buttons down the right, which is why it sits a little left of centre when you watch the file on your Mac.

## v0.12.0 (8 October 2026)

- An event's logo goes on its 16:9 videos too, across the head of the timer box. The timer over the picture in Markers & music shows it there as well. Choose the logo in Pilot & settings, under the event.

## v0.11.0 (8 October 2026)

- The timer shows on the picture while you mark laps. In Markers & music the lap timer sits over your clip exactly as the 16:9 video will have it, and reads what it will read on the frame you are on. Add, move or remove a marker and it changes at once, so you can check a run before making its video. The timer button beside the playback speed hides it.
- A bigger timer box on 9:16 videos, built around your best 3 laps in a row. One big time for the three together: it waits at zero until the first of them starts, runs through them, and stops on your result. Those three laps sit under it with their own times, and the other laps are under those, smaller. The box sits centred under the picture, nearly as wide as the video, and fills the room down to the part of the screen the apps cover with their captions.
- An event can have a logo. In Pilot & settings, choose a picture for an event, such as the series' own logo, and it goes at the top of that event's 9:16 videos, beside your name.
- A song library. A song you add is kept in one Songs folder, and every clip on every track can use it. The marks you put in a song stay with the song, so they are there the next time you use it. A song that is in a track's own music folder joins the library the first time you open a run that uses it.
- Drops and your own marks are different colours. Drops the app found are blue and marks you made are pink, on the timeline and in the sound wave window.
- **Done** saves. In Markers & music, Done keeps your work and takes you back, with nothing to answer first. **Discard changes** leaves without keeping it, and ⌘S still saves while you carry on. The separate Save button is gone.
- A recording you add by itself opens straight into marking its laps. Add several at once and they wait on the track page.
- Clips you haven't marked can be moved to the Trash from the track page, with the Trash button beside Mark laps.
- When a 16:9 or 9:16 video is made, the app asks whether you want to watch it now.
- Submitting asks for your email in a box of its own the first time, since the entry form needs one, and keeps it for the next track. Fixed: the email box used to fold away after the first letter you typed.

## v0.10.0 (8 October 2026)

- A new first screen. FPV Hangar now opens on a hangar of tools, grouped by what they are for. The tool you know is **Video Creator**, under RaceGOW, and **Hangar** at its top left brings you back. Tools that aren't built yet say Coming soon.
- Set up in two questions. A new copy asks your pilot name and whether you fly RaceGOW6. If you do, it finds your registration number on the series' own pilot list, by your name or your number. **Ask me the setup questions** in Pilot & settings runs it again.
- RaceGOW6's tracks fill themselves in. If you fly the season, each track appears on the day it opens, with its deadline, sponsor and designer from the series' schedule, and its entry form as soon as racegow.com posts it. The next track to open shows in the list with its date. Every track has a form of its own, so there is nothing to paste.
- Submitting starts with a smaller window that checks your answers. The app fills in your handle, registration number, lap time and email. The questions it can't know are listed one line each with the answer that will go in, kept from your last entry. Look them over, press **Change** on any that differ for this track, and a question the form has never asked you before opens up by itself.
- It keeps to the middle of a wide screen. On an ultrawide monitor the app no longer sits on the left with empty space to the right, and the marker editor stays as wide as its picture needs.
- Fixed: a brand-new library showed no event, so there was nowhere to put a first track. The setup questions now make the RaceGOW6 event if you fly it, and the Video Creator offers **New event** when there is none.
- The app listens to your song. Pick one in Markers & music and it works out the tempo and finds the drops, the moments the song suddenly gets bigger. Each drop has an **On the start gate** button: press it and the song slides so the drop lands as you cross the gate. Then press Space to hear it.
- A sound wave window. Double-click the song on the timeline, or press **Sound wave**, to see it big: how loud it is in yellow, its bass in red, the beat as thin lines, and the drops and the gates marked. Play the song by itself with Space, click to move along it, and double-click or press **M** to mark it. Drag a mark to move it. **Put this on the start gate** works on any moment you pick.
- Marks and the playhead in that window catch on the beat, so a mark lands exactly on a drum. Untick **Catch on the beat** to place them freely. Scroll to move along the song, and pinch, or scroll with Option held, to zoom.
- The song on the timeline shows its bass in red too, so a drop is something you can see. Its drops are drawn on it and catch on a lap marker when you drag the song, the way your own marks do.
- Music you set to come in at a point now comes in at once in the finished video, not faded in, so a drop put there lands whole. The video now matches what the editor plays.
- Clicking the song without moving it no longer counts as a change to undo.

## v0.9.0 (7 October 2026)

- The music has ends you can drag, like a clip in Premiere. Drag the white ends of the song on the timeline to choose where the music comes in and where it stops. **Music in** and **Music out** do the same from the playhead.
- Marks in the music: press **B**, or **Mark the music here**, on a point in the song such as a drop. When you drag the song, the mark catches on a lap marker so the two line up exactly. Right-click the music for more.
- The pointer turns into a resize arrow over any end that can be dragged, on the Video bar and on the music.
- The Premiere overlay button is gone. The timer is drawn into every finished video, so there is nothing extra to make.
- The side of the editor scrolls, so the laps list always has room.

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
