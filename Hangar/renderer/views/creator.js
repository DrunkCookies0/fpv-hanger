// The Video Creator: its sidebar of events and tracks, and a track's page with its runs, its clips
// and its entry form.

import { app, go, open, refresh, render, eventFolder, eventOf, trackName, loadForm } from "../core.js";
import { h, icon, label, primary, secondary, plain, comingSoonBadge, testCopyBadge, when } from "../ui.js";
import { menu } from "../sheets.js";
import { bin, Bin, fileBrowser, season, comingSoon } from "../words.js";
import * as act from "../actions.js";
import { updatePill } from "./home.js";
import { showSetUp } from "./notes.js";

const busy = () => Boolean(app.state.job);

function sidebarRow(title, detail, selected, action, props = {}) {
  return h(`button.side-row${selected ? ".selected" : ""}`, { type: "button", onclick: action, ...props },
    h("span.side-mark"), h("span.side-title", title), h("span.spacer"), detail && h("span.side-detail", detail));
}

function sidebar() {
  const state = app.state;
  const current = app.page.name === "track" ? eventFolder(app.page.track) : state.events[0]?.folder ?? "";
  const event = state.events.find((one) => one.folder === current);
  const list = state.events.map((one, index) => {
    const title = one.name === "" ? "Tracks" : one.name;
    const rows = [
      h(`div.side-event${index === 0 ? ".first" : ""}`, {
        oncontextmenu: (click) => {
          click.preventDefault();
          menu(click, [
            { title: "New track", action: () => act.newTrack(one.folder) },
            // Only an event with a folder of its own can go, and only once its tracks have.
            ...(one.folder === "" ? [] : [{ title: one.tracks.length === 0 ? `Move this event to ${bin}` : "Delete its tracks first to delete this event", disabled: one.tracks.length > 0, action: () => act.removeEvent(one.folder) }]),
          ]);
        },
      }, title.toUpperCase()),
      one.tracks.map((track) => sidebarRow(track.name, track.best, app.page.name === "track" && app.page.track === track.path, () => go({ name: "track", track: track.path }), {
        oncontextmenu: (click) => {
          click.preventDefault();
          menu(click, [{ title: `Move ${track.name} to ${bin}`, action: () => act.removeTrack(track.path) }]);
        },
      })),
    ];
    if (one.next) {
      // The season's next track: it becomes a track of its own on the day it opens.
      const opens = new Date(one.next.release), closes = new Date(one.next.deadline);
      const full = { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
      rows.push(h("div.side-row.next", {
        help: `Track ${one.next.number} opens on ${opens.toLocaleString(undefined, full)} and its entries close on ${closes.toLocaleString(undefined, full)}. It will appear here by itself.`,
      }, h("span.side-mark"), h("span.side-title", `Track ${one.next.number}`), h("span.spacer"),
        h("span.side-opens", `OPENS ${opens.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}`)));
    } else if (!one.hasSeason) {
      rows.push(h("button.side-add", { type: "button", onclick: () => act.newTrack(one.folder) }, icon("plus"), "New track"));
    }
    return rows;
  });
  return h("aside.sidebar",
    h("div.side-head",
      secondary("Hangar", () => go({ name: "home" }), { icon: "chevronLeft", help: "Back to all the tools", probe: "tool hangar" }),
      h("div", h("div.side-wordmark", h("span", "VIDEO"), h("span.accent", "CREATOR")), label("RACEGOW")),
    ),
    // Events and their tracks can outgrow the window, so this part scrolls.
    h("div.side-list", { "data-scroll": "side" },
      list,
      h("button.side-add.event", { type: "button", help: "Another race or series, with its own tracks, its own name on the timer and its own ID.", onclick: act.newEvent }, icon("folderPlus"), "New event"),
    ),
    sidebarRow("Pilot & settings", null, false, () => open({ name: "settings" }), { probe: "tool settings" }),
    sidebarRow("How it works", null, false, () => open({ name: "guide" }), { probe: "tool guide" }),
    h("div.side-foot",
      updatePill(),
      state.settings.pilot === ""
        ? h("button.side-pilot.add", { type: "button", onclick: () => open({ name: "settings" }) }, "Add your pilot name")
        : h("div.side-pilot", state.settings.pilot),
      // The ID is the event's: the one for the track that is showing.
      event && event.id !== "" && h("div.side-id", `${event.idLabel} ${event.id}`.toUpperCase()),
      h("div.side-version", `FPV Hangar v${state.version}`),
      state.testCopy && testCopyBadge(),
    ),
  );
}

/** The Video Creator before it has a track: with no event yet, or an event with nothing in it. */
function noTracks() {
  const events = app.state.events;
  return h("div.scroll", { "data-scroll": "page" }, h("div.track-page",
    h("h1.page-title", "VIDEO CREATOR"),
    h("div.card.roomy", events.length === 0 ? [
      h("div.card-title", "No events yet"),
      h("p.dim", "An event is a race, a series, or just somewhere you fly. It has its own tracks, and its name goes on the timer of every video you make in it."),
      h("div.row", primary("New event", act.newEvent, { probe: "new event" }),
        secondary(`I fly ${season}`, () => showSetUp(), { help: `Answer the setup questions: the app makes the ${season} event and looks up your registration number.` })),
    ] : [
      h("div.card-title", "No tracks yet"),
      h("p.dim", "A track is one course you fly in an event. Make one, add your recordings to it, and mark the laps on them."),
      h("div.row", primary("New track", () => act.newTrack(events[0]?.folder ?? ""), { probe: "new track" })),
    ]),
  ));
}

function deadlinePill(deadline) {
  const left = (new Date(deadline) - Date.now()) / 1000;
  let text = "SUBMISSIONS CLOSED";
  if (left > 0) {
    const days = Math.floor(left / 86400), hours = Math.floor((left % 86400) / 3600), minutes = Math.floor((left % 3600) / 60);
    text = days > 0 ? `${days}D ${hours}H LEFT TO SUBMIT` : `${hours}H ${minutes}M LEFT TO SUBMIT`;
  }
  return h(`span.pill.deadline${left < 86400 ? ".soon" : ""}`, { help: new Date(deadline).toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) }, text);
}

/** What the series' schedule says about one of the season's tracks. */
function seasonLine(one) {
  const zone = "America/Los_Angeles";
  const parts = [];
  if (one.sponsor) parts.push(`Sponsored by ${one.sponsor}`);
  if (one.designer) parts.push(`designed by ${one.designer}`);
  // The deadline the way the series writes it, on the Pacific coast, and in the pilot's own time when that differs.
  const deadline = new Date(one.deadline);
  const there = { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
  let closes = `entries close ${deadline.toLocaleString(undefined, { ...there, timeZone: zone })} Pacific`;
  if (deadline.toLocaleString("en-US", { timeZone: zone }) !== deadline.toLocaleString("en-US")) {
    closes += ` (${deadline.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} your time)`;
  }
  parts.push(closes);
  if (one.livestream) parts.push(`results stream ${new Date(one.livestream).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: zone })}`);
  return h("div.season-line", { help: "From the series' schedule on racegow.com." }, parts.join("  ·  "));
}

function statCard(title, value, detail, highlight = false) {
  return h(`div.card.stat${highlight ? ".highlight" : ""}`, label(title), h("div.stat-value", value), h("div.stat-detail", detail));
}

function formCard(track, data) {
  const saved = data.state.formURL;
  const key = `form ${track}`;
  const typed = app.drafts.get(key) ?? saved;
  const known = app.forms.get(track);
  const save = () => act.useForm(track, app.drafts.get(key) ?? saved);
  const use = secondary("Use this form", save, { disabled: typed === saved });
  let status = null;
  if (known?.form) {
    status = h("div.form-status.good", icon("checkCircle"), `${known.form.title}: ${known.form.questions.length} questions`);
  } else if (known?.problem) {
    status = h("div.form-status.warn", icon("warning"), known.problem);
  } else if (saved === "") {
    status = h("p.dim.small", data.season === null ? "Each track has its own form. Paste the link once and Submit fills it in for you."
      : "Each track has its own form. The series posts it on racegow.com when the track opens, and it is filled in here by itself. If it hasn't been yet, paste the link.");
  }
  return h("div.card",
    label("SUBMISSION FORM"),
    h("div.row.form-row",
      h("input.field.grow", {
        type: "text", key, value: typed, spellcheck: false, placeholder: "Paste this track's Google Form link",
        oninput: (event) => {
          app.drafts.set(key, event.target.value);
          use.disabled = event.target.value === saved;
        },
        onkeydown: (event) => { if (event.key === "Enter") save(); },
      }),
      use,
    ),
    status,
  );
}

/** Makes a file, or offers the ones already made. */
function fileButton(track, run, shape, title, files) {
  const make = () => act.makeVideo(track, run, shape);
  const off = busy() || !run.clip;
  if (files.length === 0) return secondary(`Make ${title}`, make, { disabled: off });
  const newest = files.at(-1);
  return h(`button.button.secondary.made${files.length === 1 ? ".one" : ".several"}`, {
    type: "button", disabled: off,
    onclick: (event) => menu(event.currentTarget, [
      { title: app.state.vlc ? "Open the newest in VLC" : "Open the newest", action: () => act.play(newest) },
      { title: `Show in ${fileBrowser}`, action: () => act.reveal(newest) },
      { title: files.length === 1 ? "Make a new version" : "Make another version", action: make },
    ]),
  }, icon(files.length === 1 ? "check" : "copies"), files.length === 1 ? title : `${title} ×${files.length}`, icon("chevronDown", 10));
}

const fileIcons = { "16:9 video": "landscape", "9:16 video": "portrait", "Race clip": "film", Music: "music" };
const outputTitles = { landscape: "16:9 video", upright: "9:16 video" };

/** The files behind a run, each with a way to play it. Finished videos can be thinned down to the right one. */
function runFiles(track, run) {
  const files = run.files;
  // Videos that exist in more than one version.
  const crowded = ["landscape", "upright"].filter((output) => files.filter((file) => file.output === output).length > 1);
  return h("div.run-files",
    crowded.length > 0 && h("div.crowded", icon("copies"), `More than one version of the ${crowded.map((output) => outputTitles[output]).join(" and the ")}. Open each, then keep the right one.`),
    files.map((file) => {
      const versions = files.filter((one) => one.output && one.output === file.output);
      return h("div.file",
        icon(fileIcons[file.kind] ?? "film", 14, { class: "file-icon" }),
        h("div.file-words", h("div.file-name", file.name), h("div.file-detail", `${file.kind} · ${file.size} · ${when(file.modified)}`)),
        h("span.spacer"),
        versions.length > 1 && secondary("Keep only this one", () => act.trashFiles(versions.filter((one) => one.path !== file.path), track),
          { help: `Moves the other version${versions.length > 2 ? "s" : ""} of the ${outputTitles[file.output]} to ${bin}.` }),
        secondary(app.state.vlc ? "Open in VLC" : "Open", () => act.play(file.path)),
        secondary(`Show in ${fileBrowser}`, () => act.reveal(file.path)),
        file.output && secondary("", () => act.trashFiles([file], track), { icon: "trash", help: `Move to ${bin}`, "aria-label": `Move ${file.name} to ${bin}` }),
      );
    }),
    files.length === 0 && h("p.dim.small", "No files for this run yet."),
    h("div.file.soon", { help: comingSoon.upload.detail }, icon(comingSoon.upload.icon, 14, { class: "file-icon" }), h("div.file-name", comingSoon.upload.title), comingSoonBadge(), h("span.spacer")),
  );
}

function runCard(track, data, run, rank) {
  const window = data.summary.window;
  const id = `${track}\n${run.name}`;
  const isOpen = app.expanded.has(id);
  const submitted = data.state.submissions.findLast((one) => one.run === run.name) ?? null;
  // Room for eight laps; with more, show the stretch around the best ones.
  const first = Math.max(0, Math.min((run.best?.firstLap ?? 1) - 3, run.laps.length - 8));
  const laps = run.laps.slice(first, first + 8).map((lap, offset) => {
    const number = first + offset + 1;
    const inBest = run.best ? number >= run.best.firstLap && number <= run.best.lastLap : false;
    return h(`span.lap${inBest ? ".best" : ""}`, lap);
  });
  const notes = [
    run.song && h("span.run-note.accent", { help: "The finished videos use this as their sound, placed where you put it in Markers & music." }, icon("music"), run.song),
    run.coarseStep > 0 && h("span.run-note.warn", { help: `Every marker sits on a ${run.coarseStep}-frame step, so these times are approximate. Open Markers & music and move each one onto the exact frame of its gate crossing.` }, icon("warning"), "markers not on exact frames"),
    submitted && h("span.run-note.good", icon("seal"), `submitted ${submitted.time}`),
  ].filter(Boolean);
  const toggle = () => {
    if (isOpen) app.expanded.delete(id);
    else app.expanded.add(id);
    render();
  };
  return h("div.card.run",
    h("div.run-row",
      // Clicking anywhere on the run itself shows or hides its files.
      h("div.run-main", { onclick: toggle, help: isOpen ? "Hide this run's files" : "Show this run's files", role: "button", tabIndex: 0, onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } } },
        h(`span.rank${rank === 1 ? ".first" : ""}`, rank ?? "–"),
        h("div.run-body",
          h("div.run-head", h("span.run-name", run.name), icon("chevronRight", 11, { class: `run-chevron${isOpen ? " open" : ""}` }), h("span.run-facts", `${run.width}×${run.height} · ${run.fps} fps`)),
          h("div.laps", first > 0 && h("span.more", `+${first}`), laps, run.laps.length > first + 8 && h("span.more", `+${run.laps.length - first - 8}`)),
          notes.length > 0 && h("div.run-notes", notes),
        ),
        h("span.spacer"),
        h("div.run-time", h(`div.run-best${rank === 1 ? ".first" : ""}`, run.best?.seconds ?? "–"), h("div.run-caption", run.best ? `best ${window} in a row` : `needs ${window} laps`)),
      ),
      h("div.run-buttons",
        secondary("Markers & music", () => act.editRun(run, track), { disabled: busy() || !run.clip, help: run.clip ? "Move the lap markers, choose the stretch the videos show, and place a song." : "There's no race clip with this run's name to open." }),
        h("div.row.tight", { help: run.clip ? "A finished video with the timer drawn in, ready to upload." : "There's no race clip with this run's name to make a video from." },
          fileButton(track, run, "landscape", "16:9 video", run.landscapes), fileButton(track, run, "upright", "9:16 video", run.uprights)),
        primary("Submit this run", () => act.submitRun(track, run), { disabled: busy() || !run.best }),
      ),
    ),
    isOpen && runFiles(track, run),
  );
}

function runs(track, data) {
  const list = data.summary.runs;
  if (list.length === 0) {
    return h("div.card.roomy",
      h("div.card-title", "No runs yet"),
      h("p.dim", data.hasClips
        ? "Press Mark laps on a clip below, step to each start/finish gate crossing and press M. Press Done, and the run shows up here, ranked."
        : "Add your recordings: press Add clips, or drop them onto this page. Each one then gets a Mark laps button."),
      !data.hasClips && h("div.row", primary("Add clips…", () => act.chooseClips(track), { disabled: busy() })),
    );
  }
  return h("div.group", label("RUNS, FASTEST FIRST"), list.map((run, index) => runCard(track, data, run, run.best ? index + 1 : null)));
}

/** Clips in Raw files that have no timed run yet. */
function clips(track, data) {
  if (data.unmarked.length === 0) return null;
  return h("div.group", label("CLIPS NOT MARKED YET"), h("div.card.snug", data.unmarked.map((file) => h("div.file",
    icon("film", 14, { class: "file-icon" }),
    h("div.file-words", h("div.file-name", file.name), h("div.file-detail", `${file.kind} · ${file.size} · ${when(file.modified)}`)),
    h("span.spacer"),
    secondary(app.state.vlc ? "Open in VLC" : "Open", () => act.play(file.path)),
    secondary("Mark laps", () => act.markClip(file.path, track), { help: "Step through this clip and mark each start/finish gate crossing." }),
    // A clip added by mistake, or not worth marking, can go from here.
    secondary("", () => act.trashFiles([file], track), { icon: "trash", help: `Move this clip to ${bin}. It asks first.`, "aria-label": `Move ${file.name} to ${bin}` }),
  ))));
}

function trackPage(track) {
  const data = app.tracks.get(track);
  const event = eventOf(track);
  const name = trackName(track);
  if (!data) {
    return h("div.scroll", { "data-scroll": "page" }, h("div.track-page", h("div.track-head", h("div", event?.name && label(event.name.toUpperCase()), h("h1.page-title", name.toUpperCase())))));
  }
  const form = app.forms.get(track)?.form ?? null;
  const deadline = form?.deadline ?? data.season?.deadline ?? null;
  const summary = data.summary;
  const sent = data.state.submissions.at(-1) ?? null;
  const bestLap = summary.runs.map((run) => run.bestLap).sort((a, b) => Number(a) - Number(b))[0] ?? "–";
  const head = h("div.track-head",
    h("div", event?.name && label(event.name.toUpperCase()), h("h1.page-title", name.toUpperCase())),
    deadline && deadlinePill(deadline),
    h("span.spacer"),
    secondary(data.hasView ? "Track in 3D" : "Build the track in 3D", () => act.openTrackView(track), { icon: "cube", help: data.hasView ? "The track drawn in 3D, with the lap flown round it. Drag it to look from any side." : "Build this track in 3D: click its sections into place, then draw the line the lap is flown along." }),
    secondary("Add clips…", () => act.chooseClips(track), { disabled: busy(), help: "Copy recordings into this track. You can also drop them onto this page." }),
    secondary("Refresh", () => refresh()),
    secondary("Open folder", () => act.openFolder(data.folder)),
    secondary("", () => act.removeTrack(track), { icon: "trash", disabled: busy(), "aria-label": `Move this track to ${bin}`, help: `Move this track to ${bin}. If there is anything in it, you are asked to type I UNDERSTAND first.` }),
  );
  const page = h("div.track-page",
    h("div.track-top", head, data.season && seasonLine(data.season)),
    h("div.stats",
      statCard(`BEST ${summary.window} LAPS IN A ROW`, summary.best?.best?.seconds ?? "–", summary.best ? `${summary.best.name}, laps ${summary.best.best.firstLap}–${summary.best.best.lastLap}` : "No timed runs yet", true),
      statCard("BEST LAP", bestLap, `${summary.runs.length} run${summary.runs.length === 1 ? "" : "s"} marked`),
      statCard("SUBMITTED", sent?.time ?? "–", sent ? `${sent.run}, ${new Date(sent.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Nothing sent yet"),
    ),
    formCard(track, data),
    runs(track, data),
    clips(track, data),
    summary.skipped.length > 0 && h("div.group.tight", label("LEFT OUT"), summary.skipped.map((item) => h("div.dim.small", `${item.file}: ${item.reason}`))),
  );
  // Recordings dropped anywhere on the page are added to the track.
  const holder = h("div.droppable", {
    ondragover: (event) => {
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!app.dropping) {
        app.dropping = true;
        holder.classList.add("dropping");
      }
    },
    ondragleave: (event) => {
      if (holder.contains(event.relatedTarget)) return;
      app.dropping = false;
      holder.classList.remove("dropping");
    },
    ondrop: (event) => {
      event.preventDefault();
      app.dropping = false;
      holder.classList.remove("dropping");
      act.dropClips(track, event.dataTransfer.files);
    },
  }, h("div.scroll", { "data-scroll": "page" }, page), h("div.drop-note", h("div", icon("download"), `Drop to add to ${name}`)));
  if (app.dropping) holder.classList.add("dropping");
  return holder;
}

/** The Video Creator: its own sidebar of events and tracks, and one of its pages. */
export function videoCreator() {
  return h("div.creator", sidebar(), h("main.creator-page", app.page.name === "track" ? trackPage(app.page.track) : noTracks()));
}

export { loadForm, Bin };
