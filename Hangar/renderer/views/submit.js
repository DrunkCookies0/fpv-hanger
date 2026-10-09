// Submitting a run. First a window that checks the answers: the video's link, the pilot's email,
// the questions only the pilot can answer, and what the app fills in by itself. Then the track's
// real Google Form, filled in, for the pilot to look over and send.

import { app, ask, hangar, render, loadTrack, trackName } from "../core.js";
import { h, icon, label, primary, secondary, comingSoonBadge, redraw } from "../ui.js";
import { showSheet } from "../sheets.js";
import { fileBrowser } from "../words.js";
import { looksLikeEmail, looksLikeYouTube } from "../../shared/forms.js";
import { reveal, openLink } from "../actions.js";

const blank = (values) => (values ?? []).every((value) => value.trim() === "");
const known = ["handle", "number", "time"];
const knownName = (question) => (question.role === "handle" ? "Pilot handle" : question.role === "number" ? "Registration number" : "Fastest three laps in a row");

export async function openSubmit(track, run) {
  const time = run.best?.seconds ?? "";
  const data = await ask("submitData", track, run.name);
  const form = data.form;
  const state = {
    answers: {}, email: data.email, showingForm: false, sent: false,
    /** The questions with no answer kept from an earlier entry: new on this form, or never answered. */
    fresh: new Set(),
    /** The question that is opened up to be answered or changed. One at a time. */
    open: null,
    changingKnown: false,
    /** No email was kept when the window opened, so it is asked for in a place of its own. It stays
     *  there while it is typed: a box must not fold away after its first letter. */
    askingEmail: data.email.trim() === "",
    /** Something the app fills in was empty when the window opened, so those answers are opened up. */
    knownOpened: false,
  };
  const answers = state.answers;
  const questions = form?.questions ?? [];
  const linkQuestion = questions.find((question) => question.role === "link") ?? null;
  const summary = (question) => {
    const given = (answers[question.id] ?? []).map((value) => value.trim()).filter((value) => value !== "");
    return given.length === 0 ? null : given.join(", ");
  };
  /** The questions only the pilot can answer, in the order they are gone through: the ones with no
   *  answer kept from an earlier entry first. */
  const mine = () => {
    const all = questions.filter((question) => question.role === null);
    return [...all.filter((question) => state.fresh.has(question.id)), ...all.filter((question) => !state.fresh.has(question.id))];
  };
  const needsAnswer = (question) => question.kind !== "other" && question.required && summary(question) === null;
  const nextUnanswered = (question) => {
    const list = mine(), place = list.indexOf(question);
    return [...list.slice(place + 1), ...list.slice(0, place)].find(needsAnswer)?.id ?? null;
  };

  // Starts from what's known: the pilot, the time, and whatever was answered last time.
  for (const question of questions) {
    if (question.role === "handle") answers[question.id] = [data.pilot];
    else if (question.role === "number") answers[question.id] = [data.number];
    else if (question.role === "time") answers[question.id] = [time];
    else if (question.role === "link") answers[question.id] = [data.link];
    else {
      let kept = data.kept[question.title] ?? [];
      // An answer from an earlier form only counts if this form still offers it.
      if (question.kind === "choice" || question.kind === "checkboxes") kept = kept.filter((value) => question.options.includes(value));
      answers[question.id] = [...kept];
      if (blank(kept)) state.fresh.add(question.id);
    }
  }
  state.open = mine().find(needsAnswer)?.id ?? null;
  // The pilot's name, number or time missing: open those up, and leave them open while they are typed.
  state.knownOpened = questions.some((question) => known.includes(question.role) && question.required && (answers[question.id]?.[0] ?? "").trim() === "");

  const missing = () => questions.filter((question) => question.required && question.kind !== "other" && blank(answers[question.id]));
  /** What still has to be given before the form can be filled in, in a line. Null when nothing does. */
  const inTheWay = () => {
    const waiting = [];
    const count = missing().length;
    if (count > 0) waiting.push(`${count} required answer${count === 1 ? "" : "s"} still empty`);
    const typed = state.email.trim();
    if (typed === "") waiting.push("your email is still empty");
    else if (!looksLikeEmail(typed)) waiting.push("your email isn't a whole address yet");
    if (waiting.length === 0) return null;
    return [waiting[0][0].toUpperCase() + waiting[0].slice(1), ...waiting.slice(1)].join(", and ");
  };

  const sheet = h("div.submit");
  const body = h("div.submit-body");
  const foot = h("div.submit-foot");
  const title = h("div.submit-title");
  let close = () => {};
  const offs = [];
  const leave = () => {
    ask("closeForm");
    window.removeEventListener("resize", placeForm);
    for (const off of offs) off();
    close();
    loadTrack(track).then(render);
  };

  const box = (key, prompt, value, onInput, props = {}) => h("input.field.answer-field", { type: "text", key, placeholder: prompt, value, spellcheck: false, oninput: (event) => onInput(event.target.value), ...props });
  /** A line under a box: "good" and "warn" carry a mark, "warn plain" is the words alone. */
  const status = (kind, text) => h(`div.submit-status.${kind}`, kind.includes("plain") ? null : icon(kind === "good" ? "checkCircle" : "warning"), text);

  /** The link gets a place of its own, because the form can't be sent until the video is online. */
  function linkCard(question) {
    const video = run.landscapes.at(-1) ?? null;
    const set = (value) => {
      answers[question.id] = [value];
      ask("setLink", track, run.name, value);
    };
    return h("div.card.submit-card", { help: question.title },
      h("div.row", label("YOUR VIDEO'S LINK"), h("span.spacer"), h("span", { help: "Uploading the video to YouTube from here, with the link filled in for you." }, comingSoonBadge())),
      h("div.row.tight",
        box("link", "Paste the YouTube link to your 16:9 video", answers[question.id]?.[0] ?? "", (value) => {
          set(value);
          drawFoot();
          redraw(linkStatus, linkWords());
        }, { class: "grow" }),
        secondary("Paste", async () => {
          set((await ask("clipboardText")).trim());
          draw();
        }, { help: "Paste the link you copied from YouTube." }),
      ),
      h("div.row.tight", linkStatus, h("span.spacer"),
        secondary("YouTube's upload page", () => openLink("https://www.youtube.com/upload")),
        video && secondary("Show the video", () => reveal(video), { help: `Show this run's 16:9 video in ${fileBrowser}, to upload it.` }),
      ),
      !video && status("warn plain", "There is no 16:9 video of this run yet. Make it on the track page."),
    );
  }
  const linkStatus = h("div.link-status");
  const linkWords = () => {
    const typed = (answers[linkQuestion.id]?.[0] ?? "").trim();
    if (typed === "") return status("warn plain", "The form needs it, so the video has to be on YouTube first.");
    return looksLikeYouTube(typed) ? status("good", "That is a YouTube link.") : status("warn", "That doesn't look like a YouTube link.");
  };

  /** The email is asked for by itself the first time an entry is made: the form won't take one without it. */
  const emailStatus = h("div");
  const emailWords = () => {
    const typed = state.email.trim();
    if (typed === "") return status("warn plain", "The form can't be filled in without it.");
    return looksLikeEmail(typed) ? status("good", "That goes on the form, and is kept for next time.") : status("warn", "That isn't a whole email address yet.");
  };
  const emailCard = () => h("div.card.submit-card",
    label("YOUR EMAIL"),
    h("p.dim.small", "The entry form asks for an email address. Type yours once and it is kept for every track after this."),
    box("email", "Your email address", state.email, (value) => {
      state.email = value;
      drawFoot();
      redraw(emailStatus, emailWords());
    }),
    emailStatus,
  );

  /** One question's answering: a box to type in, or its choices. */
  function answering(question) {
    const values = answers[question.id] ?? [];
    if (question.kind === "text") return box(`answer ${question.id}`, "Your answer", values[0] ?? "", (value) => {
      answers[question.id] = [value];
      drawFoot();
    });
    if (question.kind === "paragraph") return h("textarea.field.answer-field", { key: `answer ${question.id}`, rows: 3, placeholder: "Your answer", spellcheck: false, value: values[0] ?? "", oninput: (event) => {
      answers[question.id] = [event.target.value];
      drawFoot();
    } });
    if (question.kind === "other") return h("p.dim.small", "Answer this one in the form itself on the next step.");
    const single = question.kind === "choice";
    return h("div.options", question.options.map((option) => {
      const chosen = values.includes(option);
      return h(`button.option${chosen ? ".chosen" : ""}`, { type: "button", onclick: () => {
        if (single) answers[question.id] = chosen ? [] : [option];
        else answers[question.id] = chosen ? values.filter((value) => value !== option) : [...values, option];
        // One answer is all a choice takes: on to the next that needs one.
        if (single && !chosen) state.open = nextUnanswered(question);
        draw();
      } }, h(`span.${single ? "radio" : "tick"}`, !single && chosen && icon("check", 10)), h("span", option));
    }));
  }

  /** The questions the app can't answer: one line each, with the answer that will go in. A
   *  question with no answer says so. One at a time opens up to be answered or changed. */
  function yours() {
    const list = mine();
    if (list.length === 0) return null;
    const waiting = list.filter(needsAnswer).length, kept = list.filter((question) => !state.fresh.has(question.id)).length;
    return h("div.card.submit-card",
      h("div.row.baseline", label("YOURS TO CHECK"), h("span.spacer"), h(`span.submit-count.${waiting === 0 ? "good" : "warn"}`, waiting === 0 ? "All answered" : `${waiting} need${waiting === 1 ? "s" : ""} an answer`)),
      h("p.dim.small", kept === 0 ? "The app can't know these. Answer them once and they are kept for your next entry."
        : "The app can't know these, so it uses what you answered last time. Look them over before they go in: some change from track to track."),
      list.map((question) => {
        const opened = state.open === question.id, answer = summary(question);
        return h(`div.ask${opened ? ".opened" : ""}`,
          h("button.ask-head", { type: "button", help: question.title, onclick: () => {
            state.open = opened ? null : question.id;
            draw();
          } },
            icon(answer === null ? "circle" : "checkCircle", 13, { class: answer === null ? (question.required ? "warn dashed" : "faint") : "good" }),
            h("div.ask-words",
              h(`div.ask-title${opened ? ".open" : ""}`, question.title),
              !opened && h(`div.ask-answer${answer !== null ? "" : question.required && question.kind !== "other" ? ".warn" : ".faint"}`,
                answer ?? (question.kind === "other" ? "Answered on the form itself" : question.required ? "Needs your answer" : "Left empty")),
            ),
            h("span.ask-action", opened ? "Done" : answer === null ? "Answer" : "Change"),
          ),
          opened && h("div.ask-body", answering(question)),
        );
      }),
    );
  }

  /** What the app answers by itself, in a line. It opens up when one of them needs changing or is missing. */
  function filledIn() {
    const list = questions.filter((question) => known.includes(question.role));
    const empty = list.some((question) => question.required && (answers[question.id]?.[0] ?? "").trim() === "");
    const opened = state.changingKnown || state.knownOpened || empty;
    return h("div.card.submit-card",
      h("div.row.baseline", label("FILLED IN FOR YOU"), h("span.spacer"),
        !empty && !state.knownOpened && h("button.ask-action", { type: "button", onclick: () => {
          state.changingKnown = !state.changingKnown;
          draw();
        } }, state.changingKnown ? "Done" : "Change")),
      opened ? [
        h("div.known-grid",
          list.map((question) => h("label.answer", { help: question.title }, h("span.question", knownName(question), question.required && h("span.required", "  required")),
            box(`known ${question.id}`, "", answers[question.id]?.[0] ?? "", (value) => {
              answers[question.id] = [value];
              drawFoot();
            }))),
          // Asked for in its own place above when there was none to begin with.
          !state.askingEmail && h("label.answer", h("span.question", "Your email", h("span.required", "  required")), box("known email", "", state.email, (value) => {
            state.email = value;
            drawFoot();
          })),
        ),
        empty && status("warn plain", "Something here is empty. Your name and ID come from Pilot & settings."),
      ] : h("div.known-lines",
        // Each on its own line: what it is, and what goes in.
        list.map((question) => h("div.known-line", h("span.known-name", knownName(question)), h("span.known-value", answers[question.id]?.[0] ?? ""))),
        !state.askingEmail && h("div.known-line", h("span.known-name", "Your email"), h("span.known-value", state.email)),
      ),
    );
  }

  const formPlace = h("div.form-place");
  function placeForm() {
    if (!state.showingForm || state.sent || !formPlace.isConnected) return;
    const at = formPlace.getBoundingClientRect();
    ask("placeForm", { x: at.left, y: at.top, width: at.width, height: at.height });
  }

  /** Keeps what was answered for the next entry, then opens the form itself, filled in. */
  async function fill() {
    const kept = {};
    for (const question of questions) if (question.role === null) kept[question.title] = answers[question.id] ?? [];
    await ask("rememberAnswers", track, run.name, { email: state.email, answers: kept, link: linkQuestion ? answers[linkQuestion.id]?.[0] ?? "" : null });
    if (app.state) app.state.email = state.email.trim();
    state.showingForm = true;
    draw();
    const at = formPlace.getBoundingClientRect();
    const opened = await ask("openForm", track, { answers, email: state.email.trim() }, { x: at.left, y: at.top, width: at.width, height: at.height });
    if (opened.problem) {
      state.showingForm = false;
      app.notice = opened.problem;
      draw();
      render();
    }
  }

  function drawFoot() {
    if (state.sent) return redraw(foot, h("span.spacer"), primary("Done", leave, { "data-default": true }));
    if (state.showingForm) {
      return redraw(foot,
        secondary("Back to answers", () => {
          ask("closeForm");
          state.showingForm = false;
          draw();
        }),
        h("span.spacer"),
        h("span.dim.small", "Nothing is sent until you press Submit at the bottom of the form."),
        secondary("Close", leave));
    }
    const waiting = form ? inTheWay() : null;
    redraw(foot, secondary("Cancel", leave), h("span.spacer"), waiting && h("span.warn.small.semibold", waiting), primary("Fill in the form", fill, { disabled: !form || waiting !== null }));
  }

  function draw() {
    redraw(title, state.sent ? "Sent" : state.showingForm ? "Check it and press Submit" : "Check your answers");
    // The check is a small window. The form itself needs room.
    sheet.classList.toggle("wide", state.showingForm && !state.sent);
    if (!form) {
      redraw(body, h("div.submit-empty", h("div.card-title", "No form yet"), h("p.dim", data.problem ?? "Paste this track's Google Form link into the Submission form box on the track page first.")));
    } else if (state.sent) {
      redraw(body, h("div.submit-empty", icon("seal", 60, { class: "good" }), h("div.submit-sent", `Google has your ${time} for ${trackName(track)}.`), h("p.dim", "It's logged on the track page too.")));
    } else if (state.showingForm) {
      if (formPlace.parentElement !== body) redraw(body, formPlace);
    } else {
      const top = body.firstElementChild?.scrollTop ?? 0;
      if (linkQuestion) redraw(linkStatus, linkWords());
      redraw(emailStatus, emailWords());
      redraw(body, h("div.submit-scroll", linkQuestion && linkCard(linkQuestion), state.askingEmail && emailCard(), yours(), filledIn()));
      body.firstElementChild.scrollTop = top;
    }
    drawFoot();
  }

  // Google only moves on once it has accepted the answers: the entry is logged then.
  offs.push(hangar.hear("formSent", async (sentTrack) => {
    if (sentTrack !== track || state.sent) return;
    await ask("recordSubmission", track, run.name, time, linkQuestion ? answers[linkQuestion.id]?.[0] ?? "" : "");
    await ask("closeForm");
    state.sent = true;
    draw();
  }));
  window.addEventListener("resize", placeForm);

  sheet.append(
    h("div.submit-head",
      h("div", label(`SUBMIT ${trackName(track).toUpperCase()}`), title),
      h("span.spacer"),
      h("div.submit-time", h("div.submit-seconds", time), h("div.submit-run", run.name)),
    ),
    body, foot,
  );
  draw();
  close = showSheet(sheet, { onEscape: leave });
  // For the app's checks of itself.
  window.hangar_.submit = { state, answers, fill, leave, form };
}
