// The radio's own SD card, backed up whenever the radio is plugged in to this computer with USB
// Storage (SD) chosen on it. EdgeTX keeps all of a radio's models and settings on that card, with
// its themes, widgets, scripts and sounds, so a copy of the card is a way back from anything: new
// firmware that goes wrong, settings written over from Companion, a card that fails.
//
// The card is only read. Each backup is a folder in Documents/EdgeTX/backups, beside the backups
// Companion makes of the radio's firmware, and is laid out as the card is: it is put back by
// copying it onto the card, or opened in Companion with Read Models and Settings from SD Path. A
// file that hasn't changed since the last backup is linked to its copy there rather than copied
// again, so a backup takes little room, and a backup that finds nothing changed isn't kept.
//
// The app starts looking for the radio the first time the pilot opens Radio backups, or puts EdgeTX
// Companion in place or opens it, and keeps looking from then on. Until then it reads nothing on
// any disk: a Mac asks the pilot before an app reads a removable disk, and the pilot shouldn't be
// asked for a radio they don't have.
//
//   --radios <folder>          take each folder inside this one to be a radio's card
//   --radio-backups <folder>   keep backups in this folder
// Both are for trying this out without a radio. A copy that shows no window doesn't look by itself.

import { app, shell } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, link, mkdir, readFile, readdir, realpath, rename, rm, stat, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argument, config, setConfig, log } from "./paths.js";
import { radioFacts, radioName, backupName, copyOrder, unchanged, somethingChanged } from "../shared/radio.js";

/** Gives up on a disk that takes too long to answer, as a network drive can. */
const soon = (work, wait = 2000, otherwise = null) => Promise.race([work.catch(() => otherwise), new Promise((done) => setTimeout(() => done(otherwise), wait))]);

/** Where the backups are kept: the folder Companion backs a radio's firmware up to. */
export const backupsFolder = () => resolve(argument("--radio-backups") ?? join(app.getPath("documents"), "EdgeTX", "backups"));

/** Disks that took too long to answer, as a network drive can, left alone a while: a question
 *  that doesn't come back holds on to one of the few the app can ask at once. */
const slow = new Map();

/** The disks that might be a radio's card: every one on a Mac, each drive letter on Windows. */
async function disks() {
  const given = argument("--radios");
  if (given) return (await soon(readdir(resolve(given)), 2000, [])).filter((name) => !name.startsWith(".")).sort().map((name) => ({ disk: name, folder: join(resolve(given), name) }));
  if (process.platform === "darwin") return (await soon(readdir("/Volumes"), 2000, [])).filter((name) => !name.startsWith(".")).sort().map((name) => ({ disk: name, folder: join("/Volumes", name) }));
  if (process.platform === "win32") return [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => ({ disk: `${letter}:`, folder: `${letter}:\\` }));
  return [];
}

/** The radios' cards plugged in, `{ radios, barred }`: each radio `{ folder, disk, board, version }`,
 *  a disk with a radio's settings at RADIO/radio.yml, and the disks the Mac hasn't let the app read. */
async function findRadios() {
  const radios = [], barred = [];
  for (const one of await disks()) {
    if (slow.get(one.folder) > Date.now()) continue;
    const started = Date.now();
    // The disk the Mac starts from is listed in /Volumes too, as a way to "/".
    const theMac = process.platform === "darwin" && !argument("--radios") && (await soon(realpath(one.folder))) === "/";
    const text = theMac ? null : await soon(readFile(join(one.folder, "RADIO", "radio.yml"), "utf8").catch((error) => error), 1500);
    if (Date.now() - started >= 1500) slow.set(one.folder, Date.now() + 5 * 60 * 1000);
    if (typeof text === "string") radios.push({ ...one, ...radioFacts(text) });
    else if (text?.code === "EPERM" || text?.code === "EACCES") barred.push(one.disk);
  }
  return { radios, barred };
}

/** Everything on a card, its settings and models first: the folders, and the files with their sizes and times. */
async function onCard(folder) {
  const folders = [], files = [];
  const walk = async (inside, deep) => {
    const entries = await readdir(join(folder, inside), { withFileTypes: true });
    const named = new Map(entries.map((entry) => [entry.name, entry]));
    for (const name of copyOrder([...named.keys()], deep === 0)) {
      const entry = named.get(name), path = inside ? join(inside, name) : name;
      if (entry.isDirectory() && deep < 12) {
        folders.push(path);
        await walk(path, deep + 1);
      } else if (entry.isFile()) {
        const facts = await stat(join(folder, path));
        files.push({ path, size: facts.size, mtimeMs: facts.mtimeMs, atime: facts.atime, mtime: facts.mtime });
        if (files.length > 100000) throw new Error("it has far more on it than a radio's card would");
      }
    }
  };
  await walk("", 0);
  return { folders, files };
}

/**
 * The radio's backups as the app's pages ask for them: `radioNow`, `backUpRadio`,
 * `showRadioBackups`, `showRadioBackup` and `lookForRadios`. While the app is open it looks for a
 * radio every few seconds, and backs up one it hasn't seen since it was plugged in. The pages
 * hear "changed", and "radio" with how far a backup has got, 0 to 1.
 */
export function makeRadio({ tell, quiet }) {
  /** The radios plugged in when last looked, the folders of those already seen, and the disks the
   *  Mac hasn't let the app read. */
  let radios = [], seen = new Set(), barred = [];
  /** The backup under way: `{ folder, board, share, bytes }`. */
  let backing = null;
  /** What happened to the last backup: `{ board, at, kept, unchanged }`, or what went wrong. */
  let last = null, problem = null;
  const waiting = new Set();
  let queue = Promise.resolve();

  /** The backups made, newest first, that are still where they were put. */
  const records = () => (config().radioBackups ?? []).filter((one) => typeof one?.folder === "string" && existsSync(one.folder));

  async function backUp(radio) {
    const root = backupsFolder(), name = radioName(radio.board);
    // What is on the card is looked at before anything is copied, to say how far along it is.
    const { folders, files } = await onCard(radio.folder);
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const previous = records().find((one) => one.board === radio.board) ?? null;
    backing = { folder: radio.folder, board: radio.board, share: 0, bytes };
    tell("changed");
    await mkdir(root, { recursive: true });
    const title = backupName(radio.board, new Date()), working = join(root, `${title} (not finished)`);
    let copied = 0, done = 0, told = 0;
    const heard = (size) => {
      done += size;
      backing.share = bytes ? done / bytes : 1;
      if (backing.share - told >= 0.01) {
        told = backing.share;
        tell("radio", backing.share);
      }
    };
    try {
      await mkdir(working, { recursive: true });
      for (const folder of folders) await mkdir(join(working, folder), { recursive: true });
      for (const file of files) {
        const to = join(working, file.path), before = previous ? join(previous.folder, file.path) : null;
        // A file as it was at the last backup is the same file there: linked, not copied again.
        if (before && unchanged(file, await stat(before).catch(() => null))) {
          try {
            await link(before, to);
            heard(file.size);
            continue;
          } catch {}
        }
        await copyFile(join(radio.folder, file.path), to);
        await utimes(to, file.atime, file.mtime);
        copied += 1;
        heard(file.size);
      }
      if (!somethingChanged(copied, files.length, previous?.files ?? null)) {
        await rm(working, { recursive: true, force: true });
        last = { board: radio.board, at: new Date().toISOString(), kept: previous.folder, unchanged: true };
        return;
      }
      let kept = join(root, title);
      for (let again = 2; existsSync(kept); again += 1) kept = join(root, `${title} ${again}`);
      await rename(working, kept);
      const record = { folder: kept, board: radio.board, version: radio.version, at: new Date().toISOString(), files: files.length, bytes, copied };
      setConfig({ radioBackups: [record, ...records()].slice(0, 200) });
      last = { board: radio.board, at: record.at, kept, unchanged: false };
    } catch (error) {
      await rm(working, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /** Backs up a radio's card once whatever is ahead of it has finished. */
  function backUpRadio(folder) {
    const radio = radios.find((one) => one.folder === folder);
    if (!radio) return Promise.resolve({ state: api.radioNow(), problem: "That radio isn't plugged in." });
    if (waiting.has(folder)) return queue.then(() => ({ state: api.radioNow(), problem: problem }));
    waiting.add(folder);
    queue = queue.then(async () => {
      problem = null;
      try {
        await backUp(radio);
      } catch (error) {
        log(`Backing up a radio: ${error.stack ?? error.message}`);
        const there = await soon(stat(join(radio.folder, "RADIO")));
        problem = there
          ? `${radioName(radio.board)}'s card couldn't be backed up: ${error.message}. Nothing on the radio was changed.`
          : `${radioName(radio.board)} was unplugged before its card was backed up. Plug it in again, with USB Storage (SD) chosen, to back it up.`;
      }
      backing = null;
      waiting.delete(folder);
      tell("changed");
    });
    return queue.then(() => ({ state: api.radioNow(), problem }));
  }

  /** Looks for radios, and starts backing up each one plugged in since the last look. Gives the
   *  backups started, to wait for. */
  async function look() {
    const { radios: now, barred: refused } = await findRadios();
    const fresh = now.filter((one) => !seen.has(one.folder));
    const before = [...radios.map((one) => one.folder), ...barred].join("\n");
    radios = now;
    barred = refused;
    seen = new Set(now.map((one) => one.folder));
    if (before !== [...now.map((one) => one.folder), ...barred].join("\n")) tell("changed");
    return fresh.map((one) => backUpRadio(one.folder));
  }

  /** Looks for a radio every few seconds from now on, and remembers to on the next run too. */
  let timer = null;
  function watch() {
    if (quiet || timer) return;
    let looking = false;
    const round = async () => {
      if (looking) return;
      looking = true;
      try {
        await look();
      } catch (error) {
        log(`Looking for a radio: ${error.stack ?? error.message}`);
      }
      looking = false;
    };
    timer = setInterval(round, 5000);
    timer.unref?.();
    round();
  }

  const api = {
    /** The radios plugged in, the backup under way, and the backups kept. */
    radioNow() {
      const kept = records();
      return {
        radios: radios.map(({ folder, disk, board, version }) => ({ folder, disk, board, version })),
        barred: [...barred],
        watching: Boolean(timer) || config().radioWatch === true,
        backing: backing && { ...backing },
        backups: kept.slice(0, 30),
        count: kept.length,
        folder: backupsFolder(),
        last,
        problem,
      };
    },

    backUpRadio,

    /** Starts looking for the radio, for good: the pilot has shown they have one. */
    watchForRadios() {
      if (config().radioWatch !== true) setConfig({ radioWatch: true });
      watch();
      return api.radioNow();
    },

    /** Looks for radios now. With `wait`, comes back once the backups that starts are done. */
    async lookForRadios(wait = false) {
      const started = await look();
      if (wait) await Promise.all(started);
      return api.radioNow();
    },

    /** Opens the folder the backups are in. */
    async showRadioBackups() {
      mkdirSync(backupsFolder(), { recursive: true });
      return { problem: (await shell.openPath(backupsFolder())) || null };
    },

    /** Opens one backup's folder. */
    async showRadioBackup(folder) {
      if (!records().some((one) => one.folder === folder)) return { problem: "That backup isn't there any more." };
      return { problem: (await shell.openPath(folder)) || null };
    },
  };

  if (config().radioWatch === true) watch();
  return api;
}
