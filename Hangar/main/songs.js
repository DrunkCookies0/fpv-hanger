// A song, made ready for the marker editor: its sound to play, its sound wave to draw, and what
// the app hears in it (tempo, beat, drops), which is worked out once and kept.

import { Worker } from "node:worker_threads";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

/** How many readings of a song's sound wave there are for each second: finely, and coarsely. */
export const fine = 1000, coarse = 50;

/**
 * A song's sound wave, for drawing. A song mastered loud is one solid block from top to bottom as
 * a plain wave, so this keeps three things for each short stretch: the highest the sound gets, how
 * loud it is, and how loud its bass is. A drop shows in the last two. It is kept twice, finely for
 * looking closely and coarsely for the whole song at once.
 *
 * `samples` is one channel, `rate` samples a second.
 */
export function soundWave(samples, rate = 16000) {
  const stretch = Math.trunc(rate / fine);
  const count = Math.floor(samples.length / stretch);
  const close = { peak: new Float32Array(count), power: new Float32Array(count), bassPower: new Float32Array(count) };
  // The bass is what is left below 150 Hz or so. Filtering it out makes it a moment late, so its
  // readings start that much later into the sound and line up again.
  const ease = Math.fround(1 - Math.exp((-2 * Math.PI * 200) / rate));
  let once = 0, twice = 0, bassPower = 0, bassFilled = 0, bassAt = 0;
  let late = Math.round((2 * (1 - ease)) / ease);
  let highest = 0, power = 0, filled = 0, at = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    highest = Math.max(highest, Math.abs(value));
    power += value * value;
    filled += 1;
    if (filled === stretch) {
      if (at < count) {
        close.peak[at] = highest;
        close.power[at] = power / stretch;
      }
      at += 1;
      highest = 0;
      power = 0;
      filled = 0;
    }
    once += ease * (value - once);
    twice += ease * (once - twice);
    if (late > 0) {
      late -= 1;
    } else {
      bassPower += twice * twice;
      bassFilled += 1;
      if (bassFilled === stretch) {
        if (bassAt < count) close.bassPower[bassAt] = bassPower / stretch;
        bassAt += 1;
        bassPower = 0;
        bassFilled = 0;
      }
    }
  }
  // The loudest moment fills the height.
  let top = 0;
  for (const value of close.peak) top = Math.max(top, value);
  if (top > 0) {
    for (let index = 0; index < count; index += 1) {
      close.peak[index] /= top;
      close.power[index] /= top * top;
      close.bassPower[index] /= top * top;
    }
  }
  const wide = Math.trunc(fine / coarse);
  const farCount = Math.ceil(count / wide);
  const far = { peak: new Float32Array(farCount), power: new Float32Array(farCount), bassPower: new Float32Array(farCount) };
  for (let index = 0; index < farCount; index += 1) {
    const first = index * wide, last = Math.min(count, first + wide);
    let peak = 0, sum = 0, bass = 0;
    for (let each = first; each < last; each += 1) {
      peak = Math.max(peak, close.peak[each]);
      sum += close.power[each];
      bass += close.bassPower[each];
    }
    far.peak[index] = peak;
    far.power[index] = sum / (last - first);
    far.bassPower[index] = bass / (last - first);
  }
  // The song's loud passages are drawn at nine tenths of the height.
  const loudness = Array.from(far.power, Math.sqrt).sort((a, b) => a - b);
  const loud = loudness.length === 0 ? 0 : loudness[Math.trunc((loudness.length - 1) * 0.95)];
  return { close, far, gain: loud > 0 ? 0.9 / loud : 1 };
}

/** Listens to a song away from everything else, so the app carries on while it does. */
function listenApart(ffmpegPath, file) {
  return new Promise((done) => {
    const worker = new Worker(new URL("./listener.js", import.meta.url), { workerData: { ffmpeg: ffmpegPath, file } });
    worker.once("message", (report) => done(report));
    worker.once("error", () => done(null));
    worker.once("exit", () => done(null));
  });
}

const stampOf = (file) => {
  const facts = statSync(file);
  return `${basename(file, extname(file))}-${facts.size}-${Math.round(facts.mtimeMs / 1000)}`;
};

/**
 * What the app hears in a song: its tempo, where its beat falls, and its drops. The answer is kept
 * in the cache, so a song is only listened to once.
 */
export async function analysisOf(file, { ffmpegPath, cache }) {
  // The number at the end is the way of listening. A version that hears songs differently changes it and starts again.
  const note = join(cache, "Songs", `${stampOf(file)}-1.json`);
  try {
    return JSON.parse(readFileSync(note, "utf8"));
  } catch {}
  const heard = await listenApart(ffmpegPath, file);
  if (!heard) return null;
  mkdirSync(join(cache, "Songs"), { recursive: true });
  writeFileSync(note, JSON.stringify(heard));
  return heard;
}

/** How many samples a second, and how many channels, a song is handed to the editor's player with. */
export const playRate = 48000, playChannels = 2;

/**
 * A song as the editor plays and draws it: its sound as 16-bit samples, how long that is, and its
 * sound wave. Null when the file can't be read as sound.
 */
export async function soundOf(file, ffmpeg) {
  if (!existsSync(file)) return null;
  const [played, mono] = await Promise.all([
    ffmpeg.run(["-v", "error", "-i", file, "-map", "0:a:0", "-t", "1200", "-ac", String(playChannels), "-ar", String(playRate), "-f", "s16le", "-"], { bytes: true }),
    ffmpeg.sound(file, 16000),
  ]);
  if (played.code !== 0 || played.out.length < 4 || !mono) return null;
  const frames = Math.floor(played.out.length / (2 * playChannels));
  return { pcm: played.out.subarray(0, frames * 2 * playChannels), rate: playRate, channels: playChannels, length: frames / playRate, wave: soundWave(mono, 16000) };
}
