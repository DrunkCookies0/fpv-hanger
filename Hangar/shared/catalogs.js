// The music made free or cleared for videos that Find music offers besides the pilot's own.
//
// NCS (NoCopyrightSounds) puts its whole catalog on its site, free for creators' videos with a
// credit in the description: FPV Hangar reads its list of songs, a page at a time, and keeps it for
// a week. Its list says each song's artists, kind and moods, but not its tempo or length: those are
// heard once the song is added. A song is added from NCS's own download, with the credit NCS gives
// for it.
//
// SoundScout, Monstercat's (it was Monstercat Gold), licenses Monstercat's music and other labels'
// to creators with a plan, and says of each song whether it is Copyright Safe. FPV Hangar reads
// its catalog from the address SoundScout's own player reads it from, which anyone can read
// without signing in, a page at a time, and keeps it for a week. That address isn't offered to
// other programs: SoundScout's terms ask for its written permission to read the catalog by a
// program, and it can change or close it without warning. FPV Hangar never plays or fetches
// SoundScout's music. A song bought there is downloaded on SoundScout's site and added as a file.
//
// Nothing here touches the network, so it can be tested by itself: `get` is handed in.

/** What NCS's pages say in place of the characters HTML keeps for itself. */
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", ndash: "–", mdash: "—" };
export function unescapeHtml(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return entities[name.toLowerCase()] ?? whole;
  });
}

/** The attributes of an HTML tag, by name. */
function attributes(tag) {
  const found = {};
  for (const match of tag.matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/gi)) found[match[1].toLowerCase()] = unescapeHtml(match[2]);
  return found;
}

/** The artists in a line such as "Rival, Biometrix", each by itself. */
const artistsOf = (line) => String(line ?? "").split(/\s*,\s*/).map((one) => one.trim()).filter(Boolean);

/** NCS's own date, "20 Aug 2026", as 2026-08-20, or null. */
export function ncsDate(text) {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const match = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/i.exec(String(text ?? "").trim());
  const month = match ? months.indexOf(match[2].toLowerCase()) : -1;
  return month < 0 ? null : `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

/** The songs on a page of NCS's list, as Find music lists them (see shared/music.js). */
export function ncsSongs(html, base = ncs.base) {
  const songs = [];
  for (const row of String(html ?? "").split(/<tr[\s>]/i).slice(1)) {
    // A tag, read to its end: some of its values have HTML of their own in them, with ">" in it.
    const play = [...row.matchAll(/<a\s(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].find((tag) => /\bclass="player-play"/.test(tag[0]));
    if (!play) continue;
    const facts = attributes(play[0]);
    const id = facts["data-tid"], title = facts["data-track"]?.trim();
    if (!id || !title) continue;
    const artists = artistsOf(facts["data-artistraw"]);
    // The song's own page: the first link in the row that is to a page of its own, not an artist's or a search.
    const page = [...row.matchAll(/href="\/([A-Za-z0-9_-]+)"/g)].map((match) => match[1]).find((path) => !["artist", "music-search", "track"].includes(path));
    const moods = [...row.matchAll(/href="\/music-search\?mood=\d+"[^>]*>([^<]+)<\/a>/g)].map((match) => unescapeHtml(match[1]).trim());
    const day = [...row.matchAll(/<td[^>]*>\s*([^<]+?)\s*<\/td>/g)].map((match) => ncsDate(match[1])).find(Boolean) ?? null;
    songs.push({
      key: `ncs:${id}`, source: "ncs", id, title, artists, credit: artists.join(", "),
      genre: facts["data-genre"]?.trim() || null, moods, tempo: null, length: null,
      link: page ? `${base}${page}` : `${base}music-search?q=${encodeURIComponent(title)}`,
      licence: "free", creditLine: null, released: day,
      instrumental: /instrumental/i.test(facts["data-versions"] ?? ""),
      // A song NCS has listed before its release has nothing to download yet.
      ready: (facts["data-url"] ?? "") !== "",
    });
  }
  return songs;
}

/** How many pages NCS's list has, from the links to them at the foot of a page. */
export function ncsPages(html) {
  let most = 1;
  for (const match of String(html ?? "").matchAll(/music-search\?(?:[^"]*&(?:amp;)?)?page=(\d+)/g)) most = Math.max(most, Number(match[1]));
  return most;
}

/** The credit NCS asks for, as it gives it beside a song's download: its lines, or null. */
export function ncsCredit(html) {
  const match = /<p[^>]*id="panel-copy"[^>]*>([\s\S]*?)<\/p>/i.exec(String(html ?? ""));
  if (!match) return null;
  const lines = unescapeHtml(match[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** At most how many pages of NCS's list are read: more than it has, so all of it, but not without end. */
const mostPages = 200;

export const ncs = {
  name: "NCS",
  base: "https://ncs.io/",
  /** How long its list as read is good for. It brings out a few songs a week. */
  fresh: 7 * 24 * 60 * 60 * 1000,
  /** The address of a page of its list, newest first. */
  page: (number, base = ncs.base) => `${base}music-search?page=${number}`,
  /** Where a song's credit is, and its download. */
  info: (id, base = ncs.base) => `${base}track/info/${encodeURIComponent(id)}`,
  download: (id, base = ncs.base) => `${base}track/download/${encodeURIComponent(id)}`,

  /**
   * Reads NCS's whole list, a page at a time with a pause between, newest first: { songs } or
   * { problem }, with what was read before the problem when some was. `get(address)` answers
   * { ok, status, text }; `heard(page, pages)` is told how far it has got.
   */
  async read({ base = ncs.base, get, heard = () => {}, pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)) }) {
    const songs = new Map();
    let pages = 1;
    for (let number = 1; number <= Math.min(pages, mostPages); number += 1) {
      if (number > 1) await pause(300);
      const answer = await get(ncs.page(number, base));
      const problem = answer.status === 0 ? "NCS couldn't be reached. Check the connection." : !answer.ok ? `NCS didn't give its list of songs (it answered ${answer.status}).` : null;
      const found = problem ? [] : ncsSongs(answer.text, base);
      if (!problem && found.length === 0 && number === 1) return { problem: "NCS's site has changed, and FPV Hangar can't find the songs on it. An update to FPV Hangar will put that right." };
      if (problem) return { problem, songs: [...songs.values()] };
      if (number === 1) pages = ncsPages(answer.text);
      for (const song of found) if (!songs.has(song.id)) songs.set(song.id, song);
      heard(number, Math.min(pages, mostPages));
      if (found.length === 0) break;
    }
    return { songs: [...songs.values()] };
  },
};

/** The tags SoundScout gives a song that say something about how it feels, in the order they are shown. */
const feelings = ["racing", "extreme sports", "energetic", "aggressive", "epic", "fast", "hectic", "dark", "uplifting", "intense", "driving", "propulsive"];

/** A song from SoundScout's catalog, as Find music lists it (see shared/music.js). Null for anything that isn't a song. */
export function soundScoutSong(track) {
  if (typeof track?.TrackID !== "string" || track.TrackID === "" || typeof track.Title !== "string" || track.Title.trim() === "") return null;
  const credit = String(track.ArtistsTitle ?? "").trim();
  const number = (...values) => values.find((value) => Number.isFinite(value) && value > 0) ?? null;
  const tags = Array.isArray(track.Tags) ? track.Tags.filter((tag) => typeof tag === "string") : [];
  return {
    key: `soundscout:${track.TrackID}`, source: "soundscout", id: track.TrackID,
    title: track.Version ? `${track.Title.trim()} (${String(track.Version).trim()})` : track.Title.trim(),
    artists: credit.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bvs\.?)\s*/i).map((one) => one.trim()).filter(Boolean), credit,
    // The second kind is the closer one: "Drum & Bass" where the first is "Dance".
    genre: String(track.EffectiveGenreSecondary || track.EffectiveGenrePrimary || "").trim() || null,
    moods: feelings.filter((feeling) => tags.includes(feeling)), tags,
    tempo: number(track.PublicBPM, track.BPM), length: number(track.PublicDuration, track.Duration),
    link: soundScout.track(track.TrackID),
    licence: track.IsCreatorFriendly === true ? "soundscout" : "notcleared", creditLine: null,
    released: typeof track.ReleaseDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(track.ReleaseDate) ? track.ReleaseDate.slice(0, 10) : null,
    label: typeof track.BrandTitle === "string" && track.BrandTitle !== "" ? track.BrandTitle : null,
  };
}

export const soundScout = {
  name: "SoundScout",
  base: "https://www.soundscout.com/api/",
  home: "https://www.soundscout.com/",
  /** How long its catalog as read is good for. */
  fresh: 7 * 24 * 60 * 60 * 1000,
  /** How many songs a page of its catalog has: as many as its own player asks for. */
  perPage: 100,
  /** What is asked of each song, so the pages are no bigger than they need be. */
  columns: ["TrackID", "Title", "Version", "ArtistsTitle", "PublicDuration", "PublicBPM", "EffectiveGenrePrimary", "EffectiveGenreSecondary", "IsCreatorFriendly", "BrandTitle", "ReleaseDate", "Tags"],
  /** A page of its catalog, newest first. */
  page: (offset, base = soundScout.base) => `${base}catalog?sort=-ReleaseDate&offset=${offset}&limit=${soundScout.perPage}&${soundScout.columns.map((column) => `columns=${column}`).join("&")}`,
  /** A song's own page on SoundScout, where it is heard and, with a plan, downloaded. */
  track: (id) => `https://www.soundscout.com/player/music/${encodeURIComponent(id)}`,
  /** SoundScout's music, newest first, at tempos near one: within 2 beats a minute either side. */
  near: (tempo) => `https://www.soundscout.com/player/music?bpm_min=${Math.floor(tempo - 2)}&bpm_max=${Math.ceil(tempo + 2)}`,

  /**
   * Reads SoundScout's catalog, a page at a time with a pause between, newest first: { songs } or
   * { problem }, with what was read before the problem when some was. `get(address)` answers
   * { ok, status, body }; `heard(page, pages)` is told how far it has got.
   */
  async read({ base = soundScout.base, get, heard = () => {}, pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)) }) {
    const songs = new Map();
    let pages = 1;
    for (let number = 1; number <= Math.min(pages, mostPages); number += 1) {
      if (number > 1) await pause(300);
      const answer = await get(soundScout.page((number - 1) * soundScout.perPage, base));
      const problem = answer.status === 0 ? "SoundScout couldn't be reached. Check the connection."
        : !answer.ok ? `SoundScout didn't give its catalog (it answered ${answer.status}). It may have changed the way its own player reads it.`
        : !Array.isArray(answer.body?.Data) ? "SoundScout's catalog has changed, and FPV Hangar can't read its songs. An update to FPV Hangar may put that right."
        : null;
      if (problem) return songs.size > 0 ? { problem, songs: [...songs.values()] } : { problem };
      if (number === 1) pages = Math.ceil((Number(answer.body.Total) || 0) / soundScout.perPage);
      const found = answer.body.Data.map(soundScoutSong).filter(Boolean);
      for (const song of found) if (!songs.has(song.id)) songs.set(song.id, song);
      heard(number, Math.min(pages, mostPages));
      if (found.length === 0) break;
    }
    return { songs: [...songs.values()] };
  },
};

/** The catalogs FPV Hangar reads for itself, by the name Find music knows them by. */
export const catalogs = { ncs, soundscout: soundScout };
