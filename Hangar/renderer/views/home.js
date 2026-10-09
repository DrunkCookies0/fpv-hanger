// The first screen. The hangar: every tool as a tile, grouped by suite. A tool that isn't built yet says so.

import { app, open, openVideoCreator, allTracks } from "../core.js";
import { h, icon, label, secondary, plain, comingSoonBadge, testCopyBadge } from "../ui.js";
import { suites, tools } from "../words.js";
import { openLink } from "../actions.js";
import { showNote } from "./notes.js";

/** Says a newer version is ready. Pressing it goes to where it is installed. */
export function updatePill() {
  const update = app.state.update;
  if (update.kind !== "available") return null;
  return h("button.pill.update", { type: "button", help: "A newer version is ready. Open Pilot & settings to install it.", onclick: () => open({ name: "settings" }) }, `UPDATE TO V${update.version}`);
}

/** What opening a tool does. Null for one that isn't there to open yet. */
function actionFor(tool) {
  if (tool === "videoCreator") return openVideoCreator;
  if (tool === "leaderboards") return () => open({ name: "leaderboard" });
  return null;
}

/** A line about where a tool stands, for its tile. */
function statusOf(tool) {
  const tracks = app.state.events.flatMap((event) => event.tracks);
  if (tool === "videoCreator") {
    if (tracks.length === 0) return "No tracks yet";
    // In the season, what matters most is the next deadline of a track that hasn't been sent in.
    const now = Date.now();
    const open = tracks.filter((track) => track.deadline && new Date(track.deadline) > now && track.submissions === 0)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
    if (open) {
      const days = Math.floor((new Date(open.deadline) - now) / 86400000);
      return `${open.name} closes ${days >= 1 ? `in ${days} day${days === 1 ? "" : "s"}` : "today"}`;
    }
    const timed = tracks.filter((track) => track.best !== null).length;
    return `${tracks.length} track${tracks.length === 1 ? "" : "s"}, ${timed} with a time`;
  }
  if (tool === "leaderboards") {
    const sent = tracks.filter((track) => track.submissions > 0).length;
    return sent === 0 ? "Nothing submitted yet" : `${sent} track${sent === 1 ? "" : "s"} submitted`;
  }
  return null;
}

/** One tool on the first screen. A tool with nothing to open yet is dimmed and can't be pressed. */
function tile(name) {
  const tool = tools[name], action = actionFor(name), status = statusOf(name);
  return h(`button.tile${action ? "" : ".idle"}`, {
    type: "button", disabled: !action, probe: `tile ${name}`, onclick: action,
    help: action ? `Open ${tool.title}` : tool.soon?.detail ?? "",
    "aria-label": action ? `Open ${tool.title}` : `${tool.title}, coming soon`,
  },
    h("div.tile-top", h("span.tile-icon", icon(tool.icon)), tool.soon && comingSoonBadge()),
    h("div.tile-title", tool.title),
    h("div.tile-summary", tool.summary),
    h("div.tile-foot", status && h("span.tile-status", status), h("span.spacer"), action && h("span.tile-open", "Open", icon("arrowRight"))),
  );
}

function section(suite) {
  return h("section.suite",
    h("div.suite-head",
      h("div", h("div.suite-title", suite.title.toUpperCase()), h("div.suite-summary", suite.summary)),
      // The series' own site.
      h("div.suite-links", suite.links.map((link) => h("button.link", { type: "button", help: `Opens ${link.address} in your browser`, onclick: () => openLink(link.address) }, link.title, icon("arrowUpRight")))),
    ),
    // Up to three tiles to a row, sharing its whole width.
    h("div.tiles", { style: { gridTemplateColumns: `repeat(${Math.min(3, Math.max(2, suite.tools.length))}, minmax(0, 1fr))` } }, suite.tools.map(tile)),
  );
}

export function home() {
  const state = app.state;
  const header = h("header.home-head",
    h("div",
      h("div.wordmark", h("span", "FPV"), h("span.accent", "HANGAR")),
      label("TOOLS FOR FPV PILOTS"),
    ),
    h("div.home-pilot",
      state.settings.pilot === ""
        ? h("button.add-name", { type: "button", help: "Your name goes on every timer and video. Pilot & settings is where it is typed.", onclick: () => open({ name: "settings" }) }, icon("personPlus"), "Add your pilot name")
        : h("div.pilot-name", state.settings.pilot),
      h("div.row",
        secondary("How it works", () => open({ name: "guide" }), { icon: "book", probe: "home guide" }),
        secondary("Pilot & settings", () => open({ name: "settings" }), { icon: "gear", probe: "home settings" }),
      ),
    ),
  );
  const footer = h("footer.home-foot",
    h("span.version", `FPV Hangar v${state.version}`),
    state.testCopy && testCopyBadge(),
    updatePill(),
    h("span.spacer"),
    plain("What's new", () => showNote({ kind: "whatsNew", since: null }), { class: "quiet", help: "What changed in each version" }),
  );
  // In the middle of the window both ways, like the front of a kiosk, when there is room to spare.
  return h("div.scroll", { "data-scroll": "page" }, h("div.home", h("div.home-page", header, suites.map(section), footer)));
}

export { allTracks };
