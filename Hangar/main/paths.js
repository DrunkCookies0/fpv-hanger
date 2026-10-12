// Where things are: FFmpeg, the library, and the folder for what can be made again.

import { app } from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pointerName } from "../shared/drive.js";

const here = dirname(fileURLToPath(import.meta.url));

/** FFmpeg: inside the packaged app, or in the project's vendor folder while it is being built. */
export function ffmpegPath() {
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const packaged = join(process.resourcesPath ?? "", "ffmpeg", name);
  return existsSync(packaged) ? packaged : resolve(here, "..", "vendor", `${process.platform}-${process.arch}`, name);
}

/** The app's version: the VERSION file beside the project while it is being built, the packaged number otherwise. */
export function version() {
  try {
    return readFileSync(resolve(here, "..", "..", "VERSION"), "utf8").trim();
  } catch {
    return app.getVersion();
  }
}

/** What the command line asked for: `--root <folder>` and the like. */
export function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const configFile = () => join(app.getPath("userData"), "config.json");

export function config() {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

export function setConfig(patch) {
  const all = { ...config(), ...patch };
  mkdirSync(dirname(configFile()), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(all, null, 2));
  return all;
}

/** Where a library is kept unless the pilot chooses another folder: "FPV Hangar" in the Movies
 *  folder on a Mac and the Videos folder on Windows. */
export const usualLibrary = () => join(app.getPath("videos"), "FPV Hangar");

/** The library: the folder given on the command line, or the one the pilot chose, or the usual
 *  one. When the usual folder says the library is in Google Drive, it is there: that is how every
 *  copy of the app on a computer finds it, whoever moved it. */
export function libraryPath() {
  if (argument("--root")) return resolve(argument("--root"));
  if (config().library) return config().library;
  try {
    const pointed = JSON.parse(readFileSync(join(usualLibrary(), pointerName), "utf8")).library;
    if (typeof pointed === "string" && pointed !== "") return pointed;
  } catch {}
  return usualLibrary();
}

/** Leaves word in the usual library folder that the library is in another folder. */
export function pointTo(folder) {
  mkdirSync(usualLibrary(), { recursive: true });
  writeFileSync(join(usualLibrary(), pointerName), JSON.stringify({
    library: folder,
    about: "FPV Hangar keeps this computer's library in Google Drive, in the folder above, and this file tells it where to look. Delete this file to go back to the library in this folder.",
  }, null, 2) + "\n");
}

/** Where the app writes down anything that goes wrong, so it can be sent to whoever is fixing it. */
export const logFile = () => join(app.getPath("userData"), "What went wrong.txt");

/** Adds a line to that file. It never grows past a megabyte or so: the oldest half goes first. */
export function log(text) {
  try {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    let kept = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (kept.length > 1_000_000) kept = kept.slice(kept.length / 2);
    writeFileSync(file, `${kept}${new Date().toISOString()}  ${String(text).trim()}\n`);
  } catch {}
}

/** What can be made again: clips' facts, their playable copies, songs' sound waves. */
export function cachePath() {
  return join(app.getPath("userData"), "Made again");
}
