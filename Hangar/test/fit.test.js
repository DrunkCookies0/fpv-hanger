import { test } from "node:test";
import assert from "node:assert/strict";
import { usualTempo, runShape, onTheBeat, placing, fitOf, bestTempos } from "../shared/fit.js";

/** A run whose laps are given, starting at `start` seconds into the clip, its video from 3 s before
 *  lap 1 to 8 s after the finish, as the app makes it when it is left to it. */
function run(laps, start = 10) {
  const gates = [start];
  for (const lap of laps) gates.push(gates.at(-1) + lap);
  return runShape(gates, { from: start - 3, to: gates.at(-1) + 8 });
}

test("fit: a tempo is said between 90 and 180, as the app hears songs", () => {
  assert.equal(usualTempo(174), 174);
  assert.equal(usualTempo(87), 174);
  assert.equal(usualTempo(200), 100);
  assert.equal(usualTempo(180), 90);
  assert.equal(usualTempo(0), null);
  assert.equal(usualTempo(null), null);
  assert.equal(usualTempo(Number.NaN), null);
});

test("fit: a run's shape is its gates in order, its laps and its usual lap", () => {
  const shape = runShape([22, 10, 34.5, 46], { from: 7, to: 54 });
  assert.deepEqual(shape.gates, [10, 22, 34.5, 46]);
  assert.deepEqual(shape.laps, [12, 12.5, 11.5]);
  assert.equal(shape.lap, 12);
  assert.equal(shape.length, 47);
  assert.equal(runShape([10], { from: 7, to: 20 }), null);
  assert.equal(runShape([10, 20], null), null);
  assert.equal(runShape([10, 20], { from: 9, to: 9 }), null);
});

test("fit: laps of a whole number of bars put every gate on a bar line", () => {
  // 12 seconds is 8 bars at 160 BPM, and a little off makes no difference that can be heard.
  const steady = run([12.02, 11.97, 12.01, 12, 11.99]);
  const on = onTheBeat(steady, 160);
  assert.equal(on.gates, 5);
  assert.equal(on.onBar, 5);
  assert.ok(on.score > 0.9, `score ${on.score}`);
  assert.ok(Math.abs(on.barsPerLap - 8) < 0.01);
  // 80 is 160 said the usual way.
  assert.equal(onTheBeat(steady, 80).tempo, 160);
  // At 157 BPM the gates drift off the beat lap by lap.
  const off = onTheBeat(steady, 157);
  assert.ok(off.score < 0.3, `score ${off.score}`);
  assert.ok(off.onBar < 3);
  assert.equal(onTheBeat(steady, null), null);
  assert.equal(onTheBeat(null, 160), null);
});

test("fit: the tempos a run suits are those its laps last whole bars at, the faster first", () => {
  const steady = run([12, 12, 12, 12]);
  const tempos = bestTempos(steady);
  assert.equal(tempos.length, 3);
  // 12 s is a whole number of bars at any multiple of 20 BPM.
  for (const one of tempos) assert.equal(one.tempo % 20, 0, `${one.tempo}`);
  assert.equal(tempos[0].tempo, 160);
  assert.deepEqual(bestTempos(null), []);
});

test("fit: the strongest drop that leaves the video nothing short goes on the start gate", () => {
  const shape = run([12, 12, 12, 12, 12]);
  // The video is 7 s to 78 s, and lap 1 starts at 10 s.
  const long = { length: 180, drops: [{ time: 30, strength: 0.6 }, { time: 60, strength: 1 }] };
  assert.deepEqual(placing(long, shape), { drop: long.drops[1], songStart: -50, lead: 0, short: 0 });
  // A shorter song would run out with its biggest drop on the gate, so the earlier one goes there.
  const short = { length: 100, drops: [{ time: 30, strength: 0.6 }, { time: 60, strength: 1 }] };
  assert.deepEqual(placing(short, shape), { drop: short.drops[0], songStart: -20, lead: 0, short: 0 });
  // When none leaves it whole, the one that leaves it least.
  const tiny = { length: 50, drops: [{ time: 40, strength: 1 }, { time: 5, strength: 0.4 }] };
  const placed = placing(tiny, shape);
  assert.equal(placed.drop, tiny.drops[1]);
  assert.equal(placed.short, 23);
  // A song with no drops starts with the video.
  assert.deepEqual(placing({ length: 60 }, shape), { drop: null, songStart: 7, lead: 0, short: 11 });
  assert.equal(placing({ length: 0 }, shape), null);
});

test("fit: a song that lasts the video and lands every gate on a bar fits best, and says why", () => {
  const shape = run([12, 12, 12, 12, 12]);
  const fits = fitOf({ tempo: 160, length: 200, drops: [{ time: 45, strength: 1 }] }, shape);
  assert.ok(fits.score > 0.95, `score ${fits.score}`);
  const said = fits.reasons.map((reason) => reason.text);
  assert.ok(said.includes("Lasts the whole video with its drop on the start gate"), said.join(" | "));
  assert.ok(said.includes("5 of 5 gates land on a bar line at 160 BPM"), said.join(" | "));
  assert.ok(said.includes("A lap lasts 8 bars"), said.join(" | "));
  assert.ok(fits.reasons.every((reason) => reason.good));

  // The beat the app heard, which is exact, counts over a tempo that is rounded.
  const heard = fitOf({ tempo: 157, beatLength: 0.375, length: 200 }, shape);
  assert.equal(heard.beat.tempo, 160);

  const offBeat = fitOf({ tempo: 157, length: 200 }, shape);
  assert.ok(offBeat.score < fits.score - 0.3);
  assert.ok(offBeat.reasons.some((reason) => !reason.good && reason.text.startsWith("Most gates fall between beats")));

  const tooShort = fitOf({ tempo: 160, length: 40 }, shape);
  assert.ok(tooShort.score < fits.score);
  assert.ok(tooShort.reasons.some((reason) => reason.text === "Runs out 31.0 s before the video ends"));
});

test("fit: what isn't known about a song counts as halfway, and there is nothing to fit without a run", () => {
  const shape = run([12, 12, 12]);
  const unknownTempo = fitOf({ tempo: null, length: 300 }, shape);
  assert.equal(unknownTempo.beat, null);
  assert.ok(Math.abs(unknownTempo.score - (0.45 + 0.55 * 0.5)) < 1e-9);
  const unknownAll = fitOf({ tempo: null, length: null }, shape);
  assert.equal(unknownAll.score, 0.5);
  assert.deepEqual(fitOf({ tempo: 160, length: 200 }, null), { score: null, length: null, beat: null, place: null, reasons: [] });
});
