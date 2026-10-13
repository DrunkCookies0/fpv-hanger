// Uploading a finished video to YouTube, YouTube Shorts, TikTok or Instagram, through the site's
// own upload page.
//
// TikTok's and Instagram's pages are shown in the window beside a column of the app's own (the
// main process lays them over `.tool-frame`, the way it does another project's tool). YouTube's
// opens in the pilot's own browser, since Google doesn't let anyone sign in inside an app, and the
// column stays in the window beside the steps to take there. The column has the video, which goes
// into an in-app page by itself and can be dragged onto any of them, and the words to paste (a
// title and a description for YouTube, a caption for TikTok and Instagram, each written for that
// site, with the pilot's own lines on the end). For a run's video there is a place for its link
// on the site too, kept with the run as its log of where it went up (and, for YouTube, for its
// entry form). On YouTube, the link is taken in by itself when the pilot copies it there and comes
// back. While the upload is open it takes over the window, the way a tool does.

import { app, ask, hangar, render, loadTrack, loadCounts } from "../core.js";
import { h, icon, label, primary, secondary, plain, fill } from "../ui.js";
import { confirm, menu, showSheet } from "../sheets.js";
import { fileBrowser } from "../words.js";
import { sites, sitesFor, howTo, words as wordsFor } from "../../shared/uploads.js";

const shapeWords = { landscape: "16:9 video", upright: "9:16 video" };

/** What the words that go up with a run's video are made from. */
export function aboutRun(data, run) {
  return {
    event: data.event.name, id: data.event.id, idLabel: data.event.idLabel, race: data.name, date: data.state.date ?? "",
    best: run.best?.seconds ?? null, window: data.summary.window, bestLap: run.bestLap ?? null, laps: run.laps ?? [], song: run.song ?? "",
  };
}

class UploadView {
  /** `video` is { file, name, track, run }: the run is null for a video chosen from anywhere.
   *  `about` is what the words are made from. `after` is done once the page has closed. */
  constructor(id, video, about, after) {
    this.id = id;
    this.site = sites[id];
    this.video = video;
    this.about = { ...about, pilot: app.state.settings?.pilot ?? "" };
    this.own = app.state.uploadLines ?? "";
    this.words = wordsFor(id, this.about, this.own);
    this.after = after;
    // YouTube's page is in the pilot's own browser. The video's link is kept when there is a run to keep it with.
    this.inBrowser = Boolean(this.site.browser);
    this.keepsLink = Boolean(video.track && video.run);
    this.put = false;
    this.link = null;
    this.kept = false;
    this.leaving = false;
    this.onResize = () => this.place();
  }

  async open() {
    const site = this.site;
    this.frame = this.inBrowser ? null : h("div.tool-frame");
    this.status = h("span.tool-status", this.inBrowser ? "" : "Opening…");
    this.videoNote = h("p.upload-note");
    this.again = secondary("Put it in again", () => {
      ask("putVideoAgain");
      this.copied("The video goes in again when the page asks for one.");
    }, { help: "For when the page lost the video, or you started over on it." });
    const show = secondary(`Show in ${fileBrowser}`, () => ask("showUploadVideo"), { probe: "upload show video", help: `Shows the video in ${fileBrowser}, to drag onto ${site.title}'s page from there.` });
    const { title, description } = this.words;
    const titled = title !== null;
    this.title = titled && h("input.field.upload-title", { type: "text", value: title, spellcheck: true, key: "title", maxLength: 100 });
    this.caption = h("textarea.field.upload-caption", { rows: titled ? 8 : 9, spellcheck: true, value: description, key: "caption" });
    this.mine = h("textarea.field.upload-caption", {
      rows: 2, spellcheck: true, value: this.own, key: "own", placeholder: "Your gear, your channels…",
      oninput: () => this.ownChanged(),
    });
    this.captionNote = h("p.upload-note", `${titled ? "The title" : "It"} is on the clipboard: paste it into the page.`);
    const copy = (field, what) => secondary(`Copy ${what}`, () => {
      ask("copyText", field.value);
      this.copied(`The ${what} is on the clipboard. Paste it into the page.`);
    }, { icon: "copies", probe: `copy ${what}` });
    this.elsewhereNote = h("p.upload-note.faint", `If ${site.title} won't let you sign in here, upload from your own browser instead.`);
    this.root = h("div.tool.upload",
      h("div.tool-bar",
        secondary("Hangar", () => this.close(), { icon: "chevronLeft", help: "Back to the Hangar", probe: "upload back" }),
        h("div.tool-title", label("UPLOAD TO"), h("h1.tool-name", site.title.toUpperCase())),
        h("span.spacer"),
        this.status,
        !this.inBrowser && secondary("Load again", () => ask("reloadUpload"), { help: `Loads ${site.title}'s upload page again, from the start. The video goes in again.` }),
      ),
      h("div.upload-body",
        h("div.upload-side",
          h("div.upload-part",
            label("YOUR VIDEO"),
            h("div.upload-chip", {
              draggable: true, probe: "upload video",
              help: `Drag this onto ${site.title}'s page${this.inBrowser ? " in your browser" : " if it didn't go in by itself"}. It goes up by this name, which ${site.title} starts from.`,
              ondragstart: (event) => {
                event.preventDefault();
                ask("dragVideo");
              },
            }, icon(site.shape === "upright" ? "portrait" : "landscape", 14, { class: "file-icon" }),
            h("div.file-words", this.chipName = h("div.file-name", this.video.name), h("div.file-detail", this.inBrowser ? "Drag onto YouTube's page" : "Drag onto the page"))),
            this.videoNote,
            h("div.row.tight", this.inBrowser ? show : this.again),
          ),
          titled && h("div.upload-part", label("TITLE"), this.title, h("div.row.tight", copy(this.title, "title")), this.captionNote),
          h("div.upload-part",
            label(titled ? "DESCRIPTION" : "CAPTION"),
            this.caption,
            h("div.row.tight", copy(this.caption, titled ? "description" : "caption")),
            !titled && this.captionNote,
          ),
          !this.inBrowser && this.keepsLink && h("div.upload-part",
            label("ITS LINK"),
            h("p.upload-note", `Once it's posted, copy its link on ${site.title} and paste it here. It's kept with this run.`),
            ...this.linkBox()),
          h("div.upload-part",
            label("ON EVERY ONE"),
            this.mine,
            h("p.upload-note.faint", "Lines of your own for the end of every description and caption, on every site. They are kept for next time."),
          ),
          !this.inBrowser && h("div.upload-part", label("HOW IT GOES"), h("p.upload-note", howTo[this.id])),
          !this.inBrowser && h("span.spacer"),
          !this.inBrowser && h("div.upload-part",
            this.elsewhereNote,
            plain("Use my browser instead", () => {
              ask("uploadElsewhere", this.title ? this.title.value : this.caption.value);
              this.copied(`The ${this.title ? "title" : "caption"} is on the clipboard, and the video is showing in ${fileBrowser}.`);
            }, { icon: "arrowUpRight", class: "quiet", help: `Opens ${site.title}'s upload page in your own browser, shows the video in ${fileBrowser}, and puts the caption on the clipboard.` }),
          ),
        ),
        this.inBrowser ? this.steps() : this.frame,
      ),
    );
    this.drawVideo();
    fill(document.getElementById("tool"), this.root);
    document.getElementById("stage").setAttribute("inert", "");
    app.tool = this;
    this.offs = [
      hangar.hear("upload", (news) => this.hear(news)),
      // The window is being closed: the page is left first, which may ask the pilot.
      hangar.hear("uploadLeave", () => this.close()),
    ];
    if (this.frame) {
      this.watch = new ResizeObserver(this.onResize);
      this.watch.observe(this.frame);
      window.addEventListener("resize", this.onResize);
    }
    const opened = await ask("openUpload", this.id, this.frame ? this.rect() : null, { file: this.video.file, name: this.words.name, track: this.video.track, run: this.video.run, copy: this.words.title ?? this.words.description });
    if (opened?.name) this.chipName.textContent = opened.name;
    if (opened?.link) this.hear({ site: this.id, link: opened.link, kept: this.keepsLink });
    return opened;
  }

  /** What to do on YouTube, in the pilot's own browser, with what the app has ready for it. */
  steps() {
    const site = this.site;
    const step = (number, title, words, ...more) => h("div.upload-step",
      h("span.guide-number", String(number)),
      h("div.upload-step-words", h("div.guide-title", title), h("p.upload-step-text", words), ...more));
    const steps = [
      ["Open YouTube's upload page", "It opens in your own browser. Sign in there if it asks.",
        h("div.row.tight", primary(`Open ${site.title}`, () => ask("openUploadPage"), { icon: "arrowUpRight", probe: "upload open page", help: "Opens YouTube's upload page in your own browser." }))],
      ["Put your video in", `Drag your video from the left onto YouTube's page. Or press Show in ${fileBrowser}, under it, and drag it from there.`],
      ["Paste the title and the description", "The title is on the clipboard already. Copy the description from the left when YouTube asks for it."],
    ];
    if (this.keepsLink) {
      steps.push(["Bring its link back here", "YouTube shows the video's link while it goes up. Press the copy button beside it and come back here: the link comes in by itself, and is kept with this run.",
        ...this.linkBox()]);
    }
    steps.push(["Publish it", "Choose who can see it, then press Publish, or Save. It carries on going up in your browser, whatever you do here."]);
    return h("div.upload-steps",
      h("div.upload-steps-list",
        h("div.upload-steps-head",
          h("div.card-title", "On YouTube, in your own browser"),
          h("p.upload-step-text", "Google doesn't let anyone sign in to YouTube inside an app, so its upload page opens in your browser, and everything for it is ready here.")),
        steps.map(([title, words, ...more], at) => step(at + 1, title, words, ...more))));
  }

  /** The box for the video's link on the site, with Paste, and a line on how it stands. */
  linkBox() {
    this.linkField = h("input.field.grow", {
      type: "text", key: "link", placeholder: this.site.example, spellcheck: false,
      onchange: () => this.setLink(this.linkField.value),
    });
    this.linkNote = h("p.upload-note");
    this.drawLink();
    return [
      h("div.row.tight", this.linkField, secondary("Paste", async () => this.setLink(await ask("clipboardText")), { probe: "upload paste link", help: `Paste the link you copied on ${this.site.title}.` })),
      this.linkNote,
    ];
  }

  /** The pilot's own lines changed: kept, and put on the end of the words, unless those have
   *  been changed by hand. */
  ownChanged() {
    const before = wordsFor(this.id, this.about, this.own).description;
    this.own = this.mine.value;
    if (app.state) app.state.uploadLines = this.own;
    if (this.caption.value === before) this.caption.value = wordsFor(this.id, this.about, this.own).description;
    clearTimeout(this.keeping);
    this.keeping = setTimeout(() => ask("setUploadLines", this.own), 400);
  }

  /** Where on the window the site's page goes. */
  rect() {
    const at = this.frame.getBoundingClientRect();
    return { x: at.left, y: at.top, width: at.width, height: at.height };
  }

  place() {
    if (app.tool === this && this.frame) ask("placeUpload", this.rect());
  }

  /** The link, pasted or typed: kept when it is a YouTube video's. */
  setLink(text) {
    return ask("setUploadLink", text);
  }

  hear(news) {
    if (news.site !== this.id || app.tool !== this) return;
    if ("loading" in news || "problem" in news) {
      this.status.classList.toggle("warn", Boolean(news.problem));
      this.status.textContent = news.problem ?? (news.loading ? "Loading…" : "");
    }
    // Google turned away a sign-in on the page: the pilot's own browser is the way round it. It
    // stays said, under the button for that, whatever the page does next.
    if (news.google) {
      this.elsewhereNote.textContent = `Google doesn't let anyone sign in inside an app. Log in to ${this.site.title} another way, or upload from your own browser.`;
      this.elsewhereNote.classList.replace("faint", "warn");
    }
    if (news.name) this.chipName.textContent = news.name;
    if ("put" in news) {
      this.put = news.put;
      this.drawVideo();
    }
    if ("link" in news) {
      this.link = news.link;
      this.kept = Boolean(news.kept);
      this.linkProblem = null;
      this.drawLink();
    }
    if (news.linkProblem) {
      this.linkProblem = news.linkProblem;
      this.drawLink();
    }
  }

  drawVideo() {
    if (this.inBrowser) {
      this.videoNote.textContent = `Drag it onto ${this.site.title}'s page in your browser.`;
      return;
    }
    this.again.hidden = !this.put;
    this.videoNote.textContent = this.put
      ? `It's in: ${this.site.title} has it now.`
      : `It goes in by itself once ${this.site.title}'s page asks for a video.`;
    this.videoNote.classList.toggle("good", this.put);
  }

  drawLink() {
    if (!this.keepsLink) return;
    if (document.activeElement !== this.linkField) this.linkField.value = this.link ?? "";
    const works = this.inBrowser ? " It works once you press Publish." : "";
    const [kind, words] = this.linkProblem
      ? ["warn", this.linkProblem]
      : this.link
        ? ["good", `${this.kept ? "Kept with this run." : ""}${works}`.trim()]
        : ["", "Not here yet."];
    this.linkNote.className = `upload-note${kind ? ` ${kind}` : ""}`;
    fill(this.linkNote, kind === "good" && icon("checkCircle", 12), ` ${words}`);
  }

  /** Says, for a moment, what was just done. */
  copied(words) {
    this.captionNote.textContent = words;
    clearTimeout(this.saying);
    this.saying = setTimeout(() => { this.captionNote.textContent = ""; }, 6000);
  }

  /** Leaves the page. If it says it is still busy, as with a video still going up, the pilot is
   *  asked first, since leaving stops it. */
  async close() {
    if (app.tool !== this || this.leaving) return;
    this.leaving = true;
    try {
      // A link typed but not yet taken in is taken in first.
      if (this.keepsLink && document.activeElement === this.linkField) await this.setLink(this.linkField.value);
      const answer = await ask("closeUpload");
      if (answer?.held) {
        const leave = await confirm({
          title: `${this.site.title} is still busy`,
          message: "If your video is still going up, leaving the page now stops it. Stay until the page says it is done, then leave.",
          yes: "Leave anyway", no: "Stay", destructive: true,
        });
        if (!leave) {
          await ask("stayOnUpload");
          return;
        }
        await ask("closeUpload", { force: true });
      }
    } finally {
      this.leaving = false;
    }
    this.finish();
  }

  finish() {
    if (app.tool !== this) return;
    app.tool = null;
    clearTimeout(this.saying);
    if (this.keeping) {
      clearTimeout(this.keeping);
      ask("setUploadLines", this.own);
    }
    for (const off of this.offs) off();
    this.watch?.disconnect();
    window.removeEventListener("resize", this.onResize);
    fill(document.getElementById("tool"));
    document.getElementById("stage").removeAttribute("inert");
    // A link that was kept shows on the run's page, with its views, and in its entry form.
    if (this.video.track) loadTrack(this.video.track).then(render).then(() => loadCounts(this.video.track));
    else render();
    this.after?.();
  }
}

/**
 * Opens a site's upload page for a video. `video` is { file, name, track, run }, `about` what the
 * words that go with it are made from (see `aboutRun`). `after` is done once the page has closed.
 */
export async function openUpload(id, video, about = {}, after = null) {
  if (app.tool || app.editor || app.trackView || !Object.hasOwn(sites, id)) return false;
  const view = new UploadView(id, video, about, after);
  const opened = await view.open();
  if (opened?.problem) {
    view.finish();
    app.notice = opened.problem;
    render();
    return false;
  }
  return true;
}

/** The sites a finished video of a shape can go to, as menu items. */
export function uploadItems(shape, video, about, after = null) {
  return sitesFor(shape).map((id) => ({ title: `Upload to ${sites[id].title}…`, action: () => openUpload(id, video, about, after) }));
}

/** A menu of where a finished video can go, under the button pressed. */
export function uploadMenu(at, shape, video, about, after = null) {
  menu(at, uploadItems(shape, video, about, after));
}

/** Any video, chosen from anywhere, to any of the sites: for the Upload tile on the first screen. */
export async function uploadAnyVideo() {
  if (app.tool || app.editor || app.trackView) return;
  const chosen = await ask("chooseVideoToUpload");
  if (!chosen) return;
  const video = { file: chosen.file, name: chosen.name, track: null, run: null };
  let close = () => {};
  const go = (id) => {
    close();
    // All that is known of a video from anywhere is its name.
    openUpload(id, video, { race: chosen.name.replace(/\.[^.]+$/, "") });
  };
  const choice = (id) => h("button.device", { type: "button", probe: `upload to ${id}`, onclick: () => go(id) },
    h("span.device-name", sites[id].title), h("span.device-detail", `Takes a ${shapeWords[sites[id].shape]}${id === "youtube" ? ", or any other" : ""}`));
  close = showSheet(h("div.alert",
    h("div.alert-title", "Where to?"),
    h("div.alert-message", `Upload ${chosen.name} to:`),
    h("div.devices", Object.keys(sites).map(choice)),
    h("div.alert-buttons", secondary("Cancel", () => close())),
  ), { onEscape: () => close(), small: true });
}
