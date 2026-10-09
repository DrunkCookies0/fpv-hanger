// Lap timing: frame rates, timecodes, marker files, and the laps they come to.
//
// This is the lap timer's arithmetic, the same on every platform. Times are kept as whole numbers
// of display units (thousandths of a second by default), so the laps shown always add up exactly
// to the totals shown.

/** Why a marker file can't be timed. */
export class Unusable extends Error {}

export const pow10 = (n) => 10 ** n;

export function zeroPad(value, width) {
  return String(value).padStart(width, "0");
}

/** A time held in display units, as `m:ss.ddd`, or `ss.ddd` under a minute. `plain` keeps it in
 *  seconds however long it is, the way an entry form wants it. */
export function formatTime(units, { decimals = 3, minutes = false, plain = false } = {}) {
  const perSecond = pow10(decimals);
  const whole = Math.trunc(units / perSecond);
  const fraction = decimals > 0 ? "." + zeroPad(units % perSecond, decimals) : "";
  if (!plain && (minutes || whole >= 60)) return `${Math.trunc(whole / 60)}:${zeroPad(whole % 60, 2)}${fraction}`;
  return `${whole}${fraction}`;
}

/** Parses `ss.sss`, `m:ss.sss` or `h:mm:ss.sss`. Null when it isn't one of those. */
export function parseSeconds(text) {
  const parts = text.trim().split(":");
  if (parts.length < 1 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return total;
}

/** A frame rate as a fraction, so 59.94 is exactly 60000/1001. */
export class FrameRate {
  constructor(num, den = 1) {
    this.num = num;
    this.den = den;
  }

  get value() { return this.num / this.den; }
  /** Frames per timecode second: 30 for 29.97, 60 for 59.94. */
  get timebase() { return Math.round(this.value); }
  get label() {
    if (this.den === 1) return String(this.num);
    return this.value.toFixed(3).replace(/0+$/, "");
  }

  static standard = [
    [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1],
    [100, 1], [120000, 1001], [120, 1], [240000, 1001], [240, 1],
  ].map(([num, den]) => new FrameRate(num, den));

  static nearest(rate) {
    if (!Number.isFinite(rate) || rate < 1) return null;
    let match = FrameRate.standard[0];
    for (const one of FrameRate.standard) if (Math.abs(one.value - rate) < Math.abs(match.value - rate)) match = one;
    if (Math.abs(match.value - rate) < 0.02) return match;
    return new FrameRate(Math.round(rate * 1000), 1000);
  }

  static parse(text) {
    const rate = Number(String(text).trim());
    return String(text).trim() === "" ? null : FrameRate.nearest(rate);
  }
}

const timecodePattern = /(?<![\d:;.])(\d{1,2})[:;](\d{2})[:;](\d{2})[:;](\d{2,3})(?![\d:;.])/;

/** A timecode such as `00:00:12:14`, or `00;00;12;14` for drop-frame. */
export class Timecode {
  constructor(hours, minutes, seconds, frames, text) {
    Object.assign(this, { hours, minutes, seconds, frames, text, dropFrame: text.includes(";") });
  }

  static first(string) {
    const match = timecodePattern.exec(string);
    if (!match) return null;
    return new Timecode(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), match[0]);
  }

  frameNumber(fps) {
    const timebase = fps.timebase;
    if (this.frames >= timebase) {
      throw new Unusable(`marker ${this.text} has frame number ${this.frames}, which can't exist at ${fps.label} frames a second`);
    }
    let number = ((this.hours * 60 + this.minutes) * 60 + this.seconds) * timebase + this.frames;
    if (this.dropFrame && fps.den === 1001 && timebase % 30 === 0) {
      const totalMinutes = this.hours * 60 + this.minutes;
      number -= (timebase / 15) * (totalMinutes - Math.trunc(totalMinutes / 10));
    }
    return number;
  }
}

/** A marker written as timecode or as plain time, in seconds from the start of the sequence. */
export function markerSeconds(token, fps) {
  const timecode = Timecode.first(token);
  if (timecode) return (timecode.frameNumber(fps) * fps.den) / fps.num;
  return parseSeconds(token);
}

/** A marker file's bytes as text. Premiere exports markers as UTF-16, sometimes with no mark saying so. */
export function decodeText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const starts = (a, b) => data.length >= 2 && data[0] === a && data[1] === b;
  if (starts(0xff, 0xfe)) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (starts(0xfe, 0xff)) return new TextDecoder("utf-16be").decode(data.subarray(2));
  const sample = data.subarray(0, 400);
  let zeros = 0, oddZeros = 0;
  sample.forEach((byte, index) => {
    if (byte === 0) {
      zeros += 1;
      if (index % 2 === 1) oddZeros += 1;
    }
  });
  if (zeros > sample.length / 4) return new TextDecoder(oddZeros * 2 >= zeros ? "utf-16le" : "utf-16be").decode(data);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

// Every kind of line break a marker file can have, Premiere's included.
const lineBreak = new RegExp("\\r\\n|[\\r\\n\\u2028\\u2029\\u0085\\u000b\\u000c]");
const lines = (text) => text.split(lineBreak);

/** One time per marker, out of a Premiere marker export or a plain list of times. */
export function markerTokens(text) {
  const kept = lines(text).filter((line) => line.trim() !== "" && !line.startsWith("#"));
  let inColumn = null;
  if (kept.length > 0) {
    for (const delimiter of ["\t", ","]) {
      const columns = kept[0].split(delimiter).map((cell) => cell.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase());
      const index = columns.indexOf("in");
      if (index >= 0) {
        inColumn = { index, delimiter };
        break;
      }
    }
  }
  const tokens = [];
  for (const line of kept) {
    if (inColumn) {
      const cells = line.split(inColumn.delimiter);
      const timecode = inColumn.index < cells.length ? Timecode.first(cells[inColumn.index]) : null;
      if (timecode) {
        tokens.push(timecode.text);
        continue;
      }
    }
    const timecode = Timecode.first(line);
    if (timecode) tokens.push(timecode.text);
    else if (parseSeconds(line) !== null) tokens.push(line.trim());
  }
  return tokens;
}

/** Markers placed in the app say so on a line starting with "#". They are in the clip's own time. */
export function markersAreInClipTime(text) {
  return lines(text).some((line) => line.startsWith("#") && line.toLowerCase().includes("clip time"));
}

/** The gate crossings in a marker file's text, in seconds. */
export function crossingsIn(text, fps, sequenceStart = null) {
  const seconds = markerTokens(text).map((token) => markerSeconds(token, fps)).filter((value) => value !== null);
  if (seconds.length === 0) throw new Unusable("no marker times found");
  if (sequenceStart === null) return seconds;
  const offset = markerSeconds(sequenceStart, fps);
  if (offset === null) throw new Unusable("the sequence's start isn't a timecode");
  return seconds.map((value) => value - offset);
}

/** Gate crossings as a race: each crossing in display units, the laps between them, and the
 *  fastest run of `window` laps in a row. */
export class Race {
  constructor(bounds, decimals = 3, window = 3) {
    this.bounds = bounds;
    this.decimals = decimals;
    this.window = window;
  }

  /** From crossings in seconds. Throws `Unusable` when there aren't two of them to make a lap. */
  static from(crossings, { decimals = 3, window = 3 } = {}) {
    if (crossings.some((value) => value < 0)) throw new Unusable("a marker falls before the start of the sequence");
    const perSecond = pow10(decimals);
    const bounds = [...new Set(crossings.map((value) => roundHalfAwayFromZero(value * perSecond)))].sort((a, b) => a - b);
    if (bounds.length < 2) {
      throw new Unusable(`at least two markers are needed (where lap 1 starts, then the end of each lap), found ${bounds.length}`);
    }
    return new Race(bounds, decimals, window);
  }

  get unitsPerSecond() { return pow10(this.decimals); }
  get lapCount() { return this.bounds.length - 1; }

  lap(index) { return this.bounds[index + 1] - this.bounds[index]; }

  completed(now) {
    let count = 0;
    for (let index = 1; index < this.bounds.length; index += 1) if (this.bounds[index] <= now) count += 1;
    return count;
  }

  /** Fastest run of `window` consecutive laps among the first `completed` laps, or null. */
  best(completed = this.lapCount) {
    if (completed < this.window) return null;
    let result = null;
    for (let start = 0; start <= completed - this.window; start += 1) {
      const total = this.bounds[start + this.window] - this.bounds[start];
      if (result === null || total < result.total) result = { start, total };
    }
    return result;
  }

  time(units, minutes = false) {
    return formatTime(units, { decimals: this.decimals, minutes });
  }
}

/** Rounds the way Swift's `rounded()` does: halves go away from zero. `Math.round` sends -0.5 to 0. */
export function roundHalfAwayFromZero(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Markers dropped during playback tend to land on a coarse step rather than the exact frame, which
 *  shows as every gap between them sharing a common factor. The step, or null when they look exact. */
export function coarseStep(crossings, fps) {
  if (crossings.length < 4) return null;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const frames = crossings.map((value) => roundHalfAwayFromZero(value * fps.value)).sort((a, b) => a - b);
  const gaps = frames.slice(1).map((frame, index) => frame - frames[index]);
  const step = gaps.reduce(gcd, 0);
  return step >= 3 && step ** gaps.length >= 500 ? step : null;
}

/** The marker file the app writes: one line per crossing, as timecode in the clip's own time. */
export const markerFileTag = "# FPV Hangar markers, in clip time";

export function markerFile(frames, fps) {
  const timebase = fps.timebase;
  const code = (frame) => {
    const seconds = Math.trunc(frame / timebase);
    return [Math.trunc(seconds / 3600), Math.trunc(seconds / 60) % 60, seconds % 60, frame % timebase].map((part) => zeroPad(part, 2)).join(":");
  };
  const rows = [...frames].sort((a, b) => a - b).map((frame, index) => {
    const at = code(frame);
    return `${index === 0 ? "Lap 1 starts" : `Lap ${index} ends`},,${at},${at},00:00:00:00,Comment`;
  });
  return [`${markerFileTag}, ${fps.label} frames a second`, "Marker Name,Description,In,Out,Duration,Marker Type", ...rows].join("\n") + "\n";
}
