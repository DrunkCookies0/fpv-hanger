// Everything the app's pages can ask the main process to do, by name. A page has no access to
// files or programs of its own: it asks for one of these and gets an answer back.

import { app, dialog, shell, clipboard, WebContentsView } from "electron";
import { spawn } from "node:child_process";
import { existsSync, statSync, statfsSync, readdirSync, readFileSync, writeFileSync, rmSync, utimesSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eventFolder, trackName, trackNumber, videoExtensions, audioExtensions, pictureExtensions, bookendPictures, removalPhrase, bytes } from "./library.js";
import { analysisOf, soundOf } from "./songs.js";
import { pictureRect } from "./ffmpeg.js";
import { config, setConfig, version, log, logFile } from "./paths.js";
import { shapes, stretch } from "../shared/video.js";
import { FrameRate } from "../shared/timing.js";
import * as series from "../shared/series.js";
import { parseForm, fillScript, isFormAddress } from "../shared/forms.js";
import { readTrack } from "../shared/trackview.js";
import { readBoards } from "../shared/leaderboard.js";
import { stillsOf, pipesIn } from "./trackvideo.js";
import { latest, install, checkIsDue } from "./updates.js";

const here = dirname(fileURLToPath(import.meta.url));
const mac = process.platform === "darwin";
/** Where deleted things go, as this kind of computer calls it. */
export const bin = mac ? "the Trash" : "the Recycle Bin";

/** The tracks that come with the app, drawn in 3D: each a file made from the series' own track video. */
function tracksWithTheApp() {
  const folder = join(here, "..", "assets", "tracks");
  const found = [];
  try {
    for (const name of readdirSync(folder).filter((one) => one.endsWith(".json")).sort()) {
      try {
        const track = readTrack(JSON.parse(readFileSync(join(folder, name), "utf8")));
        if (track) found.push(track);
      } catch (error) {
        log(`Reading the track ${name}: ${error.message}`);
      }
    }
  } catch {}
  return found;
}

/** True when one version number is later than another: "0.10.0" is later than "0.9.2". */
export function isNewer(one, other) {
  const parts = (text) => String(text).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(one), b = parts(other);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/** The changelog's versions, newest first. Each has its lines: points start with "- ", anything
 *  else is a sentence of its own. */
export function changelogIn(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## v")) {
      const [number, ...rest] = line.slice(4).split(" ");
      found.push({ version: number, date: rest.join(" ").replace(/^[( ]+|[) ]+$/g, ""), lines: [] });
    } else if (found.length > 0 && line.trim() !== "") {
      found[found.length - 1].lines.push(line);
    }
  }
  return found;
}

/** VLC, when it is installed. It plays a goggle recording as it is, which not every player does. */
function findVLC() {
  const places = mac
    ? ["/Applications/VLC.app", join(homedir(), "Applications", "VLC.app")]
    : [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((folder) => join(folder, "VideoLAN", "VLC", "vlc.exe"));
  return places.find((place) => existsSync(place)) ?? null;
}

/**
 * @param {object} with_
 * @param {import("./library.js").Library} with_.library
 * @param {import("./ffmpeg.js").FFmpeg} with_.ffmpeg
 * @param {import("./videos.js").VideoMaker} with_.videos
 * @param {string} with_.cache
 * @param {() => import("electron").BrowserWindow | null} with_.window
 * @param {(kind: string, ...details: any[]) => void} with_.tell sends news to the pages
 * @param {boolean} with_.fixed whether this copy was started on a library given to it
 * @param {boolean} with_.quiet true for a copy that shows no window: it opens no welcome note
 */
export function makeApi({ library, ffmpeg, videos, cache, window, tell, fixed = false, quiet = false }) {
  let job = null;
  let pilots = null;
  /** The tracks that come with the app, once they have been read. */
  let givenTracks = null;
  /** The season's leaderboards as last read, and the reading under way if there is one. */
  let boards = null, readingBoards = null;
  const boardsFile = join(cache, "leaderboard.json");
  /** True while a track video is being read. One at a time: it is a window and a lot of work. */
  let readingVideo = false;
  /** Where looking for a newer version has got to: { kind: "idle" | "checking" | "current" |
   *  "available" | "installing" | "failed" }, with the release or the problem. */
  let update = { kind: "idle" };
  // A copy run from its source, or one built to try things in, says so and leaves updates alone.
  const isTestCopy = () => Boolean(process.defaultApp) || /test/i.test(app.getName());
  /** The entry form, while it is open in the window to be checked and sent. */
  let formView = null;
  let greeted = false;
  const vlc = findVLC();
  /** Each track's runs as last timed, so the lists and tiles have their times without timing again. */
  const summaries = new Map();
  let summarising = null, timeAgain = false;

  /** One long piece of work at a time. The pages hear how far along it is. */
  async function working(title, work) {
    if (job) return { problem: "Wait for what is being made to finish first." };
    job = { title, progress: 0 };
    tell("job", job);
    try {
      return await work((fraction) => {
        if (!job) return;
        job.progress = fraction;
        tell("job", job);
      });
    } finally {
      job = null;
      tell("job", null);
    }
  }

  /** Times the tracks one after another, behind what the pilot is doing: those not timed yet, or
   *  with `again` all of them. The pages hear when a time has changed. */
  function summariseAll(again = false) {
    if (again) timeAgain = true;
    summarising ??= (async () => {
      const times = (summary) => JSON.stringify(summary?.runs.map((run) => [run.name, run.best?.seconds ?? null]) ?? null);
      let changed = false;
      do {
        const all = timeAgain;
        timeAgain = false;
        for (const track of [...library.tracks]) {
          if (!all && summaries.has(track)) continue;
          try {
            const summary = await library.summary(track);
            if (times(summary) !== times(summaries.get(track))) changed = true;
            summaries.set(track, summary);
          } catch {}
        }
      } while (timeAgain);
      for (const track of [...summaries.keys()]) if (!library.tracks.includes(track)) summaries.delete(track);
      summarising = null;
      if (changed) tell("changed");
    })();
    return summarising;
  }

  /** The pilot's details and the timer's look for a track's videos. */
  function look(track) {
    const details = library.details(eventFolder(track));
    return {
      accent: library.settings.accent || "#FFD60A",
      title: library.settings.pilot || null,
      badge: details.id ? (details.idLabel ? `${details.idLabel} ${details.id}` : details.id) : null,
      event: details.name || null,
      track: trackName(track),
      position: library.settings.corner || "tr",
      logoFile: library.logo(eventFolder(track)),
    };
  }

  /** A recording's copy for the player and for making videos from: the same pictures in an MP4 with
   *  exact frame times, or a plainer one when that can't be made or the player can't show it. The
   *  three used most recently are kept. */
  async function copyOf(clip, facts, { plain = false, onProgress = null } = {}) {
    const file = statSync(clip);
    const folder = join(cache, "Clip copies");
    mkdirSync(folder, { recursive: true });
    const stamp = `${basename(clip, extname(clip))}-${file.size}-${Math.round(file.mtimeMs)}`;
    const canWrap = !facts.reorders && ["hevc", "h264"].includes(facts.codec);
    const kind = plain || !canWrap ? "plain" : "wrapped";
    const to = join(folder, `${stamp}-${kind}.mp4`);
    if (!existsSync(to)) {
      // The copy is about as big as the clip.
      try {
        const disk = statfsSync(folder);
        if (Number(disk.bavail) * Number(disk.bsize) < file.size * 1.2) return { problem: `There isn't enough free disk space to open this clip. It needs about ${bytes(file.size)}.` };
      } catch {}
      const made = kind === "wrapped" ? await ffmpeg.rewrap(clip, to, facts) : await ffmpeg.plainCopy(clip, to, facts, onProgress);
      if (!made.ok) return { problem: made.problem };
    }
    const now = new Date();
    utimesSync(to, now, now);
    // Each is as big as its clip. Older ones go, and are made again in a moment if wanted.
    const kept = readdirSync(folder).filter((name) => name.endsWith(".mp4")).map((name) => ({ name, used: statSync(join(folder, name)).mtimeMs })).sort((a, b) => b.used - a.used);
    for (const old of kept.slice(3)) rmSync(join(folder, old.name), { force: true });
    return { file: to, kind, problem: null };
  }

  const fileFacts = (path, kind, more = {}) => {
    const facts = statSync(path);
    return { path, name: basename(path), kind, size: bytes(facts.size), modified: facts.mtimeMs, ...more };
  };

  /** What some tracks hold, in a sentence, for the question before they go. */
  function holdingsOf(tracks) {
    const held = library.holdings(tracks);
    const some = (number, one, many) => (number === 0 ? null : `${number} ${number === 1 ? one : many}`);
    const parts = [some(held.clips, "clip", "clips"), some(held.runs, "marked run", "marked runs"), some(held.videos, "finished video", "finished videos")].filter(Boolean);
    if (parts.length === 0) return held.bytes > 0 ? `It has ${bytes(held.bytes)} of files in it.` : "It has files in it.";
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return `${tracks.length === 1 ? "It holds" : "They hold"} ${list}, ${bytes(held.bytes)} in all.`;
  }

  const busy = () => (job ? { problem: "Wait for what is being made to finish first." } : null);

  const api = {
    /** What every page needs to draw itself. */
    state() {
      const seasonEvent = library.seasonEvent;
      // The fastest run on the first track that has one lends the timer preview its laps and a frame.
      let preview = null;
      for (const track of library.tracks) {
        const run = summaries.get(track)?.runs[0];
        if (!run) continue;
        const crossings = run.crossings.slice(0, 9);
        preview = { track, run: run.name, clip: run.clip, crossings: crossings.map((crossing) => crossing - crossings[0]), moment: crossings.length > 1 ? (crossings[0] + crossings[1]) / 2 : 1 };
        break;
      }
      return {
        preview,
        version: version(),
        platform: process.platform,
        testCopy: isTestCopy(),
        library: library.root,
        libraryIsFixed: fixed,
        settings: library.settings,
        email: library.store.email ?? "",
        answers: library.store.answers ?? {},
        season: series.season,
        idLabel: series.idLabel,
        lastTrack: config().lastTrack ?? null,
        vlc: vlc !== null,
        /** True for a copy that shows no window. Such a copy makes no sound. */
        quiet,
        snapToBeat: config().snapToBeat !== false,
        showsTimer: config().showsTimer !== false,
        update,
        automaticUpdates: config().noAutomaticUpdates !== true,
        job,
        events: library.events.map((event) => {
          const next = library.nextSeasonTrack(event.folder);
          const logo = library.logo(event.folder);
          return {
            folder: event.folder,
            ...library.details(event.folder),
            isSeason: event.folder === seasonEvent,
            hasSeason: event.folder === seasonEvent && library.season(event.folder).length > 0,
            next: next ? { number: next.number, release: next.release, deadline: next.deadline } : null,
            logo: logo ? `${pathToFileURL(logo).href}?${Math.round(statSync(logo).mtimeMs)}` : null,
            bookends: Object.fromEntries(Object.entries(library.bookends(event.folder)).map(([shape, pair]) => [shape, Object.fromEntries(Object.entries(pair).map(([which, end]) => [which, end && { name: end.name, kind: end.kind, seconds: end.seconds, picture: end.kind === "picture" ? `${pathToFileURL(end.file).href}?${Math.round(statSync(end.file).mtimeMs)}` : null }]))])),
            tracks: event.tracks.map((path) => {
              const summary = summaries.get(path);
              const kept = library.state(path);
              const season = library.seasonTrack(path);
              return {
                path, name: trackName(path),
                best: summary?.best?.best?.seconds ?? null,
                submissions: kept.submissions.length,
                submitted: kept.submissions.at(-1) ?? null,
                deadline: season?.deadline ?? null,
              };
            }),
          };
        }),
      };
    },

    /** Looks at the library again, and reads the season again when that is due. */
    async refresh() {
      library.refresh();
      summariseAll(true);
      library.readSeasonIfDue().then((made) => {
        if (made.length > 0) {
          summariseAll();
          tell("changed");
        }
      });
      return api.state();
    },

    remember(patch) {
      setConfig(patch);
    },

    /** Comes back once every track has been timed, with the library as it then is. */
    async whenTimed() {
      await summariseAll();
      return api.state();
    },

    /** What to open with: the welcome note on the very first run, or what is new the first time a
     *  newer version is run. Asked once, when the window first shows. */
    greet() {
      // A copy that is only drawing a page or checking itself greets nobody.
      if (greeted || quiet) return {};
      greeted = true;
      const kept = config();
      const last = kept.lastVersion ?? null, current = version();
      let answer = {};
      if (last === null && kept.welcomed !== true) {
        answer = { note: { kind: "welcome" } };
      } else if (last !== null && isNewer(current, last)) {
        answer = api.changelog(last).length === 0 ? { notice: `Updated to FPV Hangar v${current}.` } : { note: { kind: "whatsNew", since: last } };
      }
      setConfig({ welcomed: true, lastVersion: current });
      return answer;
    },

    /** Every version in the changelog that isn't later than this one, newest first. With `since`,
     *  only those after that version. */
    changelog(since = null) {
      const places = [join(process.resourcesPath ?? "", "CHANGELOG.md"), resolve(here, "..", "CHANGELOG.md"), resolve(here, "..", "..", "CHANGELOG.md")];
      const file = places.find((place) => existsSync(place));
      if (!file) return [];
      const current = version();
      return changelogIn(readFileSync(file, "utf8")).filter((entry) => !isNewer(entry.version, current) && (since === null || isNewer(entry.version, since)));
    },

    /** One track's page: its runs fastest first, and its recordings that aren't marked yet. */
    async track(track) {
      if (!library.tracks.includes(track)) return null;
      const summary = await library.summary(track);
      summaries.set(track, summary);
      const timed = new Set(summary.runs.map((run) => run.name.toLowerCase()));
      const state = library.state(track);
      const runs = summary.runs.map((run) => {
        const song = state.edits?.[run.name]?.song ?? null;
        const songFile = song ? library.songFile(song, track) : null;
        return {
          ...run,
          song,
          // Finished videos first, newest on top, then what they were made from.
          files: [
            ...run.landscapes.toReversed().map((path) => fileFacts(path, "16:9 video", { output: "landscape" })),
            ...run.uprights.toReversed().map((path) => fileFacts(path, "9:16 video", { output: "upright" })),
            ...(run.clip ? [fileFacts(run.clip, "Race clip")] : []),
            ...(songFile && existsSync(songFile) ? [fileFacts(songFile, "Music")] : []),
          ],
        };
      });
      return {
        track, name: trackName(track), event: library.details(eventFolder(track)), state,
        season: library.seasonTrack(track),
        summary: { ...summary, runs, best: runs.find((run) => run.best) ?? null },
        unmarked: library.clips(track).filter((clip) => !timed.has(basename(clip, extname(clip)).toLowerCase())).map((clip) => fileFacts(clip, "Race clip")),
        hasClips: library.clips(track).length > 0,
        hasView: api.trackView(track) !== null,
        folder: library.place(track),
      };
    },

    // Setting up.

    async lookUpPilot(query) {
      try {
        pilots ??= await series.readPilots();
        return { found: series.findPilots(query, pilots), problem: null };
      } catch (error) {
        return { found: [], problem: error.message };
      }
    },

    async finishSetUp({ pilot, fliesSeries, number }) {
      library.finishSetUp({ pilot, fliesSeries, number });
      if (fliesSeries) await library.readSeasonIfDue({ force: true });
      summariseAll();
      const name = pilot.trim();
      let notice = null;
      if (name !== "") {
        const id = fliesSeries && library.seasonEvent ? library.details(library.seasonEvent).id : "";
        notice = `You are set up, ${name}${id === "" ? "" : `, ${series.idLabel} ${id}`}. Open Video Creator to start on a track.`;
      }
      return { notice, state: api.state() };
    },

    setSettings(patch) {
      Object.assign(library.settings, patch);
      library.saveSettings();
      return api.state();
    },

    setEmail(email) {
      library.store.email = email;
      library.saveStore();
    },

    setDetails(event, details) {
      library.setDetails(event, details);
      return api.state();
    },

    // The library.

    async chooseLibrary() {
      if (fixed || job) return { state: api.state() };
      const picked = await dialog.showOpenDialog(window(), {
        title: "Use another folder",
        message: "Choose the folder to keep your tracks, markers and videos in.",
        buttonLabel: "Use this folder",
        defaultPath: library.root,
        properties: ["openDirectory", "createDirectory"],
      });
      if (picked.canceled || resolve(picked.filePaths[0]) === resolve(library.root)) return { state: api.state() };
      const folder = picked.filePaths[0];
      setConfig({ library: folder, lastTrack: null });
      library.use(folder);
      summaries.clear();
      await api.refresh();
      return { notice: `Now using ${folder}. Nothing was moved: anything in the old folder is still there.`, state: api.state(), moved: true };
    },

    gatherLooseTracks() {
      if (job) return { notice: "Let the video finish first.", state: api.state(), moved: {} };
      const gathered = library.gatherLooseTracks();
      summaries.clear();
      summariseAll();
      return { notice: gathered.problem, state: api.state(), moved: gathered.moved };
    },

    // Events and tracks.

    newEvent(name) {
      const made = library.newEvent(name);
      return { ...made, state: api.state() };
    },

    newTrack(event) {
      const made = library.newTrack(event);
      return { ...made, state: api.state() };
    },

    /** Deletes a track. An empty one goes straight away. One with anything in it comes back as a
     *  question, and goes once its phrase has been typed. */
    async removeTrack(track, typed = null) {
      if (job) return busy();
      if (!library.tracks.includes(track)) return { state: api.state() };
      const name = trackName(track);
      if (library.holdsAnything(library.place(track))) {
        const question = {
          title: `Move ${name} to ${bin}?`,
          detail: `${holdingsOf([track])} Everything in it goes too, your recordings included. You can put it back from ${bin}.`,
          phrase: removalPhrase,
        };
        if (typed === null || typed.trim().toUpperCase() !== removalPhrase) return { question };
      }
      const removed = await library.removeTrack(track);
      summaries.delete(track);
      return { notice: removed.problem ? `Couldn't move ${removed.problem}` : `Moved ${name} to ${bin}.`, state: api.state() };
    },

    /** Deletes an event, which has to be empty of tracks first. */
    async removeEvent(event, typed = null) {
      if (job) return busy();
      const one = library.events.find((found) => found.folder === event);
      if (!one || event === "") return { state: api.state() };
      const name = library.details(event).name;
      if (one.tracks.length > 0) {
        return { notice: `${name} still has ${one.tracks.length === 1 ? "a track" : `${one.tracks.length} tracks`} in it. Delete ${one.tracks.length === 1 ? "that" : "those"} first, then the event.`, state: api.state() };
      }
      if (library.holdsAnything(join(library.root, event), library.logo(event))) {
        const question = {
          title: `Move ${name} to ${bin}?`,
          detail: `It has no tracks, but there are other files in its folder, and they go too. You can put it back from ${bin}.`,
          phrase: removalPhrase,
        };
        if (typed === null || typed.trim().toUpperCase() !== removalPhrase) return { question };
      }
      const removed = await library.removeEvent(event);
      return { notice: removed.problem ? `Couldn't move ${removed.problem}` : `Moved ${name} to ${bin}.`, state: api.state() };
    },

    // Recordings.

    async chooseClips(track) {
      if (job) return { notice: "Wait for what is being made to finish, then add the clips." };
      const picked = await dialog.showOpenDialog(window(), {
        title: `Add recordings to ${trackName(track)}`,
        message: `Choose the recordings to add to ${trackName(track)}. They are copied in, and the originals stay where they are.`,
        buttonLabel: "Add",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Recordings", extensions: [...videoExtensions] }],
      });
      return picked.canceled ? {} : api.addClips(track, picked.filePaths);
    },

    /** Copies recordings into a track. The originals are left alone. */
    async addClips(track, paths) {
      if (job) return { notice: "Wait for what is being made to finish, then add the clips." };
      if (!library.tracks.includes(track) || paths.length === 0) return {};
      const name = trackName(track);
      return working(paths.length === 1 ? `Adding ${basename(paths[0])} to ${name}` : `Adding ${paths.length} clips to ${name}`, async (progress) => {
        const result = await library.addClips(track, paths, progress);
        if (result.problem) return { notice: result.problem };
        const lines = [];
        if (result.added.length > 0) lines.push(result.added.length === 1 ? `Added ${result.added[0]} to ${name}.` : `Added ${result.added.length} clips to ${name}.`);
        if (result.present.length > 0) lines.push(`${result.present.join(", ")} ${result.present.length === 1 ? "was" : "were"} already there.`);
        lines.push(...result.failed);
        if (result.left > 0) lines.push(`${result.left} other file${result.left === 1 ? " isn't a video and was" : "s aren't videos and were"} left out.`);
        // One recording added by itself goes straight to having its laps marked. Several are left
        // on the page, for the pilot to pick which to mark first.
        const one = result.added.length + result.present.length === 1 && result.failed.length === 0 ? result.added[0] ?? result.present[0] : null;
        return { notice: lines.join("\n"), open: one ? join(result.folder, one) : null };
      });
    },

    /** Gets a recording ready for the marker editor: what it holds, and a copy the player can open. */
    async openClip(clip, { plain = false } = {}) {
      if (!existsSync(clip)) return { problem: `${basename(clip)} isn't there any more. Press Refresh.` };
      const facts = await library.facts(clip);
      if (!facts) return { problem: `${basename(clip)} can't be read as a video.` };
      const copy = await copyOf(clip, facts, { plain, onProgress: (fraction) => tell("copy", fraction) });
      if (copy.problem) return { problem: `${basename(clip)} couldn't be made ready: ${copy.problem}` };
      return {
        problem: null, kind: copy.kind, url: pathToFileURL(copy.file).href,
        facts: { ...facts, fps: { num: facts.fps.num, den: facts.fps.den, value: facts.fps.value, label: facts.fps.label }, claimedFPS: undefined },
      };
    },

    /** What the marker editor starts from for a run: what was decided about its videos, the songs
     *  there are to choose from, and the pilot's marks in each. */
    editorData(track, run) {
      return { edit: library.state(track).edits?.[run] ?? {}, songMarks: library.songMarks, ...library.songs(track, run), window: 3 };
    },

    async saveRun(track, run, what) {
      const saved = await library.saveRun(track, run, { ...what, fps: new FrameRate(what.fps.num, what.fps.den) });
      summaries.delete(track);
      return saved;
    },

    // Songs.

    songs(track, run) {
      return library.songs(track, run);
    },

    /** Asks for an audio file and puts a copy in the song library. */
    async chooseSong() {
      const picked = await dialog.showOpenDialog(window(), {
        title: "Add a song",
        message: "Choose a song. A copy goes into your song library, where every track can use it.",
        properties: ["openFile"],
        filters: [{ name: "Songs", extensions: [...audioExtensions] }],
      });
      if (picked.canceled) return { name: null, problem: null };
      const kept = library.keepSong(picked.filePaths[0]);
      return { name: kept.name, problem: kept.problem ? `${kept.name} couldn't be added to your songs: ${kept.problem}` : null };
    },

    /** A song as the editor plays and draws it: its sound, its length and its sound wave. */
    async songSound(track, name) {
      // A song that is only in this track's folder, from before there was a library, joins the
      // library when it is used, so the next track has it too. The track's copy is left where it is.
      const own = join(library.folder(track, "music"), name);
      if (existsSync(own)) library.keepSong(own, name);
      const sound = await soundOf(library.songFile(name, track), ffmpeg);
      return sound ?? { problem: `${name} isn't among your songs any more, or can't be read.` };
    },

    /** What the app hears in a song: its tempo, its beat and its drops. Null when it can't listen. */
    async songAnalysis(track, name) {
      const file = library.songFile(name, track);
      return existsSync(file) ? analysisOf(file, { ffmpegPath: ffmpeg.binary, cache }) : null;
    },

    async revealSongs() {
      mkdirSync(library.songLibrary, { recursive: true });
      await shell.openPath(library.songLibrary);
    },

    beep() {
      shell.beep();
    },

    /** Something went wrong in a page: it is written down with everything else that has. */
    log(text) {
      log(`A page: ${text}`);
    },

    /** Shows the file where what went wrong is written down. */
    showLog() {
      if (!existsSync(logFile())) log("Nothing has gone wrong so far.");
      shell.showItemInFolder(logFile());
    },

    // Finished videos.

    makeVideo(track, runName, shapeName) {
      const shape = shapes[shapeName];
      return working(`Making the ${shape.title} for ${runName}`, async (progress) => {
        const summary = await library.summary(track);
        const run = summary.runs.find((one) => one.name === runName);
        if (!run?.clip) return { notice: `There's no recording called ${runName} to make it from.` };
        const facts = await library.facts(run.clip);
        if (!facts) return { notice: `${basename(run.clip)} can't be read.` };
        const edit = library.state(track).edits?.[runName] ?? {};
        const span = stretch(run.crossings, edit, facts.frames / facts.fps.value);
        if (!span) return { notice: "The stretch to show ends before it starts. Open Markers & music and set it again." };
        let music = null;
        if (edit.song) {
          const file = library.songFile(edit.song, track);
          const songLength = existsSync(file) ? await ffmpeg.soundLength(file) : null;
          if (!songLength) return { notice: `${edit.song} isn't among your songs any more. Open Markers & music for ${runName} and pick the song again.` };
          music = { file, songLength, songStart: edit.songStart ?? span.start, musicIn: edit.musicIn ?? null, musicOut: edit.musicOut ?? null };
        }
        const copy = await copyOf(run.clip, facts);
        if (copy.problem) return { notice: copy.problem };
        let picture = null;
        if (shapeName === "upright") {
          const grey = await ffmpeg.greyFrame(copy.file, span.start + 3, facts);
          picture = grey ? pictureRect(grey, facts.width, facts.height) : null;
        }
        const output = library.nextNumbered(library.folder(track, shape.folder), runName, "mp4");
        const already = (shapeName === "landscape" ? run.landscapes : run.uprights).length;
        // A plain copy is a second encoding of the pictures. A video is made from the recording itself then.
        const job = {
          shape: shapeName, facts: { ...facts, fps: { num: facts.fps.num, den: facts.fps.den } },
          source: copy.kind === "wrapped" ? copy.file : run.clip, exactTimes: copy.kind === "wrapped",
          start: span.start, end: span.end, crossings: run.crossings, window: summary.window, look: look(track), picture, music, output,
        };
        // What the event puts before and after its videos. A clip that can't be read is left off, and said so.
        const left = [];
        job.bookends = {};
        // Each shape of video has its own.
        for (const [which, end] of Object.entries(library.bookends(eventFolder(track))[shapeName] ?? {})) {
          if (!end) continue;
          if (end.kind === "picture") {
            job.bookends[which] = { file: end.file, kind: "picture", seconds: end.seconds, hasSound: false };
            continue;
          }
          const found = await ffmpeg.probe(end.file);
          if (found) job.bookends[which] = { file: end.file, kind: "clip", seconds: found.duration, hasSound: found.hasSound, matrix: found.matrix, fullRange: found.fullRange, hdr: found.hdr };
          else left.push(`${end.name} can't be read as a video, so it was left off.`);
        }
        const encoder = await ffmpeg.encoder();
        let made = await videos.make({ ...job, encoder }, progress);
        if (!made.ok && encoder !== "libx264") {
          // The computer's video chip let it down. FFmpeg's own encoder is slower and always there.
          log(`Making a video with ${encoder}: ${made.problem}`);
          ffmpeg.distrustEncoder();
          made = await videos.make({ ...job, encoder: "libx264" }, progress);
        }
        if (!made.ok) return { notice: `No ${shape.name} video for ${runName}: ${made.problem}.` };
        const notes = [`Made ${basename(output)}`, ...left];
        if (already > 0) notes.push(`There are now ${already + 1} versions of the ${shape.title} for ${runName}. Open them and keep the right one.`);
        return { notice: notes.join("\n"), made: { path: output, title: shape.title, run: runName }, crowded: already > 0, seconds: made.seconds };
      });
    },

    // Files.

    async trash(paths) {
      const moved = [], stuck = [];
      for (const path of paths) {
        try {
          await shell.trashItem(path);
          moved.push(basename(path));
        } catch {
          stuck.push(basename(path));
        }
      }
      const lines = [];
      if (moved.length > 0) lines.push(`Moved ${moved.join(", ")} to ${bin}.`);
      if (stuck.length > 0) lines.push(`Couldn't move ${stuck.join(", ")}.`);
      return { notice: lines.join("\n") };
    },

    /** Plays a file in VLC, or in whatever opens it by default when VLC isn't installed. */
    async play(path) {
      if (!existsSync(path)) return { notice: `${basename(path)} isn't there any more. Press Refresh.` };
      if (vlc) {
        const child = mac ? spawn("/usr/bin/open", ["-a", vlc, path], { stdio: "ignore", detached: true }) : spawn(vlc, [path], { stdio: "ignore", detached: true });
        child.on("error", () => {});
        child.unref();
        return {};
      }
      const problem = await shell.openPath(path);
      return { notice: problem || null };
    },

    reveal(path) {
      if (existsSync(path)) shell.showItemInFolder(path);
    },

    async openFolder(path) {
      mkdirSync(path, { recursive: true });
      await shell.openPath(path);
    },

    openLink(address) {
      // Only pages on the web, never a program or a file.
      if (/^https:\/\//i.test(address)) shell.openExternal(address);
    },

    /** A frame of a recording as a picture a page can show. */
    async frameOf(clip, seconds) {
      if (!existsSync(clip)) return null;
      const picture = await ffmpeg.frame(clip, seconds);
      return picture ? `data:image/jpeg;base64,${picture.toString("base64")}` : null;
    },

    // An event's logo.

    async chooseLogo(event) {
      const picked = await dialog.showOpenDialog(window(), {
        title: "Choose a logo",
        message: "Choose a picture for this event's logo. A copy is kept with the event. One with a see-through background looks best.",
        properties: ["openFile"],
        filters: [{ name: "Pictures", extensions: [...pictureExtensions] }],
      });
      if (picked.canceled) return { state: api.state() };
      const set = await library.setLogo(event, picked.filePaths[0]);
      return { notice: set.problem, state: api.state() };
    },

    async removeLogo(event) {
      const name = library.details(event).name;
      try {
        await library.removeLogo(event);
        return { notice: `Moved ${name}'s logo to ${bin}.`, state: api.state() };
      } catch (error) {
        return { notice: `The logo couldn't be moved to ${bin}: ${error.message}`, state: api.state() };
      }
    },

    // Updates.

    /** Looks for a newer packaged version. `quietly` is the check made as the app opens, which
     *  says nothing unless there is one. */
    async checkForUpdates({ quietly = false } = {}) {
      if (isTestCopy() || update.kind === "checking" || update.kind === "installing") return api.state();
      const before = update;
      if (!quietly) {
        update = { kind: "checking" };
        tell("changed");
      }
      try {
        const release = await latest(library.fetch);
        setConfig({ lastUpdateCheck: Date.now() / 1000 });
        update = release && isNewer(release.version, version()) ? { kind: "available", ...release } : { kind: "current" };
      } catch (error) {
        update = quietly ? before : { kind: "failed", problem: `Couldn't check for updates: ${error.message}.` };
      }
      tell("changed");
      return api.state();
    },

    /** The check as the app opens: once a day at most, and not at all when it has been switched off. */
    checkForUpdatesIfDue() {
      if (!quiet && !isTestCopy() && checkIsDue()) api.checkForUpdates({ quietly: true });
    },

    /** Replaces this copy of the app with the newer one, and starts it. */
    async installUpdate() {
      if (update.kind !== "available") return { state: api.state() };
      if (job) return { notice: "Let the video finish before updating.", state: api.state() };
      const release = { version: update.version, file: update.file, sha256: update.sha256, notes: update.notes };
      update = { kind: "installing", ...release, share: 0 };
      tell("changed");
      let last = 0;
      const problem = await install(release, { fetcher: library.fetch, heard: (share) => {
        // Told a hundredth at a time: the download arrives in thousands of pieces.
        if (share - last < 0.01) return;
        last = share;
        update = { ...update, share };
        tell("changed");
      } });
      if (problem) {
        log(`Updating to v${release.version}: ${problem}`);
        update = { kind: "failed", problem };
        tell("changed");
        return { state: api.state() };
      }
      // The new copy starts by itself once this one has gone.
      videos.close();
      setTimeout(() => app.quit(), 300);
      return { state: api.state() };
    },

    // The season's leaderboards.

    /**
     * The leaderboards as the series' spreadsheet has them, with who the pilot is so their own
     * entry can be picked out. They are read again when asked for, or when the last reading is
     * more than ten minutes old. A reading that fails leaves the last one, and says so. A copy
     * that shows no window never reads them by itself.
     */
    async leaderboards({ again = false } = {}) {
      if (!boards) {
        try {
          boards = JSON.parse(readFileSync(boardsFile, "utf8"));
        } catch {}
      }
      let problem = null;
      const stale = !boards || Date.now() - Date.parse(boards.read) > 10 * 60 * 1000;
      if (again || (stale && !quiet)) {
        try {
          boards = await (readingBoards ??= readBoards(library.fetch));
          mkdirSync(cache, { recursive: true });
          writeFileSync(boardsFile, JSON.stringify(boards));
        } catch (error) {
          log(`Reading the leaderboards: ${error.message}`);
          problem = boards ? `The leaderboards couldn't be read just now (${error.message}). These are from the last time they could.` : `The leaderboards couldn't be read (${error.message}). Check that this computer is online, then press Refresh.`;
        }
        readingBoards = null;
      }
      const event = library.seasonEvent;
      return { read: boards?.read ?? null, tabs: boards?.tabs ?? [], problem, me: { id: (event ? library.details(event).id : library.settings.id) ?? "", name: library.settings.pilot ?? "" } };
    },

    // The track in 3D.

    /** A track drawn in 3D: the pilot's own when they have made one, or else the one that comes
     *  with the app for that track of the season. Null when there is neither. */
    trackView(track) {
      const event = eventFolder(track), number = trackNumber(trackName(track));
      // The season's event, whatever its folder is called, or any event that has the season's name.
      const names = [event === library.seasonEvent ? series.season : null, library.details(event).name, event].filter(Boolean).map((name) => name.toLowerCase());
      const given = number === null ? null : (givenTracks ??= tracksWithTheApp()).find((one) => one.track === number && names.includes(one.event.toLowerCase())) ?? null;
      const own = readTrack(library.ownTrackView(track));
      if (own) return { view: own, own: true, given: Boolean(given) };
      return given ? { view: given, own: false, given: true } : null;
    },

    /**
     * Reads a track's pipes out of the series' video of it: the chapter in which it is built in
     * front of a fixed camera. `from` and `to` are that chapter's times, for a video whose
     * description doesn't give them, and `sections` is how many pipes the video's parts list adds
     * up to, when the pilot has said.
     *
     * Gives { pipes, readings, picture, chapters, shot }, where `readings` are the other ways the
     * picture can be seen, one for each number of pipes, or { problem }. News of how it is going
     * is sent as "trackvideo".
     */
    async readTrackVideo({ link, from = null, to = null, sections = null, moments = null } = {}) {
      if (readingVideo) return { problem: "A video is being read already. Wait for that to finish." };
      readingVideo = true;
      try {
        const shot = Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
        const stills = await stillsOf(link, { shot, moments, said: (stage) => tell("trackvideo", stage) });
        if (stills.problem) return stills;
        tell("trackvideo", "Looking for the pipes");
        const found = await pipesIn(stills, Number.isInteger(sections) && sections > 0 ? sections : null);
        if (found.problem) {
          log(`Reading the track out of ${link}: ${found.problem}`);
          return { problem: `No track was found in the video's build (${found.problem}) You can still build it by hand.`, chapters: stills.chapters, shot: stills.shot, picture: stills.picture };
        }
        return { pipes: found.pipes, readings: found.readings, leftOut: found.leftOut, picture: stills.picture, chapters: stills.chapters, shot: stills.shot, start: stills.start, looked: stills.looked, title: stills.title };
      } finally {
        readingVideo = false;
      }
    },

    /** Keeps a track the pilot built, or changed, as that track's view. */
    saveTrackView(track, view) {
      if (!library.tracks.includes(track)) return { problem: "That track isn't in your library any more." };
      const event = eventFolder(track);
      const tidy = readTrack({ ...view, event: library.details(event).name || event, track: trackNumber(trackName(track)) });
      if (!tidy) return { problem: "A track needs at least one section before it can be kept. Click one of the faint lines under Pipes." };
      try {
        library.saveTrackView(track, tidy);
      } catch (error) {
        log(`Keeping the 3D view of ${track}: ${error.message}`);
        return { problem: `It couldn't be kept: ${error.message}` };
      }
      return { problem: null, ...api.trackView(track) };
    },

    /** Sends the pilot's own view of a track to the Trash. Gives what the track is left with. */
    async removeTrackView(track) {
      const file = library.trackViewFile(track);
      if (existsSync(file)) await library.trash(file);
      return api.trackView(track);
    },

    // What goes before and after an event's videos.

    async chooseBookend(event, shape, which) {
      const shaped = shape === "upright" ? "9:16" : "16:9";
      const picked = await dialog.showOpenDialog(window(), {
        title: `${which === "before" ? "Before" : "After"} the ${shaped} video`,
        message: `Choose a short clip or a picture to put ${which} every ${shaped} video of this event. A copy is kept with the event.`,
        properties: ["openFile"],
        filters: [{ name: "Clips and pictures", extensions: [...videoExtensions, ...bookendPictures] }],
      });
      if (picked.canceled) return { state: api.state() };
      const set = await library.setBookend(event, shape, which, picked.filePaths[0]);
      return { notice: set.problem, state: api.state() };
    },

    async removeBookend(event, shape, which) {
      const old = library.bookends(event)[shape]?.[which];
      try {
        await library.removeBookend(event, shape, which);
        return { notice: old ? `Moved ${old.name} to ${bin}.` : null, state: api.state() };
      } catch (error) {
        return { notice: `It couldn't be moved to ${bin}: ${error.message}`, state: api.state() };
      }
    },

    setBookendSeconds(event, shape, which, seconds) {
      library.setBookendSeconds(event, shape, which, seconds);
      return api.state();
    },

    // Entry forms.

    /** Reads a track's form. Its deadline comes back as a moment, when the form states one. */
    async form(track) {
      const read = await library.form(track, parseForm);
      return { ...read, address: library.state(track).formURL };
    },

    setForm(track, address) {
      library.update(track, (state) => { state.formURL = address.trim(); });
      return library.state(track).formURL;
    },

    /** What submitting a run starts from: the form, and everything already known that goes in it. */
    async submitData(track, run) {
      const read = await library.form(track, parseForm);
      const state = library.state(track);
      return {
        form: read.form, problem: read.problem,
        email: library.store.email ?? "", kept: library.store.answers ?? {},
        pilot: library.settings.pilot ?? "", number: library.details(eventFolder(track)).id ?? "",
        link: state.links?.[run] ?? "",
      };
    },

    /** Keeps the video's link as it is typed, so closing the window doesn't lose it. */
    setLink(track, run, link) {
      library.update(track, (state) => { state.links = { ...(state.links ?? {}), [run]: link.trim() }; });
    },

    /** Keeps what was answered, for the next entry: the email, and each answer under its question's words. */
    rememberAnswers(track, run, { email, answers, link }) {
      library.store.email = email.trim();
      library.store.answers = { ...(library.store.answers ?? {}), ...answers };
      library.saveStore();
      if (link !== null) api.setLink(track, run, link);
    },

    clipboardText() {
      return clipboard.readText();
    },

    /**
     * Opens the track's real Google Form inside the window, over the place given, and fills it in
     * when it loads. Sending it is left to the Submit button on the form itself. The pages hear
     * "formSent" once Google has accepted it.
     */
    openForm(track, { answers, email }, place) {
      api.closeForm();
      const address = library.state(track).formURL.trim();
      if (!isFormAddress(address) || !window()) return { problem: "This track's form link isn't a Google Form." };
      // Its own corner of the browser, kept between runs, so a Google sign-in is remembered. It can
      // do nothing but show pages: no access to files, to the app, or to the app's own pages.
      const view = new WebContentsView({ webPreferences: { partition: "persist:forms", sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      // Google turns away a browser that says it is an app with a browser inside it.
      contents.setUserAgent(contents.getUserAgent().replace(/\s(Electron|fpv-hangar|FPVHangar)\/\S+/gi, ""));
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) contents.loadURL(url);
        return { action: "deny" };
      });
      contents.on("will-navigate", (event, url) => { if (!/^https:\/\//i.test(url)) event.preventDefault(); });
      let reported = false;
      const script = fillScript(answers, email);
      contents.on("did-finish-load", () => {
        let path = "";
        try {
          path = new URL(contents.getURL()).pathname;
        } catch {}
        if (path.endsWith("/formResponse")) {
          // Google only moves to this page once it has accepted the answers.
          if (!reported) {
            reported = true;
            tell("formSent", track);
          }
        } else if (path.endsWith("/viewform")) {
          setTimeout(() => { if (!contents.isDestroyed()) contents.executeJavaScript(script, true).catch(() => {}); }, 500);
        }
      });
      window().contentView.addChildView(view);
      formView = view;
      api.placeForm(place);
      contents.loadURL(address);
      return { problem: null };
    },

    /** Moves the form to where the page says it goes, when the window changes size. */
    placeForm(place) {
      if (!formView || !place) return;
      formView.setBounds({ x: Math.round(place.x), y: Math.round(place.y), width: Math.max(1, Math.round(place.width)), height: Math.max(1, Math.round(place.height)) });
    },

    closeForm() {
      if (!formView) return;
      const view = formView;
      formView = null;
      try {
        window()?.contentView.removeChildView(view);
      } catch {}
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },

    /** For the app's checks of itself: what the open form holds now. Nothing is sent. */
    async formHolds() {
      if (!formView) return null;
      return formView.webContents.executeJavaScript(`JSON.stringify({ at: location.pathname, fields: Object.fromEntries([...document.querySelectorAll('input[type=hidden][name^="entry."]')].filter((i) => i.value).map((i) => [i.name, i.value])), email: (document.querySelector('input[type=email]') || {}).value || "" })`, true).then(JSON.parse).catch(() => null);
    },

    recordSubmission(track, run, time, link) {
      library.recordSubmission(track, { run, time, link });
    },
  };

  summariseAll();
  return api;
}
