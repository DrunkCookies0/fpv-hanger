import { test } from "node:test";
import assert from "node:assert/strict";
import { nameKey, genreKey, names, sameKind, tasteFrom, learnKinds, tasteOf } from "../shared/taste.js";

// The artists are made up.
const liked = [
  { title: "Night Gate", artists: ["Test Nerds", "Elefant Made"] },
  { title: "Whoop Line", artists: ["Test Nerds"] },
  { title: "Cube Drop", artists: ["Pipe Theory"] },
];
const top = [{ name: "Test Nerds", genres: ["complextro", "drum and bass"] }, { name: "Lowpass Club", genres: ["melodic dubstep"] }];

test("taste: names and kinds of music are compared as words, whatever their marks and case", () => {
  assert.equal(nameKey("Pégboard  NERDS!"), "pegboard nerds");
  assert.equal(nameKey("Above & Beyond"), "above and beyond");
  assert.equal(genreKey("Drum & Bass"), "drum and bass");
  assert.equal(genreKey("DnB"), "drum and bass");
  assert.equal(genreKey("EDM"), "electronic");
  assert.ok(names("test nerds and elefant made feat nobody", "test nerds"));
  assert.ok(!names("test nerdsy", "test nerds"));
  assert.ok(!names("anything", ""));
  assert.ok(sameKind("Melodic Dubstep", "dubstep"));
  assert.ok(sameKind("dubstep", "Melodic Dubstep"));
  assert.ok(sameKind("Drum & Bass", "drum and bass"));
  assert.ok(!sameKind("Drum & Bass", "Bass House"));
  assert.ok(!sameKind("", "house"));
});

test("taste: a liked song, then an artist of the pilot's, then one like theirs, then their kind of music", () => {
  const taste = tasteFrom({ liked, top, like: [{ name: "Similar Sound", because: "Pipe Theory" }, { name: "Test Nerds", because: "Pipe Theory" }] });
  assert.equal(taste.size, 5);
  // Two liked songs and the top of the list.
  assert.equal(taste.artists.get("test nerds").weight, 7);
  assert.deepEqual(tasteOf({ title: "WHOOP LINE", artists: ["Test Nerds"] }, taste), { score: 1, text: "In your Liked Songs" });
  const byThem = tasteOf({ title: "Something New", credit: "Test Nerds & Someone Else" }, taste);
  assert.equal(byThem.text, "By Test Nerds, whom you listen to");
  assert.ok(byThem.score > 0.8 && byThem.score <= 0.95);
  // An artist of their own isn't counted again as one like theirs.
  assert.equal(taste.alike.has("test nerds"), false);
  assert.deepEqual(tasteOf({ title: "Other", artists: ["Similar Sound"] }, taste), { score: 0.65, text: "Like Pipe Theory, whom you listen to" });
  const kind = tasteOf({ title: "Other", artists: ["Nobody Known"], genre: "Dubstep" }, taste);
  assert.equal(kind.text, "Dubstep, as you listen to");
  assert.ok(kind.score >= 0.45 && kind.score < 0.65);
  assert.deepEqual(tasteOf({ title: "Other", artists: ["Nobody Known"], genre: "Hardstyle" }, taste), { score: 0.2, text: null });
});

test("taste: with nothing to go on, every song is the same, and a catalog teaches the kinds an artist makes", () => {
  assert.deepEqual(tasteOf({ title: "Any", artists: ["Anyone"] }, tasteFrom()), { score: 0.3, text: null });
  assert.deepEqual(tasteOf({ title: "Any", artists: ["Anyone"] }, null), { score: 0.3, text: null });
  const taste = tasteFrom({ liked });
  assert.equal(taste.genres.size, 0);
  learnKinds(taste, [{ title: "A", artists: ["Pipe Theory"], genre: "Drumstep" }, { title: "B", artists: ["Stranger"], genre: "House" }, { title: "C", credit: "Test Nerds", genre: null }]);
  assert.deepEqual([...taste.genres.keys()], ["drumstep"]);
  assert.equal(tasteOf({ title: "D", artists: ["Stranger"], genre: "Drumstep" }, taste).text, "Drumstep, as you listen to");
});
