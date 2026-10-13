// Putting a file into the library whole: a recording added, a finished video, an event's logo.
//
// A file is written somewhere else first, so that a half-written one is never taken for a whole
// one, and then moved into place. When the library is in Google Drive, where it is written first
// matters. Drive for desktop takes in whatever appears in its folder, and while it takes in a folder
// that is new, the folder can be gone for a moment, along with a file still being written in it.
// So a file is written in a folder of the app's own on the same disk (`staging`), outside Drive,
// and moved into the library in one step at the end. Where that folder isn't on the library's disk,
// as with Drive's own drive letter on Windows, the file is written beside where it goes, under a
// name that ends in .part, and renamed. Either way, if the folder or the file isn't there for a
// moment, it is tried again a few times before giving up.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** What the disk says when a folder or a file is gone for a moment, or is busy. */
const brief = new Set(["ENOENT", "EBUSY", "EPERM", "EAGAIN"]);

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** The disk a folder is on, by the nearest folder above it that is there. */
function diskOf(folder) {
  for (let place = folder; ; place = dirname(place)) {
    try {
      return statSync(place).dev;
    } catch {}
    if (dirname(place) === place) return null;
  }
}

/** Where a file that is to end up at `target` is written first. */
function firstPlace(target, staging) {
  if (staging) {
    try {
      mkdirSync(staging, { recursive: true });
      if (diskOf(staging) === diskOf(dirname(target))) return join(staging, `${Date.now()}-${Math.random().toString(36).slice(2, 8)} ${basename(target)}`);
    } catch {}
  }
  return `${target}.part`;
}

/**
 * Moves a whole file into place at `target`, making the folder it goes in if need be. If the folder
 * or the file is gone for a moment, it is tried again. If `file` turns out to be on another disk, it
 * is copied beside `target` first. Throws what went wrong in the end, with `gone` set when it was
 * `file` itself that went.
 */
export async function place(file, target, { tries = 4, wait = 1500 } = {}) {
  let from = file, last = null;
  try {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      if (attempt > 0) await pause(wait * attempt);
      try {
        mkdirSync(dirname(target), { recursive: true });
        try {
          renameSync(from, target);
        } catch (error) {
          if (error.code !== "EXDEV") throw error;
          // Another disk: copied beside where it goes, and renamed there.
          const beside = `${target}.part`, facts = statSync(from);
          copyFileSync(from, beside);
          utimesSync(beside, facts.atime, facts.mtime);
          rmSync(from, { force: true });
          from = beside;
          renameSync(from, target);
        }
        return;
      } catch (error) {
        if (!brief.has(error.code)) throw error;
        if (!existsSync(from)) throw Object.assign(error, { gone: true });
        last = error;
      }
    }
    throw last;
  } finally {
    if (from !== file) rmSync(from, { force: true });
  }
}

/**
 * Writes a file and puts it in place at `target`. `write` is given the path to write the whole file
 * to, and finishes when it has. If the folder it is written in is gone for a moment, or the file is
 * lost before it is in place, it is written again, up to `tries` times in all. `staging` is the
 * app's own folder for this, outside the library.
 */
export async function land(target, write, { staging = null, tries = 3, wait = 1500 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt > 0) await pause(wait * attempt);
    const first = firstPlace(target, staging);
    try {
      mkdirSync(dirname(first), { recursive: true });
      await write(first);
    } catch (error) {
      rmSync(first, { force: true });
      if (!brief.has(error.code)) throw error;
      last = error;
      continue;
    }
    try {
      await place(first, target, { wait });
      return;
    } catch (error) {
      rmSync(first, { force: true });
      if (!error.gone) throw error;
      last = error;
    }
  }
  throw last;
}

/** The same for a small file written all at once, such as what the app remembers: written beside
 *  where it goes, under .part, and renamed, and tried again a few times if the folder is gone for a
 *  moment. The waiting holds everything else up, which is why it is short. */
export function landNow(target, text, { tries = 4, wait = 250 } = {}) {
  const part = `${target}.part`;
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * attempt);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(part, text);
      renameSync(part, target);
      return;
    } catch (error) {
      rmSync(part, { force: true });
      if (!brief.has(error.code)) throw error;
      last = error;
    }
  }
  throw last;
}

/** Empties the app's own folder for files on their way into the library. Anything in it is what a
 *  copy of the app left there when it was stopped part way through. */
export function clearStaging(staging) {
  try {
    for (const name of readdirSync(staging)) rmSync(join(staging, name), { recursive: true, force: true });
  } catch {}
}
