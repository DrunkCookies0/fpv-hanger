// The sound wave window: the chosen song by itself, big enough to see where a drum lands, to mark
// it by eye and to pick the moment that goes on the start gate. It sits over the marker editor,
// with a playhead that runs in song time and playback of just the song. The marks made in it are
// the editor's.

import { app, ask } from "../core.js";
import { h, fill, redraw, icon, label, primary, secondary } from "../ui.js";
import { menu } from "../sheets.js";
import { keys } from "../words.js";
import { clock } from "../../shared/panel.js";
import { levels, songClock } from "./editor.js";

const colours = { accent: "#ffd60a", bass: "#f54d33", drop: "#5cccff", mark: "#ff66bd", good: "#45db85", faint: "rgba(255,255,255,0.32)", card: "22,25,30" };
const face = () => getComputedStyle(document.body).getPropertyValue("--face") || "sans-serif";
/** The shortest stretch the window zooms in to. */
const closest = 0.25;
const waveTop = 26, footHeight = 20;

export class SoundWave {
  constructor(editor, at) {
    this.editor = editor;
    this.length = editor.songLength;
    /** The playhead, in seconds into the song. */
    this.now = at;
    this.playing = false;
    /** The stretch of the song on show. */
    this.visible = { from: 0, to: Math.max(this.length, closest) };
    this.drag = null;
    this.moved = false;
    this.pointer = null;
    this.build();
    this.draw();
  }

  close() {
    this.stop();
    fill(this.editor.waveHolder);
    this.editor.waveHolder.classList.remove("open");
  }

  // Playing and moving.

  stop() {
    this.playing = false;
    this.editor.sound?.stop();
  }

  /** Moves the playhead. Playback carries on from there. */
  go(time, follow = true) {
    this.now = Math.min(Math.max(0, time), this.length);
    if (follow) this.keepInView(false);
    if (this.playing) this.editor.sound.play({ from: this.now });
    this.draw();
  }

  togglePlay() {
    if (this.playing) return this.pause();
    if (this.now >= this.length - 0.05) this.go(0);
    this.playing = true;
    this.editor.sound.play({ from: this.now });
    const each = () => {
      if (!this.playing || this.editor.soundWave !== this) return;
      const at = this.editor.sound.position();
      if (at === null) {
        // It ran off the end of the song.
        this.playing = false;
        this.now = this.length;
        return this.draw();
      }
      this.now = Math.min(Math.max(0, at), this.length);
      this.keepInView(true);
      this.drawMoved();
      requestAnimationFrame(each);
    };
    requestAnimationFrame(each);
    this.draw();
  }

  pause() {
    if (!this.playing) return;
    const at = this.editor.sound.position();
    this.playing = false;
    this.editor.sound.stop();
    if (at !== null) this.now = Math.min(Math.max(0, at), this.length);
    this.draw();
  }

  keepInView(paging) {
    const width = this.visible.to - this.visible.from;
    if (this.now >= this.visible.from && this.now <= this.visible.to) return;
    this.show(paging ? this.now - width * 0.05 : this.now - width / 2, width);
  }

  /** Shows a stretch of the song, kept inside it. */
  show(start, width) {
    const wide = Math.min(Math.max(width, closest), Math.max(this.length, closest));
    const lower = Math.min(Math.max(0, start), Math.max(0, this.length - wide));
    this.visible = { from: lower, to: lower + wide };
  }

  /** Zooms in or out, keeping the moment at `anchor` where it is on screen. Without one, the playhead stays put. */
  zoom(factor, anchor = null) {
    const width = this.visible.to - this.visible.from;
    const inView = this.now >= this.visible.from && this.now <= this.visible.to;
    const pivot = anchor ?? (inView ? this.now : this.visible.from + width / 2);
    const wider = Math.min(Math.max(width * factor, closest), Math.max(this.length, closest));
    this.show(pivot - ((pivot - this.visible.from) / width) * wider, wider);
    this.draw();
  }

  pan(seconds) {
    this.show(this.visible.from + seconds, this.visible.to - this.visible.from);
    this.draw();
  }

  showAll() {
    this.visible = { from: 0, to: Math.max(this.length, closest) };
    this.draw();
  }

  // Marks.

  /** Marks the song where the playhead is: during playback, the moment it was pressed, on the beat
   *  when catching on the beat is switched on. */
  mark() {
    const editor = this.editor;
    let time = this.playing ? editor.sound.position() ?? this.now : this.now;
    if (this.playing && editor.snapToBeat) time = editor.beatNear(time) ?? time;
    const mark = editor.addSongMark(time);
    if (mark !== null && !this.playing) this.go(mark);
  }

  /** Removes the mark the playhead is on. */
  removeMarkHere() {
    const mark = this.editor.songMarkAt(this.now);
    if (mark !== null) this.editor.removeSongMark(mark);
  }

  /** Moves the mark under the playhead a little, taking the playhead with it. */
  nudge(seconds) {
    const editor = this.editor, mark = this.playing ? null : editor.songMarkAt(this.now);
    if (mark === null) return;
    const moved = Math.round((mark + seconds) * 1000) / 1000;
    if (moved < 0 || moved > this.length || editor.songMarks.some((one) => one !== mark && Math.abs(one - moved) < 0.02)) return;
    editor.remember();
    editor.edit.songMarks = editor.songMarks.map((one) => (one === mark ? moved : one)).sort((a, b) => a - b);
    this.go(moved);
    editor.drawChanged();
  }

  /** To the mark or drop before or after the playhead. */
  jump(direction) {
    const points = [...this.editor.songMarks, ...this.editor.spots.map((spot) => spot.time)].sort((a, b) => a - b);
    const next = direction < 0 ? points.findLast((point) => point < this.now - 0.002) : points.find((point) => point > this.now + 0.002);
    if (next === undefined) return;
    this.pause();
    this.go(next);
  }

  /** A key pressed while the window is open. True when it was for this. */
  key(event, { command, letter }) {
    const editor = this.editor, fps = editor.fps.value;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (event.key === " " || event.code === "Space") {
      document.activeElement?.blur?.();
      this.togglePlay();
    } else if (direction !== 0) {
      if (command) this.nudge(direction * (event.shiftKey ? 0.01 : 0.001));
      else {
        // A frame of the video at a time, as on the timeline.
        this.pause();
        this.go(this.now + direction * (event.altKey ? 1 : event.shiftKey ? 10 / fps : 1 / fps));
      }
    } else if (event.key === "ArrowUp") this.jump(-1);
    else if (event.key === "ArrowDown") this.jump(1);
    else if (event.key === "Backspace" || event.key === "Delete") this.removeMarkHere();
    else if (letter === "m" || event.code === "KeyM") {
      // The same keys as for the clip's markers, here for the marks in the song.
      const what = { "": () => this.mark(), s: () => this.jump(1), cs: () => this.jump(-1), a: () => this.removeMarkHere(), ca: () => editor.removeAllSongMarks() }[`${command ? "c" : ""}${event.altKey ? "a" : ""}${event.shiftKey ? "s" : ""}`];
      if (!what) return false;
      what();
    } else if (!command && letter === "b") this.mark();
    else if (command && letter === "z") editor.undo().then(() => this.draw());
    else return false;
    return true;
  }

  // Drawing.

  build() {
    this.head = h("div.row.wave-head");
    this.overview = h("canvas.wave-overview", { help: "The whole song. Click or drag to move through it." });
    this.canvas = h("canvas.wave-canvas");
    this.controls = h("div.row.wave-controls");
    this.clockText = h("div.wave-clock");
    this.placementText = h("span.wave-placement");
    const panel = h("div.wave", { onclick: (event) => event.stopPropagation() },
      this.head, this.overview, this.canvas, this.controls,
      h("div.ed-hint", `Space play  ·  click or drag to move along  ·  double-click to mark  ·  drag a mark to move it  ·  M mark  ·  ${keys("delete")} remove  ·  ← → one frame  ·  ${keys("cmd", "left")} ${keys("cmd", "right")} nudge a mark  ·  ↑ ↓ marks and drops  ·  scroll to move along  ·  pinch or ${keys("alt")}-scroll to zoom  ·  Esc close`),
    );
    const holder = this.editor.waveHolder;
    // The editor is dimmed and out of reach behind it. A click on the dimmed part closes the window.
    holder.onclick = () => this.editor.closeSoundWave();
    holder.classList.add("open");
    fill(holder, panel);
    this.wire();
  }

  /** Everything: after a mark, a move of the song, or what the app heard arriving. */
  draw() {
    const editor = this.editor, heard = editor.analysis;
    redraw(this.head,
      label("SOUND WAVE"), h("span.wave-song", editor.edit.song ?? ""),
      editor.listening ? h("span.dim.small.semibold", "Listening for the tempo and the drops…")
        : heard?.tempo ? h("span.ed-tempo", heard.beatLength ? `${Math.round(heard.tempo * 10) / 10} BPM` : `About ${Math.round(heard.tempo * 10) / 10} BPM`) : null,
      h("span.spacer"),
      editor.spots.length > 0 && [label("DROPS"), editor.spots.map((spot) => secondary(songClock(spot.time), () => {
        this.pause();
        this.go(spot.time);
      }, { help: "Go to this drop" }))],
      primary("Done", () => editor.closeSoundWave(), { help: "Back to the timeline (Esc)" }),
    );
    const onMark = editor.songMarkAt(this.now) !== null && !this.playing;
    const gate = editor.gateUnder(this.now);
    this.wasOnMark = onMark;
    redraw(this.controls,
      h("div.wave-readout", this.clockText, h("div.ed-frame", "INTO THE SONG")),
      primary("", () => this.togglePlay(), { icon: this.playing ? "pause" : "play", class: "ed-play", help: "Play the song from here, or pause (Space)", "aria-label": this.playing ? "Pause the song" : "Play the song" }),
      onMark ? secondary("Remove mark", () => this.removeMarkHere(), { help: `Remove the mark here (${keys("delete")})` })
        : h("button.button.secondary", { type: "button", help: "Mark the song here (M). While it plays, press M in time with it.", onclick: () => this.mark() }, "Mark here", h("span.keycap.light", "M")),
      secondary("Put this on the start gate", () => {
        editor.put(this.now);
        this.draw();
      }, { disabled: editor.markers.length === 0 || this.playing || gate === 0, help: "Slide the song so this moment lands as you cross the start gate" }),
      this.placementText,
      h("span.spacer"),
      h("label.check", { help: "The playhead and the marks catch on the nearest beat. They always catch on a drop." },
        h("input", { type: "checkbox", checked: editor.snapToBeat, disabled: !(heard?.beatLength > 0), onchange: (event) => {
          editor.snapToBeat = event.target.checked;
          app.state.snapToBeat = editor.snapToBeat;
          ask("remember", { snapToBeat: editor.snapToBeat });
        } }), "Catch on the beat"),
      secondary("Whole song", () => this.showAll()),
      secondary("", () => this.zoom(2), { icon: "zoomOut", help: "Zoom out", "aria-label": "Zoom out of the song" }),
      secondary("", () => this.zoom(0.5), { icon: "zoomIn", help: "Zoom in", "aria-label": "Zoom in on the song" }),
    );
    this.drawMoved();
  }

  /** Says in words where the playhead's moment plays against the start gate, as the song lies now. */
  placement() {
    const editor = this.editor, song = editor.songSpan;
    if (!song) return "";
    const gate = editor.gateUnder(this.now);
    if (gate !== null) return gate === 0 ? "This moment is on the start gate." : `This moment is on the gate that ends lap ${gate}.`;
    if (editor.markers.length === 0) return "Mark the start gate on the clip, and a moment of the song can be put on it.";
    const lead = song.from + this.now - editor.seconds(editor.markers[0]);
    return `As the song lies now, this plays ${Math.abs(lead).toFixed(2)} s ${lead < 0 ? "before" : "after"} the start gate.`;
  }

  /** What changes as the playhead moves. */
  drawMoved() {
    const editor = this.editor;
    const onMark = editor.songMarkAt(this.now) !== null && !this.playing;
    if (onMark !== this.wasOnMark) return this.draw();
    this.clockText.textContent = clock(this.now);
    this.placementText.textContent = this.placement();
    this.placementText.classList.toggle("good", editor.gateUnder(this.now) !== null);
    this.drawOverview();
    this.drawWave();
  }

  ready(canvas) {
    const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);
    return { context, width: box.width, height: box.height };
  }

  /** The whole song in one thin bar: its shape, its drops and marks, what the wave below is showing, and the playhead. */
  drawOverview() {
    const editor = this.editor;
    const { context: c, width, height } = this.ready(this.overview);
    const total = Math.max(this.length, 0.001), x = (seconds) => (seconds / total) * width;
    c.fillStyle = "rgba(255,255,255,0.07)";
    c.beginPath();
    c.roundRect(0, 0, width, height, 4);
    c.fill();
    if (editor.wave) {
      const each = total / Math.max(width, 1), bars = [];
      for (let column = 0; column < width; column += 1) {
        const found = levels(editor.wave, column * each, (column + 1) * each);
        if (found) bars.push([column, Math.max(1, found.body * (height - 4)), Math.max(1, found.bass * (height - 4))]);
      }
      c.fillStyle = "rgba(255,214,10,0.6)";
      for (const [column, tall] of bars) c.fillRect(column, (height - tall) / 2, 1, tall);
      c.fillStyle = "rgba(245,77,51,0.8)";
      for (const [column, , low] of bars) c.fillRect(column, (height - low) / 2, 1, low);
    }
    c.fillStyle = colours.drop;
    for (const spot of editor.spots) c.fillRect(x(spot.time) - 0.75, 0, 1.5, height);
    c.fillStyle = colours.mark;
    for (const mark of editor.songMarks) c.fillRect(x(mark) - 0.75, 0, 1.5, height);
    const left = x(this.visible.from), wide = Math.max(3, x(this.visible.to) - left);
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.beginPath();
    c.roundRect(left, 0, wide, height, 3);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.5)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(left + 0.5, 0.5, wide - 1, height - 1, 3);
    c.stroke();
    c.fillStyle = "#fff";
    c.fillRect(x(this.now) - 0.75, 0, 1.5, height);
  }

  /** The song's wave itself, with a ruler, the beat, the drops, the gates as the song lies now, the marks and the playhead. */
  drawWave() {
    const editor = this.editor;
    const { context: c, width, height } = this.ready(this.canvas);
    const { from, to } = this.visible, across = Math.max(to - from, 0.001);
    const x = (seconds) => ((seconds - from) / across) * width;
    const top = waveTop, bottom = height - footHeight, middle = (top + bottom) / 2, tall = (bottom - top) / 2 - 5;
    const rect = (left, y, wide, high, colour) => {
      c.fillStyle = colour;
      c.fillRect(left, y, wide, high);
    };
    const font = (size, weight) => { c.font = `${weight} ${size}px ${face()}`; };
    const words = (text, size, weight, colour, at, y, align = "left") => {
      font(size, weight);
      c.fillStyle = colour;
      c.textAlign = align;
      c.textBaseline = "middle";
      c.fillText(text, at, y + 0.5);
    };
    c.fillStyle = "rgba(255,255,255,0.045)";
    c.beginPath();
    c.roundRect(0, top, width, bottom - top, 8);
    c.fill();
    // Words over the wave, on a dark patch so they read whatever is behind them. They are drawn
    // last, over the lines, so they are kept until then.
    const tags = [];
    const tag = (parts, at, y, trailing = false) => tags.push({ parts, at, y, trailing });

    // The part of the song that is heard in the finished video, as the song lies now: a bar along the foot.
    const lies = editor.songSpan?.from ?? null, heard = editor.musicHeard;
    if (lies !== null && heard) {
      const left = Math.max(0, x(heard.from - lies)), right = Math.min(width, x(heard.to - lies));
      if (right > left) rect(left, bottom - 4, right - left, 4, "rgba(255,255,255,0.75)");
    }

    // Ruler, in time into the song.
    const step = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find((each) => (each / across) * width >= 74) ?? 120;
    for (let tick = Math.ceil(from / step - 1e-9) * step; tick <= to; tick += step) {
      const whole = Math.trunc(tick + 0.0005);
      rect(x(tick), 12, 1, 10, colours.faint);
      words(step < 1 ? songClock(tick) : `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`, 9, 600, colours.faint, x(tick) + 4, 8);
    }

    // The beat, once the view is close enough to tell the beats apart.
    const beats = [];
    const { firstBeat, beatLength } = editor.analysis ?? {};
    if (firstBeat >= 0 && beatLength > 0 && (beatLength / across) * width >= 5) {
      for (let index = Math.max(0, Math.ceil((from - firstBeat) / beatLength)); firstBeat + index * beatLength <= to; index += 1) beats.push(x(firstBeat + index * beatLength) - 0.5);
      for (const place of beats) rect(place, top, 1, bottom - top, "rgba(255,255,255,0.16)");
    }

    // The wave: at each point across, the highest the sound gets faintly, how loud it is over that,
    // and its bass inside. A drop is where the bass comes in.
    if (!editor.wave) {
      words("Drawing the sound wave…", 11, 600, colours.faint, width / 2, middle, "center");
    } else {
      const each = across / Math.max(width, 1), bars = [];
      for (let column = 0; column < width; column += 1) {
        const start = from + column * each;
        const found = levels(editor.wave, start, start + each);
        if (found) bars.push([column, found.peak, found.body, found.bass]);
      }
      ["rgba(255,214,10,0.28)", "rgba(255,214,10,0.9)", colours.bass].forEach((colour, index) => {
        c.fillStyle = colour;
        for (const bar of bars) {
          const reach = Math.max(0.5, bar[index + 1] * tall);
          c.fillRect(bar[0], middle - reach, 1, reach * 2);
        }
      });
      // The beat again, dark this time, so it shows over the wave as well as beside it.
      for (const place of beats) rect(place, top, 1, bottom - top, "rgba(0,0,0,0.4)");
      // Which colour is which.
      tag([["PEAKS", "rgba(255,214,10,0.55)"], ["LOUDNESS", colours.accent], ["BASS", colours.bass], ["DROPS", colours.drop], ["YOUR MARKS", colours.mark]], width - 10, top + 12, true);
    }
    if (lies !== null && heard) {
      const start = x(heard.from - lies), end = x(heard.to - lies);
      if (end - Math.max(start, 0) > 96 && start < width - 96) tag([["IN THE VIDEO", "rgba(255,255,255,0.9)"]], Math.max(start, 0) + 8, bottom - 15);
    }

    // The drops the app heard.
    for (const spot of editor.spots) {
      const place = x(spot.time);
      if (place < -90 || place > width + 4) continue;
      rect(place - 1.5, top, 3, bottom - top, "rgba(0,0,0,0.45)");
      c.strokeStyle = colours.drop;
      c.lineWidth = 1.5;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.moveTo(place, top);
      c.lineTo(place, bottom);
      c.stroke();
      c.setLineDash([]);
      tag([[spot.strength >= 0.995 ? "BIGGEST DROP" : "DROP", colours.drop]], place + 8, top + 12);
    }

    // The gates, where they fall in the song as it lies now.
    if (lies !== null) {
      editor.markers.forEach((marker, index) => {
        const place = x(editor.seconds(marker) - lies);
        if (place < -60 || place > width + 4) return;
        rect(place - 1, top, 2, bottom - top + 6, colours.good);
        words(index === 0 ? "START" : `LAP ${index}`, 9, 800, colours.good, place + 5, bottom + 11);
      });
    }

    // Marks.
    for (const mark of editor.songMarks) {
      const place = x(mark);
      if (place < -8 || place > width + 8) continue;
      rect(place - 1.75, top - 5, 3.5, bottom - top + 5, "rgba(0,0,0,0.45)");
      rect(place - 0.75, top - 5, 1.5, bottom - top + 5, colours.mark);
      c.beginPath();
      [[place, top - 11], [place + 6, top - 5], [place, top + 1], [place - 6, top - 5]].forEach(([px, py], index) => (index === 0 ? c.moveTo(px, py) : c.lineTo(px, py)));
      c.closePath();
      c.strokeStyle = "rgba(0,0,0,0.5)";
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = colours.mark;
      c.fill();
    }

    for (const one of tags) {
      font(9, 800);
      const sizes = one.parts.map(([text]) => c.measureText(text).width);
      const wide = sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, one.parts.length - 1) * 8;
      let place = one.trailing ? one.at - wide : one.at;
      c.fillStyle = `rgba(${colours.card},0.85)`;
      c.beginPath();
      c.roundRect(place - 4, one.y - 7.5, wide + 8, 15, 4);
      c.fill();
      one.parts.forEach(([text, colour], index) => {
        words(text, 9, 800, colour, place, one.y);
        place += sizes[index] + 8;
      });
    }

    // Playhead.
    const now = x(this.now);
    rect(now - 0.75, 0, 1.5, bottom, "#fff");
    c.beginPath();
    c.moveTo(now - 5, 0);
    c.lineTo(now + 5, 0);
    c.lineTo(now, 7);
    c.closePath();
    c.fill();
  }

  // Pointer.

  timeAt(place) { return this.visible.from + (place / Math.max(this.canvas.clientWidth, 1)) * (this.visible.to - this.visible.from); }
  /** So many points across, as seconds of the song. */
  reach(points) { return (points / Math.max(this.canvas.clientWidth, 1)) * (this.visible.to - this.visible.from); }
  /** The mark within a few points of a place across the wave, if there is one. */
  markUnder(place) {
    const time = this.timeAt(place);
    const nearest = this.editor.songMarks.reduce((best, mark) => (best === null || Math.abs(mark - time) < Math.abs(best - time) ? mark : best), null);
    return nearest !== null && Math.abs(nearest - time) <= this.reach(7) ? nearest : null;
  }

  wire() {
    const editor = this.editor;
    const at = (event, canvas) => event.clientX - canvas.getBoundingClientRect().left;
    const overview = this.overview;
    const scrub = (event) => {
      this.pause();
      this.go((at(event, overview) / Math.max(overview.clientWidth, 1)) * this.length);
    };
    overview.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      overview.setPointerCapture(event.pointerId);
      scrub(event);
    });
    overview.addEventListener("pointermove", (event) => { if (overview.hasPointerCapture(event.pointerId)) scrub(event); });

    const canvas = this.canvas;
    const dragged = (place) => {
      const here = this.timeAt(place), near = this.reach(6);
      if (this.drag.kind === "scrub") return this.go(editor.caught(here, near), false);
      if (this.drag.kind !== "mark") return;
      if (!this.moved) {
        if (Math.abs(place - this.dragFrom) < 2) return;
        editor.remember();
        this.moved = true;
      }
      this.drag.mark = editor.dragSongMark(this.drag.mark, editor.caught(here, near, this.drag.mark));
      this.go(this.drag.mark, false);
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const place = at(event, canvas);
      this.moved = false;
      this.dragFrom = place;
      this.pause();
      const mark = this.markUnder(place);
      if (mark !== null) {
        // On a mark: the playhead goes to it, and dragging from here moves it.
        this.drag = { kind: "mark", mark };
        this.go(mark, false);
      } else if (event.detail >= 2) {
        // A double-click marks the song there.
        const made = editor.addSongMark(editor.caught(this.timeAt(place), this.reach(6)));
        if (made !== null) this.go(made, false);
        this.drag = { kind: "spent" };
      } else {
        this.drag = { kind: "scrub" };
        dragged(place);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      this.pointer = at(event, canvas);
      if (canvas.hasPointerCapture(event.pointerId) && this.drag) dragged(this.pointer);
    });
    const dropped = () => {
      if (this.drag?.kind === "mark" && this.moved) editor.drawChanged();
      this.drag = null;
      this.moved = false;
    };
    canvas.addEventListener("pointerup", dropped);
    canvas.addEventListener("pointercancel", dropped);
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const place = at(event, canvas), near = this.reach(6), time = this.timeAt(place), mark = this.markUnder(place), none = editor.markers.length === 0;
      const put = (moment) => {
        editor.put(moment);
        this.draw();
      };
      menu(event, [
        ...(mark !== null ? [
          { title: "Put This Mark on the Start Gate", disabled: none, action: () => put(mark) },
          { title: "Delete This Mark", action: () => editor.removeSongMark(mark) },
        ] : [
          { title: "Mark the Song Here", action: () => editor.addSongMark(editor.caught(time, near)) },
          { title: "Put This Moment on the Start Gate", disabled: none, action: () => put(editor.caught(time, near)) },
        ]),
        "-",
        { title: "Delete All Marks", disabled: editor.songMarks.length === 0, action: () => editor.removeAllSongMarks() },
      ]);
    });
    // Two fingers or the wheel move along the song, and a pinch, or the wheel with Alt held, zooms
    // around the pointer.
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const under = this.timeAt(at(event, canvas));
      // A mouse wheel counts in clicks, a trackpad in points: a click is worth a good many points.
      const scale = event.deltaMode === 0 ? 1 : 30;
      const sideways = event.deltaX * scale, down = event.deltaY * scale;
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.deltaMode === 0 && Math.abs(down) < 50) this.zoom(Math.exp(down * 0.01), under);
      else if (event.altKey || event.metaKey || event.ctrlKey) this.zoom(Math.exp(down * 0.005), under);
      else this.pan(((Math.abs(sideways) >= Math.abs(down) ? sideways : down) / Math.max(canvas.clientWidth, 1)) * (this.visible.to - this.visible.from));
    }, { passive: false });
  }
}
