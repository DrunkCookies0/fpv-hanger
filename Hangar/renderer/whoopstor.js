// The WhoopStor charger, as the page hears it: over USB HID, with WS3 Unlocked or OpenWS3 on it (see
// shared/whoopstor.js). It sends the charger a command only when the pilot presses Start or Stop:
// Start sets each port to 2C for the pack the pilot said is in it, then starts the run, and once the
// run is stopped the ports are put back to the charger's own current. When the app was started with
// `--whoopstor-sim <speed>`, a pretend charger stands in for it (shared/whoopstor-sim.js). Charges are
// followed whichever page is showing; the battery page is drawn again as they go, and the sidebar shows
// them on every page.

import { app, ask, render } from "./core.js";
import { whoopstorVendor, whoopstorProduct, isWhoopstor, parseReport, Charges, keptCharge, firmwareWords, commands, commandBytes, chargePlan, chargeAndStorage, bleedMah, bleedOhms, curvePoint, stopWords } from "../shared/whoopstor.js";
import { PretendWhoopStor } from "../shared/whoopstor-sim.js";

/** What the page knows of the charger. */
export const whoopstor = {
  /** "off", "looking" or "on"; "away" while a cycle test waits for the USB to come back. */
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

let device = null, charges = null, timer = null, drawn = 0, sideDrawn = 0, triedQuietly = false, askedWs3 = false;
// The charger's clock at the last reading before the USB went, while a cycle test waits for it.
let resumeFrom = null;

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
  // Back after the USB was out: a charger whose clock has gone back restarted meanwhile, and what
  // it did then isn't known, so the cycle test can't go on.
  if (report.page === 1 && resumeFrom !== null) {
    if (report.ms < resumeFrom) cycleOver("The WhoopStor restarted while its USB was out, so the cycle test stopped.");
    resumeFrom = null;
  }
  const wasRunning = whoopstor.p1?.running;
  charges.heard(report);
  whoopstor.p1 = charges.p1;
  whoopstor.p2 = charges.p2;
  if (report.page === 1) {
    for (const [seq, done] of answers) if (report.cmdSeq === seq) done(report.cmdResult);
    if (whoopstor.cycle?.active && report.phase === 7) cycleCurve(report);
    if (whoopstor.cycle?.running) cycleHeard(report);
    else if (whoopstor.cycle?.resting) restHeard(report);
    if (wasRunning !== false && !report.running && whoopstor.p2) putPortsBack();
  }
  whoopstor.sessions = charges.ports.map((port) => port.session);
  // Once the charger has said which firmware it has, whether the project has a newer one: looked
  // at on its Releases page once a day at most (main/firmware.js).
  if (!askedWs3 && whoopstor.p1?.release && whoopstor.p2) {
    askedWs3 = true;
    try {
      localStorage.setItem(firmwareFile, JSON.stringify({ release: whoopstor.p1.release, beta: whoopstor.p2.beta, build: whoopstor.p2.build, name: whoopstor.name }));
    } catch {}
    ask("ws3IfDue").then((now) => {
      if (now && app.state) app.state.ws3 = now;
    });
  }
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
  const resuming = whoopstor.link === "away";
  if (whoopstor.link !== "off" && !resuming) return;
  whoopstor.link = "looking";
  whoopstor.problem = null;
  render();
  if (!resuming) charges = new Charges({ began, measured: () => render(), ended: (session) => keep(session) });
  try {
    if (app.state.whoopstorSim) {
      if (resuming && whoopstor.sim) whoopstor.sim.unplugged = false;
      else openSim(app.state.whoopstorSim);
    } else await openHid(quietly);
    if (resuming) back();
    whoopstor.link = "on";
    wake();
  } catch (error) {
    if (resuming) {
      whoopstor.link = "away";
      if (!quietly) whoopstor.problem = error.message;
      return render();
    }
    await disconnect();
    if (!quietly) whoopstor.problem = error.message;
  }
  render();
}

// ---- The USB going out during a cycle test

/** How long a cycle test waits for the WhoopStor's USB to come back. */
const AWAY_MS = 30 * 60 * 1000;
/** Commands waiting for the USB to come back. */
let waiting = [];
const whenBack = () => new Promise((done) => waiting.push(done));
function wake() {
  const all = waiting;
  waiting = [];
  for (const done of all) done();
}

/** Ends a cycle test wherever it is: a step or a rest. */
function cycleOver(why) {
  whoopstor.cycle?.finished?.(why);
  whoopstor.cycle?.rested?.(why);
}

/** The USB went during a cycle test, as when a cable is knocked out. The charger carries on with the
 *  step by itself, so the test waits for it, up to AWAY_MS, and picks up where it is: the charges
 *  and the rest count on in the charger's own time, and the readings it missed are made up from
 *  the ones either side. Commands wait too, and are sent once it is back. */
function dropped() {
  const test = whoopstor.cycle;
  if (device) {
    device.removeEventListener("inputreport", onInput);
    device = null;
  }
  whoopstor.link = "away";
  whoopstor.problem = null;
  test.away = { since: Date.now(), until: Date.now() + AWAY_MS };
  test.awayTimer = setTimeout(async () => {
    cycleOver("The WhoopStor's USB was out for 30 minutes, so the cycle test stopped.");
    await disconnect();
    render();
    whoopstor.onSide?.();
  }, AWAY_MS);
  render();
  whoopstor.onSide?.();
}

/** The USB is back: the test goes on from the charger's next reading. */
function back() {
  const test = whoopstor.cycle;
  clearTimeout(test?.awayTimer);
  if (test?.away) test.awayFor = (test.awayFor ?? 0) + (Date.now() - test.away.since);
  if (test) test.away = null;
  if (test) test.bridging = true;
  resumeFrom = whoopstor.p1?.ms ?? null;
  charges.resume();
  whoopstor.onSide?.();
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
      // With its USB pretended out, it goes on charging, and nothing is heard.
      if (!sim.unplugged && (starting || sim.speed <= 2 || (sim.ms / 10) % 20 < 2)) heard(report);
    }
  }, 20);
}

/** For the app's checks: the pretend charger's USB pulled out, and put back. */
whoopstor.pretendUnplug = () => {
  if (!whoopstor.sim) return;
  whoopstor.sim.unplugged = true;
  if (whoopstor.cycle?.active && whoopstor.link === "on") dropped();
  else disconnect().then(render);
};
whoopstor.pretendPlugBack = () => {
  if (!whoopstor.sim) return;
  if (whoopstor.link === "away") connect({ quietly: true });
};

/** Lets the charger go. Charges still going are kept as far as they got. */
export async function disconnect() {
  whoopstor.cycle?.finished?.("The WhoopStor's connection was lost, so the cycle test stopped.");
  whoopstor.cycle?.rested?.("The WhoopStor's connection was lost, so the cycle test stopped.");
  clearTimeout(whoopstor.cycle?.awayTimer);
  if (whoopstor.cycle) whoopstor.cycle.away = null;
  resumeFrom = null;
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
  askedWs3 = false;
  whoopstor.p1 = whoopstor.p2 = null;
  whoopstor.sessions = [null, null, null, null, null, null];
  wake();
}

// The firmware the charger last said it had, so Home can say a newer one is out while it is unplugged.
const firmwareFile = "whoopstor firmware";

/** The charger's firmware as `{ p1, p2, name }` for shared/ws3.js: as it says now, or as it said
 *  when it was last connected. Null when it has never said. */
export function firmwareSeen() {
  if (whoopstor.p1?.release && whoopstor.p2) return { p1: whoopstor.p1, p2: whoopstor.p2, name: whoopstor.name ?? "" };
  try {
    const kept = JSON.parse(localStorage.getItem(firmwareFile) ?? "null");
    if (kept?.release) return { p1: { release: kept.release }, p2: { beta: kept.beta, build: kept.build }, name: kept.name ?? "" };
  } catch {}
  return null;
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
 *  changed to match, and so is a cycle test going on. A pack is in one port at a time: given to a
 *  port, it comes off any other port with a pack in it that said it, which then asks for its number
 *  again. (A port since emptied keeps its last charge as it was: the pack was there then.) */
export async function choosePack(port, pack) {
  const index = port - 1;
  const moved = pack && pack !== "skip"
    ? [0, 1, 2, 3, 4, 5].filter((other) => other !== index && (whoopstor.p1?.volts[other] ?? 0) >= 1 && packIn(other)?.id === pack)
    : [];
  for (const other of moved) await setPack(other, null);
  await setPack(index, pack);
  if (moved.length) {
    const name = app.state.batteries.packs[pack]?.name ?? "That pack";
    const ports = moved.map((other) => other + 1).join(" and ");
    app.notice = `${name} was in port ${ports} too. It is in port ${port} now, so port ${ports} asks for its number again.`;
  }
  render();
}

async function setPack(index, pack) {
  remember(index, pack === "skip" ? { skip: true } : pack ? { pack } : null);
  const testing = whoopstor.cycle?.active ? whoopstor.cycle.ports.find((one) => one.index === index) : null;
  if (testing) Object.assign(testing, { pack: pack && pack !== "skip" ? pack : null, skip: pack === "skip" });
  const session = charges?.ports[index]?.session;
  if (!session) return;
  let answer = null;
  if (pack === "skip") {
    session.skip = true;
    if (session.keptId) answer = await ask("forgetBatteryTest", session.keptId);
    session.keptId = null;
  } else {
    session.skip = false;
    session.pack = pack || null;
    if (session.keptId) answer = await ask("assignBatteryTest", session.keptId, session.pack);
    else if (session.end) await keep(session);
  }
  if (answer?.state) app.state = answer.state;
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
  if (whoopstor.link !== "on" && whoopstor.link !== "away") return "no answer";
  do sequence = (sequence % 254) + 1; while (whoopstor.p1?.cmdSeq === sequence);
  const seq = sequence, bytes = commandBytes(code, seq, arg, extra);
  // While a cycle test waits for the USB to come back, a command waits with it and is sent again
  // once it is: one that got through before it went isn't run twice, as the number is the same.
  for (let round = 0; round < 2; round += 1) {
    if (whoopstor.link === "away") await whenBack();
    if (whoopstor.link !== "on") return "no answer";
    for (let tries = 0; tries < 6 && whoopstor.link === "on"; tries += 1) {
      const result = await new Promise((done) => {
        answers.set(seq, done);
        setTimeout(() => done(null), 500);
        Promise.resolve(send(bytes)).catch(() => done(null));
      });
      answers.delete(seq);
      if (result !== null) return ["done", "refused", "unknown"][result] ?? "unknown";
    }
    if (whoopstor.link !== "away") break;
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
    // The charger's clock as it started: the curve and each step's start and end are counted from it.
    ms0: p1.ms,
    ports: testing.map((step) => ({ index: step.port - 1, pack: step.pack.id, amps: step.amps, results: [], curve: [] })),
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
      for (const port of test.ports) Object.assign(port, { moved: false, out: 0, startVolts: whoopstor.p1.volts[port.index], lastVolts: null, wasBleeding: false, session: null });
      test.stepStartedAt = Date.now();
      test.stepFrom = testSeconds(test);
      test.lastMs = null;
      test.stepUnseen = 0;
      const outcome = new Promise((done) => { test.finished = done; });
      if ((await command(commands.start)) !== "done") throw new Error("The WhoopStor didn't start. It won't while its menu is open or a problem shows on its screen.");
      test.running = true;
      render();
      const how = await outcome;
      test.running = false;
      for (const port of test.ports) {
        const session = port.session;
        port.results.push({
          kind, minutes: Math.round((Date.now() - test.stepStartedAt) / 600) / 100,
          startVolts: Math.round(port.startVolts * 1000) / 1000, endVolts: Math.round((whoopstor.p1?.volts[port.index] ?? port.lastVolts ?? port.startVolts) * 1000) / 1000,
          mah: Math.round((kind === "charge" ? session?.mah ?? 0 : port.out) * 10) / 10,
          resistance: kind === "charge" ? session?.resistance?.mohm ?? null : null,
          ...(kind === "discharge" ? { worked: "from the voltage across the 18 ohm load" } : {}),
          // The USB was out for part of the step: what went in or out then is made up.
          ...(test.stepUnseen > 0 ? { unseenSeconds: Math.round(test.stepUnseen) } : {}),
          // Where the step is on the test's curve, in seconds from the start.
          fromS: test.stepFrom, toS: testSeconds(test, port),
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
      if (!port.results.length || port.skip) continue;
      const kept = {
        id: `c${test.startedAt.getTime().toString(36)}${port.index + 1}`, pack: port.pack, at: test.startedAt.toISOString(),
        kind: "cycle", source: "whoopstor", port: port.index + 1, amps: port.amps, fullVolts, storageVolts, cycles,
        end: test.done ? "done" : "stopped", problem: test.problem, steps: port.results,
        // The whole test, a reading every 15 seconds, rests and all, for its graph.
        ...(port.curve.length > 1 ? { curve: port.curve } : {}),
      };
      const answer = await ask("keepBatteryTest", kept);
      if (answer?.state) app.state = answer.state;
    }
    await ask("stayAwake", false);
    test.over = true;
    render();
  }
  return test.after ?? test.problem;
}

/** How often a cycle test keeps a reading of each pack for its graph, in the charger's time. */
const CYCLE_CURVE_MS = 15000;

/** Seconds since the test started, by the charger's clock: from the latest reading, or the port's
 *  last point when there is none just now. */
function testSeconds(test, port = null) {
  if (whoopstor.p1 && whoopstor.p1.ms >= test.ms0) return Math.round((whoopstor.p1.ms - test.ms0) / 1000);
  return port?.curve.at(-1)?.[0] ?? test.ports[0]?.curve.at(-1)?.[0] ?? 0;
}

/** Keeps a reading of each pack in the test every CYCLE_CURVE_MS, charging, going down or resting.
 *  Going down, the current is the load's, worked out from the voltage, and below 0. */
function cycleCurve(report) {
  const test = whoopstor.cycle;
  if (report.ms < test.ms0) return;
  for (const port of test.ports) {
    if (port.curveMs !== undefined && report.ms - port.curveMs < CYCLE_CURVE_MS) continue;
    const volts = report.volts[port.index];
    const amps = report.bleeding[port.index] ? -volts / bleedOhms : report.amps[port.index];
    port.curve.push(curvePoint(report.ms - test.ms0, volts, amps));
    port.curveMs = report.ms;
  }
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
  if (whoopstor.link === "away" && test) {
    // What the page says once the test has ended, in place of only "stopped".
    test.after = "The cycle test is stopped. The WhoopStor's USB is still out, so it carries on with its step by itself: press its left button for half a second to stop it.";
    cycleOver("The cycle test was stopped.");
    await disconnect();
    return null;
  }
  cycleOver("The cycle test was stopped.");
  return stop();
}

/** Why a cycle test ended when the charger stopped part way through a step, without the Hangar's Stop:
 *  at the charger itself (its button), or by itself for the reason it gives (stopWords). */
function stoppedWhy(code) {
  if (code === 4) return "The WhoopStor was stopped on the charger itself, so the cycle test stopped.";
  if (code > 0 && stopWords[code]) return `The WhoopStor stopped by itself: ${stopWords[code]}. So the cycle test stopped.`;
  return "The WhoopStor stopped, so the cycle test stopped.";
}

/** Follows a cycle test's step from each report: what the load takes out of each pack, and when
 *  every pack in it has got where the step was taking it. */
function cycleHeard(report) {
  const test = whoopstor.cycle;
  // Readings come every 10 ms or so; the first after the USB was out comes after the whole gap.
  const gap = test.lastMs === null ? 0 : report.ms - test.lastMs;
  const dt = Math.max(0, Math.min(test.bridging ? gap : 1000, gap));
  test.bridging = false;
  test.lastMs = report.ms;
  if (dt > 1000) test.stepUnseen += dt / 1000;
  for (const port of test.ports) port.session = charges?.ports[port.index]?.session ?? port.session;
  if (!report.running) {
    if (!test.stopping) test.finished?.(stoppedWhy(report.stopped));
    return;
  }
  const kind = test.steps[test.step], elapsed = Date.now() - test.stepStartedAt;
  let all = true;
  for (const port of test.ports) {
    const state = report.states[port.index], volts = report.volts[port.index];
    const bleeding = report.bleeding[port.index];
    if (dt > 1000) {
      // Across the time the USB was out: the load took about this much, from the voltage either side,
      // for all of it if it was on at both ends, and half if at one.
      const share = (bleeding ? 0.5 : 0) + (port.wasBleeding ? 0.5 : 0);
      port.out += bleedMah((volts + (port.lastVolts ?? volts)) / 2, dt * share);
    } else if (bleeding) port.out += bleedMah(volts, dt);
    port.lastVolts = volts;
    port.wasBleeding = bleeding;
    if (["probe", "charge", "rest", "bleed"].includes(state)) port.moved = true;
    const there = volts < 1 || state === "fault" || (state === "full" && (port.moved || elapsed > 10000));
    if (!there) all = false;
  }
  if (all) test.finished?.("done");
  else if (elapsed > 5 * 3600 * 1000) test.finished?.(`A ${kind} step went on for over 5 hours, so the test was stopped.`);
}

navigator.hid?.addEventListener("disconnect", async (event) => {
  if (event.device !== device) return;
  // During a cycle test, it waits for the USB to come back.
  if (whoopstor.cycle?.active && whoopstor.link === "on") return dropped();
  await disconnect();
  whoopstor.problem = "The WhoopStor was unplugged.";
  render();
});
navigator.hid?.addEventListener("connect", (event) => {
  if (isWhoopstor(event.device) && (whoopstor.link === "off" || whoopstor.link === "away") && app.state && !app.state.quiet) connect({ quietly: true });
});
