// What the app says: the words that differ between a Mac and Windows, and the longer pieces of
// writing (the tools on the first screen, the welcome note, the walk-through).

export const mac = window.hangar?.platform === "darwin";

/** Where deleted things go, and the program that shows folders, as this kind of computer calls them. */
export const bin = mac ? "the Trash" : "the Recycle Bin";
export const Bin = mac ? "Trash" : "Recycle Bin";
export const fileBrowser = mac ? "Finder" : "Explorer";
export const computer = mac ? "Mac" : "PC";
export const moviesFolder = mac ? "Movies" : "Videos";

/** A key combination as this kind of computer writes it: keys("cmd", "S") is ⌘S or Ctrl+S. */
export function keys(...parts) {
  const names = mac
    ? { cmd: "⌘", shift: "⇧", alt: "⌥", delete: "⌫", left: "←", right: "→", up: "↑", down: "↓" }
    : { cmd: "Ctrl", shift: "Shift", alt: "Alt", delete: "Backspace", left: "←", right: "→", up: "↑", down: "↓" };
  // A Mac writes ⇧⌘M, Windows Ctrl+Shift+M.
  const order = mac ? ["alt", "shift", "cmd"] : ["cmd", "alt", "shift"];
  const modifiers = order.filter((one) => parts.includes(one)).map((one) => names[one]);
  const rest = parts.filter((one) => !order.includes(one)).map((one) => names[one] ?? one);
  return mac ? modifiers.join("") + rest.join("") : [...modifiers, ...rest].join("+");
}

export const season = "RaceGOW6";

/** Planned, not built yet. Each is marked "Coming soon" where it will live. */
export const comingSoon = {
  anyFootage: {
    title: "Video Creator for any footage", icon: "filmStack",
    detail: "The same clipping, lap timer and music for any FPV footage, without a race series or an entry form. For now, the Video Creator under RaceGOW takes any recording: make a group for it.",
  },
};

/** One tile on the first screen. */
export const tools = {
  videoCreator: {
    title: "Video Creator", icon: "film", soon: null,
    summary: "For each track in the series: time your laps on the recording, put the timer and music on, make the videos, and fill in the entry form.",
  },
  leaderboards: {
    title: "Leaderboards", icon: "listNumber", soon: null,
    summary: "Every entry on each track as the series has it, with yours picked out, next to your own best times.",
  },
  anyFootage: {
    title: "Video Creator", icon: "filmStack", soon: comingSoon.anyFootage,
    summary: "Clip a flight, time its laps and add music, without a race series or an entry form.",
  },
  upload: {
    title: "Upload", icon: "upload", soon: null,
    summary: "Send any video to YouTube, Shorts, TikTok or Instagram, through each site's own upload page, with the words for it written for you.",
  },
  betaflight: {
    title: "Betaflight", icon: "chip", soon: null,
    summary: "Betaflight's own app, here in the Hangar: plug a flight controller in to set it up, tune it and flash it. It is always their newest release.",
  },
  elrsFlasher: {
    title: "ExpressLRS Web Flasher", icon: "bolt", soon: null,
    summary: "ExpressLRS's own flasher, here in the Hangar: update a transmitter module, a receiver or a backpack over USB or through the flight controller.",
  },
  elrsConfigurator: {
    title: "ExpressLRS Configurator", icon: "antenna", soon: null,
    summary: "The full Configurator, fetched and kept up to date for you: flashing over WiFi, and building firmware yourself. It opens in a window of its own.",
  },
};

/** The first screen lays the tools out by suite: what a set of tools is for. */
export const suites = [
  {
    title: "RaceGOW",
    summary: "The whoop racing series judged from video. One entry for each track: your fastest three laps in a row.",
    tools: ["videoCreator", "leaderboards"],
    links: [["racegow.com", "home"], ["Tracks", "tracks"], ["Submissions", "submissions"], ["Leaderboards", "leaderboards"]].map(([title, page]) => ({ title, address: `https://www.racegow.com/${page}` })),
  },
  {
    title: "Firmware & setup",
    summary: "The flight controller's and the radio link's own tools. They are Betaflight's and ExpressLRS's, not FPV Hangar's: open source projects, each kept current from its own site.",
    tools: ["betaflight", "elrsFlasher", "elrsConfigurator"],
    links: [{ title: "betaflight.com", address: "https://betaflight.com/" }, { title: "expresslrs.org", address: "https://www.expresslrs.org/" }],
  },
  { title: "Any footage", summary: "For flying that isn't part of a series.", tools: ["anyFootage", "upload"], links: [] },
];

/** What a new pilot needs to know, written once. The welcome note shows it the first time the app is opened. */
export const readMeFor = (mac) => ({
  summary: "A hangar of tools for FPV pilots. The first one is the Video Creator: lap times, finished videos with the timer and music on them, and race entry forms, straight from your goggle recordings. Right now it is set up for the RaceGOW whoop series.",
  sections: [
    {
      title: "Getting started",
      items: [
        ["step", `Answer the two questions the app asks first: your pilot name, and whether you fly ${season}. If you do, it finds your registration number on the series' pilot list. Both go on every timer and video and into the entry form, and both can be changed in Pilot & settings.`],
        ["step", `On the first screen, open Video Creator, under RaceGOW. If you fly ${season} its open tracks are there already. Otherwise press New group, name it, then name the race and give its date. Press Add clips and choose your recordings, or drop them onto the race's page.`],
        ["step", "Press Mark laps on a clip. A recording you add by itself opens there straight away. Step to the frame where you cross the start/finish gate and press M. Do that for every crossing, then press Done, which saves it."],
        ["step", "Press Make 16:9 video for YouTube, or Make 9:16 video for Shorts, TikTok and Reels. Markers & music lets you add a song, put one of its drops on the start gate, and choose where the video starts and ends."],
        ["step", "Press Upload beside a finished video and choose where it goes: YouTube for the 16:9 video, and YouTube Shorts, TikTok or Instagram for the 9:16. TikTok's and Instagram's own upload page opens in the app with your video in it. YouTube's opens in your own browser, since Google doesn't let anyone sign in inside an app: drag your video onto it from the app. Either way the title and description, or the caption, are written for that site. Sign in the first time, paste them in, and press the site's own Publish, Post or Share. Paste the video's link back into the app, and the run keeps it: its files list where each video went up. With a YouTube key in Pilot & settings, each run shows its views on YouTube too."],
        ["step", `For a ${season} track, press Submit this run. The YouTube link is already in it if you copied it on YouTube while uploading from the app. The app fills the track's entry form in, and you press Submit on the form yourself.`],
        ["paragraph", "The full walk-through and the editor's keys are in the app under How it works."],
      ],
    },
    { title: "Where your files are", library: true, items: [] },
    {
      title: "Updates",
      items: [
        ["paragraph", `The app looks for a newer version when it opens. When there is one, a yellow update button appears on the first screen. It downloads the new version and swaps it in${mac ? ", and the previous copy goes to the Trash" : ""}.`],
        ...(mac ? [["paragraph", "Keep the app in your Applications folder. From anywhere else it may not be able to replace itself."]] : []),
      ],
    },
    {
      title: "Betaflight and ExpressLRS",
      items: [
        ["paragraph", "Under Firmware & setup on the first screen are three tools that are not FPV Hangar's own. They belong to the Betaflight and ExpressLRS projects, which are open source, and FPV Hangar only brings them to you."],
        ["point", "Betaflight and the ExpressLRS Web Flasher open inside the app, from each project's own site. They are always that project's newest release, and they work without a connection once they have been opened."],
        ["point", "When one of them asks which serial port, USB device or Bluetooth device to use, the app shows you the list to choose from."],
        ["point", `The ExpressLRS Configurator is a program of its own. The app fetches it from ExpressLRS's Releases page, checks it against the checksum published there, opens it, and tells you when a newer one is out.${mac ? " It goes in your Applications folder, and updating it sends the copy you had to the Trash." : " On Windows the app starts ExpressLRS's own installer, and you follow that through."}`],
        ...(mac ? [["point", "The first time one of them looks for devices, macOS asks whether FPV Hangar may use Bluetooth. Say yes if you connect to anything that way. USB works either way."]] : []),
      ],
    },
    {
      title: "Coming soon", soon: true,
      items: [["paragraph", 'These are marked "Coming soon" in the app and do nothing yet:'], ...Object.values(comingSoon).map((one) => ["point", one.title])],
    },
    {
      title: "Good to know",
      items: [
        ["point", "Flying with a club, or another series? In the Video Creator, press + under the groups on the left for a new group, then New race in its column for each race, with its name and date. Each group has its own name on the timer, its own ID and its own logo, which is its badge on the left. Only RaceGOW's tracks have an entry form: no other race needs one."],
        ["point", "Lap times are as exact as your markers: one video frame, which is about 0.017 seconds at 60 frames a second."],
        ["point", "It has been used most with HDZero recordings (.ts). An .mp4 recording has been tested once. Other formats have not been tried."],
        ["point", `If you fly ${season}, its tracks appear by themselves: each one on the day it opens, with its deadline and, once the series posts it, its entry form. Every track has a form of its own.`],
        ["point", `The app goes online for these things only: to read your Google Form, to check for a newer version, to read what the series publishes if you say you fly ${season} (its pilot list, its schedule, its entry forms and its leaderboards), to watch a track's video on YouTube when you ask it to read the track out of it, to open Betaflight's app and the ExpressLRS flasher from their own sites when you open them (what those tools then send is theirs to say), to show TikTok's and Instagram's own upload pages when you upload to them (what you post there, and how, is theirs; YouTube's opens in your own browser), to ask YouTube how many views, likes and comments your runs' videos have, if you give it a YouTube key of your own (only the videos' links go, with the key), to read NCS's list of songs when you open Find music, at most once a week, and to fetch a song from NCS when you add it, to read your Liked Songs and the artists you play most if you connect your Spotify (nothing in it is changed), and to look at ExpressLRS's Releases page for a newer Configurator, once a day if you have it and whenever you open its tile.`],
        ["point", "With two computers, Pilot & settings can keep your library in Google Drive, so both open the same one. It needs Google's own Drive for desktop on each computer: FPV Hangar keeps the library in Drive's folder and Drive uploads it and brings down what the other computer did, so the app itself never signs in to Google or sends your files anywhere."],
        ["point", "Uploading goes through each site's own page, and you sign in on that page, as you would in a browser. FPV Hangar never sees your password and never posts anything: the site's own button does. Each site's sign-in is kept in a corner of the app of its own. Leaving a page while a video is still going up stops it, so the app asks first."],
        ["point", "With the card from your goggles plugged in, a track's page offers the recordings on it. The card is only read."],
        ["point", "It never sends your entry for you. Nothing goes to RaceGOW until you press Submit on the form."],
        ["paragraph", "Something not working? Tell whoever sent you this."],
      ],
    },
  ],
});

/** The read-me for the computer the app is on. */
export const readMe = readMeFor(mac);

/** A short walk through the whole job, from a raw clip to a submitted time. */
export const guide = {
  steps: [
    ["Set up the race",
      `On the first screen, open Video Creator, under RaceGOW. Down the side are your groups, each a series or a club, with their races. ${season}'s tracks appear by themselves, each with its entry form. For anything else, press New group, then New race under it, and give the race its name and date. Press Add clips on the race's page and choose your recordings, or drop them onto the page.`],
    ["Mark the laps",
      `Press Mark laps on a clip. A recording you add by itself opens there straight away. Play or drag to just before a start/finish gate crossing, step to the exact frame with the arrow keys, and press M. The first marker starts lap 1; each later one ends a lap. The lap timer shows over the picture as the 16:9 video will have it, and changes with every marker; the timer button beside the playback speed hides it. To fix one, go to it with the up and down arrows and move it a frame at a time with ${keys("cmd", "left")} and ${keys("cmd", "right")}. Right-click a marker, in the list or on the timeline, to delete it or all of them. The marker keys are Premiere's: M, ${keys("shift", "M")} and ${keys("shift", "cmd", "M")} for the next and previous, ${keys("alt", "M")} to clear one and ${keys("alt", "cmd", "M")} to clear all${mac ? ", and they are in the Markers menu too" : ""}. Press Done, which saves it, and the run appears on the track page, ranked by its best 3 laps in a row. Discard changes leaves without keeping them, and ${keys("cmd", "S")} saves while you carry on.`],
    ["Choose what the video shows",
      "A finished video runs from 3 seconds before lap 1 to 8 seconds after the finish. To change that, open Markers & music on the run and drag the ends of the Video bar, or press I and O on the frames where it should start and end. Press Preview, or P, to watch it as it will be: from its start to its end, with its music, faded out at the end. Play plays the whole clip from wherever the playhead is."],
    ["Add music, if you want it",
      "In Markers & music, pick one of your songs or add one. A song you add is kept in your song library, for every clip on every track, and the marks you put in it stay with it. The app listens to it and lists its drops, the moments it suddenly gets bigger: press On the start gate beside one and the song slides so the drop lands as you cross the gate, then press Space to hear it with the picture. The song lies under the laps with its loudness in yellow and its bass in red, and you can drag it yourself: a drop, or a point you marked with B, catches on a lap marker. The drops the app found are blue and your own marks are pink. Double-click the song to open its sound wave, where it is big enough to mark by eye, plays by itself, and any moment can be put on the start gate. Drag the white ends of the song, or use Music in and Music out, to choose where the music starts and stops. Not sure what to use? Press Find music: songs from your library, your Spotify and NCS, ranked for the run. It works out the tempos your gates land on the beat at (a lap that lasts a whole number of bars crosses every gate on a bar line) and puts first the songs that last the whole video with a drop on the start gate, and those nearest what you listen to. Each says whether it is free to use, cleared with a SoundScout plan, or copyrighted. Use it puts one of your songs on the run with its drop on the start gate. Add to my songs gets an NCS song with the credit NCS asks for, which goes into your videos' descriptions. SoundScout, Monstercat's, opens in your browser at the tempos that suit the run, and a song you download there is added with Add a song from SoundScout."],
    ["Make the videos",
      "Make 16:9 video is for YouTube. Make 9:16 video is for Shorts, TikTok and Reels. Both carry the timer, your name and ID, the event and track, and the music. The 9:16 timer is built around your best 3 laps in a row: one big time for the three together, those laps under it, and the others smaller. It keeps clear of the buttons those apps put over a video. An event's logo, chosen in Pilot & settings, goes on its videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16. A short clip or a picture can go before and after every video of an event too, such as a title card or a sign-off: choose them under the event in Pilot & settings, one pair for 16:9 videos and one for 9:16. When a video is made the app asks whether to watch it."],
    ["Check them",
      `Click a run to see its files and open any of them. If there are two versions of something, press Keep only this one on the right one and the other goes to ${bin}. A clip you haven't marked has a ${Bin} button of its own on the track page.`],
    ["Upload",
      `Press Upload beside a finished video in a run's files, or choose it from the menu of the run's video button. The 16:9 video goes to YouTube; the 9:16 video to YouTube Shorts, TikTok or Instagram. TikTok's and Instagram's own upload page opens in the app: sign in the first time, and it is remembered. Your video goes in by itself as soon as the page asks for one, named for the race, your time and you, or drag it onto the page from the left. YouTube's opens in your own browser, since Google doesn't let anyone sign in inside an app: drag your video onto it from the app, or from Show in ${fileBrowser}. The words are written for that site from the run: a title and a description for YouTube, a caption for TikTok and Instagram, with the race and its group, the day, your laps, your name, the song and hashtags. The first of them is on the clipboard: paste it, copy the next with its button, change any of it first if you like, and press the site's own Publish, Post or Share. Lines of your own, such as your gear or your channels, go under On every one, and on the end of everything from then on. Copy the video's link on the site once it is up and bring it back (on YouTube it comes in by itself when you come back to the app; on TikTok and Instagram paste it under Its link), and the run keeps it, with its views on YouTube when you have a YouTube key. On TikTok and Instagram, stay on the page until the site says the video is up: leaving stops it, so the app asks first. If one won't let you sign in inside the app, Use my browser instead opens its page in your own browser, with the video shown in its folder.`],
    ["Submit",
      "Press Submit this run, on a track with an entry form. If you uploaded from the app the link is there already; if the video isn't on YouTube yet, press Upload to YouTube in it. Otherwise paste the link, type your email the first time, since the form asks for one, and look over the answers: the app fills in your handle, number and time, and for the questions it can't know it shows what you answered last time, one line each, with Change beside it. Press Fill in the form, check the Google Form, and press Submit at the bottom of it yourself. The track page then shows what you sent."],
  ],
  notes: [
    "Lap times are only as exact as the markers: one frame, which is about 0.017 seconds at 60 frames a second. A run shows a warning when its markers aren't on exact frames.",
    `A song's tempo and drops are worked out from the song file itself, on your ${computer}, the first time you pick it. The tempo can read as double or half what you would call it. A song whose beat wanders, as a band playing without a click does, gets no beat lines, though its drops are still found. A drop is a guess at what will hit hardest: listen before you trust it.`,
    "Find music says what each song may be used for, as its catalog or label has it. NCS's music is free in your own videos with its credit in the description. SoundScout's (Monstercat's, which was Monstercat Gold) is cleared with a SoundScout plan when it is marked Copyright Safe: Personal for your own accounts, Creator for monetised channels. Anything else from Spotify belongs to its label: YouTube's Content ID and the other sites' own checks recognise it, and claim, mute or block the video, however little of the song is used and why. Connect Spotify in Pilot & settings with an app of your own from Spotify for Developers, which needs Spotify Premium.",
    "Markers exported from Premiere work too. Export a sequence's markers as CSV into the track's csv markers folder, named after the clip. Place those markers while the clip still starts at the very beginning of its sequence.",
    `Saving markers here for a run that had a Premiere export moves that export to ${bin}, so the run isn't timed twice.`,
    "Add clips copies your recordings into the track's Raw files folder and leaves the originals where they were. Putting files in that folder yourself works too.",
    "With the card from your goggles plugged in, the track's page says so and Add from the card lists what is on it, the newest first. The recordings you haven't got from your last day of flying are ticked for you. The card itself is never changed.",
    "Pilot & settings can keep your library in Google Drive, so that your Mac and your PC open the same one. It needs Google's own Drive for desktop on each computer, which does the uploading and brings down what the other computer did. Press Keep my library in Google Drive on the computer that has your tracks first: it moves the library there. Then press it on the other, which opens that same library.",
    "Everything lives in the track's folder: Raw files, csv markers and music go in; landscape and vertical are what gets made. The tracks sit in your library folder, which Pilot & settings shows and can change.",
    "New versions are picked up from Pilot & settings, where Check for updates downloads and installs one in place.",
  ],
};
