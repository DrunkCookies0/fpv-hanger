// FFmpeg, run as a separate program, for everything to do with reading and writing video and sound.
//
// The app carries its own copy. This file is plain Node, so it runs in the app's main process, in
// the hidden window that makes the videos, and in the tests.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { FrameRate } from "../shared/timing.js";

/** The arithmetic each name a file can give its colours stands for, in FFmpeg's own words. A file
 *  that gives none is read by its size, as players do. */
const matrices = { bt709: "bt709", bt470bg: "bt601", smpte170m: "bt601", smpte240m: "bt601", fcc: "bt601", bt2020nc: "bt2020", bt2020c: "bt2020" };

export class FFmpeg {
  /** @param {string} binary where the ffmpeg program is */
  constructor(binary) {
    this.binary = binary;
  }

  /** Runs it. `out` is what it writes out (as bytes when `bytes` is set), `said` what it reports.
   *  `onLine` gets its progress as it goes, `feed` is given the process to write frames to. */
  run(args, { onLine = null, feed = null, bytes = false, signal = null } = {}) {
    return new Promise((done) => {
      const child = spawn(this.binary, ["-hide_banner", ...args], { stdio: [feed ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true, signal: signal ?? undefined });
      const chunks = [];
      let said = "";
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => {
        said += chunk;
        if (onLine) {
          const last = String(chunk).split(/[\r\n]+/).filter(Boolean).pop();
          if (last) onLine(last);
        }
      });
      const finish = (code) => {
        const all = Buffer.concat(chunks);
        done({ code, out: bytes ? all : all.toString("utf8"), said });
      };
      child.on("error", (error) => {
        said += error.message;
        finish(-1);
      });
      child.on("close", finish);
      if (feed) Promise.resolve(feed(child)).catch(() => {});
    });
  }

  /**
   * The quickest way this computer has of encoding a video: its own video chip when FFmpeg can use
   * it, and FFmpeg's own encoder otherwise. Each is tried once, on a moment of nothing.
   */
  async encoder() {
    this.best ??= (async () => {
      const candidates = process.platform === "darwin" ? ["h264_videotoolbox"] : process.platform === "win32" ? ["h264_nvenc", "h264_qsv", "h264_amf"] : [];
      for (const one of candidates) {
        const tried = await this.run(["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=1280x720:r=60:d=0.5", "-c:v", one, "-b:v", "8M", "-pix_fmt", one === "h264_qsv" || one === "h264_amf" ? "nv12" : "yuv420p", "-f", "null", "-"]);
        if (tried.code === 0) return one;
      }
      return "libx264";
    })();
    return this.best;
  }

  /** Told that the video chip let a video down: the rest of this sitting uses FFmpeg's own encoder. */
  distrustEncoder() {
    this.best = Promise.resolve("libx264");
  }

  async version() {
    const answer = await this.run(["-version"]);
    return answer.code === 0 ? answer.out.split("\n")[0].trim() : null;
  }

  /**
   * What a recording holds: its pictures' kind and size, how many frames, how far apart they really
   * are, and whether it has sound. The frame rate is measured from the frames' own times, not taken
   * from the header, which some goggles get wrong.
   */
  async probe(file) {
    const told = await this.run(["-i", file]);
    const line = /Stream #\d+:\d+[^\n]*?Video: ([^\n]*)/.exec(told.said)?.[1] ?? null;
    if (!line) return null;
    const size = /, (\d{2,5})x(\d{2,5})/.exec(line);
    const length = /Duration: (\d+):(\d+):([\d.]+)/.exec(told.said);
    const counted = await this.run(["-v", "error", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"]);
    const base = /#tb 0: (\d+)\/(\d+)/.exec(counted.out);
    const packets = counted.out.split("\n").filter((row) => row && !row.startsWith("#")).map((row) => row.split(",").map((cell) => cell.trim()));
    if (!size || !base || packets.length < 2) return null;
    const times = packets.map((cells) => Number(cells[2])).sort((a, b) => a - b);
    const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    const fps = gap > 0 ? FrameRate.nearest(Number(base[2]) / Number(base[1]) / gap) : null;
    if (!fps) return null;
    const claimed = /, ([\d.]+) tbr/.exec(line);
    const codec = line.split(/[ ,(]/)[0];
    // What the file says of its colours: one name when its three tags agree, or matrix/primaries/transfer.
    const said = (/\((?:pc|tv), ([a-z0-9-]+(?:\/[a-z0-9-]+)*)/.exec(line)?.[1] ?? "").split("/")[0];
    return {
      codec,
      width: Number(size[1]),
      height: Number(size[2]),
      fps,
      frames: packets.length,
      duration: length ? Number(length[1]) * 3600 + Number(length[2]) * 60 + Number(length[3]) : packets.length / fps.value,
      /** The frame rate the header claims, when that isn't how far apart the frames are. */
      claimedFPS: claimed && Math.abs(Number(claimed[1]) - fps.value) > 0.5 ? FrameRate.nearest(Number(claimed[1])) : null,
      /** Frames stored in a different order from the one they are shown in. */
      reorders: packets.some((cells) => cells[1] !== cells[2]),
      keyframes: packets.filter((cells) => !cells.includes("F=0x0")).length,
      fullRange: /yuvj|\(pc/.test(line),
      /** Which arithmetic turns its colours into red, green and blue. */
      matrix: matrices[said] ?? (Number(size[2]) >= 720 ? "bt709" : "bt601"),
      /** How its brightness is stored, when it is HDR: "arib-std-b67" as phones make it, or "smpte2084". */
      hdr: /\/(arib-std-b67|smpte2084)[,)]/.exec(line)?.[1] ?? null,
      hasSound: /Stream #\d+:\d+[^\n]*?Audio:/.test(told.said),
    };
  }

  /**
   * A copy of a recording the app's player can open at once: the same pictures, not re-encoded, in
   * an MP4 with frame n at exactly n / fps. Only for recordings whose frames are stored in order.
   */
  async rewrap(file, to, facts) {
    const ticks = (90000 * facts.fps.den) / facts.fps.num;
    return this.#write(to, (part) => ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-an", "-c", "copy",
      "-bsf:v", `setts=pts=N*${ticks}:dts=N*${ticks}`, "-video_track_timescale", "90000",
      ...(facts.codec === "hevc" ? ["-tag:v", "hvc1"] : []), "-movflags", "+faststart", "-f", "mp4", part]);
  }

  /**
   * A plainer copy, for a machine whose player can't show the recording's own pictures, or a
   * recording whose frames are stored out of order: H.264 with every frame whole, frame n at n / fps.
   * `onProgress` is told how far along it is, from 0 to 1.
   */
  async plainCopy(file, to, facts, onProgress = null) {
    const rate = `${facts.fps.num}/${facts.fps.den}`;
    return this.#write(to, (part) => ["-v", "error", "-stats", "-y", "-i", file, "-map", "0:v:0", "-an",
      "-vf", `settb=${facts.fps.den}/${facts.fps.num},setpts=N,${colours(facts)},format=yuv420p`, "-fps_mode", "cfr", "-r", rate,
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode", "-crf", "20", "-g", "1",
      ...tags, "-movflags", "+faststart", "-f", "mp4", part],
    { onLine: onProgress ? (line) => { const frame = /frame=\s*(\d+)/.exec(line); if (frame) onProgress(Math.min(1, Number(frame[1]) / facts.frames)); } : null });
  }

  /** Writes under another name first, so a half-made file is never taken for a whole one. */
  async #write(to, args, options = {}) {
    mkdirSync(dirname(to), { recursive: true });
    const part = join(dirname(to), `.${Date.now()}.part`);
    const answer = await this.run(args(part), options);
    if (answer.code !== 0 || !existsSync(part) || statSync(part).size === 0) {
      rmSync(part, { force: true });
      return { ok: false, problem: answer.said.trim().split("\n").slice(-3).join(" ") || "FFmpeg wrote nothing" };
    }
    rmSync(to, { force: true });
    renameSync(part, to);
    return { ok: true };
  }

  /**
   * A sound file as one channel of samples, `rate` of them a second. Null when it can't be read.
   * Of anything much longer than a song, the first 20 minutes are read.
   */
  async sound(file, rate) {
    const answer = await this.run(["-v", "error", "-i", file, "-map", "0:a:0", "-t", "1200", "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { bytes: true });
    if (answer.code !== 0 || answer.out.length < 4) return null;
    const whole = answer.out.length - (answer.out.length % 4);
    const samples = new Float32Array(whole / 4);
    for (let index = 0; index < samples.length; index += 1) samples[index] = answer.out.readFloatLE(index * 4);
    return samples;
  }

  /** How long a sound file is, in seconds. */
  async soundLength(file) {
    const told = await this.run(["-i", file]);
    const length = /Duration: (\d+):(\d+):([\d.]+)/.exec(told.said);
    return length && /Audio:/.test(told.said) ? Number(length[1]) * 3600 + Number(length[2]) * 60 + Number(length[3]) : null;
  }

  /** One frame of a video as a JPEG no bigger than `width` across, for showing. Null when it can't be had. */
  async frame(file, seconds, width = 1280) {
    // Reading starts a few seconds early and the frames before the one wanted are thrown away. A
    // recording jumped into at the very moment gives a smeared picture until its next whole frame.
    const early = Math.min(Math.max(0, seconds), 3);
    const answer = await this.run(["-v", "error", "-ss", String(Math.max(0, seconds) - early), "-i", file, "-ss", String(early), "-map", "0:v:0", "-frames:v", "1",
      "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", "-f", "mjpeg", "-"], { bytes: true });
    return answer.code === 0 && answer.out.length > 100 ? answer.out : null;
  }

  /** One frame of a video as grey levels, for looking at its picture. */
  async greyFrame(file, seconds, facts) {
    const answer = await this.run(["-v", "error", "-ss", String(Math.max(0, seconds)), "-i", file, "-map", "0:v:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { bytes: true });
    if (answer.code !== 0 || answer.out.length < facts.width * facts.height) return null;
    return new Uint8Array(answer.out.buffer, answer.out.byteOffset, facts.width * facts.height);
  }
}

/** The filter that brings a recording's colours to the standard a finished video uses. */
export function colours(facts) {
  return `scale=in_color_matrix=${facts.matrix}:in_range=${facts.fullRange ? "full" : "limited"}:out_color_matrix=bt709:out_range=limited`;
}

/** What says so in the file that is written. */
export const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

/**
 * The part of a frame that is picture. Some goggles record a narrower picture with black bars
 * down each side, which an upright video has no room for. `grey` is a frame's grey levels.
 */
export function pictureRect(grey, width, height) {
  const full = { x: 0, y: 0, width, height };
  const isBlack = (x) => {
    let sum = 0, count = 0;
    for (let y = 0; y < height; y += 4) {
      sum += grey[y * width + x];
      count += 1;
    }
    return Math.trunc(sum / Math.max(count, 1)) < 28;
  };
  const limit = Math.trunc(width / 4);
  let left = 0, right = 0;
  while (left < limit && isBlack(left)) left += 1;
  while (right < limit && isBlack(width - 1 - right)) right += 1;
  // A dark frame reads as all bar, and a sliver isn't worth cropping: leave both alone.
  const bar = Math.min(left, right) & ~1;
  if (bar < 8 || left >= limit || right >= limit) return full;
  return { x: bar, y: 0, width: width - 2 * bar, height };
}
