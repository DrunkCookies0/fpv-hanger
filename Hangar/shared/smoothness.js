// How evenly a clip played in the marker editor, worked out from what the player said as it put
// each frame up and from when the window was drawn. A computer can play every frame of a
// recording and still show them at uneven times: then nothing is dropped, but some frames stay up
// too long and the picture stutters. Nothing here touches a page, so it can be tested by itself.

/** A share of some numbers, sorted: 0.5 is the middle one. Null when there are none. */
function share(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
}

/**
 * How evenly the frames were put up. `shown` is what the player said each time it put frames up:
 * when they were due on the screen (`at`, in milliseconds), the clip's time (`media`, in seconds)
 * and how many frames it had put up so far (`presented`). `draws` is when the window was drawn, in
 * milliseconds. `fps` is the clip's frame rate and `speed` how fast it was played.
 *
 * A frame is held up too long when it stays on the screen a whole draw of the window longer than
 * it should. Less than that is how any screen shows a clip whose frame rate isn't its own: a 60
 * frames a second clip on a 144 Hz screen has each frame up for two or three draws, by turns.
 */
export function evenness({ shown = [], draws = [], fps, speed = 1 }) {
  const gaps = [];
  for (let index = 1; index < draws.length; index += 1) {
    const gap = draws[index] - draws[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const every = share(gaps, 0.5);
  const period = 1000 / fps / speed;
  const draw = every ?? period;
  let frames = 0, held = 0, skipped = 0, longest = 0;
  for (let index = 1; index < shown.length; index += 1) {
    const before = shown[index - 1], now = shown[index];
    const steps = Math.round((now.media - before.media) * fps);
    if (steps <= 0) continue;
    frames += steps;
    const gap = now.at - before.at;
    if (gap - steps * period > draw * 0.9) held += 1;
    const put = now.presented - before.presented;
    if (put > 0 && put < steps) skipped += steps - put;
    if (steps === 1) longest = Math.max(longest, gap);
  }
  return {
    frames, held, skipped, longest,
    draws: gaps.length,
    every,
    most: [share(gaps, 0.1), share(gaps, 0.9)],
    late: every === null ? 0 : gaps.filter((gap) => gap > every * 1.5).length,
    longestDraw: gaps.at(-1) ?? 0,
  };
}

/**
 * Whether a clip played unevenly enough to offer something better, and why: "dropped" when the
 * player left out frames, "held" when frames stayed up too long or were never shown, "waited"
 * when it stopped to wait for the recording. Null when it played well. `decoded` and `dropped`
 * are the player's own counts; the rest are from `evenness`.
 */
export function unevenBecause({ decoded = 0, dropped = 0, frames = 0, held = 0, skipped = 0, waited = 0 }) {
  if (decoded >= 30 && dropped / decoded >= 0.05) return "dropped";
  if (frames >= 30 && (held + skipped) / frames >= 0.03) return "held";
  if (waited >= 250) return "waited";
  return null;
}
