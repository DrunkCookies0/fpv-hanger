// What the pilot listens to, from their Liked Songs and the artists they play most on Spotify, and
// how near a song is to it: the song itself, an artist of theirs, an artist like theirs, or the
// kind of music they play. Nothing here touches the network, so it can be tested by itself.

/** An artist's name made comparable: "Pegboard Nerds", "PEGBOARD NERDS" and "Pégboard  Nerds" are one. */
export function nameKey(name) {
  return String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A kind of music made comparable: "Drum & Bass", "drum and bass", "DnB" and "drum n bass" are one. */
export function genreKey(genre) {
  return nameKey(genre).replace(/\b(?:dnb|d and b|drum n bass|drum n b)\b/g, "drum and bass").replace(/\bedm\b/g, "electronic");
}

/** True when a credit such as "Pegboard Nerds and Elephante feat Nonono", made comparable, names an
 *  artist: their whole name, word for word, and not part of another word. */
export function names(creditKey, artistKey) {
  return artistKey !== "" && ` ${creditKey} `.includes(` ${artistKey} `);
}

/** Whether two kinds of music are the same kind, or one is a kind of the other ("melodic dubstep" is dubstep). */
export function sameKind(one, other) {
  const a = genreKey(one), b = genreKey(other);
  return a !== "" && b !== "" && (names(a, b) || names(b, a));
}

/**
 * The pilot's taste: { artists, genres, songs, size }. `liked` is their Liked Songs, newest first,
 * each { title, artists: [name] }; `top` the artists they play most, each { name, genres }; `like`
 * artists like theirs, each { name, because } where `because` is the artist of theirs they are like.
 * An artist of theirs counts for more the more of their liked songs are by them.
 */
export function tasteFrom({ liked = [], top = [], like = [] } = {}) {
  const artists = new Map(), genres = new Map(), songs = new Set(), alike = new Map();
  const add = (name, weight) => {
    const key = nameKey(name);
    if (key === "") return;
    const known = artists.get(key) ?? { name, weight: 0 };
    known.weight += weight;
    artists.set(key, known);
  };
  for (const song of liked) {
    for (const name of song.artists ?? []) add(name, 1);
    if (song.title && song.artists?.length > 0) songs.add(`${nameKey(song.artists[0])}\n${nameKey(song.title)}`);
  }
  for (const [index, artist] of top.entries()) {
    add(artist.name, Math.max(1, 5 - index / 5));
    for (const genre of artist.genres ?? []) {
      const key = genreKey(genre);
      if (key !== "") genres.set(key, (genres.get(key) ?? 0) + 1);
    }
  }
  for (const artist of like) {
    const key = nameKey(artist.name);
    if (key !== "" && !artists.has(key) && !alike.has(key)) alike.set(key, { name: artist.name, because: artist.because });
  }
  return { artists, genres, songs, alike, size: liked.length + top.length };
}

/** Adds to a taste the kinds of music its artists make, as a catalog files their songs, so a
 *  catalog's songs by other artists can be matched on kind too. */
export function learnKinds(taste, songs) {
  for (const song of songs) {
    if (!song.genre) continue;
    const credit = nameKey(song.artists?.join(" and ") ?? song.credit);
    for (const key of taste.artists.keys()) {
      if (!names(credit, key)) continue;
      const kind = genreKey(song.genre);
      if (kind !== "") taste.genres.set(kind, (taste.genres.get(kind) ?? 0) + 1);
      break;
    }
  }
  return taste;
}

/**
 * How near a song is to the pilot's taste: { score, text }, the score from 0 to 1 and the words
 * saying why, or a low score and no words when it is nothing like it. `song` has `title`, and
 * `artists` (names) or `credit` (a line naming them), and `genre`.
 */
export function tasteOf(song, taste) {
  if (!taste || taste.size === 0) return { score: 0.3, text: null };
  const artists = song.artists?.length > 0 ? song.artists : [song.credit ?? ""];
  const credit = nameKey(artists.join(" and "));
  if (song.title && taste.songs.has(`${nameKey(artists[0])}\n${nameKey(song.title)}`)) return { score: 1, text: "In your Liked Songs" };
  let best = null;
  for (const [key, artist] of taste.artists) if (names(credit, key) && (!best || artist.weight > best.weight)) best = artist;
  if (best) return { score: Math.min(0.95, 0.8 + 0.03 * best.weight), text: `By ${best.name}, whom you listen to` };
  for (const [key, artist] of taste.alike) if (names(credit, key)) return { score: 0.65, text: `Like ${artist.because}, whom you listen to` };
  if (song.genre) {
    let kind = null;
    for (const [key, count] of taste.genres) if (sameKind(song.genre, key) && (!kind || count > kind.count)) kind = { key, count };
    if (kind) return { score: 0.45 + Math.min(0.1, 0.01 * kind.count), text: `${song.genre}, as you listen to` };
  }
  return { score: 0.2, text: null };
}
