// The Whoop Garage: the pilot's whoops and every flight from their blackbox logs. After a heat or a
// practice, the pilot saves the blackbox in Betaflight and opens the file here (or drops it on the
// page). It is read power-up by power-up, the pilot says which whoop and which pack each was, and
// each flight is kept with what it says: the throttle and the pack's sag, the noise and the tune,
// and how much of the rates was used.

import { app, ask, render, open, go } from "../core.js";
import { h, label, primary, secondary, plain, icon, when } from "../ui.js";
import { confirm, question } from "../sheets.js";
import { fileBrowser } from "../words.js";
import { openFromSide, statusOf, statusColour } from "./live.js";
import { ratesFrom } from "./rates.js";
import { factsOf } from "../../shared/batteries.js";
import { whoopCards, flightsNewestFirst } from "../../shared/garage.js";
import { sayingsOf, median } from "../../shared/flight.js";
import { types as rateTypeWords, shown, rateAt, settingNames } from "../../shared/rates.js";

/** What the Garage's pages hold while the app is open: a log read and not yet kept, with the
 *  pilot's answers so far, and the flight open, with its tab. */
const kept = {
  reading: null,
  answers: [],
  /** The names of whoops new to the Garage in the log being read, by their flight controller's
   *  number: two power-ups of one new whoop are one whoop. */
  newNames: {},
  busy: null,
  problem: null,
  flight: null,
  tab: "overview",
};

// ---- Small things shared by the pages

const garageNow = () => app.state.garage ?? { whoops: {}, logs: {}, flights: {} };
const packsNow = () => app.state.batteries?.packs ?? {};
const packName = (id) => (id ? packsNow()[id]?.name ?? "?" : null);
const whoopName = (id) => garageNow().whoops[id]?.name ?? "A whoop";
const mmss = (seconds) => {
  if (!Number.isFinite(seconds)) return "–";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
const volts = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} V` : "–");
const levelColour = { warn: "var(--warn)", note: "var(--accent)", good: "var(--good)" };
const dot = (level) => h("span.garage-dot", { style: { background: levelColour[level] ?? "var(--faint)" } });
const flightName = (flight) => flight.what || "Flight";

/** The packs to choose from: by their numbers, retired ones only when already chosen. */
function packOptions(selected) {
  const packs = Object.values(packsNow()).filter((pack) => !pack.retired || pack.id === selected)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  return [h("option", { value: "", selected: !selected }, "Which pack?"), ...packs.map((pack) => h("option", { value: pack.id, selected: pack.id === selected }, pack.name))];
}

/** A small line of throttle across an arm. */
function spark(values, width = 160, height = 30) {
  if (!values?.length) return h("span.garage-spark");
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (Math.min(100, Math.max(0, v)) / 100) * (height - 4)).toFixed(1)}`).join(" ");
  return h("span.garage-spark", { html: `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points}" style="fill: none; stroke: var(--accent); stroke-width: 1.4"/></svg>` });
}

/**
 * A chart, drawn as SVG: lines of points in their own units across `x` and up `y`, with ticks
 * along the bottom and up the side. A line with `right` is against the right-hand scale.
 */
function chart({ width = 720, height = 240, x, y, right = null, lines, xTicks = [], yTicks = [], rightTicks = [], guides = [] }) {
  const left = 46, rightPad = right ? 46 : 14, top = 12, bottom = 28;
  const across = width - left - rightPad, down = height - top - bottom;
  const px = (v) => left + ((v - x[0]) / (x[1] - x[0])) * across;
  const py = (v, scale = y) => top + down - ((Math.min(scale[1], Math.max(scale[0], v)) - scale[0]) / (scale[1] - scale[0])) * down;
  let svg = "";
  for (const tick of yTicks) svg += `<line x1="${left}" x2="${width - rightPad}" y1="${py(tick.at)}" y2="${py(tick.at)}" style="stroke: var(--stroke)"/><text x="${left - 8}" y="${py(tick.at) + 4}" text-anchor="end">${tick.label}</text>`;
  for (const tick of rightTicks) svg += `<text x="${width - rightPad + 8}" y="${py(tick.at, right) + 4}" text-anchor="start">${tick.label}</text>`;
  for (const tick of xTicks) svg += `<line x1="${px(tick.at)}" x2="${px(tick.at)}" y1="${top}" y2="${top + down}" style="stroke: var(--stroke)"/><text x="${px(tick.at)}" y="${height - 9}" text-anchor="middle">${tick.label}</text>`;
  for (const guide of guides) svg += `<line x1="${left}" x2="${width - rightPad}" y1="${py(guide.at)}" y2="${py(guide.at)}" style="stroke: ${guide.colour}; stroke-dasharray: 4 4; opacity: 0.7"/>`;
  for (const line of lines) {
    const scale = line.right ? right : y;
    const points = line.points.filter(([px0, py0]) => Number.isFinite(px0) && Number.isFinite(py0) && px0 >= x[0] && px0 <= x[1]);
    if (points.length < 2) continue;
    const d = points.map(([vx, vy], i) => `${i ? "L" : "M"}${px(vx).toFixed(1)} ${py(vy, scale).toFixed(1)}`).join("");
    svg += `<path d="${d}" style="stroke: ${line.colour}; ${line.dash ? "stroke-dasharray: 5 4;" : ""} opacity: ${line.opacity ?? 1}"/>`;
  }
  return h("div.garage-plot", { style: { aspectRatio: `${width} / ${height}` }, html: `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${svg}</svg>` });
}

const ticksEvery = (from, to, step, label = (v) => String(v)) => {
  const out = [];
  for (let v = Math.ceil(from / step) * step; v <= to + 1e-9; v += step) out.push({ at: v, label: label(Math.round(v * 100) / 100) });
  return out;
};
const niceStep = (span, wanted = 6) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((step) => span / step <= wanted) ?? 1000;

/** The key under a chart: a coloured line and its name for each. */
const keyOf = (items) => h("div.garage-key", items.map(([colour, words, dash]) => h("span.garage-key-item", h("span.garage-key-line", { style: { background: dash ? "none" : colour, borderTop: dash ? `2px dashed ${colour}` : "none" } }), words)));

/** A figure with its name over it and a few words under it. */
const tile = (title, value, detail = null, level = null) => h("div.garage-tile", h("span.label", title), h("span.garage-tile-value", level && dot(level), value), detail && h("span.small.dim", detail));

// ---- Opening a log

/** Reads a log the pilot chose, then asks which whoop and pack each power-up was. */
export async function openLog(path) {
  if (!path) return;
  kept.busy = `Reading ${path.split(/[\\/]/).pop()}…`;
  kept.problem = null;
  render();
  const reading = await ask("readBlackbox", path);
  kept.busy = null;
  if (!reading || reading.problem) {
    kept.problem = reading?.problem ?? "It couldn't be read.";
    // Said on the Garage's own page, wherever the log was opened from.
    if (app.page.name !== "garage" && app.page.name !== "garageread") go({ name: "garage" });
    return render();
  }
  kept.reading = reading;
  // A whoop already in the Garage is known by its flight controller's number; any other is new,
  // named for its craft name, until the pilot says otherwise.
  kept.newNames = {};
  kept.answers = reading.powerUps.map((part, number) => {
    const key = newKey(part, number);
    if (!part.match && !(key in kept.newNames)) kept.newNames[key] = part.suggestedName;
    return {
      whoop: part.match ?? `new:${key}`, pack: part.pack ?? "", what: "",
      keep: new Set(part.arms.filter((arm) => arm.keep).map((arm) => arm.index)),
    };
  });
  open({ name: "garageread" });
}

const chooseLog = async () => openLog(await ask("chooseBlackbox"));

/** How a whoop new to the Garage is known within one log: by its flight controller's number, or by
 *  its power-up when its log doesn't say. */
const newKey = (part, number) => part.whoop?.uid ?? `power-up ${number + 1}`;

/** Dropping a log anywhere on the Garage's pages opens it. */
const droppable = (element) => {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("dropping");
  });
  element.addEventListener("dragleave", () => element.classList.remove("dropping"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("dropping");
    const file = event.dataTransfer?.files?.[0];
    if (file) openLog(window.hangar.pathOf(file));
  });
  return element;
};

// ---- The Garage

function flightRows(flights, { showWhoop = true } = {}) {
  if (flights.length === 0) return h("p.dim", "No flights yet.");
  return h("div.garage-table-wrap", h("table.garage-table",
    h("thead", h("tr", h("th", "SAVED"), h("th", "WHAT"), showWhoop && h("th", "WHOOP"), h("th", "PACK"), h("th.right", "IN THE AIR"), h("th.right", "LOWEST"), h("th.right", "BUZZ"), h("th", "WHAT IT SAYS"))),
    h("tbody", flights.map((flight) => {
      const s = flight.summary ?? {};
      return h("tr", { tabIndex: 0, probe: `garage flight ${flight.id}`, onclick: () => openFlight(flight.id), onkeydown: (event) => { if (event.key === "Enter") openFlight(flight.id); } },
        h("td.dim", flight.savedAt ? new Date(flight.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "–"),
        h("td", flightName(flight), h("span.faint", ` · arm ${flight.index + 1}`)),
        showWhoop && h("td", whoopName(flight.whoop)),
        h("td.num", packName(flight.pack) ?? h("span.faint", "–")),
        h("td.num.right", mmss(s.flyingSeconds)),
        h("td.num.right", { style: { color: s.lowest != null && s.lowest < 3.2 ? "var(--warn)" : null } }, volts(s.lowest)),
        h("td.num.right", s.buzz != null ? `${s.buzz}%` : "–"),
        h("td.garage-says", dot(s.level), s.headline));
    }))));
}

export function garagePage() {
  const garage = garageNow();
  const cards = whoopCards(garage);
  const flights = flightsNewestFirst(garage).slice(0, 40);
  const empty = flights.length === 0;
  return droppable(h("div.scroll.garage-drop", { "data-scroll": "page" }, h("div.plain-page.garage",
    h("header.page-head",
      h("div.grow", label("WHOOPS"), h("h1.head-title", "Whoop Garage")),
      primary("Open a log…", chooseLog, { icon: "folderPlus", probe: "garage open" })),
    h("p.dim.rates-intro", "Every flight from your whoops' blackbox logs, with the whoop and the pack it was flown on: the throttle and the pack's sag, the noise and the tune, and how much of the rates you use. After a heat or a practice, save the blackbox in Betaflight and open the file here, or drop it on this page."),
    kept.busy && h("p.small.accent", { probe: "garage busy" }, kept.busy),
    kept.problem && h("p.small.warn", { probe: "garage problem" }, kept.problem),
    empty ? h("section.card.garage-start", { "aria-label": "How it works" },
      label("AFTER A HEAT"),
      h("ol.font-steps",
        h("li", "Plug the whoop in, open Betaflight and connect, and go to the Blackbox tab."),
        h("li", "Press Save flash to file. It goes in your Downloads."),
        h("li", "Open it here, or drop it on this page. Say which whoop and which pack each power-up was, and keep the flights."),
        h("li", "Back in Betaflight, Erase flash, so the next log holds only new flights.")),
      h("div.row.tight", primary("Open a log…", chooseLog, { icon: "folderPlus" }), secondary("Open Betaflight", () => openFromSide("betaflight"), { icon: "chip" })))
      : [
        h("div.garage-whoops", cards.map((card) => h("button.card.garage-whoop", { type: "button", probe: `garage whoop ${card.id}`, onclick: () => open({ name: "garagewhoop", whoop: card.id }) },
          h("span.garage-whoop-head", icon("quad", 18, { class: "accent" }), h("span.garage-whoop-name", card.name)),
          h("span.small.dim", [card.board?.replace(/^\S+\s+/, ""), card.firmware?.replace(/\s*\(.*$/, "")].filter(Boolean).join(" · ")),
          h("span.garage-whoop-facts",
            h("span", h("span.label", "FLIGHTS"), h("strong", String(card.flights))),
            h("span", h("span.label", "IN THE AIR"), h("strong", mmss(card.flyingSeconds))),
            h("span", h("span.label", "LAST PACK"), h("strong", packName(card.latest?.pack) ?? "–"))),
          card.latest && h("span.garage-says.small", dot(card.latest.summary?.level), card.latest.summary?.headline ?? "")))),
        h("section.card.garage-card", { "aria-label": "Recent flights" }, label("RECENT FLIGHTS"), flightRows(flights)),
      ],
  )));
}

// ---- Reading a log: which whoop and which pack

export function readPage() {
  const reading = kept.reading;
  if (!reading) {
    go({ name: "garage" });
    return garagePage();
  }
  const whoops = Object.values(garageNow().whoops);
  const count = kept.answers.reduce((sum, answer) => sum + answer.keep.size, 0);
  const keep = async () => {
    const answers = kept.answers.map((answer) => {
      const fresh = answer.whoop.startsWith("new:") ? answer.whoop.slice(4) : null;
      return { ...answer, whoop: fresh === null ? answer.whoop : "new", name: fresh === null ? "" : kept.newNames[fresh] ?? "", keep: [...answer.keep] };
    });
    const result = await ask("keepBlackbox", reading.id, answers);
    if (!result || result.problem) {
      kept.problem = result?.problem ?? "They couldn't be kept.";
      return render();
    }
    app.state.garage = result.garage;
    kept.reading = null;
    kept.problem = null;
    go({ name: "garage" });
    render();
  };
  return droppable(h("div.scroll", { "data-scroll": "page" }, h("div.plain-page.garage",
    h("div", secondary("Whoop Garage", () => { kept.reading = null; go({ name: "garage" }); render(); }, { icon: "chevronLeft", probe: "garage back" })),
    h("header.page-head",
      h("div.grow", label(`${reading.name.toUpperCase()} · ${(reading.size / 1048576).toFixed(1)} MB · READ IN ${reading.seconds} S`), h("h1.head-title", "Which whoop, which pack?"))),
    reading.already && h("div.card-note", icon("warning", 14), h("span", "This log is in the Garage already. Keeping it again puts these answers in place of the ones it was kept with.")),
    kept.problem && h("p.small.warn", { probe: "garage problem" }, kept.problem),
    h("datalist", { id: "garage-what" }, ["Practice", "Heat 1", "Heat 2", "Heat 3", "Heat 4", "Qualifying", "Final"].map((word) => h("option", { value: word }))),
    reading.powerUps.map((part, number) => {
      const answer = kept.answers[number];
      const set = (key) => (event) => { answer[key] = event.target.value; render(); };
      return h("section.card.garage-card", { "aria-label": `Power-up ${number + 1}`, probe: `garage powerup ${number}` },
        h("div.garage-part-head",
          h("span.garage-part-title", reading.powerUps.length > 1 ? `Power-up ${number + 1}` : "One power-up"),
          h("span.small.dim", [`${part.arms.length} arm${part.arms.length === 1 ? "" : "s"}`, `${mmss(part.flyingSeconds)} in the air`, part.startVolts && `${volts(part.startVolts)} at the start`, part.firmware?.replace(/\s*\(.*$/, "")].filter(Boolean).join(" · "))),
        h("div.garage-answers",
          h("label.garage-answer", h("span.question", "Whoop"),
            h("select.field", { probe: `garage whoop ${number}`, onchange: set("whoop") },
              whoops.map((whoop) => h("option", { value: whoop.id, selected: answer.whoop === whoop.id }, whoop.name)),
              Object.entries(kept.newNames).map(([key, name]) => h("option", { value: `new:${key}`, selected: answer.whoop === `new:${key}` }, `${name || "A whoop"} (new)`)))),
          answer.whoop.startsWith("new:") && h("label.garage-answer", h("span.question", "Its name"),
            h("input.field", { type: "text", value: kept.newNames[answer.whoop.slice(4)] ?? "", key: `garage name ${number}`, probe: `garage name ${number}`, spellcheck: false,
              oninput: (event) => { kept.newNames[answer.whoop.slice(4)] = event.target.value; },
              onchange: () => render() })),
          h("label.garage-answer", h("span.question", "Pack"),
            h("select.field", { probe: `garage pack ${number}`, onchange: set("pack") }, packOptions(answer.pack))),
          h("label.garage-answer.wide", h("span.question", "What it was"),
            h("input.field", { type: "text", value: answer.what, list: "garage-what", placeholder: "Practice, Heat 2…", key: `garage what ${number}`, probe: `garage what ${number}`, spellcheck: false, oninput: (event) => { answer.what = event.target.value; } }))),
        h("div.garage-arms", part.arms.map((arm) => {
          const s = arm.summary ?? {};
          const on = answer.keep.has(arm.index);
          return h(`label.garage-arm${on ? "" : ".off"}`, { probe: `garage arm ${arm.index}` },
            h("input", { type: "checkbox", checked: on, disabled: !arm.usable, onchange: (event) => { if (event.target.checked) answer.keep.add(arm.index); else answer.keep.delete(arm.index); render(); } }),
            h("span.garage-arm-name", `Arm ${arm.index + 1}`, h("span.small.dim", arm.usable ? `${mmss(s.flyingSeconds)} in the air` : "nothing logged")),
            spark(arm.spark),
            h("span.num.small", arm.usable ? `lowest ${volts(s.lowest)}` : ""),
            h("span.garage-says.small", arm.usable && dot(s.level), arm.usable ? s.headline : ""));
        })));
    }),
    h("div.row.tight",
      primary(count === 0 ? "Keep none" : count === 1 ? "Keep 1 flight" : `Keep ${count} flights`, keep, { disabled: count === 0, probe: "garage keep" }),
      secondary("Cancel", () => { kept.reading = null; go({ name: "garage" }); render(); })),
    h("p.small.dim", "Short arms, a hop on the bench or a crash at take-off, are left unticked. Once these are kept, erase the flash in Betaflight's Blackbox tab, so the next log holds only new flights."),
  )));
}

// ---- One flight

/** Reads what was worked out from a kept flight, for its page. */
async function loadFlight(id) {
  kept.flight = { id, data: null, problem: null };
  const data = await ask("garageFlight", id);
  if (kept.flight?.id !== id) return;
  kept.flight = { id, data: data?.problem ? null : data, problem: data?.problem ?? null };
  render();
}

/** Opens a kept flight's page, on one of its tabs when it is named. */
export async function openFlight(id, tab = null) {
  if (tab && tabs.some(([one]) => one === tab)) kept.tab = tab;
  open({ name: "garageflight", flight: id });
  render();
  await loadFlight(id);
}

const tabs = [["overview", "Overview"], ["tune", "Tune"], ["rates", "Rates"], ["battery", "Battery"]];

function overviewTab(f, facts) {
  const says = sayingsOf(f);
  const buzz = median(f.motors?.hfNoisePct ?? []);
  const series = f.series ?? {};
  const length = (series.throttle?.length ?? 0) * (series.step ?? 0.25);
  const lowV = Math.min(3.2, ...(series.volts ?? []).filter(Number.isFinite));
  const highV = Math.max(4.25, ...(series.volts ?? []).filter(Number.isFinite));
  const vRange = [Math.floor(lowV * 10) / 10, Math.ceil(highV * 10) / 10];
  return [
    h("div.garage-tiles",
      tile("IN THE AIR", mmss(f.flyingSeconds), `of ${mmss(f.seconds)} armed`),
      tile("THROTTLE", f.throttle ? `${f.throttle.p50}%` : "–", f.throttle ? `most of it ${f.throttle.p10}–${f.throttle.p90}%` : null),
      tile("LOWEST", volts(f.battery?.minUnderLoad), f.battery ? `from ${volts(f.battery.beforeArm)}, ${volts(f.battery.atDisarm)} at the end` : null, f.battery?.minUnderLoad < 3.2 ? "warn" : null),
      tile("MOTOR BUZZ", Number.isFinite(buzz) ? `${buzz.toFixed(1)}%` : "–", "jitter above 100 Hz", Number.isFinite(buzz) ? (buzz >= 6 ? "warn" : buzz >= 4 ? "note" : "good") : null),
      tile("OVERSHOOT", f.step?.roll ? `${Math.max(0, Math.round((f.step.roll.peak - 1) * 100))}%` : "–", f.step?.pitch ? `roll; pitch ${Math.max(0, Math.round((f.step.pitch.peak - 1) * 100))}%` : "roll"),
      tile("YAW USED", f.rates?.axes?.yaw?.topUsedPct != null ? `${f.rates.axes.yaw.topUsedPct}%` : "–", f.rates?.axes?.yaw ? `of ${f.rates.axes.yaw.topDps} °/s` : null)),
    h("section.card.garage-card", { "aria-label": "What it says" }, label("WHAT IT SAYS"),
      h("ul.garage-sayings", says.map((one) => h("li", dot(one.level), h("span", one.text))))),
    series.throttle && h("section.card.garage-card", { "aria-label": "Throttle and the pack" },
      h("div.rates-card-head", label("THROTTLE AND THE PACK"), h("span.spacer"), keyOf([["var(--accent)", "Throttle"], ["var(--drop)", "Pack voltage"]])),
      chart({
        x: [0, Math.max(1, length)], y: [0, 100], right: series.volts ? vRange : null,
        xTicks: ticksEvery(0, length, niceStep(length, 8), (v) => `${v} s`), yTicks: ticksEvery(0, 100, 25, (v) => `${v}%`),
        rightTicks: series.volts ? ticksEvery(vRange[0], vRange[1], 0.2, (v) => `${v.toFixed(1)} V`) : [],
        lines: [
          { points: series.throttle.map((v, i) => [i * series.step, v]), colour: "var(--accent)" },
          series.volts && { points: series.volts.map((v, i) => [i * series.step, v]), colour: "var(--drop)", right: true },
        ].filter(Boolean),
      })),
    h("p.small.dim", [facts?.firmware, facts?.board, f.logHz && `logged ${f.logHz} times a second`].filter(Boolean).join(" · ")),
  ];
}

function tuneTab(f, facts) {
  const spectrum = f.charts?.spectrum;
  const step = f.charts?.step;
  const motors = f.motors ?? {};
  const lineOf = (line) => line.values.map((v, i) => [i * line.hzStep, v]);
  // From 20 Hz up: below that is the whoop being flown about, not noise.
  const top = spectrum ? Math.max(1, ...[spectrum.unfiltered, spectrum.filtered].filter(Boolean).flatMap((line) => line.values.filter((_, i) => i * line.hzStep >= 20))) : 1;
  const stepLength = step?.roll?.length ?? step?.pitch?.length ?? 0;
  const stepMs = stepLength * (step?.ms ?? 1);
  const filters = facts ? [
    ["PIDs", ["roll", "pitch", "yaw"].map((axis) => `${axis} ${facts.pids?.[axis] ?? "–"}`).join(" · ")],
    ["Gyro filters", [facts.gyroLpf1 && `LPF1 ${facts.gyroLpf1}`, facts.gyroLpf2 && `LPF2 ${facts.gyroLpf2}`].filter(Boolean).join(" · ") || "–"],
    ["D-term filters", [facts.dtermLpf1 && `LPF1 ${facts.dtermLpf1}`, facts.dtermLpf2 && `LPF2 ${facts.dtermLpf2}`].filter(Boolean).join(" · ") || "–"],
    ["Notches", [facts.dynNotch && `dynamic: ${facts.dynNotch}`, facts.rpmFilter && `RPM filter: ${facts.rpmFilter}`].filter(Boolean).join(" · ") || "–"],
    ["Sliders", Object.entries(facts.simplified ?? {}).filter(([key]) => /multiplier|gain|weight/.test(key)).map(([key, value]) => `${key.replace("simplified_", "").replace(/_/g, " ")} ${value}`).join(" · ") || "–"],
  ] : [];
  return [
    h("div.garage-tiles",
      tile("MOTOR BUZZ", (motors.hfNoisePct ?? []).length ? `${median(motors.hfNoisePct).toFixed(1)}%` : "–", (motors.hfNoisePct ?? []).length ? `motors 1 to ${motors.hfNoisePct.length}: ${motors.hfNoisePct.map((v) => (Math.round(v * 10) / 10).toFixed(1)).join(" · ")}` : null),
      tile("D TERM ABOVE 100 HZ", f.dterm ? String(f.dterm.rms_100up) : "–", f.dterm ? `${f.dterm.hfShare}% of all the D term` : null),
      tile("GYRO ABOVE 80 HZ", f.spectrum?.filtered ? `${f.spectrum.filtered.rp_rms_80up} °/s` : "–", f.spectrum?.unfiltered ? `${f.spectrum.unfiltered.rp_rms_80up} °/s before the filters` : "after the filters"),
      tile("MOTORS AT FULL", motors.saturatedPct != null ? `${motors.saturatedPct}%` : "–", "of the time in the air", motors.saturatedPct >= 3 ? "warn" : null),
      tile("PROPWASH", f.propwash?.chops ? `${f.propwash.medianDps} °/s` : "–", f.propwash?.chops ? `after ${f.propwash.chops} throttle chops; ${f.propwash.steadyDps ?? "–"} °/s steady` : "no hard throttle chops")),
    spectrum && h("section.card.garage-card", { "aria-label": "Noise" },
      h("div.rates-card-head", label("NOISE, ROLL AND PITCH"), h("span.spacer"), keyOf([["var(--faint)", "Before the filters"], ["var(--accent)", "After"]])),
      chart({
        x: [20, spectrum.nyquist], y: [0, top * 1.1],
        xTicks: ticksEvery(20, spectrum.nyquist, niceStep(spectrum.nyquist, 8), (v) => `${v} Hz`),
        yTicks: ticksEvery(0, top * 1.1, niceStep(top * 1.1, 5), (v) => String(v)),
        lines: [
          spectrum.unfiltered && { points: lineOf(spectrum.unfiltered), colour: "var(--faint)" },
          { points: lineOf(spectrum.filtered), colour: "var(--accent)" },
        ].filter(Boolean),
      }),
      h("p.small.dim", `°/s in each band, from 20 Hz to ${spectrum.nyquist} Hz, the highest this log can see at ${f.logHz} samples a second. ${(f.spectrum?.filtered?.peaks ?? []).length ? `Strongest lines after the filters: ${f.spectrum.filtered.peaks.map((p) => `${p.hz} Hz`).join(", ")}.` : "No line stands out after the filters."}`),
      (f.spectrum?.byMotor ?? []).some((band) => band.peakHz) && h("table.garage-table.small",
        h("thead", h("tr", h("th", "MOTOR OUTPUT"), h("th.right", "MOTORS SPIN AT"), h("th.right", "STRONGEST LINE"))),
        h("tbody", f.spectrum.byMotor.filter((band) => band.segments >= 2).map((band) => h("tr", h("td", band.band), h("td.num.right", band.motorHz ? `${band.motorHz} Hz` : "–"), h("td.num.right", band.peakHz ? `${band.peakHz} Hz` : "–"))))),
      (f.spectrum?.byMotor ?? []).some((band) => band.peakHz) && h("p.small.dim", "A line that moves up as the motors spin faster is the motors or props. One that stays put whatever the motors do is the frame, the flight controller's mount or the canopy.")),
    step && stepLength > 0 && h("section.card.garage-card", { "aria-label": "Step response" },
      h("div.rates-card-head", label("STEP RESPONSE"), h("span.spacer"), keyOf([["var(--accent)", "Roll"], ["var(--drop)", "Pitch"], ["var(--mark)", "Yaw"]])),
      chart({
        x: [0, stepMs], y: [0, 1.6], guides: [{ at: 1, colour: "var(--dim)" }],
        xTicks: ticksEvery(0, stepMs, 50, (v) => `${v} ms`), yTicks: ticksEvery(0, 1.6, 0.4, (v) => v.toFixed(1)),
        lines: [["roll", "var(--accent)"], ["pitch", "var(--drop)"], ["yaw", "var(--mark)"]].filter(([axis]) => step[axis]).map(([axis, colour]) => ({ points: step[axis].map((v, i) => [i * step.ms, v]), colour })),
      }),
      h("p.small.dim", ["roll", "pitch", "yaw"].filter((axis) => f.step?.[axis]).map((axis) => `${axis[0].toUpperCase()}${axis.slice(1)}: peak ${f.step[axis].peak} at ${f.step[axis].peakMs} ms, halfway in ${f.step[axis].latencyMs} ms (${f.step[axis].windows} moves)`).join(". ") + ". A peak over 1 is overshoot. With a lot of motor buzz the peaks can't be trusted.")),
    h("section.card.garage-card", { "aria-label": "Motors" }, label("MOTORS"),
      h("div.garage-motors", (motors.meanPct ?? []).map((value, k) => h("div.garage-motor",
        h("span.label", `MOTOR ${k + 1}`),
        h("div.garage-bar", h("div.garage-bar-fill", { style: { width: `${Math.min(100, value)}%` } })),
        h("span.num.small", `${value}% on average · ${motors.imbalancePct[k] > 0 ? "+" : ""}${motors.imbalancePct[k]}%`)))),
      h("p.small.dim", Math.abs(f.tracking?.yawSpMean ?? 0) >= 10
        ? `The whoop turned one way most of the time (yaw ${f.tracking.yawSpMean} °/s on average), which leans on one diagonal of motors: their difference isn't a fault.`
        : "Each motor's average output, and how far it is from the others'. One working much harder than the rest is a bent prop, a tired motor or weight off centre.")),
    filters.length > 0 && h("section.card.garage-card", { "aria-label": "Tune" }, label("THE TUNE IN THIS LOG"),
      h("dl.garage-facts", filters.map(([title, value]) => [h("dt", title), h("dd", value)]))),
  ];
}

function ratesTab(f, flight) {
  const rates = f.rates;
  if (!rates) return h("p.dim", "No rates in this log.");
  const type = rates.type;
  const axes = ["roll", "pitch", "yaw"];
  const colours = { roll: "var(--accent)", pitch: "var(--drop)", yaw: "var(--mark)" };
  const setting = (axis) => ({ ...rates.axes[axis].setting, limit: rates.axes[axis].limit ?? 1998 });
  const top = Math.max(200, ...axes.map((axis) => rates.axes[axis].topDps ?? 0));
  const lines = axes.flatMap((axis) => [
    { points: Array.from({ length: 51 }, (_, i) => [i * 2, rateAt(type, setting(axis), i / 50)]), colour: colours[axis] },
  ]);
  const used = axes.filter((axis) => rates.axes[axis].rateP99).map((axis) => ({ at: rates.axes[axis].rateP99, colour: colours[axis] }));
  return [
    h("section.card.garage-card", { "aria-label": "Rates used" },
      h("div.rates-card-head", label(`${rateTypeWords[type]?.title?.toUpperCase() ?? type} RATES IN THIS LOG`), h("span.spacer"),
        secondary("Open in Rates", () => {
          ratesFrom({ type, axes: Object.fromEntries(axes.map((axis) => [axis, setting(axis)])) }, `From ${whoopName(flight.whoop)}'s log, ${flightName(flight)}.`);
          openFromSide("rates");
        }, { icon: "curve", probe: "garage open rates" })),
      h("div.garage-table-wrap", h("table.garage-table",
        h("thead", h("tr", h("th"), settingNames.map((name) => h("th.right", (rateTypeWords[type]?.fields?.[name]?.name ?? name).toUpperCase())), h("th.right", "CENTER · TOP"), h("th.right", "TOP USED"), h("th.right", "FULL STICK"))),
        h("tbody", axes.map((axis) => {
          const one = rates.axes[axis];
          return h("tr",
            h("td", h("span.rates-dot", { style: { background: colours[axis] } }), ` ${axis.toUpperCase()}`),
            settingNames.map((name) => h("td.num.right", Number.isFinite(one.setting[name]) ? shown(type, name, one.setting[name]) : "–")),
            h("td.num.right", `${one.centerDps ?? "–"} · ${one.topDps ?? "–"} °/s`),
            h("td.num.right", { style: { color: one.topUsedPct >= 95 ? "var(--warn)" : null } }, one.topUsedPct != null ? `${one.topUsedPct}%` : "–"),
            h("td.num.right", `${one.over90Pct ?? "–"}%`));
        })))),
      chart({
        x: [0, 100], y: [0, Math.ceil(top / 100) * 100], guides: used,
        xTicks: ticksEvery(0, 100, 25, (v) => `${v}%`), yTicks: ticksEvery(0, Math.ceil(top / 100) * 100, niceStep(top, 6), (v) => String(v)),
        lines,
      }),
      h("p.small.dim", "Each axis's curve, °/s against how far the stick is pushed. The dashed line is how fast it actually turned (99 times in 100). A top used near 100%, with the stick at full often, means that axis runs out: raise its max rate.")),
  ];
}

function batteryTab(f, flight) {
  const b = f.battery;
  const pack = flight.pack ? packsNow()[flight.pack] : null;
  const facts = pack ? factsOf(app.state.batteries)[pack.id] : null;
  const status = pack ? statusOf(pack, factsOf(app.state.batteries)) : null;
  const resistance = facts?.latestReading?.resistance ?? facts?.latestCharge?.resistance ?? null;
  const others = flight.pack ? flightsNewestFirst(garageNow(), { pack: flight.pack }) : [];
  const series = f.series ?? {};
  const length = (series.volts?.length ?? 0) * (series.step ?? 0.25);
  const values = (series.volts ?? []).filter(Number.isFinite);
  const range = values.length ? [Math.floor(Math.min(...values) * 10) / 10, Math.ceil(Math.max(...values) * 10) / 10] : [3, 4.4];
  if (!b) return h("p.dim", "This log has no pack voltage.");
  return [
    h("div.garage-tiles",
      tile("BEFORE ARMING", volts(b.beforeArm)),
      tile("FIRST SECOND", volts(b.firstSecondUnderLoad), b.beforeArm && b.firstSecondUnderLoad ? `${(b.beforeArm - b.firstSecondUnderLoad).toFixed(2)} V down as it took off` : null),
      tile("LOWEST", volts(b.minUnderLoad), b.minAtMotorPct != null ? `at ${b.minAt} s, motors at ${b.minAtMotorPct}%` : null, b.minUnderLoad < 3.2 ? "warn" : null),
      tile("AT THE END", volts(b.atDisarm)),
      tile("SAG AT FULL MOTOR", b.sagFullMotorV != null ? `${b.sagFullMotorV.toFixed(2)} V` : "–", b.sagWindows ? `from ${b.sagWindows} stretches of flying` : "not enough steady flying"),
      tile("PUNCH SAG", b.punchSagV != null ? `${b.punchSagV.toFixed(2)} V` : "–", b.punches ? `${b.punches} punch-out${b.punches === 1 ? "" : "s"}, worst ${b.punchSagMaxV?.toFixed(2)} V` : "no punch-outs"),
      b.mah != null && tile("USED", `${b.mah} mAh`, "by the whoop's own current sensor, which isn't calibrated: compare flights on this whoop only")),
    series.volts && h("section.card.garage-card", { "aria-label": "Pack voltage" }, label("PACK VOLTAGE"),
      chart({
        x: [0, Math.max(1, length)], y: range,
        xTicks: ticksEvery(0, length, niceStep(length, 8), (v) => `${v} s`), yTicks: ticksEvery(range[0], range[1], 0.2, (v) => `${v.toFixed(1)} V`),
        lines: [{ points: series.volts.map((v, i) => [i * series.step, v]), colour: "var(--drop)" }],
      })),
    h("section.card.garage-card", { "aria-label": "The pack" },
      h("div.rates-card-head", label(pack ? `PACK ${pack.name}` : "WHICH PACK?"), h("span.spacer"), pack && secondary("Open Batteries", () => openFromSide("batteryTester"), { icon: "battery" })),
      pack
        ? h("p", status?.word ? h("strong", { style: { color: statusColour[status.word] } }, status.text) : h("span.dim", "Not graded yet"),
          h("span.dim", ` · ${pack.mah} mAh${pack.brand ? ` ${pack.brand}` : ""}${resistance != null ? ` · ${Math.round(resistance)} mΩ charging on the WhoopStor` : ""}`))
        : h("p.dim", "Say which pack this was, at the top of the page, to set it beside its charges on the WhoopStor and its other flights."),
      others.length > 1 && h("div.garage-table-wrap", h("table.garage-table",
        h("thead", h("tr", h("th", "SAVED"), h("th", "WHOOP"), h("th", "WHAT"), h("th.right", "IN THE AIR"), h("th.right", "BEFORE"), h("th.right", "LOWEST"), h("th.right", "AT THE END"))),
        h("tbody", others.slice(0, 12).map((one) => h(`tr${one.id === flight.id ? ".here" : ""}`, { tabIndex: 0, onclick: () => openFlight(one.id) },
          h("td.dim", one.savedAt ? new Date(one.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "–"),
          h("td", whoopName(one.whoop)), h("td", `${flightName(one)} · arm ${one.index + 1}`),
          h("td.num.right", mmss(one.summary?.flyingSeconds)), h("td.num.right", volts(one.summary?.beforeArm)),
          h("td.num.right", volts(one.summary?.lowest)), h("td.num.right", volts(one.summary?.atDisarm))))))),
      h("p.small.dim", "The sag in the air tells whoops apart more than packs: compare a pack's flights on the same whoop, and its charging resistance on the WhoopStor.")),
  ];
}

export function flightPage() {
  const id = app.page.flight;
  const flight = garageNow().flights[id];
  if (!flight) {
    go({ name: "garage" });
    return garagePage();
  }
  if (kept.flight?.id !== id) loadFlight(id);
  const data = kept.flight?.id === id ? kept.flight.data : null;
  const f = data?.flight;
  const whoopId = flight.whoop;
  const change = async (changes) => {
    const answer = await ask("changeGarageFlight", id, changes);
    if (answer?.garage) app.state.garage = answer.garage;
    render();
  };
  const remove = async () => {
    if (!(await confirm({ title: "Take this flight out of the Garage?", message: "What was worked out from it goes. Once no flight of its log is left, the log goes to the Trash.", yes: "Take it out", destructive: true }))) return;
    const answer = await ask("forgetGarageFlight", id);
    if (answer?.garage) app.state.garage = answer.garage;
    kept.flight = null;
    go({ name: "garage" });
    render();
  };
  return h("div.scroll", { "data-scroll": "page" }, h("div.plain-page.garage",
    h("div.row.tight",
      secondary("Whoop Garage", () => { go({ name: "garage" }); render(); }, { icon: "chevronLeft", probe: "garage back" }),
      plain(whoopName(whoopId), () => open({ name: "garagewhoop", whoop: whoopId }), { class: "quiet" })),
    h("header.page-head",
      h("div.grow", label([whoopName(whoopId), flight.savedAt && `SAVED ${when(flight.savedAt)}`].filter(Boolean).join(" · ").toUpperCase()), h("h1.head-title", `${flightName(flight)}, arm ${flight.index + 1}`)),
      h("label.garage-answer.inline", h("span.question", "Pack"), h("select.field", { probe: "garage flight pack", onchange: (event) => change({ pack: event.target.value }) }, packOptions(flight.pack))),
      secondary(`Show the log in ${fileBrowser}`, () => ask("showGarageLog", id), { icon: "folderPlus", help: "To open it in Betaflight's Blackbox Explorer" }),
      plain("Take out", remove, { class: "quiet", probe: "garage forget" })),
    h("div.rates-types", { role: "tablist" }, tabs.map(([tab, title]) => h(`button.choice${kept.tab === tab ? ".picked" : ""}`, {
      type: "button", role: "tab", "aria-selected": String(kept.tab === tab), probe: `garage tab ${tab}`, onclick: () => { kept.tab = tab; render(); },
    }, title))),
    kept.flight?.problem && h("p.small.warn", kept.flight.problem),
    !data && !kept.flight?.problem && h("p.dim", "Reading…"),
    f && (f.tooShort || f.missing) && h("p.dim", "This arm is too short to say anything."),
    f && !f.tooShort && !f.missing && (kept.tab === "tune" ? tuneTab(f, data.facts) : kept.tab === "rates" ? ratesTab(f, flight) : kept.tab === "battery" ? batteryTab(f, flight) : overviewTab(f, data.facts)),
  ));
}

// ---- One whoop

export function whoopPage() {
  const id = app.page.whoop;
  const whoop = garageNow().whoops[id];
  if (!whoop) {
    go({ name: "garage" });
    return garagePage();
  }
  const flights = flightsNewestFirst(garageNow(), { whoop: id });
  const seconds = flights.reduce((sum, one) => sum + (one.summary?.flyingSeconds ?? 0), 0);
  const packs = new Set(flights.map((one) => one.pack).filter(Boolean));
  const rename = async () => {
    const answer = await question({ title: "Rename this whoop", field: { value: whoop.name }, buttons: [{ title: "Cancel", value: false, kind: "secondary", cancel: true }, { title: "Rename", value: true, default: true }] });
    if (!answer?.value) return;
    const result = await ask("renameGarageWhoop", id, answer.text);
    if (result?.problem) app.notice = result.problem;
    if (result?.garage) app.state.garage = result.garage;
    render();
  };
  return h("div.scroll", { "data-scroll": "page" }, h("div.plain-page.garage",
    h("div", secondary("Whoop Garage", () => { go({ name: "garage" }); render(); }, { icon: "chevronLeft", probe: "garage back" })),
    h("header.page-head",
      h("div.grow", label([whoop.board, whoop.firmware?.replace(/\s*\(.*$/, "")].filter(Boolean).join(" · ").toUpperCase() || "WHOOP"), h("h1.head-title", whoop.name)),
      secondary("Rename…", rename, { probe: "garage rename" })),
    h("div.garage-tiles",
      tile("FLIGHTS", String(flights.length)),
      tile("IN THE AIR", mmss(seconds)),
      tile("PACKS FLOWN", String(packs.size)),
      tile("FLIGHT CONTROLLER", whoop.uid ? `…${whoop.uid.slice(-6)}` : "–", "its own number, how its logs are known")),
    h("section.card.garage-card", { "aria-label": "Flights" }, label("FLIGHTS"), flightRows(flights, { showWhoop: false })),
  ));
}
