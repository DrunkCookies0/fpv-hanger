// The only door between the app's pages and the rest of the computer. A page can ask for one of
// the things on the list by name, and listen for news of work in progress. It has no other access.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("hangar", {
  /** Asks the app's main process to do something and waits for the answer. */
  ask: (what, ...details) => ipcRenderer.invoke("ask", what, ...details),
  /** Hears news of a kind, such as how far along a video is. Returns a way to stop listening. */
  hear: (kind, handler) => {
    const listener = (_event, ...details) => handler(...details);
    ipcRenderer.on(`news:${kind}`, listener);
    return () => ipcRenderer.removeListener(`news:${kind}`, listener);
  },
  /** Where a file dropped onto the window is on disk. */
  pathOf: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
});
