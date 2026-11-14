// The Batteries page: the WhoopStor charger's six ports as they charge, its recent charges, every pack
// the pilot keeps with which to retire, and the pilot's own battery tester board, once there is one.

import { app, ask, take, goBack, backTitle, render, open } from "../core.js";
import { h, label, primary, secondary, plain, field, when, redraw } from "../ui.js";
import { confirm, question } from "../sheets.js";
import { tester, connect, disconnect, start, command } from "../tester.js";
import { whoopstor, firmwareSeen, connect as connectCharger, disconnect as disconnectCharger, connectWhenThere, choosePack, packIn, skippedIn, plan, start as startCharger, stop as stopCharger, cycleTest, cycleProblem, stopCycleTest } from "../whoopstor.js";
import { factsOf, verdictOf, limitsFor, nextPackName, cycleWindow, chargeGrade, statusWords, defaultLimits, recommendLimits, phaseWords, problemWords, refusalWords } from "../../shared/batteries.js";
import { firmwareWords, portWords, endedWords, endWords, stopWords } from "../../shared/whoopstor.js";
import { statusColour } from "./live.js";
import { ws3News } from "./ws3.js";
import { curveChart, sparkline } from "./curve.js";

/** Back to the Video Creator, for a page opened from there. Everything else is in the sidebar. */
const backLink = () => (backTitle() === "Hangar" ? null : secondary(backTitle(), goBack, { icon: "chevronLeft", probe: "back", help: "Back to the Video Creator" }));
const page = (...content) => h("div.scroll", { "data-scroll": "page" }, h("div.plain-page", ...content));

/** The new pack being typed in, while the form is open: { name, mah, brand }. */
let adding = null;
/** Ports whose pack is being changed. */
const changing = new Set();
/** What is typed in each pack box so far, by the box: the page is drawn again as readings come in. */
const typed = new Map();
/** The pack being edited in its row: { id, name, mah, brand }. */
let editing = null;
/** Packs whose tests are showing. */
const opened = new Set();
/** The test whose graph shows in an open pack's row, by the pack, when it isn't the latest. */
const graphOf = new Map();
/** The tester board's part of the page, which stays out of the way until there is a board. */
let showTester = false;
/** Which packs the list shows: "all", a status ("race", "fun", "retire"), or a size in mAh. */
let showingPacks = "all";
/** A pack to bring into view once the page is drawn, after it was found by typing. */
let bringIntoView = null;

/** Opens the page on one pack, its tests showing: for the sidebar's Find. */
export function showPack(id) {
  opened.add(id);
  showingPacks = "all";
  bringIntoView = id;
  open({ name: "batteries" });
  requestAnimationFrame(() => {
    const pack = app.state.batteries.packs[bringIntoView];
    bringIntoView = null;
    if (pack) document.querySelector(`[data-probe="pack ${CSS.escape(pack.name)}"]`)?.scrollIntoView({ block: "center" });
  });
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const volts = (v) => (typeof v === "number" ? `${v.toFixed(2)} V` : "–");
const mohm = (r) => (typeof r === "number" ? `${Math.round(r)} mΩ` : "–");
const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
/** The charge rate for a pack: about 1C, as its maker would have it. */
const rateFor = (pack) => (!pack ? 0.3 : pack.mah >= 450 ? 0.5 : 0.3);
/** Where the pilot has set a pack's status to change (shared/batteries.js's defaultLimits). */
const limitsNow = () => app.state.batteries.limits ?? defaultLimits;
/** The status limits being changed, in percents, while the form is open. */
let limitsDraft = null;

function say(answer) {
  if (answer.type === "ok") return;
  app.notice = refusalWords[answer.code] ?? answer.text ?? (answer.code === "no_answer" ? "The tester didn't answer." : `The tester said no (${answer.code}).`);
  render();
}

/** Starts a job, once the pack is known, and with the light's limits the Hangar works out for it. */
async function run(job, facts) {
  const pack = app.state.batteries.packs[tester.pack] ?? null;
  if (["sag", "check", "test"].includes(job)) {
    if (!pack) {
      app.notice = "Choose which pack is plugged in first, so its results are kept with it.";
      return render();
    }
    const limits = limitsFor(facts, pack.id, limitsNow()) ?? { good_mohm: null, bad_mohm: null };
    await command({ cmd: "set", values: limits });
  }
  const fields = job === "test" ? { rate: rateFor(pack), nominal_mah: pack.mah, cutoff: 3.3, end: "full" } : job === "check" || job === "charge" ? { rate: rateFor(pack) } : {};
  say(await start(job, fields));
}

function testerCard(facts) {
  if (tester.link !== "on") {
    return h("div.card.roomy",
      label("THE TESTER"),
      h("p.dim", "Plug the tester's data cable into this computer: the USB socket on the Pico itself. Charging and testing also need a USB-C charger in its power socket; the computer only carries the data."),
      tester.problem && h("p.warn", tester.problem),
      h("div.row", primary(tester.link === "looking" ? "Looking for it…" : app.state.testerSim ? "Connect to the stand-in" : "Connect", connect, { disabled: tester.link === "looking", probe: "tester connect" })),
    );
  }
  const status = tester.status, port = status?.ports?.[0], power = status?.power;
  const busy = port?.state === "busy";
  const pack = app.state.batteries.packs[tester.pack] ?? null;
  const packs = Object.values(app.state.batteries.packs).filter((one) => !one.retired).sort((a, b) => natural(a.name, b.name));
  const ready = power?.ok && port?.pack && !busy;
  const progress = tester.progress;
  const problem = tester.lastError && (problemWords[tester.lastError.code] ?? `It stopped: ${tester.lastError.code}.`);
  return h("div.card.roomy.battery-tester",
    h("div.row", label("THE TESTER"), h("span.spacer"), plain("Disconnect", disconnect, { class: "quiet", help: "Let go of the tester" })),
    h("div.row.wrap.dim.small",
      h("span", tester.hello ? `Firmware ${tester.hello.firmware}` : "Connected"),
      h("span", "·"),
      power?.ok ? h("span", `Power ${power.v.toFixed(2)} V`) : h("span.warn", "No power: plug a USB-C charger into its power socket"),
      typeof status?.temp === "number" && [h("span", "·"), h("span", `Board ${Math.round(status.temp)} °C`)],
    ),
    h("div.battery-now",
      h("div.battery-volts", port?.pack ? volts(port.v) : "–"),
      h("div",
        h("div.battery-phase", busy ? (phaseWords[port.phase] ?? "Working") : port?.pack ? "Pack plugged in" : "No pack plugged in"),
        h("div.dim.small", busy
          ? `${Math.abs(port.a).toFixed(2)} A ${port.a >= 0 ? "in" : "out"}${progress?.mah ? ` · ${Math.round(progress.mah)} mAh` : ""}${progress ? ` · ${clock(progress.s)}` : ""}`
          : port?.pack ? "Ready" : "Plug a pack into the tester's lead"),
      ),
    ),
    problem && h("p.warn", problem),
    h("label.answer",
      h("span.question", "Which pack is plugged in"),
      h("div.row",
        h("select.field.battery-choose", { probe: "tester pack", onchange: (event) => { tester.pack = event.target.value || null; render(); } },
          h("option", { value: "", selected: !pack }, packs.length ? "Choose…" : "Add your packs below first"),
          packs.map((one) => h("option", { value: one.id, selected: one.id === pack?.id }, `${one.name} · ${one.mah} mAh`))),
      ),
    ),
    h("div.row.wrap",
      busy
        ? primary("Stop", () => command({ cmd: "stop", port: 1 }).then(say), { probe: "tester stop", help: "Stop what the tester is doing. Everything on it goes off." })
        : [
          primary("Sag test", () => run("sag", facts), { disabled: !ready, probe: "tester sag", help: "About 6.5 A for 2 seconds: how far the pack's voltage drops under load. Takes a few seconds. Most telling on a full pack." }),
          secondary("Charge, then sag test", () => run("check", facts), { disabled: !ready, help: "Charges the pack if it isn't full, lets it settle for 2 minutes, then the sag test." }),
          secondary("Full test", () => run("test", facts), { disabled: !ready, help: "Charge, sag test, drain to 3.3 V with a sag test every fifth of the way, then charge again: capacity and efficiency too. About 2 to 4 hours." }),
          secondary("Charge", () => run("charge", facts), { disabled: !ready, help: `Charges to 4.35 V at ${rateFor(pack)} A.` }),
          secondary("Storage", () => run("storage", facts), { disabled: !ready, help: "Takes the pack to about 3.85 V for keeping." }),
        ],
    ),
  );
}

/** The sag test's voltage as a line, over the 2 seconds of the pull and the second after. */
function sagChart(curve) {
  const width = 520, height = 170, left = 34, right = 8, top = 10, bottom = 22;
  const points = curve.filter(([ms]) => ms >= -100);
  if (points.length < 2) return null;
  const t0 = -100, t1 = Math.max(...points.map(([ms]) => ms));
  const vs = points.map(([, v]) => v);
  const v0 = Math.floor((Math.min(...vs) - 0.02) * 10) / 10, v1 = Math.ceil((Math.max(...vs) + 0.02) * 10) / 10;
  const x = (ms) => left + ((ms - t0) / (t1 - t0)) * (width - left - right);
  const y = (v) => top + (1 - (v - v0) / (v1 - v0)) * (height - top - bottom);
  const path = points.map(([ms, v], index) => `${index ? "L" : "M"}${x(ms).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const grid = [];
  for (let v = v0; v <= v1 + 1e-6; v += 0.1) grid.push(`<line x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${left - 5}" y="${y(v) + 3.5}" class="chart-axis" text-anchor="end">${v.toFixed(1)}</text>`);
  for (const ms of [0, 1000, 2000, 3000].filter((one) => one <= t1)) grid.push(`<text x="${x(ms)}" y="${height - 6}" class="chart-axis" text-anchor="middle">${ms / 1000} s</text>`);
  return h("div.sag-chart", { html: `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">${grid.join("")}<path d="${path}" class="chart-line"/></svg>` });
}

function lastSagCard() {
  const last = tester.lastSag;
  if (!last) {
    return h("div.card.roomy",
      label("THE SAG TEST"),
      h("p.dim", "The tester pulls about 6.5 A from the pack for 2 seconds, a load like a whoop's on the throttle, and measures how far the voltage drops. The drop for each amp is the pack's sag resistance, in milliohms: the bigger it is, the sooner the pack falls below 4 V on take-off."),
      h("p.dim", "It compares best on a full pack, so start with Charge, then sag test. With three packs of a size tested, each is measured against your typical one."),
    );
  }
  const m = last.message, pack = app.state.batteries.packs[last.pack];
  return h("div.card.roomy",
    h("div.row", label("LATEST SAG TEST"), h("span.spacer"), h("span.dim.small", pack ? `${pack.name}` : "No pack chosen: not kept")),
    h("div.battery-stats",
      h("div", h("div.battery-big", mohm(m.r_end)), h("div.dim.small", "sag resistance after 2 s")),
      h("div", h("div.battery-mid", mohm(m.r_5ms)), h("div.dim.small", "at the start")),
      h("div", h("div.battery-mid", `${volts(m.v_rest)} → ${volts(m.v_end)}`), h("div.dim.small", `at ${typeof m.a_end === "number" ? m.a_end.toFixed(1) : "–"} A`)),
    ),
    sagChart(m.curve ?? []),
    m.v_rest < 4.25 && h("p.dim.small", `Tested at ${volts(m.v_rest)}, not on a full pack, so it isn't compared with your other packs.`),
  );
}

function addForm() {
  const draft = adding;
  const done = async () => {
    const answer = await ask("addPack", draft);
    if (answer?.problem) {
      app.notice = answer.problem;
      return render();
    }
    take(answer);
    tester.pack ??= answer.pack.id;
    adding = { name: nextPackName(app.state.batteries), mah: draft.mah, brand: draft.brand };
    render();
  };
  return h("div.battery-add",
    field("Number", draft.name, (value) => { draft.name = value; }, { key: "pack name", placeholder: "The number on it: 009", width: 160 }),
    field("mAh", String(draft.mah), (value) => { draft.mah = value; }, { key: "pack mah", width: 90 }),
    field("Make", draft.brand, (value) => { draft.brand = value; }, { key: "pack brand", placeholder: "Optional", width: 160 }),
    h("div.row", primary("Add", done, { probe: "pack add" }), plain("Done", () => { adding = null; render(); }, { class: "quiet" })),
  );
}

function testLine(test) {
  const at = when(test.at);
  if (test.kind === "sag") return [at, `Sag test at ${volts(test.v_rest)}`, `${mohm(test.r_end)} after 2 s, ${mohm(test.r_5ms)} at the start`];
  if (test.kind === "capacity") {
    const eff = typeof test.energyEfficiency === "number" ? `, ${Math.round(test.energyEfficiency * 100)}% of the energy back out` : "";
    return [at, "Full test", `${Math.round(test.mah)} mAh to ${test.cutoff ?? 3.3} V${eff}`];
  }
  if (test.kind === "cycle") {
    const steps = test.steps.map((step) => `${step.kind === "charge" ? `${Math.round(step.mah)} in` : `~${Math.round(step.mah)} out`}${typeof step.settledVolts === "number" ? `, settled ${step.settledVolts.toFixed(2)} V` : ""}`);
    const out = test.steps.reduce((sum, step) => sum + (step.unseenSeconds ?? 0), 0);
    return [at, `Cycle test, port ${test.port}, ${test.storageVolts}–${test.fullVolts} V`, `${steps.join(" · ")}${test.end === "done" ? "" : " · stopped"}${out ? ` · USB out ${minutesOrSeconds(out)}, that part worked out` : ""}`];
  }
  if (test.kind === "charge" && test.source === "whoopstor") return [at, `WhoopStor port ${test.port}, ${amps(test.amps)} to ${test.target} V`, chargeWords(test)];
  if (test.kind === "charge") return [at, "Charge", `${Math.round(test.mah ?? 0)} mAh in`];
  return [at, "Storage", `${volts(test.v_rest)}`];
}

/** The test whose graph shows for a pack: the one picked, or its latest with a curve, taking a cycle
 *  test over the charges it was made of. */
function shownGraph(pack, tests) {
  const graphed = tests.filter((test) => test.curve?.length > 1);
  const picked = graphed.find((test) => test.id === graphOf.get(pack.id));
  if (picked || !graphed.length) return picked ?? null;
  const cycle = graphed.find((test) => test.kind === "cycle");
  const ends = cycle ? Date.parse(cycle.at) + (cycle.curve.at(-1)[0] + 60) * 1000 : 0;
  return cycle && Date.parse(graphed[0].at) <= ends ? cycle : graphed[0];
}

/** The graph at the head of an open pack's tests: its voltage and current through a charge or a
 *  cycle test. */
function packGraph(pack, tests) {
  const test = shownGraph(pack, tests);
  if (!test) return tests.some((one) => one.source === "whoopstor") ? h("p.dim.small", "Its graph starts with its next charge on the WhoopStor: earlier ones were kept without one.") : null;
  const what = test.kind === "cycle"
    ? `Cycle test on port ${test.port}, ${test.storageVolts}–${test.fullVolts} V`
    : `Charge on port ${test.port}, ${amps(test.amps)} to ${test.target} V`;
  return h("div.pack-graph", { probe: `pack graph ${pack.name}` },
    h("div.row.baseline", h("span.label", what.toUpperCase()), h("span.spacer"), h("span.dim.small", when(test.at))),
    curveChart(test));
}

function packRow(one, facts) {
  const { pack } = one;
  const verdict = verdictOf(one, facts, limitsNow());
  const open = opened.has(pack.id);
  const tests = Object.values(app.state.batteries.tests).filter((test) => test.pack === pack.id).sort((a, b) => b.at.localeCompare(a.at));
  return [
    h(`div.battery-row${pack.retired ? ".retired" : ""}`, { probe: `pack ${pack.name}` },
      h("button.battery-name", { type: "button", help: open ? "Hide its tests" : "Show its tests", onclick: () => { if (open) opened.delete(pack.id); else opened.add(pack.id); render(); } }, pack.name, h("span.dim", ` ${pack.mah} mAh${pack.brand ? ` · ${pack.brand}` : ""}`)),
      one.latestReading
        ? h("span.battery-cell", { help: "Its charging resistance from storage, in its latest cycle test on the WhoopStor: the one it is graded on" }, mohm(one.latestReading.resistance), h("span.dim.small", ` port ${one.latestReading.port}`))
        : h("span.battery-cell.dim", { help: "From its latest charge on the WhoopStor, which started wherever the pack was: a cycle test grades it" }, one.latestCharge ? [mohm(one.latestCharge.resistance), h("span.small", ` port ${one.latestCharge.port}`)] : "–"),
      h("span.battery-cell", { help: "Sag resistance after 2 s, from its latest sag test on a full pack, on the tester board" }, mohm(one.sag?.r_end)),
      h("span.battery-cell", { help: "From its latest full test" }, one.capacity ? `${Math.round(one.capacity.mah)} mAh` : "–"),
      h(`span.verdict${verdict.word ? `.${verdict.word}` : ""}`, { probe: `status ${pack.name}` }, verdict.word ? statusWords[verdict.word] : "–"),
      h("select.field.call-choice", {
        probe: `call ${pack.name}`, help: "Your own call on this pack, from flying it: the Hangar suggests limits that agree with your calls",
        onchange: async (event) => { take(await ask("changePack", pack.id, { call: event.target.value || null })); render(); },
      }, [["", "–"], ["race", "Race"], ["fun", "Fun"], ["retire", "Retire"]].map(([value, words]) => h("option", { value, selected: (pack.call ?? "") === value }, words))),
      h("span.battery-why.dim.small", verdict.reasons.join(". ")),
    ),
    open && h("div.battery-tests",
      packGraph(pack, tests),
      tests.length === 0 ? h("p.dim.small", "Nothing measured yet.") : tests.slice(0, 30).map((test) => h("div.battery-test",
        testLine(test).map((part) => h("span", part)),
        test.curve?.length > 1
          ? (shownGraph(pack, tests) === test
            ? h("span.dim.small.graph-on", "Graph above")
            : plain("Graph", () => { graphOf.set(pack.id, test.id); render(); }, { class: "quiet small", probe: `graph ${test.id}`, help: "Show this one's graph above" }))
          : h("span"))),
      editing?.id === pack.id
        ? h("div.battery-add",
          field("Number", editing.name, (value) => { editing.name = value; }, { key: "edit name", width: 120 }),
          field("mAh", String(editing.mah), (value) => { editing.mah = value; }, { key: "edit mah", width: 90 }),
          field("Make", editing.brand, (value) => { editing.brand = value; }, { key: "edit brand", width: 160 }),
          h("div.row",
            primary("Save", async () => { take(await ask("changePack", pack.id, { name: editing.name, mah: editing.mah, brand: editing.brand })); editing = null; render(); }, { probe: "pack save" }),
            plain("Cancel", () => { editing = null; render(); }, { class: "quiet" })))
        : null,
      h("div.row",
        plain("Change", () => { editing = { id: pack.id, name: pack.name, mah: pack.mah, brand: pack.brand ?? "" }; render(); }, { class: "quiet", help: "Its number, its mAh and its make" }),
        plain(pack.retired ? "Bring it back" : "Retire it", async () => take(await ask("changePack", pack.id, { retired: !pack.retired })) && render(), { class: "quiet" }),
        plain("Forget it", async () => {
          if (!(await confirm({ title: `Forget ${pack.name}?`, message: "The pack and everything measured on it go from the Hangar. The tester itself keeps nothing.", yes: "Forget it", destructive: true }))) return;
          take(await ask("removePack", pack.id));
          if (tester.pack === pack.id) tester.pack = null;
          render();
        }, { class: "quiet" }),
      ),
    ),
  ];
}

/** The buttons that narrow the list: all, by status, by size. Each says how many it would show. */
function packFilters(all, facts) {
  const word = (one) => verdictOf(one, facts, limitsNow()).word;
  const sizes = [...new Set(all.map((one) => one.pack.mah))].sort((a, b) => a - b);
  const choices = [
    ["all", "All", all.length],
    ...["race", "fun", "retire"].map((status) => [status, statusWords[status], all.filter((one) => word(one) === status).length]),
    ...(sizes.length > 1 ? sizes.map((mah) => [mah, `${mah} mAh`, all.filter((one) => one.pack.mah === mah).length]) : []),
  ];
  return choices.map(([value, words, count]) => h(`button.filter${showingPacks === value ? ".on" : ""}`, {
    type: "button", probe: `packs show ${value}`, "aria-pressed": showingPacks === value ? "true" : "false",
    onclick: () => { showingPacks = showingPacks === value ? "all" : value; render(); },
  }, words, h("span.filter-count", String(count))));
}

function packsCard(facts) {
  const all = Object.values(facts).sort((a, b) => Boolean(a.pack.retired) - Boolean(b.pack.retired) || natural(a.pack.name, b.pack.name));
  const shown = showingPacks === "all" ? all
    : typeof showingPacks === "number" ? all.filter((one) => one.pack.mah === showingPacks)
      : all.filter((one) => verdictOf(one, facts, limitsNow()).word === showingPacks);
  return h("div.card.roomy",
    h("div.row.wrap", label("YOUR PACKS"), all.length > 0 && h("div.row.wrap.tight.filters", packFilters(all, facts)), h("span.spacer"), !adding && secondary("Add packs", () => { adding = { name: nextPackName(app.state.batteries), mah: 300, brand: "" }; render(); }, { icon: "plus", probe: "packs add" })),
    adding && addForm(),
    all.length === 0
      ? h("p.dim", "Add each pack you want to keep track of, by the number written on it: 001, 002 and on. When one goes in a port of the WhoopStor, say which it is, and each charge is kept with it.")
      : [
        h("div.battery-row.head.label", h("span", "PACK"), h("span", "CHARGING"), h("span", "SAG"), h("span", "CAPACITY"), h("span", "STATUS"), h("span", "YOUR CALL"), h("span", "WHY")),
        shown.length === 0 ? h("p.dim.small.battery-none", "None of your packs is that just now.") : shown.map((one) => packRow(one, facts)),
        limitsPart(facts),
      ],
  );
}

const asPercentAbove = (ratio) => String(Math.round((ratio - 1) * 100));

/** Opens the form for the status limits, and brings it into view. */
function openLimits() {
  const limits = limitsNow();
  limitsDraft ??= { raceResistance: asPercentAbove(limits.raceResistance), funResistance: asPercentAbove(limits.funResistance), raceCapacity: asPercentOf(limits.raceCapacity), funCapacity: asPercentOf(limits.funCapacity) };
  render();
  requestAnimationFrame(() => document.querySelector(".limits")?.scrollIntoView({ block: "center", behavior: "smooth" }));
}
const asPercentOf = (ratio) => String(Math.round(ratio * 100));

/** Where a pack's status changes: the limits as set, a form to change them, and the limits that
 *  would agree best with the pilot's own calls on their packs. */
function limitsPart(facts) {
  const limits = limitsNow();
  const said = `RACE: resistance up to ${asPercentAbove(limits.raceResistance)}% above your typical pack of its size, capacity at least ${asPercentOf(limits.raceCapacity)}% of it. FUN: up to ${asPercentAbove(limits.funResistance)}% above, at least ${asPercentOf(limits.funCapacity)}%. RETIRE past that.`;
  if (!limitsDraft) {
    return h("div.limits", h("p.dim.small", said), h("div.row", plain("Change the limits…", openLimits, { class: "quiet", probe: "limits change" })));
  }
  const suggested = recommendLimits(facts);
  const has = ["raceResistance", "funResistance", "raceCapacity", "funCapacity"].some((key) => suggested[key] !== null);
  const fromDraft = () => ({
    raceResistance: 1 + Number(limitsDraft.raceResistance) / 100, funResistance: 1 + Number(limitsDraft.funResistance) / 100,
    raceCapacity: Number(limitsDraft.raceCapacity) / 100, funCapacity: Number(limitsDraft.funCapacity) / 100,
  });
  const save = async (next) => {
    const answer = await ask("setBatteryLimits", next);
    if (answer?.problem) {
      app.notice = answer.problem;
      return render();
    }
    take(answer);
    limitsDraft = null;
    render();
  };
  return h("div.limits.card-inset",
    label("STATUS LIMITS"),
    h("p.dim.small", "Each against your typical pack of the same size, measured the same way. Resistance is from the WhoopStor's charges (or the tester's sag test), capacity from the cycle test (or the tester's full test). A minus resistance means below typical."),
    h("div.battery-add",
      field("RACE: resistance up to, % above", limitsDraft.raceResistance, (value) => { limitsDraft.raceResistance = value; }, { key: "limit race r", width: 210 }),
      field("RACE: capacity at least, %", limitsDraft.raceCapacity, (value) => { limitsDraft.raceCapacity = value; }, { key: "limit race c", width: 190 }),
      field("FUN: resistance up to, % above", limitsDraft.funResistance, (value) => { limitsDraft.funResistance = value; }, { key: "limit fun r", width: 210 }),
      field("FUN: capacity at least, %", limitsDraft.funCapacity, (value) => { limitsDraft.funCapacity = value; }, { key: "limit fun c", width: 190 })),
    has
      ? h("div.suggested", { probe: "limits suggested" },
        h("p.small", `From your calls on ${suggested.calls} pack${suggested.calls === 1 ? "" : "s"}, the limits that agree with you best: ${[
          suggested.raceResistance !== null && `RACE resistance up to ${asPercentAbove(suggested.raceResistance)}%`,
          suggested.raceCapacity !== null && `RACE capacity at least ${asPercentOf(suggested.raceCapacity)}%`,
          suggested.funResistance !== null && `FUN resistance up to ${asPercentAbove(suggested.funResistance)}%`,
          suggested.funCapacity !== null && `FUN capacity at least ${asPercentOf(suggested.funCapacity)}%`,
        ].filter(Boolean).join(", ")}.`),
        secondary("Use these", () => {
          for (const key of ["raceResistance", "funResistance"]) if (suggested[key] !== null) limitsDraft[key] = asPercentAbove(suggested[key]);
          for (const key of ["raceCapacity", "funCapacity"]) if (suggested[key] !== null) limitsDraft[key] = asPercentOf(suggested[key]);
          render();
        }, { probe: "limits use suggested", help: "Puts them in the boxes above, to look at before saving" }))
      : h("p.dim.small", "Give a few packs your own call (Race, Fun or Retire, from flying them) and the Hangar will suggest the limits that agree with you best."),
    h("div.row",
      primary("Save", () => save(fromDraft()), { probe: "limits save" }),
      plain("Starting points", () => save(null), { class: "quiet", help: `Back to ${asPercentAbove(defaultLimits.raceResistance)}% and ${asPercentOf(defaultLimits.raceCapacity)}% for RACE, ${asPercentAbove(defaultLimits.funResistance)}% and ${asPercentOf(defaultLimits.funCapacity)}% for FUN` }),
      plain("Cancel", () => { limitsDraft = null; render(); }, { class: "quiet" })),
  );
}

export function batteries() {
  connectWhenThere();
  const facts = factsOf(app.state.batteries);
  const testerThere = showTester || tester.link !== "off" || app.state.testerSim || Object.values(app.state.batteries.tests).some((test) => test.kind === "sag" || test.kind === "capacity");
  const charger = whoopstor.link === "on"
    ? ["WHOOPSTOR", whoopstor.name?.toUpperCase(), "CONNECTED"]
    : whoopstor.link === "away" ? ["WHOOPSTOR", whoopstor.name?.toUpperCase(), "USB OUT"]
      : [whoopstor.link === "looking" ? "LOOKING FOR THE WHOOPSTOR" : "WHOOPSTOR NOT CONNECTED"];
  return page(
    backLink() && h("div", backLink()),
    h("header.page-head",
      h("div.grow", label(charger.filter(Boolean).join(" · ")), h("h1.head-title", "Batteries")),
      Object.keys(app.state.batteries.packs).length > 0 && secondary("Change the limits…", openLimits, { probe: "limits change top", help: "Where a pack goes from RACE to FUN to RETIRE" })),
    packNumbers(),
    chargerCard(),
    packsCard(facts),
    recentCard(),
    testerThere
      ? [h("h2.battery-section", "YOUR TESTER BOARD"), h("div.battery-grid", testerCard(facts), lastSagCard())]
      : h("div.row", plain("Your own battery tester board…", () => { showTester = true; render(); }, { class: "quiet", help: "The board that load-tests a 1S pack at about 6.5 A, once it is built" })),
  );
}

// ---- The WhoopStor

const amps = (a) => (typeof a === "number" ? `${a.toFixed(2)} A` : "–");
/** The charge rate as a multiple of the pack's capacity: 0.3 A on a 300 mAh pack is 1C. */
const cRate = (a, pack) => (pack && a ? `${(a / (pack.mah / 1000)).toFixed(1).replace(/\.0$/, "")}C` : null);
const packsInOrder = () => Object.values(app.state.batteries.packs).filter((one) => !one.retired).sort((a, b) => natural(a.name, b.name));

const minutesOrSeconds = (seconds) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);

function chargeWords(test) {
  const parts = [`${Math.round(test.mah ?? 0)} mAh in`];
  if (typeof test.resistance === "number") parts.push(`${mohm(test.resistance)}`);
  else if (test.partial) parts.push("joined part way, no resistance");
  if (test.end && test.end !== "full") parts.push(endWords[test.end] ?? test.end);
  if (test.unseenSeconds) parts.push(`USB out ${minutesOrSeconds(test.unseenSeconds)}`);
  return parts.join(", ");
}

/** A pack by the number typed: "9" is "009", as the pilot writes them. A number not seen before
 *  becomes a new pack, the size and make of the last one added, which its row can change. */
async function packNamed(text) {
  const typed = String(text ?? "").trim();
  if (typed === "") return null;
  const name = /^\d{1,2}$/.test(typed) ? typed.padStart(3, "0") : typed;
  const found = Object.values(app.state.batteries.packs).find((one) => one.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const last = Object.values(app.state.batteries.packs).sort((a, b) => b.added.localeCompare(a.added))[0];
  const answer = await ask("addPack", { name, mah: last?.mah ?? 300, brand: last?.brand ?? "" });
  if (answer?.problem) {
    app.notice = answer.problem;
    render();
    return null;
  }
  take(answer);
  return answer.pack;
}

/** A box to type a pack's number in, with the numbers already known to pick from. Return gives it. */
function packBox(probe, give, placeholder = "Pack number, then Return") {
  return h("input.field.port-pack", {
    type: "text", key: probe, probe, placeholder, list: "pack-numbers", spellcheck: false, value: typed.get(probe) ?? "",
    oninput: (event) => typed.set(probe, event.target.value),
    onkeydown: async (event) => {
      if (event.key !== "Enter") return;
      const pack = await packNamed(event.target.value);
      if (!pack) return;
      typed.delete(probe);
      event.target.blur();
      await give(pack);
    },
  });
}

const packNumbers = () => h("datalist", { id: "pack-numbers" }, packsInOrder().map((one) => h("option", { value: one.name }, `${one.mah} mAh${one.brand ? ` · ${one.brand}` : ""}`)));

/** The question each port with a pack in asks about it: which of the pilot's it is, before a charge or
 *  during one. Once said, the pack, with a way to change it. */
function packChoice(port) {
  const pack = packIn(port - 1), skipped = skippedIn(port - 1);
  if ((pack || skipped) && !changing.has(port)) {
    return h("div.row.port-pack-row",
      pack ? h("span.dim.small", `${pack.mah} mAh${pack.brand ? ` · ${pack.brand}` : ""}`) : h("span.dim.small", "Not one of mine: not kept"),
      h("span.spacer"),
      secondary("Change", () => { changing.add(port); render(); }, { class: "port-change", probe: `port ${port} change`, help: "Say which pack is in this port. A pack in another port too comes off that one." }),
    );
  }
  return h("div.port-pack-row.column",
    packBox(`port ${port} pack`, async (one) => { changing.delete(port); await choosePack(port, one.id); }),
    plain("Not one of mine", async () => { changing.delete(port); await choosePack(port, "skip"); }, { class: "quiet small" }),
  );
}

/** During a cycle test's way down, about how much the load has taken out of a port's pack. */
function outLine(index) {
  const test = whoopstor.cycle;
  if (!test?.running || test.steps[test.step] !== "discharge") return null;
  const port = test.ports.find((one) => one.index === index);
  return port && h("div.dim.small", `About ${Math.round(port.out)} mAh out so far`);
}

function portTile(index) {
  const p1 = whoopstor.p1, session = whoopstor.sessions[index];
  const state = p1?.states[index] ?? "idle", v = p1?.volts[index] ?? 0, a = p1?.amps[index] ?? 0;
  const present = v >= 1;
  const pack = packIn(index);
  const overRate = Boolean(session && !session.end && pack && session.amps > (2.05 * pack.mah) / 1000);
  const word = portWords({ state, present, running: p1?.running, target: p1?.target, ended: session?.end });
  const facts = pack ? factsOf(app.state.batteries) : null;
  // The status beside the pack's number: in a cycle test's charge after its first, which starts from
  // storage after a rest and so compares with other packs', from this charge's resistance once it is
  // worked out, graded as it will be once kept; or else the pack's own status.
  const test = whoopstor.cycle;
  const comparable = Boolean(test?.active && test.step > 0 && test.steps[test.step] === "charge" && test.ports.some((one) => one.index === index));
  const grade = comparable && session?.resistance && pack && facts[pack.id] ? chargeGrade(facts[pack.id], facts, { resistance: session.resistance.mohm, port: index + 1 }, limitsNow()) : null;
  const status = grade ? grade.word : pack && facts[pack.id] ? verdictOf(facts[pack.id], facts, limitsNow()).word : null;
  let resistance = null;
  if (session?.resistance) resistance = h("span.port-r", { help: comparable ? "This charge's resistance, from storage: it grades the pack against your others" : "This charge's resistance. Only a cycle test's charges from storage grade the pack: this one started wherever the pack was" }, mohm(session.resistance.mohm));
  else if (session?.partial) resistance = h("span.dim.small", "Joined part way: no resistance");
  else if (session && !session.end) resistance = h("span.dim.small", { help: "Worked out over the first 8 seconds of the current coming up" }, "Measuring…");
  // How full the pack is by its voltage, from 3.3 V to full.
  const lipo = p1?.target === 4.2 || p1?.target === 3.8;
  const fill = present ? Math.max(0.03, Math.min(1, (v - 3.3) / ((lipo ? 4.2 : 4.35) - 3.3))) : 0;
  return h(`div.port-tile${present ? "" : ".empty"}${state === "fault" ? ".fault" : ""}`, { probe: `port ${index + 1}` },
    h("div.row", h("span.label", `PORT ${index + 1}`), h("span.spacer"), h("span.port-state", word)),
    h("div.row.baseline.port-main",
      h("span.port-name", pack ? pack.name : present ? "–" : ""),
      h("span.spacer"),
      status && h(`span.verdict.${status}`, { help: grade?.reason, probe: grade ? `port ${index + 1} grade` : `port ${index + 1} status` }, statusWords[status])),
    present && h("div.row.baseline.port-line",
      h("span.port-volts", volts(v)),
      state === "charge" && h("span", amps(a)),
      h("span.spacer"),
      resistance),
    present && h("div.port-fill", h("span", { style: { width: `${Math.round(fill * 100)}%`, background: status ? statusColour[status] : "var(--accent)" } })),
    present && sparkline(tileCurve(index)),
    session && h("div.dim.small", [
      `${Math.round(session.mah)} mAh in`,
      cRate(session.amps, pack) && `set ${amps(session.amps)} (${cRate(session.amps, pack)})`,
    ].filter(Boolean).join(" · ")),
    outLine(index),
    overRate && h("div.warn.small", { probe: `port ${index + 1} over` }, `${amps(session.amps)} is ${cRate(session.amps, pack)} for this ${pack.mah} mAh pack, above 2C. Stop, then Start from here to set it.`),
    present && packChoice(index + 1),
  );
}

/** A port's voltage so far: the cycle test's, rests and all, while one is going, or else this charge's. */
function tileCurve(index) {
  const testing = whoopstor.cycle?.active ? whoopstor.cycle.ports.find((one) => one.index === index) : null;
  if (testing?.curve?.length > 1) return testing.curve;
  const session = whoopstor.sessions[index];
  return session?.curve?.length > 1 ? session.curve : null;
}

/** The part of the charger's card that changes with every reading: its line and the six ports. */
function chargerLive() {
  const p1 = whoopstor.p1, p2 = whoopstor.p2;
  const firmware = firmwareWords(p1, p2);
  return [
    h("div.row.wrap.dim.small",
      h("span", whoopstor.name),
      firmware && [h("span", "·"), h("span", `Firmware ${firmware}`), ws3News(firmwareSeen())],
      p1 && [h("span", "·"), h("span", `Input ${p1.input.toFixed(1)} V`)],
      p1 && [h("span", "·"), h("span", `To ${p1.target} V at ${amps(p1.current)}`)],
      p1 && [h("span", "·"), p1.running ? h("span", "Charging") : h("span", p1.stopped > 0 && p1.stopped !== 4 ? `Stopped: ${stopWords[p1.stopped] ?? "it stopped"}` : "Stopped")],
    ),
    !p1 && h("p.dim", "Waiting for the charger…"),
    p1 && whoopstor.cycle?.active && cycleLine(),
    p1 && !whoopstor.cycle?.active && h("div.row.wrap.charger-controls",
      p1.running
        ? primary("Stop", async () => tell(await stopCharger()), { probe: "whoopstor stop", help: "Stops every port, as the charger's own button does" })
        : [
          primary("Start", startPressed, { probe: "whoopstor start", help: "Sets each port to 2C for the pack in it, then starts charging" }),
          secondary("Cycle test…", cyclePressed, { probe: "whoopstor cycle", help: "Charge, down to storage, charge, down to storage: what each pack takes in and gives back" }),
        ],
      h("span.dim.small", p1.running ? "Charging. Stop is always taken." : "Put the packs in and give each its number, then Start: each charges at 2C for its size.")),
    p1 && h(`div.port-grid${whoopstor.link === "away" ? ".stale" : ""}`, [0, 1, 2, 3, 4, 5].map(portTile)),
  ];
}

/** The cycle test as it goes: which step, how long it has been at it, and a way to stop it. */
function cycleLine() {
  const test = whoopstor.cycle, kind = test.steps[test.step];
  const minutes = test.stepStartedAt ? Math.round((Date.now() - test.stepStartedAt) / 60000) : 0;
  if (test.away) {
    const until = new Date(test.away.until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return h("div.cycle-away", { probe: "cycle away" },
      h("div.row.wrap.charger-controls",
        primary("Connect again", () => connectCharger(), { probe: "cycle reconnect", help: "Looks for the WhoopStor again. It is looked for by itself as soon as it is plugged back in." }),
        secondary("Stop the test", async () => tell(await stopCycleTest()), { probe: "cycle stop" }),
        h("span.warn", `The WhoopStor's USB is out, ${test.resting ? `in the rest before step ${test.step + 2}` : `in step ${test.step + 1} of ${test.steps.length}`}.`)),
      h("p.dim.small", `The charger carries on by itself. Plug its USB back in and the test picks up where it is, counting what it missed from the readings either side. It waits until ${until}, then stops the test.`),
      whoopstor.problem && h("p.warn.small", whoopstor.problem));
  }
  return h("div.row.wrap.charger-controls", { probe: "cycle line" },
    primary("Stop the test", async () => tell(await stopCycleTest()), { probe: "cycle stop" }),
    test.resting
      ? h("span", { probe: "cycle rest" }, `Cycle test, resting before step ${test.step + 2} of ${test.steps.length}: ${Math.ceil((test.restLeft ?? 300000) / 60000)} min left`)
      : h("span", `Cycle test, step ${test.step + 1} of ${test.steps.length}: ${kind === "charge" ? `charging to ${test.fullVolts} V at 2C` : `down to ${test.storageVolts} V on the charger's load`}`),
    h("span.dim.small", `${minutes} min so far. Keep the Hangar open: it starts each step.`));
}

/** Asks how many cycles, says what the test does, and runs it. */
async function cyclePressed() {
  const problem = cycleProblem();
  if (problem) return tell(problem);
  const { target } = whoopstor.p1;
  const lipo = target === 4.2 || target === 3.8;
  const full = lipo ? 4.2 : 4.35, storage = lipo ? 3.8 : 3.85;
  const cycles = await question({
    title: "Cycle test?",
    message: h("div.plan",
      h("p", `Each pack in charges to ${full} V at 2C, rests 5 minutes, goes down to ${storage} V on the charger's own load (about 0.2 A), and does it again for a second cycle, so they end at storage. What goes in is measured; what comes out is worked out from the voltage across the load; where each pack settles in each rest is kept too.`),
      h("p.dim.small", `For 300 mAh packs, about an hour and a half a cycle. Keep the Hangar open and the WhoopStor connected: the Hangar starts each step, and keeps this computer awake meanwhile. ${lipo ? "The charger is set for LiPo, so it goes between 4.20 V and 3.80 V." : "LiHV: between 4.35 V and 3.85 V."}`)),
    buttons: [{ title: "Cancel", value: 0, kind: "secondary", cancel: true }, { title: "One cycle", value: 1, kind: "secondary" }, { title: "Two cycles", value: 2, kind: "primary", default: true }],
  });
  if (cycles) tell(await cycleTest(cycles));
}

const tell = (problem) => {
  if (problem) app.notice = problem;
  render();
};

/** Shows what Start will do in each port, and does it if the pilot says so. */
async function startPressed() {
  const steps = plan();
  if (steps.length === 0) return tell("Put packs in the WhoopStor first.");
  const lines = steps.map((step) => h("div.plan-line",
    h("span.charge-pack", `Port ${step.port}`),
    h("span", step.pack ? `${step.pack.name} · ${step.pack.mah} mAh` : "No number yet"),
    h("span", step.amps === null ? "Left out" : `${amps(step.amps)}`),
    h("span.dim.small", step.why)));
  const yes = await confirm({
    title: `Charge to ${whoopstor.p1.target} V?`,
    message: h("div.plan", lines, h("p.dim.small", "Each port keeps its current for this run. Put a different pack in a port and it charges at that port's current, so Stop and Start again from here after swapping packs. Once stopped, the ports go back to the charger's own current.")),
    yes: "Start",
  });
  if (yes) tell(await startCharger());
}

/** Draws again only the charger's line and its ports as readings come in, so the rest of the page
 *  stays still and scrolls smoothly. */
function drawLive() {
  const live = document.querySelector('[data-live="whoopstor"]');
  if (live && app.page.name === "batteries") redraw(live, ...chargerLive());
  else render();
}
whoopstor.onLive = drawLive;

function chargerCard() {
  if (whoopstor.link !== "on" && whoopstor.link !== "away") {
    return h("div.card.roomy",
      label("THE WHOOPSTOR"),
      h("p.dim", "Your WhoopStor V3, with WS3 Unlocked or OpenWS3 on it, tells the Hangar what each of its ports is doing, and starts and stops when you press Start and Stop here. How a pack is charged, its voltages and cut-offs, stays the charger's own. Plug its USB-C into this computer, through a USB hub if it drops off on its own."),
      h("p.dim", "To keep this computer safe, power the WhoopStor from its XT60 or barrel socket with DISABLE USB POWER set to YES first: then only data passes over the USB-C. Powered by this computer's USB-C alone, it charges slowly."),
      whoopstor.problem && h("p.warn", whoopstor.problem),
      h("div.row", primary(whoopstor.link === "looking" ? "Looking for it…" : app.state.whoopstorSim ? "Connect to the pretend one" : "Connect", () => connectCharger(), { disabled: whoopstor.link === "looking", probe: "whoopstor connect" })),
    );
  }
  return h("div.card.roomy.whoopstor",
    h("div.row", label("THE WHOOPSTOR"), h("span.spacer"), plain("Disconnect", () => disconnectCharger().then(render), { class: "quiet", help: "Stop listening to the WhoopStor. It goes on charging." })),
    h("div", { "data-live": "whoopstor" }, chargerLive()),
    whoopstor.p1 && h("p.dim.small", "Each pack's resistance is worked out over the first 8 seconds of its charge, from how its voltage rises as the current comes up. Packs are graded on it from cycle tests only: each charge after the first starts from storage after a rest, at 2C, so they compare like for like on any port. Other charges start wherever the pack is, and read up to 25% off. Readings can move about 5% from one day to the next."),
    whoopstor.sim && h("div.row.wrap",
      secondary("Pretend: put a pack in", () => {
        const free = whoopstor.sim.ports.findIndex((port) => !port.cell);
        if (free >= 0) whoopstor.sim.insert(free + 1, { soc: 0.3 + Math.random() * 0.3, r0: 0.04 + Math.random() * 0.08 });
        whoopstor.sim.start();
      }, { probe: "sim insert" }),
      secondary("Pretend: pull the last out", () => {
        const last = whoopstor.sim.ports.map((port) => Boolean(port.cell)).lastIndexOf(true);
        if (last >= 0) whoopstor.sim.remove(last + 1);
      }),
    ),
  );
}

/** The latest charges on the WhoopStor, with the question for any whose pack wasn't said. */
function recentCard() {
  const charges = Object.values(app.state.batteries.tests).filter((test) => test.source === "whoopstor").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  if (charges.length === 0) return null;
  return h("div.card.roomy",
    label("RECENT CHARGES"),
    charges.map((test) => {
      const pack = app.state.batteries.packs[test.pack];
      if (test.kind === "cycle") {
        const window = cycleWindow(test);
        return h("div.charge-row", { probe: `cycle ${test.id}` },
          h("span.dim.small", when(test.at)),
          pack
            ? h("span.charge-pack", pack.name)
            : packBox(`pack for ${test.id}`, async (one) => { take(await ask("assignBatteryTest", test.id, one.id)); render(); }, "Which pack? Number, Return"),
          h("span", `Port ${test.port}`),
          h("span", `Cycle test, ${test.cycles === 1 ? "1 cycle" : `${test.cycles} cycles`}`),
          h("span.battery-cell", window?.in !== null && window ? `${Math.round(window.in)} in` : "–"),
          h("span.battery-cell", window ? `~${Math.round(window.out)} out` : "–"),
          h("span.dim.small", test.end === "done" ? "Done" : "Stopped"));
      }
      return h("div.charge-row", { probe: `charge ${test.id}` },
        h("span.dim.small", when(test.at)),
        pack
          ? h("span.charge-pack", pack.name)
          : h("div.row",
            packBox(`pack for ${test.id}`, async (one) => { take(await ask("assignBatteryTest", test.id, one.id)); render(); }, "Which pack? Number, Return"),
            plain("Not mine", async () => { take(await ask("forgetBatteryTest", test.id)); render(); }, { class: "quiet small", help: "Forget this charge: it wasn't one of your packs" })),
        h("span", `Port ${test.port}`),
        h("span", `${amps(test.amps)}${cRate(test.amps, pack) ? ` (${cRate(test.amps, pack)})` : ""} to ${test.target} V`),
        h("span.battery-cell", `${Math.round(test.mah ?? 0)} mAh`),
        h("span.battery-cell", typeof test.resistance === "number" ? mohm(test.resistance) : "–"),
        h("span.dim.small", endedWords(test)),
      );
    }),
  );
}
