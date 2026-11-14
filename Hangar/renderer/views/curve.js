// A pack's charge or cycle test as a graph: its voltage over the time, with the current under it on
// a scale of its own, from the curve kept with the test ([seconds, millivolts, milliamps], shared/
// whoopstor.js's curvePoint). A cycle test's charge and down steps are marked, with what went in and
// came out; pointing at the graph, or the arrow keys once it is picked, gives the readings at that
// moment. And a little line of a port's voltage for its tile on the Batteries page.

import { h } from "../ui.js";

const W = 860, LEFT = 50, RIGHT = 14, TOP = 24, VOLTS_H = 150, GAP = 18, AMPS_H = 64, BOTTOM = 24;
const H = TOP + VOLTS_H + GAP + AMPS_H + BOTTOM;
const AMPS_TOP = TOP + VOLTS_H + GAP;

const minutesWords = (seconds) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
};
const clockWords = (seconds) => {
  const s = Math.round(seconds), hours = Math.floor(s / 3600), minutes = Math.floor((s % 3600) / 60), secs = s % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
};

/** Ticks from `lo` to `hi` at a round step, `most` of them at most. */
function ticks(lo, hi, steps, most = 6) {
  const step = steps.find((one) => (hi - lo) / one <= most) ?? steps.at(-1);
  const out = [];
  for (let value = Math.ceil(lo / step - 1e-9) * step; value <= hi + 1e-9; value += step) out.push(Math.round(value * 1000) / 1000);
  return out;
}

/** The line through the points, broken where readings are missing (the USB was out). */
function pathOf(points, x, y, value) {
  const spacing = points.slice(1).map((point, index) => point[0] - points[index][0]).sort((a, b) => a - b);
  const usual = spacing[Math.floor(spacing.length / 2)] || 10;
  return points.map((point, index) => {
    const broken = index === 0 || point[0] - points[index - 1][0] > 3 * usual + 5;
    return `${broken ? "M" : "L"}${x(point[0]).toFixed(1)},${y(value(point)).toFixed(1)}`;
  }).join("");
}

/** What a cycle test was doing at a moment: its step, or a rest. */
function stepAt(test, seconds) {
  if (test.kind !== "cycle") return test.kind === "charge" ? "Charging" : "";
  const step = (test.steps ?? []).find((one) => typeof one.fromS === "number" && seconds >= one.fromS && seconds <= one.toS);
  return step ? (step.kind === "charge" ? "Charging" : "Going down on the load") : "Resting";
}

/** The graph of a test with a curve, or null. */
export function curveChart(test) {
  const points = test.curve ?? [];
  if (points.length < 2) return null;
  const tMax = Math.max(points.at(-1)[0], 60);
  const volts = points.map(([, mv]) => mv / 1000), amps = points.map(([, , ma]) => ma / 1000);
  const v0 = Math.floor((Math.min(...volts) - 0.02) * 20) / 20, v1 = Math.ceil((Math.max(...volts) + 0.02) * 20) / 20;
  const a0 = Math.min(0, Math.floor(Math.min(...amps) * 10) / 10), a1 = Math.max(0.1, Math.ceil(Math.max(...amps) * 10) / 10);
  const x = (s) => LEFT + (s / tMax) * (W - LEFT - RIGHT);
  const yv = (v) => TOP + (1 - (v - v0) / (v1 - v0)) * VOLTS_H;
  const ya = (a) => AMPS_TOP + (1 - (a - a0) / (a1 - a0)) * AMPS_H;
  const parts = [];

  // A cycle test's steps, as quiet bands with what each did.
  for (const step of test.kind === "cycle" ? test.steps ?? [] : []) {
    if (typeof step.fromS !== "number" || typeof step.toS !== "number") continue;
    const from = x(step.fromS), to = x(Math.min(step.toS, tMax)), wide = to - from;
    parts.push(`<rect x="${from.toFixed(1)}" y="${TOP}" width="${Math.max(0, wide).toFixed(1)}" height="${AMPS_TOP + AMPS_H - TOP}" class="curve-band"/>`);
    const amount = step.kind === "charge" ? `${Math.round(step.mah)} in` : `~${Math.round(step.mah)} out`;
    const words = wide >= 96 ? `${step.kind === "charge" ? "Charge" : "Down"} · ${amount}` : wide >= 40 ? (step.kind === "charge" ? "Charge" : "Down") : "";
    if (words) parts.push(`<text x="${(from + 5).toFixed(1)}" y="${TOP - 8}" class="curve-step">${words}</text>`);
  }
  // Grid and scales: volts, then amps with 0 marked.
  for (const v of ticks(v0, v1, [0.05, 0.1, 0.2, 0.5])) parts.push(`<line x1="${LEFT}" x2="${W - RIGHT}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" class="chart-grid"/><text x="${LEFT - 6}" y="${(yv(v) + 3.5).toFixed(1)}" class="chart-axis" text-anchor="end">${v.toFixed(2)} V</text>`);
  for (const a of ticks(a0, a1, [0.1, 0.2, 0.5, 1], 3)) parts.push(`<line x1="${LEFT}" x2="${W - RIGHT}" y1="${ya(a).toFixed(1)}" y2="${ya(a).toFixed(1)}" class="${a === 0 ? "curve-zero" : "chart-grid"}"/><text x="${LEFT - 6}" y="${(ya(a) + 3.5).toFixed(1)}" class="chart-axis" text-anchor="end">${a.toFixed(1)} A</text>`);
  for (const s of ticks(0, tMax, [300, 600, 900, 1800, 3600, 7200])) parts.push(`<text x="${x(s).toFixed(1)}" y="${H - 6}" class="chart-axis" text-anchor="middle">${s === 0 ? "0" : minutesWords(s)}</text>`);
  // The two lines.
  parts.push(`<path d="${pathOf(points, x, yv, ([, mv]) => mv / 1000)}" class="curve-volts"/>`);
  parts.push(`<path d="${pathOf(points, x, ya, ([, , ma]) => ma / 1000)}" class="curve-amps"/>`);
  // What pointing at it shows.
  parts.push(`<line class="curve-cross" y1="${TOP}" y2="${AMPS_TOP + AMPS_H}" x1="0" x2="0" visibility="hidden"/>`);
  parts.push(`<circle class="curve-dot volts" r="4" visibility="hidden"/><circle class="curve-dot amps" r="4" visibility="hidden"/>`);
  parts.push(`<rect class="curve-hit" x="${LEFT}" y="${TOP}" width="${W - LEFT - RIGHT}" height="${AMPS_TOP + AMPS_H - TOP}"/>`);

  const tip = h("div.curve-tip", { "aria-hidden": "true" });
  const going = amps.some((a) => a < 0);
  const holder = h("div.curve-chart", {
    tabindex: "0", role: "img",
    "aria-label": `${test.kind === "cycle" ? "Cycle test" : "Charge"}: voltage from ${volts[0].toFixed(2)} V to ${volts.at(-1).toFixed(2)} V over ${minutesWords(points.at(-1)[0])}, between ${Math.min(...volts).toFixed(2)} and ${Math.max(...volts).toFixed(2)} V. The arrow keys step through the readings.`,
  }, h("div.curve-svg", { html: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="presentation">${parts.join("")}</svg>` }), tip);
  const below = going && h("p.dim.small.curve-note", "Below 0 A: going down on the charger's own load, worked out from the voltage across it.");

  // The crosshair finds the nearest reading.
  let at = null;
  const svg = holder.querySelector("svg"), cross = svg.querySelector(".curve-cross");
  const dotV = svg.querySelector(".curve-dot.volts"), dotA = svg.querySelector(".curve-dot.amps");
  const show = (index) => {
    at = Math.max(0, Math.min(points.length - 1, index));
    const [s, mv, ma] = points[at], px = x(s);
    for (const [element, y] of [[cross, null], [dotV, yv(mv / 1000)], [dotA, ya(ma / 1000)]]) {
      element.setAttribute("visibility", "visible");
      if (y === null) element.setAttribute("x1", px), element.setAttribute("x2", px);
      else element.setAttribute("cx", px), element.setAttribute("cy", y);
    }
    tip.replaceChildren(
      h("div.curve-tip-value", `${(mv / 1000).toFixed(3)} V`),
      h("div.curve-tip-value.amps", `${Math.abs(ma / 1000).toFixed(2)} A ${ma < 0 ? "out" : "in"}`),
      h("div.dim", `${clockWords(s)} · ${stepAt(test, s)}`));
    const scale = svg.getBoundingClientRect().width / W;
    const left = px * scale;
    tip.style.visibility = "visible";
    tip.style.left = `${left + 14 + 150 > holder.clientWidth ? left - 14 - tip.offsetWidth : left + 14}px`;
    tip.style.top = `${TOP * scale}px`;
  };
  const hide = () => {
    at = null;
    for (const element of [cross, dotV, dotA]) element.setAttribute("visibility", "hidden");
    tip.style.visibility = "hidden";
  };
  const nearest = (seconds) => {
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < seconds) lo = mid;
      else hi = mid;
    }
    return seconds - points[lo][0] <= points[hi][0] - seconds ? lo : hi;
  };
  svg.querySelector(".curve-hit").addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    show(nearest(((px - LEFT) / (W - LEFT - RIGHT)) * tMax));
  });
  svg.querySelector(".curve-hit").addEventListener("pointerleave", hide);
  holder.addEventListener("blur", hide);
  holder.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 20 : 1;
    if (event.key === "ArrowRight") show((at ?? -1) + step);
    else if (event.key === "ArrowLeft") show((at ?? points.length) - step);
    else if (event.key === "Escape") hide();
    else return;
    event.preventDefault();
  });
  return [holder, below];
}

/** A port's voltage so far, as a little line for its tile: null with too little to draw. */
export function sparkline(points) {
  if (!points || points.length < 2) return null;
  const tMax = Math.max(points.at(-1)[0], 60);
  const volts = points.map(([, mv]) => mv / 1000);
  const lo = Math.min(3.7, ...volts), hi = Math.max(4.4, ...volts);
  const line = points.map(([s, mv], index) => `${index ? "L" : "M"}${((s / tMax) * 100).toFixed(2)},${(2 + (1 - (mv / 1000 - lo) / (hi - lo)) * 20).toFixed(2)}`).join("");
  return h("div.port-spark", { help: `Its voltage over the last ${minutesWords(points.at(-1)[0])}, from ${volts[0].toFixed(2)} V to ${volts.at(-1).toFixed(2)} V`, html: `<svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="24"><path d="${line}"/></svg>` });
}
