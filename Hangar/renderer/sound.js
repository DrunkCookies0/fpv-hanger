// Playing a song in the marker editor: under the picture, where it has been placed against the
// clip, and by itself in the sound wave window. The song is held whole, so it starts on the exact
// sample asked for.

let context = null;
const output = () => (context ??= new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }));

export class SongSound {
  /** Set by the checks that work the editor themselves, so the song isn't heard while they do. */
  static muted = false;

  /** @param {{ pcm: Uint8Array, rate: number, channels: number, length: number }} sound 16-bit samples, channels interleaved */
  constructor({ pcm, rate, channels, length }) {
    this.length = length;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const frames = Math.floor(samples.length / channels);
    this.buffer = new AudioBuffer({ length: Math.max(1, frames), numberOfChannels: channels, sampleRate: rate });
    for (let channel = 0; channel < channels; channel += 1) {
      const data = this.buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame += 1) data[frame] = samples[frame * channels + channel] / 32768;
    }
    this.source = null;
    /** What is playing: when it started on the output's clock, where in the song, and how fast. */
    this.going = null;
  }

  /**
   * Plays the song from `from` to `until` (seconds into it), starting `wait` seconds from now, at
   * `speed` times its own pace. With `shape`, it is eased in and faded out as a finished video
   * has it: { rise: [from, to], fall: [from, to] }, seconds into the song.
   */
  play({ from, until = this.length, wait = 0, speed = 1, shape = null }) {
    this.stop();
    const start = Math.max(0, from), end = Math.min(this.length, until);
    if (!(end - start > 0.005)) return;
    const audio = output();
    if (audio.state === "suspended") audio.resume();
    const source = new AudioBufferSourceNode(audio, { buffer: this.buffer, playbackRate: speed });
    const volume = new GainNode(audio, { gain: SongSound.muted ? 0 : 1 });
    source.connect(volume).connect(audio.destination);
    const when = audio.currentTime + Math.max(0, wait);
    if (shape && !SongSound.muted) loudness(volume.gain, shape, { when, start, speed });
    source.start(when, start, end - start);
    source.onended = () => { if (this.source === source) this.source = this.going = null; };
    this.source = source;
    this.going = { when, from: start, until: end, speed, shape };
  }

  stop() {
    if (!this.source) return;
    this.source.onended = null;
    try {
      this.source.stop();
    } catch {}
    this.source.disconnect();
    this.source = this.going = null;
  }

  get playing() { return this.going !== null; }

  /** How far into the song what is being heard now is. Null when nothing is playing. */
  position() {
    if (!this.going) return null;
    const audio = output();
    // What leaves the speakers was handed over a moment ago.
    const heard = audio.currentTime - (audio.outputLatency || audio.baseLatency || 0);
    return Math.min(this.going.until, Math.max(this.going.from, this.going.from + (heard - this.going.when) * this.going.speed));
  }

  /**
   * Keeps the song in step with a picture: told that the moment `wanted` seconds into the song is
   * the one that belongs to what is on screen now, it starts again from the right place when it has
   * drifted further than the eye and ear forgive.
   */
  follow(wanted, { until, speed }) {
    if (!this.going) return;
    const now = this.position();
    if (now === null || wanted < this.going.from - 0.001 || Math.abs(now - wanted) < 0.02) return;
    const audio = output();
    this.play({ from: wanted + (audio.outputLatency || audio.baseLatency || 0) * speed, until, speed, shape: this.going.shape });
  }
}

/** How loud a shaped song is at a moment of it: rising to full, then falling to nothing. */
function level({ rise, fall }, at) {
  const up = rise[1] > rise[0] ? Math.min(1, Math.max(0, (at - rise[0]) / (rise[1] - rise[0]))) : 1;
  const down = fall[1] > fall[0] ? Math.min(1, Math.max(0, (fall[1] - at) / (fall[1] - fall[0]))) : 1;
  return up * down;
}

/** Sets a song's loudness to follow its shape from wherever in the song it starts. */
function loudness(gain, shape, { when, start, speed }) {
  const clock = (at) => when + (at - start) / speed;
  gain.setValueAtTime(level(shape, start), when);
  for (const at of [shape.rise[1], shape.fall[0], shape.fall[1]].sort((a, b) => a - b)) {
    if (at > start) gain.linearRampToValueAtTime(level(shape, at), clock(at));
  }
}
