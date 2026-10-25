import { test } from "node:test";
import assert from "node:assert/strict";
import { ncs, ncsSongs, ncsPages, ncsCredit, ncsDate, unescapeHtml, soundScout, soundScoutSong, catalogs } from "../shared/catalogs.js";

// A page of NCS's list as its site writes it, with songs and artists made up.
const row = ({ id, title, artists, genre = "", versions = "Regular", url = "https://example.com/song.mp3", page, moods = [], day = "20 Aug 2026" }) => `
    <tr>
    <td style="width:80px;"><a class="player-play" data-url="${url}" data-artist="${artists.map((name, index) => `<a href='/artist/${index}/${name.toLowerCase()}' style='color:#191d24;'>${name}</a>`).join(", ")}" data-artistraw="${artists.join(", ")}" data-track="${title}" data-cover="https://example.com/cover.jpg" data-preview="55" data-tid="${id}" data-versions="${versions}" data-genre="${genre}"><i class="far fa-play-circle"></i></a></td>
    <td style="width:40px;"><span class="genre" style="background:#ff32f7" title="${genre}"></span></td>
    <td style="width:74px;"><a href="/${page}"><img src="https://example.com/cover.jpg" alt="${title}"></a></td>
    <td style="width:25%;"><a href="/${page}"><p>${title}</p></a><span>${artists.join(", ")}</span></td>
    <td style="width:15%;">${genre ? `<a class="tag" href="/music-search?genre=3">${genre}</a>` : ""}${moods.map((mood, index) => `<a class="tag" style="background-color:#1a692d" href="/music-search?mood=${index + 6}">${mood}</a>`).join("")}</td>
    <td style="width:15%;">${day}</td>
    <td style="width:15%;">${versions}</td>
    <td style="width:15%;"><a class="panel-btn btn black" data-panel="#download" data-tid="${id}"><i class="far fa-arrow-to-bottom"></i>Download</a></td>
    </tr>`;
const pageOf = (rows, last = 3) => `<table>${rows.join("")}</table><ul class="pagination"><li class="page-item"><a class="page-link" href="https://ncs.io/music-search?page=2">2</a></li><li class="page-item"><a class="page-link" href="https://ncs.io/music-search?page=${last}">${last}</a></li></ul>`;

test("catalogs: NCS's list gives each song's artists, kind, moods, day and page, free with credit", () => {
  const html = pageOf([
    row({ id: "t-1", title: "Night Gate", artists: ["Test Nerds", "Elefant Made"], genre: "Drum &amp; Bass", versions: "Regular, Instrumental", page: "NightGate", moods: ["energetic", "dark"] }),
    // A song just out, with no kind yet and nothing to download.
    row({ id: "t-2", title: "Cube &amp; Drop", artists: ["Pipe Theory"], page: "cubedrop", url: "", day: "3 Oct 2026" }),
  ]);
  const songs = ncsSongs(html, "https://example.com/");
  assert.equal(songs.length, 2);
  assert.deepEqual(songs[0], {
    key: "ncs:t-1", source: "ncs", id: "t-1", title: "Night Gate", artists: ["Test Nerds", "Elefant Made"], credit: "Test Nerds, Elefant Made",
    genre: "Drum & Bass", moods: ["energetic", "dark"], tempo: null, length: null, link: "https://example.com/NightGate",
    licence: "free", creditLine: null, released: "2026-08-20", instrumental: true, ready: true,
  });
  assert.equal(songs[1].title, "Cube & Drop");
  assert.equal(songs[1].genre, null);
  assert.equal(songs[1].ready, false);
  assert.equal(songs[1].released, "2026-10-03");
  assert.equal(ncsPages(html), 3);
  assert.equal(ncsPages("<p>no pages</p>"), 1);
  assert.deepEqual(ncsSongs("<html>nothing</html>"), []);
  assert.equal(ncsDate("1 Jan 2025"), "2025-01-01");
  assert.equal(ncsDate("Regular"), null);
  assert.equal(unescapeHtml("A &amp; B &#039;C&#x27; &nbsp;&unknown;"), "A & B 'C'  &unknown;");
});

test("catalogs: the credit NCS gives for a song is kept line by line", () => {
  const info = `<div class="inner"><h5>Night Gate <span>Test Nerds</span></h5><div class="copy"><p><strong>Attribution text to be copied:</strong></p><div class="attribution"><p id="panel-copy">Song: Test Nerds, Elefant Made - Night Gate<br />
Music provided by a made-up catalog<br />
Free Download/Stream: http://example.com/NightGate</p></div></div></div>`;
  assert.equal(ncsCredit(info), "Song: Test Nerds, Elefant Made - Night Gate\nMusic provided by a made-up catalog\nFree Download/Stream: http://example.com/NightGate");
  assert.equal(ncsCredit("<p>nothing</p>"), null);
  assert.equal(ncs.info("t-1", "https://example.com/"), "https://example.com/track/info/t-1");
  assert.equal(ncs.download("t-1", "https://example.com/"), "https://example.com/track/download/t-1");
});

test("catalogs: NCS's list is read a page at a time to its last page, and what went wrong is told", async () => {
  const asked = [];
  const pages = {
    1: pageOf([row({ id: "a", title: "One", artists: ["A"], page: "one" }), row({ id: "b", title: "Two", artists: ["B"], page: "two" })], 3),
    2: pageOf([row({ id: "b", title: "Two", artists: ["B"], page: "two" }), row({ id: "c", title: "Three", artists: ["C"], page: "three" })], 3),
    3: pageOf([row({ id: "d", title: "Four", artists: ["D"], page: "four" })], 3),
  };
  const heard = [];
  const get = async (address) => {
    asked.push(address);
    const number = Number(new URL(address).searchParams.get("page"));
    return { ok: true, status: 200, text: pages[number] ?? "" };
  };
  const read = await ncs.read({ base: "https://example.com/", get, heard: (page, of) => heard.push(`${page}/${of}`), pause: async () => {} });
  assert.deepEqual(read.songs.map((song) => song.id), ["a", "b", "c", "d"]);
  assert.deepEqual(asked, [1, 2, 3].map((number) => `https://example.com/music-search?page=${number}`));
  assert.deepEqual(heard, ["1/3", "2/3", "3/3"]);

  const down = await ncs.read({ get: async () => ({ ok: false, status: 0, text: "" }), pause: async () => {} });
  assert.match(down.problem, /couldn't be reached/);
  const changed = await ncs.read({ get: async () => ({ ok: true, status: 200, text: "<html>a new site</html>" }), pause: async () => {} });
  assert.match(changed.problem, /site has changed/);
  // A page that fails part of the way keeps what was read before it.
  const partway = await ncs.read({ get: async (address) => (address.endsWith("page=1") ? { ok: true, status: 200, text: pages[1] } : { ok: false, status: 503, text: "" }), pause: async () => {} });
  assert.match(partway.problem, /answered 503/);
  assert.equal(partway.songs.length, 2);
});

/** A song as SoundScout's catalog gives it, made up, with the fields it leaves empty when they aren't asked for. */
const track = (fields) => ({ TrackID: "s-1", Title: "Night Gate", Version: "", ArtistsTitle: "Test Nerds & Elefant Made", BPM: 0, Duration: 0, PublicBPM: 174, PublicDuration: 201,
  EffectiveGenrePrimary: "Dance", EffectiveGenreSecondary: "Drum & Bass", IsCreatorFriendly: true, BrandTitle: "Made Up Label", ReleaseDate: "2026-10-09T07:00:59.72Z",
  Tags: ["2010s", "F minor", "energetic", "racing", "fast"], ...fields });

test("catalogs: SoundScout's catalog gives each song's tempo, length, kind and whether it is Copyright Safe", () => {
  assert.deepEqual(soundScoutSong(track({})), {
    key: "soundscout:s-1", source: "soundscout", id: "s-1", title: "Night Gate", artists: ["Test Nerds", "Elefant Made"], credit: "Test Nerds & Elefant Made",
    genre: "Drum & Bass", moods: ["racing", "energetic", "fast"], tags: ["2010s", "F minor", "energetic", "racing", "fast"], tempo: 174, length: 201,
    link: "https://www.soundscout.com/player/music/s-1", licence: "soundscout", creditLine: null, released: "2026-10-09", label: "Made Up Label",
  });
  const other = soundScoutSong(track({ Version: "Extended Mix", IsCreatorFriendly: false, PublicBPM: 0, BPM: 87, EffectiveGenreSecondary: "", Tags: null, ArtistsTitle: "Solo feat. Guest" }));
  assert.equal(other.title, "Night Gate (Extended Mix)");
  assert.equal(other.licence, "notcleared");
  assert.equal(other.tempo, 87);
  assert.equal(other.genre, "Dance");
  assert.deepEqual(other.artists, ["Solo", "Guest"]);
  assert.deepEqual(other.moods, []);
  assert.equal(soundScoutSong(track({ PublicDuration: 0 })).length, null);
  assert.equal(soundScoutSong({ Title: "No id" }), null);
  assert.equal(soundScoutSong(null), null);
  assert.ok(soundScout.page(200, "https://example.com/api/").startsWith("https://example.com/api/catalog?sort=-ReleaseDate&offset=200&limit=100&columns=TrackID&columns=Title"));
  assert.deepEqual(Object.keys(catalogs), ["ncs", "soundscout"]);
});

test("catalogs: SoundScout's catalog is read a hundred songs at a time to its end, and what went wrong is told", async () => {
  const asked = [];
  const all = Array.from({ length: 250 }, (_, index) => track({ TrackID: `s-${index}`, Title: `Song ${index}` }));
  const get = async (address) => {
    asked.push(address);
    const offset = Number(new URL(address).searchParams.get("offset"));
    return { ok: true, status: 200, body: { Data: all.slice(offset, offset + 100), Total: all.length, Limit: 100, Offset: offset } };
  };
  const heard = [];
  const read = await soundScout.read({ base: "https://example.com/api/", get, heard: (page, of) => heard.push(`${page}/${of}`), pause: async () => {} });
  assert.equal(read.songs.length, 250);
  assert.deepEqual(asked.map((address) => new URL(address).searchParams.get("offset")), ["0", "100", "200"]);
  assert.deepEqual(heard, ["1/3", "2/3", "3/3"]);
  const down = await soundScout.read({ get: async () => ({ ok: false, status: 0 }), pause: async () => {} });
  assert.match(down.problem, /couldn't be reached/);
  assert.equal(down.songs, undefined);
  const refused = await soundScout.read({ get: async () => ({ ok: false, status: 403, body: null }), pause: async () => {} });
  assert.match(refused.problem, /answered 403/);
  const changed = await soundScout.read({ get: async () => ({ ok: true, status: 200, body: { items: [] } }), pause: async () => {} });
  assert.match(changed.problem, /catalog has changed/);
  const partway = await soundScout.read({ get: async (address) => (address.includes("offset=0&") ? get(address) : { ok: false, status: 503 }), pause: async () => {} });
  assert.equal(partway.songs.length, 100);
  assert.match(partway.problem, /answered 503/);
});

test("catalogs: SoundScout is opened at the tempos near one", () => {
  assert.equal(soundScout.near(160), "https://www.soundscout.com/player/music?bpm_min=158&bpm_max=162");
  assert.equal(soundScout.near(127.5), "https://www.soundscout.com/player/music?bpm_min=125&bpm_max=130");
});
