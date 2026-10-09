// What the pages share: what the app knows at the moment, the way to ask the main process for
// things, and the moves from one page to another.

export const hangar = window.hangar;

let asking = 0;
/** Asks the main process for something by name (see main/api.js). */
export async function ask(what, ...details) {
  asking += 1;
  try {
    return await hangar.ask(what, ...details);
  } finally {
    asking -= 1;
  }
}

/** Comes back once nothing has been waiting on the main process for a moment. The mode that draws
 *  pages into pictures uses it to know a page has everything it asked for. */
export async function whenQuiet() {
  const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
  for (let quiet = 0, tries = 0; quiet < 3 && tries < 400; tries += 1) {
    await pause(60);
    quiet = asking === 0 ? quiet + 1 : 0;
  }
}

export const app = {
  /** What the main process last said about the library: events, tracks, the pilot, the job. */
  state: null,
  /** The page that is showing: { name: "home" | "track" | "tracks" | "leaderboard" | "settings" | "guide", track? }. */
  page: { name: "home" },
  /** Where Pilot & settings, How it works or the leaderboard was opened from. */
  cameFrom: { name: "home" },
  /** Each track's page as last read: its runs and its unmarked clips. */
  tracks: new Map(),
  /** Each track's entry form as last read: { form, problem, address }. */
  forms: new Map(),
  /** The last thing that happened, shown at the foot of the window until it is closed. */
  notice: null,
  /** Runs whose files are showing, as "track\nrun". */
  expanded: new Set(),
  /** What is typed into a page's text boxes, so drawing the page again doesn't lose it. */
  drafts: new Map(),
  /** True while recordings are being dragged over a track's page. */
  dropping: false,
  /** The marker editor, while a clip is open in it. */
  editor: null,
  /** The season's leaderboards as last read: { read, tabs, problem, me }. Null until they have been asked for. */
  boards: null,
  /** True once they have been asked for, and while they are being read. */
  boardsAsked: false,
  boardsReading: false,
};

/** Reads the season's leaderboards, again if told to, and draws the page when they arrive. */
export async function loadBoards(again = false) {
  if (app.boardsReading) return;
  app.boardsAsked = true;
  app.boardsReading = true;
  draw();
  try {
    app.boards = await ask("leaderboards", { again });
  } finally {
    app.boardsReading = false;
    draw();
  }
}

let draw = () => {};
/** The app's one drawing routine is set once, by app.js. */
export const setDraw = (routine) => { draw = routine; };
/** Draws the page again from what is known now. */
export const render = () => draw();

export const allTracks = () => (app.state?.events ?? []).flatMap((event) => event.tracks.map((track) => track.path));
export const trackName = (track) => track.split("/").pop();
export const eventFolder = (track) => (track.includes("/") ? track.slice(0, track.indexOf("/")) : "");
export const eventOf = (track) => app.state.events.find((event) => event.folder === eventFolder(track)) ?? null;
export const inVideoCreator = (page) => page.name === "track" || page.name === "tracks";
const samePage = (a, b) => a.name === b.name && a.track === b.track;

/** Takes what the main process answered: the library as it is now, and anything worth saying. */
export function take(answer) {
  if (!answer) return answer;
  if (answer.state) app.state = answer.state;
  if (answer.notice) app.notice = answer.notice;
  if (answer.problem && !answer.notice) app.notice = answer.problem;
  return answer;
}

export function say(notice) {
  app.notice = notice || null;
  render();
}

/** Reads a track's page again. */
export async function loadTrack(track) {
  const read = await ask("track", track);
  if (read) app.tracks.set(track, read);
  else app.tracks.delete(track);
  if (app.page.name === "track" && app.page.track === track) render();
  return read;
}

/** Reads a track's entry form, when it has one and it hasn't been read. */
export async function loadForm(track, again = false) {
  const data = app.tracks.get(track);
  const address = data?.state.formURL.trim() ?? "";
  if (address === "") {
    app.forms.delete(track);
    return;
  }
  const known = app.forms.get(track);
  if (!again && known && known.asked === address) return;
  app.forms.set(track, { asked: address, form: null, problem: null, address });
  const read = await ask("form", track);
  app.forms.set(track, { asked: address, ...read });
  // A short link is followed to the form's own address, which is the one kept.
  if (read.address && read.address !== address) {
    app.forms.set(track, { asked: read.address, ...read });
    await loadTrack(track);
    app.drafts.delete(`form ${track}`);
  }
  if (app.page.name === "track" && app.page.track === track) render();
}

/** Goes to a page. */
export function go(page) {
  app.page = page;
  app.dropping = false;
  if (page.name === "track") {
    ask("remember", { lastTrack: page.track });
    if (app.state) app.state.lastTrack = page.track;
    loadTrack(page.track).then(() => loadForm(page.track));
  }
  render();
}

/** Goes to a page that has a way back, remembering where from. */
export function open(page) {
  if (app.page.name === "home" || inVideoCreator(app.page)) app.cameFrom = app.page;
  go(page);
}

/** Back from Pilot & settings, How it works or the leaderboard to where it was opened from. */
export function goBack() {
  if (app.cameFrom.name === "track" && !allTracks().includes(app.cameFrom.track)) app.cameFrom = { name: "home" };
  go(app.cameFrom);
}

export const backTitle = () => (inVideoCreator(app.cameFrom) ? "Video Creator" : "Hangar");

/** Opens the Video Creator where it was left: on the track last looked at, or else its first. */
export function openVideoCreator() {
  const tracks = allTracks();
  const last = app.state.lastTrack;
  go(last && tracks.includes(last) ? { name: "track", track: last } : tracks.length > 0 ? { name: "track", track: tracks[0] } : { name: "tracks" });
}

/** After the library has changed under a page: a track that has gone gives way to the first there
 *  is, and a Video Creator with nothing to show goes to a track that has arrived. */
export function settle() {
  const tracks = allTracks();
  const before = app.page;
  if (app.page.name === "track" && !tracks.includes(app.page.track)) app.page = tracks.length > 0 ? { name: "track", track: tracks[0] } : { name: "tracks" };
  if (app.page.name === "tracks" && tracks.length > 0) app.page = { name: "track", track: tracks[0] };
  for (const track of [...app.tracks.keys()]) if (!tracks.includes(track)) app.tracks.delete(track);
  if (!samePage(before, app.page) && app.page.name === "track") loadTrack(app.page.track).then(() => loadForm(app.page.track));
}

let refreshed = 0;
/** Looks at the library again: another copy may have saved, or files may have been moved about. */
export async function refresh({ quietly = false } = {}) {
  // Coming back to the window can ask several times in a moment. Once is enough.
  if (quietly && performance.now() - refreshed < 1500) return;
  refreshed = performance.now();
  app.state = await ask("refresh");
  settle();
  if (app.page.name === "track") {
    await loadTrack(app.page.track);
    loadForm(app.page.track);
  }
  render();
}

/** The library as the main process has it now, without looking at the disk again. */
export async function update() {
  app.state = await ask("state");
  settle();
  if (app.page.name === "track") await loadTrack(app.page.track);
  render();
}
