// What the buttons do: the things that change the library, each asking first where that is called for.

import { app, ask, take, say, render, go, settle, loadTrack, loadForm, trackName, hangar } from "./core.js";
import { question, confirm, showSheet } from "./sheets.js";
import { h, icon, primary, secondary } from "./ui.js";
import { bin, Bin } from "./words.js";

const busy = () => Boolean(app.state?.job);

/** Asks for a new event's name and makes it, with a first track in it. */
export async function newEvent() {
  const answer = await question({
    title: "New event",
    message: "An event is a race, a series, or just somewhere you fly. It gets its own folder in your library, with its own tracks, its own name on the timer and its own ID.",
    field: { placeholder: "Its name, such as RaceGOW7" },
    buttons: [{ title: "Cancel", value: false, kind: "secondary", cancel: true }, { title: "Create", value: true, kind: "primary", default: true }],
  });
  if (!answer.value) return;
  const made = take(await ask("newEvent", answer.text));
  if (made.track) go({ name: "track", track: made.track });
  else render();
}

/** Makes the next track in an event and goes to it. */
export async function newTrack(event) {
  const made = take(await ask("newTrack", event));
  if (made.track) go({ name: "track", track: made.track });
  else render();
}

/** The question before a track or event with something in it goes: the button only works once the
 *  phrase has been typed, so it can't be done by a stray click. Gives what was typed, or null. */
function removalSheet({ title, detail, phrase }) {
  return new Promise((answer) => {
    let close = () => {};
    const finish = (value) => {
      close();
      answer(value);
    };
    const ready = () => input.value.trim().toUpperCase() === phrase;
    const go = primary(`Move to ${Bin}`, () => ready() && finish(input.value), { disabled: true, "data-default": true });
    const input = h("input.field", { type: "text", spellcheck: false, "data-first": true, oninput: () => { go.disabled = !ready(); } });
    close = showSheet(h("div.removal",
      h("div.removal-title", icon("trash"), title),
      h("div.removal-detail", detail),
      h("div.removal-ask", "To go ahead, type ", h("strong", phrase), " below."),
      input,
      h("div.sheet-buttons", h("span.spacer"), secondary("Cancel", () => finish(null)), go),
    ), { onEscape: () => finish(null) });
  });
}

async function remove(what, name) {
  if (busy() || app.editor) return;
  let answer = take(await ask(what, name));
  if (answer?.question) {
    const typed = await removalSheet(answer.question);
    if (typed === null) return;
    answer = take(await ask(what, name, typed));
  }
  settle();
  render();
}

/** Deletes a track. An empty one goes straight away. One with anything in it waits for its phrase. */
export const removeTrack = (track) => remove("removeTrack", track);
/** Deletes an event, which has to be empty of tracks first. */
export const removeEvent = (event) => remove("removeEvent", event);

/** Asks before moving files to the Trash. `files` are { path, name }. */
export async function trashFiles(files, track) {
  if (files.length === 0) return;
  const yes = await confirm({ title: `Move to ${bin}?`, message: files.map((file) => file.name).join(", "), yes: `Move to ${Bin}`, destructive: true });
  if (!yes) return;
  take(await ask("trash", files.map((file) => file.path)));
  await loadTrack(track);
  render();
}

export async function play(path) {
  take(await ask("play", path));
  render();
}

export const reveal = (path) => ask("reveal", path);

async function added(answer, track) {
  take(answer);
  await loadTrack(track);
  render();
  if (answer?.open) openForMarking(answer.open, track);
}

/** Asks which recordings to add to a track. */
export async function chooseClips(track) {
  added(await ask("chooseClips", track), track);
}

/** Adds recordings dropped onto a track's page. */
export async function dropClips(track, files) {
  const paths = [...files].map((file) => hangar.pathOf(file)).filter(Boolean);
  if (paths.length > 0) added(await ask("addClips", track, paths), track);
}

/** Makes a finished video of a run, then asks whether to watch it. */
export async function makeVideo(track, run, shape) {
  if (busy()) return;
  const answer = take(await ask("makeVideo", track, run.name, shape));
  if (answer?.crowded) app.expanded.add(`${track}\n${run.name}`);
  await loadTrack(track);
  render();
  if (!answer?.made) return;
  const watch = await question({
    title: "Your video is ready",
    message: `The ${answer.made.title} of ${answer.made.run} is made. Watch it now?`,
    buttons: [{ title: "Not now", value: false, kind: "secondary", cancel: true }, { title: "Watch it now", value: true, kind: "primary", default: true }],
  });
  if (watch) play(answer.made.path);
}

/** Opens a clip in the marker editor: with its markers when it is already a timed run, and
 *  otherwise ready for its first one. */
export async function openForMarking(clip, track) {
  const name = clip.split(/[\\/]/).pop();
  const run = app.tracks.get(track)?.summary.runs.find((one) => one.clip && one.clip.split(/[\\/]/).pop() === name);
  if (run) editRun(run, track);
  else markClip(clip, track);
}

async function openEditor(target) {
  if (app.editor) return;
  app.notice = null;
  const { openEditor: start } = await import("./views/editor.js");
  start(target);
}

export const editRun = (run, track) => openEditor({ track, name: run.name, clip: run.clip, crossings: run.crossings ?? [] });
export const markClip = (clip, track) => openEditor({ track, name: clip.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""), clip, crossings: [] });

/** Opens the track drawn in 3D, with the lap flown round it. A track with no view yet opens ready
 *  to be built. */
export async function openTrackView(track) {
  const { openTrackView: open } = await import("./views/trackview.js");
  await open(track);
}

export async function submitRun(track, run) {
  const { openSubmit } = await import("./views/submit.js");
  openSubmit(track, run);
}

/** Uses a pasted link as a track's entry form. */
export async function useForm(track, address) {
  await ask("setForm", track, address);
  app.drafts.delete(`form ${track}`);
  await loadTrack(track);
  await loadForm(track, true);
  render();
}

// Pilot & settings.

export async function setSettings(patch) {
  app.state = await ask("setSettings", patch);
}

export async function setDetails(event, details) {
  app.state = await ask("setDetails", event, details);
}

export async function chooseLogo(event) {
  take(await ask("chooseLogo", event));
  render();
}

export async function removeLogo(event) {
  take(await ask("removeLogo", event));
  render();
}

export async function chooseBookend(event, shape, which) {
  take(await ask("chooseBookend", event, shape, which));
  render();
}

export async function removeBookend(event, shape, which) {
  take(await ask("removeBookend", event, shape, which));
  render();
}

export async function setBookendSeconds(event, shape, which, seconds) {
  app.state = await ask("setBookendSeconds", event, shape, which, seconds);
}

// Updates.

export async function checkForUpdates() {
  app.state = await ask("checkForUpdates");
  render();
}

/** Replaces the app with the newer version. The app closes and the new one opens. */
export async function installUpdate() {
  if (app.editor) {
    say("Close the marker editor before updating.");
    return render();
  }
  take(await ask("installUpdate"));
  render();
}

export async function chooseLibrary() {
  if (busy() || app.editor) return;
  const answer = take(await ask("chooseLibrary"));
  if (answer.moved) {
    app.tracks.clear();
    app.forms.clear();
    app.expanded.clear();
    app.page = { name: "home" };
    app.cameFrom = { name: "home" };
    go({ name: "settings" });
  }
  render();
}

export async function gatherLooseTracks() {
  if (app.editor) {
    app.notice = "Close the marker editor first.";
    return render();
  }
  const answer = take(await ask("gatherLooseTracks"));
  // What is remembered about each track moved with it. So does the page that was open.
  for (const [from, to] of Object.entries(answer.moved ?? {})) {
    if (app.cameFrom.name === "track" && app.cameFrom.track === from) app.cameFrom = { name: "track", track: to };
  }
  app.tracks.clear();
  app.forms.clear();
  app.expanded.clear();
  render();
}

export const openLink = (address) => ask("openLink", address);
export const openFolder = (path) => ask("openFolder", path);
export { trackName };
