// Reads one blackbox dump and works out every flight in it, away from the app's main process, which
// would otherwise stop answering the window for the second or two a big dump takes.

import { parentPort, workerData } from "node:worker_threads";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { analyseDump } from "../shared/flight.js";

try {
  const bytes = readFileSync(workerData.path);
  const reading = analyseDump(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  if (reading.logs.length === 0) parentPort.postMessage({ problem: "That file isn't a Betaflight blackbox log." });
  else {
    parentPort.postMessage({
      id: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      size: bytes.length, savedAt: statSync(workerData.path).mtime.toISOString(), reading,
    });
  }
} catch (error) {
  parentPort.postMessage({ problem: `It couldn't be read: ${error.message}` });
}
