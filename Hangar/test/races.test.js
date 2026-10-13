// Groups and their races: a club made, its races named and dated, and a race moved into another
// group with everything that was remembered about it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../main/library.js";

function scratch() {
  const folder = mkdtempSync(join(tmpdir(), "hangar-races-"));
  const root = join(folder, "library");
  const open = () => new Library(root, { ffmpeg: null, cache: join(folder, "cache"), trash: async () => {}, fetch: async () => ({ ok: false, status: 404, text: async () => "" }) });
  return { root, open, done: () => rmSync(folder, { recursive: true, force: true }) };
}

test("races: a group starts empty, and each race has its own name and date", () => {
  const { root, open, done } = scratch();
  try {
    const library = open();
    assert.deepEqual(library.newEvent("Circle City FPV"), { event: "Circle City FPV" });
    assert.deepEqual(library.events.map((event) => [event.folder, event.tracks]), [["Circle City FPV", []]]);
    assert.match(library.newEvent("circle city fpv").problem, /already have a group called/);

    assert.deepEqual(library.newRace("Circle City FPV", " Zero Traction Open Whoop Race #5 ", "2026-09-21"), { track: "Circle City FPV/Zero Traction Open Whoop Race #5" });
    assert.ok(existsSync(join(root, "Circle City FPV", "Zero Traction Open Whoop Race #5", "Raw files")));
    assert.equal(library.state("Circle City FPV/Zero Traction Open Whoop Race #5").date, "2026-09-21");
    assert.match(library.newRace("Circle City FPV", "Zero Traction Open Whoop Race #5", "").problem, /already a race called/);
    assert.match(library.newRace("Circle City FPV", "", "").problem, /Give the race a name/);
    assert.match(library.newRace("Circle City FPV", "Half/Half", "").problem, /can't have any of/);
    assert.match(library.newRace("Circle City FPV", "Spring Cup", "2026-02-30").problem, /isn't a date/);

    // Races go in the order they were flown, and one with no date after them.
    library.newRace("Circle City FPV", "Spring Cup", "2026-04-11");
    library.newRace("Circle City FPV", "A practice", "");
    assert.deepEqual(library.events[0].tracks, ["Circle City FPV/Spring Cup", "Circle City FPV/Zero Traction Open Whoop Race #5", "Circle City FPV/A practice"]);
    // And stay so when the library is read again.
    assert.deepEqual(open().events[0].tracks, library.events[0].tracks);
  } finally {
    done();
  }
});

test("races: a race moves into another group, renamed and dated, keeping what was remembered", () => {
  const { root, open, done } = scratch();
  try {
    const library = open();
    // A race that was made as its own event, the way the app used to: an event with a Track 1.
    library.newEvent("Zero Traction Open Whoop Race #5");
    library.newRace("Zero Traction Open Whoop Race #5", "Track 1", "");
    const old = "Zero Traction Open Whoop Race #5/Track 1";
    writeFileSync(join(root, ...old.split("/"), "csv markers", "MOV250921-120701-000118F.csv"), "markers\n");
    library.update(old, (state) => { state.edits = { "MOV250921-120701-000118F": { song: "Song.mp3", songStart: 3.5 } }; });

    library.newEvent("Circle City FPV");
    const moved = library.moveRace(old, { name: "Zero Traction Open Whoop Race #5", event: "Circle City FPV", date: "2026-09-21" });
    const now = "Circle City FPV/Zero Traction Open Whoop Race #5";
    assert.deepEqual(moved, { track: now });
    assert.ok(existsSync(join(root, ...now.split("/"), "csv markers", "MOV250921-120701-000118F.csv")));
    assert.ok(!existsSync(join(root, ...old.split("/"))));
    assert.deepEqual(library.state(now).edits, { "MOV250921-120701-000118F": { song: "Song.mp3", songStart: 3.5 } });
    assert.equal(library.state(now).date, "2026-09-21");
    assert.ok(!library.tracks.includes(old));
    // The group it came from is left, empty, to be deleted.
    assert.deepEqual(library.events.find((event) => event.folder === "Zero Traction Open Whoop Race #5")?.tracks, []);
    // What was remembered is in the file too, under the race's new place.
    assert.deepEqual(open().state(now).edits, library.state(now).edits);

    // A new date alone, and a name that differs only in its capitals.
    assert.deepEqual(library.moveRace(now, { name: "Zero Traction Open Whoop Race #5", event: "Circle City FPV", date: "" }), { track: now });
    assert.equal(library.state(now).date, undefined);
    const lower = "Circle City FPV/zero traction open whoop race #5";
    assert.deepEqual(library.moveRace(now, { name: "zero traction open whoop race #5", event: "Circle City FPV", date: "" }), { track: lower });
    assert.deepEqual(library.state(lower).edits, { "MOV250921-120701-000118F": { song: "Song.mp3", songStart: 3.5 } });

    // Not over another race.
    library.newRace("Circle City FPV", "Spring Cup", "");
    assert.match(library.moveRace(lower, { name: "Spring Cup", event: "Circle City FPV", date: "" }).problem, /already a race called/);
  } finally {
    done();
  }
});

test("races: the season's tracks keep their names and their place", () => {
  const { root, open, done } = scratch();
  try {
    mkdirSync(join(root, "RaceGOW6", "Track 1", "Raw files"), { recursive: true });
    const library = open();
    library.newEvent("Circle City FPV");
    assert.match(library.moveRace("RaceGOW6/Track 1", { name: "Mine", event: "Circle City FPV", date: "" }).problem, /keeps its name/);
    library.newRace("Circle City FPV", "Spring Cup", "");
    assert.match(library.moveRace("Circle City FPV/Spring Cup", { name: "Spring Cup", event: "RaceGOW6", date: "" }).problem, /come from the season/);
    assert.match(library.newRace("RaceGOW6", "Track 9", "").problem, /come from the season/);
  } finally {
    done();
  }
});
