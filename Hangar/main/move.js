// Moving the library to another folder, all of it: into Google Drive's folder, for one.
//
// Where the two folders are on one disk, as on a Mac, the library is simply renamed into its new
// place, which takes a moment and needs no room. Where they aren't, as with Drive's own drive
// letter on Windows, every file is copied, each one checked to be whole, and only then is the old
// folder sent to the Trash, where it can be put back from.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/** What renaming into another folder says when the two aren't on one disk, or the place won't take
 *  a rename from outside it. Copying is tried then. */
const cantRename = new Set(["EXDEV", "EPERM", "ENOTSUP", "EINVAL"]);

/** Every folder and file in a folder, each with its path from that folder as a list of names. What
 *  is being written there just now (`.part` files) and what a Mac leaves in every folder are left out. */
async function everything(folder, under = []) {
  const found = { folders: [], files: [] };
  const entries = await readdir(join(folder, ...under), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = [...under, entry.name];
    if (entry.isDirectory()) {
      found.folders.push(path);
      const inside = await everything(folder, path);
      found.folders.push(...inside.folders);
      found.files.push(...inside.files);
    } else if (entry.isFile() && entry.name !== ".DS_Store" && !entry.name.endsWith(".part")) {
      const facts = await stat(join(folder, ...path));
      found.files.push({ path, size: facts.size, modified: facts.mtime });
    }
  }
  return found;
}

/** What a folder holds, for saying so before it is moved: how many files, how many of them are
 *  recordings, and how big it all is. */
export async function measure(folder) {
  const { files } = await everything(folder);
  return { files: files.length, recordings: files.filter((file) => file.path.at(-2) === "Raw files").length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}

/**
 * Copies the folder `from` to `to`, which mustn't be there yet, every file checked to have arrived
 * whole and keeping its time. `progress` hears how much has been copied, from 0 to 1. It is copied
 * into a folder of its own first, so that a copy cut short leaves nothing at `to` that could pass
 * for the library.
 */
export async function copyFolder(from, to, progress = () => {}) {
  const making = `${to} (moving)`;
  await rm(making, { recursive: true, force: true });
  try {
    const { folders, files } = await everything(from);
    const all = files.reduce((sum, file) => sum + file.size, 0);
    let done = 0;
    await mkdir(making, { recursive: true });
    for (const path of folders) await mkdir(join(making, ...path), { recursive: true });
    for (const file of files) {
      const source = join(from, ...file.path), target = join(making, ...file.path), part = `${target}.part`;
      const before = done;
      await pipeline(
        createReadStream(source, { highWaterMark: 4 << 20 }),
        async function* count(pieces) {
          for await (const piece of pieces) {
            done += piece.length;
            progress(all > 0 ? done / all : 1);
            yield piece;
          }
        },
        createWriteStream(part),
      );
      if ((await stat(part)).size !== file.size) throw new Error(`${file.path.at(-1)} didn't arrive whole`);
      await utimes(part, new Date(), file.modified);
      await rename(part, target);
      done = before + file.size;
    }
    progress(1);
    await rename(making, to);
  } catch (error) {
    await rm(making, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Moves the folder `from` to `to`, which mustn't be there yet: renamed there, or where that can't
 * be done, copied there and the old folder sent to the Trash with `trash`. `progress` hears how
 * much has been copied, from 0 to 1. Comes back with how it was done: `{ how: "renamed" }` or
 * `{ how: "copied", trashed }`, `trashed` false when the old folder couldn't be sent to the Trash
 * and is still where it was.
 */
export async function moveFolder(from, to, { progress = () => {}, trash }) {
  try {
    await rename(from, to);
    return { how: "renamed" };
  } catch (error) {
    if (!cantRename.has(error.code)) throw error;
  }
  await copyFolder(from, to, progress);
  try {
    await trash(from);
    return { how: "copied", trashed: true };
  } catch {
    return { how: "copied", trashed: false };
  }
}
