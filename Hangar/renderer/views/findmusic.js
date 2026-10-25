// Find music: songs for the run that is open in the marker editor, from the pilot's own song
// library, their Spotify and NCS, ranked by how well each fits the run's laps and how near it is
// to what the pilot listens to, each saying what it may be used for. SoundScout, Monstercat's, is
// opened on its own site at the tempos that suit the run, and a song bought there is added here.

import { ask, hangar } from "../core.js";
import { h, redraw, icon, primary, secondary, plain } from "../ui.js";
import { showSheet } from "../sheets.js";
import { runShape, bestTempos, lapInMusic } from "../../shared/fit.js";
import { tasteFrom, learnKinds, nameKey } from "../../shared/taste.js";
import { soundScout } from "../../shared/catalogs.js";
import { sources, licences, rank, matching, lengthWords, tempoWords, librarySong } from "../../shared/music.js";

/** How many songs a list shows before Show more. */
const page = 40;
/** What the pilot last chose in the sheet, kept while the app is open. */
const kept = { tab: "best", cleared: false };
/** The sources that are lists of songs here. */
const listed = Object.keys(sources).filter((key) => sources[key].listed !== false);

/** The tabs: every source together, then each by itself. */
const tabs = [["best", "Best for this run"], ...Object.entries(sources).map(([key, source]) => [key, source.name])];

/**
 * Opens Find music for the editor's run. `editor` is the marker editor: the sheet reads the run's
 * gates and stretch from it, and hands it the song the pilot chooses.
 */
export function showFindMusic(editor) {
  const view = new FindMusic(editor);
  const close = showSheet(view.element, { onEscape: () => view.close() });
  // What NCS's list being read again says, while the sheet is up.
  const stop = hangar.hear("musicCatalog", (news) => view.heard(news));
  view.close = () => {
    stop();
    close();
  };
  view.loading = view.load();
  return view;
}

class FindMusic {
  constructor(editor) {
    this.editor = editor;
    this.run = runShape(editor.markers.map((marker) => editor.seconds(marker)), editor.stretch);
    this.tempos = bestTempos(this.run);
    this.typed = "";
    this.shown = page;
    /** Each source as last read: { songs, problem, busy, note }. */
    this.lists = Object.fromEntries(listed.map((key) => [key, { songs: [], problem: null, busy: true, note: null }]));
    this.spotify = { connected: false, needsSetup: true, liked: [], top: [] };
    this.taste = tasteFrom();
    /** Songs being fetched from NCS, by key, and what went wrong with one, by key. */
    this.fetching = new Set();
    this.failed = new Map();
    this.body = h("div.music-body");
    this.element = h("div.music-sheet", { "data-probe": "find music" }, this.body);
    this.draw();
  }

  get open() { return this.body.isConnected; }

  async load() {
    await Promise.all([this.loadMine(), this.loadSpotify(), this.loadCatalog("ncs")]);
  }

  /** The pilot's own songs: what the app has heard in each already, then the rest listened to one at a time. */
  async loadMine() {
    const list = this.lists.mine;
    const { track, name } = this.editor.target;
    const found = await ask("librarySongs", track, name);
    if (!this.open) return;
    list.songs = found.map((one) => librarySong(one.name, one.heard, one.from));
    list.busy = false;
    this.draw();
    const unheard = found.filter((one) => !one.heard);
    for (const [index, one] of unheard.entries()) {
      list.note = `Listening to your songs for their tempo and drops: ${index + 1} of ${unheard.length}…`;
      this.draw();
      const heard = await ask("songAnalysis", track, one.name);
      if (!this.open) return;
      list.songs = list.songs.map((song) => (song.name === one.name ? librarySong(one.name, heard, one.from) : song));
    }
    list.note = null;
    this.draw();
  }

  async loadSpotify(again = false) {
    const list = this.lists.spotify;
    list.busy = true;
    this.draw();
    const read = await ask("spotifyMusic", { again });
    if (!this.open) return;
    this.spotify = read;
    list.songs = read.songs ?? [];
    list.problem = read.problem ?? null;
    list.busy = false;
    this.learn();
    this.draw();
  }

  async loadCatalog(which, again = false) {
    const list = this.lists[which];
    list.busy = true;
    list.problem = null;
    if (!list.note) list.note = `Reading ${sources[which].name}'s list of songs…`;
    this.draw();
    const read = await ask("musicCatalog", which, { again });
    if (!this.open) return;
    list.songs = read.songs ?? [];
    list.problem = read.problem ?? null;
    list.busy = Boolean(read.reading);
    list.note = read.reading ? `Reading ${sources[which].name}'s list again for new songs…` : null;
    this.learn();
    this.draw();
  }

  /** News of a catalog being read: how far it has got, or that it is done, when its songs are asked for again. */
  heard({ which, page: at, pages, done, problem }) {
    const list = this.lists[which];
    if (!list || !this.open) return;
    if (!done) {
      list.busy = true;
      list.note = `Reading ${sources[which].name}'s list of songs: page ${at} of ${pages}…`;
      return this.draw();
    }
    // Read again: its songs are asked for afresh. When that went wrong, the songs it had stay.
    if (!problem) return this.loadCatalog(which);
    list.busy = false;
    list.note = null;
    if (list.songs.length > 0) list.problem = `${problem} These are its songs as they were read before.`;
    this.draw();
  }

  /** The pilot's taste, from their Spotify, with the kinds of music their artists make as the catalogs file them. */
  learn() {
    this.taste = tasteFrom({ liked: this.spotify.liked ?? [], top: this.spotify.top ?? [] });
    learnKinds(this.taste, this.lists.ncs.songs);
  }

  /** The songs the tab shows, ranked. A catalog song the pilot has added already shows as theirs. */
  ranked() {
    const tab = kept.tab;
    if (!this.lists[tab] && tab !== "best") return [];
    const mine = this.lists.mine.songs;
    const have = new Set(mine.filter((song) => song.artists.length > 0).map((song) => `${nameKey(song.artists[0])}\n${nameKey(song.title)}`));
    const pool = tab === "best" ? Object.values(this.lists).flatMap((list) => list.songs) : this.lists[tab].songs;
    const fresh = pool.filter((song) => song.source === "mine" || !have.has(`${nameKey(song.artists[0] ?? "")}\n${nameKey(song.title)}`));
    const allowed = kept.cleared ? fresh.filter((song) => licences[song.licence]?.cleared === true) : fresh;
    return rank(matching(allowed, this.typed), this.run, this.taste);
  }

  draw() {
    const tab = kept.tab;
    const tempos = this.tempos.map((one) => (lapInMusic(one) ? `${tempoWords(one.tempo)} (a lap is ${lapInMusic(one)})` : tempoWords(one.tempo)));
    redraw(this.body,
      h("div.music-head",
        h("div.card-sheet-title", icon("music"), "Find music"),
        h("span.spacer"),
        plain("", () => this.close(), { icon: "close", "aria-label": "Close", help: "Close (Esc)" }),
      ),
      h("p.dim.small", !this.run
        ? "Mark the laps and the songs are ranked for them: the ones that last the whole video with a drop on the start gate, and whose beat your gates land on."
        : tempos.length > 0
          ? `Your gates land on the beat best at ${tempos.join(", or ")}. Songs are ranked by how well they fit your laps, then by how near they are to what you listen to.`
          : "Songs are ranked by whether they last the whole video, how well your gates land on their beat, and how near they are to what you listen to."),
      h("div.row.music-tabs", tabs.map(([key, title]) => h(`button.music-tab${tab === key ? ".on" : ""}`, {
        type: "button", probe: `music tab ${key}`,
        onclick: () => {
          kept.tab = key;
          this.shown = page;
          this.draw();
        },
      }, title, this.lists[key]?.busy && h("span.spinner.small")))),
      tab === "soundscout" ? this.soundScoutPage() : this.listPage(tab),
      h("p.faint.small", "What each song may be used for is what its label or catalog says. A copyright claim goes by the recording, not by how much of it is used or why."),
    );
  }

  listPage(tab) {
    const ranked = this.ranked();
    return [
      h("div.row.music-filters",
        h("input.field.grow", {
          type: "search", key: "music search", value: this.typed, placeholder: "Search by title, artist or kind of music", spellcheck: false,
          oninput: (event) => {
            this.typed = event.target.value;
            this.shown = page;
            this.draw();
          },
        }),
        h("label.check", { help: "Only songs you may put in a video without a copyright claim, on their terms: NCS's with its credit, or SoundScout's with a plan." },
          h("input", { type: "checkbox", checked: kept.cleared, probe: "music cleared", onchange: (event) => {
            kept.cleared = event.target.checked;
            this.shown = page;
            this.draw();
          } }), "Only cleared for videos"),
      ),
      this.sourceNote(tab),
      h("div.music-list", { "data-probe": "music list" },
        ranked.length === 0
          ? h("div.music-empty.dim.small", this.emptyWords(tab))
          : [
            ranked.slice(0, this.shown).map((entry) => this.row(entry)),
            ranked.length > this.shown && h("div.music-more", secondary(`Show ${Math.min(page, ranked.length - this.shown)} more`, () => {
              this.shown += page;
              this.draw();
            })),
          ],
      ),
    ];
  }

  /** SoundScout's own site, at the tempos that suit the run, and a song bought there added here. */
  soundScoutPage() {
    const tempos = this.tempos.length > 0 ? this.tempos.map((one) => one.tempo) : [];
    return h("div.music-list.music-elsewhere", { "data-probe": "music soundscout" },
      h("div.music-elsewhere-body",
        h("p.small", "SoundScout is Monstercat's: Monstercat's music and other labels', for creators, with each song's tempo and whether it is Copyright Safe. Its songs are cleared for your videos with a SoundScout plan, and it has a free trial. FPV Hangar opens it in your browser; its terms don't let other programs read its catalog."),
        tempos.length > 0
          ? [
            h("p.dim.small", "Open it at the tempos your gates land on the beat at. Tick Copyright Safe there for the songs a plan clears."),
            h("div.row.tight.music-tempo-links", tempos.map((tempo) => secondary(`${tempoWords(tempo)}`, () => ask("openLink", soundScout.near(tempo)), { icon: "arrowUpRight", probe: `music soundscout ${tempo}`, help: `SoundScout's music from ${Math.floor(tempo - 2)} to ${Math.ceil(tempo + 2)} BPM` }))),
          ]
          : h("p.dim.small", this.run ? "Your laps don't land on any one tempo's beat, so any tempo will do." : "Mark the laps, and it opens at the tempos your gates land on the beat at."),
        h("div.row.tight",
          secondary("Open SoundScout", () => ask("openLink", soundScout.home), { icon: "arrowUpRight" }),
          primary("Add a song from SoundScout…", () => this.addFile({ source: "soundscout" }), { probe: "music add soundscout", help: "Choose a song you downloaded from SoundScout: it goes into your song library, marked as SoundScout's." }),
        ),
        this.lists.mine.problem && h("p.small.warn", this.lists.mine.problem),
      ),
    );
  }

  /** What to say about a source above its list: still reading, what went wrong, or how to connect. */
  sourceNote(tab) {
    const notes = [];
    const which = tab === "best" ? listed : [tab];
    for (const key of which) {
      const list = this.lists[key];
      if (key === "spotify" && !list.busy && !this.spotify.connected) {
        notes.push(h("div.music-note.row", icon("music", 14), h("span.grow.small", this.spotify.needsSetup
          ? "Connect your Spotify in Pilot & settings, and your Liked Songs, and NCS's songs by the artists and in the kinds of music you listen to, are found for you."
          : "Spotify isn't connected on this computer."), secondary("Pilot & settings", () => {
          this.close();
          this.editor.leaveFor({ name: "settings" });
        }, { probe: "music connect spotify" })));
        continue;
      }
      if (list.problem) {
        notes.push(h("div.music-note.row.warn", icon("warning", 14), h("span.grow.small", list.problem),
          key !== "mine" && secondary("Try again", () => (key === "spotify" ? this.loadSpotify(true) : this.loadCatalog(key, true)))));
      } else if (list.note) {
        notes.push(h("div.music-note.row.dim", h("span.spinner.small"), h("span.grow.small", list.note)));
      }
    }
    if (tab === "best" && this.tempos.length > 0) {
      const tempo = this.tempos[0].tempo;
      notes.push(h("div.music-note.row", icon("music", 14), h("span.grow.small", `SoundScout, Monstercat's, has songs cleared with a plan: open it at ${tempoWords(tempo)}.`),
        secondary("SoundScout", () => ask("openLink", soundScout.near(tempo)), { icon: "arrowUpRight" })));
    }
    return notes.length > 0 ? h("div.music-notes", notes) : null;
  }

  emptyWords(tab) {
    if (this.typed.trim() !== "") return "No song matches that.";
    const list = this.lists[tab];
    if (tab === "best" ? Object.values(this.lists).every((one) => one.busy) : list?.busy) return "Reading the songs…";
    if (tab === "mine") return "Your song library is empty. Add a song from NCS here, or with Add a song… in the Music card.";
    if (tab === "spotify") return this.spotify.connected ? "No songs from Spotify." : "Spotify isn't connected.";
    return kept.cleared ? "No song here is cleared for videos." : "No songs to show.";
  }

  row({ song, fit, taste, score }) {
    const licence = licences[song.licence] ?? licences.unknown;
    const tempo = tempoWords(song.beatLength > 0 ? 60 / song.beatLength : song.tempo) ?? (song.source === "ncs" ? "tempo heard once it's added" : "tempo unknown");
    const facts = [song.genre, ...(song.moods ?? []).slice(0, 2), tempo, lengthWords(song.length)].filter(Boolean).join(" · ");
    const reasons = [taste.text && { good: true, text: taste.text }, ...fit.reasons].filter(Boolean).slice(0, 3);
    const failed = this.failed.get(song.key);
    return h("div.music-row", { "data-probe": `music song ${song.key}` },
      h("div.music-words",
        h("div.row.tight.music-title-row",
          h(`span.music-source.${song.source}`, sources[song.source].short),
          h("span.music-title", song.title),
          song.credit && h("span.music-credit", song.credit),
        ),
        h("div.music-facts", facts),
        reasons.length > 0 && h("div.music-reasons", reasons.map((reason) => h(`span.${reason.good ? "good" : "warn"}`, reason.text))),
        failed && h("div.small.warn", failed),
      ),
      h("div.music-side",
        h("div.row.tight",
          h(`span.licence.${song.licence}`, { help: licence.words }, licence.short),
          fit.score !== null && h("span.music-fit", { help: `How well it fits this run: ${Math.round(score * 100)} out of 100` }, h("span", { style: { width: `${Math.max(4, Math.round(score * 100))}%` } })),
        ),
        h("div.row.tight.music-actions", this.actions(song, fit)),
      ),
    );
  }

  actions(song, fit) {
    const link = (title, address, options = {}) => secondary(title, () => ask("openLink", address), { icon: "arrowUpRight", ...options });
    if (song.source === "mine") {
      return primary("Use it", () => this.use(song.name), {
        probe: `music use ${song.name}`,
        help: fit.place?.drop ? "Make it this run's song, with its drop on the start gate." : "Make it this run's song.",
      });
    }
    if (song.source === "ncs") {
      const getting = this.fetching.has(song.key);
      return [
        song.link && link("NCS", song.link, { help: "Open the song's page on NCS, to hear it." }),
        primary(getting ? "Getting it…" : "Add to my songs", () => this.addFromNcs(song), {
          disabled: getting || song.ready === false, probe: `music get ${song.key}`,
          help: song.ready === false ? "NCS hasn't put this song out to download yet." : "Get it from NCS into your song library, with the credit NCS asks for, which goes into your videos' descriptions. Then it is this run's song.",
        }),
      ];
    }
    return [
      song.link && link("Open in Spotify", song.link),
      secondary("Add the file…", () => this.addFile(song), {
        probe: `music add ${song.key}`,
        help: "Spotify's music can't be saved from Spotify. If you have the song as a file of your own, choose it here. It is still copyrighted.",
      }),
    ];
  }

  /** Makes a song of the pilot's the run's song, with its drop on the start gate when that fits. */
  async use(name) {
    this.close();
    await this.editor.useFoundSong(name);
  }

  /** Gets a song from NCS into the library and makes it the run's song. */
  async addFromNcs(song) {
    this.fetching.add(song.key);
    this.failed.delete(song.key);
    this.draw();
    const added = await ask("addNcsSong", song);
    this.fetching.delete(song.key);
    if (!this.open) return;
    if (added.problem || !added.name) {
      this.failed.set(song.key, added.problem ?? "It couldn't be added.");
      return this.draw();
    }
    this.close();
    await this.editor.useFoundSong(added.name);
  }

  /** Asks for the file of a song from Spotify or SoundScout, keeps it in the library with where it came from, and uses it. */
  async addFile(song) {
    const added = await ask("addFoundSong", song);
    if (added.problem) {
      this.lists.mine.problem = added.problem;
      return this.draw();
    }
    if (!added.name) return;
    this.close();
    await this.editor.useFoundSong(added.name);
  }
}
