// The lap arithmetic, checked two ways: against answers worked out by hand, and against the Mac
// app's own lap timer when it is installed, which is what the videos so far were timed with.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatTime, parseSeconds, FrameRate, Timecode, markerSeconds, decodeText, markerTokens, markersAreInClipTime,
  crossingsIn, Race, Unusable, coarseStep, markerFile,
} from "../shared/timing.js";

test("times are written the way the timer shows them", () => {
  assert.equal(formatTime(9684), "9.684");
  assert.equal(formatTime(29100, { minutes: true }), "0:29.100");
  assert.equal(formatTime(62345), "1:02.345");
  assert.equal(formatTime(62345, { plain: true }), "62.345");
  assert.equal(formatTime(5, { decimals: 0 }), "5");
  assert.equal(formatTime(3725500, { minutes: true }), "62:05.500");
});

test("times typed by hand are read", () => {
  assert.equal(parseSeconds("12.345"), 12.345);
  assert.equal(parseSeconds(" 1:02.5 "), 62.5);
  assert.equal(parseSeconds("1:00:00"), 3600);
  assert.equal(parseSeconds("abc"), null);
  assert.equal(parseSeconds("-3"), null);
  assert.equal(parseSeconds("1:2:3:4"), null);
  assert.equal(parseSeconds(""), null);
});

test("frame rates snap to the standard ones", () => {
  assert.deepEqual([FrameRate.nearest(59.94).num, FrameRate.nearest(59.94).den], [60000, 1001]);
  assert.equal(FrameRate.nearest(59.94).label, "59.94");
  assert.equal(FrameRate.nearest(60).label, "60");
  assert.equal(FrameRate.nearest(59.94).timebase, 60);
  assert.equal(FrameRate.nearest(23.976).label, "23.976");
  assert.equal(FrameRate.nearest(47.5).label, "47.5");
  assert.equal(FrameRate.parse("nonsense"), null);
});

test("timecodes turn into frames, drop-frame included", () => {
  const sixty = new FrameRate(60), ntsc = new FrameRate(60000, 1001);
  assert.equal(Timecode.first("00:00:10:02").frameNumber(sixty), 602);
  assert.equal(markerSeconds("00:00:10:02", sixty), 602 / 60);
  // Drop-frame at 59.94 skips four frame numbers a minute, except every tenth minute.
  assert.equal(Timecode.first("00;01;00;04").frameNumber(ntsc), 3600);
  assert.equal(Timecode.first("00;10;00;00").frameNumber(ntsc), 35964);
  assert.equal(Timecode.first("no timecode here"), null);
  assert.throws(() => Timecode.first("00:00:10:75").frameNumber(sixty), Unusable);
  assert.equal(markerSeconds("1:02.5", sixty), 62.5);
});

test("a marker file's text is read whatever it was saved as", () => {
  const text = "Marker Name\tIn\nGate\t00:00:01:00\n";
  const utf16 = (littleEndian, mark) => {
    const bytes = [];
    if (mark) bytes.push(...(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]));
    for (const character of text) {
      const code = character.charCodeAt(0);
      bytes.push(...(littleEndian ? [code & 0xff, code >> 8] : [code >> 8, code & 0xff]));
    }
    return new Uint8Array(bytes);
  };
  assert.equal(decodeText(utf16(true, true)), text);
  assert.equal(decodeText(utf16(false, true)), text);
  assert.equal(decodeText(utf16(true, false)), text);
  assert.equal(decodeText(utf16(false, false)), text);
  assert.equal(decodeText(new TextEncoder().encode(text)), text);
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), "café");
});

test("markers are found in exports and in plain lists", () => {
  const premiere = "Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type\n\t\t00:00:10:02\t00:00:10:02\t00:00:00:00\tComment\n\t\t00:00:19:43\t00:00:19:43\t00:00:00:00\tComment\n";
  assert.deepEqual(markerTokens(premiere), ["00:00:10:02", "00:00:19:43"]);
  const ours = markerFile([602, 1183, 1766], new FrameRate(60));
  assert.deepEqual(markerTokens(ours), ["00:00:10:02", "00:00:19:43", "00:00:29:26"]);
  assert.ok(markersAreInClipTime(ours));
  assert.ok(!markersAreInClipTime(premiere));
  assert.deepEqual(markerTokens("# a note\n3.5\n1:02.25\nnot a time\n"), ["3.5", "1:02.25"]);
});

test("laps, and the best three in a row", () => {
  const race = Race.from([10.033, 19.717, 29.433, 39.567, 48.817, 59.5, 69.367]);
  assert.deepEqual(Array.from({ length: race.lapCount }, (_, lap) => race.time(race.lap(lap))), ["9.684", "9.716", "10.134", "9.250", "10.683", "9.867"]);
  assert.deepEqual(race.best(), { start: 1, total: 29100 });
  assert.equal(race.best(2), null);
  assert.deepEqual(race.best(3), { start: 0, total: 29534 });
  assert.equal(race.completed(19716), 0);
  assert.equal(race.completed(19717), 1);
  assert.throws(() => Race.from([5]), Unusable);
  assert.throws(() => Race.from([-1, 5]), Unusable);
  // Two markers on the same thousandth are one crossing.
  assert.equal(Race.from([1, 1.0004, 2]).lapCount, 1);
});

test("markers dropped on a coarse step are noticed", () => {
  const fps = new FrameRate(60);
  assert.equal(coarseStep([600, 1200, 1806, 2400, 3012].map((f) => f / 60), fps), 6);
  assert.equal(coarseStep([602, 1183, 1766, 2374, 2929].map((f) => f / 60), fps), null);
  assert.equal(coarseStep([1, 2, 3], fps), null);
});

// The Mac app's lap timer, as a second opinion on whole marker files.
const oracle = ["/Applications/FPV Hangar.app/Contents/MacOS/laptimer", "/Applications/FPV Hangar Test.app/Contents/MacOS/laptimer"].find(existsSync);

test("marker files come to the same laps as the Mac app's lap timer", { skip: oracle ? false : "the Mac app isn't installed here" }, () => {
  const folder = mkdtempSync(join(tmpdir(), "hangar-timing-"));
  const markers = join(folder, "Track X", "csv markers");
  mkdirSync(markers, { recursive: true });
  const sixty = new FrameRate(60), ntsc = new FrameRate(60000, 1001), thirty = new FrameRate(30);
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const files = [
    ["ours.csv", markerFile([602, 1183, 1766, 2374, 2929, 3570, 4162], sixty), sixty],
    ["ours-ntsc.csv", markerFile([299, 912, 1530, 2101, 2733, 3301], ntsc), ntsc],
    ["premiere.csv", utf16("Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type\r\n" + ["00:00:03:12", "00:00:13:29", "00:00:24:02", "00:00:33:17", "00:00:44:00"]
      .map((code) => `\t\t${code}\t${code}\t00:00:00:00\tComment`).join("\r\n") + "\r\n"), thirty],
    ["premiere-drop.csv", utf16("Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type\r\n" + ["00;00;58;10", "00;01;08;22", "00;01;19;03", "00;01;30;41", "00;01;41;07"]
      .map((code) => `\t\t${code}\t${code}\t00;00;00;00\tComment`).join("\r\n") + "\r\n"), ntsc],
    ["plain.csv", "4.25\n15.5\n26.125\n1:07.75\n", sixty],
    ["coarse.csv", markerFile([600, 1200, 1806, 2400, 3012], sixty), sixty],
    ["two.csv", markerFile([120, 733], sixty), sixty],
  ];
  try {
    for (const [name, content, fps] of files) {
      const path = join(markers, name);
      writeFileSync(path, content);
      const theirs = JSON.parse(execFileSync(oracle, ["--markers", path, "--fps", fps.label, "--json"], { encoding: "utf8" })).runs[0];
      const text = decodeText(typeof content === "string" ? Buffer.from(content, "utf8") : content);
      const crossings = crossingsIn(text, fps);
      const race = Race.from(crossings);
      const best = race.best();
      const laps = Array.from({ length: race.lapCount }, (_, lap) => race.time(race.lap(lap)));
      assert.deepEqual(laps, theirs.laps, `${name}: laps`);
      assert.equal(best ? formatTime(best.total, { plain: true }) : null, theirs.best?.seconds ?? null, `${name}: best laps in a row`);
      if (best) assert.deepEqual([best.start + 1, best.start + race.window], [theirs.best.firstLap, theirs.best.lastLap], `${name}: which laps`);
      assert.equal(coarseStep(crossings, fps) ?? 0, theirs.coarseStep, `${name}: coarse step`);
      // The lap timer reports each crossing as the thousandth it was rounded to.
      assert.deepEqual(race.bounds, theirs.crossings.map((value) => Math.round(value * 1000)), `${name}: crossings`);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
