// A card from the goggles or a camera, plugged in to this computer: which disks are cards, and
// the recordings on them (see shared/cards.js).
//
//   --cards <folder>   take each folder inside this one to be a card, for trying this out without
//                      one. A copy that shows no window looks nowhere else.

import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { argument } from "./paths.js";
import { videoExtensions } from "./library.js";
import { notRecordings, newestFirst, isCardOnMac, removableOnWindows } from "../shared/cards.js";

/** Gives up on a disk that takes too long to answer: a letter with nothing behind it can. */
const soon = (work, wait = 2000, otherwise = null) => Promise.race([work.catch(() => otherwise), new Promise((done) => setTimeout(() => done(otherwise), wait))]);

/** What a program says, or nothing when it fails or takes too long. */
const said = (program, parts) => new Promise((done) => {
  execFile(program, parts, { encoding: "utf8", timeout: 6000, windowsHide: true }, (error, out) => done(error ? null : out));
});

/** The disks that are cards, each `{ name, folder }`: the ones that come out of a reader. A disk on
 *  a cable or a folder on a network can be full of videos that are nothing to do with flying. */
async function disks() {
  const given = argument("--cards");
  if (given) {
    const names = await soon(readdir(resolve(given)), 2000, []);
    return names.filter((name) => !name.startsWith(".")).sort().map((name) => ({ name, folder: join(resolve(given), name) }));
  }
  const found = [];
  if (process.platform === "darwin") {
    for (const name of (await soon(readdir("/Volumes"), 2000, [])).sort()) {
      if (name.startsWith(".")) continue;
      const folder = join("/Volumes", name);
      // The disk the Mac starts from is listed there too, as a way to "/".
      if ((await soon(realpath(folder))) === "/") continue;
      const told = await said("/usr/sbin/diskutil", ["info", "-plist", folder]);
      if (told && isCardOnMac(told)) found.push({ name, folder });
    }
  } else if (process.platform === "win32") {
    // Windows knows which of its disks are removable. Asking it takes a moment, and shows nothing.
    const told = await said("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID + '|' + $_.VolumeName }"]);
    for (const disk of removableOnWindows(told ?? "")) if ((await soon(stat(disk.folder)))?.isDirectory()) found.push(disk);
  }
  return found;
}

/** The recordings on a disk: at its top, and in folders up to two deep, which is where goggles
 *  and cameras put them. Looking stops after a while on a disk with a great deal on it. */
async function recordingsOn(folder) {
  const found = [];
  let looked = 0;
  const started = Date.now();
  const look = async (place, deep) => {
    if (looked >= 300 || Date.now() - started > 4000) return;
    looked += 1;
    const entries = await soon(readdir(place, { withFileTypes: true }), 2000, []);
    const inside = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || notRecordings.has(entry.name.toLowerCase())) continue;
      if (entry.isDirectory()) inside.push(entry.name);
      else if (entry.isFile() && videoExtensions.has(extname(entry.name).slice(1).toLowerCase())) {
        const facts = await soon(stat(join(place, entry.name)));
        if (facts && facts.size > 0) found.push({ path: join(place, entry.name), name: entry.name, bytes: facts.size, modified: Math.round(facts.mtimeMs) });
      }
    }
    if (deep < 2) for (const name of inside.sort()) await look(join(place, name), deep + 1);
  };
  await look(folder, 0);
  return newestFirst(found).slice(0, 400);
}

let last = { at: 0, cards: [] };

/** The cards plugged in, each `{ name, folder, recordings }`. A disk with no recordings on it
 *  isn't one. Asked again within a few seconds, it says what it found the last time. */
export async function findCards({ quiet = false, again = false } = {}) {
  if (quiet && !argument("--cards")) return [];
  if (!again && Date.now() - last.at < 4000) return last.cards;
  const cards = [];
  for (const disk of await disks()) {
    const recordings = await recordingsOn(disk.folder);
    if (recordings.length > 0) cards.push({ ...disk, recordings });
  }
  last = { at: Date.now(), cards };
  return cards;
}
