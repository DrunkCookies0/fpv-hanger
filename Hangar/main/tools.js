// Other projects' own tools, shown inside the app's window: Betaflight's app and ExpressLRS's web
// flasher. Each is that project's web app, loaded from the project's own site, so it is always
// their newest release and looks after its own updates. Nothing of theirs is carried by the app.
//
// A tool is a page in a corner of the browser of its own (kept between runs, so the tool can work
// without a connection once it has been opened). It can reach flight controllers and radios over
// serial, USB, HID and Bluetooth, save and open the files the pilot chooses, and nothing else: no
// camera, no microphone, none of the app's own pages or files. Where a browser would put up its
// own list of devices to choose from, the app's page shows one (see renderer/views/tool.js).

import { WebContentsView, session, shell } from "electron";
import { outsideTools, isWithin } from "../shared/components.js";

/** What a tool's page is allowed besides devices: keeping itself for use without a connection,
 *  the files the pilot picks, and putting text on the clipboard. */
const allowed = new Set(["serial", "usb", "hid", "bluetooth", "fileSystem", "clipboard-sanitized-write", "persistent-storage", "background-sync", "window-management", "fullscreen"]);
const deviceKinds = new Set(["serial", "usb", "hid"]);

const hex = (number) => `0x${Number(number ?? 0).toString(16).padStart(4, "0")}`;

/** A device as the page's list shows it: what it is called, and what tells two alike apart. */
export function describe(kind, device) {
  if (kind === "serial") {
    const name = device.displayName || device.portName || "Serial port";
    const detail = [device.portName !== name ? device.portName : "", device.vendorId ? `${hex(device.vendorId)}:${hex(device.productId)}` : ""].filter(Boolean).join(" · ");
    return { id: String(device.portId), name, detail };
  }
  if (kind === "bluetooth") return { id: String(device.deviceId), name: device.deviceName || "Unnamed device", detail: String(device.deviceId) };
  const name = device.productName || device.name || `${kind === "usb" ? "USB" : "HID"} device`;
  const detail = [device.manufacturerName, `${hex(device.vendorId)}:${hex(device.productId)}`, device.serialNumber].filter(Boolean).join(" · ");
  return { id: String(device.deviceId ?? device.guid), name, detail };
}

/**
 * The tools as the app's pages ask for them: `openTool`, `placeTool`, `reloadTool`, `closeTool`
 * and `chooseToolDevice`. The pages hear "tool" (how its page is getting on) and "toolDevices"
 * (a list to choose from, or null when there is no longer anything to choose). With `still`, a
 * tool is given its place but its site is not called on: that is for the app trying itself out.
 */
export function makeTools({ window, tell, still = false }) {
  /** The one tool that is open: which, its view, and the choice it is waiting on. */
  let open = null;
  const prepared = new Set();

  const ours = (tool, address) => {
    try {
      return isWithin(tool, new URL(address).href);
    } catch {
      return false;
    }
  };
  /** Whether something asked for comes from a tool's own site. */
  const fromTool = (tool, address) => {
    try {
      return tool.within.some((start) => new URL(start).origin === new URL(address).origin);
    } catch {
      return false;
    }
  };

  /** Ends whatever choice is being waited on, with nothing chosen. */
  function drop() {
    const choice = open?.choice;
    if (!choice) return;
    open.choice = null;
    choice.answer(null);
    open.view.setVisible(true);
    tell("toolDevices", null);
  }

  /** Puts a list of devices before the pilot. `answer` is given the one chosen, or null. */
  function choose(kind, devices, answer) {
    if (!open) return answer(null);
    // A page that asks again while a list is up gets the new list: the first asking is let go.
    if (open.choice && open.choice.kind !== kind) drop();
    if (open.choice) open.choice.answer = answer;
    else open.choice = { kind, answer };
    open.choice.devices = devices.map((device) => describe(kind, device));
    // The tool's page lies over the app's own. It steps aside while the list is up.
    open.view.setVisible(false);
    tell("toolDevices", { tool: open.id, kind, devices: open.choice.devices });
  }

  /** A list that is up is brought up to date as things are plugged in and pulled out. */
  function changed(kind, device, added) {
    const choice = open?.choice;
    if (!choice || choice.kind !== kind) return;
    const one = describe(kind, device);
    choice.devices = choice.devices.filter((other) => other.id !== one.id);
    if (added) choice.devices.push(one);
    tell("toolDevices", { tool: open.id, kind, devices: choice.devices });
  }

  /** A tool's corner of the browser is given its rules once. */
  function prepare(tool) {
    const part = session.fromPartition(tool.partition);
    if (prepared.has(tool.partition)) return part;
    prepared.add(tool.partition);
    // The project's site turns away a browser that says it is an app with a browser inside it.
    part.setUserAgent(part.getUserAgent().replace(/\s(Electron|fpv-hangar|FPVHangar)\/\S+/gi, ""));
    part.setPermissionCheckHandler((_contents, permission, origin) => allowed.has(permission) && fromTool(tool, origin));
    part.setPermissionRequestHandler((contents, permission, answer, details) => answer(allowed.has(permission) && fromTool(tool, details.requestingUrl || contents.getURL())));
    // The tool sees the devices that are plugged in without asking for each, as the project's own
    // program does: its list of ports fills in by itself.
    part.setDevicePermissionHandler((details) => deviceKinds.has(details.deviceType) && fromTool(tool, details.origin));
    part.on("select-serial-port", (event, ports, _contents, answer) => {
      event.preventDefault();
      choose("serial", ports, (id) => answer(id ?? ""));
    });
    part.on("serial-port-added", (_event, port) => changed("serial", port, true));
    part.on("serial-port-removed", (_event, port) => changed("serial", port, false));
    part.on("select-usb-device", (event, details, answer) => {
      event.preventDefault();
      choose("usb", details.deviceList, (id) => answer(id ?? undefined));
    });
    part.on("usb-device-added", (_event, device) => changed("usb", device, true));
    part.on("usb-device-removed", (_event, device) => changed("usb", device, false));
    part.on("select-hid-device", (event, details, answer) => {
      event.preventDefault();
      choose("hid", details.deviceList, (id) => answer(id ?? undefined));
    });
    part.on("hid-device-added", (_event, details) => changed("hid", details.device, true));
    part.on("hid-device-removed", (_event, details) => changed("hid", details.device, false));
    return part;
  }

  const api = {
    /** Opens a tool over the place given on the app's page. */
    openTool(id, place) {
      const tool = Object.hasOwn(outsideTools, id) ? outsideTools[id] : null;
      if (!tool || !window()) return { problem: "There is no such tool." };
      api.closeTool();
      const view = new WebContentsView({ webPreferences: { session: prepare(tool), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      open = { id, view, choice: null };
      // A link out of the tool (its documentation, its community) opens in the pilot's own browser.
      const outside = (address) => { if (/^https:\/\//i.test(address)) shell.openExternal(address); };
      contents.setWindowOpenHandler(({ url }) => {
        outside(url);
        return { action: "deny" };
      });
      contents.on("will-navigate", (event, address) => {
        if (ours(tool, address)) return;
        event.preventDefault();
        outside(address);
      });
      // Bluetooth devices turn up one by one while the page is looking: each time, the whole list so far.
      contents.on("select-bluetooth-device", (event, devices, answer) => {
        event.preventDefault();
        choose("bluetooth", devices, (chosen) => answer(chosen ?? ""));
      });
      const said = (what) => { if (open?.view === view) tell("tool", { id, ...what }); };
      contents.on("did-start-loading", () => said({ loading: true, problem: null }));
      contents.on("did-stop-loading", () => said({ loading: false }));
      contents.on("did-fail-load", (_event, code, _words, _address, mainFrame) => {
        // -3 is a load the page itself gave up, as when it moves on to another of its addresses.
        if (mainFrame && code !== -3) said({ loading: false, problem: `${tool.title} didn't load. It needs a connection the first time it is opened, and works without one after that.` });
      });
      window().contentView.addChildView(view);
      api.placeTool(place);
      contents.loadURL(still ? "about:blank" : tool.address).catch(() => {});
      return { problem: null };
    },

    /** Moves the tool to where the page says it goes, when the window changes size. */
    placeTool(place) {
      if (!open || !place) return;
      open.view.setBounds({ x: Math.round(place.x), y: Math.round(place.y), width: Math.max(1, Math.round(place.width)), height: Math.max(1, Math.round(place.height)) });
    },

    /** Loads the tool again from its site: the way to pick up a release that has just come out. */
    reloadTool() {
      if (!open) return;
      drop();
      open.view.webContents.reloadIgnoringCache();
    },

    /** The pilot's answer to a list of devices: one of them, or null for none. */
    chooseToolDevice(id) {
      const choice = open?.choice;
      if (!choice) return;
      const chosen = choice.devices.some((device) => device.id === id) ? id : null;
      open.choice = null;
      choice.answer(chosen);
      open.view.setVisible(true);
      tell("toolDevices", null);
      // The keys go back to the tool, where the pilot was.
      open.view.webContents.focus();
    },

    closeTool() {
      if (!open) return;
      drop();
      const { view } = open;
      open = null;
      try {
        window()?.contentView.removeChildView(view);
      } catch {}
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },

    /** For the app's checks of itself: which tool is open and where, and a list of devices put up
     *  as a page asking for one would put it up. The answer the page would be given comes back. */
    toolIsOpen() {
      return open ? { id: open.id, place: open.view.getBounds(), shown: open.view.getVisible(), choosing: open.choice?.kind ?? null } : null;
    },
    /** For the check that opens the real tools: what the open one's page says of itself. */
    toolReads() {
      if (!open) return null;
      return open.view.webContents.executeJavaScript(`({ title: document.title, at: location.href, serial: "serial" in navigator, usb: "usb" in navigator, hid: "hid" in navigator })`).catch(() => null);
    },
    pretendToolAsks(kind, devices) {
      return new Promise((answered) => choose(kind, devices, answered));
    },
    pretendToolDevice(kind, device, added) {
      changed(kind, device, added);
    },
  };
  return api;
}
