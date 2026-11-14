// What the sidebar and the first screen share: what opening each tool does, which tool is showing,
// and what is going on just now (the WhoopStor's charge or cycle test, and a video being made), put
// the same way wherever it shows.

import { app, open, go, openVideoCreator } from "../core.js";
import { openTool, showProgram } from "./tool.js";
import { showRadioBackups } from "./radio.js";
import { uploadAnyVideo } from "./upload.js";
import { factsOf, verdictOf, statusWords } from "../../shared/batteries.js";
import { whoopstor, packIn } from "../whoopstor.js";

/** What opening a tool does. Null for one that isn't there to open yet. */
export function actionFor(tool) {
  if (tool === "home") return () => go({ name: "home" });
  if (tool === "videoCreator") return openVideoCreator;
  if (tool === "leaderboards") return () => open({ name: "leaderboard" });
  // Another project's own app, shown in the window, or its program, which the app fetches.
  if (tool === "betaflight" || tool === "blackbox" || tool === "elrsFlasher") return () => openTool(tool);
  if (tool === "elrsConfigurator" || tool === "edgetxCompanion") return () => showProgram(tool);
  if (tool === "rates") return () => open({ name: "rates" });
  if (tool === "osdFont") return () => open({ name: "osdfont" });
  if (tool === "radioBackups") return showRadioBackups;
  if (tool === "upload") return uploadAnyVideo;
  if (tool === "batteryTester") return () => open({ name: "batteries" });
  if (tool === "settings") return () => open({ name: "settings" });
  if (tool === "guide") return () => open({ name: "guide" });
  return null;
}

/** Which of the sidebar's items is showing: a tool's name, "home", "settings" or "guide". */
export function showing() {
  if (app.tool) return app.tool.site ? "upload" : app.tool.id;
  if (app.editor || app.trackView) return "videoCreator";
  const name = app.page.name;
  if (name === "track" || name === "tracks" || name === "group") return "videoCreator";
  if (name === "leaderboard") return "leaderboards";
  if (name === "batteries") return "batteryTester";
  if (name === "osdfont") return "osdFont";
  return name;
}

/** Leaves what covers the window, the marker editor, the track in 3D or another project's tool,
 *  before going somewhere from the sidebar. The editor leaves as Done does, keeping the work. False
 *  when the pilot chose to stay. */
export async function leaveViews() {
  if (app.editor) {
    await app.editor.done();
    if (app.editor) return false;
  }
  if (app.trackView) {
    await app.trackView.close();
    if (app.trackView) return false;
  }
  if (app.tool) {
    await app.tool.close();
    if (app.tool) return false;
  }
  return true;
}

/** Opens a tool from the sidebar or the first screen, leaving whatever covers the window first. */
export async function openFromSide(tool) {
  const action = actionFor(tool);
  if (!action) return;
  // The one showing already is left as it is.
  if (showing() === tool && !["elrsConfigurator", "edgetxCompanion", "radioBackups", "upload"].includes(tool)) return;
  if (await leaveViews()) action();
}

/** Each status's colour: RACE green, FUN blue, RETIRE orange. */
export const statusColour = { race: "var(--good)", fun: "var(--drop)", retire: "var(--warn)", retired: "var(--faint)" };

/** The status the Hangar gives a pack just now: { word, text }, with nulls when it can't say yet. */
export function statusOf(pack, facts = factsOf(app.state.batteries)) {
  if (!pack || !facts[pack.id]) return { word: null, text: null };
  const { word } = verdictOf(facts[pack.id], facts, app.state.batteries.limits);
  return { word, text: word ? statusWords[word] : null };
}

const minutesSince = (moment) => Math.max(0, Math.floor((Date.now() - moment) / 60000));

/**
 * What the WhoopStor is doing, for the sidebar and the first screen, or null when it isn't connected
 * or is doing nothing: { kind: "cycle" | "charging", title, badge, line, time, steps, ports }. Each
 * port is { port, there, pack, volts, amps, fill, word, status, colour }, `fill` being how full its
 * pack is by its voltage, from 3.3 V to full.
 */
export function chargerNow() {
  const p1 = whoopstor.p1;
  // While a cycle test waits for the USB to come back, it is still shown, from the last readings.
  if ((whoopstor.link !== "on" && !(whoopstor.link === "away" && whoopstor.cycle?.active)) || !p1) return null;
  const test = whoopstor.cycle?.active ? whoopstor.cycle : null;
  const charging = whoopstor.sessions.filter((session) => session && !session.end).length;
  if (!test && !p1.running) return null;
  const lipo = p1.target === 4.2 || p1.target === 3.8;
  const full = test?.fullVolts ?? (lipo ? 4.2 : 4.35);
  const facts = factsOf(app.state.batteries);
  const ports = [0, 1, 2, 3, 4, 5].map((index) => {
    const volts = p1.volts[index] ?? 0, there = volts >= 1;
    const pack = there ? packIn(index) : null;
    const status = statusOf(pack, facts);
    return {
      port: index + 1, there, pack: pack?.name ?? null, volts, amps: p1.states[index] === "charge" ? p1.amps[index] : null,
      fill: there ? Math.max(0.04, Math.min(1, (volts - 3.3) / (full - 3.3))) : 0,
      word: status.word, status: status.text, colour: status.word ? statusColour[status.word] : "var(--dim)",
    };
  });
  const packs = ports.filter((one) => one.there).length;
  if (test) {
    const kind = test.steps[test.step];
    const away = test.away ? new Date(test.away.until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
    const line = away ? "USB out: plug it back in" : test.resting
      ? `Resting before step ${test.step + 2}`
      : test.running
        ? (kind === "charge" ? `Charging to ${test.fullVolts} V at 2C` : `Down to ${test.storageVolts} V on the load`)
        : "Setting up the next step";
    const time = away ? `waits till ${away}` : test.resting
      ? `${Math.ceil((test.restLeft ?? 300000) / 60000)} min left`
      : test.running && test.stepStartedAt ? `${minutesSince(test.stepStartedAt)} min in` : "";
    // The steps with the rests between: charge, rest, down, rest, charge…
    const steps = test.steps.flatMap((step, number) => {
      const here = number === test.step;
      const one = { kind: step, label: step === "charge" ? `Charge to ${test.fullVolts} V` : `Down to ${test.storageVolts} V`, state: number < test.step || (here && test.resting) ? "done" : here ? "now" : "next" };
      if (number === test.steps.length - 1) return [one];
      const rest = { kind: "rest", label: "Rest", state: number < test.step ? "done" : here && test.resting ? "now" : "next" };
      return [one, rest];
    });
    return {
      kind: "cycle", title: `Cycle test on ${test.ports.length} pack${test.ports.length === 1 ? "" : "s"}, step ${test.step + 1} of ${test.steps.length}`,
      short: "Cycle test", badge: `${test.step + 1} / ${test.steps.length}`, line, time, steps, ports, away: Boolean(away),
    };
  }
  return {
    kind: "charging", title: `Charging ${charging || packs} pack${(charging || packs) === 1 ? "" : "s"} to ${p1.target} V`,
    short: "Charging", badge: `${charging || packs}`, line: `To ${p1.target} V`, time: "", steps: null, ports,
  };
}

/** What is being made just now, a video say: { title, progress } with progress from 0 to 1, or null. */
export function jobNow() {
  const job = app.state?.job;
  return job ? { title: job.title, progress: Math.max(0, Math.min(1, job.progress)) } : null;
}

/** The few words beside a tool in the sidebar while it has something going on, or "". */
export function noteFor(tool) {
  if (tool === "videoCreator") {
    const job = jobNow();
    return job ? `${Math.floor(job.progress * 100)}%` : "";
  }
  if (tool === "batteryTester") {
    const now = chargerNow();
    return !now ? "" : now.kind === "cycle" ? now.badge.replace(" / ", "/") : `${now.badge} charging`;
  }
  return "";
}
