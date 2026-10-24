// Songs to choose from for a run's video, from wherever they come: the pilot's own song library,
// their Spotify, and the catalogs of music made free or cleared for videos (NCS and Monstercat).
// Every one is described the same way, says what it may be used for, and is ranked for the run by
// how well it fits it (fit.js) and how near it is to what the pilot listens to (taste.js).
//
// A song, from any of them:
//   { key, source, title, artists: [name], credit, genre, tempo, length, link, licence, creditLine,
//     released, beatLength, drops }
// `credit` is the artists as one line, `tempo` in beats a minute and `length` in seconds (either
// null when it isn't known), `link` the song's own page, `licence` one of `licences`' names, and
// `creditLine` the words its licence asks for in a video's description, if any. Only a song in the
// library has `beatLength` and `drops`, as the app heard them.

import { fitOf } from "./fit.js";
import { tasteOf } from "./taste.js";

/** Where songs come from, in the order they are offered. */
export const sources = {
  mine: { name: "Your songs", short: "Yours" },
  spotify: { name: "Spotify", short: "Spotify" },
  ncs: { name: "NCS", short: "NCS" },
  monstercat: { name: "Monstercat", short: "Monstercat" },
};

/**
 * What a song may be used for in a video. `cleared` is true when it may go in a video posted
 * anywhere without a copyright claim (on the terms it gives), false when it may not, and null
 * when that isn't known. `short` is the badge, `words` the longer telling.
 */
export const licences = {
  free: {
    cleared: true, short: "Free to use",
    words: "Free to use in your videos on YouTube, TikTok, Instagram and Twitch, monetised or not, as long as the credit it asks for is in the description.",
  },
  gold: {
    cleared: true, short: "With Monstercat Gold",
    words: "Cleared for creators who have Monstercat Gold: add your channels to your Gold account and videos with it aren't claimed. Without Gold, YouTube's Content ID claims the video for Monstercat, which takes its ad money or blocks it in some countries.",
  },
  claimed: {
    cleared: false, short: "Copyrighted",
    words: "Owned by its label, with no licence for videos. YouTube's Content ID, and TikTok's and Instagram's own checks, recognise it: expect the video to be claimed, muted or blocked in some countries. Copyright checks don't weigh fair use.",
  },
  no: {
    cleared: false, short: "Not cleared for videos",
    words: "Monstercat doesn't clear this song for creators, even with Gold. A video with it gets claimed.",
  },
  unknown: {
    cleared: null, short: "Licence unknown",
    words: "FPV Hangar doesn't know where this song came from. Use music you have the right to use, or one from NCS or Monstercat.",
  },
};

/** A length in minutes and seconds: "3:07". */
export function lengthWords(seconds) {
  if (!(seconds > 0)) return null;
  const whole = Math.round(seconds);
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A tempo as a song list gives it: "174 BPM", or "127.5 BPM". */
export function tempoWords(tempo) {
  if (!(tempo > 0)) return null;
  const rounded = Math.round(tempo * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} BPM`;
}

/** A song's own song library entry, with what the app heard in it. `from` is what was kept about
 *  where it came from when it was added from a catalog, if it was. */
export function librarySong(name, heard, from = null) {
  const title = from?.title ?? name.replace(/\.[a-z0-9]{2,4}$/i, "");
  return {
    key: `mine:${name}`, source: "mine", name, title,
    artists: from?.artists ?? [], credit: from?.credit ?? (from?.artists ?? []).join(", "),
    genre: from?.genre ?? null, tempo: heard?.tempo ?? from?.tempo ?? null, length: heard?.length ?? null,
    link: from?.link ?? null, licence: from?.licence && licences[from.licence] ? from.licence : "unknown", creditLine: from?.creditLine ?? null,
    beatLength: heard?.beatLength ?? null, drops: heard?.spots ?? [], heard: Boolean(heard), from: from?.source ?? null,
  };
}

/**
 * The songs ranked for a run, best first: each { song, fit, taste, score }. With a run (fit.js'
 * `runShape`) the fit counts for more than the taste; without one there is only the taste. A song
 * already in the library counts as somewhat to the pilot's taste: they chose it.
 */
export function rank(songs, run, taste) {
  const ranked = songs.map((song) => {
    const fit = fitOf(song, run);
    const liking = song.source === "mine" ? { score: 0.6, text: null } : tasteOf(song, taste);
    const score = fit.score === null ? liking.score : 0.6 * fit.score + 0.4 * liking.score;
    return { song, fit, taste: liking, score };
  });
  return ranked.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
}

/** Songs that match what is typed: every word of it is in the title, the artists or the kind of music. */
export function matching(songs, typed) {
  const words = String(typed ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return songs;
  return songs.filter((song) => {
    const said = `${song.title} ${song.credit} ${song.genre ?? ""}`.toLowerCase();
    return words.every((word) => said.includes(word));
  });
}

/**
 * What to put in a video's description for its song: the credit its licence asks for when there
 * is one, or "Music: <its name>". Null with no song.
 */
export function musicLine(song, credit = null) {
  if (credit) return String(credit).trim();
  return song ? `Music: ${String(song).replace(/\.[a-z0-9]{2,4}$/i, "")}` : null;
}
