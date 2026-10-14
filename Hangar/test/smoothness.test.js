import { test } from "node:test";
import assert from "node:assert/strict";
import { evenness, unevenBecause } from "../shared/smoothness.js";

/** A screen drawn every `every` milliseconds, `count` times. */
const screen = (every, count) => Array.from({ length: count }, (_, index) => index * every);

/** A 60 frames a second clip put up on a screen drawn every `every` milliseconds: each frame on
 *  the first draw at or after its own time, with `extra` more draws for the frames listed. */
function played(every, count, extra = {}, speed = 1) {
  const shown = [];
  let behind = 0;
  for (let frame = 0; frame < count; frame += 1) {
    behind += (extra[frame] ?? 0) * every;
    const due = (frame * 1000) / 60 / speed + behind;
    shown.push({ at: Math.ceil(due / every - 1e-9) * every, media: frame / 60, presented: frame + 1 });
  }
  return shown;
}

test("smoothness: a 60 frames a second clip on a 144 Hz screen plays evenly, though each frame is up for two or three draws", () => {
  const every = 1000 / 144;
  const even = evenness({ shown: played(every, 600), draws: screen(every, 1440), fps: 60 });
  assert.equal(even.frames, 599);
  assert.equal(even.held, 0);
  assert.equal(even.skipped, 0);
  assert.ok(Math.abs(even.every - every) < 0.01);
  assert.equal(even.late, 0);
  assert.ok(even.longest > 20 && even.longest < 21);
  assert.equal(unevenBecause({ decoded: 600, dropped: 0, ...even }), null);
  // At half speed as well.
  const half = evenness({ shown: played(every, 300, {}, 0.5), draws: screen(every, 1440), fps: 60, speed: 0.5 });
  assert.equal(half.frames, 299);
  assert.equal(half.held, 0);
});

test("smoothness: frames held up too long are counted, and say the clip played unevenly", () => {
  const every = 1000 / 144;
  // Every 20th frame stays up two draws too long: three times a second.
  const extra = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [index * 20 + 10, 2]));
  const stutter = evenness({ shown: played(every, 600, extra), draws: screen(every, 1440), fps: 60 });
  assert.equal(stutter.held, 30);
  assert.ok(stutter.longest > 27);
  assert.equal(unevenBecause({ decoded: 600, dropped: 0, ...stutter }), "held");
  // A single draw too long now and then is under the line.
  const once = evenness({ shown: played(every, 600, { 100: 1, 400: 1 }), draws: screen(every, 1440), fps: 60 });
  assert.equal(unevenBecause({ decoded: 600, dropped: 0, ...once }), null);
});

test("smoothness: frames never put up, late draws of the window, dropped frames and waits are told apart", () => {
  const every = 1000 / 60;
  // Every 10th frame is passed over: the player says it put up one frame for two of the clip's.
  const shown = [];
  for (let frame = 0, presented = 0; frame < 300; frame += 1) {
    if (frame % 10 === 5) continue;
    presented += 1;
    shown.push({ at: frame * every, media: frame / 60, presented });
  }
  const skipping = evenness({ shown, draws: screen(every, 300), fps: 60 });
  assert.equal(skipping.skipped, 30);
  assert.equal(unevenBecause({ decoded: 300, ...skipping }), "held");
  // The window drawn late now and then.
  const draws = screen(every, 300).map((at, index) => at + (index >= 100 ? 40 : 0));
  const late = evenness({ draws, fps: 60 });
  assert.equal(late.late, 1);
  assert.ok(Math.abs(late.longestDraw - every - 40) < 0.01);
  // The player's own count of frames left out, and time spent waiting for the recording.
  assert.equal(unevenBecause({ decoded: 300, dropped: 30 }), "dropped");
  assert.equal(unevenBecause({ decoded: 300, dropped: 5 }), null);
  assert.equal(unevenBecause({ decoded: 300, waited: 400 }), "waited");
  // Too little played to say.
  assert.equal(unevenBecause({ decoded: 20, dropped: 10 }), null);
  assert.deepEqual(evenness({ fps: 60 }), { frames: 0, held: 0, skipped: 0, longest: 0, draws: 0, every: null, most: [null, null], late: 0, longestDraw: 0 });
});
