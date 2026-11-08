// The first screen: what is going on just now, the WhoopStor's charge or cycle test, with each of its
// ports, and a card each for RaceGOW, the batteries, and the firmware, setup and radio tools. Every
// tool is also in the sidebar beside it.

import { app, open, go, render, allTracks } from "../core.js";
import { h, icon, label, primary, secondary, plain, testCopyBadge } from "../ui.js";
import { confirm } from "../sheets.js";
import { tools } from "../words.js";
import { showNote } from "./notes.js";
import { programStatus } from "./tool.js";
import { radioStatus } from "./radio.js";
import { factsOf, verdictOf } from "../../shared/batteries.js";
import { stop as stopCharger, stopCycleTest } from "../whoopstor.js";
import { openFromSide, chargerNow, statusColour } from "./live.js";

/** Says a newer version is ready. Pressing it goes to where it is installed. */
export function updatePill() {
  const update = app.state.update;
  if (update.kind !== "available") return null;
  return h("button.pill.update", { type: "button", help: "A newer version is ready. Open Pilot & settings to install it.", onclick: () => open({ name: "settings" }) }, `UPDATE TO V${update.version}`);
}

/** A line about where one of the setup tools stands. */
function setupStatus(tool) {
  if (tool === "betaflight" || tool === "elrsFlasher") return "Always their newest";
  if (tool === "elrsConfigurator" || tool === "edgetxCompanion") return programStatus(tool);
  if (tool === "radioBackups") return radioStatus();
  return "";
}

// ---- Running now

const volts = (v) => `${v.toFixed(2)} V`;

/** The words at the head of what is running: what it is, the step, and how long. */
function runningWords(now) {
  return h("div.grow", { "data-live": "home words" },
    h("div.label.accent", "RUNNING NOW · WHOOPSTOR"),
    h("div.running-title", now.title),
    now.kind === "cycle" && h("div.dim", [now.line, now.time].filter(Boolean).join(" · ")));
}

/** The steps of a cycle test, with the rests between, and each port's pack. */
function runningPorts(now) {
  return h("div.running-live", { "data-live": "home ports" },
    now.steps && h("ol.running-steps", { style: { gridTemplateColumns: now.steps.map((step) => (step.kind === "rest" ? "1fr" : step.kind === "charge" ? "3fr" : "4fr")).join(" ") } },
      now.steps.map((step) => h(`li.running-step.${step.state}`, h("div.running-bar"), h("span", step.label)))),
    h("div.running-ports", now.ports.map((port) => h(`div.running-port${port.there ? "" : ".empty"}`, { probe: `running port ${port.port}` },
      h("div.row", h("span.label", `PORT ${port.port}`), h("span.spacer"), port.status && h("span.running-status", { style: { color: port.colour } }, port.status)),
      h("div.running-pack", port.there ? port.pack ?? "?" : "–"),
      h("div.dim.small", port.there ? [volts(port.volts), typeof port.amps === "number" && `${port.amps.toFixed(2)} A`].filter(Boolean).join(" · ") : "Empty")))),
  );
}

async function stopPressed(now) {
  if (now.kind === "cycle") {
    const yes = await confirm({ title: "Stop the cycle test?", message: "Every port stops. What the steps done so far measured is kept with each pack.", yes: "Stop the test", destructive: true });
    if (!yes) return;
    app.notice = (await stopCycleTest()) || null;
  } else {
    app.notice = (await stopCharger()) || null;
  }
  render();
}

/** The WhoopStor's charge or cycle test, when there is one. */
function runningNow() {
  const now = chargerNow();
  if (!now) return null;
  return h("section.card.running", { probe: "running now", "aria-label": "Running now" },
    h("div.running-head",
      runningWords(now),
      h("div.row.tight",
        secondary("Open Batteries", () => openFromSide("batteryTester"), { probe: "running open" }),
        secondary(now.kind === "cycle" ? "Stop the test" : "Stop", () => stopPressed(now), { probe: "running stop" }))),
    runningPorts(now),
  );
}

/** Draws again only what a reading changes on the first screen, so its buttons are never swapped
 *  under the pointer. When something starts or stops, the whole page is drawn again. */
export function drawHomeLive() {
  if (app.page.name !== "home" || app.editor || app.trackView || app.tool) return;
  const now = chargerNow();
  const words = document.querySelector('#stage [data-live="home words"]'), ports = document.querySelector('#stage [data-live="home ports"]');
  if (Boolean(now) !== Boolean(words)) return render();
  if (!now) return;
  for (const [holder, fresh] of [[words, runningWords(now)], [ports, runningPorts(now)]]) {
    if (holder && fresh.outerHTML !== holder.outerHTML) holder.replaceWith(fresh);
  }
}

// ---- The cards

/** A few pack numbers in words: "022 to 025", "008, 011 and 015". */
function numbersInWords(names) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const runs = [];
  for (const name of sorted) {
    const last = runs.at(-1);
    if (last && /^\d+$/.test(name) && /^\d+$/.test(last.at(-1)) && Number(name) === Number(last.at(-1)) + 1) last.push(name);
    else runs.push([name]);
  }
  const pieces = runs.flatMap((run) => (run.length >= 3 ? [`${run[0]} to ${run.at(-1)}`] : run));
  return pieces.length === 1 ? pieces[0] : `${pieces.slice(0, -1).join(", ")} and ${pieces.at(-1)}`;
}

/** The next deadline, a time, or the day, for a race's row. */
function raceNote(track) {
  const now = Date.now();
  if (track.deadline && new Date(track.deadline) > now && track.submissions === 0) {
    const days = Math.floor((new Date(track.deadline) - now) / 86400000);
    return { words: `Closes ${days >= 1 ? `in ${days} day${days === 1 ? "" : "s"}` : "today"}`, soon: days < 3 };
  }
  if (track.submissions > 0) return { words: track.best ? `Sent in · ${track.best}` : "Sent in" };
  if (track.best) return { words: `Best ${track.best}` };
  return { words: track.date ? new Date(`${track.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "No time yet" };
}

function raceCard() {
  const races = app.state.events.flatMap((event) => event.tracks.map((track) => ({ ...track, event })))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 3);
  return h("section.card.home-card", { "aria-label": "RaceGOW" },
    label("RACEGOW"),
    races.length === 0
      ? h("p.dim", "No tracks yet. The Video Creator times your laps on the recording, puts the timer and music on, makes the videos, and fills in the entry form.")
      : h("div.home-rows", races.map((track) => {
        const note = raceNote(track);
        return h("button.home-row", { type: "button", probe: `home race ${track.path}`, onclick: () => go({ name: "track", track: track.path }) },
          h("span.home-row-title", track.name), h(`span.small${note.soon ? ".accent" : ".dim"}`, note.words));
      })),
    h("div.row.tight.home-card-foot",
      primary("Open Video Creator", () => openFromSide("videoCreator"), { probe: "home video creator" }),
      secondary("Leaderboards", () => openFromSide("leaderboards"))),
  );
}

function batteriesCard() {
  const facts = factsOf(app.state.batteries);
  const packs = Object.values(facts).filter((one) => !one.pack.retired);
  const counts = { race: 0, fun: 0, retire: 0, none: 0 };
  for (const one of packs) counts[verdictOf(one, facts, app.state.batteries.limits).word ?? "none"] += 1;
  const tested = new Set(Object.values(app.state.batteries.tests).map((test) => test.pack));
  const untried = packs.filter((one) => !tested.has(one.pack.id)).map((one) => one.pack.name);
  const measured = counts.race + counts.fun + counts.retire;
  return h("section.card.home-card", { "aria-label": "Batteries", probe: "home batteries" },
    label("BATTERIES"),
    packs.length === 0
      ? h("p.dim", "Add your packs by the numbers on them, then each charge on your WhoopStor is kept with its pack, so the tired ones stand out.")
      : [
        h("div.row.baseline", h("span.home-big", String(packs.length)), h("span.dim", packs.length === 1 ? "pack" : "packs")),
        measured > 0 && h("div.home-split", ["race", "fun", "retire"].filter((word) => counts[word] > 0).map((word) => h("span", { style: { flex: counts[word], background: statusColour[word] } })), counts.none > 0 && h("span", { style: { flex: counts.none, background: "var(--raised)" } })),
        h("div.row.wrap.small.home-legend",
          ["race", "fun", "retire"].map((word) => h("span", h("b", { style: { color: statusColour[word] } }, String(counts[word])), ` ${word.toUpperCase()}`)),
          counts.none > 0 && h("span.dim", `${counts.none} not measured yet`)),
        untried.length > 0 && h("p.small.home-note", untried.length > 8 ? `${untried.length} packs haven't been charged on the WhoopStor yet.` : `${untried.length === 1 ? "Pack" : "Packs"} ${numbersInWords(untried)} ${untried.length === 1 ? "hasn't" : "haven't"} been charged on the WhoopStor yet.`),
      ],
    h("div.row.tight.home-card-foot", secondary("Open Batteries", () => openFromSide("batteryTester"), { probe: "home open batteries" })),
  );
}

function setupCard() {
  return h("section.card.home-card", { "aria-label": "Firmware, setup and radio" },
    label("FIRMWARE, SETUP & RADIO"),
    h("div.home-rows", ["betaflight", "elrsFlasher", "elrsConfigurator", "edgetxCompanion", "radioBackups"].map((name) => h("button.home-row", { type: "button", probe: `home ${name}`, onclick: () => openFromSide(name) },
      h("span.home-row-icon", icon(tools[name].icon, 15)),
      h("span.home-row-words", h("span.home-row-title", tools[name].short ?? tools[name].title), h("span.dim.small", setupStatus(name)))))),
  );
}

export function home() {
  const state = app.state;
  const header = h("header.page-head",
    h("div.grow", label("TOOLS FOR FPV PILOTS"), h("h1.head-title", "Home")),
    updatePill(),
    state.testCopy && testCopyBadge(),
    h("span.home-version", `v${state.version}`),
    plain("What's new", () => showNote({ kind: "whatsNew", since: null }), { class: "quiet", help: "What changed in each version" }),
  );
  return h("div.scroll", { "data-scroll": "page" }, h("div.home", header, runningNow(), h("div.home-cards", raceCard(), batteriesCard(), setupCard())));
}

export { allTracks };
