// Making the finished videos. The work is done by a window nobody sees (worker/worker.js), which
// draws the timer and feeds FFmpeg. This starts that window when it is first needed and hands it jobs.

import { BrowserWindow, ipcMain } from "electron";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { place } from "./landing.js";

const here = dirname(fileURLToPath(import.meta.url));

export class VideoMaker {
  #window = null;
  #watching = new Map();
  #next = 1;

  constructor({ ffmpeg, temp }) {
    this.ffmpeg = ffmpeg;
    this.temp = temp;
    ipcMain.on("video-progress", (_event, id, fraction) => this.#watching.get(id)?.(fraction));
  }

  async #worker() {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    // It runs FFmpeg and writes files, so it has Node. It loads the app's own page and nothing else.
    const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await window.loadFile(join(here, "..", "worker", "worker.html"));
    this.#window = window;
    return window;
  }

  /** Makes one video and says how it went: { ok, problem, seconds, frames }. `onProgress` gets 0 to 1. */
  async make(job, onProgress = null) {
    const id = this.#next++;
    const window = await this.#worker();
    if (onProgress) this.#watching.set(id, onProgress);
    // Made in the app's own folder and moved into the library whole, so that a library in Google
    // Drive never sees a video being written (see landing.js).
    const made = join(this.temp, `video-${id}${extname(job.output)}`);
    try {
      const answer = await window.webContents.executeJavaScript(`makeVideo(${JSON.stringify({ ...job, output: made, id, ffmpeg: this.ffmpeg, temp: this.temp })})`);
      if (answer.ok) await place(made, job.output);
      return answer;
    } catch (error) {
      return { ok: false, problem: error.message };
    } finally {
      rmSync(made, { force: true });
      this.#watching.delete(id);
    }
  }

  close() {
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
  }
}
