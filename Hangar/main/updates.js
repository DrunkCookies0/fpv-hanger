// Finding a newer version of the app and putting it in this copy's place.
//
// Packaged versions are published on the Releases page of the app's repository. Each release has
// the app as a zip for each kind of computer, and latest.json, which says which is which (see
// shared/updates.js). A copy that finds a later version than itself downloads the zip, checks it
// arrived whole and is what it says it is, puts it where this copy is, and starts it. The copy
// that was running is kept: in the Trash on a Mac, in a folder beside the app on Windows.

import { app, shell } from "electron";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { argument, config, setConfig } from "./paths.js";
import { releaseFor, windowsSwap } from "../shared/updates.js";

/** Where packaged versions are published. */
export const releasesPage = "https://github.com/DrunkCookies0/fpv-hanger/releases";

/** The folder latest.json and the archives are read from. `--update-feed <address>` points it
 *  somewhere else, for trying an update without publishing one. */
export function feed() {
  const given = argument("--update-feed");
  // GitHub sends this address on to the files attached to whichever release is the newest.
  const address = given ?? "https://github.com/DrunkCookies0/fpv-hanger/releases/latest/download/";
  return address.endsWith("/") ? address : `${address}/`;
}

/** Reads which packaged version is the newest for this kind of computer. Null when the newest has
 *  nothing for it, as a release from before the Windows app has nothing for Windows. */
export async function latest(fetcher = fetch) {
  const answer = await fetcher(`${feed()}latest.json`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!answer.ok) throw new Error(`the download page answered ${answer.status}`);
  return releaseFor(await answer.json(), process.platform);
}

/** The app as it sits on this computer: the bundle on a Mac, the folder with the .exe on Windows.
 *  Null for a copy run from its source, which has neither. */
export function thisCopy() {
  if (process.defaultApp) return null;
  if (process.platform === "darwin") {
    const bundle = resolve(process.execPath, "..", "..", "..");
    return bundle.endsWith(".app") ? bundle : null;
  }
  return process.platform === "win32" ? dirname(process.execPath) : null;
}

const run = (program, parts) => spawnSync(program, parts, { encoding: "utf8", windowsHide: true });
const plist = (bundle, key) => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(bundle, "Contents", "Info.plist")]).stdout.trim();

/** Downloads a release's archive into a folder, and says whether it arrived whole. */
async function fetchArchive(release, folder, heard, fetcher) {
  const answer = await fetcher(`${feed()}${encodeURIComponent(release.file)}`, { cache: "no-store" });
  if (!answer.ok || !answer.body) throw new Error(`the download answered ${answer.status}`);
  const whole = Number(answer.headers.get("content-length")) || 0;
  const archive = join(folder, "update.zip"), file = createWriteStream(archive), sum = createHash("sha256");
  let had = 0;
  for await (const piece of answer.body) {
    sum.update(piece);
    had += piece.length;
    if (!file.write(piece)) await new Promise((done) => file.once("drain", done));
    if (whole) heard(had / whole);
  }
  await new Promise((done, failed) => file.end((error) => (error ? failed(error) : done())));
  return sum.digest("hex") === release.sha256 ? archive : null;
}

/** The folders directly inside one. */
const foldersIn = (place) => readdirSync(place).map((name) => join(place, name)).filter((path) => statSync(path).isDirectory());

/**
 * Downloads a release and puts it where this copy of the app is. Gives what went wrong, or null
 * once the new copy is in place (a Mac) or about to be (Windows, where the swap happens after
 * this copy has closed). Either way the caller then quits, and the new copy starts by itself.
 *
 * `heard` is told how much of the download has arrived, 0 to 1. `after` is what to start the new
 * copy with. `aside`, for a drill, is a folder the old copy goes to in place of the Trash.
 */
export async function install(release, { heard = () => {}, after = [], aside = null, fetcher = fetch } = {}) {
  const here = thisCopy();
  if (!here) return "This copy is run from its source, so it can't update itself.";
  // macOS runs an app it hasn't cleared yet from a read-only copy somewhere else.
  const writable = (place) => {
    try {
      accessSync(place, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (here.includes("/AppTranslocation/") || !writable(dirname(here))) {
    return process.platform === "darwin"
      ? "FPV Hangar can't replace itself where it is. Move it into your Applications folder, open it from there, and try again."
      : "FPV Hangar can't replace itself where it is. Move its folder somewhere you can save files, such as your Desktop, open it from there, and try again.";
  }
  const work = mkdtempSync(join(tmpdir(), "fpv-hangar-update-"));
  let keep = false;
  try {
    const archive = await fetchArchive(release, work, heard, fetcher);
    if (!archive) return "The download didn't arrive in one piece. Try again.";
    const unpacked = join(work, "unpacked");
    if (aside) mkdirSync(aside, { recursive: true });

    if (process.platform === "darwin") {
      if (run("/usr/bin/ditto", ["-x", "-k", archive, unpacked]).status !== 0) return "The download couldn't be unpacked.";
      // The app is at the top of the archive, or one folder down.
      const apps = (place) => foldersIn(place).filter((path) => path.endsWith(".app"));
      const fresh = [...apps(unpacked), ...foldersIn(unpacked).flatMap(apps)][0];
      if (!fresh || plist(fresh, "CFBundleIdentifier") !== plist(here, "CFBundleIdentifier") || plist(fresh, "CFBundleShortVersionString") !== release.version) {
        return "The download isn't the version of FPV Hangar it says it is.";
      }
      if (run("/usr/bin/codesign", ["--verify", "--deep", "--strict", fresh]).status !== 0) return "The download is damaged.";
      // The copy that was running goes to the Trash, so there is a way back.
      if (aside) renameSync(here, join(aside, basename(here)));
      else await shell.trashItem(here);
      try {
        renameSync(fresh, here);
      } catch {
        // Another disk: it is copied across, with everything a bundle has kept as it is.
        if (run("/usr/bin/ditto", [fresh, here]).status !== 0) return "The new version couldn't be put in place. The one you had is in the Trash: put it back to carry on.";
      }
      // Start the new copy once this one has gone.
      const open = after.length > 0 ? 'sleep 1; /usr/bin/open -n "$0" --args "$@"' : 'sleep 1; /usr/bin/open "$0"';
      spawn("/bin/sh", ["-c", open, here, ...after], { detached: true, stdio: "ignore" }).unref();
      return null;
    }

    // Windows. tar comes with it and unpacks a zip.
    mkdirSync(unpacked, { recursive: true });
    if (run("tar.exe", ["-xf", archive, "-C", unpacked]).status !== 0) return "The download couldn't be unpacked.";
    const isApp = (place) => existsSync(join(place, "resources", "app", "package.json")) && readdirSync(place).some((name) => name.toLowerCase().endsWith(".exe"));
    const fresh = [unpacked, ...foldersIn(unpacked)].find(isApp);
    const said = (place) => {
      try {
        return readFileSync(join(place, "resources", "VERSION"), "utf8").trim();
      } catch {
        return null;
      }
    };
    if (!fresh || said(fresh) !== release.version) return "The download isn't the version of FPV Hangar it says it is.";
    // The app's own program keeps the name it has here, whatever it is called in the download.
    const program = basename(process.execPath);
    const theirs = readdirSync(fresh).find((name) => name.toLowerCase().endsWith(".exe") && !/^(ffmpeg|ffprobe)\.exe$/i.test(name));
    if (theirs && theirs !== program) renameSync(join(fresh, theirs), join(fresh, program));
    const script = join(work, "swap.cmd");
    writeFileSync(script, windowsSwap({ app: here, fresh, old: aside ? join(aside, basename(here)) : `${here} (before update)`, program, pid: process.pid, after }));
    spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true, cwd: tmpdir() }).unref();
    // The script works from this folder after the app has closed, so it is left for it.
    keep = true;
    return null;
  } catch (error) {
    return `The update couldn't be installed: ${error.message}`;
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The first time this app is opened on a Mac that had the app before it, what that one remembered
 * is taken up: where the library is, the last track open, whether it has said hello, and the rest.
 * That app kept them in the Mac's own settings for it, under the same names.
 */
export function takeUpWhatTheOldAppKept() {
  if (existsSync(join(app.getPath("userData"), "config.json"))) return;
  const found = whatTheOldAppKept();
  if (Object.keys(found).length > 0) setConfig({ ...found, ...config() });
}

/** What the Mac app before this one remembered, under this app's identity. Empty anywhere else. */
export function whatTheOldAppKept() {
  const here = thisCopy();
  if (process.platform !== "darwin" || !here) return {};
  const mine = plist(here, "CFBundleIdentifier");
  if (!mine) return {};
  const kinds = { library: "text", lastTrack: "text", lastVersion: "text", welcomed: "yes or no", noAutomaticUpdates: "yes or no", snapToBeat: "yes or no", showsTimer: "yes or no", lastUpdateCheck: "number" };
  const found = {};
  for (const [name, kind] of Object.entries(kinds)) {
    // A setting that was never made isn't there to read, which is different from one that is off.
    const read = run("/usr/bin/defaults", ["read", mine, name]);
    if (read.status !== 0) continue;
    const value = read.stdout.trim();
    if (kind === "text" && value !== "") found[name] = value;
    else if (kind === "yes or no") found[name] = value === "1";
    else if (kind === "number" && Number.isFinite(Number(value))) found[name] = Number(value);
  }
  return found;
}

/** True when it is time for the check made as the app opens: once a day at most. */
export function checkIsDue(now = Date.now()) {
  return config().noAutomaticUpdates !== true && now / 1000 - (Number(config().lastUpdateCheck) || 0) > 20 * 3600;
}

