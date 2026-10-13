// The Video Creator: a rail of its groups, the open group's races beside it, its first page with
// everything at a glance, and a track's page with its runs, its clips and its entry form.

import { app, ask, go, open, refresh, render, eventOf, trackName, loadForm } from "../core.js";
import { h, icon, label, primary, secondary, plain, testCopyBadge, when } from "../ui.js";
import { menu } from "../sheets.js";
import { bin, Bin, fileBrowser, season } from "../words.js";
import * as act from "../actions.js";
import { updatePill } from "./home.js";
import { showSetUp } from "./notes.js";
import { driveWord } from "./drive.js";
import { addClips, cardNote } from "./cards.js";
import { uploadItems, uploadMenu, aboutRun } from "./upload.js";
import { sites, uploadsOf } from "../../shared/uploads.js";
import { videoIdOf, countWords } from "../../shared/counts.js";

/** A video's counts on YouTube, as last read for a track's page, or null. */
const countsOf = (track, link) => app.counts.get(track)?.counts?.[videoIdOf(link)] ?? null;

const busy = () => Boolean(app.state.job);

// The groups, down the left: each a badge with its logo, or its initials in a colour of its own, so
// a group is never taken for a race. Choosing one shows its races in the column beside it.

/** Colours for groups with no logo, each the same lightness so none stands out. */
const hues = ["#5cccff", "#ff66bd", "#45db85", "#b18cff", "#ff9e38", "#5ee0d0"];

/** Each group's colour: the one its folder's name picks, or the next one no group before it has,
 *  so two groups side by side don't share one while there are colours enough. */
function hueOf(event) {
  const taken = new Set();
  for (const one of app.state.events) {
    let sum = 0;
    for (const character of one.folder || "tracks") sum = (sum * 31 + character.charCodeAt(0)) >>> 0;
    let at = sum % hues.length;
    for (let tries = 0; tries < hues.length && taken.has(hues[at]); tries += 1) at = (at + 1) % hues.length;
    if (one.folder === event.folder) return hues[at];
    taken.add(hues[at]);
  }
  return hues[0];
}

/** The colour, faint, for behind a group's initials. */
function tintOf(hue, alpha = 0.16) {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hue.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const groupName = (event) => (event.name === "" ? "Tracks" : event.name);

/** Two letters for a group: the first of its first two words, or its capitals ("RaceGOW6" is RG). */
export function initialsOf(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const word = words[0] ?? "";
  const capitals = word.replace(/[^A-Z]/g, "");
  return (capitals.length >= 2 ? capitals.slice(0, 2) : word.slice(0, 2)).toUpperCase();
}

/** A group's badge: its logo when it has one, else its initials on its colour. */
function groupBadge(event, size = 44) {
  const hue = hueOf(event);
  return h(`span.group-badge${event.logo ? ".logo" : ""}`, { style: { width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.28)}px`, color: hue, background: event.logo ? "#20242a" : tintOf(hue), fontSize: `${Math.round(size * 0.32)}px` } },
    event.logo ? h("img", { src: event.logo, alt: "" }) : initialsOf(groupName(event)));
}

/** What sort of group it is, and how many races it has. */
function kindOf(event) {
  const count = event.tracks.length;
  if (event.isSeason) return `SERIES · ${count} TRACK${count === 1 ? "" : "S"}`;
  return `${count} RACE${count === 1 ? "" : "S"}`;
}

/** Goes to a group: the race last looked at in it, else its newest, else the group itself. */
function openGroup(event) {
  const last = app.state.lastTrack;
  const there = event.tracks.find((track) => track.path === last) ?? event.tracks.at(-1);
  go(there ? { name: "track", track: there.path } : { name: "group", folder: event.folder });
}

function groupMenu(event) {
  return (click) => {
    click.preventDefault();
    menu(click, [
      { title: event.isSeason ? "New track" : "New race", action: () => act.newRace(event.folder) },
      // Only a group with a folder of its own can go, and only once its races have.
      ...(event.folder === "" ? [] : [{ title: event.tracks.length === 0 ? `Move this group to ${bin}` : `Delete its ${event.isSeason ? "tracks" : "races"} first to delete this group`, disabled: event.tracks.length > 0, action: () => act.removeEvent(event.folder) }]),
    ]);
  };
}

function rail(current) {
  const state = app.state;
  const onFirst = app.page.name === "tracks";
  const button = (classes, props, ...inside) => h(`button.rail-btn${classes}`, { type: "button", ...props }, ...inside);
  return h("nav.rail", { "aria-label": "Groups" },
    button(".rail-back", { help: "Back to all the tools", "aria-label": "Back to the Hangar", probe: "tool hangar", onclick: () => go({ name: "home" }) }, icon("chevronLeft", 14)),
    button(`.rail-home${onFirst ? ".on" : ""}`, { help: "Your flying: everything in the Video Creator", "aria-label": "Your flying", probe: "creator home", onclick: () => go({ name: "tracks" }) }, icon("home", 18)),
    h("span.rail-line"),
    h("div.rail-groups", { "data-scroll": "rail" },
      state.events.map((event) => button(`.rail-group${current?.folder === event.folder ? ".on" : ""}`, {
        help: groupName(event), "aria-label": groupName(event), probe: `group ${event.folder}`,
        onclick: () => openGroup(event), oncontextmenu: groupMenu(event),
      }, groupBadge(event))),
      !state.libraryAway && button(".rail-add", { help: "New group: a race series or a club you fly with, with its own races, its own name on the timer and its own ID.", "aria-label": "New group", probe: "new group", onclick: act.newEvent }, icon("plus", 16)),
    ),
    h("span.spacer"),
    button("", { help: "Pilot & settings", "aria-label": "Pilot & settings", probe: "tool settings", onclick: () => open({ name: "settings" }) },
      icon("gear", 17), state.update?.kind === "available" && h("span.rail-dot")),
    button("", { help: "How it works", "aria-label": "How it works", probe: "tool guide", onclick: () => open({ name: "guide" }) }, icon("book", 17)),
  );
}

/** A race's day, short: "4 Oct 2026". */
const dayOf = (date) => (date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** The group that is open: its name, what it is, and its races. */
function groupColumn(event) {
  const state = app.state;
  const hue = hueOf(event);
  const rows = event.tracks.map((track) => {
    const here = app.page.name === "track" && app.page.track === track.path;
    return h(`button.race-row${here ? ".on" : ""}`, {
      type: "button", probe: `race ${track.path}`, onclick: () => go({ name: "track", track: track.path }),
      oncontextmenu: (click) => {
        click.preventDefault();
        menu(click, [
          ...(event.isSeason ? [] : [{ title: "Rename or move…", action: () => act.editRace(track.path) }]),
          { title: `Move ${track.name} to ${bin}`, action: () => act.removeTrack(track.path) },
        ]);
      },
    }, h("span.race-name", track.name), h("span.race-detail", dayOf(track.date), track.best && h("span.race-best", track.best)));
  });
  if (event.next) {
    // The season's next track: it becomes a track of its own on the day it opens.
    const opens = new Date(event.next.release), closes = new Date(event.next.deadline);
    const full = { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
    rows.push(h("div.race-row.next", { help: `Track ${event.next.number} opens on ${opens.toLocaleString(undefined, full)} and its entries close on ${closes.toLocaleString(undefined, full)}. It will appear here by itself.` },
      h("span.race-name", `Track ${event.next.number}`), h("span.race-detail", `Opens ${opens.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`)));
  }
  return h("aside.group-column", { "aria-label": `${groupName(event)}'s races` },
    h("div.column-head",
      h("div.column-kind", { style: { color: hue } }, kindOf(event)),
      h("div.column-title",
        h("h2.column-name", groupName(event)),
        secondary("", () => open({ name: "settings" }), { icon: "gear", help: "This group's name on the timer, your ID and its logo are in Pilot & settings.", "aria-label": "Group settings" }),
      ),
      event.id !== "" && h("div.column-id", `${event.idLabel} ${event.id}`.toUpperCase()),
    ),
    label(event.isSeason ? "TRACKS" : "RACES"),
    h("div.column-list", { "data-scroll": "side" },
      rows,
      !event.hasSeason && h("button.side-add", { type: "button", probe: "new track", onclick: () => act.newRace(event.folder) }, icon("plus"), event.isSeason ? "New track" : "New race"),
    ),
    h("div.side-foot",
      updatePill(),
      state.settings.pilot === ""
        ? h("button.side-pilot.add", { type: "button", onclick: () => open({ name: "settings" }) }, "Add your pilot name")
        : h("div.side-pilot", state.settings.pilot),
      h("div.side-version", `FPV Hangar v${state.version}`),
      state.testCopy && testCopyBadge(),
    ),
  );
}

/** The Video Creator's first page: everything in it at a glance, and what is waiting to be done. */
function firstPage() {
  const state = app.state;
  const events = state.events;
  const head = h("div.first-head",
    h("div", h("div.first-wordmark", h("span", "VIDEO"), h("span.accent", "CREATOR")), h("h1.page-title", "YOUR FLYING")),
    h("span.spacer"),
    updatePill(),
    state.testCopy && testCopyBadge(),
    !state.libraryAway && secondary("New group", act.newEvent, { probe: "new event" }),
  );
  const holder = (...cards) => h("div.scroll", { "data-scroll": "page" }, h("div.track-page.first-page", head, ...cards));
  const races = events.flatMap((event) => event.tracks.map((track) => ({ ...track, event })));
  if (state.libraryAway) {
    // The library is somewhere that isn't there just now, Google Drive say: nothing is made until it is.
    return holder(h("div.card.roomy",
      h("div.card-title", "Your library isn't here just now"),
      h("p.dim", { "data-probe": "library away" }, state.libraryAway),
      h("div.row", secondary("Look again", () => refresh(), { probe: "library again" }), secondary("Pilot & settings", () => open({ name: "settings" }))),
    ));
  }
  if (events.length === 0) {
    return holder(h("div.card.roomy",
      h("div.card-title", "No groups yet"),
      h("p.dim", "A group is a race series or a club you fly with. Its races go inside it, and its name goes on the timer of every video you make in it."),
      h("div.row", primary("New group", act.newEvent, { probe: "new event first" }),
        secondary(`I fly ${season}`, () => showSetUp(), { help: `Answer the setup questions: the app makes the ${season} group and looks up your registration number.` })),
    ));
  }

  const runs = races.reduce((sum, race) => sum + (race.runs ?? 0), 0);
  const unmarked = races.reduce((sum, race) => sum + (race.unmarked ?? 0), 0);
  const dated = races.filter((race) => race.date).sort((a, b) => b.date.localeCompare(a.date));
  const totals = app.totals;
  const views = !totals ? "…" : totals.needsKey || totals.videos === 0 ? "–" : totals.views.toLocaleString("en-US");
  const viewsDetail = !totals ? "Reading YouTube…" : totals.problem ? totals.problem : totals.videos === 0 ? "Nothing on YouTube yet" : totals.needsKey ? "Add a YouTube key in Pilot & settings" : `${totals.videos} video${totals.videos === 1 ? "" : "s"}`;
  const others = events.filter((event) => !event.isSeason).length;

  // What is waiting: clips to mark, and the season's entries still to send while they are open.
  const now = Date.now();
  const waiting = [
    ...races.filter((race) => race.unmarked > 0).map((race) => ({ race, what: `Mark laps on ${race.unmarked} clip${race.unmarked === 1 ? "" : "s"}`, colour: "var(--warn)" })),
    ...races.filter((race) => race.event.isSeason && race.deadline && new Date(race.deadline) > now && race.runs > 0 && race.submissions === 0)
      .map((race) => ({ race, what: "Submit a run", when: `entries close ${new Date(race.deadline).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`, colour: "var(--accent)" })),
  ].slice(0, 5);
  const next = events.find((event) => event.next);

  const latest = (dated.length > 0 ? dated : races.toReversed()).slice(0, 4);
  return holder(
    h("div.stats.four",
      statCard("GROUPS", String(events.length), next ? `${groupName(next)}${others > 0 ? ` and ${others} more` : ""}` : `${others} of your own`),
      statCard("RACES", String(races.length), dated[0] ? `the latest on ${dayOf(dated[0].date)}` : " "),
      statCard("RUNS MARKED", String(runs), unmarked > 0 ? `${unmarked} clip${unmarked === 1 ? "" : "s"} still to mark` : "every clip marked"),
      statCard("VIEWS ON YOUTUBE", views, viewsDetail, false),
    ),
    h("div.first-pair",
      next && h("div.card.first-card",
        label("UP NEXT"),
        h("div.first-next", groupBadge(next, 40),
          h("div", h("div.first-title", `${groupName(next)} · Track ${next.next.number}`),
            h("div.dim.small", `Opens ${new Date(next.next.release).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · entries close ${new Date(next.next.deadline).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`))),
        h("p.dim.small", "It appears in its group by itself on the day it opens."),
      ),
      h("div.card.first-card",
        label("WAITING ON YOU"),
        waiting.length === 0
          ? h("p.dim.small", "Nothing. Every clip is marked and every entry is in.")
          : waiting.map((one) => h("button.first-todo", { type: "button", onclick: () => go({ name: "track", track: one.race.path }) },
            h("span.first-dot", { style: { background: one.colour } }), h("span.first-what", one.what),
            h("span.dim.small", `${groupName(one.race.event)} · ${one.race.name}${one.when ? `, ${one.when}` : ""}`))),
      ),
    ),
    latest.length > 0 && h("div.group",
      label("LATEST RACES"),
      h("div.first-races", latest.map((race) => h("button.card.first-race", { type: "button", probe: `latest ${race.path}`, onclick: () => go({ name: "track", track: race.path }) },
        h("span.first-race-group", { style: { color: hueOf(race.event) } }, groupBadge(race.event, 20), groupName(race.event)),
        h("span.first-title", race.name),
        h("span.dim.small", [dayOf(race.date), race.runs > 0 ? `${race.runs} run${race.runs === 1 ? "" : "s"}` : race.unmarked > 0 ? "not marked yet" : "no clips yet"].filter(Boolean).join(" · ")),
        h("span.first-best", race.best ?? "–"),
      ))),
    ),
  );
}

/** A group with no races in it yet. */
function emptyGroup(event) {
  return h("div.scroll", { "data-scroll": "page" }, h("div.track-page",
    h("div", label(kindOf(event)), h("h1.page-title", groupName(event).toUpperCase())),
    h("div.card.roomy", event.isSeason ? [
      h("div.card-title", "No tracks yet"),
      h("p.dim", `${season}'s tracks appear here by themselves, each on the day it opens.`),
      !event.hasSeason && h("div.row", primary("New track", () => act.newRace(event.folder), { probe: "new track first" })),
    ] : [
      h("div.card-title", "No races yet"),
      h("p.dim", "A race is one day's racing: its recordings, laps and videos are kept together. Make one, add your recordings to it, and mark the laps on them."),
      h("div.row", primary("New race", () => act.newRace(event.folder), { probe: "new track first" })),
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

/** Whether a track is entered through a form: the series' tracks are. A track in any other event
 *  has nothing to send, unless a form link was put in or an entry sent before. */
const takesEntries = (track, data) => Boolean(eventOf(track)?.isSeason) || data.state.formURL !== "" || data.state.submissions.length > 0;

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

/** A run's finished video, to upload. */
const videoOf = (track, run, file) => ({ file, name: file.split(/[\\/]/).pop(), track, run: run.name });

/** Makes a file, or offers the ones already made, and the places to upload the newest. */
function fileButton(track, data, run, shape, title, files) {
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
      "-",
      ...uploadItems(shape, videoOf(track, run, newest), aboutRun(data, run)),
    ]),
  }, icon(files.length === 1 ? "check" : "copies"), files.length === 1 ? title : `${title} ×${files.length}`, icon("chevronDown", 10));
}

const fileIcons = { "16:9 video": "landscape", "9:16 video": "portrait", "Race clip": "film", Music: "music" };
const outputTitles = { landscape: "16:9 video", upright: "9:16 video" };

/** The files behind a run, each with a way to play it. Finished videos can be thinned down to the
 *  right one, and uploaded. */
function runFiles(track, data, run) {
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
        file.output && secondary("Upload", (event) => uploadMenu(event.currentTarget, file.output, videoOf(track, run, file.path), aboutRun(data, run)), {
          icon: "upload", probe: `upload ${file.output} ${file.name}`,
          help: file.output === "landscape" ? "Upload to YouTube, through YouTube's own page in your browser." : "Upload to YouTube Shorts, TikTok or Instagram, through their own pages.",
        }),
        file.output && secondary("", () => act.trashFiles([file], track), { icon: "trash", help: `Move to ${bin}`, "aria-label": `Move ${file.name} to ${bin}` }),
      );
    }),
    files.length === 0 && h("p.dim.small", "No files for this run yet."),
    runUploads(track, data, run),
  );
}

/** Where the run's videos went up: the link on each site, kept when it was uploaded from here or
 *  added by hand, with a way to add, change or take off one. */
function runUploads(track, data, run) {
  const done = uploadsOf(data.state, run.name);
  const left = Object.keys(sites).filter((site) => !done[site]);
  const read = app.counts.get(track);
  const onYouTube = Boolean(done.youtube || done.shorts);
  const counted = (link) => {
    const counts = countsOf(track, link);
    return counts ? [countWords(counts.views, "view"), countWords(counts.likes, "like"), countWords(counts.comments, "comment")].filter(Boolean) : [];
  };
  return h("div.run-uploads",
    h("div.run-uploads-head",
      label("UPLOADED"),
      h("span.spacer"),
      left.length > 0 && secondary("Add a link…", (event) => menu(event.currentTarget, left.map((site) => ({ title: `On ${sites[site].title}…`, action: () => act.keepUploadLink(track, run.name, site) }))), {
        icon: "plus", probe: `add link ${run.name}`, help: "Keep the link to one of this run's videos on a site, uploaded from here or another way.",
      }),
    ),
    Object.entries(done).map(([site, { link, at }]) => h("div.file",
      icon("upload", 14, { class: "file-icon" }),
      h("div.file-words",
        h("div.file-name", sites[site].title, ...counted(link).map((words, at) => h(`span.run-count${at === 0 ? ".views" : ""}`, words))),
        h("div.file-detail.run-upload-link", at ? `${link} · ${when(at)}` : link)),
      h("span.spacer"),
      secondary("Open", () => act.openLink(link), { icon: "arrowUpRight", help: `Open it on ${sites[site].title}, in your browser.` }),
      secondary("Copy link", () => ask("copyText", link), { icon: "copies" }),
      secondary("", () => act.keepUploadLink(track, run.name, site), { icon: "pencil", help: "Change the link", "aria-label": `Change the link on ${sites[site].title}` }),
      secondary("", () => act.forgetUpload(track, run.name, site), { icon: "trash", help: "Take this link off the run. The video stays up.", "aria-label": `Take the link on ${sites[site].title} off this run` }),
    )),
    Object.keys(done).length === 0 && h("p.dim.small", "Nothing yet. Uploading from here keeps each video's link when you put it in, or add one you uploaded another way."),
    // Views on YouTube need a key of the pilot's own.
    onYouTube && read?.needsKey && h("div.row.tight.run-counts-note",
      h("p.dim.small.grow", "See how many views, likes and comments it has on YouTube: add a YouTube key in Pilot & settings. It's free."),
      secondary("Add a key", () => open({ name: "settings" }), { probe: "add youtube key" })),
    onYouTube && read?.problem && h("p.small.warn", read.problem),
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
    // Where its videos went up, each opening the video in the browser, with its views on YouTube.
    ...Object.entries(uploadsOf(data.state, run.name)).map(([site, { link }]) => {
      const views = countWords(countsOf(track, link)?.views, "view");
      return h("button.run-note.good.run-uploaded", {
        type: "button", probe: `uploaded ${site} ${run.name}`, help: `Open it on ${sites[site].title}: ${link}`,
        onclick: (event) => {
          event.stopPropagation();
          act.openLink(link);
        },
      }, icon("upload"), `on ${sites[site].title}${views ? ` · ${views}` : ""}`);
    }),
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
          fileButton(track, data, run, "landscape", "16:9 video", run.landscapes), fileButton(track, data, run, "upright", "9:16 video", run.uprights)),
        takesEntries(track, data) && primary("Submit this run", () => act.submitRun(track, run), { disabled: busy() || !run.best }),
      ),
    ),
    isOpen && runFiles(track, data, run),
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
      !data.hasClips && h("div.row", primary("Add clips…", (event) => addClips(track, event.currentTarget), { disabled: busy() })),
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
  const race = !event?.isSeason;
  const day = data.state.date ? new Date(`${data.state.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;
  const above = [event?.name, day].filter(Boolean).join("  ·  ");
  const head = h("div.track-head",
    h("div", above && label(above.toUpperCase()), h(`h1.page-title${name.length > 20 ? ".long" : ""}`, name.toUpperCase())),
    deadline && deadlinePill(deadline),
    h("span.spacer"),
    driveWord(),
    secondary(data.hasView ? "Track in 3D" : "Build the track in 3D", () => act.openTrackView(track), { icon: "cube", help: data.hasView ? "The track drawn in 3D, with the lap flown round it. Drag it to look from any side." : "Build this track in 3D: click its sections into place, then draw the line the lap is flown along." }),
    secondary("Add clips…", (event) => addClips(track, event.currentTarget), { disabled: busy(), probe: "add clips", help: `Copy recordings into this ${race ? "race" : "track"}, from a card or from anywhere else. You can also drop them onto this page.` }),
    secondary("Refresh", () => refresh()),
    secondary("Open folder", () => act.openFolder(data.folder)),
    race && secondary("", () => act.editRace(track), { icon: "pencil", disabled: busy(), probe: "edit race", "aria-label": "Rename or move this race", help: "Change this race's name or date, or move it to another group. Everything in it goes with it." }),
    secondary("", () => act.removeTrack(track), { icon: "trash", disabled: busy(), "aria-label": `Move this ${race ? "race" : "track"} to ${bin}`, help: `Move this ${race ? "race" : "track"} to ${bin}. If there is anything in it, you are asked to type I UNDERSTAND first.` }),
  );
  const entries = takesEntries(track, data);
  const page = h("div.track-page",
    h("div.track-top", head, data.season && seasonLine(data.season)),
    cardNote(track),
    h(`div.stats${entries ? "" : ".two"}`,
      statCard(`BEST ${summary.window} LAPS IN A ROW`, summary.best?.best?.seconds ?? "–", summary.best ? `${summary.best.name}, laps ${summary.best.best.firstLap}–${summary.best.best.lastLap}` : "No timed runs yet", true),
      statCard("BEST LAP", bestLap, `${summary.runs.length} run${summary.runs.length === 1 ? "" : "s"} marked`),
      entries && statCard("SUBMITTED", sent?.time ?? "–", sent ? `${sent.run}, ${new Date(sent.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Nothing sent yet"),
    ),
    entries && formCard(track, data),
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

/** The Video Creator: the rail of groups, the open group's races beside it, and the page. */
export function videoCreator() {
  const page = app.page;
  const event = page.name === "track" ? eventOf(page.track) : page.name === "group" ? app.state.events.find((one) => one.folder === page.folder) ?? null : null;
  return h("div.creator",
    rail(event),
    event && groupColumn(event),
    h("main.creator-page", page.name === "track" ? trackPage(page.track) : event ? emptyGroup(event) : firstPage()),
  );
}

export { loadForm, Bin };
