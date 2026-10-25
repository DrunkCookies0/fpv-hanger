// Other projects' programs, fetched and kept up to date by the app: the ExpressLRS Configurator
// and EdgeTX Companion.
//
// Each stays a program of its own, with its own window, where its own installer would put it. The
// app looks at the project's Releases page for the newest one, downloads it from there, checks it
// against the checksum published with the release, and puts it in place: on a Mac the copy that
// was there goes to the Trash; on Windows the project's own installer is started, which does the
// rest. EdgeTX's come in a zip, which is opened first. Nothing of a program is carried by the app
// or passed on by it.
//
//   --programs <folder>       look for programs, and put them, in this folder
//   --program-feed <folder>   read releases from this folder in place of the project's page
// Both are for trying this out without touching what is installed.

import { shell } from "electron";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { argument, config, setConfig, log } from "./paths.js";
import { programs, releaseOf, publishedSum, versionOf, familyOf, familyIn, nameFor, registryVersion } from "../shared/components.js";
import { isNewer } from "../shared/updates.js";

const mac = process.platform === "darwin";
const run = (program, parts) => spawnSync(program, parts, { encoding: "utf8", windowsHide: true });
const writable = (place) => {
  try {
    accessSync(place, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/** Where a program is looked for, the likeliest first. */
function places() {
  const given = argument("--programs");
  if (given) return [resolve(given)];
  if (mac) return ["/Applications", join(homedir(), "Applications")];
  return [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
}

/** Which version a copy of a program is, from its own files, or from what its installer wrote
 *  down on Windows. Null when it doesn't say. */
function versionAt(program, path, family = "") {
  const resources = mac ? join(path, "Contents", "Resources") : join(path, "..", "resources");
  // The program's own description of itself, inside its archive. Electron reads inside one.
  for (const inside of [join(resources, "app.asar", "package.json"), join(resources, "app", "package.json")]) {
    try {
      const version = versionOf(JSON.parse(readFileSync(inside, "utf8")).version);
      if (version) return version;
    } catch {}
  }
  if (mac) return versionOf(run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", join(path, "Contents", "Info.plist")]).stdout.trim());
  if (!program.registry) return null;
  // Under the programs Windows can remove. A 32-bit installer writes it where 32-bit programs look.
  const key = `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${program.registry.replace("*", family)}`;
  for (const view of ["/reg:32", "/reg:64"]) {
    const version = registryVersion(run("reg", ["query", key, "/v", "DisplayVersion", view]).stdout);
    if (version) return version;
  }
  return null;
}

/** What each copy was found to be, until it changes: the app's pages ask often, and finding out
 *  can take running another program. */
const found = new Map();
function versionOfCopy(program, path, family) {
  // A copy put in another's place is another file, changed since.
  let stamp = "";
  try {
    const { ino, ctimeMs, mtimeMs } = statSync(path);
    stamp = `${ino}:${ctimeMs}:${mtimeMs}`;
  } catch {}
  const known = found.get(path);
  if (known?.stamp === stamp) return known.version;
  const version = versionAt(program, path, family);
  found.set(path, { stamp, version });
  return version;
}

/** The copies of a program in a folder by the pattern for where it is, the newest family first:
 *  `{ path, family }`. A part of the pattern with `*` in it is any family. */
function copiesIn(place, pattern) {
  let found = [{ path: place, family: "" }];
  for (const part of pattern.split("/")) {
    found = found.flatMap(({ path, family }) => {
      if (!part.includes("*")) return [{ path: join(path, part), family }];
      let names = [];
      try {
        names = readdirSync(path);
      } catch {}
      return names.map((name) => ({ path: join(path, name), family: familyIn(part, name) })).filter((one) => one.family !== null);
    });
  }
  return found.filter((one) => existsSync(one.path)).sort((a, b) => (isNewer(a.family, b.family) ? -1 : isNewer(b.family, a.family) ? 1 : 0));
}

/** The copy of a program on this computer, the newest family where it has several: `{ path,
 *  version, family }`, with `version` null when the copy doesn't say. Null when there is none. */
export function installed(program) {
  for (const place of places()) {
    for (const pattern of mac ? [program.mac] : program.windows) {
      const [copy] = copiesIn(place, pattern);
      if (copy) return { ...copy, version: versionOfCopy(program, copy.path, copy.family) };
    }
  }
  return null;
}

/** Fetches as the app does, or from a folder standing in for the project's page: the release as
 *  `release.json`, and its files by name. */
function fetcher() {
  const folder = argument("--program-feed");
  if (!folder) return (address, options) => fetch(address, { ...options, headers: { "User-Agent": "FPV-Hangar", Accept: "application/vnd.github+json, */*", ...(options?.headers ?? {}) } });
  return async (address) => {
    const file = join(resolve(folder), address.includes("api.github.com") ? "release.json" : decodeURIComponent(basename(new URL(address).pathname)));
    if (!existsSync(file)) return new Response("", { status: 404 });
    const bytes = readFileSync(file);
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
  };
}

/** A program's newest release for this kind of computer. Null when it has nothing for it. */
export async function newest(program) {
  const answer = await fetcher()(`https://api.github.com/repos/${program.repository}/releases/latest`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!answer.ok) throw new Error(`its Releases page answered ${answer.status}`);
  return releaseOf(program, await answer.json(), process.platform, process.arch);
}

/** Whether a program is open, on a Mac, where a copy in use can't be swapped for another. */
function isOpen(path) {
  return mac && run("/usr/bin/pgrep", ["-f", `${path}/Contents/MacOS/`]).status === 0;
}

/** Opens a zip that has been downloaded, and gives the file in it that is the program's. */
function unzip(program, file, work) {
  const into = join(work, "unzipped");
  mkdirSync(into);
  // Windows 10 and 11 have tar, which opens a zip as well.
  const opened = mac ? run("/usr/bin/ditto", ["-x", "-k", file, into]) : run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-x", "-f", file, "-C", into]);
  if (opened.status !== 0) return null;
  const wanted = program.inside(process.platform);
  const name = readdirSync(into).find((one) => wanted?.test(one));
  return name ? join(into, name) : null;
}

/**
 * Downloads a release of a program, checks it, and puts it in place. Gives `{ problem }`, null
 * when it went well, with the `path` it was put at on a Mac, and on Windows `{ installer: true }`
 * when the project's own installer has been started and is finishing the job. `heard` is told
 * how much has arrived, 0 to 1.
 */
export async function install(program, release, { heard = () => {} } = {}) {
  const get = fetcher(), had = installed(program);
  // A program kept beside its other families replaces only the copy of its own family.
  const replacing = had && (!program.mac.includes("*") || had.family === familyOf(release.version));
  if (replacing && isOpen(had.path)) return { problem: `${program.title} is open. Close it, then try again.` };
  const work = mkdtempSync(join(tmpdir(), "fpv-hangar-program-"));
  let keep = false;
  try {
    // What the file should add up to: what the project publishes with the release, or what GitHub
    // keeps for it.
    let wanted = release.sha256 ?? null;
    if (!wanted && release.sums) {
      const list = await get(release.sums, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      wanted = list.ok ? publishedSum(await list.text(), release.file) : null;
    }
    if (!wanted) return { problem: `${program.owner} hasn't published a checksum for this release, so the download can't be checked. Nothing was changed.` };
    const answer = await get(release.address, { cache: "no-store" });
    if (!answer.ok || !answer.body) return { problem: `The download answered ${answer.status}. Try again in a while.` };
    const whole = Number(answer.headers.get("content-length")) || release.size || 0;
    const kind = release.sha256 ? "sha256" : "sha512";
    const file = join(work, release.file), out = createWriteStream(file), sum = createHash(kind);
    let got = 0;
    for await (const piece of answer.body) {
      sum.update(piece);
      got += piece.length;
      if (!out.write(piece)) await new Promise((done) => out.once("drain", done));
      if (whole) heard(Math.min(1, got / whole));
    }
    await new Promise((done, failed) => out.end((error) => (error ? failed(error) : done())));
    if (sum.digest(kind === "sha256" ? "hex" : "base64") !== wanted) return { problem: "The download didn't arrive in one piece, or isn't the file the project published. Nothing was changed. Try again." };
    // A zip has the disk image or the installer inside.
    const inside = release.file.endsWith(".zip") ? unzip(program, file, work) : file;
    if (!inside) return { problem: `The download doesn't have ${program.title} in it. Nothing was changed.` };

    if (!mac) {
      // The project's own installer puts it where it goes. It is left where it was downloaded
      // until the computer clears its temporary files.
      keep = true;
      const failed = await shell.openPath(inside);
      return failed ? { problem: `The installer couldn't be started: ${failed}` } : { problem: null, installer: true };
    }

    // A Mac's download is a disk image with the program inside.
    const disk = join(work, "disk"), bundle = nameFor(program.mac, release.version);
    mkdirSync(disk);
    if (run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", disk, inside]).status !== 0) return { problem: "The download couldn't be opened." };
    try {
      const fresh = join(disk, bundle), says = existsSync(fresh) ? versionAt(program, fresh) : null;
      // A copy that doesn't say which version it is has its family in its name.
      if (!existsSync(fresh) || (says ?? release.version) !== release.version) return { problem: `The download isn't the version of ${program.title} it says it is. Nothing was changed.` };
      const place = had ? resolve(had.path, "..") : places().find((folder) => existsSync(folder) && writable(folder));
      if (!place || !writable(place)) return { problem: `${program.title} couldn't be put in ${place ?? "your Applications folder"}: it can't be written to.` };
      const target = join(place, bundle);
      // The copy that was there goes to the Trash, so there is a way back. (Tried out in a folder
      // of its own, it is set aside in that folder: nothing made up is left in the pilot's Trash.)
      const replaced = existsSync(target);
      if (replaced) {
        if (argument("--programs")) {
          mkdirSync(join(place, "Replaced"), { recursive: true });
          renameSync(target, join(place, "Replaced", `${Date.now()} ${bundle}`));
        } else await shell.trashItem(target);
      }
      if (run("/usr/bin/ditto", [fresh, target]).status !== 0) return { problem: `The new ${program.title} couldn't be put in place.${replaced ? " The one you had is in the Trash: put it back to carry on." : ""}` };
      return { problem: null, path: target };
    } finally {
      run("/usr/bin/hdiutil", ["detach", disk, "-force"]);
    }
  } catch (error) {
    log(`Fetching ${program.title}: ${error.stack ?? error.message}`);
    return { problem: `${program.title} couldn't be fetched: ${error.message}.` };
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The programs as the app's pages ask for them: `checkProgram`, `installProgram`, `openProgram`,
 * and `programsNow` for what is known. The pages hear "program" while one is being fetched.
 */
export function makePrograms({ tell, quiet }) {
  /** What is being done to each program at the moment: `{ kind: "checking" }`, `{ kind: "fetching", progress }`. */
  const busy = {};
  const problems = {};
  const remembered = () => config().programs ?? {};
  const remember = (id, patch) => setConfig({ programs: { ...remembered(), [id]: { ...(remembered()[id] ?? {}), ...patch } } });

  const api = {
    /** Each program: the copy on this computer, the newest release known of, and whether that is
     *  later. A copy that doesn't say which version it is is the one the app put there, or else
     *  only its family is known (`exact` false), and a release later than that family's start is
     *  offered. */
    programsNow() {
      return Object.fromEntries(Object.entries(programs).map(([id, program]) => {
        const here = installed(program), kept = remembered()[id] ?? {}, latest = kept.latest ?? null;
        const put = here && !here.version && kept.put?.path === here.path ? kept.put.version : null;
        const version = here ? here.version ?? put ?? here.family : null;
        return [id, {
          installed: version,
          exact: Boolean(here?.version ?? put),
          latest,
          checked: kept.checked ?? null,
          newer: Boolean(version && latest && isNewer(latest.version, version)),
          busy: busy[id] ?? null,
          problem: problems[id] ?? null,
        }];
      }));
    },

    /** Looks at the project's page for a newer release. */
    async checkProgram(id) {
      const program = Object.hasOwn(programs, id) ? programs[id] : null;
      if (!program || busy[id]) return api.programsNow();
      busy[id] = { kind: "checking" };
      tell("changed");
      try {
        const latest = await newest(program);
        problems[id] = latest ? null : `${program.owner}'s newest release has nothing for this kind of computer.`;
        if (latest) remember(id, { latest, checked: new Date().toISOString() });
      } catch (error) {
        problems[id] = `Couldn't look for a newer ${program.title}: ${error.message}.`;
      }
      delete busy[id];
      tell("changed");
      return api.programsNow();
    },

    /** Fetches the newest release and puts it in place. */
    async installProgram(id) {
      const program = Object.hasOwn(programs, id) ? programs[id] : null, latest = remembered()[id]?.latest;
      if (!program || busy[id] || !latest) return { state: api.programsNow() };
      busy[id] = { kind: "fetching", progress: 0 };
      problems[id] = null;
      tell("changed");
      let last = 0;
      const done = await install(program, latest, { heard: (share) => {
        busy[id].progress = share;
        // Often enough to see it move, not for every piece that arrives.
        if (share - last >= 0.01 || share === 1) {
          last = share;
          tell("program", id, share);
        }
      } });
      delete busy[id];
      problems[id] = done.problem;
      // What was put there, for a copy that doesn't say which version it is.
      if (done.path) remember(id, { put: { path: done.path, version: latest.version } });
      tell("changed");
      return { state: api.programsNow(), installer: Boolean(done.installer) };
    },

    /** Opens the copy on this computer. */
    async openProgram(id) {
      const program = Object.hasOwn(programs, id) ? programs[id] : null, here = program && installed(program);
      if (!here) return { problem: "It isn't on this computer yet." };
      const failed = await shell.openPath(here.path);
      return { problem: failed || null };
    },

    /** Once a day, when the app is looked at: is there a newer release of anything it keeps? */
    programsAreDue(now = Date.now()) {
      if (quiet) return [];
      return Object.keys(programs).filter((id) => {
        const checked = Date.parse(remembered()[id]?.checked ?? "");
        return installed(programs[id]) && !busy[id] && !(now - checked < 20 * 3600 * 1000);
      });
    },
  };
  return api;
}
