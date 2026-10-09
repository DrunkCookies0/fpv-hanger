// The pilot's library on disk: events, their tracks, each track's recordings, markers, songs and
// finished videos, and the two files that hold what the app remembers.
//
// It is laid out exactly as the Mac app lays it out, and the two files are written so that the Mac
// app can read them, so one library can be opened by either.
//
//   <library>/
//     dashboard.json           what the app remembers
//     settings.json            the pilot's name and the timer's corner
//     Songs/                   every song, for every track
//     <event>/                 a race or a series
//       Logo.png               its logo, if it has one
//       <track>/
//         Raw files/           recordings
//         csv markers/         one marker file for each run
//         music/               sound exported from Premiere, and songs from before the song library
//         landscape/           finished 16:9 videos
//         vertical/            finished 9:16 videos

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, statfsSync, utimesSync, renameSync, rmSync, copyFileSync, createReadStream, createWriteStream } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { decodeText, crossingsIn, markersAreInClipTime, Race, FrameRate, coarseStep, formatTime, markerFile, Unusable } from "../shared/timing.js";
import * as series from "../shared/series.js";

export const videoExtensions = new Set(["ts", "mts", "m2ts", "mp4", "m4v", "mov", "mkv", "avi", "mxf"]);
export const audioExtensions = new Set(["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac", "ogg", "opus"]);
export const pictureExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);
/** What a bookend's file is called, without its ending, and what its seconds are kept under. */
const bookendName = (shape, which) => `${which === "before" ? "Before" : "After"}${shape === "upright" ? " 9x16" : ""}`;
const bookendKey = (shape, which) => `${shape === "upright" ? "upright " : ""}${which}`;
/** The kinds of picture that can go before or after a video: still ones. */
export const bookendPictures = new Set(["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"]);
export const songsFolder = "Songs";
/** The file tucked inside a track or event on its way to the Trash, holding what the app remembers
 *  about it. If the folder is put back, that comes back with it. */
export const keepsake = ".fpv-hangar.json";
/** What has to be typed before something with files in it is deleted. */
export const removalPhrase = "I UNDERSTAND";
const parts = ["Raw files", "csv markers", "music"];

const extension = (name) => extname(name).slice(1).toLowerCase();
const stem = (name) => basename(name, extname(name));
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** A size in words, the way a file browser gives it: "281.7 MB". Megabytes to one place,
 *  anything bigger to two, and no noughts on the end. */
export function bytes(count) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = count, unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${count} ${count === 1 ? "byte" : "bytes"}`;
  const places = unit === 1 ? 0 : unit === 2 ? 1 : 2;
  return `${Number(value.toFixed(places))} ${units[unit]}`;
}
const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
const list = (folder) => {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
};
const isFolder = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** The run a marker file is for: its name without ".csv", and without the clip's extension when
 *  Premiere named the export after the whole clip file ("hdz_0012.ts.csv"). */
export function runName(file) {
  if (!["csv", "txt"].includes(extension(file))) return null;
  const name = stem(file);
  return videoExtensions.has(extension(name)) ? stem(name) : name;
}

export const trackName = (track) => track.split("/").pop();
export const eventFolder = (track) => (track.includes("/") ? track.slice(0, track.indexOf("/")) : "");
/** The number in a track's name: 1 for "Track 1". */
export const trackNumber = (name) => {
  const digits = name.replace(/\D/g, "");
  return digits === "" ? null : Number(digits);
};

export class Library {
  /**
   * @param {string} root the library's folder
   * @param {object} tools
   * @param {import("./ffmpeg.js").FFmpeg} tools.ffmpeg
   * @param {string} tools.cache a folder for what can be made again
   * @param {(path: string) => Promise<void>} tools.trash moves something to the Trash
   * @param {typeof fetch} [tools.fetch]
   */
  constructor(root, { ffmpeg, cache, trash, fetch: fetcher = globalThis.fetch }) {
    this.root = root;
    this.ffmpeg = ffmpeg;
    this.cache = cache;
    this.trash = trash;
    this.fetch = fetcher;
    this.settings = {};
    this.store = {};
    this.extras = {};
    this.events = [];
    this.tracks = [];
    this.forms = new Map();
    this.load();
  }

  // The files.

  get storeFile() { return join(this.root, "dashboard.json"); }
  /** What this app keeps that the Mac app's two files have no place for. The Mac app writes those
   *  out with only what it knows of, so anything new put in them would be gone the next time it saved. */
  get extrasFile() { return join(this.root, "hangar.json"); }
  /** Beside the old lap timer's source when the library has it, which is where the Mac app's copy kept them. */
  get settingsFile() {
    const beside = join(this.root, "Lap Timer");
    return isFolder(beside) ? join(beside, "settings.json") : join(this.root, "settings.json");
  }

  #read(file) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  #write(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    const part = `${file}.part`;
    writeFileSync(part, JSON.stringify(value, null, 2) + "\n");
    renameSync(part, file);
  }

  /** Reads the files, making the library's folder first when it is a new one. */
  load() {
    mkdirSync(this.root, { recursive: true });
    // Every field the Mac app expects is always there, so a file written here always loads there.
    this.settings = { pilot: "", id: "", idLabel: series.idLabel, corner: "tr", ...(this.#read(this.settingsFile) ?? { event: series.season }) };
    this.store = { email: "", answers: {}, tracks: {}, ...(this.#read(this.storeFile) ?? {}) };
    this.extras = { events: {}, ...(this.#read(this.extrasFile) ?? {}) };
    this.#stamps = this.#fileStamps();
    this.gatherSongMarks();
    this.findTracks();
  }

  #stamps = "";
  #fileStamps() {
    return [this.storeFile, this.settingsFile, this.extrasFile].map((file) => {
      try {
        const facts = statSync(file);
        return `${facts.mtimeMs}:${facts.size}`;
      } catch {
        return "none";
      }
    }).join("|");
  }

  /** Turns to another folder as the library. Nothing is moved. */
  use(root) {
    this.root = root;
    this.forms = new Map();
    this.load();
  }

  saveSettings() {
    this.#write(this.settingsFile, this.settings);
    this.#stamps = this.#fileStamps();
  }

  saveStore() {
    this.#write(this.storeFile, this.store);
    this.#stamps = this.#fileStamps();
  }

  saveExtras() {
    this.#write(this.extrasFile, this.extras);
    this.#stamps = this.#fileStamps();
  }

  /** Another copy of the app, or the Mac app, may have saved since this one looked. Takes up what is
   *  in the files now, then looks for tracks again. Nothing of its own is lost: it saves as it goes. */
  refresh(now = new Date()) {
    if (this.#fileStamps() !== this.#stamps) this.load();
    else this.findTracks();
    this.applySeason(now);
  }

  // Events and tracks.

  folder(track, part) { return join(this.root, ...track.split("/"), part); }
  place(track) { return join(this.root, ...track.split("/")); }

  findTracks() {
    const isTrack = (folder) => ["csv markers", "Raw files"].some((part) => existsSync(join(folder, part)));
    const folders = (place) => list(place).filter((name) => !name.startsWith(".") && !name.endsWith(".app") && isFolder(join(place, name))).sort(natural);
    const loose = [], found = [];
    for (const name of folders(this.root)) {
      const folder = join(this.root, name);
      if (isTrack(folder)) {
        loose.push(name);
        continue;
      }
      const inside = folders(folder).filter((track) => isTrack(join(folder, track)));
      if (inside.length > 0 || this.store.events?.[name]) found.push({ folder: name, tracks: inside.map((track) => `${name}/${track}`) });
    }
    if (loose.length > 0) found.unshift({ folder: "", tracks: loose });
    // Anything put back from the Trash brings what was remembered about it.
    let changed = false;
    for (const event of found) {
      if (event.folder !== "" && !this.store.events?.[event.folder]) {
        const kept = this.#takeBack(join(this.root, event.folder));
        if (kept) {
          this.store.events = { ...(this.store.events ?? {}), [event.folder]: kept };
          changed = true;
        }
      }
      for (const track of event.tracks) {
        if (this.store.tracks[track]) continue;
        const kept = this.#takeBack(this.place(track));
        if (kept) {
          this.store.tracks[track] = kept;
          changed = true;
        }
      }
    }
    if (changed) this.saveStore();
    this.events = found;
    this.tracks = found.flatMap((event) => event.tracks);
  }

  /** An event's details: the name its timers show, and the pilot's ID in it. The loose tracks of an
   *  older library keep theirs in the pilot's settings. */
  details(event) {
    if (event === "") return { name: this.settings.event ?? "", id: this.settings.id ?? "", idLabel: this.settings.idLabel ?? "ID" };
    const own = this.store.events?.[event];
    return { name: own?.name ?? event, id: own?.id ?? "", idLabel: own?.idLabel ?? "ID" };
  }

  /** An event with no name of its own goes by its folder's. */
  setDetails(event, details) {
    if (event === "") {
      Object.assign(this.settings, { id: details.id, idLabel: details.idLabel });
      if (details.name === "") delete this.settings.event;
      else this.settings.event = details.name;
      this.saveSettings();
      return;
    }
    const all = { ...(this.store.events ?? {}) };
    all[event] = { ...(all[event] ?? {}), name: details.name === event || details.name === "" ? undefined : details.name, id: details.id, idLabel: details.idLabel };
    if (all[event].name === undefined) delete all[event].name;
    this.store.events = all;
    this.saveStore();
  }

  state(track) {
    return { formURL: "", mismatchFPS: "", links: {}, submissions: [], ...(this.store.tracks[track] ?? {}) };
  }

  update(track, change) {
    const state = this.state(track);
    change(state);
    this.store.tracks[track] = state;
    this.saveStore();
  }

  /** Whether a name will do for an event's folder. What is wrong with it, or null. */
  #problemWithEventName(name) {
    if (name === "") return "Give the event a name.";
    if (/[\\/:*?"<>|]/.test(name) || name.startsWith(".") || name.endsWith(".") || name.endsWith(" ")) {
      return 'An event\'s name can\'t have any of \\ / : * ? " < > | in it, or start or end with a full stop.';
    }
    return null;
  }

  /** Makes an event, with a first track in it. Returns what is wrong with the name, or null. */
  newEvent(raw, now = new Date()) {
    const name = raw.trim();
    const problem = this.#problemWithEventName(name);
    if (problem) return { problem };
    if (sameName(name, songsFolder)) return { problem: `${songsFolder} is the folder your song library is kept in. Give the event another name.` };
    if (existsSync(join(this.root, name))) return { problem: `There is already a folder called ${name} in your library.` };
    // Two events with one name would be two headings nobody can tell apart.
    if (this.events.some((event) => sameName(this.details(event.folder).name, name))) return { problem: `You already have an event called ${name}. New track under it adds a track.` };
    this.store.events = { ...(this.store.events ?? {}), [name]: {} };
    this.saveStore();
    return this.newTrack(name, now);
  }

  /** Makes a track in an event. For the season's event it is the next of the season's tracks that
   *  has opened and isn't here. Returns { track } or { notice }. */
  newTrack(event, now = new Date()) {
    if (event !== "" && event === this.seasonEvent && this.season(event).length > 0) {
      const have = new Set(this.#tracksOf(event).map((track) => trackNumber(trackName(track))));
      const open = this.season(event).filter((one) => new Date(one.release) <= now && !have.has(one.number)).sort((a, b) => a.number - b.number)[0];
      if (!open) {
        const next = this.nextSeasonTrack(event, now);
        return { notice: next ? `Track ${next.number} opens on ${new Date(next.release).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. It will appear here by itself.`
          : `Every track of ${this.details(event).name} is here already.` };
      }
      const kept = this.store.events[event];
      if (kept.skipped) kept.skipped = kept.skipped.filter((number) => number !== open.number);
      this.saveStore();
      this.applySeason(now);
      const track = `${event}/Track ${open.number}`;
      return this.tracks.includes(track) ? { track } : { notice: `Track ${open.number} couldn't be made.` };
    }
    const place = event === "" ? this.root : join(this.root, event);
    let number = this.#tracksOf(event).length + 1;
    while (existsSync(join(place, `Track ${number}`))) number += 1;
    const track = `${event === "" ? "" : `${event}/`}Track ${number}`;
    for (const part of parts) mkdirSync(this.folder(track, part), { recursive: true });
    this.findTracks();
    return { track };
  }

  #tracksOf(event) { return this.events.find((one) => one.folder === event)?.tracks ?? []; }

  /** Moves the tracks that sit loose in the library into a folder named after their event, so they
   *  are laid out like any other event. What is remembered about them moves with them. Returns what
   *  went wrong, or null, and where each track went. */
  gatherLooseTracks() {
    const loose = this.#tracksOf("");
    if (loose.length === 0) return { problem: null, moved: {} };
    const name = (this.settings.event ?? "").trim();
    const problem = this.#problemWithEventName(name);
    if (problem) return { problem: name === "" ? "Give the event a name first: its folder is named after it." : problem, moved: {} };
    const place = join(this.root, name);
    if (existsSync(place) && (!isFolder(place) || loose.some((track) => existsSync(join(place, track))))) {
      return { problem: `Something called ${name} is already in your library and is in the way.`, moved: {} };
    }
    const moved = {};
    let failure = null;
    try {
      mkdirSync(place, { recursive: true });
      for (const track of loose) {
        renameSync(join(this.root, track), join(place, track));
        if (this.store.tracks[track]) {
          this.store.tracks[`${name}/${track}`] = this.store.tracks[track];
          delete this.store.tracks[track];
        }
        moved[track] = `${name}/${track}`;
      }
    } catch (error) {
      failure = `Not every track could be moved: ${error.message}`;
    }
    const kept = { idLabel: this.settings.idLabel };
    if (this.settings.id) kept.id = this.settings.id;
    this.store.events = { ...(this.store.events ?? {}), [name]: { ...(this.store.events?.[name] ?? {}), ...kept } };
    this.saveStore();
    this.findTracks();
    return { problem: failure, moved };
  }

  // The season.

  /** The folder of the event that is this season of the series, when the library has one. */
  get seasonEvent() {
    return this.events.find((event) => event.folder !== "" && sameName(this.details(event.folder).name, series.season))?.folder ?? null;
  }

  /** The season's tracks as the series last published them. */
  season(event) { return this.store.events?.[event]?.season ?? []; }

  /** What the series' schedule says about a track, when it is one of the season's. */
  seasonTrack(track) {
    const event = eventFolder(track), number = trackNumber(trackName(track));
    if (event === "" || event !== this.seasonEvent || number === null) return null;
    return this.season(event).find((one) => one.number === number) ?? null;
  }

  /** The season's next track that isn't open yet. */
  nextSeasonTrack(event, now = new Date()) {
    if (event !== this.seasonEvent) return null;
    return this.season(event).filter((one) => new Date(one.release) > now).sort((a, b) => new Date(a.release) - new Date(b.release))[0] ?? null;
  }

  /** Makes a track for each of the season's tracks that has opened, and gives each its entry form
   *  once the series has posted it. Nothing the pilot set is changed, and a track the pilot deleted
   *  is not made again. It goes by what was last read, so it works with no network. */
  applySeason(now = new Date()) {
    const event = this.seasonEvent;
    if (!event) return [];
    const season = this.season(event);
    if (season.length === 0) return [];
    const skipped = new Set(this.store.events?.[event]?.skipped ?? []);
    const made = [];
    for (const one of season) {
      const have = new Set(this.#tracksOf(event).map((track) => trackNumber(trackName(track))));
      if (!(new Date(one.release) <= now) || skipped.has(one.number) || have.has(one.number)) continue;
      const track = `${event}/Track ${one.number}`;
      for (const part of parts) mkdirSync(this.folder(track, part), { recursive: true });
      made.push(track);
      this.findTracks();
    }
    for (const track of this.#tracksOf(event)) {
      const one = this.seasonTrack(track);
      if (one?.form && this.state(track).formURL.trim() === "") this.update(track, (state) => { state.formURL = one.form; });
    }
    return made;
  }

  /** Reads the season's schedule and forms again when that was last done some hours ago. The series
   *  posts a track's form on the day it opens, so this is how the form arrives. Returns the tracks it made. */
  async readSeasonIfDue({ force = false, now = new Date() } = {}) {
    const event = this.seasonEvent;
    if (!event || this.#readingSeason) return [];
    const last = this.store.events?.[event]?.seasonRead;
    if (!force && last && now - new Date(last) < 3 * 3600 * 1000) return [];
    this.#readingSeason = true;
    try {
      const tracks = await series.readSeason(now, this.fetch);
      const kept = { ...(this.store.events?.[event] ?? {}) };
      kept.season = tracks.map((track) => {
        const one = { number: track.number, release: series.stamp(track.release), deadline: series.stamp(track.deadline) };
        if (track.livestream) one.livestream = series.stamp(track.livestream);
        for (const key of ["sponsor", "designer", "form"]) if (track[key]) one[key] = track[key];
        return one;
      });
      kept.seasonRead = series.stamp(now);
      this.store.events = { ...(this.store.events ?? {}), [event]: kept };
      this.saveStore();
      return this.applySeason(now);
    } catch {
      return [];
    } finally {
      this.#readingSeason = false;
    }
  }

  #readingSeason = false;

  /** Takes the answers to the setup questions: the pilot's name, and for a pilot flying this season
   *  of the series, an event for it carrying their registration number. */
  finishSetUp({ pilot, fliesSeries, number }) {
    const name = pilot.trim();
    if (name !== "") this.settings.pilot = name;
    if (fliesSeries) {
      const event = this.events.find((one) => sameName(this.details(one.folder).name, series.season))?.folder ?? series.season;
      const id = number.trim();
      if (event === "") {
        // The tracks that sit loose in an older library are this season's already.
        if (id !== "") this.settings.id = id;
        this.settings.idLabel = series.idLabel;
      } else {
        // An event is a folder in the library. Without its folder it would be remembered and never shown.
        mkdirSync(join(this.root, event), { recursive: true });
        const kept = { ...(this.store.events?.[event] ?? {}) };
        if (id !== "") kept.id = id;
        kept.idLabel = series.idLabel;
        this.store.events = { ...(this.store.events ?? {}), [event]: kept };
        this.saveStore();
      }
    }
    this.saveSettings();
    this.findTracks();
  }

  // Recordings and runs.

  /** The recordings in a track, by name. */
  clips(track) {
    const raw = this.folder(track, "Raw files");
    return list(raw).filter((name) => !name.startsWith(".") && videoExtensions.has(extension(name))).sort(natural).map((name) => join(raw, name));
  }

  /** What FFmpeg finds in a recording, kept so each is only looked at once. */
  async facts(clip) {
    let stamp;
    try {
      const file = statSync(clip);
      stamp = `${basename(clip)}-${file.size}-${Math.round(file.mtimeMs)}`;
    } catch {
      return null;
    }
    const kept = join(this.cache, "Clips", `${stamp}.json`);
    const read = this.#read(kept);
    if (read?.fps) return { ...read, fps: new FrameRate(read.fps.num, read.fps.den), claimedFPS: read.claimedFPS ? new FrameRate(read.claimedFPS.num, read.claimedFPS.den) : null };
    const found = await this.ffmpeg.probe(clip);
    if (found) this.#write(kept, found);
    return found;
  }

  /** Finished videos and such of one run in a folder: "<run>-<number>.<ext>", oldest first. */
  #numbered(folder, run, ext) {
    const pattern = new RegExp(`^${run.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.${ext}$`, "i");
    return list(folder).filter((name) => pattern.test(name)).sort((a, b) => Number(pattern.exec(a)[1]) - Number(pattern.exec(b)[1])).map((name) => join(folder, name));
  }

  /** The next free "<run>-<number>.<ext>" in a folder. */
  nextNumbered(folder, run, ext) {
    let number = 1;
    while (existsSync(join(folder, `${run}-${number}.${ext}`))) number += 1;
    return join(folder, `${run}-${number}.${ext}`);
  }

  /**
   * A track's runs, fastest first: one for each marker file, with its laps and its finished videos.
   * `skipped` lists marker files that couldn't be timed, and why.
   */
  async summary(track, { window = 3 } = {}) {
    const markers = this.folder(track, "csv markers");
    const clips = this.clips(track);
    const runs = [], skipped = [];
    for (const file of list(markers).filter((name) => !name.startsWith(".") && runName(name) !== null).sort(natural)) {
      const name = runName(file), path = join(markers, file);
      try {
        const clip = clips.find((one) => sameName(stem(one), name)) ?? null;
        const facts = clip ? await this.facts(clip) : null;
        const text = decodeText(readFileSync(path));
        // A Premiere sequence goes by the rate in the clip's header, even when that is wrong.
        const override = FrameRate.parse(this.state(track).mismatchFPS);
        const fps = markersAreInClipTime(text) ? facts?.fps : override ?? facts?.claimedFPS ?? facts?.fps;
        if (!fps) throw new Unusable(clip ? "its recording can't be read" : "there's no recording with that name to read the frame rate from");
        const crossings = crossingsIn(text, fps);
        const race = Race.from(crossings, { window });
        const best = race.best();
        const laps = Array.from({ length: race.lapCount }, (_, lap) => race.lap(lap));
        runs.push({
          name, markers: path, clip, fps: fps.label, width: facts?.width ?? 0, height: facts?.height ?? 0, frames: facts?.frames ?? 0,
          laps: laps.map((lap) => race.time(lap)),
          bestLap: race.time(Math.min(...laps)),
          best: best ? { seconds: formatTime(best.total, { plain: true }), firstLap: best.start + 1, lastLap: best.start + race.window, total: best.total } : null,
          coarseStep: coarseStep(crossings, fps) ?? 0,
          crossings: race.bounds.map((bound) => bound / race.unitsPerSecond),
          landscapes: this.#numbered(this.folder(track, "landscape"), name, "mp4"),
          uprights: this.#numbered(this.folder(track, "vertical"), name, "mp4"),
          overlays: this.#numbered(this.folder(track, "overlays"), name, "mov"),
          inClipTime: markersAreInClipTime(text),
        });
      } catch (error) {
        if (!(error instanceof Unusable)) throw error;
        skipped.push({ file, reason: error.message });
      }
    }
    // Fastest first. Runs too short to have a combined time keep their order at the bottom.
    runs.sort((a, b) => (a.best && b.best ? a.best.total - b.best.total : a.best ? -1 : b.best ? 1 : 0));
    return { window, runs, skipped, best: runs.find((run) => run.best) ?? null };
  }

  /** Saves what the marker editor holds: the markers as a file, the rest in dashboard.json. Returns
   *  what went wrong and which Premiere exports were replaced. */
  async saveRun(track, run, { frames, fps, markersChanged, edit, songMarks }) {
    const replaced = [];
    if (markersChanged) {
      if (frames.length < 2) return { problem: "Mark at least two gate crossings before saving: where lap 1 starts, then the end of each lap." };
      const folder = this.folder(track, "csv markers");
      const file = join(folder, `${run}.csv`);
      try {
        mkdirSync(folder, { recursive: true });
        // A second marker file for the same run would be timed as a second run. One exported from
        // Premiere goes to the Trash rather than being written over.
        for (const name of list(folder)) {
          if (!sameName(runName(name) ?? "", run)) continue;
          const old = join(folder, name);
          let ours = false;
          try {
            ours = markersAreInClipTime(decodeText(readFileSync(old)).split(/\r?\n/)[0] ?? "");
          } catch {}
          if (ours && sameName(name, basename(file))) continue;
          await this.trash(old);
          replaced.push(name);
        }
        writeFileSync(`${file}.part`, markerFile(frames, fps));
        renameSync(`${file}.part`, file);
      } catch (error) {
        return { problem: `The markers couldn't be saved: ${error.message}` };
      }
    }
    const kept = {};
    for (const [key, value] of Object.entries(edit ?? {})) if (value !== null && value !== undefined) kept[key] = value;
    this.update(track, (state) => {
      const edits = { ...(state.edits ?? {}) };
      if (Object.keys(kept).length > 0) edits[run] = kept;
      else delete edits[run];
      if (Object.keys(edits).length > 0) state.edits = edits;
      else delete state.edits;
    });
    // A song's marks are kept with the song, for every run that uses it.
    if (songMarks && Object.keys(songMarks).length > 0) {
      const songs = { ...(this.store.songs ?? {}) };
      for (const [song, marks] of Object.entries(songMarks)) songs[song] = { ...(songs[song] ?? {}), marks };
      this.store.songs = songs;
      this.saveStore();
    }
    return { problem: null, replaced };
  }

  // Songs.

  get songLibrary() { return join(this.root, songsFolder); }

  /** Where a song is: in the song library, or failing that in the track's own music folder, which
   *  is where songs were kept before there was a library. */
  songFile(name, track) {
    const shared = join(this.songLibrary, name);
    return existsSync(shared) ? shared : join(this.folder(track, "music"), name);
  }

  /** The songs a run can choose from, and the sound exported from its Premiere sequence, if any. */
  songs(track, run) {
    const sounds = (folder) => list(folder).filter((name) => !name.startsWith(".") && audioExtensions.has(extension(name)));
    const own = sounds(this.folder(track, "music"));
    const clipNames = new Set(this.clips(track).map((clip) => stem(clip).toLowerCase()).concat(run.toLowerCase()));
    const kept = sounds(this.songLibrary);
    // A sound file named after a clip is Premiere's, not a song.
    const onlyHere = own.filter((name) => !clipNames.has(stem(name).toLowerCase()) && !kept.includes(name));
    return {
      songs: [...kept, ...onlyHere].sort(natural),
      premiere: own.sort(natural).find((name) => stem(name).toLowerCase() === run.toLowerCase()) ?? null,
    };
  }

  /** Puts a copy of a sound file in the song library, unless one of that name is there. */
  keepSong(file, name = basename(file)) {
    const destination = join(this.songLibrary, name);
    if (file === destination || existsSync(destination)) return { name, problem: null };
    try {
      mkdirSync(this.songLibrary, { recursive: true });
      copyFileSync(file, destination);
      return { name, problem: null };
    } catch (error) {
      return { name, problem: error.message };
    }
  }

  /** The pilot's marks in each song that has any. */
  get songMarks() {
    return Object.fromEntries(Object.entries(this.store.songs ?? {}).filter(([, notes]) => Array.isArray(notes?.marks)).map(([song, notes]) => [song, notes.marks]));
  }

  /** Marks made before songs kept their own are in the runs they were made in. Each song with none of
   *  its own takes them from every run that used it. */
  gatherSongMarks() {
    const found = {};
    for (const state of Object.values(this.store.tracks ?? {})) {
      for (const edit of Object.values(state.edits ?? {})) {
        if (!edit.song || this.store.songs?.[edit.song]) continue;
        for (const mark of edit.songMarks ?? []) {
          found[edit.song] ??= [];
          if (!found[edit.song].some((one) => Math.abs(one - mark) < 0.02)) found[edit.song].push(mark);
        }
      }
    }
    if (Object.keys(found).length === 0) return;
    const songs = { ...(this.store.songs ?? {}) };
    for (const [song, marks] of Object.entries(found)) songs[song] = { marks: marks.sort((a, b) => a - b) };
    this.store.songs = songs;
    this.saveStore();
  }

  // An event's logo.

  /** An event can have a logo: a picture called Logo in its folder. It goes on the event's videos. */
  logo(event) {
    if (event === "") return null;
    const place = join(this.root, event);
    const name = list(place).find((one) => stem(one).toLowerCase() === "logo" && pictureExtensions.has(extension(one)));
    return name ? join(place, name) : null;
  }

  /** Keeps a copy of a picture as an event's logo, as a PNG, which keeps any see-through background. */
  async setLogo(event, picture) {
    if (event === "") return { problem: "Give these tracks an event of their own first. The logo is kept in the event's folder." };
    const place = join(this.root, event), file = join(place, "Logo.png"), part = join(place, ".logo.part.png");
    const made = await this.ffmpeg.run(["-v", "error", "-y", "-i", picture, "-frames:v", "1", "-pix_fmt", "rgba", part]);
    if (made.code !== 0 || !existsSync(part)) {
      rmSync(part, { force: true });
      return { problem: `${basename(picture)} can't be read as a picture.` };
    }
    const old = this.logo(event);
    if (old && old !== picture) await this.trash(old).catch(() => {});
    renameSync(part, file);
    return { problem: null };
  }

  async removeLogo(event) {
    const old = this.logo(event);
    if (old) await this.trash(old);
  }

  // The track in 3D.

  /** Where a track's own view is kept, once the pilot has made one. */
  trackViewFile(track) { return join(this.place(track), "Track view.json"); }

  /** The pilot's own view of a track, as it is in the file. Null when there is none. */
  ownTrackView(track) { return this.#read(this.trackViewFile(track)); }

  saveTrackView(track, view) { this.#write(this.trackViewFile(track), view); }

  // Bookends.

  /**
   * What goes before and after an event's videos: a clip or a picture in the event's folder, a
   * pair for each shape of video, so that a title card made for 16:9 isn't left small in a 9:16
   * one. They are called Before and After for 16:9, and Before 9x16 and After 9x16 for 9:16. A
   * picture is held for a few seconds, which the pilot can set.
   */
  bookends(event) {
    const none = { landscape: { before: null, after: null }, upright: { before: null, after: null } };
    if (event === "") return none;
    const place = join(this.root, event), names = list(place);
    const held = this.extras.events?.[event]?.bookendSeconds ?? {};
    for (const shape of Object.keys(none)) {
      for (const which of ["before", "after"]) {
        const wanted = bookendName(shape, which).toLowerCase();
        const name = names.find((one) => stem(one).toLowerCase() === wanted && (videoExtensions.has(extension(one)) || bookendPictures.has(extension(one))));
        if (!name) continue;
        const kind = bookendPictures.has(extension(name)) ? "picture" : "clip";
        none[shape][which] = { file: join(place, name), name, kind, seconds: kind === "picture" ? Math.min(30, Math.max(0.5, Number(held[bookendKey(shape, which)]) || 3)) : null };
      }
    }
    return none;
  }

  /** Keeps a copy of a clip or a picture as what goes before or after an event's videos of one
   *  shape. The one it replaces goes to the Trash. */
  async setBookend(event, shape, which, file) {
    if (event === "") return { problem: "Give these tracks an event of their own first. What goes before and after is kept in the event's folder." };
    const kind = extension(file);
    if (!videoExtensions.has(kind) && !bookendPictures.has(kind)) return { problem: `${basename(file)} isn't a video clip or a picture the app can use.` };
    const place = join(this.root, event), to = join(place, `${bookendName(shape, which)}.${kind}`);
    try {
      const old = this.bookends(event)[shape][which];
      if (old && old.file !== file) await this.trash(old.file);
      if (file !== to) copyFileSync(file, to);
      return { problem: null };
    } catch (error) {
      return { problem: `${basename(file)} couldn't be kept: ${error.message}` };
    }
  }

  async removeBookend(event, shape, which) {
    const old = this.bookends(event)[shape][which];
    if (old) await this.trash(old.file);
  }

  /** How long a picture before or after is held, in seconds. */
  setBookendSeconds(event, shape, which, seconds) {
    if (event === "") return;
    const kept = { ...(this.extras.events?.[event] ?? {}) };
    kept.bookendSeconds = { ...(kept.bookendSeconds ?? {}), [bookendKey(shape, which)]: Math.min(30, Math.max(0.5, Number(seconds) || 3)) };
    this.extras.events = { ...(this.extras.events ?? {}), [event]: kept };
    this.saveExtras();
  }

  // Adding recordings.

  /**
   * Copies recordings into a track, one after another. The originals are left alone. A folder
   * stands for the recordings directly inside it. A file that is already there, with the same name
   * and size, is left. A different one with the same name is kept and the new one gets a number.
   * `onProgress` hears how far along the whole lot is.
   */
  async addClips(track, picked, onProgress = null) {
    const files = [];
    for (const path of picked) {
      if (isFolder(path)) files.push(...list(path).filter((name) => !name.startsWith(".")).sort(natural).map((name) => join(path, name)));
      else files.push(path);
    }
    const clips = files.filter((file) => videoExtensions.has(extension(file)));
    const left = files.length - clips.length;
    if (clips.length === 0) return { added: [], present: [], failed: [], left, problem: "None of those are video recordings." };
    const destination = this.folder(track, "Raw files");
    mkdirSync(destination, { recursive: true });
    const size = (file) => {
      try {
        return statSync(file).size;
      } catch {
        return 0;
      }
    };
    const total = clips.reduce((sum, file) => sum + size(file), 0);
    let free = null;
    try {
      const disk = statfsSync(destination);
      free = Number(disk.bavail) * Number(disk.bsize);
    } catch {}
    if (free !== null && free < total + 200_000_000) {
      return { added: [], present: [], failed: [], left, problem: `There isn't room for ${clips.length === 1 ? "that clip" : "those clips"}: ${bytes(total)} is needed and ${bytes(free)} is free.` };
    }
    const added = [], present = [], failed = [];
    let done = 0;
    for (const file of clips) {
      let target = join(destination, basename(file));
      if (existsSync(target)) {
        if (file === target || size(target) === size(file)) {
          present.push(basename(file));
          done += size(file);
          onProgress?.(total > 0 ? done / total : 1);
          continue;
        }
        let number = 2;
        do {
          target = join(destination, `${stem(file)} ${number}${extname(file)}`);
          number += 1;
        } while (existsSync(target));
      }
      // Written under a hidden name first, so a half-copied clip is never taken for a whole one.
      const part = join(destination, `.${basename(target)}.part`);
      try {
        await new Promise((resolve, reject) => {
          const from = createReadStream(file), to = createWriteStream(part);
          from.on("data", (chunk) => {
            done += chunk.length;
            onProgress?.(total > 0 ? done / total : 1);
          });
          from.on("error", reject);
          to.on("error", reject);
          to.on("finish", resolve);
          from.pipe(to);
        });
        // Keep the recording's own date, which is when it was flown.
        try {
          const flown = statSync(file);
          utimesSync(part, flown.atime, flown.mtime);
        } catch {}
        renameSync(part, target);
        added.push(basename(target));
      } catch (error) {
        rmSync(part, { force: true });
        failed.push(`${basename(file)} couldn't be added: ${error.message}`);
      }
    }
    return { added, present, failed, left, problem: null, folder: destination };
  }

  // Deleting.

  /** Whether a folder has anything in it worth losing: any file at all, however deep, that isn't
   *  hidden. One file can be left out of the count, which is how an event's logo doesn't make its
   *  folder count as full. */
  holdsAnything(folder, spared = null) {
    for (const name of list(folder)) {
      if (name.startsWith(".")) continue;
      const path = join(folder, name);
      if (path === spared) continue;
      if (!isFolder(path) || this.holdsAnything(path, spared)) return true;
    }
    return false;
  }

  /** What some tracks hold, in words, for the question before they go. */
  holdings(tracks) {
    const count = (track, part, kinds) => list(this.folder(track, part)).filter((name) => !name.startsWith(".") && kinds.has(extension(name))).length;
    const sizeOf = (folder) => list(folder).reduce((sum, name) => {
      const path = join(folder, name);
      try {
        const facts = statSync(path);
        return sum + (facts.isDirectory() ? sizeOf(path) : facts.size);
      } catch {
        return sum;
      }
    }, 0);
    let clips = 0, runs = 0, videos = 0, bytes = 0;
    for (const track of tracks) {
      clips += count(track, "Raw files", videoExtensions);
      runs += count(track, "csv markers", new Set(["csv", "txt"]));
      videos += count(track, "landscape", new Set(["mp4"])) + count(track, "vertical", new Set(["mp4"]));
      bytes += sizeOf(this.place(track));
    }
    return { clips, runs, videos, bytes };
  }

  #tuck(value, folder) {
    if (value) writeFileSync(join(folder, keepsake), JSON.stringify(value));
  }

  #takeBack(folder) {
    const file = join(folder, keepsake);
    const kept = this.#read(file);
    if (kept) rmSync(file, { force: true });
    return kept;
  }

  /** Moves a track to the Trash, with what the app remembers about it tucked inside in case it is
   *  ever put back. One of the season's tracks is not made again behind the pilot's back. */
  async removeTrack(track) {
    const place = this.place(track);
    const ofSeason = this.seasonTrack(track);
    this.#tuck(this.store.tracks[track], place);
    try {
      await this.trash(place);
    } catch (error) {
      rmSync(join(place, keepsake), { force: true });
      return { problem: `${trackName(track)}: ${error.message}` };
    }
    delete this.store.tracks[track];
    if (ofSeason) {
      const event = eventFolder(track);
      const kept = this.store.events[event];
      kept.skipped = [...new Set([...(kept.skipped ?? []), ofSeason.number])].sort((a, b) => a - b);
    }
    this.saveStore();
    this.findTracks();
    return { problem: null };
  }

  /** Moves an event to the Trash. It has to be empty of tracks first. */
  async removeEvent(event) {
    const one = this.events.find((found) => found.folder === event);
    if (!one || event === "") return { problem: "There is no such event." };
    if (one.tracks.length > 0) return { problem: `${this.details(event).name} still has ${one.tracks.length === 1 ? "a track" : `${one.tracks.length} tracks`} in it. Delete ${one.tracks.length === 1 ? "that" : "those"} first, then the event.` };
    const place = join(this.root, event);
    try {
      if (existsSync(place)) {
        this.#tuck(this.store.events?.[event], place);
        await this.trash(place);
      }
    } catch (error) {
      rmSync(join(place, keepsake), { force: true });
      return { problem: `${event}: ${error.message}` };
    }
    if (this.store.events) delete this.store.events[event];
    this.saveStore();
    this.findTracks();
    return { problem: null };
  }

  // Entry forms.

  /** Reads a track's form, once, from its address. A short link is followed to the form's own
   *  address, which is the one that is kept. */
  async form(track, parse) {
    const address = this.state(track).formURL.trim();
    if (address === "") return { form: null, problem: null };
    if (this.forms.has(address)) return { form: this.forms.get(address), problem: null };
    try {
      const answer = await this.fetch(address, { signal: AbortSignal.timeout(20000) });
      const form = parse(await answer.text());
      if (!form) return { form: null, problem: "That page isn't a Google Form the app can read." };
      this.forms.set(address, form);
      const final = new URL(answer.url);
      if (final.host === "docs.google.com" && final.pathname.includes("/forms/") && new URL(address).host !== final.host) {
        const own = `https://docs.google.com${final.pathname}`;
        this.forms.set(own, form);
        this.update(track, (state) => { state.formURL = own; });
      }
      return { form, problem: null };
    } catch (error) {
      return { form: null, problem: `The form couldn't be read: ${error.message}` };
    }
  }

  recordSubmission(track, { run, time, link }, now = new Date()) {
    this.update(track, (state) => { state.submissions = [...state.submissions, { run, time, link, date: series.stamp(now) }]; });
  }
}
