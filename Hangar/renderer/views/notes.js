// The notes that come up over the window: the welcome on the very first run, what is new after an
// update, and the two questions a new pilot is asked.

import { app, ask, take, render, settle } from "../core.js";
import { h, icon, label, primary, secondary, comingSoonBadge, marked, redraw } from "../ui.js";
import { showSheet } from "../sheets.js";
import { readMe, season, fileBrowser } from "../words.js";
import { openFolder } from "../actions.js";

const idLabel = () => app.state.idLabel;

/** A section's steps, points and paragraphs. */
function rows(section) {
  let number = 0;
  return section.items.map(([kind, text]) => {
    if (kind === "step") {
      number += 1;
      return h("div.step", h("span.step-number", number), h("div.step-text", text));
    }
    if (kind === "point") return h("div.point", h("span.dot"), h("div.point-text.dim", text));
    return h("p.dim", text);
  });
}

/** Where this copy keeps things. */
function library() {
  const state = app.state;
  return [
    h("p.dim", state.libraryIsFixed ? "In the folder this copy of the app was started on:" : "In this folder. Pilot & settings lets you use a different one."),
    h("div.path", state.library),
    h("div.row", secondary(`Show in ${fileBrowser}`, () => openFolder(state.library))),
  ];
}

/** The changelog's entries, newest first. */
function changes(entries) {
  const current = app.state.version;
  if (entries.length === 0) return h("p.dim", "Nothing is written down for this version.");
  return entries.map((entry) => h("div.change",
    h("div.change-head", h(`span.change-version${entry.version === current ? ".accent" : ""}`, `v${entry.version}`), label(entry.date.toUpperCase())),
    entry.lines.map((line) => (line.startsWith("- ")
      ? h("div.point", h("span.dot"), h("div.point-text", marked(line.slice(2))))
      : h("p.dim", marked(line)))),
  ));
}

/**
 * The note over the window. As the welcome it is the read-me: what the app is, how to start, and
 * what isn't built yet. As "What's new" it is the changelog since the version last run. Both can
 * be opened again from How it works.
 */
export async function showNote(note) {
  const welcome = note.kind === "welcome";
  const entries = welcome ? [] : await ask("changelog", note.since ?? null);
  let close = () => {};
  const done = () => {
    close();
    // After the welcome, a pilot with no name yet is asked the setup questions.
    if (welcome && app.state.settings.pilot === "") showSetUp();
  };
  close = showSheet(h(`div.note${welcome ? ".welcome" : ""}`,
    h("div.note-head",
      label(welcome ? "WELCOME TO" : "WHAT'S NEW IN"),
      h("div.wordmark.medium", h("span", "FPV"), h("span.accent", "HANGAR")),
      h("div.note-summary", welcome ? readMe.summary : `You are on version ${app.state.version}.`),
    ),
    h("div.note-body", welcome
      ? readMe.sections.map((section) => h("div.note-section",
        h("div.row.tight", label(section.title.toUpperCase()), section.soon && comingSoonBadge()),
        section.library ? library() : rows(section)))
      : changes(entries)),
    h("div.note-foot",
      h("span.faint.small", `FPV Hangar v${app.state.version}  ·  This note stays under How it works.`),
      h("span.spacer"),
      primary(welcome ? "Get started" : "Got it", done, { "data-default": true }),
    ),
  ), { onEscape: done });
}

/**
 * The questions a new pilot is asked after the welcome note: their pilot name, and whether they
 * fly this season of RaceGOW. A pilot who does is looked up on the series' own pilot list, by name
 * or by number, so their registration number doesn't have to be typed.
 *
 * `lookingUp` starts on the second question with a name already answered yes and looked up. Only
 * the mode that draws pages uses it. Resolves when the lookup it starts has finished.
 */
export function showSetUp({ lookingUp = null } = {}) {
  const answers = { second: false, pilot: app.state.settings.pilot, flies: null, asked: "", search: { kind: "idle" }, chosen: null, number: "" };
  const body = h("div.setup-body");
  const foot = h("div.setup-foot");
  let close = () => {};

  const named = () => answers.pilot.trim() !== "";
  const next = () => {
    if (!named()) return;
    answers.second = true;
    draw();
  };

  async function lookUp() {
    const query = answers.asked;
    if (query.trim() === "" || answers.search.kind === "reading") return;
    answers.chosen = null;
    answers.number = "";
    answers.search = { kind: "reading" };
    draw();
    const read = await ask("lookUpPilot", query);
    if (read.problem) {
      answers.search = { kind: "failed", reason: read.problem };
    } else {
      answers.search = { kind: "found", pilots: read.found };
      // Only one it could be: that one is taken, and can still be un-picked by looking again.
      if (read.found.length === 1) {
        answers.chosen = read.found[0];
        answers.number = read.found[0].number;
      }
    }
    draw();
  }

  async function finish() {
    const flies = answers.flies === true;
    const done = take(await ask("finishSetUp", { pilot: flies ? answers.chosen?.name ?? answers.pilot : answers.pilot, fliesSeries: flies, number: answers.chosen?.number ?? answers.number }));
    close();
    settle();
    render();
    return done;
  }

  const box = (key, prompt, value, onInput, props = {}) => h(`input.field${props.large ? ".large" : ""}`, {
    type: "text", key, placeholder: prompt, value, spellcheck: false, oninput: (event) => onInput(event.target.value), ...props, large: undefined,
  });

  const answerButton = (title, picked, action) => h(`button.choice${picked ? ".picked" : ""}`, { type: "button", onclick: action }, picked && icon("check", 11), title);

  /** The registration number typed by the pilot, for when the list can't supply it. */
  const byHand = () => h("div.row", h("span.by-hand", idLabel()), box("number", "Such as 042", answers.number, (text) => { answers.number = text; }, { style: { width: "150px" } }));

  function results() {
    const search = answers.search;
    if (search.kind === "reading") return h("div.row.dim", h("span.spinner"), `Reading the ${season} pilot list…`);
    if (search.kind === "failed") {
      return [h("p.warn", `The pilot list couldn't be read: ${search.reason}. You can type your ID here, or leave it and add it later in Pilot & settings.`), byHand()];
    }
    if (search.kind !== "found") return null;
    if (search.pilots.length === 0) {
      return [h("p.warn", `Nobody on the ${season} pilot list matches that. Try your registration number, or the name exactly as you registered it. You can also type your ID here and carry on.`), byHand()];
    }
    const same = (a, b) => a && b && a.name === b.name && a.number === b.number;
    return [
      h("div.found-title", search.pilots.length === 1 ? `Found on the ${season} pilot list:` : "Which of these is you?"),
      h("div.found", search.pilots.map((one) => h(`button.found-row${same(answers.chosen, one) ? ".picked" : ""}`, {
        type: "button",
        onclick: () => {
          answers.chosen = one;
          answers.number = one.number;
          draw();
        },
      }, icon(same(answers.chosen, one) ? "checkCircle" : "circle"), h("span.found-name", one.name), h("span.spacer"), h("span.found-id", `${idLabel()} ${one.number}`.toUpperCase())))),
      answers.chosen && answers.chosen.name !== answers.pilot.trim() && h("p.dim.small", `Your videos and entries will say ${answers.chosen.name}, the way the list spells it.`),
    ];
  }

  function draw() {
    const reading = answers.search.kind === "reading";
    redraw(body,
      label(answers.second ? "SETTING UP  ·  2 OF 2" : "SETTING UP  ·  1 OF 2"),
      answers.second ? [
        h("h2.setup-title", `Are you flying ${season}?`),
        h("p.dim", `${season} is this season of the RaceGOW whoop racing series. If you are registered, the app can find your registration number on the series' pilot list.`),
        h("div.row",
          answerButton(`Yes, I'm in ${season}`, answers.flies === true, () => {
            answers.flies = true;
            if (answers.asked === "") answers.asked = answers.pilot;
            if (answers.search.kind === "idle") lookUp();
            else draw();
          }),
          answerButton("No", answers.flies === false, () => {
            answers.flies = false;
            draw();
          }),
        ),
        answers.flies === true && [
          h("div.row.look-up",
            box("asked", `Pilot name or ${idLabel()}`, answers.asked, (text) => {
              answers.asked = text;
              look.disabled = text.trim() === "" || reading;
            }, {
              class: "grow",
              onkeydown: (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                lookUp();
              },
            }),
            look,
          ),
          results(),
        ],
        answers.flies === false && h("p.dim", "That's fine. In the Video Creator, press New event and name it after whatever you fly: a race, a series, or just practice. Its name is what goes on your timer."),
      ] : [
        h("h2.setup-title", "What's your pilot name?"),
        h("p.dim", "It goes on every timer and finished video, and into race entry forms. Use the name you race under."),
        box("pilot", "Pilot name", answers.pilot, (text) => {
          answers.pilot = text;
          forward.disabled = !named();
        }, { large: true, "data-first": true }),
      ],
    );
    look.disabled = answers.asked.trim() === "" || reading;
    const forward = answers.second
      ? primary("Finish", finish, { disabled: answers.flies === null || reading, "data-default": true })
      : primary("Next", next, { disabled: !named(), "data-default": true });
    redraw(foot,
      answers.second
        ? secondary("Back", () => {
          answers.second = false;
          draw();
        })
        : secondary("Skip for now", () => close(), { help: "Nothing is set. Pilot & settings has all of this, and can ask again." }),
      h("span.spacer"),
      forward,
    );
  }

  const look = secondary("Look up", lookUp);
  draw();
  close = showSheet(h("div.setup", body, foot), { onEscape: () => close() });
  if (lookingUp === null) return Promise.resolve();
  answers.pilot = lookingUp;
  answers.asked = lookingUp;
  answers.second = true;
  answers.flies = true;
  return lookUp();
}
