// The track in 3D: a track's pipes on their grid and the lap as a line a drone flies, drawn on a
// plain canvas. It takes over the window while it is open, the way the marker editor does, so the
// page under it being drawn again doesn't disturb it.
//
// It is also where a track is built: sections are clicked on and off in the picture, and the lap is
// put down point by point on a plan of the track seen from above.

import { app, ask, hangar, loadTrack, render, trackName, eventOf } from "../core.js";
import { h, fill, label, primary, secondary, plain } from "../ui.js";
import { confirm, sheetIsOpen } from "../sheets.js";
import { bin } from "../words.js";
import { camera, extent, farFor, homeView, jointsOf, lapLine, togglePipe, openSteps, edgeAt, snap, lapPoints, lapFrom, startAt, startIndex, reach } from "../../shared/trackview.js";
import { clock } from "../../shared/trackvideo.js";

/** What the picture is drawn in. The pipes are the white plastic the gates are built of, with the
 *  red and blue tape round the middle of each section. */
const paint = {
  floor: "#0e1116", glow: "#1a2029", grid: "rgba(255, 255, 255, 0.07)",
  pipe: "#f1f3f5", shade: "#8d96a1", red: "#f54d33", blue: "#2f7bff",
  accent: "#ffd60a", faint: "rgba(255, 255, 255, 0.32)", text: "#ffffff", away: "#ff453a", dark: "#0d0d0f",
};
/** How thick a pipe is, in sections. */
const pipeWidth = 0.05;
/** How high a point of the lap can be put, in sections. */
const highest = 4;

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

class TrackView {
  /**
   * @param {string} track the track's path in the library
   * @param {object|null} found what the main process gave: the track, whether it is the pilot's
   *   own, and whether one comes with the app. Null for a track with no view yet.
   * @param {number|null} bestLap the pilot's best lap here, in seconds
   */
  constructor(track, found, bestLap) {
    this.track = track;
    this.model = found?.view ?? { event: "", track: null, from: null, parts: [], pipes: [], start: null, lap: [] };
    /** Whether there is a view kept for this track at all, whether the pilot made it, and whether
     *  one comes with the app. */
    this.exists = Boolean(found);
    this.own = Boolean(found?.own);
    this.given = Boolean(found?.given);
    this.bestLap = bestLap;
    this.measure();
    this.frameTrack();
    this.view = { ...this.home, width: 0, height: 0 };
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.state = { share: 0.21, playing: Boolean(this.lap) && !still, lapTime: Math.min(30, Math.max(3, bestLap ?? 10)), last: 0, move: -1 };
    /** While the track is being changed: which of the two is being worked on, the lap as a list of
     *  points, the one picked out, and what is under the pointer. Null while it is only looked at. */
    this.edit = null;
    this.problem = null;
    /** Reading the pipes out of the track's video: what it is doing while it is at it, what came
     *  of it, and what the pilot has typed to help it. */
    this.reading = null;
    this.read = null;
    this.videoHelp = { sections: "", from: "", to: "" };
    this.fingers = new Map();
    this.press = null;
    this.dragging = -1;
    /** The plan's room on the screen, the place on the grid at its middle, and how many sections fit across its shorter side. */
    this.plan = { w: 0, h: 0, cx: 0.5, cy: 0.5, span: 5 };
    this.onKey = (event) => this.key(event);
  }

  /** Works out the lap's line and the joints again, after the track has changed. */
  measure() {
    this.lap = lapLine(this.model);
    this.joints = jointsOf(this.model);
    this.ghosts = this.edit?.mode === "pipes" ? openSteps(this.model.pipes) : [];
  }

  /** Puts the middle of the track in the middle of the picture, at a distance that fits it. */
  frameTrack() {
    const { low, high, middle } = extent(this.model);
    Object.assign(this, { low, high, middle });
    this.home = { ...homeView, far: farFor(this.model) };
  }

  // ---- The window.

  open() {
    this.canvas = h("canvas", { tabIndex: 0, "aria-label": "The track in 3D. Drag to turn it, scroll or pinch to zoom, arrow keys to turn." });
    this.pen = this.canvas.getContext("2d");
    this.planCanvas = h("canvas", { tabIndex: 0, "aria-label": "The track from above. Click to add a point of the lap, drag a point to move it." });
    this.planPen = this.planCanvas.getContext("2d");
    this.planBox = h("div.tv-plan", { hidden: true }, this.planCanvas);
    this.playButton = primary("Pause", () => this.toggle(), { class: "tv-play" });
    this.place = h("input", { type: "range", min: 0, max: 1000, value: 0, "aria-label": "Place in the lap", oninput: () => {
      this.state.playing = false;
      this.state.share = Number(this.place.value) / 1000;
      this.refresh();
    } });
    this.paceOut = h("output", `${this.state.lapTime.toFixed(1)} s`);
    this.pace = h("input", { type: "range", min: 3, max: 30, step: 0.1, value: this.state.lapTime, "aria-label": "Seconds a lap takes", oninput: () => this.setPace(Number(this.pace.value)) });
    this.moveButtons = [];
    this.headBox = h("div.tv-head");
    this.controlsBox = h("div.tv-controls");
    this.hintBox = h("p.tv-hint");
    this.sideBox = h("aside.tv-side");
    this.root = h("div.tv", this.headBox,
      h("div.tv-main",
        h("section.tv-stage", { "aria-label": "The track" }, h("div.tv-views", h("div.tv-view", this.canvas), this.planBox), this.controlsBox, this.hintBox),
        this.sideBox,
      ),
    );
    fill(document.getElementById("trackview"), this.root);
    document.getElementById("stage").setAttribute("inert", "");
    app.trackView = this;

    this.chrome();
    this.unhear = hangar.hear("trackvideo", (stage) => {
      if (!this.reading) return;
      this.reading.stage = stage;
      if (this.readingLine?.isConnected) this.readingLine.textContent = `${stage}… This takes about a minute.`;
    });
    this.watch = new ResizeObserver(() => this.fit());
    this.watch.observe(this.canvas);
    this.watch.observe(this.planBox);
    window.addEventListener("keydown", this.onKey, true);
    this.listen();
    this.listenToPlan();
    this.fit();
    const frame = (now) => {
      if (app.trackView !== this) return;
      if (this.state.playing && this.lap) this.state.share += Math.min(0.1, (now - this.state.last) / 1000) / this.state.lapTime;
      this.state.last = now;
      if (this.state.playing && this.lap) this.refresh();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    this.canvas.focus({ preventScroll: true });
  }

  /** Everything round the picture: the head, the controls under it, and the column beside it. */
  chrome() {
    const track = this.model, name = trackName(this.track), event = eventOf(this.track), edit = this.edit;
    const tab = (title, mode) => h("button.tv-tab", { type: "button", role: "tab", "aria-selected": String(edit?.mode === mode), onclick: () => this.work(mode) }, title);
    fill(this.headBox,
      secondary(name, () => this.close(), { icon: "chevronLeft", help: `Back to ${name}` }),
      h("div.tv-title", event?.name && label(event.name.toUpperCase()), h("h1.tv-name", `${name.toUpperCase()} IN 3D`)),
      h("span.spacer"),
      edit ? [
        h("div.tv-tabs", { role: "tablist", "aria-label": "What to work on" }, tab("Pipes", "pipes"), tab("Lap", "lap")),
        secondary("Discard changes", () => this.discardEdit()),
        primary("Done", () => this.finishEdit(), { help: "Keep this as the track's 3D view." }),
      ] : [
        track.from?.video && secondary("Watch the track video", () => ask("openLink", track.from.video), { icon: "arrowUpRight", help: "Opens the series' own video of this track in your browser." }),
        this.own && this.given && secondary("Use the app's own", () => this.revert(), { help: `Go back to the view of this track that comes with the app. Yours goes to ${bin}.` }),
        secondary(this.lap || track.pipes.length === 0 ? "Edit" : "Draw the lap", () => this.work(track.pipes.length > 0 && !this.lap ? "lap" : "pipes"), { help: "Change the pipes, or draw the line the lap is flown along." }),
      ],
    );

    const reset = secondary("Reset view", () => {
      this.frameTrack();
      Object.assign(this.view, this.home);
      this.refresh();
    });
    fill(this.controlsBox,
      this.lap && [
        this.playButton,
        h("label.tv-slide.wide", "Lap", this.place),
        h("label.tv-slide", "Lap time", this.pace, this.paceOut),
        !edit && this.bestLap !== null && plain(`Your best, ${this.bestLap.toFixed(3)}`, () => this.setPace(this.bestLap), { class: "quiet", help: "Fly the lap at the pace of your best lap on this track." }),
      ],
      h("span.spacer"), reset,
    );
    this.hintBox.classList.toggle("warn", Boolean(this.problem));
    fill(this.hintBox, this.problem ?? (edit?.mode === "pipes"
      ? "Click a faint section to add it · click a pipe to take it away · drag to turn"
      : edit?.mode === "lap"
        ? "Click the plan to add a point after the one picked out · drag a point to move it · Delete takes it away"
        : `Drag to turn · scroll or pinch to zoom${this.lap ? " · Space to play or pause" : ""}`));
    this.planBox.hidden = edit?.mode !== "lap";

    const sections = track.pipes.length;
    this.moveButtons = track.lap.map((move, index) => h("button", { type: "button", onclick: () => {
      if (!this.lap) return;
      this.state.share = this.lap.moveStarts[index] + 0.0005;
      this.state.playing = false;
      if (edit?.mode === "lap") this.pick(track.lap.slice(0, index).reduce((count, one) => count + one.by.length, 0));
      this.refresh();
    } }, move.move || `Move ${index + 1}`));
    const lapList = this.lap && track.lap.length > 0 && h("section", label("THE LAP"), h("ol.tv-lap", this.moveButtons.map((button) => h("li", button))));
    const across = [0, 1].map((axis) => this.high[axis] - this.low[axis]);
    if (edit?.mode === "pipes") {
      fill(this.sideBox,
        h("section", label("PIPES"),
          h("p.tv-note", sections === 0
            ? "Start with any one section: click one of the faint lines. Every section you add offers the next ones, a step along the grid from each joint."
            : "The faint lines are where a section can go next. Click one to add it, or click a pipe to take it away. Feet and other short stubs aren't sections: leave them out."),
          h("dl.tv-parts", h("dt", "In the picture"), h("dd", plural(sections, "section"))),
          sections > 0 && h("div.row", secondary("Take every pipe away", () => this.clearPipes())),
        ),
        this.videoReader(),
        this.videoField(),
      );
    } else if (edit?.mode === "lap") {
      fill(this.sideBox, this.pointPanel(), lapList, this.videoField());
    } else {
      fill(this.sideBox,
        lapList,
        h("section", label("THE BUILD"),
          h("dl.tv-parts",
            track.parts.map((part) => [h("dt", part.name), h("dd", plural(part.sections, "section"))]),
            h(`dt${track.parts.length > 0 ? ".sum" : ""}`, "In the picture"), h(`dd${track.parts.length > 0 ? ".sum" : ""}`, plural(sections, "section")),
          ),
        ),
        sections > 0 && h("p.tv-note", `Sections are one length, so every joint sits on a grid one section apart. This track is ${across[0]} by ${across[1]}.${this.own ? "" : this.lap ? " It was made from the series' track video: the pipes from its build, the lap from its flythrough." : " It was made from the series' photos of the track."}${this.lap ? "" : " The lap isn't drawn in yet: press Draw the lap once you have seen the flythrough in the track video."}`),
      );
    }
    this.state.move = -1;
  }

  /** Reading the pipes out of the track's video: the button, what it is doing, and what came of it. */
  videoReader() {
    const link = this.model.from?.video ?? "", help = this.videoHelp, read = this.read, have = this.model.pipes.length;
    const typed = (which, props) => {
      const input = h("input.field.tv-number", { type: "text", value: help[which], oninput: () => { help[which] = input.value; }, ...props });
      return input;
    };
    return h("section", label("FROM THE TRACK VIDEO"),
      h("p.tv-note", link
        ? "The series' video shows the track being built in front of one fixed camera. The app can watch that and find the pipes in it."
        : "Put the link to the track's video in the box below, and the app can find the pipes in it."),
      h("div.row", secondary(this.reading ? "Reading the video…" : "Read the pipes from the video", () => this.readVideo(), { disabled: !link || Boolean(this.reading) })),
      this.reading && h("p.tv-note.tv-reading", h("span.spinner"), this.readingLine = h("span", `${this.reading.stage}… This takes about a minute.`)),
      h("label.tv-slide", "Sections in its parts list", typed("sections", { inputMode: "numeric", placeholder: "?", "aria-label": "How many sections the video's parts list adds up to", help: "If the video lists the parts, add up their sections. The app then takes the reading with that many." })),
      read?.needsTimes && h("label.tv-slide", "The build runs from", typed("from", { placeholder: "0:43", "aria-label": "When the build starts in the video" }), "to", typed("to", { placeholder: "1:29", "aria-label": "When the build ends in the video" })),
      read?.problem && h("p.tv-note.warn", read.problem),
      read?.picture && h("img.tv-still", { src: read.picture, alt: "The track standing, as the video shows it" }),
      read?.pipes && h("p.tv-note", `It found ${plural(read.pipes.length, "section")}. Check them against the picture: add what is missing, and take away what isn't there.`),
      (read?.readings ?? []).some((pipes) => pipes.length !== have) && h("div.tv-readings", read.readings.filter((pipes) => pipes.length !== have).slice(0, 3).map((pipes) =>
        secondary(`Try the reading with ${pipes.length}`, () => this.useReading(pipes), { help: "The picture can be seen more than one way. This is another of them." }))),
    );
  }

  async readVideo() {
    const link = this.model.from?.video, help = this.videoHelp;
    if (!link || this.reading || !this.edit) return;
    if (this.model.pipes.length > 0 && !(await confirm({ title: "Replace these pipes with what the video shows?", message: `The ${plural(this.model.pipes.length, "section")} here now give way to the ones found in the video. The lap stays as it is.`, yes: "Read the video" }))) return;
    this.reading = { stage: "Opening the video" };
    this.read = null;
    this.chrome();
    const found = await ask("readTrackVideo", { link, sections: /^\s*\d+\s*$/.test(help.sections) ? Number(help.sections) : null, from: clock(help.from), to: clock(help.to) });
    this.reading = null;
    // The pilot may have left the pipes, or the view, while it was at it.
    if (app.trackView !== this || !this.edit) return;
    this.read = found;
    if (found.pipes) this.useReading(found.pipes);
    else this.chrome();
  }

  /** Takes one way of seeing the video's picture as the track's pipes. */
  useReading(pipes) {
    this.read = { ...this.read, pipes };
    this.setPipes(pipes.map(([a, b]) => [[...a], [...b]]));
    this.frameTrack();
    Object.assign(this.view, this.home);
    this.refresh();
  }

  /** The link to the track's video, which the pilot can put in for a track of their own. */
  videoField() {
    const input = h("input.field", { type: "text", spellcheck: false, placeholder: "https://…", value: this.model.from?.video ?? "", "aria-label": "Link to the track video", oninput: () => {
      const link = input.value.trim();
      const had = Boolean(this.model.from?.video);
      this.model = { ...this.model, from: /^https:\/\/\S+$/.test(link) ? { video: link } : null };
      if (this.edit) this.edit.dirty = true;
      // The button that reads the video is there to press once there is a link.
      if (had !== Boolean(this.model.from?.video) && this.edit?.mode === "pipes") {
        this.chrome();
        this.sideBox.querySelector('input[aria-label="Link to the track video"]')?.focus();
      }
    } });
    return h("section", label("TRACK VIDEO"), input, h("p.tv-note", "A link to the video of the track, if there is one. It is only kept as a button to watch it."));
  }

  /** What can be done to the point of the lap that is picked out. */
  pointPanel() {
    const edit = this.edit, point = edit.points[edit.picked] ?? null;
    if (!point) {
      return h("section", label("ITS POINTS"), h("p.tv-note", edit.points.length === 0
        ? "Click the plan where the drone goes, one point after another, right round the lap and back towards the first. Three points make a line; more make it follow the track."
        : "Click a point to pick it out, or click the plan to add one at the end."));
    }
    const up = h("output", `${point.at[2]}`);
    const height = h("input", { type: "range", min: 0, max: highest, step: 0.25, value: point.at[2], "aria-label": "How high, in sections", oninput: () => {
      point.at[2] = Number(height.value);
      up.textContent = `${point.at[2]}`;
      this.touched();
    } });
    const name = h("input.field", { type: "text", placeholder: edit.picked === 0 ? "What this move is called" : "It carries on the move before", value: point.name ?? "", "aria-label": "The move that starts here", oninput: () => {
      point.name = name.value.trim() === "" ? (edit.picked === 0 ? "" : null) : name.value;
      this.touched({ list: false });
    }, onchange: () => this.chrome() });
    const start = h("input", { type: "checkbox", checked: Boolean(point.start), onchange: () => {
      for (const one of edit.points) one.start = false;
      point.start = start.checked;
      this.touched();
    } });
    return h("section", label(`POINT ${edit.picked + 1} OF ${edit.points.length}`),
      h("label.tv-slide", "Height", height, up, h("span.dim", "sections up")),
      h("p.tv-note", "A gate one section high is flown through at 0.5. Going over one is about 1.5."),
      h("label.tv-field", h("span", "A move starts here, called"), name),
      h("label.tv-check", start, "The start/finish gate is here"),
      h("div.row", secondary("Take this point away", () => this.removePoint(), { icon: "trash" })),
    );
  }

  /** Leaves, asking first when there are changes that would be lost. */
  async close({ sure = false } = {}) {
    if (!sure && this.edit?.dirty && !(await confirm({ title: "Leave without keeping your changes?", message: "What you changed in this track's 3D view hasn't been kept.", yes: "Leave", destructive: true }))) return;
    window.removeEventListener("keydown", this.onKey, true);
    this.watch?.disconnect();
    this.unhear?.();
    app.trackView = null;
    fill(document.getElementById("trackview"));
    document.getElementById("stage").removeAttribute("inert");
    loadTrack(this.track).then(render);
  }

  // ---- Changing the track.

  /** Starts on the pipes or the lap, or turns from one to the other. */
  work(mode) {
    if (!this.edit) {
      const points = lapPoints(this.model.lap);
      const start = startIndex(points, this.model.start);
      if (start >= 0) points[start].start = true;
      this.edit = { mode, before: structuredClone(this.model), points, picked: -1, hover: null, dirty: false };
      this.state.playing = false;
    }
    this.edit.mode = mode;
    this.edit.hover = null;
    this.problem = null;
    this.measure();
    if (mode === "lap") this.framePlan();
    this.chrome();
    this.fit();
  }

  /** Something of the lap changed: the track is made again from its points, and drawn. */
  touched({ list = true } = {}) {
    const edit = this.edit;
    edit.dirty = true;
    this.problem = null;
    this.model = { ...this.model, lap: lapFrom(edit.points), start: startAt(edit.points, edit.points.findIndex((point) => point.start)) };
    const had = Boolean(this.lap);
    this.measure();
    // The list of moves and the lap's controls only change when a move is named or the lap comes or goes.
    if (list && had !== Boolean(this.lap)) this.chrome();
    this.refresh();
  }

  pick(index) {
    if (!this.edit || this.edit.picked === index) return;
    this.edit.picked = index;
    this.chrome();
    this.refresh();
  }

  removePoint() {
    const edit = this.edit;
    if (!edit || edit.picked < 0) return;
    const [gone] = edit.points.splice(edit.picked, 1);
    // The move it started carries on from the next point.
    if (gone.name !== null && edit.points[edit.picked] && edit.points[edit.picked].name === null) edit.points[edit.picked].name = gone.name;
    edit.picked = Math.min(edit.picked, edit.points.length - 1);
    this.touched({ list: false });
    this.chrome();
  }

  setPipes(pipes) {
    // The parts list belonged to the pipes as they were.
    this.model = { ...this.model, pipes, parts: [] };
    this.edit.dirty = true;
    this.edit.hover = null;
    this.problem = null;
    this.measure();
    this.chrome();
    this.refresh();
  }

  async clearPipes() {
    if (await confirm({ title: "Take every pipe away?", message: "The track is left with nothing built. The lap stays as it is.", yes: "Take them away", destructive: true })) this.setPipes([]);
  }

  /** Keeps the track as the pilot's own. */
  async finishEdit() {
    if (!this.edit) return;
    if (!this.edit.dirty && this.exists) return this.leaveEdit();
    const answer = await ask("saveTrackView", this.track, this.model);
    if (answer?.problem) {
      this.problem = answer.problem;
      return this.chrome();
    }
    Object.assign(this, { model: answer.view, exists: true, own: true, given: answer.given });
    this.leaveEdit();
  }

  async discardEdit() {
    const edit = this.edit;
    if (!edit) return;
    if (edit.dirty && !(await confirm({ title: "Discard your changes?", message: "The track goes back to how it was when you started.", yes: "Discard", destructive: true }))) return;
    this.model = edit.before;
    if (!this.exists) return this.close({ sure: true });
    this.leaveEdit();
  }

  leaveEdit() {
    this.edit = null;
    this.problem = null;
    this.measure();
    this.frameTrack();
    Object.assign(this.view, this.home);
    this.state.playing = Boolean(this.lap) && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.chrome();
    this.fit();
  }

  /** Goes back to the view that comes with the app. The pilot's own goes to the Trash. */
  async revert() {
    if (!(await confirm({ title: "Use the app's own view of this track?", message: `The one you made goes to ${bin}.`, yes: "Use the app's own", destructive: true }))) return;
    const found = await ask("removeTrackView", this.track);
    if (!found) return this.close({ sure: true });
    Object.assign(this, { model: found.view, own: Boolean(found.own), given: Boolean(found.given) });
    this.leaveEdit();
  }

  // ---- Playing and looking round.

  toggle() {
    if (!this.lap) return;
    this.state.playing = !this.state.playing;
    this.refresh();
  }

  setPace(seconds) {
    this.state.lapTime = Math.min(30, Math.max(3, seconds));
    this.pace.value = String(this.state.lapTime);
    this.paceOut.textContent = `${this.state.lapTime.toFixed(1)} s`;
  }

  turn(by, tiltBy) {
    this.view.turn += by;
    this.view.tilt = Math.max(0.04, Math.min(1.4, this.view.tilt + tiltBy));
    this.refresh();
  }

  zoom(by) {
    this.view.far = Math.max(this.home.far * 0.6, Math.min(this.home.far * 3, this.view.far * by));
    this.refresh();
  }

  key(event) {
    if (event.metaKey || event.ctrlKey || event.altKey || sheetIsOpen()) return;
    const typing = ["INPUT", "TEXTAREA"].includes(event.target?.tagName) && !["range", "checkbox"].includes(event.target.type);
    if (typing) return;
    const edit = this.edit, point = edit?.mode === "lap" ? edit.points[edit.picked] : null;
    const onPicture = event.target === this.canvas, onSlider = event.target?.type === "range";
    const turns = { ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0], ArrowUp: [0, 0.06], ArrowDown: [0, -0.06] }[event.key];
    const nudge = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] }[event.key];
    if (event.key === "Escape") this.close();
    else if (event.key === " " && event.target?.tagName !== "BUTTON") this.toggle();
    else if (point && (event.key === "Delete" || event.key === "Backspace")) this.removePoint();
    else if (point && nudge && !onPicture && !onSlider) {
      point.at[0] = Math.max(-reach.out, Math.min(reach.out, snap(point.at[0] + nudge[0])));
      point.at[1] = Math.max(-reach.out, Math.min(reach.out, snap(point.at[1] + nudge[1])));
      this.touched();
    } else if (point && (event.key === "[" || event.key === "]")) {
      point.at[2] = Math.max(0, Math.min(highest, snap(point.at[2] + (event.key === "]" ? 0.25 : -0.25))));
      this.touched();
      this.chrome();
    } else if (turns && onPicture) this.turn(...turns);
    else if ((event.key === "+" || event.key === "=") && onPicture) this.zoom(0.9);
    else if (event.key === "-" && onPicture) this.zoom(1.1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Where in a canvas a pointer is. */
  spot(canvas, event) {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** The picture: one finger or the mouse turns it, two fingers or the wheel zoom, and a click
   *  that doesn't move adds or takes away what is under it. */
  listen() {
    const canvas = this.canvas, fingers = this.fingers;
    const spread = () => {
      const [a, b] = [...fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener("pointerdown", (event) => {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.press = { x: event.clientX, y: event.clientY, moved: false };
    });
    canvas.addEventListener("pointermove", (event) => {
      const was = fingers.get(event.pointerId);
      if (!was) return this.hoverAt(this.spot(canvas, event));
      if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 4) this.press.moved = true;
      // A click with a little wobble in it isn't a turn.
      if (this.press && !this.press.moved) return;
      const before = fingers.size === 2 ? spread() : 0;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (fingers.size === 2) {
        if (before) this.zoom(before / spread());
        return;
      }
      this.turn((event.clientX - was.x) * 0.008, (event.clientY - was.y) * 0.006);
    });
    canvas.addEventListener("pointerup", (event) => {
      const clicked = fingers.has(event.pointerId) && this.press && !this.press.moved && fingers.size === 1;
      fingers.delete(event.pointerId);
      this.press = null;
      if (clicked) this.clickAt(this.spot(canvas, event));
    });
    canvas.addEventListener("pointercancel", (event) => fingers.delete(event.pointerId));
    canvas.addEventListener("pointerleave", () => this.hoverAt(null));
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoom(Math.exp(event.deltaY * 0.0012));
    }, { passive: false });
  }

  /** Which section, there or on offer, is under a place in the picture. */
  sectionAt(spot) {
    if (this.edit?.mode !== "pipes" || !spot) return null;
    const pipes = this.model.pipes, all = [...pipes, ...this.ghosts];
    const index = edgeAt(all, camera(this.view, this.middle), spot.x, spot.y);
    return index < 0 ? null : { edge: all[index], there: index < pipes.length };
  }

  hoverAt(spot) {
    if (this.edit?.mode !== "pipes") return;
    const found = this.sectionAt(spot), was = this.edit.hover;
    if (JSON.stringify(found) === JSON.stringify(was)) return;
    this.edit.hover = found;
    this.canvas.style.cursor = found ? "pointer" : "";
    this.refresh();
  }

  clickAt(spot) {
    const edit = this.edit;
    if (edit?.mode === "pipes") {
      const found = this.sectionAt(spot);
      if (found) this.setPipes(togglePipe(this.model.pipes, ...found.edge));
    } else if (edit?.mode === "lap") {
      // A point of the lap can be picked out in the picture too.
      const see = camera(this.view, this.middle);
      let best = -1, bestFar = 13;
      edit.points.forEach((point, index) => {
        const at = see(point.at);
        const far = at ? Math.hypot(at.x - spot.x, at.y - spot.y) : Infinity;
        if (far < bestFar) [best, bestFar] = [index, far];
      });
      if (best >= 0) this.pick(best);
    }
  }

  // ---- The plan: the track from above, where the lap is drawn.

  /** How much of the floor the plan shows: the track and the lap, with room to fly round them. */
  framePlan() {
    const places = [...this.model.pipes.flat(), ...this.edit.points.map((point) => point.at)];
    const all = places.length > 0 ? places : [[0, 0, 0], [1, 1, 0]];
    const low = [0, 1].map((axis) => Math.min(...all.map((place) => place[axis]))), high = [0, 1].map((axis) => Math.max(...all.map((place) => place[axis])));
    Object.assign(this.plan, { span: Math.max(high[0] - low[0], high[1] - low[1]) + 4, cx: (low[0] + high[0]) / 2, cy: (low[1] + high[1]) / 2 });
  }

  /** How many pixels a section is on the plan. */
  get planScale() { return Math.min(this.plan.w, this.plan.h) / this.plan.span; }

  /** A place on the grid as a place on the plan: x to the right, y up the screen. */
  toPlan(at) {
    return { x: this.plan.w / 2 + (at[0] - this.plan.cx) * this.planScale, y: this.plan.h / 2 - (at[1] - this.plan.cy) * this.planScale };
  }

  /** A place on the plan as one on the grid, to a quarter of a section, and kept inside what the plan shows. */
  fromPlan(spot) {
    const scale = this.planScale, inside = (value, middle, room) => Math.max(middle - room / scale / 2 + 0.25, Math.min(middle + room / scale / 2 - 0.25, value));
    return [
      snap(inside(this.plan.cx + (spot.x - this.plan.w / 2) / scale, this.plan.cx, this.plan.w)),
      snap(inside(this.plan.cy - (spot.y - this.plan.h / 2) / scale, this.plan.cy, this.plan.h)),
    ];
  }

  listenToPlan() {
    const canvas = this.planCanvas;
    canvas.addEventListener("pointerdown", (event) => {
      const edit = this.edit;
      if (edit?.mode !== "lap") return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      const spot = this.spot(canvas, event);
      let hit = -1, hitFar = 14;
      edit.points.forEach((point, index) => {
        const at = this.toPlan(point.at), far = Math.hypot(at.x - spot.x, at.y - spot.y);
        // Of two on top of each other, the one already picked out is the one meant.
        if (far < hitFar - (index === edit.picked ? -1 : 0)) [hit, hitFar] = [index, far];
      });
      if (hit < 0) {
        // A new point goes after the one picked out, at its height, or at the end at gate height.
        const [x, y] = this.fromPlan(spot), after = edit.picked >= 0 ? edit.picked : edit.points.length - 1;
        edit.points.splice(after + 1, 0, { at: [x, y, edit.points[after]?.at[2] ?? 0.5], name: edit.points.length === 0 ? "" : null });
        hit = after + 1;
        edit.picked = hit;
        this.touched({ list: false });
        this.chrome();
      } else if (hit !== edit.picked) {
        this.pick(hit);
      }
      this.dragging = hit;
    });
    canvas.addEventListener("pointermove", (event) => {
      const point = this.edit?.points[this.dragging];
      if (!point || this.edit.mode !== "lap") return;
      const [x, y] = this.fromPlan(this.spot(canvas, event));
      if (x === point.at[0] && y === point.at[1]) return;
      point.at[0] = x;
      point.at[1] = y;
      this.touched();
    });
    for (const name of ["pointerup", "pointercancel"]) canvas.addEventListener(name, () => { this.dragging = -1; });
  }

  drawPlan() {
    const edit = this.edit, pen = this.planPen, { w, h: tall, cx, cy } = this.plan;
    if (edit?.mode !== "lap" || w === 0 || tall === 0) return;
    pen.clearRect(0, 0, w, tall);
    pen.fillStyle = paint.floor;
    pen.fillRect(0, 0, w, tall);
    const scale = this.planScale, line = (a, b) => {
      const pa = this.toPlan(a), pb = this.toPlan(b);
      pen.moveTo(pa.x, pa.y);
      pen.lineTo(pb.x, pb.y);
    };
    // The floor's grid, a section to a square, as far as the plan shows.
    const [x0, x1, y0, y1] = [cx - w / scale / 2, cx + w / scale / 2, cy - tall / scale / 2, cy + tall / scale / 2];
    pen.strokeStyle = paint.grid;
    pen.lineWidth = 1;
    pen.beginPath();
    for (let x = Math.ceil(x0); x <= x1; x += 1) line([x, y0], [x, y1]);
    for (let y = Math.ceil(y0); y <= y1; y += 1) line([x0, y], [x1, y]);
    pen.stroke();
    // Pipes lying along the floor are faint, ones up in the air are bright and say how high. Poles are dots.
    pen.lineCap = "round";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    const flat = this.model.pipes.filter(([a, b]) => a[2] === b[2]).sort((p, q) => p[0][2] - q[0][2]);
    for (const [a, b] of flat) {
      pen.strokeStyle = a[2] === 0 ? "rgba(241, 243, 245, 0.3)" : paint.pipe;
      pen.lineWidth = Math.max(2, scale * 0.045);
      pen.beginPath();
      line(a, b);
      pen.stroke();
    }
    const poles = new Set(this.model.pipes.filter(([a, b]) => a[2] !== b[2]).map(([a]) => `${a[0]},${a[1]}`));
    for (const where of poles) {
      const at = this.toPlan(where.split(",").map(Number));
      pen.fillStyle = paint.pipe;
      pen.beginPath();
      pen.arc(at.x, at.y, Math.max(3.5, scale * 0.06), 0, 7);
      pen.fill();
    }
    pen.font = `700 ${Math.max(9, Math.min(12, scale * 0.16))}px system-ui, "Inter", sans-serif`;
    for (const [a, b] of flat) {
      if (a[2] === 0) continue;
      const at = this.toPlan([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), sideways = a[0] !== b[0];
      pen.fillStyle = paint.shade;
      pen.fillText(String(a[2]), at.x + (sideways ? 0 : scale * 0.13), at.y - (sideways ? scale * 0.13 : 0));
    }
    // The lap: its line, then its points in the order they are flown.
    pen.strokeStyle = paint.accent;
    pen.lineWidth = 2;
    pen.globalAlpha = 0.6;
    pen.beginPath();
    if (this.lap) {
      this.lap.line.forEach((entry, index) => {
        const at = this.toPlan(entry.point);
        if (index === 0) pen.moveTo(at.x, at.y);
        else pen.lineTo(at.x, at.y);
      });
      pen.closePath();
    } else {
      edit.points.forEach((point, index) => {
        const at = this.toPlan(point.at);
        if (index === 0) pen.moveTo(at.x, at.y);
        else pen.lineTo(at.x, at.y);
      });
    }
    pen.stroke();
    pen.globalAlpha = 1;
    const radius = Math.max(8, Math.min(11, scale * 0.16));
    edit.points.forEach((point, index) => {
      const at = this.toPlan(point.at), picked = index === edit.picked;
      if (point.start) {
        pen.strokeStyle = paint.text;
        pen.lineWidth = 1.5;
        pen.beginPath();
        pen.arc(at.x, at.y, radius + 4, 0, 7);
        pen.stroke();
      }
      pen.fillStyle = picked ? paint.accent : "#16191e";
      pen.strokeStyle = paint.accent;
      pen.lineWidth = 1.5;
      pen.beginPath();
      pen.arc(at.x, at.y, radius, 0, 7);
      pen.fill();
      pen.stroke();
      pen.fillStyle = picked ? paint.dark : paint.text;
      pen.font = `700 ${radius < 10 ? 9 : 10}px system-ui, "Inter", sans-serif`;
      pen.fillText(String(index + 1), at.x, at.y + 0.5);
    });
  }

  // ---- Drawing.

  fit() {
    const dense = Math.min(2, devicePixelRatio || 1);
    const box = this.canvas.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      this.view.width = box.width;
      this.view.height = box.height;
      this.canvas.width = Math.round(box.width * dense);
      this.canvas.height = Math.round(box.height * dense);
      this.pen.setTransform(dense, 0, 0, dense, 0, 0);
    }
    const plan = this.planBox.hidden ? { width: 0, height: 0 } : this.planBox.getBoundingClientRect();
    Object.assign(this.plan, { w: Math.floor(plan.width), h: Math.floor(plan.height) });
    if (this.plan.w > 0 && this.plan.h > 0) {
      this.planCanvas.width = Math.round(this.plan.w * dense);
      this.planCanvas.height = Math.round(this.plan.h * dense);
      this.planPen.setTransform(dense, 0, 0, dense, 0, 0);
    }
    this.refresh();
  }

  refresh() {
    const move = this.draw(this.state.share);
    if (move !== this.state.move) {
      this.moveButtons.forEach((button, index) => button.setAttribute("aria-current", String(index === move)));
      this.state.move = move;
    }
    if (document.activeElement !== this.place) this.place.value = String(Math.round((((this.state.share % 1) + 1) % 1) * 1000));
    this.playButton.textContent = this.state.playing ? "Pause" : "Play";
    this.drawPlan();
  }

  /** Draws the track with the drone a share of the way round its lap. Gives the move it is in. */
  draw(share) {
    const pen = this.pen, track = this.model, edit = this.edit, w = this.view.width, height = this.view.height;
    if (w === 0) return -1;
    const see = camera(this.view, this.middle);
    pen.clearRect(0, 0, w, height);
    const glow = pen.createRadialGradient(w / 2, height * 0.62, 0, w / 2, height * 0.62, Math.max(w, height) * 0.6);
    glow.addColorStop(0, paint.glow);
    glow.addColorStop(1, paint.floor);
    pen.fillStyle = glow;
    pen.fillRect(0, 0, w, height);
    const stroke = (a, b) => {
      const pa = see(a), pb = see(b);
      if (pa && pb) {
        pen.moveTo(pa.x, pa.y);
        pen.lineTo(pb.x, pb.y);
      }
    };

    // The floor, a section to a square, two sections out past the track on every side.
    const [x0, x1, y0, y1] = [this.low[0] - 2, this.high[0] + 2, this.low[1] - 2, this.high[1] + 2];
    pen.strokeStyle = paint.grid;
    pen.lineWidth = 1;
    pen.beginPath();
    for (let x = x0; x <= x1; x += 1) stroke([x, y0, 0], [x, y1, 0]);
    for (let y = y0; y <= y1; y += 1) stroke([x0, y, 0], [x1, y, 0]);
    pen.stroke();
    if (track.start) {
      const mark = see([track.start.at[0] - track.start.heading[0] * 0.55, track.start.at[1] - track.start.heading[1] * 0.55, 0]);
      if (mark) {
        pen.fillStyle = paint.faint;
        pen.font = `700 ${Math.max(9, Math.min(13, mark.size * 0.09))}px system-ui, "Inter", sans-serif`;
        pen.textAlign = "center";
        pen.textBaseline = "alphabetic";
        pen.fillText("START", mark.x, mark.y);
      }
    }

    // While the pipes are being built: where a section could go next, faintly.
    if (edit?.mode === "pipes") {
      pen.strokeStyle = "rgba(255, 255, 255, 0.26)";
      pen.lineWidth = 1.5;
      pen.setLineDash([4, 5]);
      pen.beginPath();
      for (const [a, b] of this.ghosts) stroke(a, b);
      pen.stroke();
      pen.setLineDash([]);
      if (track.pipes.length === 0) {
        const first = see([0, 0, 0]);
        if (first) {
          pen.fillStyle = paint.faint;
          pen.beginPath();
          pen.arc(first.x, first.y, 4, 0, 7);
          pen.fill();
        }
      }
    }
    // While the lap is being drawn: the whole of its line, faintly, under the track.
    if (edit?.mode === "lap" && this.lap) {
      pen.strokeStyle = paint.accent;
      pen.globalAlpha = 0.4;
      pen.lineWidth = 1.5;
      pen.beginPath();
      this.lap.line.forEach((entry, index) => stroke(entry.point, this.lap.line[(index + 1) % this.lap.line.length].point));
      pen.stroke();
      pen.globalAlpha = 1;
    }

    // Everything else is cut into short pieces and drawn from the back forwards, so that the line
    // of the lap passes in front of some of a pipe and behind the rest of it.
    const pieces = [];
    for (const [a, b] of track.pipes) {
      for (let n = 0; n < 16; n += 1) {
        const at = (t) => a.map((value, k) => value + (b[k] - value) * t);
        const pa = see(at(n / 16)), pb = see(at((n + 1) / 16));
        if (pa && pb) pieces.push({ kind: n === 7 ? "red" : n === 8 ? "blue" : "pipe", pa, pb, depth: (pa.depth + pb.depth) / 2 });
      }
    }
    for (const joint of this.joints) {
      const p = see(joint);
      if (p) pieces.push({ kind: "joint", pa: p, depth: p.depth - 0.01 });
    }
    let move = -1;
    if (this.lap) {
      const drone = this.lap.placeAt(share), tail = 0.16, steps = 54;
      move = drone.move;
      for (let n = 0; n < steps; n += 1) {
        const pa = see(this.lap.placeAt(share - (tail * (n + 1)) / steps).point), pb = see(this.lap.placeAt(share - (tail * n) / steps).point);
        if (pa && pb) pieces.push({ kind: "trail", pa, pb, depth: (pa.depth + pb.depth) / 2, fade: 1 - n / steps });
      }
      const body = see(drone.point);
      if (body) pieces.push({ kind: "drone", pa: body, depth: body.depth - 0.02 });
    }
    pieces.sort((p, q) => q.depth - p.depth);

    /**
     * A piece of pipe from one place to another, as wide at each end as it looks from there, and
     * running `over` past both ends. Pieces only butted together show a faint tick at every join,
     * where the soft edge of one lets the other's darker rim through. So the rim runs half a pixel
     * over and the light band a pixel and a half: each soft edge then lies on its own colour.
     */
    const length = (pa, pb, colour, share_, dx, dy, over) => {
      const long = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (long < 0.01) return;
      const ux = (pb.x - pa.x) / long, uy = (pb.y - pa.y) / long;
      const wa = Math.max(1.2, pa.size * pipeWidth), wb = Math.max(1.2, pb.size * pipeWidth);
      const ax = pa.x - ux * over + dx * wa, ay = pa.y - uy * over + dy * wa, bx = pb.x + ux * over + dx * wb, by = pb.y + uy * over + dy * wb;
      const ha = (wa * share_) / 2, hb = (wb * share_) / 2;
      pen.fillStyle = colour;
      pen.beginPath();
      pen.moveTo(ax - uy * ha, ay + ux * ha);
      pen.lineTo(bx - uy * hb, by + ux * hb);
      pen.lineTo(bx + uy * hb, by - ux * hb);
      pen.lineTo(ax + uy * ha, ay - ux * ha);
      pen.closePath();
      pen.fill();
    };

    pen.lineCap = "round";
    for (const piece of pieces) {
      const size = piece.pa.size;
      if (piece.kind === "joint") {
        pen.fillStyle = paint.shade;
        pen.beginPath();
        pen.arc(piece.pa.x, piece.pa.y, size * pipeWidth * 0.78, 0, 7);
        pen.fill();
        pen.fillStyle = paint.pipe;
        pen.beginPath();
        pen.arc(piece.pa.x - size * 0.006, piece.pa.y - size * 0.008, size * pipeWidth * 0.56, 0, 7);
        pen.fill();
      } else if (piece.kind === "trail") {
        pen.globalAlpha = piece.fade * piece.fade;
        pen.shadowColor = paint.accent;
        pen.shadowBlur = 14;
        pen.strokeStyle = paint.accent;
        pen.lineWidth = Math.max(2, size * 0.042 * (0.4 + 0.6 * piece.fade));
        pen.beginPath();
        pen.moveTo(piece.pa.x, piece.pa.y);
        pen.lineTo(piece.pb.x, piece.pb.y);
        pen.stroke();
        pen.globalAlpha = 1;
        pen.shadowBlur = 0;
      } else if (piece.kind === "drone") {
        pen.shadowColor = paint.accent;
        pen.shadowBlur = 22;
        pen.fillStyle = paint.accent;
        pen.beginPath();
        pen.arc(piece.pa.x, piece.pa.y, Math.max(4.5, size * 0.07), 0, 7);
        pen.fill();
        pen.shadowBlur = 0;
        pen.fillStyle = paint.text;
        pen.beginPath();
        pen.arc(piece.pa.x, piece.pa.y, Math.max(2, size * 0.03), 0, 7);
        pen.fill();
      } else if (piece.kind === "pipe") {
        // A lighter band up and to the left of the middle makes it a round pipe.
        length(piece.pa, piece.pb, paint.shade, 1, 0, 0, 0.5);
        length(piece.pa, piece.pb, paint.pipe, 0.62, -0.12, -0.14, 1.5);
      } else {
        length(piece.pa, piece.pb, paint[piece.kind], 1, 0, 0, 0.5);
      }
    }

    // What a click would do, over everything: yellow for a section that would go on, red for one that would come off.
    if (edit?.mode === "pipes" && edit.hover) {
      const pa = see(edit.hover.edge[0]), pb = see(edit.hover.edge[1]);
      if (pa && pb) {
        pen.strokeStyle = edit.hover.there ? paint.away : paint.accent;
        pen.lineWidth = Math.max(3, ((pa.size + pb.size) / 2) * pipeWidth * 1.15);
        pen.globalAlpha = edit.hover.there ? 0.85 : 0.95;
        pen.beginPath();
        pen.moveTo(pa.x, pa.y);
        pen.lineTo(pb.x, pb.y);
        pen.stroke();
        pen.globalAlpha = 1;
      }
    }
    // The lap's points, numbered as on the plan.
    if (edit?.mode === "lap") {
      pen.textAlign = "center";
      pen.textBaseline = "middle";
      edit.points.forEach((point, index) => {
        const at = see(point.at);
        if (!at) return;
        const picked = index === edit.picked, radius = picked ? 8 : 6;
        pen.fillStyle = picked ? paint.accent : "#16191e";
        pen.strokeStyle = paint.accent;
        pen.lineWidth = 1.5;
        pen.beginPath();
        pen.arc(at.x, at.y, radius, 0, 7);
        pen.fill();
        pen.stroke();
        pen.fillStyle = picked ? paint.dark : paint.text;
        pen.font = `700 ${picked ? 9 : 8}px system-ui, "Inter", sans-serif`;
        pen.fillText(String(index + 1), at.x, at.y + 0.5);
      });
    }
    return move;
  }
}

/**
 * Opens a track's 3D view over the window. A track with none yet opens ready to be built. `still`
 * holds the drone at a place in the lap, and `from` is where to look from.
 */
export async function openTrackView(track, { still = null, from = null } = {}) {
  if (app.trackView || app.editor) return false;
  const found = await ask("trackView", track);
  const laps = (app.tracks.get(track)?.summary.runs ?? []).map((run) => Number(run.bestLap)).filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  const view = new TrackView(track, found, laps.length > 0 ? Math.min(...laps) : null);
  if (still !== null) Object.assign(view.state, { playing: false, share: still });
  if (from) Object.assign(view.view, from);
  view.open();
  if (!found) view.work("pipes");
  return true;
}
