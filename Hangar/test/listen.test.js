// The song listening, checked on songs made up here, whose tempo, beat and drop are known, and
// against the Mac app's lap timer given the very same samples.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listen, normalised, nearestBeat } from "../shared/listen.js";

const rate = 22050;

/** A song in four-four at a tempo: a kick on every beat, a snare on the second and fourth, hats
 *  between them, and a bass note that changes each bar. It gets much bigger at `dropAt` seconds. */
function madeUp({ tempo, dropAt, seconds, lead = 0.1 }) {
  const samples = new Float32Array(Math.round(seconds * rate));
  const beat = 60 / tempo;
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const add = (start, length, shape) => {
    const first = Math.round(start * rate);
    for (let index = 0; index < length * rate && first + index < samples.length; index += 1) samples[first + index] += shape(index / rate);
  };
  const notes = [45, 45, 54, 40];
  for (let number = 0; lead + number * beat < seconds - 0.3; number += 1) {
    const start = lead + number * beat, loud = start >= dropAt - 1e-6;
    // The kick: a low note that dies away quickly.
    add(start, 0.18, (t) => (loud ? 0.8 : 0.2) * Math.sin(2 * Math.PI * 58 * t) * Math.exp(-t * 16));
    // The snare, on the second and fourth beats of the bar: a burst of noise.
    if (number % 2 === 1) add(start, 0.12, (t) => (loud ? 0.45 : 0.12) * noise() * Math.exp(-t * 30));
    // Hats on the half beats, quieter.
    add(start + beat / 2, 0.03, (t) => (loud ? 0.14 : 0.05) * noise() * Math.exp(-t * 120));
    // After the drop, a bass note under each beat, a different one each bar.
    if (loud) add(start, beat * 0.9, (t) => 0.3 * Math.sin(2 * Math.PI * notes[Math.floor(number / 4) % 4] * t) * Math.min(1, t * 200));
  }
  return normalised(samples);
}

/** The samples as a sound file the Mac app's lap timer can read without changing them. */
function wave(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length * 4, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length * 4, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

const songs = [
  { name: "128 with a drop at 24 s", tempo: 128, dropAt: 0.1 + 51 * (60 / 128), seconds: 60 },
  { name: "174 with a drop at 33 s", tempo: 174, dropAt: 0.1 + 96 * (60 / 174), seconds: 70 },
  { name: "140 with a drop at 30 s", tempo: 140, dropAt: 0.1 + 70 * (60 / 140), seconds: 64 },
];

test("made-up songs: the tempo, the beat and the drop are found", () => {
  for (const song of songs) {
    const heard = listen(madeUp(song), rate);
    assert.ok(Math.abs(heard.tempo - song.tempo) < 0.02, `${song.name}: tempo ${heard.tempo}`);
    assert.ok(heard.beatLength !== null, `${song.name}: a steady beat`);
    // The grid runs through the kicks, which start 0.1 s in and every beat after.
    const beat = 60 / song.tempo;
    const off = ((heard.firstBeat - 0.1) % beat + beat) % beat;
    assert.ok(Math.min(off, beat - off) < 0.004, `${song.name}: the grid is ${(Math.min(off, beat - off) * 1000).toFixed(1)} ms off the kicks`);
    assert.equal(heard.spots.length, 1, `${song.name}: one drop`);
    assert.ok(Math.abs(heard.spots[0].time - song.dropAt) < 0.004, `${song.name}: drop at ${heard.spots[0].time}, wanted ${song.dropAt}`);
    assert.ok(Math.abs(nearestBeat(heard, song.dropAt) - song.dropAt) < 0.004, `${song.name}: the drop is on a beat`);
  }
});

test("a sound with no pulse has no tempo, and silence has nothing", () => {
  let seed = 7;
  const hiss = Float32Array.from({ length: rate * 20 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 2147483648 - 1) * 0.3;
  });
  const heard = listen(hiss, rate);
  assert.equal(heard.beatLength, null);
  assert.deepEqual(heard.spots, []);
  assert.deepEqual(listen(new Float32Array(rate * 5), rate).spots, []);
  assert.equal(listen(new Float32Array(100), rate).tempo, null);
});

const oracle = ["/Applications/FPV Hangar.app/Contents/MacOS/laptimer", "/Applications/FPV Hangar Test.app/Contents/MacOS/laptimer"].find(existsSync);

test("the same samples come to the same answer as the Mac app's lap timer", { skip: oracle ? false : "the Mac app isn't installed here" }, () => {
  const folder = mkdtempSync(join(tmpdir(), "hangar-listen-"));
  try {
    for (const song of songs) {
      const samples = madeUp(song);
      const file = join(folder, "song.wav");
      writeFileSync(file, wave(samples));
      const theirs = JSON.parse(execFileSync(oracle, ["--song", file], { encoding: "utf8" }));
      const ours = listen(samples, rate);
      assert.ok(Math.abs(ours.tempo - theirs.tempo) < 0.011, `${song.name}: tempo ${ours.tempo} against ${theirs.tempo}`);
      assert.ok(Math.abs(ours.firstBeat - theirs.firstBeat) < 0.0002, `${song.name}: first beat ${ours.firstBeat} against ${theirs.firstBeat}`);
      assert.ok(Math.abs(ours.beatLength - theirs.beatLength) < 0.000002, `${song.name}: beat ${ours.beatLength} against ${theirs.beatLength}`);
      assert.equal(ours.spots.length, theirs.spots.length, `${song.name}: how many drops`);
      ours.spots.forEach((spot, index) => {
        assert.ok(Math.abs(spot.time - theirs.spots[index].time) < 0.0011, `${song.name}: drop ${spot.time} against ${theirs.spots[index].time}`);
        assert.ok(Math.abs(spot.strength - theirs.spots[index].strength) < 0.011, `${song.name}: how much it stands out`);
      });
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
