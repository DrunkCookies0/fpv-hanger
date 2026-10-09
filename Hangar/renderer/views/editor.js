// The marker editor. One clip: its picture, frame by frame, the gate crossings marked on it, the
// stretch its finished videos show, and the song laid under them. It takes over the whole window.

import { app, ask, hangar, render, loadTrack, trackName } from "../core.js";
import { h, fill, redraw, icon, label, primary, secondary } from "../ui.js";
import { menu, confirm, sheetIsOpen } from "../sheets.js";
import { keys, mac, fileBrowser } from "../words.js";
import { lookFor, drawCornerTimer, picture, typefaceReady } from "../timer.js";
import { SongSound } from "../sound.js";
import { Race } from "../../shared/timing.js";
import { clock, lapTime } from "../../shared/panel.js";

/** How long before lap 1 and after the finish a finished video runs when the stretch is left to the app. */
const leadIn = 3, hold = 8;
const span = (seconds) => `${Math.abs(seconds).toFixed(1)} s`;
/** A time into a song such as 0:44.16. */
export const songClock = (seconds) => {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  return `${Math.trunc(hundredths / 6000)}:${String(Math.trunc(hundredths / 100) % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
};
const thousandth = (seconds) => Math.round(seconds * 1000) / 1000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const face = () => getComputedStyle(document.body).getPropertyValue("--face") || "sans-serif";
const colours = { accent: "#ffd60a", onAccent: "#0d0d0f", bass: "#f54d33", drop: "#5cccff", mark: "#ff66bd", faint: "rgba(255,255,255,0.32)", card: "22,25,30" };

/** Between two times in a song: the highest the sound gets, how loud it is and how loud its bass
 *  is, each from 0 to 1 and each no more than the one before. Null outside the song. */
export function levels(wave, start, end) {
  // A stretch of more than a few hundredths of a second is read from the coarse copy.
  const broad = (end - start) * 1000 >= 60;
  const rate = broad ? 50 : 1000, readings = broad ? wave.far : wave.close;
  const first = Math.max(0, Math.trunc(start * rate)), last = Math.min(readings.peak.length, Math.max(Math.trunc(start * rate) + 1, Math.ceil(end * rate)));
  if (!(first < last)) return null;
  let peak = 0, power = 0, bassPower = 0;
  for (let index = first; index < last; index += 1) {
    peak = Math.max(peak, readings.peak[index]);
    power += readings.power[index];
    bassPower += readings.bassPower[index];
  }
  const body = Math.min(peak, Math.sqrt(power / (last - first)) * wave.gain);
  return { peak, body, bass: Math.min(body, Math.sqrt(bassPower / (last - first)) * wave.gain) };
}

/** The tempo the way it is said: "174 BPM", or "127.3 BPM" for one that isn't a round number. */
const tempoLabel = (tempo) => {
  const rounded = Math.round(tempo * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} BPM` : `${rounded.toFixed(1)} BPM`;
};

const lanes = { lapsTop: 26, lapsHeight: 30, videoTop: 60, videoHeight: 18, musicTop: 82, musicHeight: 42, height: 124 };

export class Editor {
  constructor(target, data) {
    this.target = target;
    /** How many laps in a row are judged. */
    this.window = Math.max(1, data.window ?? 3);
    this.phase = "loading";
    this.problem = "";
    /** The playhead, as a frame of the clip. */
    this.frame = 0;
    this.playing = false;
    this.speed = 1;
    /** Gate crossings as frames of the clip, in order. The first starts lap 1. */
    this.markers = [];
    /** The pilot's marks in each song, as they were when the editor opened and as they are changed here. */
    this.marksBySong = { ...data.songMarks };
    /** Songs whose marks were changed here and then left for another song. */
    this.touched = {};
    // The song's own marks are the ones that count: they may have been changed in another run since this one was saved.
    const opened = { videoStart: null, videoEnd: null, song: null, songStart: null, musicIn: null, musicOut: null, songMarks: null, ...data.edit };
    if (opened.song && this.marksBySong[opened.song]) opened.songMarks = this.marksBySong[opened.song].length > 0 ? [...this.marksBySong[opened.song]] : null;
    this.edit = opened;
    this.savedEdit = structuredClone(opened);
    this.savedMarkers = [];
    this.songs = data.songs ?? [];
    /** The chosen song, once it is ready to play: null until then. */
    this.sound = null;
    this.songLength = 0;
    this.wave = null;
    /** What the app hears in the chosen song. Null until it has listened. */
    this.analysis = null;
    this.listening = false;
    this.soundWave = null;
    this.snapToBeat = app.state.snapToBeat;
    this.showsTimer = app.state.showsTimer;
    /** The stretch of the clip the timeline is showing, in seconds. */
    this.visible = { from: 0, to: 1 };
    this.message = null;
    this.saved = false;
    this.fps = { num: 60, den: 1, value: 60, label: "60" };
    this.frameCount = 1;
    this.history = [];
    this.seeking = false;
    this.wanted = null;
    this.look = lookFor(target.track);
    this.logo = null;
    this.drag = null;
    this.slid = false;
    this.pointer = null;
    this.onKey = (event) => this.key(event);
    this.onResize = () => this.drawAll();
    this.build();
    this.load();
  }

  // What follows from what is marked.

  get duration() { return this.frameCount / this.fps.value; }
  seconds(frame) { return frame / this.fps.value; }
  frameAt(seconds) { return Math.min(Math.max(Math.trunc(seconds * this.fps.value + 0.001), 0), this.frameCount - 1); }
  get markersChanged() { return !same(this.markers, this.savedMarkers); }
  get dirty() { return this.markersChanged || !same(this.edit, this.savedEdit); }
  /** Marker times in milliseconds, worked out the way they are read back from the file. */
  get bounds() { return this.markers.map((marker) => Math.round(((marker * this.fps.den) / this.fps.num) * 1000)); }
  get laps() {
    const bounds = this.bounds;
    return bounds.slice(1).map((bound, index) => bound - bounds[index]);
  }
  /** The fastest `window` laps in a row: the first of them, counting from 0, and their total. */
  get best() {
    const bounds = this.bounds;
    let result = null;
    for (let first = 0; first + this.window < bounds.length; first += 1) {
      const total = bounds[first + this.window] - bounds[first];
      if (!result || total < result.total) result = { first, total };
    }
    return result;
  }
  /** Where a finished video starts and ends when it is left to the app. */
  get automaticStretch() {
    if (this.markers.length < 2) return null;
    return { from: Math.max(0, this.seconds(this.markers[0]) - leadIn), to: this.seconds(this.markers.at(-1)) + hold };
  }
  /** The stretch of the clip the finished videos will cover. */
  get stretch() {
    const automatic = this.automaticStretch;
    const start = this.edit.videoStart ?? automatic?.from ?? null, end = this.edit.videoEnd ?? automatic?.to ?? null;
    if (start === null || end === null) return null;
    const upper = Math.min(end, this.duration);
    return upper > start ? { from: start, to: upper } : null;
  }
  /** Where the chosen song lies against the clip. */
  get songSpan() {
    if (!this.sound || !(this.songLength > 0) || this.edit.songStart === null) return null;
    return { from: this.edit.songStart, to: this.edit.songStart + this.songLength };
  }
  /** The part of the clip the music is heard over: where the song lies, cut to the finished video
   *  and to the start and end set for the music, if any. */
  get musicHeard() {
    const song = this.songSpan;
    if (!song) return null;
    let lower = Math.max(song.from, 0), upper = Math.min(song.to, this.duration);
    const stretch = this.stretch;
    if (stretch) {
      lower = Math.max(lower, stretch.from);
      upper = Math.min(upper, stretch.to);
    }
    if (this.edit.musicIn !== null) lower = Math.max(lower, this.edit.musicIn);
    if (this.edit.musicOut !== null) upper = Math.min(upper, this.edit.musicOut);
    return upper > lower ? { from: lower, to: upper } : null;
  }
  get songMarks() { return this.edit.songMarks ?? []; }
  get spots() { return this.analysis?.spots ?? []; }
  /** The beat nearest a time in the song, when the song keeps steady time. */
  beatNear(time) {
    const { firstBeat, beatLength } = this.analysis ?? {};
    if (!(firstBeat >= 0) || !(beatLength > 0)) return null;
    return firstBeat + Math.max(0, Math.round((time - firstBeat) / beatLength)) * beatLength;
  }
  /** The time into the song that plays at a clip time, as the song lies now. */
  songTime(clipTime) {
    const song = this.songSpan;
    return song ? clipTime - song.from : null;
  }
  /** The gate a moment in the song falls on as the song lies now, counting the start gate as 0. */
  gateUnder(songTime) {
    const song = this.songSpan;
    if (!song) return null;
    const index = this.markers.findIndex((marker) => Math.abs(this.seconds(marker) - (song.from + songTime)) < 0.5 / this.fps.value);
    return index < 0 ? null : index;
  }
  /** What a finished video would be missing with a moment in the song put on the start gate. */
  shortfall(songTime) {
    const stretch = this.stretch;
    if (this.markers.length === 0 || !stretch) return null;
    const start = this.seconds(this.markers[0]) - songTime;
    if (start > stretch.from + 0.05) return `The song would only come in ${span(start - stretch.from)} after the video starts.`;
    if (start + this.songLength < stretch.to - 0.05) return `The song would run out ${span(stretch.to - start - this.songLength)} before the video ends.`;
    return null;
  }
  /** The marks to keep with each song when this is saved: the chosen song's as they are now, and
   *  those of any song marked earlier in this sitting. */
  get marksToKeep() {
    const all = { ...this.touched };
    const song = this.edit.song;
    if (song && (!same(this.songMarks, this.marksBySong[song] ?? []) || this.touched[song])) all[song] = this.songMarks;
    return all;
  }

  // Opening the clip.

  async load() {
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    // Whether this computer's player can show the recording's own pictures decides which copy is made.
    let opened = await ask("openClip", this.target.clip, { plain: false });
    if (!opened.problem && opened.kind === "wrapped" && !(await this.plays(opened))) {
      this.note = "Making a copy this computer can play…";
      this.drawBody();
      const heard = hangar.hear("copy", (fraction) => {
        this.note = `Making a copy this computer can play… ${Math.floor(fraction * 100)}%`;
        if (this.phase === "loading") this.drawBody();
      });
      opened = await ask("openClip", this.target.clip, { plain: true });
      heard();
      if (!opened.problem && !(await this.plays(opened))) opened = { problem: `${this.target.clip.split(/[\\/]/).pop()} can't be played.` };
    }
    if (app.editor !== this) return;
    if (opened.problem) {
      this.phase = "failed";
      this.problem = opened.problem;
      return this.drawBody();
    }
    const facts = opened.facts;
    this.fps = facts.fps;
    this.frameCount = Math.max(1, facts.frames);
    this.markers = [...new Set(this.target.crossings.map((crossing) => Math.min(Math.max(Math.round(crossing * this.fps.value), 0), this.frameCount - 1)))].sort((a, b) => a - b);
    this.savedMarkers = [...this.markers];
    this.visible = { from: 0, to: this.duration };
    this.frame = this.markers.length > 0 ? Math.max(0, this.markers[0] - Math.trunc(2 * this.fps.value)) : 0;
    [this.logo] = await Promise.all([picture(this.look.logoAddress), typefaceReady()]);
    await this.loadSong();
    if (app.editor !== this) return;
    this.showRun();
    this.phase = "ready";
    this.drawBody();
    this.show(this.frame, false);
  }

  /** Puts a copy of the clip in the player and says whether it can be played. */
  plays(opened) {
    return new Promise((done) => {
      const video = this.video;
      const finish = (ok) => {
        video.removeEventListener("loadeddata", good);
        video.removeEventListener("error", bad);
        clearTimeout(timer);
        done(ok);
      };
      const good = () => finish(video.videoWidth > 0);
      const bad = () => finish(false);
      const timer = setTimeout(() => finish(video.readyState >= 2 && video.videoWidth > 0), 15000);
      video.addEventListener("loadeddata", good);
      video.addEventListener("error", bad);
      video.src = opened.url;
      video.load();
    });
  }

  close() {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.closeSoundWave();
    this.sound?.stop();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    app.editor = null;
    fill(document.getElementById("editor"));
    document.getElementById("stage").removeAttribute("inert");
    loadTrack(this.target.track).then(render);
    render();
  }

  // Moving around.

  /** Moves the playhead to a frame and shows exactly that frame. */
  show(index, follow = true) {
    const frame = Math.min(Math.max(index, 0), this.frameCount - 1);
    this.frame = frame;
    if (follow) this.keepInView(false);
    this.drawMoved();
    // Holding an arrow key asks faster than the player can seek: remember the latest and go there next.
    if (this.seeking) {
      this.wanted = frame;
      return;
    }
    this.seeking = true;
    const video = this.video;
    const landed = () => {
      video.removeEventListener("seeked", landed);
      this.seeking = false;
      const next = this.wanted;
      this.wanted = null;
      if (next !== null && next !== frame) this.show(next, false);
    };
    video.addEventListener("seeked", landed);
    // Aim at the middle of the frame, so a timestamp a hair off the grid can't land on its neighbour.
    video.currentTime = (frame + 0.5) / this.fps.value;
  }
  /** True once a seek has landed and nothing is waiting behind it. */
  get settled() { return !this.seeking && this.wanted === null; }

  step(frames) {
    if (this.phase !== "ready") return;
    this.pause();
    this.show(this.frame + frames);
  }

  /** To the marker before or after the playhead. */
  jump(direction) {
    if (this.phase !== "ready") return;
    this.pause();
    const next = direction < 0 ? this.markers.findLast((marker) => marker < this.frame) : this.markers.find((marker) => marker > this.frame);
    if (next !== undefined) this.show(next);
  }

  togglePlay() {
    if (this.phase !== "ready") return;
    if (this.playing) return this.pause();
    if (this.frame >= this.frameCount - 1) this.show(0);
    this.playing = true;
    const video = this.video;
    video.playbackRate = this.speed;
    video.play().catch(() => {});
    this.startMusic(this.seconds(this.frame));
    const each = (_now, shown) => {
      if (!this.playing || app.editor !== this) return;
      this.tick(shown.mediaTime);
      video.requestVideoFrameCallback(each);
    };
    video.requestVideoFrameCallback(each);
    video.onended = () => {
      // It ran off the end of the clip.
      if (!this.playing) return;
      this.playing = false;
      this.sound?.stop();
      this.show(this.frameCount - 1);
      this.drawTransport();
    };
    this.drawTransport();
  }

  /** Starts the song where it belongs for a moment of the clip: only between where the music comes
   *  in and where it stops. */
  startMusic(clipTime) {
    const song = this.songSpan;
    if (!song) return;
    const from = Math.max(0, song.from, this.edit.musicIn ?? -Infinity);
    const until = Math.min(song.to, this.duration, this.edit.musicOut ?? Infinity);
    if (!(until - from > 0.05) || clipTime >= until) return;
    const start = Math.max(clipTime, from);
    this.sound.play({ from: start - song.from, until: until - song.from, wait: (start - clipTime) / this.speed, speed: this.speed });
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.video.pause();
    this.sound?.stop();
    // Park on the frame that is showing.
    this.show(this.showing());
    this.drawTransport();
  }

  /** The frame on the screen while the clip plays: the last one the player said it was putting
   *  up, or the one its clock has reached, whichever is later. */
  showing() { return Math.max(this.frame, this.frameAt(this.video.currentTime)); }

  tick(seconds) {
    if (!this.playing) return;
    const now = this.frameAt(seconds);
    // The song follows the picture, not the other way about.
    const song = this.songSpan;
    if (song && this.sound.playing) this.sound.follow(seconds - song.from, { until: Math.min(song.to, this.duration, this.edit.musicOut ?? Infinity) - song.from, speed: this.speed });
    if (now !== this.frame) {
      this.frame = now;
      this.keepInView(true);
      this.drawMoved();
    }
  }

  setSpeed(speed) {
    this.speed = speed;
    if (this.playing) {
      this.video.playbackRate = speed;
      this.sound?.stop();
      this.startMusic(this.video.currentTime);
    }
    this.drawTransport();
  }

  keepInView(paging) {
    const now = this.seconds(this.frame), width = this.visible.to - this.visible.from;
    if (now >= this.visible.from && now <= this.visible.to) return;
    const lower = Math.min(Math.max(0, paging ? now - width * 0.05 : now - width / 2), Math.max(0, this.duration - width));
    this.visible = { from: lower, to: lower + width };
  }

  zoom(factor) {
    const width = Math.min(this.duration, Math.max(0.5, (this.visible.to - this.visible.from) * factor));
    const lower = Math.min(Math.max(0, this.seconds(this.frame) - width / 2), Math.max(0, this.duration - width));
    this.visible = { from: lower, to: lower + width };
    this.drawLanes();
  }

  showAll() {
    this.visible = { from: 0, to: this.duration };
    this.drawLanes();
  }

  /** Fits the timeline to the stretch the finished videos cover. */
  showRun() {
    const stretch = this.stretch;
    if (!stretch) return;
    const margin = (stretch.to - stretch.from) * 0.06;
    const lower = Math.max(0, stretch.from - margin);
    this.visible = { from: lower, to: Math.max(Math.min(this.duration, stretch.to + margin), lower + 0.5) };
    this.drawLanes();
  }

  // Changing things.

  /** Notes how things stand, for Undo, before something changes. */
  remember() {
    this.history.push({ markers: [...this.markers], edit: structuredClone(this.edit) });
    if (this.history.length > 200) this.history.shift();
    this.message = null;
    this.saved = false;
  }

  async undo() {
    const last = this.history.pop();
    if (!last) return;
    const songChanged = last.edit.song !== this.edit.song;
    this.markers = last.markers;
    this.edit = last.edit;
    if (songChanged) await this.loadSong();
    this.restartMusic();
    this.drawChanged();
  }

  beep() { ask("beep"); }

  /** Marks a gate crossing on the frame that is showing. Pressed during playback, it takes the frame of that moment. */
  addMarker() {
    if (this.phase !== "ready") return;
    const here = this.playing ? this.showing() : this.frame;
    if (this.markers.includes(here)) return;
    this.remember();
    this.markers = [...this.markers, here].sort((a, b) => a - b);
    this.drawChanged();
  }

  /** Removes a marker: the one given, or the one under the playhead. */
  removeMarker(marker = this.frame) {
    if (!this.markers.includes(marker)) return;
    this.remember();
    this.markers = this.markers.filter((one) => one !== marker);
    this.drawChanged();
  }

  /** Removes every marker. Undo brings them back. */
  removeAllMarkers() {
    if (this.phase !== "ready" || this.markers.length === 0) return;
    this.remember();
    this.markers = [];
    this.drawChanged();
  }

  /** Moves the marker under the playhead one frame, taking the playhead with it. */
  nudgeMarker(step) {
    const index = this.markers.indexOf(this.frame);
    if (this.playing || index < 0) return;
    const moved = this.frame + step;
    if (moved < 0 || moved >= this.frameCount || this.markers.includes(moved)) return;
    this.remember();
    this.markers[index] = moved;
    this.markers.sort((a, b) => a - b);
    this.show(moved);
    this.drawChanged();
  }

  setVideoStart() {
    const now = this.seconds(this.frame);
    const end = this.edit.videoEnd ?? this.automaticStretch?.to ?? null;
    if (end !== null && now >= end) return this.beep();
    this.remember();
    this.edit.videoStart = now;
    this.drawChanged();
  }

  setVideoEnd() {
    // Up to the end of the frame that is showing.
    const now = this.seconds(this.frame + 1);
    const start = this.edit.videoStart ?? this.automaticStretch?.from ?? null;
    if (start !== null && now <= start) return this.beep();
    this.remember();
    this.edit.videoEnd = now;
    this.drawChanged();
  }

  automaticVideo() {
    if (this.edit.videoStart === null && this.edit.videoEnd === null) return;
    this.remember();
    this.edit.videoStart = this.edit.videoEnd = null;
    this.drawChanged();
  }

  // Music.

  /** Null is no music. Anything else is a song. */
  async choose(name) {
    if (name === this.edit.song) return;
    this.pause();
    this.remember();
    // Marks belong to the song they were made in: this song's are put by, and the new one's brought out.
    const old = this.edit.song;
    if (old && (!same(this.songMarks, this.marksBySong[old] ?? []) || this.touched[old])) this.touched[old] = this.songMarks;
    this.edit.song = name;
    const kept = name ? this.touched[name] ?? this.marksBySong[name] ?? [] : [];
    this.edit.songMarks = kept.length > 0 ? [...kept] : null;
    // A song that hasn't been placed yet starts with the video.
    if (name && this.edit.songStart === null) this.edit.songStart = this.stretch?.from ?? 0;
    const loading = this.loadSong();
    this.drawChanged();
    await loading;
    this.drawChanged();
  }

  async loadSong() {
    this.closeSoundWave();
    this.sound?.stop();
    this.sound = null;
    this.songLength = 0;
    this.wave = null;
    this.analysis = null;
    this.listening = false;
    const name = this.edit.song;
    if (!name) return;
    const read = await ask("songSound", this.target.track, name);
    if (this.edit.song !== name || app.editor !== this) return;
    if (read.problem) {
      this.message = read.problem;
      return this.drawHead();
    }
    this.sound = new SongSound(read);
    this.songLength = read.length;
    this.wave = read.wave;
    this.listening = true;
    ask("songAnalysis", this.target.track, name).then((heard) => {
      if (this.edit.song !== name || app.editor !== this) return;
      this.analysis = heard;
      this.listening = false;
      this.drawChanged();
      this.soundWave?.draw();
    });
    const listed = await ask("songs", this.target.track, this.target.name);
    this.songs = listed.songs;
  }

  /** After the song has moved under a clip that is playing. */
  restartMusic() {
    if (!this.playing) return;
    this.sound?.stop();
    this.startMusic(this.video.currentTime);
  }

  /** Puts the start of the song at a clip time. */
  placeSong(start) {
    if (!this.sound) return;
    this.pause();
    this.remember();
    this.edit.songStart = start;
    this.drawChanged();
  }

  /** Starts the music at a clip time, or at the playhead: before that the video is silent. */
  setMusicIn(time = this.seconds(this.frame)) {
    if (!this.sound) return;
    if (this.edit.musicOut !== null && time >= this.edit.musicOut) return this.beep();
    this.pause();
    this.remember();
    this.edit.musicIn = time;
    this.drawChanged();
  }

  /** Stops the music at a clip time, or at the end of the frame that is showing. */
  setMusicOut(time = this.seconds(this.frame + 1)) {
    if (!this.sound) return;
    if (this.edit.musicIn !== null && time <= this.edit.musicIn) return this.beep();
    this.pause();
    this.remember();
    this.edit.musicOut = time;
    this.drawChanged();
  }

  /** Lets the music run for the whole video again. */
  wholeMusic() {
    if (this.edit.musicIn === null && this.edit.musicOut === null) return;
    this.pause();
    this.remember();
    this.edit.musicIn = this.edit.musicOut = null;
    this.drawChanged();
  }

  /** Marks a point in the song, given as a time into it. Returns the mark, or null when there is one there already. */
  addSongMark(time) {
    const mark = thousandth(time);
    if (!this.sound || mark < 0 || mark > this.songLength || this.songMarks.some((one) => Math.abs(one - mark) < 0.02)) {
      this.beep();
      return null;
    }
    this.remember();
    this.edit.songMarks = [...this.songMarks, mark].sort((a, b) => a - b);
    this.drawChanged();
    return mark;
  }

  /** Marks the point in the song that plays at a clip time, or at the playhead. */
  addSongMarkHere(clipTime = this.seconds(this.frame)) {
    const song = this.songSpan;
    if (song) this.addSongMark(clipTime - song.from);
  }

  /** The mark at a time in the song, to within a thousandth of a second or so. */
  songMarkAt(time) { return this.songMarks.find((mark) => Math.abs(mark - time) < 0.0015) ?? null; }

  /** While a mark is being dragged along the sound wave: moves it and returns where it now is. */
  dragSongMark(mark, time) {
    const moved = thousandth(Math.min(Math.max(0, time), this.songLength));
    if (moved === mark || !this.songMarks.includes(mark) || this.songMarks.some((one) => one !== mark && Math.abs(one - moved) < 0.02)) return mark;
    this.edit.songMarks = this.songMarks.map((one) => (one === mark ? moved : one)).sort((a, b) => a - b);
    return moved;
  }

  /** A time in the song, moved onto a mark or a drop that is within reach of it, or onto a beat when
   *  catching on the beat is switched on. `except` is a mark to leave out: the one being moved. */
  caught(time, reach, except = null) {
    let best = time, nearest = reach;
    for (const point of [...this.songMarks.filter((mark) => mark !== except), ...this.spots.map((spot) => spot.time)]) {
      if (Math.abs(point - time) < nearest) {
        nearest = Math.abs(point - time);
        best = point;
      }
    }
    if (best === time && this.snapToBeat) {
      const beat = this.beatNear(time);
      if (beat !== null && Math.abs(beat - time) < reach) best = beat;
    }
    return Math.min(Math.max(0, best), this.songLength);
  }

  /** Slides the song so a moment in it falls on a gate crossing, and parks the playhead a few
   *  seconds before the gate, ready to hear how it lands. Gate 0 is the start gate. */
  put(songTime, gate = 0) {
    if (!this.sound || gate < 0 || gate >= this.markers.length) return this.beep();
    const crossing = this.seconds(this.markers[gate]);
    this.lineUp(songTime, crossing);
    this.show(this.frameAt(Math.max(this.stretch?.from ?? 0, crossing - leadIn)));
  }

  removeSongMark(mark) {
    if (!this.songMarks.includes(mark)) return;
    this.remember();
    const left = this.songMarks.filter((one) => one !== mark);
    this.edit.songMarks = left.length > 0 ? left : null;
    this.drawChanged();
  }

  removeAllSongMarks() {
    if (this.songMarks.length === 0) return;
    this.remember();
    this.edit.songMarks = null;
    this.drawChanged();
  }

  /** Slides the song so that one of its marks falls on a clip time. */
  lineUp(mark, time) { this.placeSong(thousandth(time - mark)); }

  /** Asks for an audio file, adds it to the song library and makes it the run's song. */
  async importSong() {
    this.pause();
    const added = await ask("chooseSong");
    if (added.problem) {
      this.message = added.problem;
      return this.drawHead();
    }
    if (!added.name) return;
    this.songs = (await ask("songs", this.target.track, this.target.name)).songs;
    await this.choose(added.name);
    this.drawChanged();
  }

  // The sound wave window.

  async openSoundWave(time = null) {
    if (!this.sound || !(this.songLength > 0) || this.soundWave) return;
    this.pause();
    const under = this.songTime(this.seconds(this.frame)) ?? -1;
    const biggest = this.spots.reduce((best, spot) => (!best || spot.strength > best.strength ? spot : best), null);
    const start = time ?? (under >= 0 && under <= this.songLength ? under : biggest?.time ?? 0);
    const { SoundWave } = await import("./soundwave.js");
    this.soundWave = new SoundWave(this, Math.min(Math.max(0, start), this.songLength));
  }

  closeSoundWave() {
    this.soundWave?.close();
    this.soundWave = null;
  }

  // The marker commands, from the keys and from the Markers menu. While the song's sound wave is
  // open they are about the marks in the song. Otherwise they are about the clip's gate crossings.
  menu(what) {
    if (this.phase !== "ready" || sheetIsOpen()) return;
    const wave = this.soundWave;
    if (what === "mark") wave ? wave.mark() : this.addMarker();
    else if (what === "next") wave ? wave.jump(1) : this.jump(1);
    else if (what === "previous") wave ? wave.jump(-1) : this.jump(-1);
    else if (what === "clear") wave ? wave.removeMarkHere() : this.removeMarker();
    else if (what === "clearAll") wave ? this.removeAllSongMarks() : this.removeAllMarkers();
  }

  // Saving.

  async save() {
    if (!this.dirty) return true;
    const kept = {};
    for (const [key, value] of Object.entries(this.edit)) if (value !== null) kept[key] = value;
    const answer = await ask("saveRun", this.target.track, this.target.name, {
      frames: this.markers, fps: { num: this.fps.num, den: this.fps.den }, markersChanged: this.markersChanged, edit: kept, songMarks: this.marksToKeep,
    });
    if (answer.problem) return answer.problem;
    for (const [song, marks] of Object.entries(this.marksToKeep)) this.marksBySong[song] = marks;
    this.touched = {};
    this.savedMarkers = [...this.markers];
    this.savedEdit = structuredClone(this.edit);
    this.saved = true;
    this.message = answer.replaced?.length > 0 ? `Saved. ${answer.replaced.join(", ")} from Premiere went to the ${mac ? "Trash" : "Recycle Bin"}, since these markers replace it.` : null;
    this.drawHead();
    return true;
  }

  async saveAndStay() {
    const result = await this.save();
    if (result !== true) {
      this.message = result;
      this.drawHead();
    }
  }

  /** Done keeps the work and goes back: there is nothing to answer first. Only when it can't be
   *  saved as it stands, with fewer than two gates marked say, is the pilot asked what to do. */
  async done() {
    if (!this.dirty) return this.close();
    this.pause();
    const result = await this.save();
    if (result === true) return this.close();
    const leave = await confirm({ title: `${this.target.name} can't be saved yet`, message: result, yes: "Leave without saving", no: "Keep working", destructive: true });
    if (leave) this.close();
  }

  async discard() {
    this.pause();
    const yes = await confirm({
      title: `Throw away the changes to ${this.target.name}?`, message: "Its markers and music go back to how they were when they were last saved.",
      yes: "Throw them away", no: "Keep working", destructive: true,
    });
    if (yes) this.close();
  }

  // Keys.

  key(event) {
    // Leave typing, and anything aimed at a question or a menu, alone.
    if (app.editor !== this || sheetIsOpen() || document.querySelector(".menu")) return;
    const typing = event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable);
    if (typing) return;
    const command = mac ? event.metaKey : event.ctrlKey;
    const letter = event.key.length === 1 ? event.key.toLowerCase() : event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : "";
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (command && letter === "s") {
      take();
      return this.saveAndStay();
    }
    if (event.key === "Escape") {
      take();
      // Esc closes the sound wave window first, when it is open.
      return this.soundWave ? this.closeSoundWave() : this.done();
    }
    if (this.phase !== "ready") return;
    if (this.soundWave) {
      if (this.soundWave.key(event, { command, letter })) take();
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    // A button that has the keyboard would be pressed by Space as well.
    if (event.key === " " || event.code === "Space") {
      take();
      document.activeElement?.blur?.();
      return this.togglePlay();
    }
    if (direction !== 0) {
      take();
      if (command) return this.nudgeMarker(direction);
      return this.step(direction * (event.altKey ? Math.round(this.fps.value) : event.shiftKey ? 10 : 1));
    }
    if (event.key === "ArrowUp") return take(), this.jump(-1);
    if (event.key === "ArrowDown") return take(), this.jump(1);
    if (event.key === "Backspace" || event.key === "Delete") return take(), this.removeMarker();
    if (letter === "m" || event.code === "KeyM") {
      // The marker keys are Premiere's: M adds, Shift-M and Shift-Command-M go to the next and the
      // previous, Option-M clears the one here, Option-Command-M clears them all.
      const combination = `${command ? "c" : ""}${event.altKey ? "a" : ""}${event.shiftKey ? "s" : ""}`;
      const what = { "": () => this.addMarker(), s: () => this.jump(1), cs: () => this.jump(-1), a: () => this.removeMarker(), ca: () => this.removeAllMarkers() }[combination];
      if (what) {
        take();
        what();
      }
      return;
    }
    if (!command && !event.altKey && letter === "b") return take(), this.addSongMarkHere();
    if (!command && !event.altKey && letter === "i") return take(), this.setVideoStart();
    if (!command && !event.altKey && letter === "o") return take(), this.setVideoEnd();
    if (command && letter === "z") return take(), this.undo();
  }

  // Drawing.

  build() {
    this.video = h("video.ed-video", { muted: true, playsInline: true, preload: "auto", disablePictureInPicture: true });
    this.timer = h("canvas.ed-timer");
    this.timerNote = h("div.ed-timer-note");
    this.pictureBox = h("div.ed-picture", { onclick: () => this.togglePlay() }, this.video, this.timer, this.timerNote);
    this.head = h("div.ed-head");
    this.body = h("div.ed-body");
    this.transport = h("div.ed-transport");
    this.clockText = h("div.ed-clock");
    this.frameText = h("div.ed-frame");
    this.side = h("div.ed-side");
    this.overview = h("canvas.ed-overview", { help: "The whole clip. Click or drag to move through it." });
    this.lanes = h("canvas.ed-lanes");
    this.timeline = h("div.card.ed-timeline");
    this.waveHolder = h("div.ed-wave-holder");
    this.root = h("div.ed", this.head, this.body);
    fill(document.getElementById("editor"), h("div.ed-frame-holder", this.root), this.waveHolder);
    document.getElementById("stage").setAttribute("inert", "");
    // A text box on the page underneath may still be holding the keyboard: M would be typed into it.
    document.activeElement?.blur?.();
    this.wire();
    this.drawHead();
    this.drawBody();
  }

  drawHead() {
    const track = trackName(this.target.track);
    let status = null;
    if (this.message) status = h("span.warn", this.message);
    else if (this.dirty) status = h("span.dim", "Not saved yet. Done saves it.");
    else if (this.saved) status = h("span.good.ed-saved", icon("checkCircle"), "Saved");
    redraw(this.head,
      secondary(track, () => this.done(), { icon: "chevronLeft" }),
      h("div", h("div.ed-name", this.target.name), label("MARKERS & MUSIC")),
      h("span.spacer"),
      h("div.ed-status", status),
      // One button finishes: it saves and goes back. Leaving without saving is the other choice,
      // and only there while there is something to lose.
      this.dirty && secondary("Discard changes", () => this.discard(), { help: "Go back without keeping what you changed since it was last saved." }),
      primary("Done", () => this.done(), { help: this.dirty ? `Save, and go back to ${track} (Esc). To save and stay here, press ${keys("cmd", "S")}.` : `Back to ${track} (Esc)` }),
    );
  }

  drawBody() {
    if (this.phase === "loading") {
      return fill(this.body, h("div.ed-waiting", h("span.spinner.large"), h("div.dim", this.note ?? `Opening ${this.target.clip.split(/[\\/]/).pop()}`), h("div.ed-hidden", this.pictureBox)));
    }
    if (this.phase === "failed") return fill(this.body, h("div.ed-waiting", h("div.ed-failed.warn", icon("warning"), this.problem)));
    fill(this.timeline,
      h("div.ed-overview-holder", this.overview),
      h("div.ed-lanes-row", h("div.ed-lane-names", h("span", { style: { top: `${lanes.lapsTop + 9}px` } }, "LAPS"), h("span", { style: { top: `${lanes.videoTop + 3}px` } }, "VIDEO"), h("span", { style: { top: `${lanes.musicTop + 15}px` } }, "MUSIC")), this.lanes),
      h("div.ed-hints",
        h("span.ed-hint", `Space play  ·  ← → one frame  ·  M mark  ·  ${keys("delete")} remove  ·  ${keys("cmd", "left")} ${keys("cmd", "right")} move marker  ·  ↑ ↓ markers  ·  I O video start, end  ·  B mark the music  ·  double-click the music for its sound wave  ·  right-click for more`),
        h("span.spacer"),
        secondary("Whole clip", () => this.showAll()),
        this.runButton = secondary("The run", () => this.showRun()),
        secondary("", () => this.zoom(2), { icon: "zoomOut", help: "Zoom out", "aria-label": "Zoom out" }),
        secondary("", () => this.zoom(0.5), { icon: "zoomIn", help: "Zoom in", "aria-label": "Zoom in" }),
      ),
    );
    fill(this.body, h("div.ed-work",
      h("div.ed-top", h("div.ed-left", this.pictureBox, this.transport), this.side),
      this.timeline,
    ));
    this.drawAll();
  }

  /** Everything, after a change to what is marked or how the videos are cut and scored. */
  drawChanged() {
    this.restartMusic();
    this.drawHead();
    this.drawAll();
    this.soundWave?.draw();
  }

  drawAll() {
    if (this.phase !== "ready") return;
    this.drawTransport();
    this.drawSide();
    this.drawMoved();
  }

  /** What changes with every frame: the readouts, the timer over the picture and the timeline. */
  drawMoved() {
    if (this.phase !== "ready") return;
    this.clockText.textContent = clock(this.seconds(this.frame));
    this.frameText.textContent = `FRAME ${this.frame} OF ${this.frameCount - 1}`;
    const onMarker = this.markers.includes(this.frame) && !this.playing;
    if (onMarker !== this.wasOnMarker) this.drawTransport();
    for (const row of this.side.querySelectorAll(".ed-lap")) row.classList.toggle("here", Number(row.dataset.marker) === this.frame);
    this.drawTimer();
    this.drawLanes();
  }

  drawTransport() {
    const second = Math.round(this.fps.value);
    const onMarker = this.markers.includes(this.frame) && !this.playing;
    this.wasOnMarker = onMarker;
    const button = (name, help, action) => secondary("", action, { icon: name, help, "aria-label": help, class: "ed-step" });
    const speeds = [[0.25, "Quarter speed", "¼×"], [0.5, "Half speed", "½×"], [1, "Normal speed", "1×"]];
    redraw(this.transport,
      h("div.ed-readout", this.clockText, this.frameText),
      h("span.spacer"),
      button("skipBack", "Previous marker (↑)", () => this.jump(-1)),
      secondary("−1 s", () => this.step(-second), { help: `Back one second (${keys("alt", "left")})` }),
      button("frameBack", "Back one frame (←). With Shift, ten frames.", () => this.step(-1)),
      primary("", () => this.togglePlay(), { icon: this.playing ? "pause" : "play", help: "Play or pause (Space)", "aria-label": this.playing ? "Pause" : "Play", class: "ed-play" }),
      button("frameForward", "Forward one frame (→). With Shift, ten frames.", () => this.step(1)),
      secondary("+1 s", () => this.step(second), { help: `Forward one second (${keys("alt", "right")})` }),
      button("skipForward", "Next marker (↓)", () => this.jump(1)),
      h("span.spacer"),
      secondary(speeds.find(([speed]) => speed === this.speed)?.[2] ?? "1×", (event) => menu(event.currentTarget, speeds.map(([speed, title]) => ({ title, action: () => this.setSpeed(speed) }))), { help: "Playback speed" }),
      secondary("", () => {
        this.showsTimer = !this.showsTimer;
        app.state.showsTimer = this.showsTimer;
        ask("remember", { showsTimer: this.showsTimer });
        this.drawTransport();
        this.drawTimer();
      }, { icon: "timer", class: this.showsTimer ? "ed-step on" : "ed-step", help: this.showsTimer ? "Hide the lap timer on the picture" : "Show the lap timer on the picture, as the 16:9 video will have it", "aria-label": this.showsTimer ? "Hide the lap timer" : "Show the lap timer" }),
      onMarker
        ? secondary("Remove marker", () => this.removeMarker(), { help: `Remove the marker on this frame (${keys("delete")})` })
        // The key that does the same, as in Premiere.
        : h("button.button.primary", { type: "button", help: "Mark a gate crossing on this frame (M)", onclick: () => this.addMarker() }, "Mark crossing", h("span.keycap", "M")),
    );
  }

  drawSide() {
    const edit = this.edit, times = this.laps, best = this.best;
    const lapsCard = h("div.card.ed-card",
      h("div.row.baseline", label("LAPS"), h("span.spacer"), h(`span.ed-total${best ? "" : ".none"}`, best ? lapTime(best.total) : "–")),
      h("div.ed-note.semibold", best ? `Best ${this.window} in a row: laps ${best.first + 1}–${best.first + this.window}` : `Needs ${this.window} laps for a time to submit`),
      this.markers.length === 0
        ? h("p.dim.small.ed-first", "Step to the frame where you cross the start/finish gate and press M. The first marker starts lap 1, and each one after it ends a lap.")
        : h("div.ed-laps", this.markers.map((marker, index) => {
          const inBest = best ? index - 1 >= best.first && index - 1 < best.first + this.window : false;
          const go = () => {
            this.pause();
            this.show(marker);
          };
          return h(`div.ed-lap${marker === this.frame ? ".here" : ""}`, {
            "data-marker": marker, help: "Go to this marker. Right-click to delete it.", onclick: go,
            oncontextmenu: (event) => {
              event.preventDefault();
              menu(event, [{ title: "Go to This Marker", action: go }, { title: "Delete This Marker", action: () => this.removeMarker(marker) }, "-", { title: "Delete All Markers", action: () => this.removeAllMarkers() }]);
            },
          },
            h("span.ed-lap-name", index === 0 ? "START" : `LAP ${index}`),
            h("span.ed-lap-at", clock(this.seconds(marker))),
            h("span.spacer"),
            index > 0 && h(`span.ed-lap-time${inBest ? ".accent" : ""}`, lapTime(times[index - 1])),
            h("button.ed-lap-remove", { type: "button", help: "Remove this marker", "aria-label": "Remove this marker", onclick: (event) => {
              event.stopPropagation();
              this.removeMarker(marker);
            } }, icon("close", 9)),
          );
        })),
    );

    const stretch = this.stretch, custom = edit.videoStart !== null || edit.videoEnd !== null;
    const videoCard = h("div.card.ed-card",
      label("FINISHED VIDEO"),
      stretch && h("div.ed-stretch", `${clock(stretch.from)} to ${clock(stretch.to)}  ·  ${span(stretch.to - stretch.from)}`),
      h("div.ed-note", !stretch ? "Mark the laps and it runs from 3 seconds before lap 1 to 8 seconds after the finish."
        : custom ? "Starts and ends where you set it." : "Automatic: from 3 seconds before lap 1 to 8 seconds after the finish."),
      h("div.row.ed-buttons",
        secondary("Start here", () => this.setVideoStart(), { help: "Start the finished videos on this frame (I)" }),
        secondary("End here", () => this.setVideoEnd(), { help: "End the finished videos on this frame (O)" }),
        secondary("Automatic", () => this.automaticVideo(), { disabled: !custom }),
      ),
    );

    const song = this.songSpan, heard = this.analysis;
    const title = edit.song || "No music";
    const pick = (event) => menu(event.currentTarget, [
      { title: "No music", action: () => this.choose(null) },
      ...(this.songs.length > 0 ? ["-", ...this.songs.map((name) => ({ title: name, action: () => this.choose(name) }))] : []),
      "-",
      { title: "Add a song…", action: () => this.importSong() },
      { title: `Show my songs in ${fileBrowser}`, action: () => ask("revealSongs") },
    ]);
    const musicCard = h("div.card.ed-card",
      h("div.row.baseline", label("MUSIC"), h("span.spacer"),
        heard?.tempo && h("span.ed-tempo", { help: heard.beatLength ? "The song's tempo. It can read as double or half what you would call it." : "The song's tempo, roughly. Its beat doesn't keep steady enough time to draw." },
          heard.beatLength ? tempoLabel(heard.tempo) : `About ${tempoLabel(heard.tempo)}`)),
      h("button.ed-song", { type: "button", onclick: pick, help: "Your songs. A song you add is kept in your library for every track, and so are the marks you put in it." }, icon("music"), h("span.ed-song-name", title), icon("chevronDown", 10)),
      song ? [
        this.songFindings(),
        h("div.ed-note", this.songPlacement(song.from)),
        h("div.row.ed-buttons",
          secondary("Start it here", () => this.placeSong(this.seconds(this.frame)), { help: "Put the start of the song on this frame. Or drag the song along the timeline." }),
          secondary("Start it with the video", () => this.placeSong(this.stretch?.from ?? 0), { disabled: !stretch }),
        ),
        h("div.ed-note", this.musicHeardWords()),
        h("div.row.ed-buttons",
          secondary("Music in", () => this.setMusicIn(), { help: "Bring the music in on this frame. Before it, the video is silent." }),
          secondary("Music out", () => this.setMusicOut(), { help: "Stop the music on this frame." }),
          secondary("Whole video", () => this.wholeMusic(), { disabled: edit.musicIn === null && edit.musicOut === null }),
        ),
        h("div.row.ed-buttons",
          secondary("Mark the music here", () => this.addSongMarkHere(), { help: "Mark this point in the song, such as a drop (B). Drag the song and the mark catches on a lap marker." }),
          secondary("Sound wave", () => this.openSoundWave(), { help: "Open the song's sound wave, big enough to mark it by eye. Double-clicking the song on the timeline does the same." }),
          // In the colour the pilot's own marks are drawn in.
          this.songMarks.length > 0 && h("span.ed-yours", { help: "Your own marks in this song. They are drawn in this colour, and the drops the app found in blue." }, icon("diamond", 8), `${this.songMarks.length} of yours`),
        ),
      ] : edit.song ? h("div.ed-note", "Getting the song ready…")
        : h("div.ed-note", this.songs.length === 0 ? "Add a song and drag it along the timeline to line it up. It is kept in your song library, with any marks you put in it, for your other clips."
          : "Pick a song and drag it along the timeline to line it up."),
    );
    const top = this.side.scrollTop;
    redraw(this.side, lapsCard, videoCard, musicCard);
    this.side.scrollTop = top;
    if (this.runButton) this.runButton.disabled = !stretch;
  }

  /** The drops the app heard in the song, to put on the start gate. */
  songFindings() {
    if (this.listening) return h("div.row.ed-listening", h("span.spinner"), h("span.ed-note", "Listening for the tempo and the drops…"));
    const heard = this.analysis;
    if (!heard) return null;
    return [
      // The colour the drops are drawn in on the timeline and the sound wave.
      h("div.row.ed-drops-title", icon("triangleUp", 8, { class: "drop" }), label("DROPS THE APP FOUND")),
      heard.spots.length === 0
        ? h("div.ed-note", "Nothing in this song stands out as a drop. Open its sound wave to pick a moment yourself.")
        : [
          h("div.ed-note", this.markers.length === 0 ? "Where the song suddenly gets bigger. Mark the start gate, and one of these can be put on it."
            : "Where the song suddenly gets bigger. Put one on the start gate, then press Space to hear it land."),
          h("div.ed-drops", heard.spots.map((spot) => this.dropRow(spot))),
        ],
      h("div.ed-rule"),
    ];
  }

  dropRow(spot) {
    const gate = this.gateUnder(spot.time);
    const problem = gate === 0 ? null : this.shortfall(spot.time);
    return h("div.ed-drop", {
      oncontextmenu: (event) => {
        event.preventDefault();
        menu(event, [
          ...this.markers.map((_marker, index) => ({ title: index === 0 ? "Put It on the Start Gate" : `Put It on the Gate That Ends Lap ${index}`, action: () => this.put(spot.time, index) })),
          ...(this.markers.length > 0 ? ["-"] : []),
          { title: "Mark It in the Song", action: () => this.addSongMark(spot.time) },
          { title: "See It in the Sound Wave", action: () => this.openSoundWave(spot.time) },
        ]);
      },
    },
      h("div.row.ed-drop-row",
        h("button.ed-drop-time", { type: "button", help: `${songClock(spot.time)} into the song. Click to see it in the sound wave.`, onclick: () => this.openSoundWave(spot.time) }, songClock(spot.time)),
        // How much it stands out.
        h("span.ed-strength", { help: spot.strength >= 0.995 ? "The biggest in the song" : "How much it stands out, next to the biggest in the song" }, h("span", { style: { width: `${Math.max(5, 40 * spot.strength)}px` } })),
        h("span.spacer"),
        gate === 0 ? h("span.ed-on-gate.good", icon("checkCircle"), "On the start gate")
          : secondary("On the start gate", () => this.put(spot.time), { disabled: this.markers.length === 0, help: "Slide the song so this lands as you cross the start gate. Right-click for the other gates." }),
      ),
      gate !== null && gate > 0 && h("div.ed-drop-note.good", `It is on the gate that ends lap ${gate}.`),
      problem && h("div.ed-drop-note.warn", problem),
    );
  }

  /** Says in words when the music is heard. */
  musicHeardWords() {
    const heard = this.musicHeard;
    if (!heard) return "The music isn't heard anywhere in the video as it stands.";
    const whole = this.edit.musicIn === null && this.edit.musicOut === null;
    return `${whole ? "The music plays" : "You set the music to play"} from ${clock(heard.from)} to ${clock(heard.to)} in the clip, and fades out at the end.`;
  }

  /** Says in words where the song sits against the video. */
  songPlacement(start) {
    const stretch = this.stretch;
    if (!stretch) return `The song starts at ${clock(start)} in the clip.`;
    const lead = start - stretch.from;
    if (Math.abs(lead) < 0.05) return "The song starts with the video.";
    return lead < 0 ? `The video starts ${span(lead)} into the song.` : `The song comes in ${span(lead)} after the video starts.`;
  }

  /** The lap timer over the picture: where the 16:9 video will have it, reading what it will read
   *  on the frame that is showing. */
  drawTimer() {
    const box = this.pictureBox.getBoundingClientRect();
    // The finished video's frame as it sits here: 16:9, as big as fits, in the middle.
    const width = Math.min(box.width, (box.height * 16) / 9), height = (width * 9) / 16;
    const left = (box.width - width) / 2, top = (box.height - height) / 2;
    const canvas = this.timer, note = this.timerNote;
    const show = this.showsTimer && width > 10;
    canvas.style.display = show && this.markers.length >= 2 ? "block" : "none";
    note.style.display = show && this.markers.length < 2 ? "block" : "none";
    if (!show) return;
    if (this.markers.length < 2) {
      note.textContent = this.markers.length === 0 ? "The lap timer shows here once you mark the start gate and the end of a lap." : "Mark the end of lap 1 and the lap timer shows here.";
      const inset = Math.max(8, (54 * height) / 1080);
      const place = this.look.position;
      Object.assign(note.style, { left: "", right: "", top: "", bottom: "" });
      note.style[place.endsWith("l") ? "left" : "right"] = `${left + inset}px`;
      note.style[place.startsWith("b") ? "bottom" : "top"] = `${top + inset}px`;
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const pixels = { width: Math.round(width * ratio), height: Math.round(height * ratio) };
    if (canvas.width !== pixels.width || canvas.height !== pixels.height) Object.assign(canvas, pixels);
    Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const crossings = this.markers.map((marker) => this.seconds(marker));
    const made = JSON.stringify(crossings);
    if (made !== this.raceMade) {
      this.raceMade = made;
      try {
        this.race = Race.from(crossings, { window: this.window });
      } catch {
        this.race = null;
      }
    }
    drawCornerTimer(canvas, { race: this.race, look: this.look, logo: this.logo, seconds: this.seconds(this.frame) });
  }

  // The timeline.

  /** A canvas made ready to be drawn on in points, whatever the screen's own pixels are. */
  ready(canvas) {
    const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);
    return { context, width: box.width, height: box.height };
  }

  drawLanes() {
    if (this.phase !== "ready" || !this.lanes.isConnected) return;
    this.drawOverview();
    const { context: c, width, height } = this.ready(this.lanes);
    const { from, to } = this.visible, across = Math.max(to - from, 0.001);
    const x = (seconds) => ((seconds - from) / across) * width;
    const fps = this.fps.value;
    const rounded = (left, top, wide, tall, radius, colour) => {
      if (!(wide > 0)) return;
      c.fillStyle = colour;
      c.beginPath();
      c.roundRect(left, top, wide, tall, Math.min(radius, wide / 2));
      c.fill();
    };
    const rect = (left, top, wide, tall, colour) => {
      c.fillStyle = colour;
      c.fillRect(left, top, wide, tall);
    };
    const words = (text, size, weight, colour, at, y, align = "left") => {
      c.font = `${weight} ${size}px ${face()}`;
      c.fillStyle = colour;
      c.textAlign = align;
      c.textBaseline = "middle";
      c.fillText(text, at, y + 0.5);
    };
    const shape = (points, colour, outline = null) => {
      c.beginPath();
      points.forEach(([px, py], index) => (index === 0 ? c.moveTo(px, py) : c.lineTo(px, py)));
      c.closePath();
      if (outline) {
        c.strokeStyle = outline;
        c.lineWidth = 2;
        c.stroke();
      }
      c.fillStyle = colour;
      c.fill();
    };
    for (const [top, tall] of [[lanes.lapsTop, lanes.lapsHeight], [lanes.videoTop, lanes.videoHeight], [lanes.musicTop, lanes.musicHeight]]) rounded(0, top, width, tall, 6, "rgba(255,255,255,0.045)");

    // Ruler: a tick every so often, down to single frames when zoomed right in.
    const step = [1 / fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((each) => (each / across) * width >= 66) ?? 600;
    if ((1 / fps / across) * width >= 5) {
      for (let index = Math.ceil(from * fps); this.seconds(index) <= to; index += 1) rect(x(this.seconds(index)), 17, 1, 5, "rgba(255,255,255,0.14)");
    }
    for (let tick = Math.ceil(from / step - 1e-9) * step; tick <= to; tick += step) {
      const whole = Math.trunc(tick + 0.0005);
      rect(x(tick), 12, 1, 10, colours.faint);
      words(step < 1 ? clock(tick) : `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`, 9, 600, colours.faint, x(tick) + 4, 8);
    }

    // The stretch the finished videos cover, with an end to drag on each side.
    const stretch = this.stretch;
    if (stretch) {
      const left = x(stretch.from), right = x(stretch.to);
      rounded(left, lanes.videoTop, right - left, lanes.videoHeight, 5, "rgba(255,255,255,0.2)");
      for (const edge of [left, right - 4]) rounded(edge, lanes.videoTop, 4, lanes.videoHeight, 2, "rgba(255,255,255,0.85)");
      if (right - left > 150) words(`IN THE VIDEO  ${span(stretch.to - stretch.from)}`, 9, 800, "rgba(255,255,255,0.8)", Math.max(left, 0) + 10, lanes.videoTop + lanes.videoHeight / 2);
      // What falls outside it is left out of the video: dim it in the music lane.
      rect(0, lanes.musicTop, Math.max(0, left), lanes.musicHeight, `rgba(${colours.card},0.55)`);
      rect(right, lanes.musicTop, Math.max(0, width - right), lanes.musicHeight, `rgba(${colours.card},0.55)`);
    }

    // Laps between the markers.
    const markers = this.markers, times = this.laps, best = this.best;
    times.forEach((time, index) => {
      const start = x(this.seconds(markers[index])), end = x(this.seconds(markers[index + 1]));
      const inBest = best ? index >= best.first && index < best.first + this.window : false;
      const wide = Math.max(1, end - start - 2);
      rounded(start + 1, lanes.lapsTop + 2, wide, lanes.lapsHeight - 4, 5, inBest ? "rgba(255,214,10,0.9)" : "rgba(255,255,255,0.17)");
      const colour = inBest ? colours.onAccent : "#fff", middle = lanes.lapsTop + lanes.lapsHeight / 2;
      if (wide > 96) words(`LAP ${index + 1}   ${lapTime(time)}`, 11, 800, colour, start + 1 + wide / 2, middle, "center");
      else if (wide > 44) words(lapTime(time), 10, 800, colour, start + 1 + wide / 2, middle, "center");
    });

    // The song, with its loudness drawn in so a drop or a beat can be lined up with a gate.
    const song = this.songSpan;
    if (song) {
      const left = x(song.from), right = x(song.to), top = lanes.musicTop + 2, tall = lanes.musicHeight - 4, middle = top + tall / 2;
      rounded(left, top, right - left, tall, 5, "rgba(255,214,10,0.13)");
      c.strokeStyle = "rgba(255,214,10,0.45)";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(left + 0.5, top + 0.5, Math.max(1, right - left - 1), tall - 1, 5);
      c.stroke();
      if (this.wave) {
        // Its highest points faintly, how loud it is over them, and the bass inside that: a drop is
        // where the bass comes in.
        const each = across / width, last = Math.min(right, width);
        const bars = [[], [], []];
        for (let column = Math.floor(Math.max(left, 0)); column < last; column += 1) {
          const start = from + column * each - song.from;
          const found = levels(this.wave, start, start + each);
          if (found) [found.peak, found.body, found.bass].forEach((level, index) => bars[index].push([column, Math.max(1, level * (tall - 8))]));
        }
        ["rgba(255,214,10,0.28)", "rgba(255,214,10,0.85)", colours.bass].forEach((colour, index) => {
          c.fillStyle = colour;
          for (const [column, high] of bars[index]) c.fillRect(column, middle - high / 2, 1, high);
        });
      }
      // Where the music is heard: dimmed outside, with an end to drag on each side.
      const heard = this.musicHeard;
      if (heard) {
        if (this.edit.musicIn !== null || this.edit.musicOut !== null) {
          rect(left, lanes.musicTop, Math.max(0, x(heard.from) - left), lanes.musicHeight, `rgba(${colours.card},0.6)`);
          rect(x(heard.to), lanes.musicTop, Math.max(0, right - x(heard.to)), lanes.musicHeight, `rgba(${colours.card},0.6)`);
        }
        for (const edge of [x(heard.from), x(heard.to) - 3]) rounded(edge, top, 3, tall, 1.5, "rgba(255,255,255,0.85)");
      }
      // The beat, once the timeline is zoomed in far enough to tell the beats apart.
      const { firstBeat, beatLength } = this.analysis ?? {};
      if (firstBeat >= 0 && beatLength > 0 && (beatLength / across) * width >= 12) {
        for (let index = Math.max(0, Math.ceil((from - song.from - firstBeat) / beatLength)); song.from + firstBeat + index * beatLength <= Math.min(to, song.to); index += 1) {
          rect(x(song.from + firstBeat + index * beatLength) - 0.5, lanes.musicTop + lanes.musicHeight - 8, 1, 6, "rgba(255,255,255,0.35)");
        }
      }
      // The drops the app heard: a dotted line with an arrowhead at the foot, in the drops' own
      // colour. Each sits on a dark line, so it shows over the wave.
      for (const spot of this.spots) {
        const place = x(song.from + spot.time);
        if (place < -6 || place > width + 6) continue;
        rect(place - 1.5, top, 3, tall, "rgba(0,0,0,0.45)");
        c.strokeStyle = colours.drop;
        c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(place, top);
        c.lineTo(place, top + tall);
        c.stroke();
        c.setLineDash([]);
        const foot = lanes.musicTop + lanes.musicHeight;
        shape([[place, foot - 9], [place + 5, foot - 1], [place - 5, foot - 1]], colours.drop, "rgba(0,0,0,0.5)");
      }
      // The pilot's own marks in the song: a solid line with a diamond at its head, in the marks' colour.
      for (const mark of this.songMarks) {
        const place = x(song.from + mark);
        rect(place - 1.75, lanes.musicTop, 3.5, lanes.musicHeight, "rgba(0,0,0,0.45)");
        rect(place - 0.75, lanes.musicTop, 1.5, lanes.musicHeight, colours.mark);
        shape([[place, lanes.musicTop - 1], [place + 5, lanes.musicTop + 4], [place, lanes.musicTop + 9], [place - 5, lanes.musicTop + 4]], colours.mark, "rgba(0,0,0,0.5)");
      }
    } else {
      words(this.edit.song ? "Getting the song ready…" : "No music", 10, 600, colours.faint, width / 2, lanes.musicTop + lanes.musicHeight / 2, "center");
    }

    // Markers run down through every lane, so the song can be lined up against them.
    markers.forEach((marker, index) => {
      const position = x(this.seconds(marker));
      rect(position - 1, 12, 2, lanes.lapsTop + lanes.lapsHeight - 12, colours.accent);
      rect(position - 0.5, lanes.videoTop, 1, height - lanes.videoTop, "rgba(255,214,10,0.4)");
      shape([[position - 1, 12], [position + 8, 16], [position - 1, 20]], colours.accent);
      if (index === 0 && markers.length === 1) words("LAP 1 STARTS", 9, 800, colours.accent, position + 8, lanes.lapsTop + lanes.lapsHeight / 2);
    });

    // Playhead.
    const now = x(this.seconds(this.frame));
    rect(now - 0.75, 0, 1.5, height, "#fff");
    shape([[now - 5, 0], [now + 5, 0], [now, 7]], "#fff");
  }

  /** The whole clip in one thin bar: where the laps are, what the timeline below is showing, and the playhead. */
  drawOverview() {
    const { context: c, width, height } = this.ready(this.overview);
    const total = Math.max(this.duration, 0.001), x = (seconds) => (seconds / total) * width;
    c.fillStyle = "rgba(255,255,255,0.07)";
    c.beginPath();
    c.roundRect(0, 0, width, height, 3);
    c.fill();
    if (this.markers.length > 1) {
      const start = x(this.seconds(this.markers[0]));
      c.fillStyle = "rgba(255,214,10,0.7)";
      c.fillRect(start, 3, Math.max(2, x(this.seconds(this.markers.at(-1))) - start), height - 6);
    }
    const left = x(this.visible.from), wide = Math.max(3, x(this.visible.to) - left);
    c.fillStyle = "rgba(255,255,255,0.14)";
    c.beginPath();
    c.roundRect(left, 0, wide, height, 3);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.5)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(left + 0.5, 0.5, wide - 1, height - 1, 3);
    c.stroke();
    c.fillStyle = "#fff";
    c.fillRect(x(this.seconds(this.frame)) - 0.75, 0, 1.5, height);
  }

  /** The clip time under a place along the timeline, and the place of a clip time. */
  timeAt(place) { return this.visible.from + (place / Math.max(this.lanes.clientWidth, 1)) * (this.visible.to - this.visible.from); }
  placeOf(seconds) { return ((seconds - this.visible.from) / Math.max(this.visible.to - this.visible.from, 0.001)) * this.lanes.clientWidth; }

  /** The marker, the song mark or the drop within a few points of a place along the timeline. */
  markerNear(place) {
    const nearest = this.markers.reduce((best, marker) => (best === null || Math.abs(this.placeOf(this.seconds(marker)) - place) < Math.abs(this.placeOf(this.seconds(best)) - place) ? marker : best), null);
    return nearest !== null && Math.abs(this.placeOf(this.seconds(nearest)) - place) <= 10 ? nearest : null;
  }
  songPointNear(points, place) {
    const song = this.songSpan;
    if (!song) return null;
    const nearest = points.reduce((best, point) => (best === null || Math.abs(this.placeOf(song.from + point) - place) < Math.abs(this.placeOf(song.from + best) - place) ? point : best), null);
    return nearest !== null && Math.abs(this.placeOf(song.from + nearest) - place) <= 8 ? nearest : null;
  }

  /** The end that can be dragged at a point: of the stretch the video covers, or of the music. */
  endUnder(point) {
    if (point.y >= lanes.musicTop) {
      const heard = this.musicHeard;
      if (!heard) return null;
      const toStart = Math.abs(point.x - this.placeOf(heard.from)), toEnd = Math.abs(point.x - this.placeOf(heard.to));
      return Math.min(toStart, toEnd) <= 7 ? (toStart <= toEnd ? "musicIn" : "musicOut") : null;
    }
    const stretch = this.stretch;
    if (point.y >= lanes.videoTop && stretch) {
      if (Math.abs(point.x - this.placeOf(stretch.from)) <= 8) return "start";
      if (Math.abs(point.x - this.placeOf(stretch.to)) <= 8) return "end";
    }
    return null;
  }

  wire() {
    const at = (event, canvas) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    // The bar of the whole clip: click or drag to move through it.
    const overview = this.overview;
    const scrub = (event) => {
      this.pause();
      this.show(this.frameAt((at(event, overview).x / Math.max(overview.clientWidth, 1)) * this.duration));
    };
    overview.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      overview.setPointerCapture(event.pointerId);
      scrub(event);
    });
    overview.addEventListener("pointermove", (event) => { if (overview.hasPointerCapture(event.pointerId)) scrub(event); });

    const lanesCanvas = this.lanes;
    lanesCanvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.phase !== "ready") return;
      lanesCanvas.setPointerCapture(event.pointerId);
      const start = at(event, lanesCanvas), song = this.songSpan, time = this.timeAt(start.x);
      const onSong = start.y >= lanes.musicTop && song && time >= song.from && time <= song.to;
      this.slid = false;
      this.dragFrom = start.x;
      if (onSong && event.detail >= 2) {
        // A double-click on the song opens its sound wave at that moment.
        this.openSoundWave(time - song.from);
        this.drag = { kind: "spent" };
        return;
      }
      const grabbed = this.endUnder(start);
      if (grabbed) {
        // An end of the video's stretch or of the music: this trims it.
        this.pause();
        this.remember();
        this.drag = { kind: grabbed };
      } else if (onSong) {
        // The body of the song: this slides it, once it is actually moved.
        this.drag = { kind: "song", grabbed: time - song.from };
      } else {
        this.drag = { kind: "scrub" };
        this.pause();
      }
      this.dragged(start);
    });
    lanesCanvas.addEventListener("pointermove", (event) => {
      const point = at(event, lanesCanvas);
      this.pointer = point;
      if (lanesCanvas.hasPointerCapture(event.pointerId) && this.drag) return this.dragged(point);
      // Over an end that can be dragged, the pointer says so, the way it does in Premiere.
      lanesCanvas.style.cursor = this.phase === "ready" && this.endUnder(point) ? "ew-resize" : "default";
    });
    const dropped = () => {
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if ((drag.kind === "song" && this.slid) || ["musicIn", "musicOut", "start", "end"].includes(drag.kind)) this.drawChanged();
      this.slid = false;
    };
    lanesCanvas.addEventListener("pointerup", dropped);
    lanesCanvas.addEventListener("pointercancel", dropped);
    lanesCanvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (this.phase !== "ready") return;
      const point = at(event, lanesCanvas), song = this.songSpan;
      if (point.y >= lanes.musicTop && song) {
        // Over the music: marks in the song, and where the music comes in and stops.
        const time = this.timeAt(point.x), inSong = time >= song.from && time <= song.to;
        const mark = this.songPointNear(this.songMarks, point.x), drop = mark === null ? this.songPointNear(this.spots.map((spot) => spot.time), point.x) : null;
        const here = this.seconds(this.frame), none = this.markers.length === 0;
        return menu(event, [
          ...(mark !== null ? [
            { title: "Line This Mark Up with the Playhead", action: () => this.lineUp(mark, here) },
            { title: "Put This Mark on the Start Gate", disabled: none, action: () => this.put(mark) },
            { title: "Delete This Music Mark", action: () => this.removeSongMark(mark) }, "-",
          ] : drop !== null ? [
            { title: "Put This Drop on the Start Gate", disabled: none, action: () => this.put(drop) },
            { title: "Line This Drop Up with the Playhead", action: () => this.lineUp(drop, here) }, "-",
          ] : []),
          { title: "Mark the Music Here", disabled: !inSong, action: () => this.addSongMarkHere(time) },
          { title: "Delete All Music Marks", disabled: this.songMarks.length === 0, action: () => this.removeAllSongMarks() },
          { title: "Open the Song's Sound Wave", action: () => this.openSoundWave(inSong ? time - song.from : null) }, "-",
          { title: "Bring the Music In Here", action: () => this.setMusicIn(time) },
          { title: "Stop the Music Here", action: () => this.setMusicOut(time) },
          { title: "Play the Music for the Whole Video", disabled: this.edit.musicIn === null && this.edit.musicOut === null, action: () => this.wholeMusic() },
        ]);
      }
      const marker = this.markerNear(point.x);
      menu(event, [
        ...(marker !== null ? [{ title: "Go to This Marker", action: () => {
          this.pause();
          this.show(marker);
        } }, { title: "Delete This Marker", action: () => this.removeMarker(marker) }, "-"] : []),
        { title: "Add a Marker at the Playhead", action: () => this.addMarker() },
        { title: "Delete All Markers", disabled: this.markers.length === 0, action: () => this.removeAllMarkers() },
      ]);
    });
  }

  dragged(point) {
    const drag = this.drag, edit = this.edit;
    const { from, to } = this.visible, across = to - from;
    const now = this.timeAt(point.x);
    const snapped = (time) => this.seconds(this.frameAt(time));
    if (drag.kind === "scrub") return this.show(this.frameAt(Math.min(Math.max(now, from), to)), false);
    if (drag.kind === "start") edit.videoStart = Math.min(Math.max(0, snapped(now)), Math.max(0, (edit.videoEnd ?? this.automaticStretch?.to ?? this.duration) - 0.5));
    else if (drag.kind === "end") edit.videoEnd = Math.max(Math.min(this.duration, snapped(now)), (edit.videoStart ?? this.automaticStretch?.from ?? 0) + 0.5);
    else if (drag.kind === "musicIn") edit.musicIn = Math.min(Math.max(0, snapped(now)), (edit.musicOut ?? this.duration) - 0.5);
    else if (drag.kind === "musicOut") edit.musicOut = Math.max(Math.min(this.duration, snapped(now)), (edit.musicIn ?? 0) + 0.5);
    else if (drag.kind === "song") {
      if (!this.slid) {
        if (Math.abs(point.x - this.dragFrom) < 2) return;
        this.pause();
        this.remember();
        this.slid = true;
      }
      let place = thousandth(now - drag.grabbed);
      // A mark in the song, or one of its drops, catches on a lap marker or on the start of the video as it passes.
      let reach = (7 / Math.max(this.lanes.clientWidth, 1)) * across;
      const targets = [...this.markers.map((marker) => this.seconds(marker)), ...(this.stretch ? [this.stretch.from] : [])];
      for (const mark of [...this.songMarks, ...this.spots.map((spot) => spot.time)]) {
        for (const target of targets) {
          const off = Math.abs(target - (now - drag.grabbed + mark));
          if (off < reach) {
            reach = off;
            place = thousandth(target - mark);
          }
        }
      }
      edit.songStart = place;
    } else return;
    this.drawLanes();
  }
}

/** Opens a clip in the marker editor. */
export async function openEditor(target) {
  if (app.editor) return;
  const data = await ask("editorData", target.track, target.name);
  if (app.editor) return;
  app.editor = new Editor(target, data);
}
