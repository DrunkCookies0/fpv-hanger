// The app's window: which page is showing, what is at its foot, and what the main process says
// has changed.

import { app, ask, hangar, setDraw, render, refresh, update, go, open, loadTrack, loadForm, allTracks, whenQuiet } from "./core.js";
import { h, fill, redraw, icon } from "./ui.js";
import { mac } from "./words.js";
import { home } from "./views/home.js";
import { videoCreator } from "./views/creator.js";
import { leaderboard, settings, guidePage } from "./views/pages.js";
import { showNote, showSetUp } from "./views/notes.js";
import { closeSheets } from "./sheets.js";
import { typefaceReady } from "./timer.js";
import { SongSound } from "./sound.js";

const stage = document.getElementById("stage");
const status = document.getElementById("status");

function pageView() {
  switch (app.page.name) {
    case "track": case "tracks": return videoCreator();
    case "leaderboard": return leaderboard();
    case "settings": return settings();
    case "guide": return guidePage();
    default: return home();
  }
}

/** Shows what is being made, or the last thing that happened. */
function drawStatus() {
  const job = app.state?.job;
  if (job) {
    fill(status, h("div.status.job",
      h("span.job-title", job.title),
      h("span.job-bar", h("span.job-done", { style: { width: `${Math.max(0, Math.min(1, job.progress)) * 100}%` } })),
      h("span.job-percent", `${Math.floor(Math.max(0, Math.min(1, job.progress)) * 100)}%`)));
  } else if (app.notice) {
    fill(status, h("div.status.notice", h("span.notice-text", app.notice), h("button.notice-close", { type: "button", "aria-label": "Close", onclick: () => {
      app.notice = null;
      drawStatus();
    } }, icon("close", 10))));
  } else {
    fill(status);
  }
}

/** Draws the page that is showing. What is being typed, and how far the page is scrolled, stay as they were. */
function draw() {
  if (!app.state) return;
  const key = `${app.page.name} ${app.page.track ?? ""}`;
  const samePage = stage.dataset.page === key;
  const scrolled = [...stage.querySelectorAll("[data-scroll]")].filter((one) => samePage || one.dataset.scroll === "side").map((one) => [one.dataset.scroll, one.scrollTop]);
  redraw(stage, h("div.stage", pageView()));
  stage.dataset.page = key;
  for (const [name, top] of scrolled) {
    const one = stage.querySelector(`[data-scroll="${name}"]`);
    if (one) one.scrollTop = top;
  }
  drawStatus();
}

// What the main process says by itself.
hangar.hear("job", (job) => {
  if (!app.state) return;
  const was = Boolean(app.state.job);
  app.state.job = job;
  // Starting and finishing turn buttons off and on. In between, only the bar moves.
  if (was !== Boolean(job)) render();
  else drawStatus();
});
hangar.hear("changed", () => update());
hangar.hear("front", () => refresh({ quietly: true }));
hangar.hear("menu", (what) => app.editor?.menu?.(what));

// The time left to submit counts down by itself.
setInterval(() => {
  if (app.page.name === "track" && !app.editor && !document.querySelector("#sheets .backdrop, .menu") && !stage.contains(document.activeElement?.closest?.("input"))) render();
}, 60000);

// Anything that goes wrong in a page is written down by the main process.
window.addEventListener("error", (event) => hangar.ask("log", `${event.message} (${(event.filename ?? "").split("/").pop()}:${event.lineno})`));
window.addEventListener("unhandledrejection", (event) => hangar.ask("log", String(event.reason?.stack ?? event.reason)));

// Nothing dropped on the window by mistake is ever opened in place of the app.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

document.body.classList.add(mac ? "mac" : "windows");
setDraw(draw);

// For the app's checks of itself, which work it from outside.
window.hangar_ = { app };

const started = (async () => {
  app.state = await ask("refresh");
  SongSound.muted = app.state.quiet;
  render();
  // The welcome note on the very first run, or what is new the first time a newer version is run.
  const hello = await ask("greet");
  if (hello.notice) {
    app.notice = hello.notice;
    render();
  }
  if (hello.note) showNote(hello.note);
})();

/**
 * For the mode that draws a page into a picture (`--snapshot`): shows one of the app's pages or
 * sheets and comes back once everything on it has arrived.
 *
 *   home, creator, track, track:<path>, files (a track with its first run's files showing),
 *   settings, guide, leaderboard, welcome, whatsnew, setup, setup:<pilot name> (the second
 *   question, looked up), trackview, notice:<words>
 */
/** For the mode that writes the read-me a download goes out with (`--read-me`). */
window.readMeText = async (platform) => {
  await started;
  const { readMeText } = await import("./readme.js");
  return readMeText(platform, app.state.version);
};

window.showForSnapshot = async (which) => {
  await started;
  app.state = await ask("whenTimed");
  closeSheets();
  const [name, ...rest] = which.split(":");
  const detail = rest.join(":");
  const aTrack = () => (detail && allTracks().includes(detail) ? detail : app.state.lastTrack && allTracks().includes(app.state.lastTrack) ? app.state.lastTrack : allTracks()[0]);
  const showTrack = async () => {
    const track = aTrack();
    if (!track) return go({ name: "tracks" });
    go({ name: "track", track });
    await loadTrack(track);
    await loadForm(track, true);
  };
  if (name === "creator") go({ name: "tracks" });
  else if (name === "track") await showTrack();
  else if (name === "files") {
    await showTrack();
    const data = app.tracks.get(app.page.track);
    if (data?.summary.runs[0]) app.expanded.add(`${app.page.track}\n${data.summary.runs[0].name}`);
  } else if (name === "settings" || name === "guide" || name === "leaderboard") open({ name });
  else if (name === "welcome") await showNote({ kind: "welcome" });
  else if (name === "whatsnew") await showNote({ kind: "whatsNew", since: detail || null });
  else if (name === "setup") await showSetUp({ lookingUp: detail || null });
  else if (name === "editor" || name === "wave" || name === "mark") {
    // The marker editor, on the first run or the one named. "mark" is a clip with no markers yet.
    await showTrack();
    const data = app.tracks.get(app.page.track);
    const run = data?.summary.runs.find((one) => one.name === detail) ?? data?.summary.runs[0];
    const { editRun, markClip } = await import("./actions.js");
    if (name === "mark" && data?.unmarked[0]) await markClip(data.unmarked[0].path, app.page.track);
    else if (run) await editRun(run, app.page.track);
    for (let tries = 0; tries < 600 && !(app.editor && (app.editor.phase === "failed" || (app.editor.phase === "ready" && !app.editor.listening && app.editor.settled))); tries += 1) await new Promise((done) => setTimeout(done, 50));
    if (name === "wave" && app.editor?.phase === "ready") await app.editor.openSoundWave();
  } else if (name === "submit") {
    // Check your answers, for the fastest run or the one named.
    await showTrack();
    const data = app.tracks.get(app.page.track);
    const run = data?.summary.runs.find((one) => one.name === detail) ?? data?.summary.runs.find((one) => one.best);
    const { openSubmit } = await import("./views/submit.js");
    if (run) await openSubmit(app.page.track, run);
  } else if (name === "trackview") {
    // The track in 3D, with the drone held a fifth of the way round. "trackview:<track>@turn,tilt,far"
    // looks from a given side, to set it beside a photo of the real thing, and "#pipes" or "#lap"
    // on the end shows it being built.
    const [shown, work] = detail.split("#");
    const [which, from] = shown.split("@");
    const track = allTracks().includes(which) ? which : aTrack();
    if (track) {
      go({ name: "track", track });
      await loadTrack(track);
      const [turn, tilt, far] = (from ?? "").split(",").map(Number);
      const { openTrackView } = await import("./views/trackview.js");
      await openTrackView(track, { still: 0.21, from: from ? { turn, tilt, far } : null });
      if (work === "pipes" || work === "lap") app.trackView?.work(work);
    }
  } else if (name === "notice") app.notice = detail;
  else go({ name: "home" });
  render();
  // Everything the page is waiting for: what it asked the main process, its typeface, its pictures,
  // and a moment for what is drawn after those.
  await whenQuiet();
  await typefaceReady();
  await document.fonts.ready;
  const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
  for (let tries = 0; tries < 40 && [...document.images].some((image) => image.src && !image.complete); tries += 1) await pause(50);
  await pause(400);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  return true;
};
