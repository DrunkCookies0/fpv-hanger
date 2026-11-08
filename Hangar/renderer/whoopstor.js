// The WhoopStor charger, as the page hears it: over USB HID, with WS3 Unlocked or OpenWS3 on it (see
// shared/whoopstor.js). It sends the charger a command only when the pilot presses Start or Stop:
// Start sets each port to 2C for the pack the pilot said is in it, then starts the run, and once the
// run is stopped the ports are put back to the charger's own current. When the app was started with
// `--whoopstor-sim <speed>`, a pretend charger stands in for it (shared/whoopstor-sim.js). Charges are
// followed whichever page is showing; the battery page is drawn again as they go, and the sidebar shows
// them on every page.

import { app, ask, render } from "./core.js";
import { whoopstorVendor, whoopstorProduct, isWhoopstor, parseReport, Charges, keptCharge, firmwareWords, commands, commandBytes, chargePlan, chargeAndStorage, bleedMah } from "../shared/whoopstor.js";
import { PretendWhoopStor } from "../shared/whoopstor-sim.js";

/** What the page knows of the charger. */
export const whoopstor = {
  /** "off", "looking" or "on". */
  link: "off",
  /** Why it isn't connected, in words, or null. */
  problem: null,
  /** Its name as it gives it over USB: "WS3 Unlocked" or "OpenWS3". */
  name: null,
  /** Its latest page 1 and page 2 (shared/whoopstor.js's parseReport). */
  p1: null,
  p2: null,
  /** Each port's charge, or null: a session from shared/whoopstor.js's Charges, with `pack` (the
   *  pack's id, once the pilot has said), `skip` (not one of the pilot's packs) and `keptId`. */
  sessions: [null, null, null, null, null, null],
  /** The pretend charger, when there is one, for the app's checks to work. */
  sim: null,
};

let device = null, charges = null, timer = null, drawn = 0, sideDrawn = 0, triedQuietly = false;

// The pack the pilot said is in each port, { pack, skip }, until the port is seen empty: a pack left
// in its port is still that pack when the run is stopped and started again, or the app is opened
// again. Kept on this computer, as it is about this charger.
const portsFile = "whoopstor ports";
const remembered = (() => {
  try {
    const kept = JSON.parse(localStorage.getItem(portsFile) ?? "[]");
    return [0, 1, 2, 3, 4, 5].map((index) => kept[index] ?? null);
  } catch {
    return [null, null, null, null, null, null];
  }
})();
const emptyFor = [0, 0, 0, 0, 0, 0];
whoopstor.remembered = remembered;

function remember(index, known) {
  remembered[index] = known;
  try {
    localStorage.setItem(portsFile, JSON.stringify(remembered));
  } catch {}
}

/** A port read empty three times running (60 ms) has had its pack taken out. */
function lookForEmptyPorts(report) {
  if (report.page !== 1 || report.phase !== 7) return;
  report.volts.forEach((volts, index) => {
    emptyFor[index] = volts < 1 ? emptyFor[index] + 1 : 0;
    if (emptyFor[index] >= 3 && remembered[index]) remember(index, null);
  });
}

/** A charge starting in a port whose pack is known goes with that pack, without asking. */
function began(session) {
  const known = remembered[session.port - 1];
  if (known && (known.skip || app.state.batteries.packs[known.pack])) {
    session.pack = known.skip ? null : known.pack;
    session.skip = Boolean(known.skip);
  }
  render();
}

function heard(bytes) {
  const report = parseReport(bytes);
  if (!report) return;
  lookForEmptyPorts(report);
  const wasRunning = whoopstor.p1?.running;
  charges.heard(report);
  whoopstor.p1 = charges.p1;
  whoopstor.p2 = charges.p2;
  if (report.page === 1) {
    for (const [seq, done] of answers) if (report.cmdSeq === seq) done(report.cmdResult);
    if (whoopstor.cycle?.running) cycleHeard(report);
    else if (whoopstor.cycle?.resting) restHeard(report);
    if (wasRunning !== false && !report.running && whoopstor.p2) putPortsBack();
  }
  whoopstor.sessions = charges.ports.map((port) => port.session);
  // A report comes every 10 ms: the page is drawn again at most four times a second, and only the
  // battery page, and not while a pack's number is being typed, so its list of numbers stays open.
  const typing = document.activeElement?.matches?.("input.port-pack");
  if (app.page.name === "batteries" && !typing && Date.now() - drawn > 250) {
    drawn = Date.now();
    (whoopstor.onLive ?? render)();
  }
  // The sidebar shows it on every page, once a second.
  if (Date.now() - sideDrawn > 1000) {
    sideDrawn = Date.now();
    whoopstor.onSide?.();
  }
}

const onInput = (event) => heard(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));

/** Keeps a charge that has ended, with its pack if the pilot has said which. */
async function keep(session) {
  if (session.skip) return;
  const kept = keptCharge(session, { pack: session.pack ?? null, firmware: firmwareWords(whoopstor.p1, whoopstor.p2) });
  if (!kept) return;
  session.keptId = kept.id;
  const answer = await ask("keepBatteryTest", kept);
  if (answer?.state) app.state = answer.state;
  render();
}

/** Connects to the charger: the one plugged in, or a pretend one. `quietly` doesn't ask Chromium for
 *  a device or complain when none is there, for trying when the page opens. */
export async function connect({ quietly = false } = {}) {
  if (whoopstor.link !== "off") return;
  whoopstor.link = "looking";
  whoopstor.problem = null;
  render();
  charges = new Charges({ began, measured: () => render(), ended: (session) => keep(session) });
  try {
    if (app.state.whoopstorSim) openSim(app.state.whoopstorSim);
    else await openHid(quietly);
    whoopstor.link = "on";
  } catch (error) {
    await disconnect();
    if (!quietly) whoopstor.problem = error.message;
  }
  render();
}

async function openHid(quietly) {
  if (!navigator.hid) throw new Error("This copy of the app can't reach USB devices.");
  let found = (await navigator.hid.getDevices()).find(isWhoopstor);
  if (!found && !quietly) {
    // The main process picks the WhoopStor from the devices there are, without a list.
    try {
      [found] = await navigator.hid.requestDevice({ filters: [{ vendorId: whoopstorVendor, productId: whoopstorProduct }] });
    } catch {
      found = null;
    }
  }
  if (!found) throw new Error("No WhoopStor found. Plug its USB-C into this computer. It needs WS3 Unlocked or OpenWS3 on it: VIFLY's own firmware doesn't talk over USB.");
  device = found;
  if (!device.opened) await device.open();
  device.addEventListener("inputreport", onInput);
  whoopstor.name = device.productName || "WhoopStor";
}

/** A pretend charger, its time running `speed` times fast. Every report is heard while a charge is
 *  starting; otherwise a pair in twenty, which is plenty to count what goes in. */
function openSim(speed) {
  const sim = whoopstor.sim = new PretendWhoopStor();
  sim.speed = speed;
  whoopstor.name = "Pretend WhoopStor";
  timer = setInterval(() => {
    for (let done = 0; done < 20 * sim.speed; done += 10) {
      sim.step(10);
      const report = sim.report();
      const starting = sim.ports.some((port) => ["probe", "charge"].includes(port.state) && sim.ms - port.since < 15000);
      if (starting || sim.speed <= 2 || (sim.ms / 10) % 20 < 2) heard(report);
    }
  }, 20);
}

/** Lets the charger go. Charges still going are kept as far as they got. */
export async function disconnect() {
  whoopstor.cycle?.finished?.("The WhoopStor's connection was lost, so the cycle test stopped.");
  whoopstor.cycle?.rested?.("The WhoopStor's connection was lost, so the cycle test stopped.");
  charges?.lost();
  clearInterval(timer);
  timer = null;
  whoopstor.sim = null;
  if (device) {
    device.removeEventListener("inputreport", onInput);
    try {
      await device.close();
    } catch {}
    device = null;
  }
  whoopstor.link = "off";
  whoopstor.p1 = whoopstor.p2 = null;
  whoopstor.sessions = [null, null, null, null, null, null];
}

/** Connects by itself as the app opens, and the first time the battery page shows, if a WhoopStor is
 *  plugged in. */
export function connectWhenThere() {
  if (triedQuietly || whoopstor.link !== "off" || app.state.whoopstorSim) return;
  triedQuietly = true;
  connect({ quietly: true });
}

/** The pack the pilot said is in a port (0 to 5), or null. */
export function packIn(index) {
  const session = whoopstor.sessions[index];
  if (session) return session.skip ? null : app.state.batteries.packs[session.pack] ?? null;
  const known = remembered[index];
  return known?.pack ? app.state.batteries.packs[known.pack] ?? null : null;
}

/** Whether the pilot said a port's pack isn't one of theirs. */
export const skippedIn = (index) => Boolean(whoopstor.sessions[index]?.skip ?? remembered[index]?.skip);

/** Says which pack is in a port: a pack's id, or "skip" for one that isn't the pilot's. With no
 *  charge going, it is remembered for when one starts. A charge that has already been kept is
 *  changed to match. */
export async function choosePack(port, pack) {
  remember(port - 1, pack === "skip" ? { skip: true } : pack ? { pack } : null);
  const session = charges?.ports[port - 1]?.session;
  if (!session) return render();
  let answer = null;
  if (pack === "skip") {
    session.skip = true;
    if (session.keptId) answer = await ask("forgetBatteryTest", session.keptId);
    session.keptId = null;
  } else {
    session.skip = false;
    session.pack = pack || null;
    if (session.keptId && session.pack) answer = await ask("assignBatteryTest", session.keptId, session.pack);
    else if (session.end && !session.keptId) await keep(session);
  }
  if (answer?.state) app.state = answer.state;
  render();
}

// ---- Start and Stop

let sequence = 0;
const answers = new Map();
// The ports Start gave a current of their own, to be put back once the run is stopped. Kept on this
// computer, so it is done on the next connection if the app wasn't there to see the run stop.
const setFile = "whoopstor ports set";
let portsSet = (() => {
  try {
    return JSON.parse(localStorage.getItem(setFile) ?? "[]");
  } catch {
    return [];
  }
})();
const keepPortsSet = () => {
  try {
    localStorage.setItem(setFile, JSON.stringify(portsSet));
  } catch {}
};

function send(bytes) {
  if (whoopstor.sim) whoopstor.sim.command(bytes);
  else return device?.sendReport(0, bytes);
}

/** Sends a command and waits for the charger to say it ran it: "done", "refused", "unknown" or
 *  "no answer". The same report is sent again after half a second without an answer, as the
 *  firmware asks: it runs a number only once. */
async function command(code, arg = 0, extra = 0) {
  if (whoopstor.link !== "on") return "no answer";
  do sequence = (sequence % 254) + 1; while (whoopstor.p1?.cmdSeq === sequence);
  const seq = sequence, bytes = commandBytes(code, seq, arg, extra);
  for (let tries = 0; tries < 6; tries += 1) {
    const result = await new Promise((done) => {
      answers.set(seq, done);
      setTimeout(() => done(null), 500);
      Promise.resolve(send(bytes)).catch(() => done(null));
    });
    answers.delete(seq);
    if (result !== null) return ["done", "refused", "unknown"][result] ?? "unknown";
  }
  return "no answer";
}

/** What Start would do, port by port (shared/whoopstor.js's chargePlan), at 2C. */
export const plan = () => chargePlan(whoopstor.p1, packIn);

/** Sets each port's current for its pack, then starts the run. Says what went wrong, or null. */
export async function start() {
  const steps = plan();
  for (const step of steps) {
    if (whoopstor.p2?.portValues?.[step.port - 1] === step.value) continue;
    const answer = await command(commands.portValue, step.port - 1, step.value);
    if (answer !== "done") return `The WhoopStor didn't take port ${step.port}'s current (${answer}). It may have its menu open on its screen.`;
    if (step.value !== 1 && !portsSet.includes(step.port - 1)) portsSet.push(step.port - 1);
    keepPortsSet();
  }
  const answer = await command(commands.start);
  if (answer === "done") return null;
  return answer === "refused"
    ? "The WhoopStor didn't start. It won't while its menu is open or while it shows a problem on its screen."
    : `The WhoopStor didn't answer (${answer}).`;
}

/** Stops the run. The charger always takes this. */
export async function stop() {
  const answer = await command(commands.stop);
  return answer === "done" ? null : `The WhoopStor didn't answer (${answer}). Press its left button for half a second to stop it.`;
}

/** Puts the ports Start set back to the charger's own current, once the run has stopped, so the
 *  next run started from its own button isn't at the last pack's current. */
let puttingBack = false;
async function putPortsBack() {
  if (puttingBack || portsSet.length === 0 || whoopstor.cycle?.active) return;
  puttingBack = true;
  for (const index of [...portsSet]) {
    if (whoopstor.p1?.running) break;
    if (whoopstor.p2?.portValues?.[index] === 1 || (await command(commands.portValue, index, 1)) === "done") {
      portsSet = portsSet.filter((one) => one !== index);
      keepPortsSet();
    }
  }
  puttingBack = false;
  render();
}

// ---- The cycle test

/** Sets each port's current for its pack (2C), as Start does. Says what went wrong, or null. */
async function setPorts(steps) {
  for (const step of steps) {
    if (whoopstor.p2?.portValues?.[step.port - 1] === step.value) continue;
    if ((await command(commands.portValue, step.port - 1, step.value)) !== "done") return `The WhoopStor didn't take port ${step.port}'s current.`;
    if (step.value !== 1 && !portsSet.includes(step.port - 1)) portsSet.push(step.port - 1);
    keepPortsSet();
  }
  return null;
}

/** What is wrong with starting a cycle test now, in words, or null. */
export function cycleProblem() {
  const steps = plan();
  if (whoopstor.link !== "on" || !whoopstor.p1) return "Connect the WhoopStor first.";
  if (whoopstor.p1.running) return "Stop the charger first.";
  if (steps.length === 0) return "Put packs in the WhoopStor first.";
  const unnamed = steps.filter((step) => !step.pack && !skippedIn(step.port - 1));
  if (unnamed.length) return `Give the pack in port ${unnamed.map((step) => step.port).join(", ")} its number first, or say it isn't one of yours.`;
  return null;
}

/**
 * The cycle test: each named pack charged to full at 2C, then down to storage on the charger's own
 * load, `cycles` times, so the packs end at storage. Full and storage go by the charger's target as
 * it is: 4.35 V and 3.85 V for LiHV, 4.20 V and 3.80 V for LiPo. What went in is the charger's
 * measure; what came out is worked out from the voltage across the load (bleedMah). A pack too small
 * for 2C, or not one of the pilot's, sits the test out. The app has to stay open: it sends each step.
 */
export async function cycleTest(cycles = 2) {
  const problem = cycleProblem();
  if (problem) return problem;
  const p1 = whoopstor.p1;
  const { full, storage, fullVolts, storageVolts } = chargeAndStorage(p1.target);
  const steps = plan().map((step) => (skippedIn(step.port - 1) ? { ...step, value: 0 } : step));
  const testing = steps.filter((step) => step.pack && step.value > 1);
  const test = whoopstor.cycle = {
    active: true, running: false, stopping: false, over: false, cycles, done: false, problem: null,
    steps: Array.from({ length: cycles }, () => ["charge", "discharge"]).flat(), step: 0,
    fullVolts, storageVolts, startedAt: new Date(), stepStartedAt: null, originalTarget: p1.targetIndex,
    ports: testing.map((step) => ({ index: step.port - 1, pack: step.pack.id, amps: step.amps, results: [] })),
  };
  render();
  await ask("stayAwake", true);
  try {
    for (const [number, kind] of test.steps.entries()) {
      test.step = number;
      const target = kind === "charge" ? full : storage;
      if (whoopstor.p1.targetIndex !== target && (await command(commands.target, target)) !== "done") throw new Error("The WhoopStor didn't take its target voltage. Is its menu open, or is ALLOW 4.35V set to NO?");
      const wrong = await setPorts(steps);
      if (wrong) throw new Error(wrong);
      for (const port of test.ports) Object.assign(port, { moved: false, out: 0, startVolts: whoopstor.p1.volts[port.index] });
      test.stepStartedAt = Date.now();
      test.lastMs = null;
      const outcome = new Promise((done) => { test.finished = done; });
      if ((await command(commands.start)) !== "done") throw new Error("The WhoopStor didn't start. It won't while its menu is open or a problem shows on its screen.");
      test.running = true;
      render();
      const how = await outcome;
      test.running = false;
      for (const port of test.ports) {
        const session = whoopstor.sessions[port.index];
        port.results.push({
          kind, minutes: Math.round((Date.now() - test.stepStartedAt) / 600) / 100,
          startVolts: Math.round(port.startVolts * 1000) / 1000, endVolts: Math.round(whoopstor.p1.volts[port.index] * 1000) / 1000,
          mah: Math.round((kind === "charge" ? session?.mah ?? 0 : port.out) * 10) / 10,
          resistance: kind === "charge" ? session?.resistance?.mohm ?? null : null,
          ...(kind === "discharge" ? { worked: "from the voltage across the 18 ohm load" } : {}),
        });
      }
      test.stopping = true;
      await command(commands.stop);
      test.stopping = false;
      if (how !== "done") throw new Error(how);
      // A rest before the next step, with the charger stopped: each pack settles and cools, so the
      // next step starts from the same place, and how far it settles is kept with the step.
      if (number < test.steps.length - 1) {
        const rested = await rest(test);
        if (rested !== "done") throw new Error(rested);
      }
    }
    test.done = true;
  } catch (error) {
    test.problem = error.message;
    test.stopping = true;
    await command(commands.stop);
    test.stopping = false;
  } finally {
    test.running = false;
    if (whoopstor.p1?.targetIndex !== test.originalTarget) await command(commands.target, test.originalTarget);
    test.active = false;
    await putPortsBack();
    for (const port of test.ports) {
      if (!port.results.length) continue;
      const kept = {
        id: `c${test.startedAt.getTime().toString(36)}${port.index + 1}`, pack: port.pack, at: test.startedAt.toISOString(),
        kind: "cycle", source: "whoopstor", port: port.index + 1, amps: port.amps, fullVolts, storageVolts, cycles,
        end: test.done ? "done" : "stopped", problem: test.problem, steps: port.results,
      };
      const answer = await ask("keepBatteryTest", kept);
      if (answer?.state) app.state = answer.state;
    }
    await ask("stayAwake", false);
    test.over = true;
    render();
  }
  return test.problem;
}

/** How long a cycle test rests between steps, in the charger's own time (so a pretend one, running
 *  fast, rests fast too). */
const REST_MS = 5 * 60 * 1000;

function rest(test) {
  test.resting = true;
  test.restFrom = null;
  render();
  return new Promise((done) => {
    test.rested = (how) => {
      test.resting = false;
      test.rested = null;
      done(how);
    };
  });
}

/** Counts a rest down in the charger's time, and keeps where each pack has settled at its end. */
function restHeard(report) {
  const test = whoopstor.cycle;
  test.restFrom ??= report.ms;
  test.restLeft = Math.max(0, REST_MS - (report.ms - test.restFrom));
  if (test.restLeft > 0) return;
  for (const port of test.ports) {
    const last = port.results.at(-1);
    if (last) last.settledVolts = Math.round(report.volts[port.index] * 1000) / 1000;
  }
  test.rested?.("done");
}

/** Stops a cycle test, wherever it is: a step, a rest, or between. */
export async function stopCycleTest() {
  const test = whoopstor.cycle;
  test?.finished?.("The cycle test was stopped.");
  test?.rested?.("The cycle test was stopped.");
  return stop();
}

/** Follows a cycle test's step from each report: what the load takes out of each pack, and when
 *  every pack in it has got where the step was taking it. */
function cycleHeard(report) {
  const test = whoopstor.cycle;
  const dt = test.lastMs === null ? 0 : Math.max(0, Math.min(1000, report.ms - test.lastMs));
  test.lastMs = report.ms;
  if (!report.running) {
    if (!test.stopping) test.finished?.("The cycle test was stopped.");
    return;
  }
  const kind = test.steps[test.step], elapsed = Date.now() - test.stepStartedAt;
  let all = true;
  for (const port of test.ports) {
    const state = report.states[port.index], volts = report.volts[port.index];
    if (report.bleeding[port.index]) port.out += bleedMah(volts, dt);
    if (["probe", "charge", "rest", "bleed"].includes(state)) port.moved = true;
    const there = volts < 1 || state === "fault" || (state === "full" && (port.moved || elapsed > 10000));
    if (!there) all = false;
  }
  if (all) test.finished?.("done");
  else if (elapsed > 5 * 3600 * 1000) test.finished?.(`A ${kind} step went on for over 5 hours, so the test was stopped.`);
}

navigator.hid?.addEventListener("disconnect", async (event) => {
  if (event.device !== device) return;
  await disconnect();
  whoopstor.problem = "The WhoopStor was unplugged.";
  render();
});
navigator.hid?.addEventListener("connect", (event) => {
  if (isWhoopstor(event.device) && whoopstor.link === "off" && app.state && !app.state.quiet) connect({ quietly: true });
});
