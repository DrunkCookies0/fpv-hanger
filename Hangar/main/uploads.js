// Uploading a finished video through a site's own upload page: YouTube, YouTube Shorts, TikTok
// and Instagram (see shared/uploads.js). Posting is always left to the site's own button.
//
// TikTok's and Instagram's pages are shown inside the app's window. The pilot signs in on the
// site's own page, once: each site has a corner of the browser of its own, kept between runs. The
// app puts the video into the page's own file chooser when the page shows one, the way a pilot
// choosing it would.
//
// YouTube's page opens in the pilot's own browser instead, since Google turns away anyone signing
// in inside an app. The app's page stays open beside it, with the video to drag onto YouTube's and
// the words to paste, and takes in the video's link when the pilot copies it on YouTube and comes
// back to the app. On any of the sites, the video's link can be pasted in, and is kept with its
// run, as the run's log of where it went up.
//
// The video goes up under a name that says what it is, which YouTube and TikTok start its title
// and its caption from: a copy of it by that name, made in a folder of the app's own (a second
// name for the same file where the disk allows, so it takes no room). It goes with the page,
// unless the pilot's own browser may still be reading it: then it stays until the app next starts.
//
// A video going up in the app is lost if its page closes. Leaving the page asks it first, as a
// browser closing a tab does, and if the page says it is still busy, the pilot is asked before it
// goes. The same happens when the window is closed while a page is open.

import { WebContentsView, session, shell, clipboard, nativeImage } from "electron";
import { existsSync, linkSync, mkdirSync, rmSync, constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sites, mayTakeVideo, chooserScript, fileName, googleSaysNo, linkAlone, linkFor } from "../shared/uploads.js";
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

/** How often the page is looked at for its chooser. */
const every = 1500;

/**
 * The uploads as the app's pages ask for them: `openUpload`, `placeUpload`, `showUpload`,
 * `reloadUpload`, `putVideoAgain`, `dragVideo`, `copyText`, `uploadElsewhere`, `closeUpload`
 * and `stayOnUpload` for a page in the app, and `openUploadPage`, `showUploadVideo`,
 * `lookForLink` and `setUploadLink` for one in the pilot's own browser. The pages hear "upload"
 * (how the page is getting on: loading, a problem, whether the video is in, its link) and
 * "uploadLeave" (the window is being closed: leave the page first). `keepLink(track, run, site,
 * link)` keeps a video's link on a site with its run. The named copies go in `staging`. With `still`, a
 * page is given its place but its site is not called on: that is for the app drawing its pages
 * into pictures. With `quiet`, nothing is opened in the pilot's own browser or file browser.
 */
export function makeUploads({ window, tell, keepLink, staging, quiet = false, still = false }) {
  // Named copies left from when the app last ran. One a browser still has open stays.
  try {
    rmSync(staging, { recursive: true, force: true });
  } catch (error) {
    log(`Clearing the videos named to upload: ${error.message}`);
  }
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

  /** Opens an address in the pilot's own browser, or shows a file in their file browser. A copy
   *  that is trying itself out only notes it, for its checks. */
  const elsewhere = (how, target) => {
    open?.went.push(`${how} ${target}`);
    if (quiet) return;
    if (how === "open") shell.openExternal(target);
    else shell.showItemInFolder(target);
  };

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
  function rules(contents, part, here) {
    contents.setWindowOpenHandler(({ url }) => {
      if (signsIn(url)) {
        return { action: "allow", overrideBrowserWindowOptions: { parent: window() ?? undefined, width: 520, height: 720, autoHideMenuBar: true, backgroundColor: "#ffffff", webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      }
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (child) => {
      here.windows.add(child);
      child.on("closed", () => here.windows.delete(child));
      rules(child.webContents, part, here);
    });
    contents.on("will-navigate", (event, address) => { if (!/^https:\/\//i.test(address)) event.preventDefault(); });
    // Signing in with Google, as TikTok and Instagram offer, is turned away by Google here.
    const turnedAway = (_event, address) => {
      if (open !== here || !googleSaysNo(address)) return;
      say({ google: true });
    };
    contents.on("did-navigate", turnedAway);
    contents.on("did-navigate-in-page", turnedAway);
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

  async function look(here) {
    if (open !== here || here.looking || here.contents.isDestroyed()) return;
    here.looking = true;
    try {
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
    // A copy lent to the pilot's own browser to upload stays until the app next starts.
    if (here.file !== here.original && !here.lent) {
      try {
        rmSync(here.file, { force: true });
      } catch (error) {
        log(`Uploading: ${error.message}`);
      }
    }
    clearInterval(here.timer);
    if (open === here) open = null;
    if (here.guard) window()?.off("close", here.guard);
    if (here.comeBack) window()?.off("focus", here.comeBack);
    if (here.view) {
      letGo(here);
      for (const child of here.windows) if (!child.isDestroyed()) child.destroy();
      try {
        window()?.contentView.removeChildView(here.view);
      } catch {}
      if (!here.contents.isDestroyed()) here.contents.close();
    }
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
    /**
     * Opens a site's upload page for one video, which goes up as `name`: over the place given, or,
     * for YouTube, in the pilot's own browser once they ask (`openUploadPage`). `link` is the one
     * already kept with the run, if any.
     */
    async openUpload(id, place, { file, name = "", track = null, run = null, link = null }) {
      if (!Object.hasOwn(sites, id) || !window()) return { problem: "There is no such site." };
      if (!existsSync(file)) return { problem: "That video isn't there any more." };
      if (open) finish(open);
      const original = file;
      file = await named(original, name);
      const site = siteOf(id);
      if (site.browser) {
        const here = { id, site, browser: true, file, original, track, run, link: linkFor(id, link), lent: false, went: [], finished: false };
        // Coming back from the browser is when a link the pilot copied there is looked for.
        here.comeBack = () => api.lookForLink();
        open = here;
        window().on("focus", here.comeBack);
        return { problem: null, name: basename(file), browser: true, link: here.link };
      }
      const part = prepare(site);
      const view = new WebContentsView({ webPreferences: { session: part, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      // Kept by itself: a view no longer has its page once the page has closed.
      const here = { id, site, view, contents, file, original, track, run, link: linkFor(id, link), put: false, seen: 0, windows: new Set(), debugger: null, worlds: new Map(), looking: false, quitting: false, lent: false, went: [], finished: false };
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
      rules(contents, part, here);
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
      return { problem: null, name: basename(file), link: here.link };
    },

    /** Moves the page to where the app's page says it goes, when the window changes size. */
    placeUpload(place) {
      if (!open?.view || !place) return;
      open.view.setBounds({ x: Math.round(place.x), y: Math.round(place.y), width: Math.max(1, Math.round(place.width)), height: Math.max(1, Math.round(place.height)) });
    },

    /** The page steps aside while the app asks the pilot something, and comes back after. */
    showUpload(shown) {
      open?.view?.setVisible(Boolean(shown));
    },

    /** Loads the site's upload page again, from the start: the video goes in again too. */
    reloadUpload() {
      if (!open?.view) return;
      Object.assign(open, { put: false, stuck: false, seen: 0 });
      say({ put: false, problem: null });
      open.contents.loadURL(open.site.address).catch(() => {});
    },

    /** Puts the video in again the next time the page shows its chooser. */
    putVideoAgain() {
      if (!open?.view) return;
      Object.assign(open, { put: false, stuck: false, seen: 1 });
      say({ put: false, problem: null });
    },

    /** Starts dragging the video, from the app's page, to drop onto the site's. */
    dragVideo() {
      if (!open || !window()) return;
      const icon = nativeImage.createFromPath(join(folder, "..", "assets", "icon.png"));
      if (icon.isEmpty()) return;
      if (open.browser) open.lent = true;
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
      open.lent = true;
      elsewhere("open", sites[open.id].address);
      elsewhere("show", open.file);
    },

    /** Opens the site's upload page in the pilot's own browser. */
    openUploadPage() {
      if (!open?.browser) return;
      open.lent = true;
      elsewhere("open", sites[open.id].address);
    },

    /** Shows the video in the pilot's file browser, to drag from there. */
    showUploadVideo() {
      if (!open) return;
      open.lent = true;
      elsewhere("show", open.file);
    },

    /** Takes in the video's link when the pilot has copied it on YouTube, with its own copy
     *  button, and come back to the app. Only a link by itself on the clipboard is taken. It is
     *  only looked for when it has a run to be kept with. */
    async lookForLink() {
      const here = open;
      if (!here?.browser || !here.track || !here.run) return;
      const link = linkAlone(here.id, await clipboard.readText());
      if (link && link !== here.link && open === here) api.setUploadLink(link);
    },

    /** The video's link on the site, pasted or typed by the pilot or taken from the clipboard,
     *  kept with its run. Empty takes it away. */
    setUploadLink(text) {
      const here = open;
      if (!here) return null;
      const typed = String(text ?? "").trim();
      const link = linkFor(here.id, typed);
      if (typed !== "" && !link) {
        const problem = `That isn't a link to a video on ${here.site.title}.`;
        say({ linkProblem: problem });
        return { problem };
      }
      here.link = link;
      const kept = Boolean(here.track && here.run);
      if (kept) keepLink(here.track, here.run, here.id, link ?? "");
      say({ link, kept, linkProblem: null });
      return { link, kept };
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
      if (force || !contents || contents.isDestroyed()) {
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
      if (!open?.view) return;
      open.quitting = false;
      open.view.setVisible(true);
      open.contents.focus();
    },

    /** For the app's checks of itself: which page is open and where, and how it is getting on. */
    uploadIsOpen() {
      if (!open) return null;
      const { id, browser = false, file, original, put = false, link = null, lent, went } = open;
      return { id, browser, file, original, put, link, lent, went: [...went], place: open.view?.getBounds() ?? null, shown: open.view?.getVisible() ?? false, windows: open.windows?.size ?? 0 };
    },
    /** For the app's checks of itself: what the open page says of itself, and of the video it was given. */
    uploadReads() {
      if (!open?.contents) return null;
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
