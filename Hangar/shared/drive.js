// A second copy of the library, kept in Google Drive: what belongs in it and what is still to go.
// Nothing here touches the disk, so it can be tested by itself.
//
// Google's own program for computers, Drive for desktop, shows a pilot's Drive as a folder and
// uploads whatever is put in it. So the app signs in to nothing: it keeps a copy of the library in
// a folder there, laid out as the library is, and Drive does the rest. Any folder does as well:
// another service's, or a disk.
//
// The copy only grows. A file that is new in the library, or has changed there, is copied. One
// that has gone from the library stays in the copy.

/** The folder the copy is kept in, inside the one that was chosen. */
export const copyName = "FPV Hangar";

/** Where Drive for desktop keeps a pilot's own files, inside the place it shows their Drive. */
export const myDrive = "My Drive";

/** The folder in a track that holds its recordings, which are most of a library's size. */
export const recordingsFolder = "Raw files";

const parts = (path) => String(path).split(/[\\/]+/).filter((part) => part !== "");
const leaf = (path) => parts(path).at(-1) ?? "";

/** The folder a copy is kept in when this one is chosen: a folder of the app's name inside it,
 *  unless it is one already. `join` puts two parts of a path together as this computer does. */
export function copyRoot(chosen, join = (a, b) => `${a.replace(/[\\/]+$/, "")}/${b}`) {
  return leaf(chosen).toLowerCase() === copyName.toLowerCase() ? chosen : join(chosen, copyName);
}

/** True when one folder is another, or is somewhere inside it. Capitals don't tell two apart, as
 *  on most of the disks this runs on they don't. */
export function isWithin(folder, other) {
  const a = parts(folder).map((part) => part.toLowerCase()), b = parts(other).map((part) => part.toLowerCase());
  return a.length >= b.length && b.every((part, index) => a[index] === part);
}

/** Why a folder can't hold the copy of a library, or null when it can. */
export function whyNot(chosen, library, join) {
  const root = copyRoot(chosen, join);
  if (isWithin(root, library) && isWithin(library, root)) return "Your library is in that folder, so the copy would be the library itself. Choose one somewhere else.";
  if (isWithin(root, library)) return "That folder is inside your library, so the copy would be a copy of itself. Choose one somewhere else.";
  if (isWithin(library, root)) return "Your library is inside that folder already. Choose one somewhere else.";
  return null;
}

/** Whose Drive a folder of Drive for desktop's is, from its name on a Mac: "GoogleDrive-" and
 *  then the account. Null for any other folder. */
export function driveAccount(name) {
  const found = /^GoogleDrive-(.+)$/.exec(name);
  return found ? found[1] : null;
}

/** Whether a file of the library belongs in its copy, by where it is: its path from the library's
 *  folder, with "/" between the parts. Hidden files, and ones still being written, don't. */
export function belongs(path, { recordings = true } = {}) {
  const names = parts(path);
  if (names.length === 0) return false;
  if (names.some((name) => name.startsWith(".") || /\.app$/i.test(name))) return false;
  if (/\.(part|tmp|download|crdownload)$/i.test(names.at(-1))) return false;
  if (!recordings && names.slice(0, -1).includes(recordingsFolder)) return false;
  return true;
}

/** Whether a file has to be copied, from what it is and what its copy is: `{ size, modified }`
 *  each, with the time in thousandths of a second, and null for no copy. A copy that is the same
 *  size and no older is left. Two seconds are allowed for disks that keep times less finely. */
export function isDue(file, copy) {
  if (!copy) return true;
  return copy.size !== file.size || file.modified > copy.modified + 2000;
}

/**
 * What a round of copying has to do. `files` is what the library holds that belongs in the copy,
 * each `{ path, size, modified }`. `copies` gives what the copy has of a path, or nothing.
 * The small ones go first: markers, settings and finished videos are safe before a long recording
 * is started on.
 */
export function plan(files, copies) {
  const due = files.filter((file) => isDue(file, copies.get(file.path) ?? null)).sort((a, b) => a.size - b.size || a.path.localeCompare(b.path));
  const sum = (list) => list.reduce((total, file) => total + file.size, 0);
  return { due, bytes: sum(due), held: files.length - due.length, heldBytes: sum(files) - sum(due), files: files.length, all: sum(files) };
}

/** The part of a library a file is in, for counting what a copy holds: "recordings", "videos",
 *  or "the rest" (markers, music, settings, logos and so on). */
export function kindOf(path) {
  const names = parts(path);
  const folder = names.at(-2) ?? "";
  if (folder === recordingsFolder) return "recordings";
  if (/\.(mp4|mov|m4v)$/i.test(names.at(-1) ?? "") && names.length >= 3) return "videos";
  return "the rest";
}
