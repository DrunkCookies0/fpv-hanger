import { test } from "node:test";
import assert from "node:assert/strict";
import { sources, licences, lengthWords, tempoWords, librarySong, rank, matching, musicLine } from "../shared/music.js";
import { runShape } from "../shared/fit.js";
import { tasteFrom } from "../shared/taste.js";

// The songs and artists are made up.
const run = runShape([10, 22, 34, 46, 58], { from: 7, to: 66 });
const song = (fields) => ({ key: `ncs:${fields.title}`, source: "ncs", artists: [], credit: "", genre: null, tempo: null, length: null, link: null, licence: "free", creditLine: null, ...fields });

test("music: every song says where it is from and what it may be used for", () => {
  assert.deepEqual(Object.keys(sources), ["mine", "spotify", "ncs", "soundscout"]);
  assert.equal(sources.soundscout.listed, false);
  assert.equal(licences.free.cleared, true);
  assert.equal(licences.soundscout.cleared, true);
  assert.equal(licences.claimed.cleared, false);
  assert.equal(licences.unknown.cleared, null);
  assert.match(licences.claimed.words, /fair use/);
  assert.equal(lengthWords(187.4), "3:07");
  assert.equal(lengthWords(null), null);
  assert.equal(tempoWords(174), "174 BPM");
  assert.equal(tempoWords(127.46), "127.5 BPM");
  assert.equal(tempoWords(0), null);
});

test("music: a song of the pilot's has what the app heard in it, and where it came from when it was added from a catalog", () => {
  const heard = { length: 200, tempo: 160, beatLength: 0.375, firstBeat: 0.1, spots: [{ time: 45, strength: 1 }] };
  const plain = librarySong("My Song.mp3", heard);
  assert.equal(plain.title, "My Song");
  assert.equal(plain.licence, "unknown");
  assert.equal(plain.length, 200);
  assert.deepEqual(plain.drops, [{ time: 45, strength: 1 }]);
  const fromNcs = librarySong("Test Nerds - Night Gate.mp3", null, { source: "ncs", title: "Night Gate", artists: ["Test Nerds"], credit: "Test Nerds", licence: "free", creditLine: "Song: Test Nerds - Night Gate" });
  assert.equal(fromNcs.title, "Night Gate");
  assert.equal(fromNcs.licence, "free");
  assert.equal(fromNcs.from, "ncs");
  assert.equal(fromNcs.heard, false);
  assert.equal(librarySong("x.mp3", null, { licence: "made-up" }).licence, "unknown");
});

test("music: songs are ranked for the run first and the pilot's taste second", () => {
  const taste = tasteFrom({ liked: [{ title: "Old One", artists: ["Test Nerds"] }] });
  const ranked = rank([
    // Lasts the video and every gate lands on a bar line, with its drop on the start gate.
    { ...librarySong("Fits.mp3", { length: 200, tempo: 160, beatLength: 0.375, spots: [{ time: 40, strength: 1 }] }) },
    // By an artist the pilot listens to, but nothing known of its tempo or length.
    song({ title: "Theirs", artists: ["Test Nerds"] }),
    // Nothing like what they listen to, and too short.
    song({ title: "Short", artists: ["Nobody"], tempo: 157, length: 20 }),
  ], run, taste);
  assert.deepEqual(ranked.map((entry) => entry.song.title), ["Fits", "Theirs", "Short"]);
  assert.equal(ranked[1].taste.text, "By Test Nerds, whom you listen to");
  // Without a run there is only the taste.
  const untimed = rank([song({ title: "B", artists: ["Nobody"] }), song({ title: "A", artists: ["Test Nerds"] })], null, taste);
  assert.deepEqual(untimed.map((entry) => entry.song.title), ["A", "B"]);
  assert.equal(untimed[0].fit.score, null);
});

test("music: what is typed finds songs by title, artist or kind, word by word", () => {
  const songs = [song({ title: "Night Gate", credit: "Test Nerds", genre: "Drum & Bass" }), song({ title: "Cube Drop", credit: "Pipe Theory", genre: "Dubstep" })];
  assert.deepEqual(matching(songs, "nerds drum").map((one) => one.title), ["Night Gate"]);
  assert.deepEqual(matching(songs, "DUBSTEP").map((one) => one.title), ["Cube Drop"]);
  assert.equal(matching(songs, "  ").length, 2);
  assert.equal(matching(songs, "house").length, 0);
});

test("music: a video's description has the song's credit when its licence asks for one", () => {
  assert.equal(musicLine("Night Gate.mp3"), "Music: Night Gate");
  assert.equal(musicLine("Night Gate.mp3", " Song: Test Nerds - Night Gate\nMusic provided by a made-up catalog "), "Song: Test Nerds - Night Gate\nMusic provided by a made-up catalog");
  assert.equal(musicLine(""), null);
  assert.equal(musicLine(null), null);
});
