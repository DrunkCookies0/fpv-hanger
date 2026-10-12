// The copy of the library kept in Google Drive: finding Drive's folder on this computer, and
// copying into it whatever the library has that the copy hasn't (see shared/drive.js).
//
// Drive for desktop does the uploading, whether or not the app is open. All the app does is put
// files in a folder, so it never signs in to anything and never sees a password.
//
//   --drive <folder>   take this folder to be where Drive shows a pilot's files, for trying this
//                      out without Drive. A copy that shows no window looks nowhere else.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, statfs, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { argument, config, setConfig, log } from "./paths.js";
import { bytes } from "./library.js";
import { belongs, copyRoot, driveAccount, isWithin, kindOf, myDrive, plan, whyNot } from "../shared/drive.js";

const mac = process.platform === "darwin";

/** What a file is, or null when it isn't there or can't be looked at. */
async function facts(path) {
  try {
    const found = await stat(path);
    return { size: found.size, modified: Math.round(found.mtimeMs), folder: found.isDirectory() };
  } catch {
    return null;
  }
}

/** The same, but giving up after a moment: a drive letter with nothing behind it can take a long
 *  time to say so. */
const factsSoon = (path, wait = 1500) => Promise.race([facts(path), new Promise((done) => setTimeout(() => done(null), wait))]);

/** Where Drive for desktop shows a pilot's own files on this computer, each `{ folder, account }`.
 *  The account is only told on a Mac, where the folder is named after it. */
export async function findDrive({ quiet = false } = {}) {
  const given = argument("--drive");
  if (given) return [{ folder: resolve(given), account: "" }];
  if (quiet) return [];
  const found = [];
  const take = async (folder, account = "") => {
    if ((await factsSoon(folder))?.folder && !found.some((one) => one.folder === folder)) found.push({ folder, account });
  };
  if (mac) {
    // macOS gives each account's Drive a folder of its own here. Only the names are read: looking
    // inside one is what macOS asks the pilot about, and that waits until they ask for a copy.
    const place = join(homedir(), "Library", "CloudStorage");
    let names = [];
    try {
      names = await readdir(place);
    } catch {}
    for (const name of names.sort()) {
      const account = driveAccount(name);
      if (account) found.push({ folder: join(place, name, myDrive), account });
    }
    // Before that, Drive was a disk of its own.
    await take(join("/Volumes", "GoogleDrive", myDrive));
  } else if (process.platform === "win32") {
    // Drive is a disk with a letter of its own, G: unless the pilot chose another, or a folder in
    // the pilot's own when it is set to keep everything on the computer too.
    const letters = "GHIJKLMNOPQRSTUVWXYZDEF".split("");
    await Promise.all(letters.map((letter) => take(`${letter}:\\${myDrive}`)));
    found.sort((a, b) => letters.indexOf(a.folder[0]) - letters.indexOf(b.folder[0]));
    await take(join(homedir(), myDrive));
  }
  return found;
}

/** Every file in a folder that belongs in the copy, each `{ path, size, modified }` with its path
 *  from the folder and "/" between the parts. */
async function filesIn(folder, options, under = "") {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(join(folder, under), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // A folder is looked into when a file in it could belong.
      if (belongs(`${path}/x`, options)) found.push(...await filesIn(folder, options, path));
    } else if (entry.isFile() && belongs(path, options)) {
      const file = await facts(join(folder, path));
      if (file) found.push({ path, size: file.size, modified: file.modified });
    }
  }
  return found;
}

/** What went wrong with a file, in words. */
function reason(error, place) {
  if (error.code === "ENOSPC") return "there isn't room for it";
  if (error.code === "EACCES" || error.code === "EPERM") {
    return mac ? `this Mac hasn't let FPV Hangar into ${place}. Allow it in System Settings, under Privacy & Security, Files and Folders` : `FPV Hangar isn't allowed to save in ${place}`;
  }
  if (error.code === "ENOENT") return "the folder has gone";
  return error.message;
}

/**
 * Keeps the copy. `library` is asked where the library is each time, since a pilot can move it.
 * The pages hear how it is going as "drive" news. `busy` says when the app is making something:
 * a round waits for that, so a video or a recording is never copied half-written.
 */
export function makeDriveCopy({ library, tell, quiet = false, busy = () => false }) {
  /** Where Drive is on this computer, as last looked for. */
  let found = [];
  /** A round of copying under way: how far it has got. */
  let round = null;
  /** True when something changed while a round was under way, so another follows it. */
  let again = false;
  /** How the last round ended: `{ at, held, heldBytes, kinds, failed: [{ path, why }], problem }`. */
  let last = null;
  let timer = null, stopping = null, told = 0;

  const chosen = () => config().copyTo ?? null;
  const recordings = () => config().copyLeavesOutRecordings !== true;
  const place = () => (config().copyIsInDrive === true || found.some((one) => chosen() && isWithin(chosen(), one.folder)) ? "Google Drive" : "the folder");

  function now() {
    const folder = chosen();
    const kind = !folder ? "off" : round ? "copying" : last?.problem ? "problem" : last ? "kept" : "waiting";
    return {
      kind, found, folder,
      root: folder ? copyRoot(folder, join) : null,
      /** True when the copy is somewhere Drive shows, so far as can be told. */
      inDrive: folder ? place() === "Google Drive" : false,
      recordings: recordings(),
      // Sizes are sent in words, as a file browser gives them.
      round: round && { ...round, had: bytes(round.bytes), of: bytes(round.all) },
      last: last && { ...last, size: bytes(last.heldBytes) },
    };
  }

  /** Tells the pages, not more than a few times a second while files are going across. */
  function say(always = true) {
    if (!always && Date.now() - told < 200) return;
    told = Date.now();
    tell("drive", now());
  }

  async function look() {
    found = await findDrive({ quiet });
    return found;
  }

  /** Copies one file into the copy, under a name of its own until it is whole. */
  async function copy(file, from, to) {
    await mkdir(dirname(to), { recursive: true });
    const part = `${to}.part`;
    const before = round.bytes;
    try {
      await pipeline(
        createReadStream(from, { highWaterMark: 4 << 20 }),
        async function* count(pieces) {
          for await (const piece of pieces) {
            round.bytes += piece.length;
            round.share = file.size > 0 ? Math.min(1, (round.bytes - before) / file.size) : 1;
            say(false);
            yield piece;
          }
        },
        createWriteStream(part),
        { signal: stopping.signal },
      );
      // A file that was being written while it was read isn't the file: it is left for next time.
      const after = await facts(from);
      if (!after || after.size !== file.size || after.modified !== file.modified) throw Object.assign(new Error("it changed while it was being copied"), { code: "CHANGED" });
      await utimes(part, new Date(), new Date(file.modified));
      await rename(part, to);
    } catch (error) {
      round.bytes = before;
      await rm(part, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** One round: everything the library has that the copy hasn't. */
  async function go() {
    const folder = chosen();
    if (!folder) return;
    const root = copyRoot(folder, join), from = library.root;
    const refused = whyNot(folder, from, join);
    if (refused) {
      last = { at: Date.now(), held: 0, heldBytes: 0, kinds: {}, failed: [], problem: refused };
      return;
    }
    // Drive's folder is only there while Drive is running.
    if (!(await factsSoon(folder, 4000))?.folder) {
      last = { ...(last ?? { held: 0, heldBytes: 0, kinds: {} }), at: Date.now(), failed: [], problem: `${place() === "Google Drive" ? "Google Drive isn't open on this computer, or it is signed out" : "The folder isn't there"}. Nothing was copied.`, away: true };
      return;
    }
    stopping = new AbortController();
    round = { file: null, done: 0, files: 0, bytes: 0, all: 0, share: 0 };
    say();
    const failed = [];
    let problem = null, counted = { held: 0, heldBytes: 0, kinds: {} };
    try {
      const all = await filesIn(from, { recordings: recordings() });
      // A file that was written to a moment ago may still be being written: it waits for the next round.
      const files = all.filter((file) => Date.now() - file.modified > 5000);
      if (files.length < all.length) again = true;
      const copies = new Map();
      for (const file of files) {
        const there = await facts(join(root, file.path));
        if (there && !there.folder) copies.set(file.path, there);
      }
      const todo = plan(files, copies);
      Object.assign(round, { files: todo.due.length, all: todo.bytes });
      const going = new Set(todo.due);
      const kept = files.filter((file) => !going.has(file));
      counted = { held: kept.length, heldBytes: todo.heldBytes, kinds: {} };
      for (const file of kept) counted.kinds[kindOf(file.path)] = (counted.kinds[kindOf(file.path)] ?? 0) + 1;
      say();
      if (todo.due.length > 0) {
        // Drive holds a file on this computer until it has been uploaded, so there has to be room.
        try {
          await mkdir(root, { recursive: true });
          const disk = await statfs(root);
          const free = Number(disk.bavail) * Number(disk.bsize), biggest = todo.due.at(-1).size;
          if (free > 0 && free < biggest + 200_000_000) problem = `There isn't room to copy ${todo.due.at(-1).path.split("/").pop()}: ${bytes(biggest)} is needed and ${bytes(free)} is free.`;
        } catch (error) {
          problem = `Nothing could be saved in ${place()}: ${reason(error, place())}.`;
        }
      }
      for (const file of problem ? [] : todo.due) {
        if (stopping.signal.aborted) break;
        // The app has started making something: the rest waits until that is done.
        if (busy()) {
          again = true;
          break;
        }
        Object.assign(round, { file: file.path, share: 0 });
        say();
        try {
          await copy(file, join(from, file.path), join(root, file.path));
          round.done += 1;
          counted.held += 1;
          counted.heldBytes += file.size;
          counted.kinds[kindOf(file.path)] = (counted.kinds[kindOf(file.path)] ?? 0) + 1;
        } catch (error) {
          if (stopping.signal.aborted) break;
          if (error.code === "CHANGED") {
            again = true;
            continue;
          }
          failed.push({ path: file.path, why: reason(error, place()) });
          log(`Copying ${file.path} to ${place()}: ${error.message}`);
          // What stops one file for these reasons stops them all.
          if (["ENOSPC", "EACCES", "EPERM"].includes(error.code)) break;
        }
      }
    } catch (error) {
      problem = `The copy couldn't be looked at: ${error.message}`;
      log(`Keeping the copy in ${place()}: ${error.stack ?? error.message}`);
    }
    const stopped = stopping.signal.aborted;
    round = null;
    stopping = null;
    if (!problem && failed.length > 0) problem = failed.length === 1 ? `${failed[0].path.split("/").pop()} couldn't be copied: ${failed[0].why}.` : `${failed.length} files couldn't be copied. The first was ${failed[0].path.split("/").pop()}: ${failed[0].why}.`;
    last = stopped ? last : { at: Date.now(), ...counted, failed, problem };
  }

  let running = null;
  /** Starts a round, or has one follow the round under way. Comes back when there is nothing left to do. */
  function pass() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          while (busy() && chosen()) await new Promise((done) => setTimeout(done, 1000));
          await go();
          // A file that changed under the copying is given a moment to be finished with.
          if (again && chosen()) await new Promise((done) => setTimeout(done, 3000));
        } while (again && chosen());
      } finally {
        running = null;
        say();
      }
    })();
    return running;
  }

  return {
    now, look,

    /** A round in a moment: after recordings are added, a video is made, or markers are saved.
     *  Long enough that what was just written counts as finished. */
    soon(wait = 6000) {
      if (!chosen()) return;
      clearTimeout(timer);
      timer = setTimeout(() => pass(), wait);
    },

    pass,

    /** As the app opens: looks for Drive, and catches the copy up with the library. */
    async start() {
      await look();
      say();
      if (!quiet) this.soon(4000);
    },

    /** Keeps the copy in a folder from now on: `inDrive` when it is one Drive was found at. Gives
     *  what is wrong with the folder, or null. */
    async use(folder, inDrive = false) {
      const refused = whyNot(folder, library.root, join);
      if (refused) return refused;
      if (!(await factsSoon(folder, 4000))?.folder) {
        return inDrive ? "Google Drive's folder couldn't be opened. Check that Drive for desktop is open and signed in, or press Use another folder and pick the folder yourself." : "That folder isn't there.";
      }
      // A round going to another folder is stopped where it is.
      stopping?.abort();
      await running;
      setConfig({ copyTo: folder, copyIsInDrive: inDrive });
      last = null;
      say();
      pass();
      return null;
    },

    /** Stops keeping the copy. What has been copied stays where it is. */
    async stop() {
      clearTimeout(timer);
      setConfig({ copyTo: null, copyIsInDrive: false });
      stopping?.abort();
      await running;
      last = null;
      say();
    },

    /** Whether the recordings go in the copy, which they do unless told otherwise. */
    setRecordings(wanted) {
      setConfig({ copyLeavesOutRecordings: !wanted });
      last = null;
      say();
      if (chosen()) pass();
    },
  };
}
