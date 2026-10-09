// Listens to one song, on a thread of its own (see songs.js). It is given the song's file and
// where FFmpeg is, and answers with what it heard, or null.

import { parentPort, workerData } from "node:worker_threads";
import { FFmpeg } from "./ffmpeg.js";
import { listen, normalised } from "../shared/listen.js";

const rate = 22050;
try {
  const samples = await new FFmpeg(workerData.ffmpeg).sound(workerData.file, rate);
  parentPort.postMessage(samples ? listen(normalised(samples), rate) : null);
} catch {
  parentPort.postMessage(null);
}
