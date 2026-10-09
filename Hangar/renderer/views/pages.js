// The pages with a way back: the leaderboard, Pilot & settings, and How it works.

import { app, ask, goBack, backTitle, render, eventFolder, trackName, loadBoards } from "../core.js";
import { h, icon, label, primary, secondary, plain, field, when, comingSoonBadge } from "../ui.js";
import { placeOf, ordinal, sheet as boardSheet } from "../../shared/leaderboard.js";
import { bin, fileBrowser, season, comingSoon, guide } from "../words.js";
import * as act from "../actions.js";
import { showNote, showSetUp } from "./notes.js";
import { lookFor, drawCornerTimer, picture, typefaceReady } from "../timer.js";
import { Race } from "../../shared/timing.js";

/** The way back from a page that was opened from somewhere: to the hangar, or to the Video Creator. */
const backLink = () => secondary(backTitle(), goBack, { icon: "chevronLeft", probe: "back", help: `Back to ${backTitle() === "Hangar" ? "all the tools" : "the Video Creator"}` });

const page = (...content) => h("div.scroll", { "data-scroll": "page" }, h("div.plain-page", ...content));

/** A time as a leaderboard gives it: seconds, to the thousandth. */
const boardTime = (seconds) => seconds.toFixed(3);

/** The readings whose lists have been brought to the pilot's own entry, so that is done once for each and not every time the page is drawn. */
const broughtToMine = new Set();

/** One track's entries, as the series' spreadsheet has them, with the pilot's own picked out. */
function trackBoard(tab, me, read) {
  const entries = tab.entries, mine = placeOf(entries, me), first = entries[0];
  // The list opens on the pilot's own entry, which may be a long way down it.
  if (mine > 6 && !broughtToMine.has(`${read} ${tab.number}`)) {
    broughtToMine.add(`${read} ${tab.number}`);
    requestAnimationFrame(() => {
      const list = document.querySelector(`[data-scroll="board ${tab.number}"]`), own = list?.querySelector(".board-entry.mine");
      if (own) list.scrollTop = own.offsetTop - list.offsetTop - list.clientHeight / 2 + own.offsetHeight / 2;
    });
  }
  const place = (index) => (/^\d+$/.test(entries[index].rank) ? Number(entries[index].rank) : index + 1);
  const unofficial = entries.some((entry) => !entry.official);
  return h("div.card.board",
    h("div.row.tight", label(`TRACK ${tab.number}`), h("span.faint.small", `${entries.length} entr${entries.length === 1 ? "y" : "ies"}${unofficial ? " · times are the pilots' own until the series has checked them" : ""}`)),
    entries.length === 0 && h("p.dim", "No entries yet."),
    mine >= 0 && h("p.board-mine", mine === 0
      ? `You are in front, with ${boardTime(entries[0].time)}.`
      : `You are ${ordinal(place(mine))} of ${entries.length} with ${boardTime(entries[mine].time)}, ${boardTime(entries[mine].time - first.time)} behind ${first.pilot}.`),
    entries.length > 0 && h("div.board-list", { "data-scroll": `board ${tab.number}` }, entries.map((entry, index) => h(`div.board-entry${index === mine ? ".mine" : ""}`,
      h("span.board-place", String(place(index))),
      h("span.board-pilot", entry.pilot),
      entry.id && h("span.board-id", `#${entry.id}`),
      h("span.spacer"),
      entry.video && plain("Watch", () => act.openLink(entry.video), { class: "quiet", help: `Opens ${entry.pilot}'s video in your browser.` }),
      h("span.board-time", boardTime(entry.time)),
    ))),
  );
}

/** A tab of the spreadsheet that isn't a track's, shown as the rows it is. */
function tableBoard(tab) {
  return h("div.card.board", label(tab.name.toUpperCase()),
    h("div.board-list", { "data-scroll": `board ${tab.name}` },
      h("div.board-entry.heads", tab.headers.map((head) => h("span.board-cell", head))),
      tab.rows.map((row) => h("div.board-entry", row.map((cell) => h("span.board-cell", cell)))),
    ),
  );
}

export function leaderboard() {
  const events = app.state.events;
  // The first time the page is shown, the leaderboards are asked for. They arrive after it is drawn.
  if (!app.boardsAsked) {
    app.boardsAsked = true;
    setTimeout(() => loadBoards(), 0);
  }
  const boards = app.boards, tabs = boards?.tabs ?? [];
  const soon = tabs.filter((tab) => tab.kind === "soon"), unread = tabs.filter((tab) => tab.kind === "unread");
  const names = (list) => list.map((tab) => tab.name).join(", ").replace(/, ([^,]*)$/, " and $1");
  return page(
    h("div", backLink()),
    h("h1.page-title", "LEADERBOARD"),
    h("div.row.board-head",
      h("div", label(`${season.toUpperCase()}, FROM THE SERIES`), h("div.faint.small", app.boardsReading ? "Reading the series' spreadsheet…" : boards?.read ? `Read ${when(boards.read).replace(/^[A-Z]/, (first) => first.toLowerCase())}` : "Not read yet")),
      h("span.spacer"),
      secondary("Refresh", () => loadBoards(true), { disabled: app.boardsReading, help: "Read the series' spreadsheet again." }),
      secondary("Open the spreadsheet", () => act.openLink(`${boardSheet}/htmlview`), { icon: "arrowUpRight", help: "The series' own leaderboard spreadsheet, in your browser." }),
    ),
    boards?.problem && h("p.board-problem", boards.problem),
    tabs.filter((tab) => tab.kind === "track").map((tab) => trackBoard(tab, boards.me, boards.read)),
    tabs.filter((tab) => tab.kind === "table").map(tableBoard),
    soon.length > 0 && h("div.card", label("SEASON STANDINGS"), h("p.dim", `${names(soon)} ${soon.length === 1 ? "is" : "are"} in the series' spreadsheet but not filled in yet. ${soon.length === 1 ? "It" : "They"} will show here once ${soon.length === 1 ? "it is" : "they are"}.`)),
    unread.length > 0 && h("p.dim.small", `${names(unread)} couldn't be read this time.`),
    h("div.card", label("YOUR TIMES"), events.map((event, index) => [
      // Each event's name, above the first of its tracks.
      event.tracks.length > 0 && h(`div.board-event${index === 0 ? ".first" : ""}`, event.name === "" ? "Tracks" : event.name),
      event.tracks.map((track) => h("div.board-row",
        h("span.board-track", track.name), h("span.spacer"),
        track.submitted && h("span.board-sent", `submitted ${track.submitted.time}`),
        h("span.board-best", track.best ?? "–"))),
    ])),
  );
}

// Pilot & settings.

/** What the timer preview is drawn from: the fastest run on the first track that has one lends it
 *  its laps and a frame. With no run to borrow from, made-up laps on the first track there is. */
function previewSource() {
  if (app.state.preview) return app.state.preview;
  const first = app.state.events.flatMap((event) => event.tracks)[0]?.path;
  const event = app.state.events[0];
  return { track: first ?? `${event && event.folder !== "" ? `${event.folder}/` : ""}Track 1`, crossings: [0, 12.345, 24.221, 36.233], clip: null, moment: 1, run: "" };
}

let previewAsked = 0;

/** Draws the timer on the preview as the 16:9 video will have it once the last lap is done. */
async function drawPreview(canvas) {
  const asked = ++previewAsked;
  const source = previewSource();
  const look = lookFor(source.track);
  const [logo] = await Promise.all([picture(look.logoAddress), typefaceReady()]);
  if (asked !== previewAsked || !canvas.isConnected) return;
  drawCornerTimer(canvas, { race: Race.from(source.crossings), look, logo, seconds: source.crossings.at(-1) + 1 });
}

const footage = { clip: null, address: null };

function timerPreview() {
  const source = previewSource();
  const canvas = h("canvas.preview-timer", { width: 1280, height: 720 });
  const still = h("img.preview-footage", { alt: "" });
  const frame = h("div.preview", { help: "Click a corner to put the timer there." },
    h("div.preview-empty", label("YOUR VIDEO")), still, canvas,
    // Clicking a corner of the picture moves the timer there.
    h("div.preview-corners", ["tl", "tr", "bl", "br"].map((corner) => h("button", { type: "button", "aria-label": corner, onclick: () => setCorner(corner) }))),
  );
  // A frame of the pilot's own footage to show the timer over, when there is a run to take it from.
  if (source.clip && footage.clip === source.clip && footage.address) {
    still.src = footage.address;
  } else if (source.clip) {
    ask("frameOf", source.clip, source.moment).then((address) => {
      footage.clip = source.clip;
      footage.address = address;
      if (address && still.isConnected) still.src = address;
    });
  }
  drawPreview(canvas);
  return h("div.preview-holder", frame,
    h("p.dim.small", `How the timer sits on a 16:9 video, ${source.run === "" ? "with made-up laps" : `with the laps from ${source.run}`}. On a 9:16 video it goes under the picture instead, so the corner doesn't apply there.`));
}

/** The colours offered for the timer's highlights. The first is the one it starts out with. */
const timerColours = [["#FFD60A", "Yellow"], ["#FF9F0A", "Orange"], ["#FF453A", "Red"], ["#FF375F", "Pink"], ["#BF5AF2", "Purple"], ["#0A84FF", "Blue"], ["#64D2FF", "Sky"], ["#30D158", "Green"], ["#FFFFFF", "White"]];
const accentNow = () => (app.state.settings.accent || timerColours[0][0]).toUpperCase();

/** Sets the colour of the timer's highlights. While a colour is being chosen only the preview is drawn again. */
async function setAccent(colour, settled) {
  app.state.settings.accent = colour;
  await act.setSettings({ accent: colour });
  if (settled) render();
  else previewSoon();
}

async function setCorner(corner) {
  await act.setSettings({ corner });
  render();
}

let drawSoon = null;
/** Waits for typing to pause before drawing the timer again. */
function previewSoon() {
  clearTimeout(drawSoon);
  drawSoon = setTimeout(() => {
    const canvas = document.querySelector("canvas.preview-timer");
    if (canvas) drawPreview(canvas);
  }, 120);
}

/** One event's details: the name its timers show and the pilot's ID for it. */
function eventFields(event) {
  const loose = event.folder === "";
  const set = (part) => async (value) => {
    event[part] = value;
    await act.setDetails(event.folder, { name: event.name, id: event.id, idLabel: event.idLabel });
    previewSoon();
  };
  const count = event.tracks.length;
  const logo = loose ? null : h("div.row.logo-row", event.logo ? [
    h("span.logo-holder", h("img", { src: event.logo, alt: "" })),
    h("p.dim.small.grow", "This logo goes on this event's videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16."),
    secondary("Change…", () => act.chooseLogo(event.folder)),
    secondary("", () => act.removeLogo(event.folder), { icon: "trash", help: `Move the logo to ${bin}. The videos go back to having none.`, "aria-label": "Remove the logo" }),
  ] : [
    label("LOGO"),
    h("p.dim.small.grow", "None. Choose a picture, such as the series' own logo, and it goes on this event's videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16."),
    secondary("Choose a picture…", () => act.chooseLogo(event.folder)),
  ]);
  // A clip or a picture before and after every video of the event: a title card, say, or a sign-off.
  // Each shape of video has its own pair, so one made for 16:9 isn't left small in a 9:16 video.
  const ends = loose ? null : h("div.bookends",
    label("BEFORE AND AFTER"),
    h("p.dim.small", "A short clip or a picture put before or after every video you make in this event, such as a title card or a sign-off. Each shape of video has its own, so make one to fit each. It is fitted into the frame, on black where it doesn't fill it. A clip keeps its own sound."),
    [["landscape", "16:9 videos"], ["upright", "9:16 videos"]].map(([shape, title]) => [
      h("div.row.tight.bookend-shape", icon(shape === "landscape" ? "landscape" : "portrait", 13), title),
      ["before", "after"].map((which) => {
        const end = event.bookends?.[shape]?.[which] ?? null, of = `${which} ${shape === "landscape" ? "16:9" : "9:16"} videos`;
        return h("div.row.bookend",
          h("span.timer-word", which === "before" ? "Before" : "After"),
          end ? [
            // A picture is shown as the video will have it: on black.
            h("span.bookend-thumb", end.kind === "picture" ? h("img", { src: end.picture, alt: "" }) : icon("film", 14)), h("span.bookend-name", end.name),
            end.kind === "picture" && [h("input.field.bookend-seconds", { type: "text", inputMode: "decimal", key: `bookend ${shape} ${which} ${event.folder}`, value: String(end.seconds), "aria-label": "Seconds on screen", onchange: (change) => act.setBookendSeconds(event.folder, shape, which, change.target.value).then(render) }), h("span.dim.small", "seconds")],
            h("span.spacer"),
            secondary("Change…", () => act.chooseBookend(event.folder, shape, which)),
            secondary("", () => act.removeBookend(event.folder, shape, which), { icon: "trash", help: `Move it to ${bin}. Nothing then goes ${of}.`, "aria-label": `Remove what goes ${of}` }),
          ] : [h("span.dim.small", "Nothing"), h("span.spacer"), secondary("Choose a clip or picture…", () => act.chooseBookend(event.folder, shape, which), { "aria-label": `Choose what goes ${of}` })],
        );
      }),
    ]),
  );
  return h("div.event-fields",
    h("div.row.event-head",
      h("span.event-name", loose ? (event.name === "" ? "Tracks" : event.name) : event.folder),
      h("span.faint.small", count === 0 ? "no tracks yet" : `${count} track${count === 1 ? "" : "s"}`),
      h("span.spacer"),
      loose && secondary("Give it its own folder", act.gatherLooseTracks, { help: "These tracks sit loose in your library, from before there were events. This moves them into a folder named after the event, like any other. If their clips are in a Premiere project, Premiere will ask where they went." }),
      !loose && secondary("", () => act.removeEvent(event.folder), {
        icon: "trash", disabled: Boolean(app.state.job) || count > 0, "aria-label": `Move this event to ${bin}`,
        help: count === 0 ? `Move this event to ${bin}.` : "An event can only be deleted once its tracks are. Delete those first.",
      }),
    ),
    h("div.row.fields",
      field("Name on the timer", event.name, set("name"), { width: 260, key: `event name ${event.folder}` }),
      field("Your ID number", event.id, set("id"), { width: 150, key: `event id ${event.folder}` }),
      field("Shown before the ID", event.idLabel, set("idLabel"), { width: 200, key: `event label ${event.folder}` }),
    ),
    logo,
    ends,
  );
}

function versionCard() {
  const state = app.state;
  const update = state.update;
  const status = {
    checking: () => h("span.dim", "Checking…"),
    current: () => h("span.good.row.tight", icon("checkCircle"), "This is the newest version"),
    available: () => h("span.accent", `v${update.version} is ready to install`),
    installing: () => h("span.accent", `Installing v${update.version}${update.share > 0 && update.share < 1 ? `, ${Math.round(update.share * 100)}% downloaded` : ""}. The app will reopen.`),
    failed: () => h("span.warn", update.problem),
  }[update.kind]?.() ?? null;
  const updating = update.kind === "checking" || update.kind === "installing";
  return h("div.card",
    label("VERSION"),
    h("div.row.baseline", h("span.version-name", `FPV Hangar v${state.version}`), status && h("span.small.semibold", status)),
    update.kind === "available" && update.notes && h("p.dim.small", update.notes),
    state.testCopy
      ? [
        h("p.dim.small", "This is a test copy, for trying changes before they are released. It doesn't check for updates or replace itself: the released app gets them the usual way."),
        h("div.row", secondary("Show what went wrong", () => ask("showLog"), { help: "The app writes down anything that goes wrong. This shows that file, to send to whoever is fixing it." })),
      ]
      : h("div.row",
        update.kind === "available" && primary(`Update to v${update.version}`, () => act.installUpdate()),
        secondary("Check for updates", () => act.checkForUpdates(), { disabled: updating }),
        h("label.check", h("input", { type: "checkbox", checked: state.automaticUpdates, onchange: (event) => ask("remember", { noAutomaticUpdates: !event.target.checked }) }), "Check when the app opens"),
      ),
  );
}

export function settings() {
  const state = app.state;
  const corners = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];
  return page(
    h("div", backLink()),
    h("h1.page-title", "PILOT & SETTINGS"),
    h("div.card.spaced",
      label("PILOT"),
      h("div.row.fields",
        field("Pilot name", state.settings.pilot, async (value) => {
          state.settings.pilot = value;
          await act.setSettings({ pilot: value });
          previewSoon();
        }, { key: "pilot", class: "grow" }),
        field("Email for submission forms", state.email, (value) => {
          state.email = value;
          ask("setEmail", value);
        }, { key: "email", class: "grow" }),
      ),
      h("div.row",
        h("p.dim.small.grow", "Your name goes on every timer and finished video, and into the entry forms."),
        secondary("Ask me the setup questions", () => showSetUp(), { help: `Your pilot name, and whether you fly ${season}. If you do, your registration number is looked up on the series' pilot list.` }),
      ),
    ),
    h("div.card.spaced",
      label("EVENTS"),
      state.events.map(eventFields),
      h("p.dim.small", "An event is a race or a series: a folder in your library with its tracks inside. Its name goes on the timer of every track in it, next to the track's name, and your ID for it goes beside your name and into its entry forms. New event in the Video Creator makes another."),
    ),
    h("div.card",
      label("THE TIMER ON YOUR VIDEOS"),
      h("div.row.tight.timer-row", h("span.timer-word", "Corner"), corners.map(([corner, title]) => (state.settings.corner === corner ? primary(title, () => {}) : secondary(title, () => setCorner(corner))))),
      h("div.row.tight.timer-row", h("span.timer-word", "Colour"),
        timerColours.map(([colour, name]) => h(`button.swatch${accentNow() === colour ? ".on" : ""}`, { type: "button", style: { background: colour }, help: name, "aria-label": name, onclick: () => setAccent(colour, true) })),
        // Any other colour, from the computer's own colour chooser.
        h("label.swatch.custom", { help: "Choose any colour", class: timerColours.some(([colour]) => colour === accentNow()) ? "" : "on" },
          h("input", { type: "color", value: accentNow(), oninput: (event) => setAccent(event.target.value.toUpperCase(), false), onchange: (event) => setAccent(event.target.value.toUpperCase(), true) }), icon("plus", 12)),
      ),
      timerPreview(),
      h("p.dim.small", "The colour is for the timer's highlights on your videos: the lap bars, the labels, your ID, and the fill when your time is set. The app itself stays yellow."),
    ),
    h("div.card",
      label("LIBRARY"),
      h("div.path.dim", state.library),
      h("p.dim.small", state.libraryIsFixed ? "This copy of the app was started on this folder, and keeps its tracks in it." : "Your tracks, markers, music and finished videos are kept here."),
      h("div.row.tight",
        secondary(`Show in ${fileBrowser}`, () => act.openFolder(state.library)),
        !state.libraryIsFixed && secondary("Use another folder…", act.chooseLibrary, { disabled: Boolean(state.job), help: "Keep your tracks somewhere else. Nothing is moved for you." }),
      ),
    ),
    versionCard(),
  );
}

// How it works.

export function guidePage() {
  return page(
    h("div", backLink()),
    h("div.row.baseline.guide-head",
      h("h1.page-title", "HOW IT WORKS"), h("span.spacer"),
      secondary("What's new", () => showNote({ kind: "whatsNew", since: null }), { help: "What changed in each version." }),
      secondary("Welcome note", () => showNote({ kind: "welcome" }), { help: "The note that opens the first time the app is run." }),
    ),
    h("p.dim.guide-summary", "The Video Creator, from a raw clip to a submitted time."),
    guide.steps.map(([title, text], index) => h("div.card.snug.guide-step", h("span.guide-number", index + 1), h("div", h("div.guide-title", title), h("p.dim", text)))),
    h("div.card.guide-notes", label("GOOD TO KNOW"), guide.notes.map((note) => h("div.point", h("span.dot"), h("div.point-text.dim", note)))),
    h("div.card",
      h("div.row.tight", label("NOT BUILT YET"), comingSoonBadge()),
      Object.values(comingSoon).map((item) => h("div.soon-item", icon(item.icon, 14, { class: "accent" }), h("div", h("div.soon-title", item.title), h("p.dim", item.detail)))),
    ),
  );
}

export { eventFolder, trackName };
