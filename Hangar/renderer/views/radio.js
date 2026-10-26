// The radio's backups: a copy of its SD card each time it is plugged in to this computer with USB
// Storage (SD) chosen on it (see main/radio.js). The sheet lists them, and says how to put one back.

import { app, ask, hangar, render } from "../core.js";
import { h, fill, label, primary, secondary, plain } from "../ui.js";
import { showSheet } from "../sheets.js";
import { fileBrowser, mac } from "../words.js";
import { megabytes } from "../../shared/components.js";
import { radioName } from "../../shared/radio.js";

const time = (stamp) => new Date(stamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** When a backup was made: "today at 22:40", or "25 October 2026 at 22:40". */
export function when(stamp) {
  const at = new Date(stamp);
  if (at.toDateString() === new Date().toDateString()) return `today at ${time(stamp)}`;
  return `${at.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} at ${time(stamp)}`;
}

/** A line about the backups, for the tile on the first screen. */
export function radioStatus() {
  const now = app.state.radio;
  if (!now) return null;
  if (now.backing) return `Backing up ${radioName(now.backing.board)}…`;
  const newest = now.backups[0];
  if (now.problem) return "Its last backup didn't finish";
  if (newest) return `Backed up ${when(newest.at)}`;
  if (now.radios.length > 0) return `${radioName(now.radios[0].board)} is plugged in`;
  return "Plug the radio in to back it up";
}

/** What the backups say for Companion's sheet: when the radio was last backed up, or how to. */
export function backupLine() {
  const now = app.state.radio, newest = now?.backups[0];
  if (now?.backing) return `${radioName(now.backing.board)}'s card is being backed up now, under Radio backups.`;
  if (newest) return `${radioName(newest.board)}'s card was last backed up ${when(newest.at)}, under Radio backups. Plug it in again with USB Storage (SD) chosen before changing anything, and it is backed up again.`;
  return "Before you change anything, plug the radio in with USB Storage (SD) chosen on its screen: FPV Hangar backs up everything on its card, under Radio backups.";
}

/** The sheet with the radio's backups: the radio plugged in, the one under way, and how to put one back. */
export function showRadioBackups() {
  let close = () => {}, bar = null, said = null;
  const body = h("div.alert.backups");
  const offs = [];
  const leave = () => {
    for (const off of offs) off();
    close();
  };
  const act = async (what, ...details) => {
    said = null;
    const answer = await ask(what, ...details);
    if (answer?.problem) said = answer.problem;
    app.state.radio = answer?.state ?? (await ask("radioNow"));
    draw();
    render();
  };
  function draw() {
    const now = app.state.radio ?? { radios: [], barred: [], backing: null, backups: [], count: 0, problem: null, last: null };
    const radio = now.radios[0] ?? null, backing = now.backing;
    const here = backing ? `Backing up ${radioName(backing.board)}'s card: ${megabytes(backing.bytes)}. Leave it plugged in until it is done.`
      : radio ? `${radioName(radio.board)} is plugged in${radio.version ? `, with EdgeTX ${radio.version}` : ""}.${now.last?.unchanged ? " Nothing on its card has changed since its last backup." : ""}`
        : "No radio is plugged in. Plug it in with a USB cable and choose USB Storage (SD) on its screen.";
    bar = backing ? h("span.job-done", { style: { width: `${Math.round(backing.share * 100)}%` } }) : null;
    const rows = now.backups.slice(0, 8).map((one) => h("div.backup",
      h("div.backup-words",
        h("span.backup-name", `${radioName(one.board)}${one.version ? ` · EdgeTX ${one.version}` : ""}`),
        h("span.backup-detail", `${when(one.at)} · ${one.files} file${one.files === 1 ? "" : "s"}, ${megabytes(one.bytes)}`)),
      plain("Show", () => act("showRadioBackup", one.folder), { class: "quiet", help: `Shows this backup in ${fileBrowser}` })));
    fill(body,
      h("div.alert-title", "Radio backups"),
      h("div.alert-message", `Whenever your radio is plugged in to this computer with USB Storage (SD) chosen on it, FPV Hangar copies everything on its SD card. EdgeTX keeps all of the radio's models and settings there, with its themes, widgets, scripts and sounds. A file that hasn't changed is linked to its copy in the last backup, so a backup takes little room, and one that finds nothing changed isn't kept. The radio's card is only read.`),
      h("p.program-now", here),
      (said ?? now.problem) && h("p.program-said", said ?? now.problem),
      // A Mac asks before an app reads a removable disk. Turned down, the radio can't be seen.
      mac && !radio && now.barred?.length > 0 && h("p.program-said", `macOS hasn't let FPV Hangar read ${now.barred.join(", ")}, so it can't tell whether that is your radio. Allow it in System Settings, under Privacy & Security, Files and Folders, FPV Hangar, Removable Volumes. Then plug the radio in again.`),
      backing && h("div.program-fetch", h("span.job-bar", bar), h("span.program-share", "Backing up…")),
      rows.length > 0 && h("div.backup-list", label(`${now.count} BACKUP${now.count === 1 ? "" : "S"}, NEWEST FIRST`), rows, now.count > rows.length && h("p.backup-more", `And ${now.count - rows.length} more in the folder.`)),
      h("div.program-notes.whole",
        label("TO PUT ONE BACK"),
        h("p", "Plug the radio in with USB Storage (SD) chosen. Delete the RADIO and MODELS folders on its card, then copy the backup's RADIO and MODELS folders onto it in their place, and anything else of the backup's that you want back."),
        h("p", "Or in EdgeTX Companion: File, Read Models and Settings from SD Path, and choose the backup's folder; then Radio, Write Models and Settings to Radio.")),
      h("div.alert-buttons",
        plain("Show the backups folder", () => act("showRadioBackups"), { class: "quiet", help: `Opens ${now.folder ?? "the folder the backups are in"} in ${fileBrowser}` }),
        h("span.spacer"),
        secondary("Close", leave),
        primary("Back up now", () => act("backUpRadio", radio.folder), { disabled: !radio || Boolean(backing), probe: "radio back up", help: radio ? "Backs up the radio's card now" : "Plug the radio in first" }),
      ),
    );
  }
  draw();
  close = showSheet(body, { onEscape: leave });
  // From now on the app looks for the radio by itself.
  act("watchForRadios");
  offs.push(hangar.hear("changed", async () => {
    app.state.radio = await ask("radioNow");
    draw();
  }));
  offs.push(hangar.hear("radio", (share) => { if (bar) bar.style.width = `${Math.round(share * 100)}%`; }));
  return { leave };
}
