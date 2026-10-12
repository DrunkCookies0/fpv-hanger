// The library in Google Drive, and the copy of it kept in a folder, as the pilot sees them: their
// cards in Pilot & settings, and the word about the copy at the head of a track's page.

import { app, ask, take, render, open, go } from "../core.js";
import { h, icon, label, primary, secondary, fill, when } from "../ui.js";
import { confirm } from "../sheets.js";
import { fileBrowser, computer } from "../words.js";

/** Where Google gives out its program that shows a Drive as a folder. */
const driveForDesktop = "https://www.google.com/drive/download/";

const leaf = (path) => path.split(/[\\/]/).pop();
const some = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const listed = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "");

/** What the copy holds, in words: "5 recordings, 4 videos and 14 other files". */
function holds(last) {
  const kinds = last.kinds ?? {};
  const parts = [
    kinds.recordings && some(kinds.recordings, "recording", "recordings"),
    kinds.videos && some(kinds.videos, "finished video", "finished videos"),
    kinds["the rest"] && some(kinds["the rest"], kinds.recordings || kinds.videos ? "other file" : "file", kinds.recordings || kinds.videos ? "other files" : "files"),
  ].filter(Boolean);
  return listed(parts);
}

/** How the copy is doing, in a line. */
function status(drive) {
  const where = drive.inDrive ? "Google Drive" : "the copy";
  if (drive.kind === "copying") {
    const round = drive.round;
    if (round.files === 0) return h("span.dim", "Looking at what there is to copy…");
    const share = round.all > 0 ? Math.floor((round.bytes / round.all) * 100) : 0;
    return h("span.accent", `Copying ${Math.min(round.done + 1, round.files)} of ${round.files}${round.file ? `: ${leaf(round.file)}` : ""}, ${round.had} of ${round.of} (${share}%)`);
  }
  if (drive.kind === "problem") return h("span.warn.row.tight", icon("warning"), h("span", drive.last.problem));
  if (drive.kind === "kept") {
    return h("span.good.row.tight", icon("checkCircle"), h("span", drive.last.held === 0 ? `There is nothing to copy yet. Looked ${when(drive.last.at).replace(/^T/, "t").replace(/^Y/, "y")}.` : `${where === "Google Drive" ? "Everything has been handed to Google Drive" : "Everything is in the copy"}: ${holds(drive.last)}, ${drive.last.size}. Looked ${when(drive.last.at).replace(/^T/, "t").replace(/^Y/, "y")}.`));
  }
  return h("span.dim", "Looking…");
}

async function keep(folder = null) {
  take(await ask("keepCopy", folder));
  render();
}

/** What keeping the library in Drive is, in a few words. */
const sharing = `Keep your library in Google Drive and open the same one on each of your computers: your Mac and your PC see the same tracks, recordings, markers, music and videos. Google's own Drive for desktop uploads what you do and brings down what the other computer did, so FPV Hangar never signs in to anything.`;

/** The cards in Pilot & settings: the library in Google Drive, and the copy when one is kept. */
export function driveCard() {
  const drive = app.state?.drive;
  if (!drive) return null;
  return [libraryCard(drive), drive.kind !== "off" && copyCard(drive)];
}

const keepElsewhere = (drive) => drive.kind === "off" && secondary("Keep a copy in another folder…", () => keep(), { probe: "drive copy", help: "Keep a second copy of your library in any folder: another disk, say. It is copied into by itself, after you add recordings or make a video." });

function libraryCard(drive) {
  const library = drive.library;
  if (library.inDrive) {
    return h("div.card", { "data-probe": "drive card" },
      label("GOOGLE DRIVE"),
      h("div.path.dim", app.state.library),
      h("div.small.semibold", { id: "drive-library" }, library.away
        ? h("span.warn.row.tight", icon("warning"), h("span", app.state.libraryAway))
        : h("span.good.row.tight", icon("checkCircle"), h("span", `Your library is in Google Drive${library.account ? `, ${library.account}'s` : ""}.`))),
      h("p.dim.small", "Every computer that opens it sees the same tracks, recordings, markers, music and videos. Drive for desktop uploads what you do here and brings down what you did on the other computer, by itself. What the other computer did shows here when you come back to this window."),
      h("p.faint.small", `If both computers change the same thing before Drive has passed it across, the one saved last is kept. A recording made on the other computer comes down from Drive the first time it is opened on this one, which takes as long as downloading it.`),
      h("div.row.tight.wrap",
        secondary(`Show in ${fileBrowser}`, () => ask("openFolder", app.state.library)),
        keepElsewhere(drive),
      ),
    );
  }
  return h("div.card", { "data-probe": "drive card" },
    label("GOOGLE DRIVE"),
    h("p.dim.small", sharing),
    drive.found.length > 0
      ? h("div.row.tight.wrap",
        drive.found.map((one, index) => (index === 0 ? primary : secondary)(drive.found.length > 1 && one.account ? `Keep my library in ${one.account}'s Drive` : "Keep my library in Google Drive", () => toDrive(one.folder), { icon: "cloud", probe: "drive library", disabled: Boolean(app.state.job) })),
        keepElsewhere(drive),
      )
      : [
        h("p.small", `Google Drive isn't on this ${computer}, or it isn't open. Get Drive for desktop from Google, sign in to it, and then look again.`),
        h("div.row.tight.wrap",
          secondary("Get Drive for desktop", () => ask("openLink", driveForDesktop), { icon: "arrowUpRight", help: "Opens Google's page for it in your browser." }),
          secondary("Look again", async () => {
            take(await ask("lookForDrive"));
            render();
          }, { probe: "drive look" }),
          keepElsewhere(drive),
        ),
      ],
    drive.found.length === 1 && drive.found[0].account && h("p.faint.small", `Google Drive on this ${computer} is signed in as ${drive.found[0].account}.`),
  );
}

/** Puts the library in Google Drive: moves it there, or, when the other computer has already,
 *  uses that one. Asks first either way. */
async function toDrive(folder) {
  const look = take(await ask("lookInDrive", folder));
  if (!look || look.problem) return render();
  const mine = look.mine;
  let answer;
  if (look.there) {
    if (!await confirm({
      title: "Use the library in Google Drive?",
      message: `Your other computer keeps its library in your Google Drive. This ${computer} will use it from now on, so both see the same tracks.${mine.tracks > 0 ? ` The ${some(mine.tracks, "track", "tracks")} in this ${computer}'s own library stay where they are, in ${app.state.library}, and aren't added to it.` : ""}`,
      yes: "Use it",
    })) return;
    answer = take(await ask("useLibraryInDrive", folder));
  } else {
    if (!await confirm({
      title: "Move your library into Google Drive?",
      message: `It goes into a folder called ${app.state.drive.library.name} in your Drive: ${some(mine.tracks, "track", "tracks")}, ${some(mine.recordings, "recording", "recordings")}, ${mine.size} in all. FPV Hangar uses it from there, and Drive for desktop uploads it, which takes a while for recordings. A free Google account holds 15 GB. Then, on your other computer, press Keep my library in Google Drive there too.`,
      yes: "Move it",
    })) return;
    answer = take(await ask("moveLibraryToDrive", folder));
  }
  if (answer?.moved) {
    // Another library: nothing read from the one before is any good.
    app.tracks.clear();
    app.forms.clear();
    app.expanded.clear();
    app.page = { name: "home" };
    app.cameFrom = { name: "home" };
    go({ name: "settings" });
  }
  render();
}

/** The card for the copy, while one is kept. */
function copyCard(drive) {
  const what = "Keeps a second copy of your library: every recording you add and every video you make, with their markers and music, in the same folders as here (the event, then the track).";
  const busy = drive.kind === "copying";
  return h("div.card", { "data-probe": "copy card" },
    label(drive.inDrive ? "A COPY IN GOOGLE DRIVE" : "A SECOND COPY"),
    h("div.path.dim", drive.root),
    h("div.small.semibold", { id: "drive-status" }, status(drive)),
    h("p.dim.small", drive.inDrive
      ? `${what} Google Drive uploads it from there by itself, whether or not FPV Hangar is open, and shows how far it has got under its own icon.`
      : what),
    h("label.check", h("input", { type: "checkbox", checked: drive.recordings, "data-probe": "drive recordings", onchange: async (event) => {
      take(await ask("copyRecordings", event.target.checked));
      render();
    } }), "Copy the recordings too", h("span.faint", "  They are most of a library's size. One already copied stays.")),
    h("div.row.tight.wrap",
      secondary("Copy now", async () => {
        take(await ask("copyNow"));
        render();
      }, { disabled: busy, probe: "drive now", help: "Looks through your library and copies whatever the copy hasn't got. It also does this by itself, after you add recordings or make a video." }),
      secondary(`Show in ${fileBrowser}`, () => ask("openFolder", drive.root)),
      secondary("Stop keeping a copy", async () => {
        take(await ask("stopCopy"));
        render();
      }, { probe: "drive stop", help: "Nothing more is copied. What is in the copy stays there." }),
    ),
    h("p.faint.small", "Nothing is ever taken out of the copy: a file you delete here stays there until you delete it there."),
  );
}

/** A word at the head of a track's page while there is something to say: files going across, or a
 *  problem. Pressing it opens Pilot & settings. */
export function driveWord() {
  const drive = app.state?.drive;
  if (!drive || drive.kind === "off" || drive.kind === "waiting") return null;
  const where = drive.inDrive ? "Google Drive" : "The copy";
  const says = drive.kind === "copying"
    ? (drive.round.files === 0 ? `${where}: looking…` : `${where}: copying ${Math.min(drive.round.done + 1, drive.round.files)} of ${drive.round.files}`)
    : drive.kind === "problem" ? `${where}: not copied` : `${where}: all copied`;
  return h(`button.drive-word.${drive.kind}`, {
    type: "button", id: "drive-word", "data-probe": "drive word",
    help: drive.kind === "problem" ? drive.last.problem : "A second copy of your library is kept. Open Pilot & settings for more.",
    onclick: () => open({ name: "settings" }),
  }, icon(drive.kind === "problem" ? "warning" : "cloud", 13), says);
}

/** News of the copy from the main process. While files are going across only the words change,
 *  so what is being typed on the page is left alone. */
export function heardDrive(now) {
  if (!app.state) return;
  const before = app.state.drive;
  app.state.drive = now;
  const line = document.getElementById("drive-status"), word = document.getElementById("drive-word");
  if (before && before.kind === now.kind && now.kind === "copying" && before.round?.files === now.round?.files) {
    if (line) fill(line, status(now));
    if (word) word.replaceWith(driveWord());
    return;
  }
  if (line || word || app.page.name === "settings" || app.page.name === "track") render();
}
