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
   * `speed` times its own pace.
   */
  play({ from, until = this.length, wait = 0, speed = 1 }) {
    this.stop();
    const start = Math.max(0, from), end = Math.min(this.length, until);
    if (!(end - start > 0.005)) return;
    const audio = output();
    if (audio.state === "suspended") audio.resume();
    const source = new AudioBufferSourceNode(audio, { buffer: this.buffer, playbackRate: speed });
    const volume = new GainNode(audio, { gain: SongSound.muted ? 0 : 1 });
    source.connect(volume).connect(audio.destination);
    const when = audio.currentTime + Math.max(0, wait);
    source.start(when, start, end - start);
    source.onended = () => { if (this.source === source) this.source = this.going = null; };
    this.source = source;
    this.going = { when, from: start, until: end, speed };
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
    this.play({ from: wanted + (audio.outputLatency || audio.baseLatency || 0) * speed, until, speed });
  }
}
