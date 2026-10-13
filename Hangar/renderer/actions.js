// What the buttons do: the things that change the library, each asking first where that is called for.

import { app, ask, take, say, render, go, settle, loadTrack, loadForm, loadCards, trackName, hangar } from "./core.js";
import { question, confirm, showSheet } from "./sheets.js";
import { h, icon, primary, secondary } from "./ui.js";
import { bin, Bin } from "./words.js";

const busy = () => Boolean(app.state?.job);

/** Asks for a new group's name and makes it. Any group but the season's then asks for its first race. */
export async function newEvent() {
  const answer = await question({
    title: "New group",
    message: "A group is a race series or a club you fly with. Its races go inside it, and its name goes on the timer of every video you make in it, with your ID and its logo if it has them.",
    field: { placeholder: "Its name, such as Circle City FPV" },
    buttons: [{ title: "Cancel", value: false, kind: "secondary", cancel: true }, { title: "Create", value: true, kind: "primary", default: true }],
  });
  if (!answer.value) return;
  const made = take(await ask("newEvent", answer.text));
  if (made.track) return go({ name: "track", track: made.track });
  render();
  if (made.event) await newRace(made.event);
}

/** Makes the season's next track in its group and goes to it. */
export async function newTrack(event) {
  const made = take(await ask("newTrack", event));
  if (made.track) go({ name: "track", track: made.track });
  else render();
}

/** Today, as a race's date is kept: YYYY-MM-DD, on this computer's calendar. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The sheet for a race's name and date, and, given `group`, the group it is in. `save` is given
 *  what was typed and comes back with what is wrong with it, which the sheet shows, or nothing once
 *  it is done. Gives true when it was saved. */
function raceSheet({ title, message, name = "", date = "", group = null, groups = [], button, save }) {
  return new Promise((done) => {
    let close = () => {};
    const finish = (value) => {
      close();
      done(value);
    };
    const nameField = h("input.field", { type: "text", value: name, placeholder: "Its name, such as Zero Traction Open Whoop Race #5", spellcheck: false, "data-first": true, "aria-label": "Name" });
    const dateField = h("input.field.date-field", { type: "date", value: date, "aria-label": "Date" });
    const groupField = group === null ? null : h("select.field", { "aria-label": "Group" }, groups.map((one) => h("option", { value: one.folder, selected: one.folder === group }, one.name || "Loose tracks")));
    const said = h("div.alert-message.warn", { "data-probe": "race problem" });
    let saving = false;
    const go = async () => {
      if (saving) return;
      saving = true;
      const problem = await save({ name: nameField.value, date: dateField.value, event: groupField ? groupField.value : null });
      saving = false;
      if (problem) said.textContent = problem;
      else finish(true);
    };
    nameField.addEventListener("keydown", (key) => { if (key.key === "Enter") go(); });
    close = showSheet(h("div.alert",
      h("div.alert-title", title),
      message && h("div.alert-message", message),
      h("label.sheet-field", h("span", "Name"), nameField),
      h("label.sheet-field", h("span", "Date"), dateField),
      groupField && h("label.sheet-field", h("span", "Group"), groupField),
      said,
      h("div.alert-buttons", secondary("Cancel", () => finish(false)), primary(button, go, { "data-default": true, probe: "race save" })),
    ), { onEscape: () => finish(false), small: true });
  });
}

/** Asks for a race's name and the day it was flown, and makes it. The season's group makes its next
 *  track instead: its tracks, their names and their dates come from the season. */
export async function newRace(event) {
  const group = app.state.events.find((one) => one.folder === event);
  if (group?.isSeason) return newTrack(event);
  let made = null;
  const done = await raceSheet({
    title: "New race",
    message: `A race in ${group?.name || "your library"}. Its recordings, laps and videos are kept together, and its name goes on the timer beside the group's.`,
    date: today(),
    button: "Create",
    save: async ({ name, date }) => {
      const answer = await ask("newRace", event, name, date);
      if (answer.problem) return answer.problem;
      made = take(answer);
      return null;
    },
  });
  if (done && made?.track) go({ name: "track", track: made.track });
  else render();
}

/** Gives a race another name, date or group, everything in it going with it. */
export async function editRace(track) {
  if (busy() || app.editor) return;
  const groups = app.state.events.filter((one) => !one.isSeason);
  let moved = null;
  const done = await raceSheet({
    title: "Rename or move this race",
    message: "Its recordings, markers, music and videos go with it.",
    name: trackName(track),
    date: app.tracks.get(track)?.state.date ?? "",
    group: track.includes("/") ? track.slice(0, track.indexOf("/")) : "",
    groups,
    button: "Save",
    save: async (change) => {
      const answer = await ask("moveRace", track, change);
      if (answer.problem) return answer.problem;
      moved = take(answer);
      return null;
    },
  });
  if (!done || !moved?.track) return;
  if (moved.track === track) {
    await loadTrack(track);
    render();
    return;
  }
  app.tracks.delete(track);
  app.forms.delete(track);
  go({ name: "track", track: moved.track });
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

/** Adds recordings picked from a card. */
export async function addFromCard(track, paths) {
  if (paths.length > 0) added(await ask("addClips", track, paths), track);
  loadCards(track, true);
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
