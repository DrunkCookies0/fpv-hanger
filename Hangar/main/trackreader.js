// Finds a track in the stills of its build, on a thread of its own (see trackvideo.js): it is ten
// seconds or so of solid work, and the app carries on meanwhile. It is given the track standing as
// RGBA and where the picture changed, and answers with the pipes, or with what went wrong.

import { parentPort, workerData } from "node:worker_threads";
import { thinBright, findTrack } from "../shared/trackfit.js";

try {
  const { built, changed, width, height, sections } = workerData;
  const said = [];
  const found = findTrack({ changed, thin: thinBright(built, width, height), width, height }, { sections, log: (line) => said.push(line) });
  const plain = (pipes) => pipes.map((pipe) => [pipe.a, pipe.b]);
  parentPort.postMessage({ pipes: plain(found.pipes), leftOut: found.leftOut, readings: found.readings.map((one) => plain(one.pipes)), said });
} catch (error) {
  parentPort.postMessage({ problem: error.message });
}
