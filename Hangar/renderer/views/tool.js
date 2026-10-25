// Other projects' tools.
//
// Two are shown inside the window: Betaflight's app and ExpressLRS's web flasher, each loaded from
// its project's own site into a place on this page (the main process lays it over `.tool-frame`).
// While one is open it takes over the window, the way the marker editor does. When the tool asks
// which serial port, USB device or Bluetooth device to use, the list to choose from is put up
// here, where a browser would put up its own.
//
// The others are programs of their own, the ExpressLRS Configurator and EdgeTX Companion, which the
// app fetches and keeps up to date: `showProgram` is the sheet that says which version is here and
// which is the newest.

import { app, ask, hangar, render } from "../core.js";
import { h, fill, label, primary, secondary, plain } from "../ui.js";
import { showSheet } from "../sheets.js";
import { openLink } from "../actions.js";
import { computer, tools } from "../words.js";
import { outsideTools, programs, plainNotes, megabytes, goesBeside, familyOf } from "../../shared/components.js";

/** What each kind of device is called when a tool asks for one, and what to do when none shows. */
const kinds = {
  serial: ["a serial port", "Plug the flight controller or the radio in over USB and it shows up here by itself."],
  usb: ["a USB device", "Plug it in, in its bootloader if it is to be flashed, and it shows up here by itself."],
  hid: ["a controller", "Plug it in and it shows up here by itself."],
  bluetooth: ["a Bluetooth device", "Still looking. Switch it on and bring it near."],
};

class ToolView {
  constructor(id) {
    this.id = id;
    this.tool = outsideTools[id];
    this.closeList = null;
    this.onResize = () => this.place();
  }

  open() {
    const tool = this.tool;
    this.frame = h("div.tool-frame");
    this.status = h("span.tool-status", "Opening…");
    this.root = h("div.tool",
      h("div.tool-bar",
        secondary("Hangar", () => this.close(), { icon: "chevronLeft", help: "Back to the Hangar", probe: "tool back" }),
        h("div.tool-title", label(`FROM ${tool.owner.toUpperCase()}`), h("h1.tool-name", tool.title.toUpperCase())),
        h("span.spacer"),
        this.status,
        secondary("Load again", () => ask("reloadTool"), { help: `Fetches ${tool.title} again from its own site. That is how to pick up a release that has only just come out.` }),
        secondary("Open in browser", () => openLink(tool.address), { icon: "arrowUpRight", help: `Opens ${tool.address} in your own browser` }),
      ),
      this.frame,
    );
    fill(document.getElementById("tool"), this.root);
    document.getElementById("stage").setAttribute("inert", "");
    app.tool = this;
    this.offs = [
      hangar.hear("tool", (news) => {
        if (news.id !== this.id) return;
        this.status.classList.toggle("warn", Boolean(news.problem));
        this.status.textContent = news.problem ?? (news.loading ? "Loading…" : "");
      }),
      hangar.hear("toolDevices", (list) => this.choose(list)),
    ];
    this.watch = new ResizeObserver(this.onResize);
    this.watch.observe(this.frame);
    window.addEventListener("resize", this.onResize);
    return ask("openTool", this.id, this.rect());
  }

  /** Where on the window the tool's page goes. */
  rect() {
    const at = this.frame.getBoundingClientRect();
    return { x: at.left, y: at.top, width: at.width, height: at.height };
  }

  place() {
    if (app.tool === this) ask("placeTool", this.rect());
  }

  /** The tool is asking which device to use: the list, kept up to date while it is up. Null takes it down. */
  choose(list) {
    if (!list) {
      this.closeList?.();
      this.closeList = null;
      return;
    }
    const [what, waiting] = kinds[list.kind] ?? kinds.usb;
    const rows = list.devices.length === 0
      ? h("p.device-none", waiting)
      : list.devices.map((device) => h("button.device", { type: "button", probe: `device ${device.id}`, onclick: () => ask("chooseToolDevice", device.id) },
        h("span.device-name", device.name), device.detail && h("span.device-detail", device.detail)));
    if (this.closeList) return fill(this.devices, rows);
    this.devices = h("div.devices", rows);
    this.closeList = showSheet(h("div.alert",
      h("div.alert-title", `${this.tool.title} is asking for ${what}`),
      h("div.alert-message", "Choose the one to let it use."),
      this.devices,
      h("div.alert-buttons", secondary("Cancel", () => ask("chooseToolDevice", null), { probe: "device cancel" })),
    ), { onEscape: () => ask("chooseToolDevice", null), small: true });
  }

  async close() {
    if (app.tool !== this) return;
    app.tool = null;
    this.closeList?.();
    for (const off of this.offs) off();
    this.watch.disconnect();
    window.removeEventListener("resize", this.onResize);
    await ask("closeTool");
    fill(document.getElementById("tool"));
    document.getElementById("stage").removeAttribute("inert");
    render();
  }
}

/** Opens one of the tools that is another project's own app. */
export async function openTool(id) {
  if (app.tool || app.editor || app.trackView || !Object.hasOwn(outsideTools, id)) return false;
  const opened = await new ToolView(id).open();
  if (opened?.problem) {
    await app.tool?.close();
    app.notice = opened.problem;
    render();
    return false;
  }
  return true;
}

const day = (stamp) => new Date(stamp).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** A line about where a program stands, for its tile on the first screen. */
export function programStatus(id) {
  const now = app.state.programs?.[id];
  if (!now) return null;
  if (now.busy?.kind === "fetching") return "Fetching…";
  if (now.installed === null) return "Not on this computer yet";
  if (now.newer) return `v${now.latest.version} is out`;
  return now.installed ? `v${now.installed}` : "On this computer";
}

/**
 * The sheet for a program the app fetches and keeps up to date: which version is here, which is
 * the newest, what is new in it, and the buttons to open it, fetch it and look again.
 */
export function showProgram(id) {
  const program = programs[id], words = tools[id];
  if (!program) return;
  let close = () => {}, said = null, bar = null;
  const body = h("div.alert.program");
  const offs = [];
  const leave = () => {
    for (const off of offs) off();
    close();
  };
  const refresh = async () => {
    app.state.programs = await ask("programsNow");
    draw();
    render();
  };
  const act = async (what) => {
    said = null;
    const answer = await ask(what, id);
    if (answer?.problem) said = answer.problem;
    if (answer?.installer) said = `${program.owner}'s installer has opened. Follow it through, then come back here.`;
    if (answer?.state) app.state.programs = answer.state;
    else app.state.programs = await ask("programsNow");
    draw();
    render();
  };
  function draw() {
    const now = app.state.programs?.[id] ?? { installed: null, latest: null, busy: null, problem: null, newer: false };
    const latest = now.latest, fetching = now.busy?.kind === "fetching", checking = now.busy?.kind === "checking";
    const wanted = latest && (now.installed === null || now.newer);
    // A copy that doesn't say which version it is may say its family.
    const here = now.installed === null ? "It isn't on this computer yet." : !now.installed ? "It is on this computer." : now.exact === false ? `${program.title} ${now.installed} is on this computer.` : `Version ${now.installed} is on this computer.`;
    const newest = !latest ? (checking ? "Looking for the newest release…" : "")
      : now.newer ? `Version ${latest.version} came out${latest.published ? ` on ${day(latest.published)}` : ""}.`
        : now.installed === latest.version ? "That is the newest." : now.installed === null ? `The newest is version ${latest.version}${latest.published ? `, from ${day(latest.published)}` : ""}.` : "";
    const notes = wanted ? plainNotes(latest.notes) : [];
    bar = fetching ? h("span.job-done", { style: { width: `${Math.round(now.busy.progress * 100)}%` } }) : null;
    fill(body,
      h("div.alert-title", program.title),
      h("div.alert-message", `${program.owner}'s own program, ${words.about}. It opens in a window of its own. FPV Hangar fetches it from ${program.owner}'s Releases page, checks it against the checksum ${program.sums ? "published there" : "GitHub keeps for it there"}, and tells you when a newer one is out.`),
      words.tip && h("div.program-tip", h("span", words.tip), words.guide && plain(words.guide.title, () => openLink(words.guide.address), { icon: "arrowUpRight", help: `Opens ${words.guide.address} in your browser` })),
      h("p.program-now", here, newest && " ", newest),
      (said ?? now.problem) && h("p.program-said", said ?? now.problem),
      fetching && h("div.program-fetch", h("span.job-bar", bar), h("span.program-share", `Fetching ${megabytes(latest.size)}…`)),
      notes.length > 0 && h("div.program-notes", label(`NEW IN ${latest.version}`), notes.map((line) => h("p", line))),
      h("div.alert-buttons",
        plain("Its Releases page", () => openLink(latest?.page ?? program.page), { class: "quiet", help: `Opens ${program.owner}'s own page for this release in your browser` }),
        plain(checking ? "Looking…" : "Look again", () => act("checkProgram"), { class: "quiet", disabled: fetching || checking, help: "Looks at the Releases page for a newer one now." }),
        h("span.spacer"),
        secondary("Close", leave),
        now.installed !== null && (wanted ? secondary : primary)("Open", () => act("openProgram"), { disabled: fetching, probe: "program open" }),
        wanted && primary(`${now.installed === null ? "Get" : "Update to"} ${latest.version}`, () => act("installProgram"), {
          disabled: fetching, probe: "program get",
          help: computer === "Mac"
            ? `Downloads ${megabytes(latest.size)}. ${now.installed === null ? "It goes in your Applications folder." : goesBeside(program, now.installed, latest.version) ? `It goes in your Applications folder, beside ${program.title} ${familyOf(now.installed)}, which stays.` : "The copy you have goes to the Trash."}`
            : `Downloads ${megabytes(latest.size)} and starts ${program.owner}'s own installer.`,
        }),
      ),
    );
  }
  draw();
  close = showSheet(body, { onEscape: leave });
  // What is on this computer, or what is being fetched, has changed.
  offs.push(hangar.hear("changed", async () => {
    app.state.programs = await ask("programsNow");
    draw();
  }));
  offs.push(hangar.hear("program", (which, share) => { if (which === id && bar) bar.style.width = `${Math.round(share * 100)}%`; }));
  // Looked at once as the sheet opens, unless that was done a little while ago.
  const checked = Date.parse(app.state.programs?.[id]?.checked ?? "");
  if (!(Date.now() - checked < 10 * 60 * 1000)) act("checkProgram");
  return { leave, refresh };
}
