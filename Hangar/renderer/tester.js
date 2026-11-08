// The battery tester, as the page talks to it: over the Pico's USB serial port, a JSON message a
// line each way (see shared/batteries.js). When the app was started with `--tester-sim`, a program
// on this computer stands in for it, through the main process.

import { app, ask, hangar, render } from "./core.js";
import { Lines, testerVendor, keptFrom } from "../shared/batteries.js";

/** What the page knows of the tester. */
export const tester = {
  /** "off", "looking" or "on". */
  link: "off",
  /** Why it isn't connected, in words, or null. */
  problem: null,
  /** Its "hello": board, firmware, ports. */
  hello: null,
  /** Its latest "status". */
  status: null,
  /** The latest "progress", for the job that is running. */
  progress: null,
  /** The latest sag test, with its curve, and the pack it was on. */
  lastSag: null,
  /** The latest job that ended: { message, pack }. */
  lastResult: null,
  /** The last problem the tester reported, in its own words: { code, job }. */
  lastError: null,
  /** The pack the pilot says is plugged in. */
  pack: null,
  /** The pack each job was started on, so the result goes to it even if the choice changes meanwhile. */
  jobPack: null,
};

let port = null, reader = null, writer = null, nextId = 1, unhearSim = null;
const waiting = new Map();

const lines = new Lines(heard);

/** Connects to the tester: the one plugged in, or the program standing in for it. */
export async function connect() {
  if (tester.link !== "off") return;
  tester.link = "looking";
  tester.problem = null;
  render();
  try {
    if (app.state.testerSim) await openSim();
    else await openSerial();
    tester.link = "on";
    await command({ cmd: "hello" });
    await command({ cmd: "status" });
  } catch (error) {
    await disconnect();
    tester.problem = error.message;
  }
  render();
}

async function openSerial() {
  if (!navigator.serial) throw new Error("This copy of the app can't reach serial ports.");
  // The main process picks the tester from the ports there are, without a list.
  try {
    port = await navigator.serial.requestPort({ filters: [{ usbVendorId: testerVendor }] });
  } catch {
    throw new Error("No tester found. Plug its data cable into this computer: the USB socket on the Pico itself.");
  }
  await port.open({ baudRate: 115200 });
  // The Pico only talks once the computer says it is listening.
  await port.setSignals({ dataTerminalReady: true, requestToSend: true }).catch(() => {});
  const encoder = new TextEncoderStream();
  encoder.readable.pipeTo(port.writable).catch(() => {});
  writer = encoder.writable.getWriter();
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {});
  reader = decoder.readable.getReader();
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        lines.push(value);
      }
    } catch {}
    if (tester.link === "on") {
      await disconnect();
      tester.problem = "The tester was unplugged.";
      render();
    }
  })();
}

async function openSim() {
  unhearSim = hangar.hear("testerLine", (line) => {
    if (line === null) {
      disconnect().then(() => {
        tester.problem = "The program standing in for the tester stopped.";
        render();
      });
      return;
    }
    lines.push(`${line}\n`);
  });
  await ask("testerSim", "start");
}

/** Lets the tester go. */
export async function disconnect() {
  tester.link = "off";
  tester.hello = null;
  tester.status = null;
  tester.progress = null;
  for (const [, wait] of waiting) wait.done({ type: "refused", code: "disconnected" });
  waiting.clear();
  if (unhearSim) {
    unhearSim();
    unhearSim = null;
    await ask("testerSim", "stop");
  }
  try {
    await reader?.cancel();
  } catch {}
  try {
    await writer?.close();
  } catch {}
  try {
    await port?.close();
  } catch {}
  port = reader = writer = null;
}

/** Sends a command and waits for its answer: { type: "ok" | "refused" | "hello" | "status", ... }. */
export function command(message) {
  if (tester.link !== "on") return Promise.resolve({ type: "refused", code: "disconnected" });
  const id = nextId++;
  const line = JSON.stringify({ ...message, id });
  return new Promise((done) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      done({ type: "refused", code: "no_answer" });
    }, 4000);
    waiting.set(id, { done: (answer) => { clearTimeout(timer); done(answer); } });
    if (app.state.testerSim) ask("testerSim", "send", line);
    else writer?.write(`${line}\n`).catch(() => {});
  });
}

/** Starts a job on the pack that is plugged in. */
export async function start(job, fields = {}) {
  tester.jobPack = tester.pack;
  tester.lastError = null;
  const answer = await command({ cmd: job, port: 1, ...fields });
  if (answer.type !== "ok") tester.jobPack = null;
  render();
  return answer;
}

/** Keeps what a test measured, on the pack it was started on. */
async function keep(message) {
  // A job started from the tester's own buttons goes to the pack the pilot says is plugged in.
  const pack = tester.jobPack ?? tester.pack;
  if (!pack) return;
  const kept = keptFrom(message, { pack });
  if (!kept) return;
  const answer = await ask("keepBatteryTest", kept);
  if (answer?.state) app.state = answer.state;
}

function heard(message) {
  const answer = message.id !== undefined && waiting.get(message.id);
  if (answer) {
    waiting.delete(message.id);
    answer.done(message);
  }
  if (message.type === "hello") tester.hello = message;
  else if (message.type === "status") {
    tester.status = message;
    // A job that has ended leaves no progress behind, and the next one may be on another pack.
    if (!message.ports?.[0]?.job) {
      tester.progress = null;
      tester.jobPack = null;
    }
  } else if (message.type === "progress") tester.progress = message;
  else if (message.type === "sag") {
    tester.lastSag = { message, pack: tester.jobPack ?? tester.pack };
    keep(message).then(render);
  } else if (message.type === "result") {
    tester.lastResult = { message, pack: tester.jobPack ?? tester.pack };
    keep(message).then(render);
  } else if (message.type === "error" || message.type === "stopped") {
    tester.lastError = message.type === "error" ? { code: message.code, job: message.job } : null;
    tester.progress = null;
  }
  // The page is drawn again for what it shows. Another page has no need.
  if (app.page.name === "batteries") render();
}
