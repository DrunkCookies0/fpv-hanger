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
//   drive    keeps a copy of the library in a folder standing in for Google Drive (`--drive
//            <folder>`): what is copied and what isn't, a new file and a changed one following,
//            one that is deleted staying, Drive not being open, and stopping. Then the library
//            itself in Drive, with two libraries of its own standing in for two computers': one
//            moved there, the other opening it, both saving at once, and Drive not being open
//   cards    a card from the goggles, with folders standing in for cards (`--cards <folder>`): the
//            track's page says one is plugged in, its recordings are listed with the new ones
//            from the last day ticked, and the ones picked are copied in and the card left alone
//   outside  other projects' tools: one opens over its place in the window, a list of devices is
//            chosen from, and a made-up release of the program the app keeps up to date is fetched,
//            checked and put in place, all in a folder of its own. With `--live` it also opens
//            Betaflight's app and the ExpressLRS flasher from their own sites, which needs the
//            network, and reads that each arrived. No device is asked for or touched.

import { app } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync, copyFileSync, cpSync, createReadStream, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { EOL, arch, cpus, release, tmpdir, totalmem, version as systemVersion } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { argument, config, setConfig, logFile, version } from "./paths.js";
import { install, thisCopy, whatTheOldAppKept } from "./updates.js";
import { markerFile, FrameRate } from "../shared/timing.js";
import { Library } from "./library.js";
import { copyName, libraryName } from "../shared/drive.js";

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
  const checks = { editor, video, pages, form, bookends, trackview, trackvideo, outside, drive, cards, update, updating, carryover, everything };
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
  const press = (canvas, places, { altKey = false } = {}) => js(`(() => {
    const canvas = ${view}.${canvas}, box = canvas.getBoundingClientRect(), places = ${JSON.stringify(places)};
    const send = (kind, place, buttons) => canvas.dispatchEvent(new PointerEvent(kind, { clientX: box.left + place.x, clientY: box.top + place.y, pointerId: 7, buttons, bubbles: true, altKey: ${altKey} }));
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

    // A lap through a stack of gates passes over itself. A point goes on top of another with Option
    // or Alt held, a second click on the two goes from one to the other, and the plan can show one
    // height at a time, where a click adds a point at that height and leaves the others alone.
    const [low, other, third] = plan.corners, at = (corner) => `p.at[0] === ${corner.at[0]} && p.at[1] === ${corner.at[1]}`;
    await press("planCanvas", [low], { altKey: true });
    let stack = await js(`return (() => { const e = ${view}.edit; return { points: e.points.length, picked: e.picked, under: e.points.filter((p) => ${at(low)}).length }; })()`);
    say(stack.points === plan.had + 5 && stack.under === 2 && stack.picked === plan.had + 4, "with Option or Alt held, a click puts a point on top of another", JSON.stringify(stack));
    await press("planCanvas", [low]);
    const turn = await js(`return ${view}.edit.picked`);
    await press("planCanvas", [low]);
    const back = await js(`return ${view}.edit.picked`);
    say(turn === plan.had && back === plan.had + 4, "a second click on two points goes from one to the other", `${stack.picked + 1} to ${turn + 1} and back to ${back + 1}`);
    await js(`(() => {
      const side = ${view}.sideBox, height = side.querySelector('input[type="range"]');
      height.value = "1.5";
      height.dispatchEvent(new Event("input", { bubbles: true }));
      ${view}.storeyTabs[2].click();
    })()`);
    await press("planCanvas", [other]);
    stack = await js(`return (() => { const v = ${view}, e = v.edit; return { storey: e.storey, points: e.points.length, there: e.points.filter((p) => ${at(other)}).map((p) => p.at[2]), picked: e.points[e.picked]?.at, shown: e.points.filter((p) => v.onPlan(p)).length, words: v.storeyNote.textContent }; })()`);
    say(stack.storey === 1 && stack.points === plan.had + 6 && JSON.stringify(stack.there) === "[0.5,1.5]" && stack.picked?.[2] === 1.5, "with the plan showing one height, a click over a point lower down adds one at that height", JSON.stringify(stack.there));
    // The wheel zooms the plan about the place under the pointer.
    const zoomed = await js(`return (() => {
      const v = ${view}, canvas = v.planCanvas, box = canvas.getBoundingClientRect(), spot = ${JSON.stringify({ x: third.x, y: third.y })};
      const before = v.planPlace(spot), span = v.plan.span;
      canvas.dispatchEvent(new WheelEvent("wheel", { clientX: box.left + spot.x, clientY: box.top + spot.y, deltaY: -300, bubbles: true, cancelable: true }));
      const after = v.planPlace(spot);
      return { closer: v.plan.span < span * 0.8, slipped: Math.hypot(after[0] - before[0], after[1] - before[1]) };
    })()`);
    // (A wheel says where it is to the whole pixel, so the place may slip by a part of one.)
    say(zoomed.closer && zoomed.slipped < 0.02, "the wheel zooms the plan about the place under the pointer", JSON.stringify(zoomed));
    // A click on a point in the picture brings the plan to that point's height.
    await js(`(() => { const v = ${view}; v.pick(${plan.had}); })()`);
    const followed = await js(`return ${view}.edit.storey`);
    say(followed === 0, "picking out a point at another height brings the plan to it", `showing ${followed}`);

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
 * Other projects' tools. The ones shown inside the window: that one opens where the page says, and
 * that a list of devices is put up, kept up to date, chosen from and cancelled. No device is asked
 * for: the lists are made up, and put up the way a page asking would put them up. Then the program
 * the app fetches and keeps up to date, on a Mac: a made-up release in a folder of its own.
 */
async function outside(tools) {
  const { api } = tools;
  const { js, errors } = await page(tools);
  const mac = process.platform === "darwin";
  await js(`window.hangar_.app.editor?.close(); await window.hangar_.app.trackView?.close({ sure: true }); await window.hangar_.app.tool?.close(); await window.showForSnapshot("home")`);
  const tiles = await js(`return ["betaflight", "elrsFlasher", "elrsConfigurator"].map((name) => { const tile = document.querySelector('[data-probe="tile ' + name + '"]'); return tile ? !tile.disabled : null; })`);
  say(tiles.every((there) => there === true), "the first screen has Betaflight, the ExpressLRS flasher and the ExpressLRS Configurator to open", JSON.stringify(tiles));

  // A tool opens over its place on the page. Where it is put is what is looked at, not what it loads.
  try {
    await js(`document.querySelector('[data-probe="tile betaflight"]').click()`);
    await pause(500);
    const frame = await js(`return (() => { const at = document.querySelector(".tool-frame")?.getBoundingClientRect(); return at && { x: Math.round(at.left), y: Math.round(at.top), width: Math.round(at.width), height: Math.round(at.height) }; })()`);
    let open = api.toolIsOpen();
    say(open?.id === "betaflight" && Boolean(frame) && JSON.stringify(open.place) === JSON.stringify(frame) && open.shown && frame.width > 600 && frame.height > 400, "Betaflight opens over its place in the window", JSON.stringify(open?.place));

    // Its page asks for a serial port: the list goes up, with the tool's page out of its way.
    const ports = [{ portId: "a1", portName: "cu.usbmodem0x80000001", displayName: "Made-up Flight Controller", vendorId: "1155", productId: "22336" }, { portId: "b2", portName: "cu.Bluetooth-Incoming-Port" }];
    let answer = api.pretendToolAsks("serial", ports);
    await pause(300);
    const list = () => js(`return { title: document.querySelector("#sheets .alert-title")?.textContent ?? null, devices: [...document.querySelectorAll("#sheets .device")].map((one) => one.textContent), none: document.querySelector("#sheets .device-none")?.textContent ?? null }`);
    let up = await list();
    say(up.title === "Betaflight is asking for a serial port" && up.devices.length === 2 && up.devices[0].includes("Made-up Flight Controller") && up.devices[0].includes("0x0483:0x5740") && api.toolIsOpen().shown === false, "a list of serial ports is put up for the pilot to choose from", up.devices.join(" | "));
    // Something is plugged in while the list is up.
    api.pretendToolDevice("serial", { portId: "c3", portName: "cu.usbserial-0001", displayName: "Made-up Radio" }, true);
    await pause(200);
    up = await list();
    say(up.devices.length === 3 && up.devices[2].includes("Made-up Radio"), "what is plugged in while it is up joins the list", `${up.devices.length} in the list`);
    await js(`document.querySelector('[data-probe="device c3"]').click()`);
    const chosen = await answer;
    await pause(200);
    up = await list();
    say(chosen === "c3" && up.title === null && api.toolIsOpen().shown === true && api.toolIsOpen().choosing === null, "the one clicked is the one the tool is given, and its page comes back", String(chosen));

    // Nothing plugged in yet, and then cancelled.
    answer = api.pretendToolAsks("usb", []);
    await pause(300);
    up = await list();
    say(up.title === "Betaflight is asking for a USB device" && up.devices.length === 0 && Boolean(up.none), "with nothing plugged in the list says what to do", up.none ?? "");
    await js(`document.querySelector('[data-probe="device cancel"]').click()`);
    const none = await answer;
    say(none === null && api.toolIsOpen().shown === true, "Cancel gives the tool nothing");

    // A second kind of asking while a list is up lets the first go.
    const first = api.pretendToolAsks("serial", ports);
    await pause(150);
    const second = api.pretendToolAsks("bluetooth", [{ deviceId: "AA:BB", deviceName: "Made-up Adapter" }]);
    await pause(250);
    up = await list();
    say((await first) === null && up.title === "Betaflight is asking for a Bluetooth device" && up.devices.length === 1, "a page that asks for something else lets its first asking go");
    // Leaving the tool while a list is up answers it with nothing and takes the tool's page away.
    await js(`document.querySelector('[data-probe="tool back"]').click()`);
    const left = await second;
    await pause(300);
    open = api.toolIsOpen();
    const cleared = await js(`return { layer: document.getElementById("tool").childElementCount, sheets: document.querySelectorAll("#sheets .alert").length, inert: document.getElementById("stage").hasAttribute("inert") }`);
    say(left === null && open === null && cleared.layer === 0 && cleared.sheets === 0 && !cleared.inert, "Hangar goes back to the first screen and nothing of the tool is left", JSON.stringify(cleared));
    say((await api.openTool("somethingElse", { x: 0, y: 0, width: 10, height: 10 })).problem !== null && api.toolIsOpen() === null, "only the tools the app knows can be opened");
  } finally {
    api.closeTool();
    await js(`await window.hangar_.app.tool?.close()`);
  }

  // The tools themselves, from their own sites. Only when asked for: it needs the network.
  if (process.argv.includes("--live")) {
    for (const [id, title] of [["betaflight", "Betaflight"], ["elrsFlasher", "ExpressLRS Web Flasher"]]) {
      await js(`await window.showForSnapshot(${JSON.stringify(`tool:${id}`)})`);
      await pause(9000);
      const read = await api.toolReads?.();
      say(Boolean(read) && read.title.includes(title.split(" ")[0]) && read.serial && read.usb, `${title} arrives from its own site, and can reach serial ports and USB devices`, read ? `"${read.title}" at ${read.at}` : "nothing read");
      await js(`await window.hangar_.app.tool?.close()`);
    }
  }

  // The program the app fetches and keeps up to date. A made-up one, on a Mac, where the app does
  // the putting in place itself: an older copy in a folder of its own, and a release beside it.
  if (mac) {
    const work = mkdtempSync(join(tmpdir(), "fpv-hangar-programs-")), place = join(work, "Programs"), feed = join(work, "Releases");
    const bundle = (folder, version) => {
      const contents = join(folder, "ExpressLRS Configurator.app", "Contents");
      mkdirSync(join(contents, "Resources", "app"), { recursive: true });
      writeFileSync(join(contents, "Resources", "app", "package.json"), JSON.stringify({ name: "made-up-configurator", version }));
      writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`);
    };
    const argv = process.argv.length, known = config().programs ?? {};
    try {
      bundle(place, "1.0.0");
      bundle(join(work, "fresh"), "9.9.9");
      mkdirSync(feed, { recursive: true });
      const name = `ExpressLRS-Configurator-9.9.9-${process.arch === "arm64" ? "arm64" : "x64"}.dmg`;
      const made = spawnSync("/usr/bin/hdiutil", ["create", "-quiet", "-srcfolder", join(work, "fresh"), "-volname", "Made-up Configurator", "-format", "UDZO", join(feed, name)], { encoding: "utf8" });
      if (!say(made.status === 0, "a made-up release is put together to fetch", made.stderr.trim())) return;
      const sum = createHash("sha512").update(readFileSync(join(feed, name))).digest("base64");
      const at = (file) => `https://github.com/ExpressLRS/ExpressLRS-Configurator/releases/download/v9.9.9/${file}`;
      const release = { tag_name: "v9.9.9", draft: false, prerelease: false, html_url: "https://github.com/ExpressLRS/ExpressLRS-Configurator/releases/tag/v9.9.9", published_at: "2026-01-02T03:04:05Z", body: "## What's Changed\n* A made-up change\n",
        assets: [{ name, size: statSync(join(feed, name)).size, browser_download_url: at(name) }, { name: "latest-mac.yml", size: 1, browser_download_url: at("latest-mac.yml") }] };
      writeFileSync(join(feed, "release.json"), JSON.stringify(release));
      const sums = (value) => writeFileSync(join(feed, "latest-mac.yml"), `version: 9.9.9\nfiles:\n  - url: ${name}\n    sha512: ${value}\n    size: 1\n`);
      process.argv.push("--programs", place, "--program-feed", feed);

      let now = api.programsNow().elrsConfigurator;
      say(now.installed === "1.0.0", "the copy on this computer is found, and which version it is", `v${now.installed}`);
      now = (await api.checkProgram("elrsConfigurator")).elrsConfigurator;
      say(now.latest?.version === "9.9.9" && now.newer && now.problem === null, "its newest release is read, and is later", `v${now.latest?.version}`);

      // The sheet says so, and offers it.
      await js(`await window.showForSnapshot("program:elrsConfigurator")`);
      await pause(400);
      const sheet = await js(`return { words: document.querySelector("#sheets .program-now")?.textContent ?? "", notes: [...document.querySelectorAll("#sheets .program-notes p")].map((p) => p.textContent), get: document.querySelector('[data-probe="program get"]')?.textContent ?? null, open: Boolean(document.querySelector('[data-probe="program open"]')) }`);
      say(sheet.words.includes("Version 1.0.0 is on this computer") && sheet.words.includes("Version 9.9.9 came out on") && sheet.get === "Update to 9.9.9" && sheet.open && sheet.notes.includes("- A made-up change"), "its sheet says which is here, which is the newest and what is new, and offers the update", `${sheet.words} [${sheet.get}]`);

      // A download that isn't what the project published is turned away and nothing is changed.
      sums(createHash("sha512").update("something else").digest("base64"));
      let done = await api.installProgram("elrsConfigurator");
      now = done.state.elrsConfigurator;
      say(now.installed === "1.0.0" && /didn't arrive in one piece/.test(now.problem ?? ""), "a download that doesn't add up to the published checksum is turned away, and the old copy is left alone", now.problem ?? "");
      // The real thing: fetched from the sheet's own button, checked, put in place, the old copy set aside.
      sums(sum);
      await pause(300);
      await js(`document.querySelector('[data-probe="program get"]').click()`);
      for (let tries = 0; tries < 200 && (api.programsNow().elrsConfigurator.busy || api.programsNow().elrsConfigurator.installed !== "9.9.9"); tries += 1) await pause(100);
      now = api.programsNow().elrsConfigurator;
      const aside = existsSync(join(place, "Replaced")) ? readdirSync(join(place, "Replaced")) : [];
      say(now.installed === "9.9.9" && !now.newer && now.problem === null && aside.length === 1, "the newer one is fetched, checked and put in its place, and the copy that was there is kept aside", `v${now.installed}, ${aside.length} set aside${now.problem ? `: ${now.problem}` : ""}`);
      await pause(400);
      const after = await js(`return { words: document.querySelector("#sheets .program-now")?.textContent ?? "", get: Boolean(document.querySelector('[data-probe="program get"]')) }`);
      say(after.words.includes("Version 9.9.9 is on this computer") && after.words.includes("That is the newest") && !after.get, "and its sheet then says it is the newest", after.words);
      const mounted = spawnSync("/usr/bin/hdiutil", ["info"], { encoding: "utf8" }).stdout.includes("fpv-hangar-program-");
      say(!mounted, "the download is put away afterwards");
    } finally {
      process.argv.length = argv;
      // What this copy knew of the real program's releases before is what it knows again.
      setConfig({ programs: known });
      await js(`document.querySelectorAll("#sheets .backdrop").forEach((one) => one.remove())`);
      rmSync(work, { recursive: true, force: true });
    }
  }
  say(errors.length === 0, "nothing went wrong on the page", errors.join(" | "));
}

/**
 * Reads a track out of its video: the one a track that comes with the app was made from, so that
 * what is found can be set against it. `--track <number>` picks which (the first unless told).
 * It plays the video from YouTube in a window nobody sees, so it needs the network.
 */
/** The copy of the library in Google Drive, with a folder standing in for where Drive shows a
 *  pilot's files. Nothing of Google's is called on, and no Drive on this computer is looked for. */
async function drive(tools) {
  const { api, library } = tools;
  const place = argument("--drive");
  if (!place) return note("   (give a folder to stand in for Google Drive with --drive, and this is tried)");
  const myDrive = resolve(place), root = join(myDrive, "FPV Hangar");
  mkdirSync(myDrive, { recursive: true });
  const track = library.tracks[0];
  if (!say(Boolean(track), "there is a track to copy")) return;
  // What the library is given to copy: a recording, a finished video, markers, and a hidden file.
  const inTrack = (...parts) => join(library.root, ...track.split("/"), ...parts);
  // A file written to a moment ago is taken to be unfinished and left for the next round, so
  // these are given a time a while back.
  const write = (file, text, secondsAgo = 60) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    const then = new Date(Date.now() - secondsAgo * 1000);
    utimesSync(file, then, then);
  };
  write(inTrack("Raw files", "copy_check.ts"), Buffer.alloc(6_500_000, 7));
  write(inTrack("landscape", "copy_check.mp4"), Buffer.alloc(900_000, 3));
  write(inTrack("csv markers", "copy_check.csv"), "1,2,3\n");
  write(inTrack("Raw files", ".hidden"), "not this");
  write(inTrack("landscape", "half made.mp4.part"), "nor this");
  const { js, errors } = await page(tools);
  const card = () => js(`
    await window.showForSnapshot("settings");
    const card = document.querySelector('[data-probe="drive card"]'), copy = document.querySelector('[data-probe="copy card"]');
    return card && { label: card.querySelector(".label")?.textContent, says: copy?.querySelector("#drive-status")?.textContent ?? null, buttons: [...card.querySelectorAll("button"), ...(copy?.querySelectorAll("button") ?? [])].map((one) => one.textContent), path: copy?.querySelector(".path")?.textContent ?? null };`);
  const press = (probe) => js(`document.querySelector('[data-probe="${probe}"]').click()`);
  const same = (path) => {
    const here = join(library.root, ...path), there = join(root, ...path);
    return existsSync(there) && statSync(there).size === statSync(here).size && Math.abs(statSync(there).mtimeMs - statSync(here).mtimeMs) < 2000 && readFileSync(there).equals(readFileSync(here));
  };
  const inCopy = (...parts) => join(root, ...track.split("/"), ...parts);
  const of = (...parts) => [...track.split("/"), ...parts];
  try {
    await api.lookForDrive();
    let seen = await card();
    say(seen?.label === "GOOGLE DRIVE" && seen.buttons.includes("Keep my library in Google Drive") && seen.buttons.includes("Keep a copy in another folder…") && !existsSync(root), "the card offers to keep the library in Google Drive, or a copy elsewhere, and nothing is copied before it is asked for", seen ? seen.buttons.join(" | ") : "no card");

    const refused = await js(`return await window.hangar.ask("keepCopy", ${JSON.stringify(join(library.root, "somewhere"))})`);
    say(Boolean(refused.problem) && !config().copyTo, "a folder that isn't Drive's is refused when it is given as Drive's", refused.problem ?? "it was taken");

    // A copy can still be kept in Drive's folder, chosen as any other folder is.
    await js(`await window.hangar.ask("keepCopy", ${JSON.stringify(myDrive)})`);
    const until = async (met) => {
      for (let tries = 0; tries < 100 && !met(); tries += 1) await pause(50);
    };
    await until(() => Boolean(config().copyTo));
    let now = await api.whenCopied();
    seen = await card();
    const all = [of("Raw files", "copy_check.ts"), of("landscape", "copy_check.mp4"), of("csv markers", "copy_check.csv"), ["dashboard.json"]];
    say(now.kind === "kept" && all.every(same), "the library is copied into a folder of its own in Drive, laid out the same", now.last?.problem ?? all.filter((path) => !same(path)).map((path) => path.join("/")).join(", "));
    say(!existsSync(inCopy("Raw files", ".hidden")) && !existsSync(inCopy("landscape", "half made.mp4.part")) && readdirSync(inCopy("Raw files")).every((name) => !name.endsWith(".part")), "hidden files and half-made ones are left out, and nothing half-copied is left behind");
    say(seen?.path === root && /^Everything has been handed to Google Drive: \d+ recordings?, \d+ finished videos? and \d+ other files?, [\d.]+ (KB|MB|GB)\. Looked today at /.test(seen.says ?? ""), "the card says what the copy holds", seen?.says ?? "nothing said");

    // Only what is new or has changed goes across after that.
    const first = statSync(inCopy("Raw files", "copy_check.ts"));
    write(inTrack("Raw files", "copy_check_2.ts"), Buffer.alloc(1_200_000, 9));
    write(inTrack("csv markers", "copy_check.csv"), "9,8,7\n", 20);
    await press("drive now");
    now = await api.whenCopied();
    const again = statSync(inCopy("Raw files", "copy_check.ts"));
    say(same(of("Raw files", "copy_check_2.ts")) && same(of("csv markers", "copy_check.csv")) && again.ino === first.ino && again.mtimeMs === first.mtimeMs, "a new recording and changed markers follow, and what was already there is left alone", now.last?.problem ?? "");

    // The copy only grows.
    rmSync(inTrack("landscape", "copy_check.mp4"));
    now = await api.whenCopied();
    say(now.kind === "kept" && existsSync(inCopy("landscape", "copy_check.mp4")), "a video deleted from the library stays in the copy");

    // Recordings can be left out.
    await js(`await window.showForSnapshot("settings"); document.querySelector('[data-probe="drive recordings"]').click()`);
    await until(() => config().copyLeavesOutRecordings === true);
    write(inTrack("Raw files", "copy_check_3.ts"), Buffer.alloc(300_000, 5));
    write(inTrack("csv markers", "copy_check_3.csv"), "9,9\n");
    now = await api.whenCopied();
    say(now.recordings === false && !existsSync(inCopy("Raw files", "copy_check_3.ts")) && same(of("csv markers", "copy_check_3.csv")) && existsSync(inCopy("Raw files", "copy_check.ts")), "with recordings left out a new one isn't copied, its markers are, and one copied before stays");
    api.copyRecordings(true);
    now = await api.whenCopied();
    say(same(of("Raw files", "copy_check_3.ts")), "and it follows when recordings are wanted again");

    // Drive not being open: its folder isn't there.
    const away = `${myDrive} (away)`;
    renameSync(myDrive, away);
    write(inTrack("csv markers", "copy_check_4.csv"), "4\n");
    now = await api.whenCopied();
    seen = await card();
    say(now.kind === "problem" && /Google Drive isn't open/.test(now.last.problem) && /Google Drive isn't open/.test(seen?.says ?? "") && !existsSync(myDrive), "with Drive not open nothing is copied, no folder is made in its place, and the card says why", now.last?.problem ?? now.kind);
    const word = await js(`await window.showForSnapshot("track"); const word = document.querySelector('[data-probe="drive word"]'); return word && { says: word.textContent, why: word.title };`);
    say(word?.says === "Google Drive: not copied" && /isn't open/.test(word.why), "a track's page says so too", word ? word.says : "no word");
    renameSync(away, myDrive);
    now = await api.whenCopied();
    say(now.kind === "kept" && same(of("csv markers", "copy_check_4.csv")), "and when Drive is back the copy catches up", now.last?.problem ?? "");

    // A job being finished is what sets a round going by itself.
    const recording = join(tmpdir(), "copy_check_5.ts");
    writeFileSync(recording, Buffer.alloc(700_000, 4));
    await api.addClips(track, [recording]);
    rmSync(recording, { force: true });
    let arrived = false;
    for (let tries = 0; tries < 250 && !arrived; tries += 1) {
      await pause(100);
      arrived = existsSync(inCopy("Raw files", "copy_check_5.ts"));
    }
    say(arrived, "a recording added to a track goes into the copy by itself");

    await js(`await window.showForSnapshot("settings")`);
    await press("drive stop");
    await until(() => !config().copyTo);
    write(inTrack("csv markers", "copy_check_6.csv"), "6\n");
    now = await api.whenCopied();
    seen = await card();
    say(now.kind === "off" && !config().copyTo && !existsSync(inCopy("csv markers", "copy_check_6.csv")) && existsSync(inCopy("Raw files", "copy_check.ts")) && seen?.buttons.includes("Keep a copy in another folder…"), "stopping stops it, and what was copied stays");
    say(errors.length === 0, "nothing went wrong in the window", errors.slice(0, 3).join(" | "));
  } finally {
    setConfig({ copyTo: null, copyLeavesOutRecordings: false });
    // What the check added to the library goes, so the checks after it find it as it was.
    for (const name of readdirSync(inTrack("Raw files"))) if (/^(copy_check|\.hidden)/.test(name)) rmSync(inTrack("Raw files", name), { force: true });
    for (const name of readdirSync(inTrack("csv markers"))) if (name.startsWith("copy_check")) rmSync(inTrack("csv markers", name), { force: true });
    rmSync(inTrack("landscape", "copy_check.mp4"), { force: true });
    rmSync(inTrack("landscape", "half made.mp4.part"), { force: true });
    await api.refresh();
  }
  await driveLibrary(tools, myDrive);
}

/** The library itself in Google Drive. Two libraries of the check's own stand in for the ones on a
 *  pilot's two computers: the first is moved into Drive, the second opens it from there, and both
 *  save at once. The library the check was given is turned back to at the end, as it was. */
async function driveLibrary(tools, myDrive) {
  const { api, library } = tools;
  const { js, errors } = await page(tools);
  const before = library.root, scratch = mkdtempSync(join(tmpdir(), "fpv-hangar-drive-"));
  const mac = join(scratch, "Mac", "FPV Hangar"), pc = join(scratch, "PC", "FPV Hangar"), shared = join(myDrive, libraryName);
  const track = "Drive Check/Track 1";
  const inMac = (...parts) => join(mac, ...track.split("/"), ...parts);
  const ask = (what, ...details) => js(`return await window.hangar.ask(${[what, ...details].map((one) => JSON.stringify(one)).join(", ")})`);
  const card = () => js(`
    await window.showForSnapshot("settings");
    const card = document.querySelector('[data-probe="drive card"]');
    return card && { says: card.querySelector("#drive-library")?.textContent ?? null, buttons: [...card.querySelectorAll("button")].map((one) => one.textContent) };`);
  try {
    // The first computer's library: a track with a recording, its markers, and its entry form.
    mkdirSync(inMac("Raw files"), { recursive: true });
    mkdirSync(inMac("csv markers"), { recursive: true });
    writeFileSync(inMac("Raw files", "drive_check.ts"), Buffer.alloc(2_000_000, 6));
    writeFileSync(inMac("csv markers", "drive_check.csv"), "1,2,3\n");
    writeFileSync(join(mac, "dashboard.json"), JSON.stringify({ email: "", answers: {}, tracks: { [track]: { formURL: "https://example.com/form" } } }));
    mkdirSync(join(scratch, "PC"));

    // A computer whose library is some other folder in Drive, the copy an older version kept there
    // say, doesn't move it: the computer with the tracks goes first.
    const oldCopy = join(myDrive, copyName);
    mkdirSync(oldCopy, { recursive: true });
    library.use(oldCopy);
    await api.refresh();
    const notFirst = await ask("lookInDrive", myDrive), notMoved = await ask("moveLibraryToDrive", myDrive);
    say(/computer that has your tracks first/.test(notFirst.problem ?? "") && Boolean(notMoved.problem) && library.root === oldCopy && !existsSync(shared), "a library that is another folder in Drive isn't moved there", notFirst.problem ?? "it was offered");

    library.use(mac);
    await api.refresh();
    let seen = await card();
    say(Boolean(seen?.buttons.includes("Keep my library in Google Drive")) && !existsSync(shared), "the card offers to keep the library in Google Drive", seen?.buttons.join(" | ") ?? "no card");

    // A copy being kept in Drive stops when the library goes there: it would only be a second one.
    await ask("keepCopy", myDrive);
    let look = await ask("lookInDrive", myDrive);
    say(look.there === false && look.mine?.tracks === 1 && look.mine.recordings === 1 && look.mine.bytes > 2_000_000, "what would be moved is counted first", JSON.stringify(look.mine ?? look));
    const moved = await ask("moveLibraryToDrive", myDrive);
    say(moved.moved === true && library.root === shared && !existsSync(mac) && existsSync(join(shared, ...track.split("/"), "Raw files", "drive_check.ts")) && library.tracks.includes(track) && library.state(track).formURL === "https://example.com/form", "the library is moved into a folder of its own in Drive, and used from there", moved.problem ?? library.root);
    say(!config().copyTo && config().library === undefined, "the copy kept in Drive is stopped, and a copy started on a folder remembers nothing of the move", JSON.stringify({ copyTo: config().copyTo, library: config().library }));
    seen = await card();
    say(/^Your library is in Google Drive/.test(seen?.says ?? "") && !seen.buttons.includes("Keep my library in Google Drive"), "the card says the library is in Google Drive", seen?.says ?? "no card");
    say(Boolean((await ask("moveLibraryToDrive", myDrive)).problem), "it isn't moved there twice");

    // The second computer, new, with a library of its own.
    library.use(pc);
    await api.refresh();
    look = await ask("lookInDrive", myDrive);
    const overIt = await ask("moveLibraryToDrive", myDrive);
    say(look.there === true && look.ready === true && Boolean(overIt.problem) && library.root === pc, "on the other computer the library in Drive is found, and this one's isn't moved over it", JSON.stringify({ there: look.there, ready: look.ready, problem: overIt.problem }));
    library.use(oldCopy);
    await api.refresh();
    look = await ask("lookInDrive", myDrive);
    say(look.there === true && look.ready === true, "and once the library is in Drive, it is offered to that one to open", JSON.stringify({ there: look.there, problem: look.problem }));
    library.use(pc);
    await api.refresh();
    const used = await ask("useLibraryInDrive", myDrive);
    say(used.moved === true && library.root === shared && library.tracks.includes(track) && existsSync(pc), "it opens the library in Drive, and its own stays where it was", used.problem ?? library.root);

    // Both saving at once: the first computer gives the track another form while this one keeps an email.
    const other = new Library(shared, { ffmpeg: null, cache: join(scratch, "cache"), trash: async () => {}, fetch: async () => ({ ok: false, status: 404, text: async () => "" }) });
    other.update(track, (state) => { state.formURL = "https://example.com/form-2"; });
    await ask("setEmail", "pilot@example.com");
    const kept = JSON.parse(readFileSync(join(shared, "dashboard.json"), "utf8"));
    say(kept.email === "pilot@example.com" && kept.tracks[track]?.formURL === "https://example.com/form-2" && library.state(track).formURL === "https://example.com/form-2", "two computers saving at once each keep what the other did", JSON.stringify({ email: kept.email, form: kept.tracks[track]?.formURL }));

    // Drive not open: its folder isn't there.
    const closed = `${myDrive} (closed)`;
    renameSync(myDrive, closed);
    await api.refresh();
    const away = await js(`await window.showForSnapshot("creator"); return document.querySelector('[data-probe="library away"]')?.textContent ?? null;`);
    say(/Google Drive/.test(away ?? "") && !existsSync(myDrive) && library.tracks.length === 0, "with Drive not open the Video Creator says why, and nothing is made where the library was", away ?? "nothing said");
    renameSync(closed, myDrive);
    await api.refresh();
    say(library.tracks.includes(track) && !library.away, "and when Drive is back, so is the library");
    say(errors.length === 0, "nothing went wrong in the window", errors.slice(0, 3).join(" | "));
  } finally {
    setConfig({ copyTo: null, copyIsInDrive: false });
    library.use(before);
    await api.refresh();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A card from the goggles, with folders standing in for the disks that are plugged in. */
async function cards(tools) {
  const { api, library } = tools;
  const place = argument("--cards");
  if (!place) return note("   (give a folder of folders to stand in for cards with --cards, and this is tried)");
  const track = library.tracks[0];
  if (!say(Boolean(track), "there is a track to add to")) return;
  const card = join(resolve(place), "GOGGLES"), raw = join(library.root, ...track.split("/"), "Raw files");
  const write = (file, size, daysAgo) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.alloc(size, size % 251));
    const then = new Date(Date.now() - daysAgo * 86400000 - 60000);
    utimesSync(file, then, then);
  };
  rmSync(resolve(place), { recursive: true, force: true });
  // Two flights from last week and two from an hour ago, among what else a card has on it.
  write(join(card, "movies", "rec_0001.ts"), 410_000, 7);
  write(join(card, "movies", "rec_0002.ts"), 420_000, 7);
  write(join(card, "movies", "rec_0003.ts"), 430_000, 0);
  write(join(card, "movies", "rec_0004.ts"), 440_000, 0);
  write(join(card, "movies", "._rec_0004.ts"), 4096, 0);
  write(join(card, "movies", "notes.txt"), 20, 0);
  write(join(card, "System Volume Information", "old.mp4"), 5000, 0);
  write(join(card, "a", "b", "c", "too deep.mp4"), 5000, 0);
  // A disk with no recordings on it is not a card.
  write(join(resolve(place), "PHOTOS", "DCIM", "picture.jpg"), 9000, 0);
  const before = readdirSync(join(card, "movies")).sort().join(" ");
  const { js, errors } = await page(tools);
  const until = async (met) => {
    for (let tries = 0; tries < 100 && !(await met()); tries += 1) await pause(50);
  };
  const look = () => js(`
    await window.showForSnapshot("track:${track}");
    await window.hangar_.loadCards(${JSON.stringify(track)}, true);
    return [...document.querySelectorAll('[data-probe="card note"]')].map((one) => one.textContent);`);
  const sheet = () => js(`return { title: document.querySelector(".card-sheet-title")?.textContent ?? null, rows: [...document.querySelectorAll('[data-probe="card recording"]')].map((row) => ({ name: row.querySelector(".file-name").textContent, ticked: row.querySelector("input").checked, off: row.querySelector("input").disabled, says: row.querySelector(".faint")?.textContent ?? "" })), add: document.querySelector('[data-probe="card add"]')?.textContent ?? null, addOff: document.querySelector('[data-probe="card add"]')?.disabled ?? null };`);
  try {
    let notes = await look();
    say(notes.length === 1 && /^GOGGLES is plugged in, with 4 recordings that aren't in your library yet\./.test(notes[0]), "a track's page says a card is plugged in, and how much on it is new", notes.join(" | ") || "nothing said");

    await js(`document.querySelector('[data-probe="card open"]').click()`);
    let seen = await sheet();
    say(seen.rows.map((row) => row.name).join(" ") === "rec_0004.ts rec_0003.ts rec_0002.ts rec_0001.ts", "its recordings are listed, the newest first, and nothing else on it is", seen.rows.map((row) => row.name).join(" "));
    say(seen.rows.map((row) => row.ticked).join() === "true,true,false,false" && seen.add === "Add 2 recordings", "the new ones from the last day of flying are ticked", `${seen.rows.map((row) => (row.ticked ? "✓" : "–")).join("")} ${seen.add}`);

    // One more is ticked, and they are added.
    await js(`document.querySelectorAll('[data-probe="card recording"] input')[2].click()`);
    seen = await sheet();
    say(seen.add === "Add 3 recordings", "ticking another counts it", seen.add ?? "");
    await js(`document.querySelector('[data-probe="card add"]').click()`);
    await until(() => ["rec_0002.ts", "rec_0003.ts", "rec_0004.ts"].every((name) => existsSync(join(raw, name)) && statSync(join(raw, name)).size === statSync(join(card, "movies", name)).size));
    await until(async () => !(await js(`return Boolean(window.hangar_.app.state.job)`)));
    await pause(300);
    const have = readdirSync(raw).filter((name) => name.startsWith("rec_")).sort().join(" ");
    say(have === "rec_0002.ts rec_0003.ts rec_0004.ts" && readdirSync(join(card, "movies")).sort().join(" ") === before, "the ones ticked are copied into the track, and the card is left as it was", have);
    say((await js(`return document.querySelector(".card-sheet") === null && window.hangar_.app.editor === null`)) === true, "the sheet closes, and several recordings are left on the page to pick from");

    notes = await look();
    say(notes.length === 1 && /with 1 recording that isn't in your library yet/.test(notes[0]), "the page then says what is still new on the card", notes.join(" | ") || "nothing said");
    await js(`document.querySelector('[data-probe="card open"]').click()`);
    seen = await sheet();
    say(seen.rows.filter((row) => row.off && /^Already in /.test(row.says)).length === 3 && seen.rows.at(-1).ticked && seen.add === "Add 1 recording", "and the sheet says which it has already, and won't add those twice", seen.rows.map((row) => `${row.name}${row.off ? " (here)" : ""}`).join(", "));
    await js(`document.querySelector(".card-sheet .button.secondary").click()`);

    // With a card in, Add clips asks where from.
    await js(`document.querySelector('[data-probe="add clips"]').click()`);
    const items = await js(`const items = [...document.querySelectorAll(".menu .menu-item")].map((one) => one.textContent); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return items;`);
    say(items.join(" | ") === "From GOGGLES: 4 recordings, 1 new… | Choose files…", "Add clips offers the card, and choosing files as before", items.join(" | "));

    // The card is taken out.
    rmSync(card, { recursive: true, force: true });
    notes = await look();
    say(notes.length === 0, "with the card taken out the page says nothing of it");
    say(errors.length === 0, "nothing went wrong in the window", errors.slice(0, 3).join(" | "));
  } finally {
    await js(`document.querySelector(".card-sheet .button.secondary")?.click()`).catch(() => {});
    for (const name of existsSync(raw) ? readdirSync(raw) : []) if (name.startsWith("rec_")) rmSync(join(raw, name), { force: true });
    rmSync(resolve(place), { recursive: true, force: true });
    await api.refresh();
  }
}

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
  say(sung.code === 0 && (await library.keepSong(song)).problem === null, "a song is kept in the song library", sung.code === 0 ? "" : sung.said.slice(-300));
  rmSync(recording, { force: true });
  rmSync(song, { force: true });
  note();

  const steps = [
    ["The marker editor", editor], ["Making the videos", video], ["Before and after a video", bookends],
    ["The track in 3D, and building one", trackview], ["Other projects' tools", outside], ["A card from the goggles", cards], ["The copy in Google Drive", drive], ["Every page", pages], ["Updating itself", updating],
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
