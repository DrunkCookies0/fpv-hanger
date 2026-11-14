// The sidebar down the left of every page: the tools by suite, a way to find a tool, a track or a
// pack by typing, and at its foot what is going on just now (the WhoopStor's charge or cycle test, a
// video being made, the copy in Google Drive), so it can be watched from anywhere in the Hangar.

import { app, go, allTracks, trackName, eventOf } from "../core.js";
import { h, icon, redraw } from "../ui.js";
import { showSheet } from "../sheets.js";
import { tools, sideGroups, keys } from "../words.js";
import { factsOf } from "../../shared/batteries.js";
import { showing, openFromSide, leaveViews, chargerNow, jobNow, noteFor, statusOf } from "./live.js";

const side = () => document.getElementById("side");

/** One of the sidebar's items: a tool, Home, Pilot & settings. */
function item(name, title, picture, probe) {
  const on = showing() === name;
  return h(`button.tools-item${on ? ".on" : ""}`, { type: "button", probe, "aria-current": on ? "page" : null, onclick: () => openFromSide(name) },
    icon(picture, 15), h("span.tools-title", title), h("span.tools-note", { "data-note": name }, noteFor(name)));
}

/** The Drive copy's line, while something is happening to it: files going across, or a problem. */
function driveLine() {
  const drive = app.state?.drive;
  if (!drive || !["copying", "problem"].includes(drive.kind)) return null;
  const where = drive.inDrive ? "Google Drive library" : "The copy in Google Drive";
  const says = drive.kind === "problem" ? "Not copied" : drive.round.files === 0 ? "Looking…" : `Copying ${Math.min(drive.round.done + 1, drive.round.files)} of ${drive.round.files}`;
  return h("button.live-drive", { type: "button", onclick: () => openFromSide("settings"), help: drive.kind === "problem" ? drive.last?.problem ?? "" : "Pilot & settings has more about it" },
    icon(drive.kind === "problem" ? "warning" : "cloud", 13), h("span.grow", where), h(`span.${drive.kind === "problem" ? "warn" : "dim"}`, says));
}

/** The charger's card: each port's pack and how full it is, what it is doing, and for how long. */
function chargerCard(now) {
  if (showing() === "batteryTester") {
    // On the Batteries page itself the ports are on the page.
    return h("div.live-card.here", { probe: "live charger" },
      h("div.live-head", icon("battery", 15, { class: "accent" }), h("span.live-title", `${now.short}${now.kind === "cycle" ? ` ${now.badge.replace(" / ", "/")}` : ""}`), now.away ? h("span.warn.small", "USB out") : h("span.dim.small", "On this page")));
  }
  return h("button.live-card", { type: "button", probe: "live charger", help: "Open Batteries", onclick: () => openFromSide("batteryTester") },
    h("div.live-head", icon("battery", 15, { class: "accent" }), h("span.live-title", now.short), h("span.live-badge", now.badge)),
    h("div.live-ports", now.ports.map((port) => h(`div.live-port${port.there ? "" : ".empty"}`,
      h("div.live-bar", h("div.live-fill", { style: { height: `${Math.round(port.fill * 20) * 5}%`, background: port.colour } })),
      h("span.live-pack", port.there ? port.pack ?? "?" : "–")))),
    h("div.live-line", h("span", now.line), h("span", now.time)));
}

/** What is going on just now, at the sidebar's foot. Empty when nothing is. */
export function liveSection() {
  const charger = chargerNow(), job = jobNow(), drive = driveLine();
  if (!charger && !job && !drive) return h("section.tools-live", { "data-live": "side", "aria-label": "Live" });
  return h("section.tools-live", { "data-live": "side", "aria-label": "Live" },
    h("div.tools-head.live-label", h("span.live-dot"), "LIVE"),
    charger && chargerCard(charger),
    job && h("div.live-card.job", { probe: "live job" },
      h("div.live-head", icon("film", 15, { class: "drop" }), h("span.live-title", job.title), h("span.live-percent", `${Math.floor(job.progress * 100)}%`)),
      h("div.live-track", h("div.live-done", { style: { width: `${job.progress * 100}%` } }))),
    drive,
  );
}

/** The whole sidebar. */
function sidebar() {
  const state = app.state;
  return [
    h("div.tools-top", h("div.tools-mark", h("span", "FPV"), h("span.accent", "HANGAR"))),
    h("button.tools-find", { type: "button", probe: "find", help: "Find a tool, a track or a pack by typing", onclick: showFind },
      icon("search", 14), h("span.grow", "Tools, tracks, packs"), h("span.tools-key", keys("cmd", "K"))),
    h("nav.tools-nav", { "aria-label": "Tools", "data-scroll": "tools" },
      h("div.tools-group", item("home", "Home", "home", "side home")),
      sideGroups.map((group) => h("div.tools-group",
        h("div.tools-head", group.title.toUpperCase()),
        group.tools.map((name) => item(name, tools[name].short ?? tools[name].title, tools[name].icon, `tile ${name}`)))),
    ),
    liveSection(),
    h("div.tools-foot",
      state.settings.pilot === "" && h("button.tools-pilot", { type: "button", help: "Your name goes on every timer and video", onclick: () => openFromSide("settings") }, icon("personPlus", 14), "Add your pilot name"),
      h("div.row.tight",
        h(`button.tools-item.grow${showing() === "settings" ? ".on" : ""}`, { type: "button", probe: "side settings", onclick: () => openFromSide("settings") },
          icon("gear", 15), h("span.tools-title", "Pilot & settings"), state.update?.kind === "available" && h("span.tools-dot", { help: `Version ${state.update.version} is ready to install` })),
        h(`button.tools-item.tools-square${showing() === "guide" ? ".on" : ""}`, { type: "button", probe: "side guide", help: "How it works", "aria-label": "How it works", onclick: () => openFromSide("guide") }, icon("book", 15)),
      ),
    ),
  ];
}

/** Draws the whole sidebar again, keeping how far its list is scrolled. */
export function drawSide() {
  const holder = side();
  if (!holder || !app.state) return;
  const top = holder.querySelector('[data-scroll="tools"]')?.scrollTop ?? 0;
  redraw(holder, h("div.tools", sidebar()));
  const list = holder.querySelector('[data-scroll="tools"]');
  if (list) list.scrollTop = top;
}

/** Draws again only what changes by itself: what is live, and the words beside the tools. Only what
 *  has changed is put back, so a press on the sidebar is never lost to a reading coming in. */
export function drawSideLive() {
  const holder = side()?.querySelector('[data-live="side"]');
  if (!holder || !app.state) return drawSide();
  const fresh = liveSection();
  if (fresh.outerHTML !== holder.outerHTML) holder.replaceWith(fresh);
  for (const note of side().querySelectorAll("[data-note]")) {
    const words = noteFor(note.dataset.note);
    if (note.textContent !== words) note.textContent = words;
  }
}

// ---- Finding a tool, a track or a pack by typing

/** Everything that can be found: { kind, title, detail, go }. */
function findables() {
  const all = [{ kind: "Page", title: "Home", detail: "", go: () => openFromSide("home") }];
  for (const group of sideGroups) {
    for (const name of group.tools) all.push({ kind: group.title, title: tools[name].title, detail: tools[name].summary, go: () => openFromSide(name) });
  }
  all.push({ kind: "Page", title: "Pilot & settings", detail: "Your pilot name, the groups, Google Drive, updates", go: () => openFromSide("settings") });
  all.push({ kind: "Page", title: "How it works", detail: "The walk-through and the editor's keys", go: () => openFromSide("guide") });
  for (const track of allTracks()) {
    const event = eventOf(track);
    all.push({ kind: event?.name || "Track", title: trackName(track), detail: event?.isSeason ? "Track" : "Race", go: async () => { if (await leaveViews()) go({ name: "track", track }); } });
  }
  const facts = factsOf(app.state.batteries);
  const packs = Object.values(app.state.batteries.packs).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const pack of packs) {
    const status = pack.retired ? "Retired" : statusOf(pack, facts).text;
    all.push({
      kind: "Pack", title: `Pack ${pack.name}`, detail: [`${pack.mah} mAh`, pack.brand, status].filter(Boolean).join(" · "),
      go: async () => {
        if (!(await leaveViews())) return;
        const { showPack } = await import("./batteries.js");
        showPack(pack.id);
      },
    });
  }
  return all;
}

/** The ones that match what is typed, the best first: those that start with it, then the rest. */
function matching(all, typed) {
  const words = typed.trim().toLowerCase();
  if (words === "") return all.filter((one) => one.kind !== "Pack").slice(0, 9);
  const scored = [];
  for (const one of all) {
    const title = one.title.toLowerCase(), rest = `${one.kind} ${one.detail}`.toLowerCase();
    const bare = title.replace(/^pack /, "");
    const score = bare.startsWith(words) || title.startsWith(words) ? 0 : title.split(/\s+/).some((word) => word.startsWith(words)) ? 1 : title.includes(words) ? 2 : rest.includes(words) ? 3 : -1;
    if (score >= 0) scored.push([score, one]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, one]) => one).slice(0, 9);
}

let finding = null;

/** The box to find a tool, a track or a pack in. Return opens the one picked out; the arrows move. */
export async function showFind() {
  if (finding || !app.state) return;
  // Another project's page is laid over the window, so it goes first.
  if (app.tool && !(await leaveViews())) return;
  const all = findables();
  let found = matching(all, ""), chosen = 0;
  const list = h("div.find-list", { role: "listbox" });
  const pick = (one) => {
    close();
    one?.go();
  };
  const drawList = () => redraw(list, found.length === 0
    ? h("p.dim.find-none", "Nothing by that name.")
    : found.map((one, index) => h(`button.find-row${index === chosen ? ".on" : ""}`, { type: "button", role: "option", "aria-selected": index === chosen ? "true" : "false", onclick: () => pick(one), onmousemove: () => { if (chosen !== index) { chosen = index; drawList(); } } },
      h("span.find-title", one.title), h("span.find-detail", one.detail), h("span.find-kind", one.kind))));
  const box = h("input.field.large.find-box", {
    type: "text", placeholder: "Find a tool, a track or a pack", spellcheck: false, probe: "find box",
    oninput: () => { found = matching(all, box.value); chosen = 0; drawList(); },
    onkeydown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        chosen = (chosen + (event.key === "ArrowDown" ? 1 : -1) + found.length) % Math.max(found.length, 1);
        drawList();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        pick(found[chosen]);
      }
    },
  });
  drawList();
  const shut = showSheet(h("div.find", box, list), { onEscape: () => close() });
  const close = () => {
    finding = null;
    shut();
  };
  finding = close;
  box.focus();
}
