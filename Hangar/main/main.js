// FPV Hangar: where the app starts. It finds the library, opens the one window, and answers what the
// pages in that window ask for. The pages themselves are in ../renderer.
//
//   electron .                                   the app
//   electron . --root <folder>                   on a library other than the pilot's own
//   electron . --user-data <folder>              keeping what it remembers somewhere else
//   electron . --snapshot <file.png> [--page <which>] [--size 1280x840]
//                                                draws one of its pages into a picture and quits,
//                                                without showing a window (see renderer/app.js)
//   electron . --check <which>                   runs one of its own checks and quits (see checks.js)
//   electron . --self-test [--report <file>]     tries itself out from start to finish on a library it
//                                                makes for the purpose, shows no window, and writes
//                                                down how it went. Nothing of the pilot's is opened.

import { app, BrowserWindow, ipcMain, shell, Menu, session } from "electron";
import { writeFileSync, mkdirSync, mkdtempSync, existsSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { argument, ffmpegPath, libraryPath, cachePath, log, version } from "./paths.js";
import { takeUpWhatTheOldAppKept } from "./updates.js";
import { FFmpeg } from "./ffmpeg.js";
import { Library } from "./library.js";
import { VideoMaker } from "./videos.js";
import { makeApi } from "./api.js";

const here = dirname(fileURLToPath(import.meta.url));
const mac = process.platform === "darwin";
// `--say-version <file>`: writes down which version this copy is and stops there, without opening
// anything. It is how a copy that has just replaced another shows that it did, when that is tried out.
if (argument("--say-version")) {
  try {
    writeFileSync(resolve(argument("--say-version")), version());
  } catch {}
  app.exit(0);
}

// Trying itself out is a check like any other, on a library and a memory of its own in the
// temporary folder.
if (process.argv.includes("--self-test") && !argument("--check")) {
  const scratch = mkdtempSync(join(tmpdir(), "fpv-hangar-self-test-"));
  process.argv.push("--root", join(scratch, "library"), "--user-data", join(scratch, "memory"), "--check", "everything");
}
const snapshot = argument("--snapshot");
const check = argument("--check");
/** `--read-me <file> [--for darwin|win32]`: writes the read-me a download goes out with, and quits. */
const readMe = argument("--read-me");
/** Nothing is put on the screen in these modes: no window, and no icon in the Dock. */
const unseen = Boolean(snapshot || check || readMe);

if (argument("--user-data")) app.setPath("userData", resolve(argument("--user-data")));
// A copy run from its source keeps what it remembers apart from the installed app's.
else if (process.defaultApp) app.setPath("userData", join(app.getPath("appData"), "FPV Hangar (from source)"));
if (unseen) app.dock?.hide();

// One copy at a time, so two windows never save over each other. A second start brings the first forward.
const second = !unseen && !app.requestSingleInstanceLock();
if (second) app.quit();

// Anything that goes wrong where nobody is looking is written down.
process.on("uncaughtException", (error) => log(`The app: ${error.stack ?? error.message}`));
process.on("unhandledRejection", (reason) => log(`The app: ${reason?.stack ?? reason}`));

/** Before this copy changes anything, what the library remembers is copied aside, once a day. A
 *  mistake in the app can then be undone by putting the copy back. The last ten of each file are kept. */
function backUp(library) {
  try {
    if (unseen || !existsSync(library.storeFile)) return;
    const folder = join(app.getPath("userData"), "Library backups");
    mkdirSync(folder, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    for (const [name, file] of [["dashboard", library.storeFile], ["settings", library.settingsFile], ["hangar", library.extrasFile]]) {
      const to = join(folder, `${name} ${today}.json`);
      if (existsSync(file) && !existsSync(to)) copyFileSync(file, to);
      // Counted for each file by itself. Counted together, the newest of one would push out all of another.
      const kept = readdirSync(folder).filter((one) => one.startsWith(`${name} `) && one.endsWith(".json")).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - 10))) rmSync(join(folder, old), { force: true });
    }
  } catch (error) {
    log(`Backing up the library: ${error.message}`);
  }
}

/** @type {BrowserWindow | null} */
let window = null;
const page = pathToFileURL(join(here, "..", "renderer", "index.html")).href;

/** Sends news to the pages: a job's progress, or word that the library changed. */
function tell(kind, ...details) {
  if (window && !window.isDestroyed()) window.webContents.send(`news:${kind}`, ...details);
}

function openWindow({ width = 1280, height = 840 } = {}) {
  window = new BrowserWindow({
    width, height, minWidth: 1080, minHeight: 700,
    show: false,
    backgroundColor: "#07080b",
    title: "FPV Hangar",
    icon: join(here, "..", "assets", "icon.png"),
    // The app draws right up to the top of its window. A Mac keeps its three buttons there; on
    // Windows the window's own buttons are laid over the top-right corner.
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    ...(mac ? {} : { titleBarOverlay: { color: "#07080b", symbolColor: "#ffffff", height: 36 } }),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !unseen,
      offscreen: unseen,
    },
  });
  // The window shows the app's own page and nothing else. A link opens in the pilot's browser.
  window.webContents.on("will-navigate", (event, address) => {
    if (address !== page) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("closed", () => { window = null; });
  window.webContents.on("render-process-gone", (_event, details) => log(`The window stopped: ${details.reason}`));
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === 3) log(`The window: ${details.message} (${details.sourceId ?? ""}:${details.lineNumber ?? ""})`);
  });
  if (!unseen) window.once("ready-to-show", () => window?.show());
  return window.loadURL(page);
}

function menu(send) {
  if (!mac) {
    // Windows has no menu bar here. The keys an editable field needs work without one.
    Menu.setApplicationMenu(null);
    return;
  }
  // The marker keys are named in the titles and handled by the editor itself, not set as menu
  // shortcuts: a menu shortcut of a bare letter would get in the way of typing that letter.
  const marker = (label, what) => ({ label, click: () => send("menu", what) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "Markers",
      submenu: [
        marker("Add Marker   (M)", "mark"),
        marker("Go to Next Marker   (⇧M or ↓)", "next"),
        marker("Go to Previous Marker   (⇧⌘M or ↑)", "previous"),
        { type: "separator" },
        marker("Clear Current Marker   (⌥M or ⌫)", "clear"),
        marker("Clear All Markers   (⌥⌘M)", "clearAll"),
      ],
    },
    { role: "windowMenu" },
  ]));
}

app.whenReady().then(async () => {
  if (second) return;
  const ffmpeg = new FFmpeg(ffmpegPath());
  const cache = cachePath();
  log(`FPV Hangar ${version()} started on ${process.platform} ${process.arch}${unseen ? ", showing no window" : ""}`);
  // A Mac that had the app before this one: where its library is, and the rest of what it remembered.
  if (!unseen) takeUpWhatTheOldAppKept();
  const library = new Library(libraryPath(), { ffmpeg, cache, trash: (path) => shell.trashItem(path) });
  backUp(library);
  const videos = new VideoMaker({ ffmpeg: ffmpegPath(), temp: join(cache, "Working") });
  const api = makeApi({ library, ffmpeg, videos, cache, window: () => window, tell, fixed: Boolean(argument("--root")), quiet: unseen });

  // The pages ask for things by name. Only the app's own page is answered.
  ipcMain.handle("ask", async (event, what, ...details) => {
    if (event.senderFrame?.url !== page) throw new Error("Not the app's own page.");
    if (!Object.hasOwn(api, what)) throw new Error(`There is no ${what} to ask for.`);
    return api[what](...details);
  });

  // Nothing in the window is allowed to ask for the camera, the microphone or the like.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));

  menu(tell);
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("activate", () => { if (!window && !unseen) openWindow(); });
  // Looking at the app again after being elsewhere: another copy may have saved, or files may have changed.
  app.on("browser-window-focus", () => tell("front"));
  app.on("window-all-closed", () => {
    videos.close();
    app.quit();
  });

  if (snapshot) {
    const size = /^(\d+)x(\d+)$/.exec(argument("--size") ?? "");
    await openWindow(size ? { width: Number(size[1]), height: Number(size[2]) } : {});
    try {
      // The page says when everything it is going to show has arrived.
      await window.webContents.executeJavaScript(`window.showForSnapshot(${JSON.stringify(argument("--page") ?? "home")})`);
      const picture = await window.webContents.capturePage();
      mkdirSync(dirname(resolve(snapshot)), { recursive: true });
      writeFileSync(resolve(snapshot), picture.toPNG());
      console.log(`Wrote ${resolve(snapshot)}`);
    } catch (error) {
      console.error(`No picture: ${error.message}`);
      process.exitCode = 1;
    }
    videos.close();
    app.quit();
    return;
  }

  if (readMe) {
    let code = 1;
    try {
      await openWindow();
      const text = await window.webContents.executeJavaScript(`window.readMeText(${JSON.stringify(argument("--for") ?? process.platform)})`);
      writeFileSync(resolve(readMe), process.platform === "win32" || argument("--for") === "win32" ? text.replace(/\n/g, "\r\n") : text);
      code = 0;
    } catch (error) {
      console.error(`No read-me: ${error.message}`);
    }
    videos.close();
    app.exit(code);
    return;
  }

  if (check) {
    const { run } = await import("./checks.js");
    // Whatever started the check is told how it went by the number the app leaves with.
    let passed = false;
    try {
      passed = await run(check, { api, library, ffmpeg, videos, cache, open: openWindow, window: () => window });
    } catch (error) {
      console.error(`The check stopped: ${error.stack ?? error.message}`);
    }
    videos.close();
    app.exit(passed ? 0 : 1);
    return;
  }

  await openWindow();
  api.checkForUpdatesIfDue();
});
