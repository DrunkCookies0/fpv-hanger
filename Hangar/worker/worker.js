// The window nobody sees that makes the finished videos. It draws the timer for every frame on a
// canvas and hands the pixels to FFmpeg, which lays them over the clip and writes the video. It is
// given Node so that it can run FFmpeg itself, and only ever loads this page.

import { Race, FrameRate } from "../shared/timing.js";
import { plan, eyebrowOf } from "../shared/video.js";
import { drawHeading, headingHeight, parseHexColor } from "../shared/panel.js";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ipcRenderer } = require("electron");
const { pathToFileURL, fileURLToPath } = require("node:url");

// FFmpeg is started in the folder that holds the colour table, so the table needs no path (see shared/video.js).
const colourFolder = fileURLToPath(new URL("../assets/colour/", import.meta.url));

const picture = (file) => new Promise((done) => {
  if (!file) return done(null);
  const image = new Image();
  image.onload = () => done(image);
  image.onerror = () => done(null);
  image.src = pathToFileURL(file).href;
});

const running = new Map();

/**
 * Makes one video. `job` is plain data: see `plan` in shared/video.js for most of it. Here the
 * colour is a hex string, the logo is a file, and the frame rate is its two numbers.
 * Returns { ok, problem, seconds, frames }.
 */
window.makeVideo = async (job) => {
  const started = performance.now();
  await document.fonts.load('800 66px "Inter"');
  const look = { ...job.look, accent: parseHexColor(job.look.accent ?? "#FFD60A") ?? parseHexColor("#FFD60A"), logo: await picture(job.look.logoFile) };
  const facts = { ...job.facts, fps: new FrameRate(job.facts.fps.num, job.facts.fps.den) };
  let race;
  try {
    race = Race.from(job.crossings, { decimals: job.decimals ?? 3, window: job.window ?? 3 });
  } catch (error) {
    return { ok: false, problem: error.message };
  }
  const part = job.output + ".part";
  let headingFile = null;
  const tidy = () => {
    for (const file of [headingFile, part]) if (file) fs.rmSync(file, { force: true });
  };
  try {
    fs.mkdirSync(path.dirname(job.output), { recursive: true });
    if (job.shape === "upright") {
      // The heading doesn't change, so it is drawn once and given to FFmpeg as a picture.
      const heading = { title: look.title ?? null, badge: look.badge ?? null, eyebrow: eyebrowOf(look), accent: look.accent, width: 1080, logo: look.logo };
      const height = headingHeight(heading);
      if (height > 0) {
        const canvas = new OffscreenCanvas(heading.width, height);
        drawHeading(canvas.getContext("2d"), heading);
        headingFile = path.join(job.temp, `heading-${job.id}.png`);
        fs.mkdirSync(job.temp, { recursive: true });
        fs.writeFileSync(headingFile, Buffer.from(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()));
      }
    }
    const made = plan({ ...job, facts, race, look, headingFile, output: part });
    const { panel, first, count, fps } = made;
    // The canvas is the part of the frame the box is laid over, which can be a pixel bigger than the box.
    const canvas = new OffscreenCanvas(made.canvas.width, made.canvas.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const ffmpeg = spawn(job.ffmpeg, ["-hide_banner", ...made.args], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true, cwd: colourFolder });
    running.set(job.id, ffmpeg);
    let said = "", broken = false;
    ffmpeg.stderr.on("data", (chunk) => { said += chunk; });
    ffmpeg.stdin.on("error", () => { broken = true; });
    const finished = new Promise((done) => {
      ffmpeg.on("error", (error) => { said += error.message; done(-1); });
      ffmpeg.on("close", done);
    });
    let told = 0;
    for (let index = 0; index < count && !broken; index += 1) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(made.canvas.dx, made.canvas.dy);
      panel.draw(context, (first + index) / fps);
      context.restore();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!ffmpeg.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) await new Promise((done) => ffmpeg.stdin.once("drain", done));
      const now = performance.now();
      if (now - told > 150) {
        told = now;
        ipcRenderer.send("video-progress", job.id, index / count);
      }
    }
    ffmpeg.stdin.end();
    const code = await finished;
    running.delete(job.id);
    if (code !== 0 || !fs.existsSync(part) || fs.statSync(part).size === 0) {
      tidy();
      return { ok: false, problem: job.stopped ? "stopped" : said.trim().split("\n").slice(-3).join(" ") || "FFmpeg wrote nothing" };
    }
    fs.rmSync(job.output, { force: true });
    fs.renameSync(part, job.output);
    if (headingFile) fs.rmSync(headingFile, { force: true });
    ipcRenderer.send("video-progress", job.id, 1);
    return { ok: true, seconds: (performance.now() - started) / 1000, frames: count, music: made.music };
  } catch (error) {
    running.delete(job.id);
    tidy();
    return { ok: false, problem: error.message };
  }
};

/** Stops a video that is being made. */
window.stopVideo = (id) => {
  running.get(id)?.kill();
};
