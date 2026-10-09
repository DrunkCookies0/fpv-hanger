// Listening to a song: its tempo, where its beat falls, and where it suddenly gets bigger (a drop).
//
// It takes the song as one channel of samples, 22,050 a second, with the loudest at 1, and works
// entirely in arithmetic, so it gives the same answer on every machine.

/** The value a list of readings would have at a place between two of them. */
function reading(values, place) {
  if (!(place >= 0) || !(place < values.length - 1)) return 0;
  const whole = Math.floor(place), part = place - whole;
  return values[whole] * (1 - part) + values[whole + 1] * part;
}

/** Each reading less the average of those around it, or nothing where that is below zero: what stands out locally. */
function standingOut(values, reach) {
  const sums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) sums[index + 1] = sums[index] + values[index];
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const first = Math.max(0, index - reach), last = Math.min(values.length, index + reach + 1);
    result[index] = Math.max(0, values[index] - (sums[last] - sums[first]) / (last - first));
  }
  return result;
}

/** The moment between two times at which the sound steps up the most: where a drum or a bass note
 *  really starts. Null when nothing in between does. */
export function attack(samples, rate, earliest, latest) {
  // The energy in the 30 thousandths of a second after a moment, less that in the 30 before it. It
  // is greatest exactly where a sound begins. Shorter than that and a single cycle of a bass note
  // would pass for a start.
  const width = Math.trunc(0.03 * rate);
  const first = Math.max(width, Math.trunc(earliest * rate)), last = Math.min(samples.length - width, Math.trunc(latest * rate));
  if (!(last > first)) return null;
  let before = 0, after = 0;
  for (let index = first - width; index < first; index += 1) before += samples[index] * samples[index];
  for (let index = first; index < first + width; index += 1) after += samples[index] * samples[index];
  let best = first, biggest = 0, grew = 1;
  for (let index = first; index < last; index += 1) {
    if (after - before > biggest) {
      biggest = after - before;
      best = index;
      grew = after / Math.max(before, 1e-9);
    }
    const leaving = samples[index - width], crossing = samples[index], entering = samples[index + width];
    before += crossing * crossing - leaving * leaving;
    after += entering * entering - crossing * crossing;
  }
  // Half as much again, and more than a whisper, or it is not the start of anything.
  if (!(grew >= 1.5) || !(biggest > 1e-5 * width)) return null;
  return best / rate;
}

/** The squared size of each frequency in 1,024 samples, the way the Mac's own routine scales it. */
function makeSpectrum(size) {
  const half = size / 2, bits = Math.log2(size);
  const reversed = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let value = 0;
    for (let bit = 0; bit < bits; bit += 1) if (index & (1 << bit)) value |= 1 << (bits - 1 - bit);
    reversed[index] = value;
  }
  const cos = new Float64Array(half), sin = new Float64Array(half);
  for (let index = 0; index < half; index += 1) {
    cos[index] = Math.cos((2 * Math.PI * index) / size);
    sin[index] = Math.sin((2 * Math.PI * index) / size);
  }
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  return (windowed, spectrum) => {
    for (let index = 0; index < size; index += 1) {
      real[reversed[index]] = windowed[index];
      imaginary[index] = 0;
    }
    for (let span = 1; span < size; span *= 2) {
      const stride = size / (span * 2);
      for (let start = 0; start < size; start += span * 2) {
        for (let offset = 0; offset < span; offset += 1) {
          const a = start + offset, b = a + span;
          const c = cos[offset * stride], s = sin[offset * stride];
          const tr = real[b] * c + imaginary[b] * s, ti = imaginary[b] * c - real[b] * s;
          real[b] = real[a] - tr;
          imaginary[b] = imaginary[a] - ti;
          real[a] += tr;
          imaginary[a] += ti;
        }
      }
    }
    // Twice the plain transform, squared: four times its squared size.
    for (let bin = 0; bin < half; bin += 1) spectrum[bin] = 4 * (real[bin] * real[bin] + imaginary[bin] * imaginary[bin]);
  };
}

/** Works out a song's tempo, where its beat falls, and where it suddenly gets bigger. */
export function listen(samples, rate) {
  const report = { length: samples.length / rate, tempo: null, firstBeat: null, beatLength: null, spots: [] };
  const size = 1024, half = size / 2, hop = 256;
  if (!(samples.length > size * 8)) return report;
  const perSecond = rate / hop;
  const count = Math.trunc(samples.length / hop) + 1;

  // The song's spectrum 86 times a second. Reading number n is centred on sample n × hop.
  const padded = new Float64Array(half + samples.length + size);
  padded.set(samples, half);
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
  const transform = makeSpectrum(size);
  // Bands a third of an octave or so wide, from 43 Hz to 10 kHz: a drum shows up as a jump in several at once.
  const edges = [];
  for (let index = 0; index <= 40; index += 1) {
    const bin = Math.round(2 * 230 ** (index / 40));
    if (edges[edges.length - 1] !== bin) edges.push(bin);
  }
  const bands = edges.length - 1;
  const lowBands = edges.slice(0, -1).filter((edge) => edge < 9).length;
  const levels = new Float64Array(count * bands);
  // All the sound in each reading, and the bass alone (below 150 Hz).
  const power = new Float64Array(count), bassPower = new Float64Array(count);
  const windowed = new Float64Array(size), spectrum = new Float64Array(half);
  const scale = 1 / (half * half);
  for (let index = 0; index < count; index += 1) {
    const start = index * hop;
    for (let sample = 0; sample < size; sample += 1) windowed[sample] = padded[start + sample] * window[sample];
    transform(windowed, spectrum);
    let all = 0, bass = 0;
    for (let bin = 1; bin < half; bin += 1) all += spectrum[bin];
    for (let bin = 1; bin <= 7; bin += 1) bass += spectrum[bin];
    power[index] = all * scale;
    bassPower[index] = bass * scale;
    for (let band = 0; band < bands; band += 1) {
      let sum = 0;
      for (let bin = edges[band]; bin < edges[band + 1]; bin += 1) sum += spectrum[bin];
      // Squashed, so a quiet band's jump counts as well as a loud one's.
      levels[index * bands + band] = Math.log(1 + 100 * Math.sqrt(sum * scale));
    }
  }

  // How much is starting at each reading: the rise in every band over two readings, added up.
  const onsets = new Float64Array(count), bassOnsets = new Float64Array(count);
  for (let index = 2; index < count; index += 1) {
    let all = 0, low = 0;
    for (let band = 0; band < bands; band += 1) {
      const rise = levels[index * bands + band] - levels[(index - 2) * bands + band];
      if (rise > 0) {
        all += rise;
        if (band < lowBands) low += rise;
      }
    }
    onsets[index] = all;
    bassOnsets[index] = low;
  }
  const beatSignal = standingOut(onsets, Math.trunc(perSecond / 2));

  // Tempo. A beat repeats, so what starts in the song lines up with itself one beat later, two
  // later, four later. The gap that does that best is the beat, or twice or half it.
  const longest = Math.min(count - 2, Math.trunc(5.4 * perSecond));
  const echo = new Float64Array(longest + 1);
  for (let lag = 0; lag <= longest; lag += 1) {
    let sum = 0;
    for (let index = 0; index < count - lag; index += 1) sum += beatSignal[index] * beatSignal[index + lag];
    echo[lag] = sum / (count - lag);
  }
  const fit = (gap) => (reading(echo, gap) + reading(echo, 2 * gap) + reading(echo, 4 * gap)) / 3;
  let best = { tempo: 0, score: 0 };
  for (let step = 0; step <= 3900; step += 1) {
    const tempo = 45 + step * 0.05;
    const gap = (60 / tempo) * perSecond;
    if (!(4 * gap < longest)) continue;
    const score = fit(gap);
    if (score > best.score) best = { tempo, score };
  }
  // A pulse has to echo clearly, or it is not one.
  if (!(best.score > 0) || !(echo[0] > 0) || !(best.score / echo[0] > 0.1)) {
    report.spots = spots({ power, bassPower, onsets, bassOnsets, perSecond, samples, rate, beat: null });
    return report;
  }
  // Which of a beat, half of it and twice it gets called "the beat" is a habit, not something in the
  // sound: 87 and 174 are the same song. Take the one between 90 and 180, as long as things really do
  // start that far apart.
  let chosen = best.tempo;
  while (chosen < 90) chosen *= 2;
  while (chosen >= 180) chosen /= 2;
  if (chosen !== best.tempo && reading(echo, (60 / chosen) * perSecond) < 0.4 * reading(echo, (60 / best.tempo) * perSecond)) chosen = best.tempo;
  best.tempo = chosen;
  report.tempo = best.tempo;

  // The beat to a hair. A whole song of beats only stays lined up with a grid whose gap is right to a
  // few millionths, so try gaps closely either side of the first answer and keep the one whose grid
  // catches the most of what starts in the song. Done in pieces of eight beats: within one the gap
  // being a touch out hardly shows, and between them it shows as a slide.
  const smooth = Float64Array.from(beatSignal);
  for (let index = 1; index < count - 1; index += 1) smooth[index] = 0.25 * beatSignal[index - 1] + 0.5 * beatSignal[index] + 0.25 * beatSignal[index + 1];
  let gap = (60 / best.tempo) * perSecond;
  let grid = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const slots = Math.max(8, Math.round(gap * 4)), slot = gap / slots;
    const pieces = Math.trunc(count / (gap * 8));
    if (pieces < 4) break;
    const shape = new Float64Array(pieces * slots);
    for (let piece = 0; piece < pieces; piece += 1) {
      for (let place = 0; place < slots; place += 1) {
        let sum = 0;
        for (let beat = 0; beat < 8; beat += 1) sum += reading(smooth, (piece * 8 + beat) * gap + place * slot);
        shape[piece * slots + place] = sum;
      }
    }
    const reach = pass === 0 ? 0.4 : 0.02, fine = pass === 0 ? 0.0005 : 0.00005;
    const tries = Math.trunc(reach / fine + 1e-9);
    let found = { change: 0, place: 0, caught: 0 };
    const caught = new Float64Array(slots);
    for (let attempt = -tries; attempt <= tries; attempt += 1) {
      const change = attempt * fine;
      caught.fill(0);
      for (let piece = 0; piece < pieces; piece += 1) {
        // A gap this much longer puts this piece's beats this much later.
        let slide = ((piece * 8 + 3.5) * change) / slot;
        slide -= Math.floor(slide / slots) * slots;
        const whole = Math.trunc(slide), part = slide - whole;
        const row = piece * slots;
        for (let place = 0; place < slots; place += 1) {
          const a = (place + whole) % slots, b = (a + 1) % slots;
          caught[place] += shape[row + a] * (1 - part) + shape[row + b] * part;
        }
      }
      for (let place = 0; place < slots; place += 1) if (caught[place] > found.caught) found = { change, place, caught: caught[place] };
    }
    // How much of each piece's own best the one grid catches: all of it for a song in steady time.
    let own = 0;
    for (let piece = 0; piece < pieces; piece += 1) {
      let most = 0;
      for (let place = 0; place < slots; place += 1) most = Math.max(most, shape[piece * slots + place]);
      own += most;
    }
    gap += found.change;
    grid = { gap, first: found.place * slot, held: own > 0 ? found.caught / own : 0 };
  }
  let beat = null;
  if (grid && grid.held >= 0.8) {
    let length = grid.gap / perSecond;
    let first = grid.first / perSecond;
    // The grid is on the readings, which are 12 thousandths of a second apart and see a drum a
    // little before it lands. Lay it on the drums themselves: find where the sound really starts
    // at the strongest beats, and move and stretch the grid to run through those.
    const strongest = [];
    for (let number = 0; first + number * length < report.length - 0.1; number += 1) {
      strongest.push({ strength: reading(smooth, (first + number * length) * perSecond), number });
    }
    strongest.sort((a, b) => b.strength - a.strength);
    const landed = [];
    for (const one of strongest.slice(0, 120)) {
      const time = first + one.number * length;
      const real = attack(samples, rate, time - 0.03, time + 0.045);
      if (real !== null) landed.push({ number: one.number, late: real - time });
    }
    if (landed.length >= 12) {
      const sorted = landed.map((one) => one.late).sort((a, b) => a - b);
      const middle = sorted[Math.trunc(sorted.length / 2)];
      // The ones that agree, to within a few thousandths of a second. The rest caught something else.
      const agreeing = landed.filter((one) => Math.abs(one.late - middle) < 0.006);
      if (agreeing.length >= 12 && agreeing.length * 2 >= landed.length) {
        const n = agreeing.length;
        const meanNumber = agreeing.reduce((sum, one) => sum + one.number, 0) / n, meanLate = agreeing.reduce((sum, one) => sum + one.late, 0) / n;
        let spread = 0, together = 0;
        for (const one of agreeing) {
          spread += (one.number - meanNumber) * (one.number - meanNumber);
          together += (one.number - meanNumber) * (one.late - meanLate);
        }
        // Only stretch it when the beats used reach across the song.
        const stretch = spread > n * 400 ? together / spread : 0;
        first += meanLate - stretch * meanNumber;
        length += stretch;
      }
    }
    first -= Math.floor(first / length) * length;
    beat = { first, length };
    report.tempo = 60 / length;
    report.firstBeat = first;
    report.beatLength = length;
  }
  report.spots = spots({ power, bassPower, onsets, bassOnsets, perSecond, samples, rate, beat });
  return report;
}

/** Where a song suddenly gets bigger: louder, or heavier in the bass, and stays that way. */
function spots({ power, bassPower, onsets, bassOnsets, perSecond, samples, rate, beat }) {
  const count = power.length;
  const wide = Math.trunc(4 * perSecond), least = Math.trunc(3 * perSecond), narrow = Math.trunc(perSecond);
  if (!(count > 2 * least + 2)) return [];
  // Loudness in decibels against the song's own loud passages, with a floor 20 below them.
  const decibels = (values) => {
    const sorted = Float64Array.from(values).sort();
    const top = Math.max(sorted[Math.trunc((sorted.length - 1) * 0.95)], 1e-12);
    return { levels: Float64Array.from(values, (value) => 10 * Math.log10(value / top + 0.01)), top };
  };
  const all = decibels(power), bass = decibels(bassPower);
  // A song with next to no bass in it is judged on loudness alone.
  const bassCounts = bass.top / all.top > 0.003 ? 0.5 : 0;
  const sums = (values) => {
    const result = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index += 1) result[index + 1] = result[index] + values[index];
    return result;
  };
  const allSums = sums(all.levels), bassSums = sums(bass.levels);
  const average = (totals, from, to) => {
    const first = Math.max(0, from), last = Math.min(count, to);
    return last > first ? (totals[last] - totals[first]) / (last - first) : -20;
  };
  /** How much bigger the song is in the `reach` readings after a moment than in those before it. */
  const step = (index, reach) => {
    const louder = average(allSums, index, index + reach) - average(allSums, index - reach, index);
    const heavier = average(bassSums, index, index + reach) - average(bassSums, index - reach, index);
    return (1 - bassCounts) * louder + bassCounts * heavier;
  };
  // What it arrives at matters too: a step up into one of the song's loud passages counts in full,
  // one that is still quiet afterwards for less.
  const sections = [];
  for (let index = least; index < count - least; index += 1) sections.push(average(allSums, index, index + wide));
  sections.sort((a, b) => a - b);
  const loud = sections[Math.trunc((sections.length - 1) * 0.9)];
  const scores = new Float64Array(count);
  for (let index = least; index < count - least; index += 1) {
    const arriving = Math.min(1, Math.max(0.2, 1 + (average(allSums, index, index + wide) - loud) / 10));
    scores[index] = step(index, wide) * arriving;
  }
  // The biggest steps, no two within five seconds of each other.
  const found = [];
  const apart = Math.trunc(5 * perSecond);
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
  for (const index of order) {
    if (!(scores[index] >= 3) || found.length >= 8) break;
    if (!found.some((one) => Math.abs(one.index - index) < apart)) found.push({ index, score: scores[index] });
  }
  if (found.length === 0) return [];
  const biggest = Math.max(...found.map((one) => one.score));
  const starts = Float64Array.from(onsets, (value, index) => value + 2 * bassOnsets[index]);
  const result = [];
  for (const one of found) {
    if (!(one.score >= 0.3 * biggest)) continue;
    // The step is felt over seconds. The moment itself is the start of a sound close by, the one
    // the song is most changed across.
    const from = Math.max(narrow, one.index - Math.trunc(0.75 * perSecond)), to = Math.min(count - narrow - 1, one.index + Math.trunc(0.75 * perSecond));
    let hardest = 0;
    for (let index = from; index <= to; index += 1) hardest = Math.max(hardest, starts[index]);
    let moment = one.index, clearest = -Infinity;
    for (let index = from; index <= to; index += 1) {
      if (starts[index] >= 0.3 * hardest && starts[index] >= starts[index - 1] && starts[index] >= starts[index + 1]) {
        const change = step(index, narrow);
        if (change > clearest) {
          clearest = change;
          moment = index;
        }
      }
    }
    let time = moment / perSecond;
    const real = attack(samples, rate, time - 0.03, time + 0.05);
    if (real !== null) time = real;
    // On the beat when it is as good as on it: the grid is the steadier of the two.
    if (beat) {
      const nearest = beat.first + Math.round((time - beat.first) / beat.length) * beat.length;
      if (Math.abs(nearest - time) < 0.03) time = nearest;
    }
    result.push({ time, strength: one.score / biggest });
  }
  return result.sort((a, b) => a.time - b.time);
}

/** The beat nearest a moment in a song that keeps steady time. */
export function nearestBeat(report, time) {
  if (report.firstBeat === null || report.beatLength === null) return null;
  return report.firstBeat + Math.round((time - report.firstBeat) / report.beatLength) * report.beatLength;
}

/** Scales samples so the loudest is 1, as `listen` expects. */
export function normalised(samples) {
  let top = 0;
  for (let index = 0; index < samples.length; index += 1) top = Math.max(top, Math.abs(samples[index]));
  if (!(top > 0)) return samples;
  const scaled = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) scaled[index] = samples[index] / top;
  return scaled;
}
