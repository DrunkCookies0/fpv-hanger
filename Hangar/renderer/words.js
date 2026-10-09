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
    detail: "The same clipping, lap timer and music for any FPV footage, without a race series or an entry form. For now, the Video Creator under RaceGOW takes any recording: make an event for it.",
  },
  upload: {
    title: "Upload to YouTube, TikTok and Instagram", icon: "upload",
    detail: "Send a finished video straight to your channels from here, with the YouTube link filled into the submission form for you. For now, upload it yourself and paste the link.",
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
    title: "Upload", icon: "upload", soon: comingSoon.upload,
    summary: "Send a finished video to YouTube, TikTok and Instagram from here.",
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
        ["step", `On the first screen, open Video Creator, under RaceGOW. If you fly ${season} its open tracks are there already. Otherwise press New event, then New track. Press Add clips and choose your recordings, or drop them onto the track's page.`],
        ["step", "Press Mark laps on a clip. A recording you add by itself opens there straight away. Step to the frame where you cross the start/finish gate and press M. Do that for every crossing, then press Done, which saves it."],
        ["step", "Press Make 16:9 video for YouTube, or Make 9:16 video for Shorts, TikTok and Reels. Markers & music lets you add a song, put one of its drops on the start gate, and choose where the video starts and ends."],
        ["step", `Upload your video to YouTube and press Submit this run. The app fills the track's entry form in, and you press Submit on the form yourself. A ${season} track has its form already. For any other, paste its Google Form link on the track page first.`],
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
      title: "Coming soon", soon: true,
      items: [["paragraph", 'These are marked "Coming soon" in the app and do nothing yet:'], ...Object.values(comingSoon).map((one) => ["point", one.title])],
    },
    {
      title: "Good to know",
      items: [
        ["point", "Flying another race or series, or just out flying? Press New event in the Video Creator. Each event has its own tracks, its own name on the timer and its own ID, and no event needs an entry form."],
        ["point", "Lap times are as exact as your markers: one video frame, which is about 0.017 seconds at 60 frames a second."],
        ["point", "It has been used most with HDZero recordings (.ts). An .mp4 recording has been tested once. Other formats have not been tried."],
        ["point", `If you fly ${season}, its tracks appear by themselves: each one on the day it opens, with its deadline and, once the series posts it, its entry form. Every track has a form of its own.`],
        ["point", `The app goes online for these things only: to read your Google Form, to check for a newer version, to read what the series publishes if you say you fly ${season} (its pilot list, its schedule, its entry forms and its leaderboards), and to watch a track's video on YouTube when you ask it to read the track out of it.`],
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
    ["Set up the track",
      "On the first screen, open Video Creator, under RaceGOW. Its tracks are listed down the side, grouped by event. Press New track under an event, or New event for another race or series. Press Add clips on the track's page and choose your recordings, or drop them onto the page. Then paste the track's Google Form link into Submission form on the track page."],
    ["Mark the laps",
      `Press Mark laps on a clip. A recording you add by itself opens there straight away. Play or drag to just before a start/finish gate crossing, step to the exact frame with the arrow keys, and press M. The first marker starts lap 1; each later one ends a lap. The lap timer shows over the picture as the 16:9 video will have it, and changes with every marker; the timer button beside the playback speed hides it. To fix one, go to it with the up and down arrows and move it a frame at a time with ${keys("cmd", "left")} and ${keys("cmd", "right")}. Right-click a marker, in the list or on the timeline, to delete it or all of them. The marker keys are Premiere's: M, ${keys("shift", "M")} and ${keys("shift", "cmd", "M")} for the next and previous, ${keys("alt", "M")} to clear one and ${keys("alt", "cmd", "M")} to clear all${mac ? ", and they are in the Markers menu too" : ""}. Press Done, which saves it, and the run appears on the track page, ranked by its best 3 laps in a row. Discard changes leaves without keeping them, and ${keys("cmd", "S")} saves while you carry on.`],
    ["Choose what the video shows",
      "A finished video runs from 3 seconds before lap 1 to 8 seconds after the finish. To change that, open Markers & music on the run and drag the ends of the Video bar, or press I and O on the frames where it should start and end."],
    ["Add music, if you want it",
      "In Markers & music, pick one of your songs or add one. A song you add is kept in your song library, for every clip on every track, and the marks you put in it stay with it. The app listens to it and lists its drops, the moments it suddenly gets bigger: press On the start gate beside one and the song slides so the drop lands as you cross the gate, then press Space to hear it with the picture. The song lies under the laps with its loudness in yellow and its bass in red, and you can drag it yourself: a drop, or a point you marked with B, catches on a lap marker. The drops the app found are blue and your own marks are pink. Double-click the song to open its sound wave, where it is big enough to mark by eye, plays by itself, and any moment can be put on the start gate. Drag the white ends of the song, or use Music in and Music out, to choose where the music starts and stops."],
    ["Make the videos",
      "Make 16:9 video is for YouTube. Make 9:16 video is for Shorts, TikTok and Reels. Both carry the timer, your name and ID, the event and track, and the music. The 9:16 timer is built around your best 3 laps in a row: one big time for the three together, those laps under it, and the others smaller. It keeps clear of the buttons those apps put over a video. An event's logo, chosen in Pilot & settings, goes on its videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16. A short clip or a picture can go before and after every video of an event too, such as a title card or a sign-off: choose them under the event in Pilot & settings, one pair for 16:9 videos and one for 9:16. When a video is made the app asks whether to watch it."],
    ["Check them",
      `Click a run to see its files and open any of them. If there are two versions of something, press Keep only this one on the right one and the other goes to ${bin}. A clip you haven't marked has a ${Bin} button of its own on the track page.`],
    ["Submit",
      "Upload the 16:9 video to YouTube, then press Submit this run. Paste the link, type your email the first time, since the form asks for one, and look over the answers: the app fills in your handle, number and time, and for the questions it can't know it shows what you answered last time, one line each, with Change beside it. Press Fill in the form, check the Google Form, and press Submit at the bottom of it yourself. The track page then shows what you sent."],
  ],
  notes: [
    "Lap times are only as exact as the markers: one frame, which is about 0.017 seconds at 60 frames a second. A run shows a warning when its markers aren't on exact frames.",
    `A song's tempo and drops are worked out from the song file itself, on your ${computer}, the first time you pick it. The tempo can read as double or half what you would call it. A song whose beat wanders, as a band playing without a click does, gets no beat lines, though its drops are still found. A drop is a guess at what will hit hardest: listen before you trust it.`,
    "Markers exported from Premiere work too. Export a sequence's markers as CSV into the track's csv markers folder, named after the clip. Place those markers while the clip still starts at the very beginning of its sequence.",
    `Saving markers here for a run that had a Premiere export moves that export to ${bin}, so the run isn't timed twice.`,
    "Add clips copies your recordings into the track's Raw files folder and leaves the originals where they were. Putting files in that folder yourself works too.",
    "Everything lives in the track's folder: Raw files, csv markers and music go in; landscape and vertical are what gets made. The tracks sit in your library folder, which Pilot & settings shows and can change.",
    "New versions are picked up from Pilot & settings, where Check for updates downloads and installs one in place.",
  ],
};
