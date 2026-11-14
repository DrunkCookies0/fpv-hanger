// Rates: the pilot's rates as curves, the turn they ask for at each point of the stick, and the same
// feel in another of Betaflight's rate types, with the lines to paste into Betaflight's CLI. Nothing
// is kept in the library: what was put in stays while the app is open.

import { app, ask, render } from "../core.js";
import { h, fill, label, primary, secondary, plain } from "../ui.js";
import { showSheet } from "../sheets.js";
import { openFromSide } from "./live.js";
import { types, typeNames, settingNames, axes, shown, fromShown, rateAt, topOf, centerOf, convert, readRates, cliLines, defaultsFor } from "../../shared/rates.js";

/** What the page holds: the pilot's rates (as Betaflight's CLI keeps them, with the rate profile
 *  they came from), the type to see them in, what is being typed in each box, and where they came from. */
const kept = {
  from: { ...defaultsFor(null), profile: null },
  to: "BETAFLIGHT",
  typing: {},
  source: null,
  copied: false,
};

/** The same rates in the other type, worked out again only when something has changed. */
let answer = null, answerFor = null;
function answered() {
  const key = JSON.stringify([kept.from.type, kept.from.quickExpo, kept.from.axes, kept.to]);
  if (key !== answerFor) {
    answer = convert(kept.from, kept.to);
    answerFor = key;
  }
  return answer;
}

const axisTitle = { roll: "ROLL", pitch: "PITCH", yaw: "YAW" };
const colour = { roll: "var(--accent)", pitch: "var(--drop)", yaw: "var(--mark)" };
const degrees = (value) => `${Math.round(value)}°/s`;
const same = (one, other) => one.rc === other.rc && one.srate === other.srate && one.expo === other.expo && (one.limit ?? 0) === (other.limit ?? 0);
const otherType = (type) => (type === "ACTUAL" ? "BETAFLIGHT" : "ACTUAL");

/** The five types to choose from, with the one chosen picked out. */
function typePicker(chosen, choose, probe) {
  return h("div.rates-types", { role: "radiogroup" }, typeNames.map((type) => h(`button.choice${type === chosen ? ".picked" : ""}`, {
    type: "button", role: "radio", "aria-checked": String(type === chosen), probe: `${probe} ${type}`, onclick: () => choose(type),
  }, types[type].title)));
}

/** A setting's heading: its name, and its unit. */
const heading = (type, name) => {
  const field = types[type].fields[name];
  return h("span.rates-heading", field.name, field.unit && h("span.faint", ` ${field.unit}`));
};

/** The pilot's own rates: a box for each of the nine numbers, as Betaflight's app shows them. */
function yourRates() {
  const { type } = kept.from;
  const box = (axis, name) => {
    const key = `rate ${axis} ${name}`;
    const input = h("input.field.rate-field", {
      type: "text", inputMode: "decimal", spellcheck: false, key, probe: key,
      value: kept.typing[key] ?? shown(type, name, kept.from.axes[axis][name]),
      oninput: () => {
        kept.typing[key] = input.value;
        const value = fromShown(type, name, input.value);
        if (value !== null) kept.from.axes[axis][name] = value;
        kept.copied = false;
        render();
      },
      // Once it is left, the box shows the number as it was taken: 674 is 670 in Actual.
      onblur: () => {
        delete kept.typing[key];
        input.value = shown(type, name, kept.from.axes[axis][name]);
      },
      onkeydown: (event) => {
        if (event.key === "Enter") input.blur();
      },
    });
    return input;
  };
  return h("section.card.rates-card", { "aria-label": "Your rates" },
    h("div.rates-card-head", label("YOUR RATES"), h("span.spacer"), plain("Paste from Betaflight…", openPaste, { class: "quiet", icon: "download", probe: "rates paste" })),
    kept.source && h("p.small.dim", kept.source),
    typePicker(type, (picked) => {
      if (picked === kept.from.type) return;
      // Another type for the same rates: the curve stays as it is, in that type's numbers.
      const moved = convert(kept.from, picked);
      kept.from = { type: picked, quickExpo: false, axes: moved.axes, profile: kept.from.profile };
      if (kept.to === picked) kept.to = otherType(picked);
      kept.typing = {};
      kept.copied = false;
      render();
    }, "rates from"),
    h("div.rates-grid",
      h("span"), settingNames.map((name) => heading(type, name)), h("span.rates-heading.right", "Center · Max"),
      axes.map((axis) => [
        h("span.rates-axis", h("span.rates-dot", { style: { background: colour[axis] } }), axisTitle[axis]),
        settingNames.map((name) => box(axis, name)),
        h("span.rates-reach", degrees(centerOf(type, kept.from.axes[axis], kept.from.quickExpo)), h("span.faint", " · "), degrees(topOf(type, kept.from.axes[axis], kept.from.quickExpo))),
      ]),
    ),
    type === "QUICK" && h("label.check.rates-quick",
      h("input", { type: "checkbox", checked: kept.from.quickExpo, onchange: (event) => { kept.from.quickExpo = event.target.checked; kept.copied = false; render(); } }),
      "RC expo on (quickrates_rc_expo)"),
    kept.from.axes.roll.limit < 1998 || kept.from.axes.pitch.limit < 1998 || kept.from.axes.yaw.limit < 1998
      ? h("p.small.dim", `Rate limits: ${axes.map((axis) => `${axis} ${kept.from.axes[axis].limit}°/s`).join(", ")}. They stay as they are in any type.`)
      : null,
  );
}

/** The same rates in the type chosen, and the lines that set them. */
function inOtherType() {
  const found = answered();
  const { type } = found;
  const lines = cliLines(found, kept.from.profile);
  const furthest = Math.max(...axes.map((axis) => found.off[axis]));
  return h("section.card.rates-card", { "aria-label": "In another rate type" },
    h("div.rates-card-head", label("THE SAME FEEL IN")),
    typePicker(type, (picked) => {
      kept.to = picked;
      kept.copied = false;
      render();
    }, "rates to"),
    h("div.rates-grid",
      h("span"), settingNames.map((name) => heading(type, name)), h("span.rates-heading.right", "Center · Max"),
      axes.map((axis) => [
        h("span.rates-axis", h("span.rates-dot", { style: { background: colour[axis] } }), axisTitle[axis]),
        settingNames.map((name) => h("span.rate-value", { probe: `rates to ${axis} ${name}` }, shown(type, name, found.axes[axis][name]))),
        h("span.rates-reach", degrees(centerOf(type, found.axes[axis])), h("span.faint", " · "), degrees(topOf(type, found.axes[axis]))),
      ]),
    ),
    h("p.small.rates-fit", { probe: "rates fit" },
      furthest < 0.5 ? "The same curve exactly."
        : `Within ${Math.max(1, Math.round(furthest))}°/s of yours anywhere on the stick${furthest > 25 ? `: ${types[type].title}'s curve can't take the shape of yours any closer` : ""}.`),
    h("pre.rates-cli", { probe: "rates cli" }, lines.join("\n")),
    h("div.row.tight",
      primary(kept.copied ? "Copied" : "Copy the lines", () => {
        ask("copyText", `${lines.join("\n")}\n`);
        kept.copied = true;
        render();
      }, { icon: kept.copied ? "check" : "copies", probe: "rates copy" }),
      secondary("Open Betaflight", () => openFromSide("betaflight"), { icon: "chip" }),
    ),
    h("p.small.dim", kept.copied
      ? "They are on the clipboard. In Betaflight's CLI tab, paste them and press Return. save keeps them and restarts the flight controller."
      : `In Betaflight's CLI tab, paste these and press Return.${kept.from.profile !== null ? ` They go into rate profile ${kept.from.profile + 1}, the one they came from.` : " They go into the rate profile the flight controller is on."}`),
  );
}

/** The curves: the turn asked for at each point of the stick, yours solid and the other type's dashed. */
function chart() {
  const found = answered();
  const width = 720, height = 280, left = 52, right = 14, top = 14, bottom = 30;
  const across = width - left - right, down = height - top - bottom;
  // Axes set the same are one line, in the first one's colour: roll and pitch often are.
  const groups = [];
  for (const axis of axes) {
    const match = groups.find((group) => same(kept.from.axes[group[0]], kept.from.axes[axis]) && same(found.axes[group[0]], found.axes[axis]));
    if (match) match.push(axis);
    else groups.push([axis]);
  }
  const shownAxes = groups.map((group) => group[0]);
  const named = (group) => {
    const words = group.map((axis, index) => (index === 0 ? axis[0].toUpperCase() + axis.slice(1) : axis));
    return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  };
  const highest = Math.max(...axes.flatMap((axis) => [topOf(kept.from.type, kept.from.axes[axis], kept.from.quickExpo), topOf(found.type, found.axes[axis])]), 100);
  const step = [100, 200, 250, 500].find((one) => highest / one <= 6);
  const ceilingLine = Math.ceil(highest / step) * step;
  const x = (stick) => left + stick * across;
  const y = (rate) => top + down - (rate / ceilingLine) * down;
  const path = (type, setting, quickExpo) => {
    let d = "";
    for (let index = 0; index <= 100; index += 1) d += `${index === 0 ? "M" : "L"}${x(index / 100).toFixed(1)} ${y(rateAt(type, setting, index / 100, quickExpo)).toFixed(1)}`;
    return d;
  };
  let svg = "";
  for (let rate = 0; rate <= ceilingLine; rate += step) {
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(rate)}" y2="${y(rate)}" style="stroke: var(--stroke)"/>`;
    svg += `<text x="${left - 8}" y="${y(rate) + 4}" text-anchor="end">${rate}</text>`;
  }
  for (const stick of [0, 0.25, 0.5, 0.75, 1]) {
    svg += `<line x1="${x(stick)}" x2="${x(stick)}" y1="${top}" y2="${top + down}" style="stroke: var(--stroke)"/>`;
    svg += `<text x="${x(stick)}" y="${height - 10}" text-anchor="${stick === 0 ? "start" : stick === 1 ? "end" : "middle"}">${Math.round(stick * 100)}%</text>`;
  }
  for (const axis of shownAxes) {
    svg += `<path d="${path(found.type, found.axes[axis], false)}" style="stroke: ${colour[axis]}; stroke-dasharray: 6 5; opacity: 0.85"/>`;
    svg += `<path d="${path(kept.from.type, kept.from.axes[axis], kept.from.quickExpo)}" style="stroke: ${colour[axis]}"/>`;
  }
  const key = (group) => h("span.rates-key", h("span.rates-dot", { style: { background: colour[group[0]] } }), named(group));
  return h("section.card.rates-chart", { "aria-label": "The curves" },
    h("div.rates-card-head", label("THE CURVES"), h("span.spacer"), groups.map(key)),
    h("div.rates-plot", { html: `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${svg}</svg>` }),
    h("p.small.dim", `Degrees a second the whoop is asked to turn, from the stick at its middle to pushed all the way. Solid: yours, in ${types[kept.from.type].title}. Dashed: in ${types[found.type].title}.`),
  );
}

/** Rates pasted from what Betaflight's CLI printed. With more than one rate profile, the pilot picks. */
function openPaste() {
  let close = () => {};
  const box = h("textarea.field.rates-paste", { rows: 11, spellcheck: false, key: "rates paste", probe: "rates paste box", placeholder: "# diff all\n…" });
  const said = h("p.alert-message.warn");
  const picks = h("div.rates-profiles");
  const take = (read, profile) => {
    kept.from = { type: profile.type, quickExpo: profile.quickExpo, axes: structuredClone(profile.axes), profile: profile.index };
    if (kept.to === profile.type) kept.to = otherType(profile.type);
    kept.typing = {};
    kept.copied = false;
    const which = profile.index === null ? "Pasted from Betaflight's CLI" : `Rate profile ${profile.index + 1}${profile.name ? ` (${profile.name})` : ""}`;
    kept.source = read.version
      ? `${which}, from Betaflight ${read.version}.`
      : `${which}. It didn't say which Betaflight it came from, so anything it left out is as Betaflight 4.3 and newer have it.`;
    close();
    render();
  };
  const read = () => {
    const found = readRates(box.value);
    fill(picks);
    if (!found) {
      said.textContent = "There are no rates in that. In Betaflight's CLI tab, type diff all and press Return, then copy everything it printed.";
      return;
    }
    said.textContent = "";
    if (found.profiles.length === 1) return take(found, found.profiles[0]);
    fill(picks, label("WHICH RATE PROFILE?"), found.profiles.map((profile) => h("button.rates-profile", { type: "button", probe: `rates profile ${profile.index}`, onclick: () => take(found, profile) },
      h("span.grow", h("strong", `Rate profile ${profile.index + 1}`), profile.name && ` · ${profile.name}`, h("span.dim", ` · ${types[profile.type].title}`)),
      profile.index === found.active && h("span.small.accent", "On the whoop now"))));
  };
  close = showSheet(h("div.alert.rates-sheet",
    h("div.alert-title", "Rates from Betaflight"),
    h("div.alert-message", "In Betaflight's CLI tab, type diff all and press Return, then copy everything it printed and paste it here. A dump, or what get rate prints, does too."),
    box, said, picks,
    h("div.alert-buttons", secondary("Cancel", () => close()), primary("Read the rates", read, { probe: "rates read" })),
  ), { onEscape: () => close() });
  box.focus();
}

export function ratesPage() {
  if (kept.to === kept.from.type) kept.to = otherType(kept.from.type);
  return h("div.scroll", { "data-scroll": "page" }, h("div.plain-page.rates",
    h("header.page-head",
      h("div.grow", label("FIRMWARE & SETUP"), h("h1.head-title", "Rates")),
      secondary("Open Betaflight", () => openFromSide("betaflight"), { icon: "chip", help: "Betaflight's own app, where the rates are set" })),
    h("p.dim.rates-intro", "How far you push a stick becomes how fast the whoop turns. Put your rates in as Betaflight shows them, or paste them from its CLI, to see them as curves and to get the same feel in another rate type: a new whoop set up in Actual flies like your old one in Betaflight's."),
    chart(),
    h("div.rates-pair", yourRates(), inOtherType()),
  ));
}
