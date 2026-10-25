// How well a song suits a run's video. Two things count: whether the song lasts the whole video
// with its drop on the start gate, and whether the run's later gate crossings land on its beat,
// and best of all on its bar lines, once a beat is on the start gate. A run whose laps last a whole
// number of bars at a song's tempo crosses every gate on the music.
//
// It works only in arithmetic, so it gives the same answer everywhere and is tested by itself.

/** How far off a beat a gate can be and still be heard on it, in seconds. */
export const onTime = 0.06;
/** What a part of the fit that isn't known counts for, out of 1. */
const unknown = 0.4;
/** The tempos a run is matched against, as the app says a tempo: between 90 and 180, as listen.js does. */
export const slowest = 90, fastest = 180;

/** A tempo said the app's way: 87 and 174 are the same song, so it is doubled or halved into 90 to 180. */
export function usualTempo(tempo) {
  if (!(tempo > 0) || !Number.isFinite(tempo)) return null;
  let usual = tempo;
  while (usual < slowest) usual *= 2;
  while (usual >= fastest) usual /= 2;
  return usual;
}

/**
 * The run as a song is fitted to it: when each gate is crossed, in seconds into the clip (the first
 * starts lap 1), and the stretch of the clip its video covers. Null when there is nothing to fit to:
 * fewer than two crossings, or no stretch.
 */
export function runShape(crossings, stretch) {
  const gates = [...(crossings ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
  if (gates.length < 2 || !stretch || !(stretch.to > stretch.from)) return null;
  const laps = gates.slice(1).map((gate, index) => gate - gates[index]);
  const sorted = [...laps].sort((a, b) => a - b);
  return { gates, from: stretch.from, to: stretch.to, length: stretch.to - stretch.from, laps, lap: sorted[Math.trunc(sorted.length / 2)] };
}

/** How near a time is to a whole number of steps, as a share of being right on one: 1 on it, falling away within `onTime`. */
const hit = (time, step) => {
  const off = Math.abs(time - step * Math.round(time / step));
  return Math.exp(-((off / onTime) ** 2));
};

/**
 * How the run's gates fall on a tempo, with a beat on the start gate. Each later gate in the video
 * counts in full on a bar line (four beats) and for less on any other beat. `score` is 0 for gates
 * that land no better than gates anywhere would, and 1 for every one on a bar line.
 */
export function onTheBeat(run, tempo) {
  const usual = usualTempo(tempo);
  if (!run || usual === null) return null;
  const beat = 60 / usual, bar = 4 * beat;
  const start = run.gates[0];
  const later = run.gates.slice(1).filter((gate) => gate <= run.to + 1e-9).map((gate) => gate - start);
  if (later.length === 0) return null;
  let total = 0, onBar = 0, onBeat = 0;
  for (const time of later) {
    const toBar = hit(time, bar), toBeat = hit(time, beat);
    total += Math.max(toBar, 0.6 * toBeat);
    if (toBar >= Math.exp(-1)) onBar += 1;
    else if (toBeat >= Math.exp(-1)) onBeat += 1;
  }
  // What gates anywhere would score on average: some beat is near one so often by chance, and on
  // the bar lines among them it counts in full.
  const near = onTime * Math.sqrt(Math.PI);
  const chance = Math.min(0.99, 0.6 * (near / beat) + 0.4 * (near / bar));
  const mean = total / later.length;
  return {
    tempo: usual, gates: later.length, onBar, onBeat,
    score: Math.min(1, Math.max(0, (mean - chance) / (1 - chance))),
    /** How many bars a lap lasts, near enough. */
    barsPerLap: run.lap / bar,
  };
}

/** How long a lap is in a tempo's terms, for the words: "8 bars" when it is about a whole number of
 *  bars, or else "6 beats" when it is about a whole number of beats, or null. */
export function lapInMusic(beat) {
  if (!beat) return null;
  const bars = Math.round(beat.barsPerLap), beats = Math.round(beat.barsPerLap * 4);
  const beatLength = 60 / beat.tempo;
  if (bars >= 1 && Math.abs(beat.barsPerLap - bars) * 4 * beatLength < onTime * 2) return `${bars} bar${bars === 1 ? "" : "s"}`;
  if (beats >= 1 && Math.abs(beat.barsPerLap * 4 - beats) * beatLength < onTime * 2) return `${beats} beat${beats === 1 ? "" : "s"}`;
  return null;
}

/**
 * Where a song can go under the video: which of its drops, if any, goes on the start gate, and
 * what that leaves the video short of at either end. A song with no drops is laid from the start
 * of the video. `lead` is the music missing at the start, `short` at the end, in seconds.
 */
export function placing(song, run) {
  if (!run || !(song.length > 0)) return null;
  const start = run.gates[0];
  const missing = (songStart) => ({ lead: Math.max(0, songStart - run.from), short: Math.max(0, run.to - (songStart + song.length)) });
  const drops = (song.drops ?? []).filter((drop) => drop.time >= 0 && drop.time <= song.length);
  if (drops.length === 0) {
    const songStart = run.from;
    return { drop: null, songStart, ...missing(songStart) };
  }
  // The strongest drop that leaves the video nothing short, or failing that the one that leaves it least.
  let best = null;
  for (const drop of drops) {
    const songStart = start - drop.time;
    const gap = missing(songStart);
    const lacking = gap.lead + gap.short, whole = lacking <= 0.05;
    const better = !best || (whole && !best.whole)
      || (whole === best.whole && (whole ? drop.strength > best.drop.strength : lacking < best.lacking));
    if (better) best = { drop, songStart, ...gap, lacking, whole };
  }
  return { drop: best.drop, songStart: best.songStart, lead: best.lead, short: best.short };
}

const seconds = (time) => `${time.toFixed(1)} s`;
const tempoWords = (tempo) => `${Math.round(tempo * 10) / 10} BPM`;

/**
 * How well a song suits a run: { score, length, beat, place, reasons }. `song` has `tempo` and
 * `length` (either can be null when it isn't known), and a song in the library also `beatLength`
 * and `drops` ({ time, strength }), as the app heard them. `score` is from 0 to 1, or null when
 * there is no run to fit to. A part that isn't known counts for a little less than halfway, so a
 * song known to fit comes before one that only might.
 */
export function fitOf(song, run) {
  if (!run) return { score: null, length: null, beat: null, place: null, reasons: [] };
  const reasons = [];
  const place = song.length > 0 ? placing(song, run) : null;
  let lengthScore = null;
  if (place) {
    const lacking = place.lead + place.short;
    lengthScore = lacking <= 0.05 ? 1 : Math.max(0, 1 - lacking / run.length) ** 2;
    if (lacking <= 0.05) reasons.push({ good: true, text: place.drop ? "Lasts the whole video with its drop on the start gate" : "Lasts the whole video" });
    else if (place.short > 0.05 && place.lead <= 0.05) reasons.push({ good: false, text: `Runs out ${seconds(place.short)} before the video ends` });
    else if (place.lead > 0.05 && place.short <= 0.05) reasons.push({ good: false, text: `With its drop on the start gate, it comes in ${seconds(place.lead)} after the video starts` });
    else reasons.push({ good: false, text: `${seconds(lacking)} shorter than the video` });
  }
  const tempo = song.beatLength > 0 ? 60 / song.beatLength : song.tempo;
  const beat = onTheBeat(run, tempo);
  if (beat) {
    const lap = lapInMusic(beat);
    if (beat.onBar > 0 && beat.onBar * 2 >= beat.gates) reasons.push({ good: true, text: `${beat.onBar} of ${beat.gates} gates land on a bar line at ${tempoWords(beat.tempo)}` });
    else if (beat.onBar + beat.onBeat > 0 && (beat.onBar + beat.onBeat) * 2 >= beat.gates) reasons.push({ good: true, text: `${beat.onBar + beat.onBeat} of ${beat.gates} gates land on a beat at ${tempoWords(beat.tempo)}` });
    else reasons.push({ good: false, text: `Most gates fall between beats at ${tempoWords(beat.tempo)}` });
    if (lap) reasons.push({ good: true, text: `A lap lasts ${lap}` });
  }
  const parts = [[0.45, lengthScore], [0.55, beat?.score ?? null]];
  const score = parts.reduce((sum, [weight, value]) => sum + weight * (value ?? unknown), 0);
  return { score, length: lengthScore, beat, place, reasons };
}

/**
 * The tempos the run's gates land on best, best first: up to `count` of them, each at least 4 BPM
 * from the others, with how well the gates land on it and how many bars a lap lasts. They are
 * what to look for in a song.
 */
export function bestTempos(run, count = 3) {
  if (!run) return [];
  const tried = [];
  for (let tempo = slowest; tempo < fastest; tempo += 0.5) {
    const beat = onTheBeat(run, tempo);
    if (beat) tried.push(beat);
  }
  // Between two that fit as well, the faster: a race wants the quicker song.
  tried.sort((a, b) => b.score - a.score || b.tempo - a.tempo);
  const chosen = [];
  for (const one of tried) {
    if (chosen.length >= count || !(one.score > 0.2)) break;
    if (!chosen.some((other) => Math.abs(other.tempo - one.tempo) < 4)) chosen.push(one);
  }
  return chosen;
}
