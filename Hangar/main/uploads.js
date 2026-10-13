// Uploading a finished video through a site's own upload page, shown inside the app's window:
// YouTube, YouTube Shorts, TikTok and Instagram (see shared/uploads.js). The pilot signs in on the
// site's own page, once: each site has a corner of the browser of its own, kept between runs. The
// app puts the video into the page's own file chooser when the page shows one, the way a pilot
// choosing it would, and for YouTube reads the video's link off the page as soon as it shows it.
// Posting is left to the site's own button.
//
// The video goes up under a name that says what it is, which YouTube and TikTok start its title
// and its caption from: a copy of it by that name, made in a folder of the app's own (a second
// name for the same file where the disk allows, so it takes no room), and gone again with the page.
//
// A video going up is lost if its page closes. Leaving the page asks it first, as a browser
// closing a tab does, and if the page says it is still busy, the pilot is asked before it goes.
// The same happens when the window is closed while a page is open.

import { WebContentsView, session, shell, clipboard, nativeImage } from "electron";
import { existsSync, linkSync, mkdirSync, rmSync, constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sites, mayTakeVideo, chooserScript, readPage, uploadLink, videoLinksIn, fileName } from "../shared/uploads.js";
import { log } from "./paths.js";

const folder = dirname(fileURLToPath(import.meta.url));

/** All a site's page is allowed: putting text on the clipboard, and showing a video full screen. */
const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);

/** Where signing in can take a site's page in a window of its own: Google, Apple, Facebook and the
 *  sites themselves. A window to anywhere else opens in the pilot's own browser. */
const signIns = [/(^|\.)google\.com$/, /(^|\.)youtube\.com$/, /(^|\.)tiktok\.com$/, /(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /^appleid\.apple\.com$/];
const signsIn = (address) => {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && signIns.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
};

/** How often the page is looked at for its chooser and its link. */
const every = 1500;

/**
 * The uploads as the app's pages ask for them: `openUpload`, `placeUpload`, `showUpload`,
 * `reloadUpload`, `putVideoAgain`, `dragVideo`, `copyText`, `uploadElsewhere`, `closeUpload`
 * and `stayOnUpload`. The pages hear "upload" (how the page is getting on: loading, a problem,
 * whether the video is in, its link) and "uploadLeave" (the window is being closed: leave the
 * page first). `keepLink(track, run, link)` keeps a YouTube video's link with its run. The
 * named copies go in `staging`. With `still`, a page is given its place but its site is not
 * called on: that is for the app drawing its pages into pictures.
 */
export function makeUploads({ window, tell, keepLink, staging, quiet = false, still = false }) {
  // Named copies left from a page that was open when the app last stopped.
  rmSync(staging, { recursive: true, force: true });
  /** The one upload page that is open. */
  let open = null;
  const prepared = new Set();
  /** For the app's checks of itself: a page of its own to stand in for every site. */
  let standIn = null;

  const siteOf = (id) => {
    const site = sites[id];
    return standIn ? { ...site, address: standIn, hosts: [new URL(standIn).hostname], pages: null, inDialog: false } : site;
  };
  const say = (what) => { if (open) tell("upload", { site: open.id, ...what }); };

  /** A site's corner of the browser is given its rules once. */
  function prepare(site) {
    const part = session.fromPartition(site.partition);
    if (prepared.has(site.partition)) return part;
    prepared.add(site.partition);
    // Google turns away a browser that says it is an app with a browser inside it, and so do others.
    part.setUserAgent(part.getUserAgent().replace(/\s(Electron|fpv-hangar|FPVHangar)\/\S+/gi, ""));
    part.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    part.setPermissionRequestHandler((_contents, permission, answer) => answer(allowed.has(permission)));
    return part;
  }

  /** What a page, or a sign-in window it opens, may open and go to. */
  function rules(contents, part, windows) {
    contents.setWindowOpenHandler(({ url }) => {
      if (signsIn(url)) {
        return { action: "allow", overrideBrowserWindowOptions: { parent: window() ?? undefined, width: 520, height: 720, autoHideMenuBar: true, backgroundColor: "#ffffff", webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      }
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (child) => {
      windows.add(child);
      child.on("closed", () => windows.delete(child));
      rules(child.webContents, part, windows);
    });
    contents.on("will-navigate", (event, address) => { if (!/^https:\/\//i.test(address)) event.preventDefault(); });
  }

  /**
   * The page's inner workings, to put a file into its chooser, as the browser's own tools for
   * developers do. Null if they can't be reached. They are only reached into on the upload page
   * itself, and let go of as soon as the video is in: never while the pilot is signing in, which
   * the sites watch closely.
   */
  function inner(here) {
    if (here.debugger) return here.debugger;
    const contents = here.contents;
    try {
      contents.debugger.attach("1.3");
    } catch (error) {
      log(`Uploading: ${error.message}`);
      return null;
    }
    const debug = contents.debugger;
    debug.on("detach", () => {
      if (here.debugger !== debug) return;
      here.debugger = null;
      here.worlds.clear();
    });
    here.debugger = debug;
    return debug;
  }

  function letGo(here) {
    const debug = here.debugger;
    here.debugger = null;
    here.worlds.clear();
    try {
      debug?.detach();
    } catch {}
  }

  /** The frames of the page that are on the site, each with a place of the app's own to look at
   *  it from, apart from the page's own scripts. */
  async function framesOnSite(here, debug) {
    const { frameTree } = await debug.sendCommand("Page.getFrameTree");
    const all = [];
    const walk = (node) => {
      all.push(node.frame);
      for (const child of node.childFrames ?? []) walk(child);
    };
    walk(frameTree);
    const places = [];
    for (const frame of all.filter((one) => here.site.hosts.includes(hostOf(one.url)))) {
      const key = `${frame.id} ${frame.loaderId}`;
      if (!here.worlds.has(key)) {
        const { executionContextId } = await debug.sendCommand("Page.createIsolatedWorld", { frameId: frame.id, worldName: "FPV Hangar" });
        here.worlds.set(key, executionContextId);
      }
      places.push({ key, context: here.worlds.get(key) });
    }
    return places;
  }

  /** Puts the video into the page's chooser, once it has shown one on two looks in a row: by then
   *  the page has finished making it. */
  async function putVideo(here) {
    const contents = here.contents;
    if (!mayTakeVideo(here.site, contents.getURL())) {
      here.seen = 0;
      letGo(here);
      return;
    }
    const debug = inner(here);
    if (!debug) {
      if (!here.unreachable) say({ problem: "The video can't be put in by itself here. Drag it onto the page from the left." });
      here.unreachable = true;
      return;
    }
    let found = null;
    for (const { key, context } of await framesOnSite(here, debug)) {
      try {
        const { result } = await debug.sendCommand("Runtime.evaluate", { expression: chooserScript({ inDialog: here.site.inDialog }), contextId: context });
        if (result?.subtype === "node" && result.objectId) {
          found = result.objectId;
          break;
        }
      } catch {
        // The frame has moved on since: it is looked at afresh next time.
        here.worlds.delete(key);
      }
    }
    if (!found) {
      here.seen = 0;
      return;
    }
    here.seen += 1;
    try {
      if (here.seen < 2 || open !== here) return;
      await debug.sendCommand("DOM.setFileInputFiles", { files: [here.file], objectId: found });
      // A chooser can turn a file away without a word, as with some characters in its name: what
      // it holds afterwards is looked at, and the video as it is in the library tried next.
      const holds = async () => (await debug.sendCommand("Runtime.callFunctionOn", { objectId: found, functionDeclaration: "function () { return this.files ? this.files.length : 0; }", returnByValue: true })).result?.value > 0;
      let taken = null;
      for (const file of new Set([here.file, here.original])) {
        await debug.sendCommand("DOM.setFileInputFiles", { files: [file], objectId: found });
        if (await holds()) {
          taken = file;
          break;
        }
      }
      if (!taken) {
        here.stuck = true;
        say({ problem: `${here.site.title}'s page wouldn't take the video by itself. Drag it onto the page from the left.` });
        return;
      }
      if (taken !== here.file) {
        rmSync(here.file, { force: true });
        here.file = taken;
        say({ name: basename(taken) });
      }
      here.put = true;
      say({ put: true, problem: null });
    } finally {
      await debug.sendCommand("Runtime.releaseObject", { objectId: found }).catch(() => {});
      if (here.put) letGo(here);
    }
  }

  /** Reads the page for the link of the video going up. */
  async function findLink(here) {
    const contents = here.contents;
    if (!here.site.hosts.includes(hostOf(contents.getURL()))) return;
    const read = JSON.parse(await contents.executeJavaScript(readPage, false));
    // What was on the page before the video went in is the channel's other videos.
    if (!here.put) for (const link of videoLinksIn(read.all)) here.before.add(link);
    const link = uploadLink(read, here.before, here.put);
    if (!link || open !== here) return;
    here.link = link;
    if (here.site.keepsLink && here.track && here.run) keepLink(here.track, here.run, link);
    say({ link, kept: Boolean(here.site.keepsLink && here.track && here.run) });
  }

  async function look(here) {
    if (open !== here || here.looking || here.contents.isDestroyed()) return;
    here.looking = true;
    try {
      if (here.site.findsLink && !here.link) await findLink(here);
      if (!here.put && !here.stuck) await putVideo(here);
    } catch (error) {
      // A page part-way through loading can't be read. The next look tries again.
      if (!/destroyed|navigat|context|Cannot find/i.test(error.message)) log(`Uploading to ${here.site.title}: ${error.message}`);
    } finally {
      here.looking = false;
    }
  }

  /** The video under the name it goes up by: a second name for the same file, or a copy where
   *  the disk can't do that. The video as it is when neither can be made. */
  async function named(file, name) {
    const wanted = fileName(name);
    if (!wanted) return file;
    const target = join(staging, `${wanted}${extname(file)}`);
    try {
      mkdirSync(staging, { recursive: true });
      rmSync(target, { force: true });
      try {
        linkSync(file, target);
      } catch {
        await copyFile(file, target, constants.COPYFILE_FICLONE);
      }
      return target;
    } catch (error) {
      log(`Naming a video to upload: ${error.message}`);
      rmSync(target, { force: true });
      return file;
    }
  }

  /** Whatever was going on in a page comes to an end, and the page goes. */
  function finish(here) {
    if (!here || here.finished) return;
    here.finished = true;
    // A copy shown for the pilot's own browser to upload stays until the app next starts.
    if (here.file !== here.original && !here.shown) rmSync(here.file, { force: true });
    clearInterval(here.timer);
    if (open === here) open = null;
    window()?.off("close", here.guard);
    letGo(here);
    for (const child of here.windows) if (!child.isDestroyed()) child.destroy();
    try {
      window()?.contentView.removeChildView(here.view);
    } catch {}
    if (!here.contents.isDestroyed()) here.contents.close();
    tell("upload", { site: here.id, closed: true });
    // The window was being closed when the page was asked to go: it goes now.
    if (here.quitting) {
      setTimeout(() => {
        const closing = window();
        if (closing && !closing.isDestroyed()) closing.close();
      }, 0);
    }
  }

  const api = {
    /** Opens a site's upload page over the place given, for one video, which goes up as `name`. */
    async openUpload(id, place, { file, name = "", track = null, run = null }) {
      if (!Object.hasOwn(sites, id) || !window()) return { problem: "There is no such site." };
      if (!existsSync(file)) return { problem: "That video isn't there any more." };
      if (open) finish(open);
      const original = file;
      file = await named(original, name);
      const site = siteOf(id);
      const part = prepare(site);
      const view = new WebContentsView({ webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      // Kept by itself: a view no longer has its page once the page has closed.
      const here = { id, site, view, contents, file, original, track, run, put: false, seen: 0, link: null, before: new Set(), windows: new Set(), debugger: null, worlds: new Map(), looking: false, quitting: false, finished: false };
      // Closing the window while a page is open leaves the page first, which may ask the pilot.
      // Closing it again while that is going on closes it, page and all.
      here.guard = (event) => {
        if (open !== here || here.finished) return;
        if (here.quitting) {
          here.quitting = false;
          finish(here);
          return;
        }
        event.preventDefault();
        here.quitting = true;
        tell("uploadLeave", { site: id });
      };
      open = here;
      rules(contents, part, here.windows);
      contents.on("did-start-loading", () => say({ loading: true }));
      contents.on("did-stop-loading", () => say({ loading: false }));
      contents.on("did-fail-load", (_event, code, _words, _address, mainFrame) => {
        // -3 is a load the page itself gave up, as when it moves on to another of its addresses.
        if (mainFrame && code !== -3) say({ loading: false, problem: `${site.title} didn't load. Check the connection and press Load again.` });
      });
      contents.on("render-process-gone", () => say({ problem: `${site.title}'s page stopped. Press Load again.` }));
      window().contentView.addChildView(view);
      window().on("close", here.guard);
      api.placeUpload(place);
      here.timer = setInterval(() => look(here), every);
      contents.loadURL(still && !standIn ? "about:blank" : site.address).catch(() => {});
      // The name the video goes up by, for the column to show.
      return { problem: null, name: basename(file) };
    },

    /** Moves the page to where the app's page says it goes, when the window changes size. */
    placeUpload(place) {
      if (!open || !place) return;
      open.view.setBounds({ x: Math.round(place.x), y: Math.round(place.y), width: Math.max(1, Math.round(place.width)), height: Math.max(1, Math.round(place.height)) });
    },

    /** The page steps aside while the app asks the pilot something, and comes back after. */
    showUpload(shown) {
      open?.view.setVisible(Boolean(shown));
    },

    /** Loads the site's upload page again, from the start: the video goes in again too. */
    reloadUpload() {
      if (!open) return;
      Object.assign(open, { put: false, stuck: false, seen: 0, link: null, before: new Set() });
      say({ put: false, link: null, problem: null });
      open.contents.loadURL(open.site.address).catch(() => {});
    },

    /** Puts the video in again the next time the page shows its chooser. */
    putVideoAgain() {
      if (!open) return;
      Object.assign(open, { put: false, stuck: false, seen: 1 });
      say({ put: false, problem: null });
    },

    /** Starts dragging the video, from the app's page, to drop onto the site's. */
    dragVideo() {
      if (!open || !window()) return;
      const icon = nativeImage.createFromPath(join(folder, "..", "assets", "icon.png"));
      if (icon.isEmpty()) return;
      window().webContents.startDrag({ file: open.file, icon: icon.resize({ width: 48, height: 48 }) });
    },

    copyText(text) {
      return clipboard.writeText(String(text ?? ""));
    },

    /** The way round a site that won't let the app's page in: its upload page in the pilot's own
     *  browser, with the video shown in its folder and the words on the clipboard. */
    async uploadElsewhere(text) {
      if (!open) return;
      await clipboard.writeText(String(text ?? ""));
      shell.openExternal(sites[open.id].address);
      open.shown = true;
      shell.showItemInFolder(open.file);
    },

    /**
     * Leaves the page. It is asked first, as a browser closing a tab asks it: `{ closed: true }`
     * once it has gone, or `{ held: true }` when it says it is still busy, as with a video still
     * going up. With `force`, it goes whatever it says.
     */
    closeUpload({ force = false } = {}) {
      const here = open;
      if (!here) return { closed: true };
      const contents = here.contents;
      if (force || contents.isDestroyed()) {
        finish(here);
        return { closed: true };
      }
      return new Promise((answer) => {
        let done = false;
        const end = (what) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          contents.off("will-prevent-unload", held);
          answer(what);
        };
        const held = () => {
          here.view.setVisible(false);
          end({ held: true });
        };
        contents.on("will-prevent-unload", held);
        contents.once("destroyed", () => {
          finish(here);
          end({ closed: true });
        });
        // A page that never answers isn't waited on for long.
        const timer = setTimeout(() => {
          finish(here);
          end({ closed: true });
        }, 5000);
        contents.close({ waitForBeforeUnload: true });
      });
    },

    /** The pilot stays on a page that is still busy: it comes back, and the window stays open. */
    stayOnUpload() {
      if (!open) return;
      open.quitting = false;
      open.view.setVisible(true);
      open.contents.focus();
    },

    /** For the app's checks of itself: which page is open and where, and how it is getting on. */
    uploadIsOpen() {
      return open ? { id: open.id, file: open.file, original: open.original, put: open.put, link: open.link, place: open.view.getBounds(), shown: open.view.getVisible(), windows: open.windows.size } : null;
    },
    /** For the app's checks of itself: what the open page says of itself, and of the video it was given. */
    uploadReads() {
      if (!open) return null;
      // As if the pilot had pressed something on the page, which a page needs before it may ask to stay.
      return open.contents.executeJavaScript(`({ at: location.href, title: document.title, chosen: window.chosen ?? null })`, true).catch(() => null);
    },
  };
  // Only a copy that is trying itself out can stand a page of its own in for the sites.
  if (quiet) api.useUploadStandIn = (address) => { standIn = address; };
  return api;
}

function hostOf(address) {
  try {
    return new URL(address).hostname;
  } catch {
    return "";
  }
}
