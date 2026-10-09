// Reads a track out of the series' video of it: plays the video in a window nobody sees, takes
// stills of the chapter in which the track is built, and finds the pipes in them.
//
// Nothing of the video is kept. The stills are worked on in memory and dropped, and what comes of
// them is where the pipes are, and one small picture of the track standing for the pilot to check
// the result against.

import { BrowserWindow } from "electron";
import { Worker } from "node:worker_threads";
import { videoPage, chaptersIn, buildShot, standingMoments, captureBuild } from "../shared/trackvideo.js";

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/**
 * The stills of a video's build. `shot` is the stretch the track is built in, { from, to } in
 * seconds, for a video whose description doesn't say. `said` hears how it is going.
 *
 * Gives { width, height, built, changed, picture, chapters, shot, title }, or { problem } with,
 * where they were found, the chapters, for asking the pilot which one it is.
 */
export async function stillsOf(link, { shot = null, moments = null, said = () => {} } = {}) {
  const address = videoPage(link);
  if (!address) return { problem: "That isn't a link to a YouTube video. Put the link to the track's video in the box under Track video." };
  // The window is big so that the player asks for a sharp picture, and has a memory of its own
  // that is forgotten when the app closes: nothing of the pilot's browsing is in it.
  const window = new BrowserWindow({
    show: false, width: 1920, height: 1200,
    webPreferences: { offscreen: true, partition: "trackvideo", sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const js = (code) => window.webContents.executeJavaScript(`(async () => { ${code} })()`);
  try {
    said("Opening the video");
    // The page sends the window on to another address of its own, which ends the first load early.
    await window.loadURL(address).catch(() => {});
    await pause(1500);
    const opened = await js(`
      const wait = (ms) => new Promise((done) => setTimeout(done, ms));
      const told = () => window.ytInitialPlayerResponse ?? null;
      let video = null;
      for (let tries = 0; tries < 150; tries += 1) {
        video = document.querySelector("video");
        const status = told()?.playabilityStatus?.status;
        if ((video && video.readyState >= 2 && video.videoWidth) || (status && status !== "OK")) break;
        await wait(200);
      }
      // An advert plays in the same player. It is waited out, not skipped.
      for (let tries = 0; tries < 450 && document.querySelector(".ad-showing"); tries += 1) await wait(200);
      const status = told()?.playabilityStatus ?? {};
      return {
        ready: Boolean(video && video.readyState >= 2 && video.videoWidth) && !document.querySelector(".ad-showing"),
        length: video?.duration ?? null, title: told()?.videoDetails?.title ?? document.title,
        description: told()?.videoDetails?.shortDescription ?? "",
        status: status.status ?? null, reason: status.reason ?? status.messages?.[0] ?? null,
      };
    `);
    const chapters = chaptersIn(opened.description);
    if (!opened.ready) {
      const why = opened.status === "LIVE_STREAM_OFFLINE" ? `It isn't out yet${opened.reason ? ` (YouTube says: ${opened.reason})` : ""}. Try again once it is.`
        : opened.reason ? `YouTube says: ${opened.reason}` : "It didn't start playing. Check that this computer is online and the link opens in your browser, then try again.";
      return { problem: `The video couldn't be read. ${why}`, chapters, title: opened.title };
    }
    const where = shot ?? buildShot(chapters, opened.length);
    if (!where) return { problem: "The video's description doesn't say where the track is built. Give the times the build starts and ends, as they are on YouTube.", chapters, title: opened.title, needsTimes: true };
    if (!(where.to - where.from >= 4) || where.from < 0 || where.to > opened.length + 1) return { problem: `The build can't run from ${where.from} s to ${where.to} s in a video ${Math.round(opened.length)} s long. Check the two times.`, chapters, title: opened.title, needsTimes: true };

    said("Reading the build");
    const stills = await js(`
      ${captureBuild.toString()}
      const wait = (ms) => new Promise((done) => setTimeout(done, ms));
      const video = document.querySelector("video"), player = document.getElementById("movie_player");
      // The video at 480 lines, and a moment for the player to change to it. Sharper is worse here:
      // the search for pipes was worked out on a picture that soft. On Track 1 it finds 11 of the
      // 14 pipes at 480 lines, with the whole track among its other readings, and 10 at 720 or
      // 1080. Not every video has 480 lines: Track 2's came in 360 and 720. Then it is 720, and
      // the frames are made soft (see captureBuild), which is not quite as good.
      const sharpness = (player?.getAvailableQualityLevels?.() ?? []).includes("large") ? "large" : "hd720";
      player?.setPlaybackQualityRange?.(sharpness, sharpness);
      video.currentTime = ${JSON.stringify(where.from)};
      await wait(3500);
      const found = await captureBuild(video, ${JSON.stringify({ from: where.from, to: where.to, after: moments?.after ?? null, before: moments?.before ?? null, fallback: standingMoments(where) })});
      // Bytes cross to the app as text, a piece at a time.
      const text = (bytes) => {
        let out = "";
        for (let at = 0; at < bytes.length; at += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
        return btoa(out);
      };
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = Math.round((640 * found.height) / found.width);
      const whole = document.createElement("canvas");
      whole.width = found.width;
      whole.height = found.height;
      whole.getContext("2d").putImageData(new ImageData(found.built, found.width, found.height), 0, 0);
      canvas.getContext("2d").drawImage(whole, 0, 0, canvas.width, canvas.height);
      return { width: found.width, height: found.height, built: text(found.built), changed: text(found.changed), picture: canvas.toDataURL("image/jpeg", 0.82), sharp: [video.videoWidth, video.videoHeight], start: found.start, looked: found.looked, lapse: found.lapse, standingAt: found.standingAt, changes: found.changes };
    `);
    return {
      width: stills.width, height: stills.height, built: Buffer.from(stills.built, "base64"), changed: Buffer.from(stills.changed, "base64"),
      picture: stills.picture, sharp: stills.sharp, start: stills.start, looked: stills.looked, lapse: stills.lapse, standingAt: stills.standingAt, changes: stills.changes, chapters, shot: where, title: opened.title,
    };
  } catch (error) {
    return { problem: `The video couldn't be read: ${error.message}` };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

/** Finds the pipes in a build's stills, away from everything else. `sections` is how many the
 *  track is known to have, when it is. Gives { pipes, readings, leftOut, said } or { problem }. */
export function pipesIn({ built, changed, width, height }, sections = null) {
  return new Promise((done) => {
    const worker = new Worker(new URL("./trackreader.js", import.meta.url), { workerData: { built: new Uint8Array(built), changed: new Uint8Array(changed), width, height, sections } });
    worker.once("message", (found) => done(found));
    worker.once("error", (error) => done({ problem: error.message }));
    worker.once("exit", () => done({ problem: "The search stopped before it finished." }));
  });
}
