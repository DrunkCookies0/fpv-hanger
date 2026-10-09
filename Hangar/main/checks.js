// The app's checks of itself, run without showing a window: `electron . --check <which> --root
// <a copy of a library> --user-data <a scratch folder>`. Each works the real app the way a pilot
// would and says what it found. They change the library they are given, so it must be a copy.
//
//   editor   opens a run in the marker editor: every frame asked for is the frame shown, markers
//            are added, moved, undone and saved, a song is placed, the sound wave window marks it
//   video    makes a 16:9 and a 9:16 video of a run and measures what came out
//   pages    draws every page and sheet, and fails on any error in the window
//   form     opens the first track's real entry form, filled in with made-up answers, and reads
//            back what it then holds. Nothing is sent. This is how to tell whether Google has
//            changed its page.

import { app } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, cpSync, createReadStream, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { EOL, arch, cpus, release, tmpdir, totalmem, version as systemVersion } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { argument, logFile, version } from "./paths.js";
import { install, thisCopy, whatTheOldAppKept } from "./updates.js";
import { markerFile, FrameRate } from "../shared/timing.js";

/** With `--report <file>`, everything said is written there too, a line at a time as it happens,
 *  so a check that stops halfway still leaves what it had found. */
const report = argument("--report") ? resolve(argument("--report")) : null;
function note(line = "") {
  console.log(line);
  if (!report) return;
  try {
    appendFileSync(report, line + EOL);
  } catch {}
}

let failures = 0;
function say(ok, what, detail = "") {
  if (!ok) failures += 1;
  note(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
  return ok;
}

export async function run(which, tools) {
  const checks = { editor, video, pages, form, bookends, trackview, trackvideo, update, updating, carryover, everything };
  if (report) writeFileSync(report, "");
  if (!checks[which]) {
    console.error(`There is no check called ${which}. There are: ${Object.keys(checks).join(", ")}.`);
    return false;
  }
  if (!argument("--root")) {
    console.error("A check changes the library it works on. Give it a copy with --root.");
    return false;
  }
  await checks[which](tools);
  note();
  note(failures === 0 ? "Everything passed." : `${failures} thing${failures === 1 ? "" : "s"} failed.`);
  return failures === 0;
}

/** Opens the window nobody sees and gives a way to run things in its page. */
async function page({ open, window }) {
  const errors = [];
  // One window serves every check that is run in the same go.
  if (!window()) await open({ width: 1440, height: 900 });
  const contents = window().webContents;
  contents.on("console-message", (details) => {
    if (details.level === "error" || details.level === 3) errors.push(details.message);
  });
  const js = (code) => contents.executeJavaScript(`(async () => { ${code} })()`);
  await js(`await window.showForSnapshot("home")`);
  return { js, errors, contents };
}

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function editor(tools) {
  const { library } = tools;
  const track = library.tracks[0];
  if (!say(Boolean(track), "the library has a track")) return;
  const summary = await library.summary(track);
  const run = summary.runs.find((one) => one.name === argument("--run")) ?? summary.runs.at(-1);
  if (!say(Boolean(run?.clip), "the track has a run with its recording", run?.name)) return;
  // The run's marker file and what is remembered are put back at the end.
  const kept = [[run.markers, readFileSync(run.markers)], [library.storeFile, readFileSync(library.storeFile)]];
  const { js, errors } = await page(tools);
  try {
    await js(`await window.showForSnapshot(${JSON.stringify(`editor:${run.name}`)})`);
    const opened = await js(`const e = window.hangar_.app.editor; return e && { phase: e.phase, problem: e.problem, frames: e.frameCount, fps: e.fps.label, markers: e.markers, frame: e.frame, song: e.edit.song, songLength: e.songLength, spots: e.spots, kind: e.video.currentSrc.includes("-plain") ? "plain" : "wrapped" }`);
    if (!say(opened?.phase === "ready", "the clip opens in the marker editor", opened?.problem || `${opened?.frames} frames at ${opened?.fps} a second, ${opened?.kind} copy`)) return;
    const facts = await library.facts(run.clip);
    say(opened.frames === facts.frames, "it has every frame of the recording", `${opened.frames} of ${facts.frames}`);
    const expected = run.crossings.map((crossing) => Math.round(crossing * facts.fps.value));
    say(JSON.stringify(opened.markers) === JSON.stringify(expected), "its markers are the ones in the file", opened.markers.join(" "));

    // Every frame asked for is the frame shown.
    const wanted = [0, 1, 2, 59, 60, 61, 1000, 1001, Math.floor(facts.frames / 2), facts.frames - 2, facts.frames - 1, expected[0], expected[0] + 1, expected[0] - 1];
    const shown = await js(`
      const e = window.hangar_.app.editor, out = [];
      for (const frame of ${JSON.stringify(wanted)}) {
        const seen = new Promise((done) => e.video.requestVideoFrameCallback((_now, data) => done(data.mediaTime)));
        e.show(frame);
        const time = await Promise.race([seen, new Promise((done) => setTimeout(() => done(null), 3000))]);
        for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
        out.push([frame, time === null ? null : Math.round(time * e.fps.value), e.frame]);
      }
      return out;`);
    const off = shown.filter(([frame, got, at]) => got !== frame || at !== frame);
    say(off.length === 0, `${wanted.length} frames asked for were the frames shown`, off.map(([frame, got]) => `${frame} gave ${got}`).join(", "));

    // Stepping, as the arrow keys do it.
    const stepped = await js(`
      const e = window.hangar_.app.editor;
      e.show(500); const press = (key, more = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...more }));
      press("ArrowRight"); press("ArrowRight"); press("ArrowLeft"); press("ArrowRight", { shiftKey: true });
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      return e.frame;`);
    say(stepped === 511, "the arrow keys step a frame, and ten with Shift", `at frame ${stepped}`);

    // Marking, moving, undoing.
    const marked = await js(`
      const e = window.hangar_.app.editor, press = (key, more = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code: key.length === 1 ? "Key" + key.toUpperCase() : key, bubbles: true, cancelable: true, ...more }));
      const before = [...e.markers];
      e.show(300); press("m");
      const added = [...e.markers];
      press("ArrowRight", { ${process.platform === "darwin" ? "metaKey" : "ctrlKey"}: true });
      const nudged = [...e.markers], at = e.frame;
      press("z", { ${process.platform === "darwin" ? "metaKey" : "ctrlKey"}: true });
      const undone = [...e.markers];
      press("Backspace");
      e.show(300);
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      press("Backspace");
      return { before, added, nudged, at, undone, after: [...e.markers], dirty: e.dirty, laps: e.laps, best: e.best };`);
    say(marked.added.includes(300) && marked.added.length === marked.before.length + 1, "M marks the frame that is showing");
    say(marked.nudged.includes(301) && !marked.nudged.includes(300) && marked.at === 301, "the marker moves a frame, and the playhead with it");
    say(JSON.stringify(marked.undone) === JSON.stringify(marked.added), "undo puts it back");
    say(JSON.stringify(marked.after) === JSON.stringify(marked.before), "the delete key removes the marker under the playhead");

    // The timer over the picture.
    const timer = await js(`
      const e = window.hangar_.app.editor;
      e.show(e.markers[1] + 30);
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      const c = e.timer, data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let drawn = 0; for (let index = 3; index < data.length; index += 4) if (data[index] > 0) drawn += 1;
      return { shown: c.style.display, width: c.width, height: c.height, drawn };`);
    say(timer.shown === "block" && timer.drawn > 2000, "the lap timer is drawn over the picture", `${timer.drawn} pixels of it on a ${timer.width} by ${timer.height} frame`);

    // Playing moves the playhead on, and pausing parks it on a frame.
    const played = await js(`
      const e = window.hangar_.app.editor;
      e.show(e.markers[0]);
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      const from = e.frame;
      e.togglePlay();
      await new Promise((done) => setTimeout(done, 1200));
      const during = e.frame, sounding = Boolean(e.sound?.playing);
      e.pause();
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      return { from, during, parked: e.frame, sounding, playing: e.playing };`);
    say(played.during > played.from + 20 && !played.playing && Math.abs(played.parked - played.during) <= 2, "it plays, and parks on a frame when paused", `from ${played.from}, at ${played.during} after 1.2 s, parked on ${played.parked}${played.sounding ? ", with its song" : ""}`);

    // A song: chosen, listened to, a drop put on the start gate.
    const songs = await js(`return window.hangar_.app.editor.songs`);
    if (say(songs.length > 0, "the library's songs are offered", songs.join(", "))) {
      const placed = await js(`
        const e = window.hangar_.app.editor;
        await e.choose(null);
        const silent = { song: e.edit.song, sound: Boolean(e.sound) };
        await e.choose(${JSON.stringify(songs[0])});
        for (let tries = 0; tries < 400 && (e.listening || !e.sound); tries += 1) await new Promise((done) => setTimeout(done, 50));
        const spot = e.spots[0];
        if (spot) e.put(spot.time);
        for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
        return { silent, length: e.songLength, tempo: e.analysis?.tempo, spots: e.spots.length, spot: spot?.time, gate: spot ? e.gateUnder(spot.time) : null, start: e.edit.songStart, crossing: e.seconds(e.markers[0]), sounding: ${played.sounding} };`);
      say(placed.silent.song === null && !placed.silent.sound, "No music takes the song away");
      say(placed.length > 1 && placed.tempo > 0, "the song is read and listened to", `${placed.length.toFixed(2)} s, ${placed.tempo?.toFixed(1)} beats a minute, ${placed.spots} drop${placed.spots === 1 ? "" : "s"}`);
      if (placed.spot !== undefined) say(placed.gate === 0 && Math.abs(placed.start + placed.spot - placed.crossing) < 0.0006, "a drop is put on the start gate", `the song starts ${placed.start} s into the clip`);

      // The sound wave window.
      const wave = await js(`
        const e = window.hangar_.app.editor;
        await e.openSoundWave(12.345);
        const w = e.soundWave, opened = Boolean(w) && e.waveHolder.classList.contains("open");
        const before = [...e.songMarks];
        w.mark();
        const marked = [...e.songMarks];
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", ${process.platform === "darwin" ? "metaKey" : "ctrlKey"}: true, shiftKey: true, bubbles: true, cancelable: true }));
        const nudged = [...e.songMarks];
        w.removeMarkHere();
        const removed = [...e.songMarks];
        w.zoom(0.25);
        const span = w.visible.to - w.visible.from;
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        return { opened, before, marked, nudged, removed, span, closed: e.soundWave === null, length: e.songLength };`);
      say(wave.opened, "the sound wave window opens");
      say(wave.marked.length === wave.before.length + 1 && wave.marked.some((mark) => Math.abs(mark - 12.345) < 0.36), "M marks the song", wave.marked.join(" "));
      say(wave.nudged.length === wave.marked.length && JSON.stringify(wave.nudged) !== JSON.stringify(wave.marked), "a mark is nudged along");
      say(JSON.stringify(wave.removed) === JSON.stringify(wave.before), "and removed");
      say(Math.abs(wave.span - wave.length / 4) < 0.01 && wave.closed, "it zooms, and Esc closes it");
    }

    // Saving writes the marker file the lap timer reads, and what was decided about the videos.
    const saved = await js(`
      const e = window.hangar_.app.editor;
      e.show(e.markers.at(-1) + 600);
      for (let tries = 0; tries < 100 && !e.settled; tries += 1) await new Promise((done) => setTimeout(done, 20));
      e.addMarker();
      const result = await e.save();
      return { result, markers: e.markers, dirty: e.dirty, edit: e.edit, fps: { num: e.fps.num, den: e.fps.den } };`);
    say(saved.result === true && !saved.dirty, "it saves", saved.result === true ? "" : String(saved.result));
    const written = readFileSync(join(library.folder(track, "csv markers"), `${run.name}.csv`), "utf8");
    say(written === markerFile(saved.markers, new FrameRate(saved.fps.num, saved.fps.den)), "the marker file holds the markers");
    library.refresh();
    const again = (await library.summary(track)).runs.find((one) => one.name === run.name);
    say(again?.laps.length === saved.markers.length - 1, "the run is timed with the new lap", `${again?.laps.length} laps`);
    say(library.state(track).edits?.[run.name]?.song === saved.edit.song, "what was decided about its music is remembered");
    const closed = await js(`await window.hangar_.app.editor.done(); return { editor: window.hangar_.app.editor === null, page: window.hangar_.app.page.name };`);
    say(closed.editor && closed.page === "track", "Done goes back to the track");
    say(errors.length === 0, "nothing went wrong in the window", errors.slice(0, 3).join(" | "));
  } finally {
    for (const [file, bytes] of kept) writeFileSync(file, bytes);
  }
}

async function video(tools) {
  const { library, api, ffmpeg } = tools;
  const track = library.tracks[0];
  const summary = await library.summary(track);
  const run = summary.runs.find((one) => one.name === argument("--run")) ?? summary.runs[0];
  if (!say(Boolean(run?.clip), "the track has a run with its recording", run?.name)) return;
  const edit = library.state(track).edits?.[run.name] ?? {};
  const facts = await library.facts(run.clip);
  const length = Math.min(facts.frames / facts.fps.value, edit.videoEnd ?? run.crossings.at(-1) + 8) - Math.max(0, edit.videoStart ?? run.crossings[0] - 3);
  for (const [shape, width, height] of [["landscape", 1920, 1080], ["upright", 1080, 1920]].filter(([shape]) => !argument("--shape") || argument("--shape") === shape)) {
    const started = Date.now();
    const made = await api.makeVideo(track, run.name, shape);
    const file = made?.made?.path;
    if (!say(Boolean(file) && existsSync(file), `the ${shape === "landscape" ? "16:9" : "9:16"} video is made`, made?.notice?.split("\n")[0] ?? "")) continue;
    const found = await ffmpeg.probe(file);
    say(found?.width === width && found?.height === height, "it is the right shape", `${found?.width} by ${found?.height}`);
    say(Math.abs(found.frames / found.fps.value - length) < 0.05, "it covers the stretch chosen", `${(found.frames / found.fps.value).toFixed(2)} s of ${length.toFixed(2)} s`);
    say(found.fps.label === facts.fps.label, "at the recording's own frame rate", found.fps.label);
    say(Boolean(edit.song) === found.hasSound, edit.song ? "with its music" : "and silent");
    console.log(`      ${basename(file)}: ${(statSync(file).size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (!process.argv.includes("--keep")) rmSync(file, { force: true });
  }
}

/** Puts a picture before and a clip after an event's videos, makes a video, and measures it. */
async function bookends(tools) {
  const { library, api, ffmpeg, cache } = tools;
  const track = library.tracks[0], event = track.split("/")[0];
  const summary = await library.summary(track);
  const run = summary.runs.find((one) => one.name === argument("--run")) ?? summary.runs[0];
  if (!say(Boolean(run?.clip) && event !== track, "the track has a run, in an event with a folder", run?.name)) return;
  // What the library kept of the seconds is put back afterwards, or the file taken away if there was none.
  const before = existsSync(library.extrasFile) ? readFileSync(library.extrasFile) : null;
  // A picture and a short clip with sound, made for the purpose.
  const picture = join(cache, "check-title.png"), clip = join(cache, "check-outro.mp4");
  await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x16191e:s=1280x720", "-frames:v", "1", picture]);
  await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
  try {
    // 16:9 videos get a picture before and a clip after. 9:16 videos get only a picture after, held a second.
    const set = [await library.setBookend(event, "landscape", "before", picture), await library.setBookend(event, "landscape", "after", clip), await library.setBookend(event, "upright", "after", picture)];
    say(set.every((one) => one.problem === null), "a picture goes before 16:9 videos and a clip after, and a picture after 9:16 ones");
    library.setBookendSeconds(event, "landscape", "before", 1.5);
    library.setBookendSeconds(event, "upright", "after", 1);
    const found = library.bookends(event);
    say(found.landscape.before?.kind === "picture" && found.landscape.before.seconds === 1.5 && found.landscape.after?.kind === "clip" && found.upright.before === null && found.upright.after?.seconds === 1,
      "the event keeps each shape's own in its folder", [found.landscape.before?.name, found.landscape.after?.name, found.upright.after?.name].join(", "));
    const edit = library.state(track).edits?.[run.name] ?? {};
    const facts = await library.facts(run.clip);
    const main = Math.min(facts.frames / facts.fps.value, edit.videoEnd ?? run.crossings.at(-1) + 8) - Math.max(0, edit.videoStart ?? run.crossings[0] - 3);
    const expected = { landscape: { title: "16:9", more: 1.5 + 2, sound: true }, upright: { title: "9:16", more: 1, sound: Boolean(edit.song) } };
    for (const shape of ["landscape", "upright"].filter((one) => !argument("--shape") || argument("--shape") === one)) {
      const made = await api.makeVideo(track, run.name, shape);
      const file = made?.made?.path;
      if (!say(Boolean(file) && existsSync(file), `the ${expected[shape].title} video is made with its own`, made?.notice?.split("\n")[0] ?? "")) continue;
      const video = await ffmpeg.probe(file);
      const length = video.frames / video.fps.value;
      say(Math.abs(length - (main + expected[shape].more)) < 0.12, "it is as long as its parts together", `${length.toFixed(2)} s of ${(main + expected[shape].more).toFixed(2)} s`);
      say(video.hasSound === expected[shape].sound, expected[shape].sound ? "and has sound" : "and is silent, as its parts are");
      if (!process.argv.includes("--keep")) rmSync(file, { force: true });
    }
  } finally {
    for (const pair of Object.values(library.bookends(event))) for (const end of Object.values(pair)) if (end) rmSync(end.file, { force: true });
    if (before) writeFileSync(library.extrasFile, before);
    else rmSync(library.extrasFile, { force: true });
    rmSync(picture, { force: true });
    rmSync(clip, { force: true });
  }
}

/**
 * Builds a track in 3D the way a pilot would: sections clicked on and off in the picture, the lap
 * put down on the plan point by point, and the result kept and read back. The clicks are real
 * pointer events at the places things are drawn.
 */
async function trackview(tools) {
  const { library } = tools;
  const { js, errors } = await page(tools);
  const track = library.tracks[0];
  const file = library.trackViewFile(track);
  const before = existsSync(file) ? readFileSync(file) : null;
  rmSync(file, { force: true });
  const view = "window.hangar_.app.trackView";
  // A click, or a drag, on one of the view's two canvases, at places given in its own pixels.
  const press = (canvas, places) => js(`(() => {
    const canvas = ${view}.${canvas}, box = canvas.getBoundingClientRect(), places = ${JSON.stringify(places)};
    const send = (kind, place, buttons) => canvas.dispatchEvent(new PointerEvent(kind, { clientX: box.left + place.x, clientY: box.top + place.y, pointerId: 7, buttons, bubbles: true }));
    send("pointermove", places[0], 0);
    send("pointerdown", places[0], 1);
    for (const place of places.slice(1)) send("pointermove", place, 1);
    send("pointerup", places.at(-1), 0);
  })()`);
  try {
    await js(`window.hangar_.app.editor?.close(); await ${view}?.close({ sure: true }); await window.showForSnapshot(${JSON.stringify(`trackview:${track}`)})`);
    const opened = await js(`return (() => { const v = ${view}; return v && { pipes: v.model.pipes.length, lap: Boolean(v.lap), own: v.own, given: v.given, edit: Boolean(v.edit) }; })()`);
    if (!say(Boolean(opened) && !opened.own && (opened.pipes > 0 ? opened.given && !opened.edit : opened.edit), opened?.pipes > 0 ? "the track opens in 3D, from the one that comes with the app" : "a track with no 3D view yet opens ready to be built", JSON.stringify(opened))) return;

    // Pipes: a faint section is clicked on, then clicked off again.
    await js(`${view}.work("pipes")`);
    const ghost = await js(`return (async () => {
      const v = ${view}, { camera } = await import("../shared/trackview.js"), see = camera(v.view, v.middle);
      // One that nothing else is drawn near, so the click can only mean it.
      const all = [...v.model.pipes, ...v.ghosts].map(([a, b]) => { const pa = see(a), pb = see(b); return pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : null; });
      const clear = (index) => all[index] && all.every((other, at) => at === index || !other || Math.hypot(other.x - all[index].x, other.y - all[index].y) > 28);
      const at = v.ghosts.findIndex((_, index) => clear(v.model.pipes.length + index));
      return at < 0 ? null : { place: all[v.model.pipes.length + at], edge: v.ghosts[at], count: v.model.pipes.length, ghosts: v.ghosts.length };
    })()`);
    if (!say(Boolean(ghost) && ghost.ghosts > 0, "where a section can go next is on offer", ghost ? `${ghost.ghosts} places` : "none clear of the rest")) return;
    await press("canvas", [ghost.place]);
    const added = await js(`return (() => { const v = ${view}; return { count: v.model.pipes.length, has: v.model.pipes.some((pipe) => JSON.stringify(pipe) === ${JSON.stringify(JSON.stringify(ghost.edge))} || JSON.stringify([pipe[1], pipe[0]]) === ${JSON.stringify(JSON.stringify(ghost.edge))}), dirty: v.edit.dirty }; })()`);
    say(added.count === ghost.count + 1 && added.has && added.dirty, "a click on one adds that section", `${ghost.count} to ${added.count}`);
    // A drag turns the track and adds nothing.
    await press("canvas", [ghost.place, { x: ghost.place.x + 40, y: ghost.place.y + 10 }, { x: ghost.place.x + 80, y: ghost.place.y + 20 }]);
    const turned = await js(`return (() => { const v = ${view}; return { count: v.model.pipes.length, turn: v.view.turn }; })()`);
    say(turned.count === added.count && Math.abs(turned.turn - 0.62) > 0.1, "a drag turns the track and changes nothing", `turned to ${turned.turn.toFixed(2)}`);
    await js(`(() => { const v = ${view}; Object.assign(v.view, v.home); v.refresh(); })()`);
    await press("canvas", [ghost.place]);
    const removed = await js(`return ${view}.model.pipes.length`);
    say(removed === ghost.count, "a click on a pipe takes it away", `back to ${removed}`);
    // A track being built from nothing keeps that one section: an empty one can't be kept.
    if (ghost.count === 0) await press("canvas", [ghost.place]);
    const sections = ghost.count || 1;

    // The lap: four points put down on the plan, one dragged, one lifted, one named, one made the start.
    await js(`${view}.work("lap")`);
    await pause(200);
    const plan = await js(`return (() => { const v = ${view}; const low = [v.low[0] - 1, v.low[1] - 1], high = [v.high[0] + 1, v.high[1] + 1]; return { size: Math.min(v.plan.w, v.plan.h), hidden: v.planBox.hidden, had: v.edit.points.length, corners: [[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]].map((at) => ({ at, ...v.toPlan(at) })) }; })()`);
    if (!say(plan.size > 200 && !plan.hidden, "the plan of the track from above is shown", `${plan.size} px`)) return;
    for (const corner of plan.corners) await press("planCanvas", [corner]);
    let lap = await js(`return (() => { const v = ${view}; return { points: v.edit.points.map((point) => point.at), line: Boolean(v.lap), picked: v.edit.picked }; })()`);
    say(lap.points.length === plan.had + 4 && lap.line && plan.corners.every((corner, index) => lap.points[plan.had + index][0] === corner.at[0] && lap.points[plan.had + index][1] === corner.at[1] && lap.points[plan.had + index][2] === 0.5), "four clicks on the plan put down four points at gate height, and they make a lap", JSON.stringify(lap.points.slice(plan.had)));
    // The last one is dragged half a section along.
    const last = plan.corners[3], to = await js(`return ${view}.toPlan([${last.at[0] + 0.5}, ${last.at[1]}])`);
    await press("planCanvas", [last, { x: (last.x + to.x) / 2, y: to.y }, to]);
    // Its height, its move's name and the start gate are set with the controls beside the picture.
    await js(`(() => {
      const side = ${view}.sideBox, height = side.querySelector('input[type="range"]'), name = side.querySelector('input[type="text"]');
      height.value = "1.5";
      height.dispatchEvent(new Event("input", { bubbles: true }));
      name.value = "Over the top";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      name.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await js(`${view}.sideBox.querySelector('input[type="checkbox"]').click()`);
    lap = await js(`return (() => { const v = ${view}; return { points: v.edit.points.length, moved: v.edit.points.at(-1).at, start: v.model.start, moves: v.model.lap.map((move) => [move.move, move.by.length]) }; })()`);
    say(lap.points === plan.had + 4 && lap.moved[0] === last.at[0] + 0.5 && lap.moved[2] === 1.5 && lap.start?.at[2] === 1.5 && lap.moves.at(-1)[0] === "Over the top", "a point is dragged, lifted, named and made the start", JSON.stringify(lap.moves));

    // Done keeps it as the pilot's own, in the track's folder, and it opens again as theirs.
    await js(`${view}.finishEdit()`);
    await pause(300);
    const kept = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const after = await js(`return (() => { const v = ${view}; return v && { own: v.own, given: v.given, edit: Boolean(v.edit), lap: Boolean(v.lap), hint: v.hintBox.textContent }; })()`);
    say(Boolean(kept) && kept.pipes.length === sections && kept.lap.at(-1).move === "Over the top" && kept.start.at[2] === 1.5, "Done keeps the track in its folder", kept ? `${kept.pipes.length} sections, ${kept.lap.reduce((sum, move) => sum + move.by.length, 0)} points` : after?.hint);
    say(Boolean(after) && after.own && after.given === opened.given && !after.edit && after.lap, "and it is shown as the pilot's own, with the lap flown");
    await js(`${view}.close({ sure: true })`);
    const again = await js(`return (async () => { await window.showForSnapshot(${JSON.stringify(`trackview:${track}`)}); const v = ${view}; return v && { own: v.own, moves: v.model.lap.length }; })()`);
    say(Boolean(again) && again.own && again.moves > 0, "opened again, it is the one that was kept");
    await js(`${view}?.close({ sure: true })`);
    say(errors.length === 0, "nothing went wrong on the page", errors.join(" | "));
  } finally {
    if (before) writeFileSync(file, before);
    else rmSync(file, { force: true });
  }
}

/**
 * Reads a track out of its video: the one a track that comes with the app was made from, so that
 * what is found can be set against it. `--track <number>` picks which (the first unless told).
 * It plays the video from YouTube in a window nobody sees, so it needs the network.
 */
async function trackvideo(tools) {
  const { api } = tools;
  // The app's own window is open, as it always is when a pilot does this: the window the video
  // plays in closing would otherwise be the last one closing, which ends the app.
  await page(tools);
  const { readTrack, pipeKey } = await import("../shared/trackview.js");
  const folder = new URL("../assets/tracks/", import.meta.url);
  const { readdirSync } = await import("node:fs");
  const known = readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => readTrack(JSON.parse(readFileSync(new URL(name, folder), "utf8")))).filter((one) => one?.from?.video);
  const wanted = Number(argument("--track")) || known[0]?.track;
  const track = known.find((one) => one.track === wanted);
  if (!say(Boolean(track), "a track that comes with the app has a video", track ? `Track ${track.track}` : "")) return;
  const real = new Set(track.pipes.map((pipe) => pipeKey(...pipe)));
  const compare = (pipes) => ({ found: pipes.length, right: pipes.filter((pipe) => real.has(pipeKey(...pipe))).length });
  let started = Date.now();
  const unaided = await api.readTrackVideo({ link: track.from.video });
  if (!say(!unaided.problem, "the video's build is read and pipes are found in it", unaided.problem ?? `${unaided.pipes.length} pipes, from ${unaided.shot.from} s to ${unaided.shot.to} s, the time-lapse taken to start at ${unaided.start} s, in ${((Date.now() - started) / 1000).toFixed(0)} s`)) return;
  note(`   how unlike the standing track each early moment was: ${unaided.looked.map((one) => `${one.time}:${(one.unlike * 100).toFixed(0)}`).join(" ")}`);
  const first = compare(unaided.pipes);
  say(first.right === first.found && first.found >= real.size * 0.6, "with no help, what it finds is right as far as it goes", `${first.right} of ${first.found} found are among the track's ${real.size}`);
  say(unaided.picture?.startsWith("data:image/jpeg"), "a picture of the track standing comes back to check it against");
  note(`   other readings: ${unaided.readings.map((pipes) => { const c = compare(pipes); return `${c.found} pipes (${c.right} right)`; }).join(", ")}`);
  started = Date.now();
  const told = await api.readTrackVideo({ link: track.from.video, sections: real.size });
  if (!say(!told.problem, "it is read again, told how many sections the parts list adds up to", told.problem ?? `in ${((Date.now() - started) / 1000).toFixed(0)} s`)) return;
  const second = compare(told.pipes);
  say(second.found === real.size && second.right === real.size, "told that, it finds the whole track", `${second.right} of ${real.size}`);
  const none = await api.readTrackVideo({ link: "https://example.com/not-a-video" });
  say(/isn't a link to a YouTube video/.test(none.problem ?? ""), "a link that isn't to YouTube is turned away");

  // And from the builder: the button under Pipes, with the parts list's count typed in.
  const { library } = tools;
  const path = library.tracks.find((one) => api.trackView(one)?.view.track === track.track && !api.trackView(one).own);
  if (!path) return note("   (no track in this library shows that one, so the button wasn't tried)");
  const { js, errors } = await page(tools);
  const view = "window.hangar_.app.trackView";
  await js(`window.hangar_.app.editor?.close(); await ${view}?.close({ sure: true }); await window.showForSnapshot(${JSON.stringify(`trackview:${path}#pipes`)})`);
  const pressed = await js(`
    const v = ${view}, wait = (ms) => new Promise((done) => setTimeout(done, ms));
    const box = v.sideBox.querySelector('input[aria-label^="How many sections"]');
    box.value = ${JSON.stringify(String(real.size))};
    box.dispatchEvent(new Event("input", { bubbles: true }));
    [...v.sideBox.querySelectorAll("button")].find((button) => button.textContent === "Read the pipes from the video").click();
    // It asks first, since there are pipes here already.
    let yes = null;
    for (let tries = 0; tries < 40 && !yes; tries += 1) { await wait(50); yes = [...document.querySelectorAll("#sheets button")].find((button) => button.textContent === "Read the video"); }
    yes?.click();
    for (let tries = 0; tries < 40 && !v.reading; tries += 1) await wait(50);
    const stages = new Set();
    for (let tries = 0; tries < 2400 && v.reading; tries += 1) { stages.add(v.readingLine?.textContent ?? ""); await wait(50); }
    return { asked: Boolean(yes), pipes: v.model.pipes, dirty: v.edit?.dirty, picture: Boolean(v.sideBox.querySelector("img.tv-still")), others: [...v.sideBox.querySelectorAll(".tv-readings button")].map((button) => button.textContent), stages: [...stages], problem: v.read?.problem ?? null };
  `);
  const built = compare(pressed.pipes);
  say(pressed.asked && !pressed.problem && built.found === real.size && built.right === real.size && pressed.dirty && pressed.picture, "the builder's button reads the video and puts the pipes in, with the picture to check them by", pressed.problem ?? `${built.right} of ${real.size}; then offered: ${pressed.others.join(", ") || "nothing else"}; said: ${pressed.stages.join(" / ")}`);
  await js(`await ${view}?.close({ sure: true })`);
  say(errors.length === 0, "nothing went wrong on the page", errors.join(" | "));
}

/** Says what this copy would take up from the Mac app before it: which of its settings it finds.
 *  Nothing is changed. The library's own path is said only as far as its folder's name. */
async function carryover() {
  const found = whatTheOldAppKept();
  const shown = Object.fromEntries(Object.entries(found).map(([name, value]) => [name, name === "library" ? `…/${basename(String(value))}` : value]));
  say(true, Object.keys(found).length > 0 ? "what the app before this one remembered is found" : "the app before this one left nothing under this copy's identity", JSON.stringify(shown));
}

/**
 * Run by a copy of the app that is being tried out as one that updates itself (see `updating`):
 * it looks at the feed it was started with, finds the later version, and installs it. When this
 * copy then closes, the later one takes its place, starts, writes down its version, and stops.
 */
async function update(tools) {
  const { api } = tools;
  const state = await api.checkForUpdates();
  const found = state.update;
  if (!say(found.kind === "available", "a later version is found on the feed", found.kind === "available" ? `v${found.version}, ${found.file}` : `${found.kind} ${found.problem ?? ""}`)) return;
  let most = 0;
  const problem = await install({ version: found.version, file: found.file, sha256: found.sha256, notes: found.notes }, {
    after: ["--say-version", argument("--drill-said")], aside: argument("--drill-aside"), heard: (share) => { most = Math.max(most, share); },
  });
  say(problem === null, "it is downloaded, checked, and put in this copy's place", problem ?? `${Math.round(most * 100)}% heard arriving`);
}

/**
 * Tries out the app updating itself, without publishing anything. It makes a copy of this app that
 * isn't a test copy, the same again marked as version 99.0.0 and zipped, and a feed that offers
 * it, all in the temporary folder. The copy is started on that feed: it should find the later
 * version, replace itself, and the copy that takes its place should start and say it is 99.0.0.
 * This copy of the app, and where it is, are not touched.
 */
async function updating() {
  const here = thisCopy();
  if (!here) return note("   (a copy run from its source can't update itself, so there is nothing to try)");
  const mac = process.platform === "darwin", name = "FPV Hangar", later = "99.0.0";
  const drill = mkdtempSync(join(tmpdir(), "fpv-hangar-drill-"));
  const run = (program, parts) => spawnSync(program, parts, { encoding: "utf8", windowsHide: true });
  const inside = (copy, ...more) => (mac ? join(copy, "Contents", "Resources", ...more) : join(copy, "resources", ...more));
  // A copy of an app, with everything a Mac bundle has kept as it is.
  const copy = (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    if (mac) return run("/usr/bin/ditto", [from, to]).status === 0;
    cpSync(from, to, { recursive: true });
    return true;
  };
  // What the app is called and which version it says it is, in the places it keeps them.
  const mark = (place, { called, numbered }) => {
    const file = inside(place, "app", "package.json"), told = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...told, ...(called ? { productName: called } : {}), ...(numbered ? { version: numbered } : {}) }));
    if (numbered) {
      writeFileSync(inside(place, "VERSION"), `${numbered}\n`);
      if (mac) run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleShortVersionString ${numbered}`, "-c", `Set :CFBundleVersion ${numbered}`, join(place, "Contents", "Info.plist")]);
    }
    // A Mac app that has been changed inside has to be signed again, or it is taken for damaged.
    return !mac || run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", place]).status === 0;
  };
  const numberOf = (place) => {
    try {
      return readFileSync(inside(place, "VERSION"), "utf8").trim();
    } catch {
      return null;
    }
  };
  let server = null;
  try {
    const now = join(drill, "now", mac ? `${name}.app` : name);
    const made = copy(here, now) && mark(now, { called: name });
    if (!say(made && numberOf(now) === version(), "a copy of this app is made to try it on, one that isn't a test copy", `v${numberOf(now)}`)) return;
    const staged = join(drill, "new", `${name} v${later}`), fresh = join(staged, mac ? `${name}.app` : name);
    const feed = join(drill, "feed"), archive = "FPV-Hangar-drill.zip";
    mkdirSync(feed, { recursive: true });
    const marked = copy(now, fresh) && mark(fresh, { numbered: later });
    const zipped = mac
      ? run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", staged, join(feed, archive)])
      : run("tar.exe", ["-a", "-cf", join(feed, archive), "--options", "zip:compression=store", "-C", dirname(staged), basename(staged)]);
    if (!say(marked && zipped.status === 0 && existsSync(join(feed, archive)), `the same again is packed as v${later}`, zipped.status === 0 ? `${Math.round(statSync(join(feed, archive)).size / 2 ** 20)} MB` : (zipped.stderr || zipped.error?.message || "").slice(-300))) return;
    const sum = createHash("sha256");
    for await (const piece of createReadStream(join(feed, archive))) sum.update(piece);
    const sha256 = sum.digest("hex");
    writeFileSync(join(feed, "latest.json"), JSON.stringify({ version: later, file: archive, sha256, notes: "- A version made up to try updating with.", windows: { file: archive, sha256 } }));

    // The feed, on this computer only.
    server = createServer((request, answer) => {
      const file = join(feed, basename(decodeURIComponent(new URL(request.url, "http://localhost").pathname)));
      if (!existsSync(file)) {
        answer.writeHead(404).end();
        return;
      }
      answer.writeHead(200, { "content-length": statSync(file).size });
      createReadStream(file).pipe(answer);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const address = `http://127.0.0.1:${server.address().port}/`;

    // The copy is started on that feed, and left to it.
    const said = join(drill, "said.txt"), report = join(drill, "report.txt"), old = join(drill, "old");
    const program = mac ? join(now, "Contents", "MacOS", "Electron") : join(now, basename(process.execPath));
    const started = Date.now();
    const ended = await new Promise((done) => {
      const child = spawn(program, ["--update-feed", address, "--check", "update", "--root", join(drill, "library"), "--user-data", join(drill, "memory"), "--report", report, "--drill-said", said, "--drill-aside", old], { stdio: "ignore", windowsHide: true });
      const timer = setTimeout(() => child.kill(), 240000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        done(code);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        done(error.message);
      });
    });
    const told = existsSync(report) ? readFileSync(report, "utf8").split(/\r?\n/).filter((line) => /^(ok|FAIL)/.test(line)) : [];
    for (const line of told) note(`   the copy: ${line}`);
    if (!say(ended === 0 && told.length > 0 && told.every((line) => line.startsWith("ok")), "the copy finds the later version and installs it", `it left with ${ended} after ${((Date.now() - started) / 1000).toFixed(0)} s`)) return;
    // The later copy starts where the first one was, and says which version it is.
    for (let tries = 0; tries < 240 && !existsSync(said); tries += 1) await pause(500);
    await pause(500);
    const says = existsSync(said) ? readFileSync(said, "utf8").trim() : null;
    say(says === later, "the copy that took its place starts, and it is the later version", says ? `it says v${says}` : "it never said");
    say(numberOf(now) === later, "it is where the first one was", `v${numberOf(now)} there now`);
    const kept = join(old, basename(now));
    say(numberOf(kept) === version(), "and the one that was running is kept, as a way back", `v${numberOf(kept)} set aside`);
  } finally {
    server?.close();
    // Whatever was made for this goes. On Windows the last of it can still be closing.
    for (let tries = 0; tries < 10; tries += 1) {
      try {
        rmSync(drill, { recursive: true, force: true });
        break;
      } catch {
        await pause(1000);
      }
    }
  }
}

/**
 * The app tried out from start to finish, on a library made here from nothing: a made-up recording
 * like the goggles', laps marked on it, a song, and then every other check on that. It needs no
 * footage and no network, so it can be run on a computer the app has never been on.
 */
async function everything(tools) {
  const { library, api, ffmpeg, cache } = tools;
  note(`FPV Hangar ${version()} trying itself out, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  note(`${process.platform} ${arch()}, ${systemVersion()} (${release()}), ${cpus()[0]?.model?.trim() ?? "?"}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GB`);
  try {
    const graphics = await app.getGPUInfo("basic");
    note(`Graphics: ${(graphics.gpuDevice ?? []).map((one) => `${one.vendorId?.toString(16)}:${one.deviceId?.toString(16)}${one.active ? " (in use)" : ""}`).join(", ") || "not told"}`);
  } catch {}
  const engine = await ffmpeg.run(["-version"]);
  note(`Video engine: ${(engine.out || engine.said).split(/\r?\n/)[0]}`);
  note(`Videos are encoded with ${await ffmpeg.encoder()}`);
  note();

  note("-- A library from nothing");
  library.finishSetUp({ pilot: "Test Pilot", fliesSeries: false, number: "" });
  const made = api.newEvent("Self Test");
  const track = made.track ?? library.tracks[0];
  if (!say(Boolean(track), "an event and its first track are made", made.problem ?? track)) return;
  // Twenty seconds of a test picture, in the kind of file the goggles record: HEVC in a transport
  // stream, sixty frames a second. If this computer's FFmpeg can't make that, H.264 will do.
  mkdirSync(cache, { recursive: true });
  const recording = join(cache, "clip_0001.ts");
  const picture = ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60", "-t", "20", "-pix_fmt", "yuv420p"];
  let kind = "HEVC";
  let wrote = await ffmpeg.run([...picture, "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error:info=0:repeat-headers=1:aud=1:bframes=0:keyint=60", "-f", "mpegts", recording]);
  if (wrote.code !== 0) {
    kind = "H.264";
    wrote = await ffmpeg.run([...picture, "-c:v", "libx264", "-preset", "ultrafast", "-bf", "0", "-g", "60", "-f", "mpegts", recording]);
  }
  if (!say(wrote.code === 0, "a recording is made to work on", wrote.code === 0 ? `${kind}, 1280 by 720, 20 s` : wrote.said.slice(-300))) return;
  const added = await library.addClips(track, [recording]);
  if (!say(added.added?.length === 1, "it is added to the track", added.problem ?? added.added?.join(", "))) return;
  // Laps of two seconds, on frames the editor's check doesn't mark for itself.
  const saved = await library.saveRun(track, "clip_0001", { frames: [186, 306, 426, 546, 666], fps: new FrameRate(60), markersChanged: true, edit: {} });
  const timed = (await library.summary(track)).runs[0];
  say(saved.problem === null && timed?.laps?.length === 4, "its laps are marked and timed", saved.problem ?? `${timed?.laps?.join(" ")}, best three ${timed?.best?.seconds}`);
  // A song with a beat twice a second that gets bigger eight seconds in.
  const song = join(cache, "Test song.wav");
  const sung = await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*55*t)*exp(-7*mod(t,0.5))*(1+1.2*gt(t,8))+0.25*sin(2*PI*440*t)*gt(t,8)*exp(-3*mod(t,0.5))':s=44100:d=24", song]);
  say(sung.code === 0 && library.keepSong(song).problem === null, "a song is kept in the song library", sung.code === 0 ? "" : sung.said.slice(-300));
  rmSync(recording, { force: true });
  rmSync(song, { force: true });
  note();

  const steps = [
    ["The marker editor", editor], ["Making the videos", video], ["Before and after a video", bookends],
    ["The track in 3D, and building one", trackview], ["Every page", pages], ["Updating itself", updating],
  ];
  for (const [title, step] of steps) {
    note(`-- ${title}`);
    const started = Date.now();
    try {
      await step(tools);
    } catch (error) {
      say(false, "it ran to its end", error.stack ?? error.message);
    }
    note(`   (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    note();
  }

  // Whatever the app wrote down as going wrong while this ran.
  try {
    const lines = readFileSync(logFile(), "utf8").split(/\r?\n/).filter((line) => line && !/ started on /.test(line));
    note(lines.length === 0 ? "Nothing was written to What went wrong.txt." : `What went wrong.txt has ${lines.length} line${lines.length === 1 ? "" : "s"}:`);
    for (const line of lines.slice(-40)) note(`   ${line.slice(0, 600)}`);
  } catch {}
}

async function form(tools) {
  const { library, api } = tools;
  const track = library.tracks.find((one) => library.state(one).formURL.trim() !== "");
  if (!say(Boolean(track), "a track has an entry form")) return;
  const kept = [[library.storeFile, readFileSync(library.storeFile)]];
  const { js, errors } = await page(tools);
  try {
    await js(`await window.showForSnapshot("submit")`);
    const sheet = await js(`const s = window.hangar_.submit; return s && { questions: s.form?.questions.map((q) => ({ id: q.id, title: q.title, kind: q.kind, role: q.role, required: q.required, options: q.options })), answers: s.answers, email: s.state.email }`);
    if (!say(Boolean(sheet?.questions?.length), "the form is read", `${sheet?.questions?.length ?? 0} questions`)) return;
    const roles = sheet.questions.filter((question) => question.role).map((question) => question.role);
    say(["handle", "number", "time", "link"].every((role) => roles.includes(role)), "the app knows which questions it answers", roles.join(", "));
    // Made-up answers for everything, so nothing of the pilot's is put in a form by a check.
    const made = { handle: "CheckPilot", number: "000", time: "99.999", link: "https://youtu.be/check" };
    const filledAnswers = await js(`
      const s = window.hangar_.submit;
      for (const q of s.form.questions) {
        if (q.role) s.answers[q.id] = [(${JSON.stringify(made)})[q.role]];
        else if (q.kind === "choice") s.answers[q.id] = q.options.slice(0, 1);
        else if (q.kind === "checkboxes") s.answers[q.id] = q.options.slice(0, 2);
        else if (q.kind !== "other") s.answers[q.id] = ["check"];
      }
      s.state.email = "check@example.com";
      await s.fill();
      return s.answers;`);
    // The form loads, and half a second later it is filled in.
    let holds = null;
    for (let tries = 0; tries < 60; tries += 1) {
      await pause(500);
      holds = await api.formHolds();
      if (holds && Object.keys(holds.fields).length > 0) break;
    }
    if (!say(Boolean(holds) && holds.at.endsWith("/viewform"), "the form opens inside the window", holds?.at ?? "nothing loaded")) return;
    const typed = sheet.questions.filter((question) => question.kind === "text" || question.kind === "paragraph");
    const wrong = typed.filter((question) => holds.fields[`entry.${question.id}`] !== filledAnswers[question.id][0]);
    say(wrong.length === 0, `all ${typed.length} typed answers are in the form`, wrong.map((question) => question.title.slice(0, 40)).join(" | "));
    const choices = sheet.questions.filter((question) => question.kind === "choice");
    const unchosen = choices.filter((question) => holds.fields[`entry.${question.id}`] !== filledAnswers[question.id][0]);
    say(unchosen.length === 0, `all ${choices.length} choices are made`, unchosen.map((question) => question.title.slice(0, 40)).join(" | "));
    say(holds.email === "check@example.com" || holds.email === "", "the email is in its box, when the form has one", holds.email || "the form has no box for it");
    say(library.state(track).submissions.length === JSON.parse(kept[0][1]).tracks[track].submissions.length, "nothing was sent");
    await js(`window.hangar_.submit.leave()`);
    say(errors.length === 0, "nothing went wrong in the window", errors.slice(0, 3).join(" | "));
  } finally {
    api.closeForm();
    for (const [file, bytes] of kept) writeFileSync(file, bytes);
  }
}

async function pages(tools) {
  const { js, errors } = await page(tools);
  for (const which of ["home", "creator", "track", "files", "settings", "guide", "leaderboard", "welcome", "whatsnew", "setup", "submit", "editor", "wave", "trackview"]) {
    const before = errors.length;
    let problem = "";
    try {
      await js(`const editor = window.hangar_.app.editor; if (editor) editor.close(); window.hangar_.app.trackView?.close(); await window.showForSnapshot(${JSON.stringify(which)})`);
    } catch (error) {
      problem = error.message;
    }
    await pause(100);
    say(problem === "" && errors.length === before, `the ${which} page draws`, problem || errors.slice(before).join(" | "));
  }
  // The leaderboard with entries in it. A copy that shows no window doesn't read the series'
  // spreadsheet by itself, so these are made up, and one of them is given the pilot's own name.
  const before = errors.length;
  const drawn = await js(`
    window.hangar_.app.trackView?.close();
    const app = window.hangar_.app, entry = (rank, id, pilot, time) => ({ rank: String(rank), id, pilot, time, official: false, video: rank === 1 ? "https://youtu.be/madeUp00001" : null });
    app.boardsAsked = true;
    app.boards = { read: new Date().toISOString(), problem: null, me: { id: "", name: app.state.settings.pilot || "Test Pilot" }, tabs: [
      { name: "Track1", kind: "track", number: 1, entries: [entry(1, "007", "Fast Fox", 12.5), entry(2, "019", "Quick Quail", 13.25), entry(3, "", app.state.settings.pilot || "Test Pilot", 15.125)] },
      { name: "Rank LB", kind: "soon", says: "Coming Soon" },
      { name: "Time LB", kind: "table", headers: ["Place", "Pilot", "Time"], rows: [["1", "Fast Fox", "12.500"]] },
    ] };
    await window.showForSnapshot("leaderboard");
    const page = document.getElementById("stage");
    return { entries: page.querySelectorAll(".board-entry").length, mine: page.querySelector(".board-entry.mine .board-pilot")?.textContent ?? null, says: page.querySelector(".board-mine")?.textContent ?? null, watch: page.querySelectorAll(".board-entry .plain").length };
  `);
  say(errors.length === before && drawn.entries === 5 && drawn.watch === 1 && Boolean(drawn.mine) && /^You are 3rd of 3 with 15\.125, 2\.625 behind Fast Fox\.$/.test(drawn.says ?? ""), "the leaderboard draws its entries, with the pilot's own picked out", drawn.says ?? errors.slice(before).join(" | "));
  await js(`window.hangar_.app.boards = null; window.hangar_.app.boardsAsked = false;`);
}

export { copyFileSync };
