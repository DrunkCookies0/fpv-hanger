// One library opened on two computers, each saving the files that hold what the app remembers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { merge, same } from "../shared/merge.js";
import { Library } from "../main/library.js";

test("merge: what only one side changed is kept", () => {
  const base = { email: "a@example.com", tracks: { "E/Track 1": { formURL: "one" } } };
  const ours = { email: "a@example.com", tracks: { "E/Track 1": { formURL: "one" }, "E/Track 2": { formURL: "two" } } };
  const theirs = { email: "b@example.com", tracks: { "E/Track 1": { formURL: "one" } } };
  assert.deepEqual(merge(base, ours, theirs), { email: "b@example.com", tracks: { "E/Track 1": { formURL: "one" }, "E/Track 2": { formURL: "two" } } });
  // Nothing changed on one side: the other is taken whole.
  assert.deepEqual(merge(base, base, theirs), theirs);
  assert.deepEqual(merge(base, ours, base), ours);
});

test("merge: two computers working on different runs of one track each keep theirs", () => {
  const base = { tracks: { T: { edits: { run1: { song: "A" }, run2: { song: "B" } } } } };
  const ours = { tracks: { T: { edits: { run1: { song: "A", songStart: 3.5 }, run2: { song: "B" } } } } };
  const theirs = { tracks: { T: { edits: { run1: { song: "A" }, run2: { song: "C" } } } } };
  assert.deepEqual(merge(base, ours, theirs), { tracks: { T: { edits: { run1: { song: "A", songStart: 3.5 }, run2: { song: "C" } } } } });
});

test("merge: the same thing changed on both is this computer's, and a list counts as one thing", () => {
  assert.deepEqual(merge({ corner: "tr" }, { corner: "bl" }, { corner: "tl" }), { corner: "bl" });
  assert.deepEqual(merge({ marks: [1, 2] }, { marks: [1, 2, 3] }, { marks: [1, 2, 4] }), { marks: [1, 2, 3] });
  assert.deepEqual(merge({ marks: [1, 2] }, { marks: [1, 2] }, { marks: [2] }), { marks: [2] });
});

test("merge: something removed on one side and left alone on the other goes", () => {
  const base = { tracks: { a: { formURL: "x" }, b: { formURL: "y" } } };
  assert.deepEqual(merge(base, { tracks: { b: { formURL: "y" } } }, base), { tracks: { b: { formURL: "y" } } });
  assert.deepEqual(merge(base, base, { tracks: { a: { formURL: "x" } } }), { tracks: { a: { formURL: "x" } } });
  // Removed here and changed there: what was done here stands.
  assert.deepEqual(merge(base, { tracks: { b: { formURL: "y" } } }, { tracks: { a: { formURL: "z" }, b: { formURL: "y" } } }), { tracks: { b: { formURL: "y" } } });
});

test("merge: the order of names doesn't make two things different", () => {
  assert.ok(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!same([1, 2], [2, 1]));
  assert.ok(!same({ a: null }, { a: {} }));
});

test("library: two computers saving one library each keep what the other did", () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-merge-"));
  const root = join(scratch, "library");
  const open = () => new Library(root, { ffmpeg: null, cache: join(scratch, "cache"), trash: async () => {}, fetch: async () => ({ ok: false, status: 404, text: async () => "" }) });
  const stored = () => JSON.parse(readFileSync(join(root, "dashboard.json"), "utf8"));
  try {
    const mac = open();
    mac.update("E/Track 1", (state) => { state.formURL = "https://example.com/form"; });
    mac.settings.pilot = "TEST PILOT";
    mac.saveSettings();

    // The desktop opens the same library, as it is in Drive, and both carry on without looking again.
    const desktop = open();
    assert.equal(desktop.state("E/Track 1").formURL, "https://example.com/form");
    desktop.update("E/Track 1", (state) => { state.edits = { run1: { song: "Song.mp3", songStart: 12.25 } }; });
    mac.update("E/Track 1", (state) => { state.submissions = [{ run: "run2", time: 28.316 }]; });
    mac.store.email = "pilot@example.com";
    mac.saveStore();
    desktop.update("E/Track 2", (state) => { state.formURL = "https://example.com/form2"; });

    const kept = stored();
    assert.deepEqual(kept.tracks["E/Track 1"].edits, { run1: { song: "Song.mp3", songStart: 12.25 } });
    assert.deepEqual(kept.tracks["E/Track 1"].submissions, [{ run: "run2", time: 28.316 }]);
    assert.equal(kept.tracks["E/Track 1"].formURL, "https://example.com/form");
    assert.equal(kept.tracks["E/Track 2"].formURL, "https://example.com/form2");
    assert.equal(kept.email, "pilot@example.com");
    // What the desktop holds now has what the Mac did, without having looked again.
    assert.equal(desktop.store.email, "pilot@example.com");

    // The pilot's settings the same way: the timer's corner on one, the name kept from the other.
    desktop.settings.corner = "bl";
    desktop.saveSettings();
    assert.deepEqual([JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).pilot, desktop.settings.corner], ["TEST PILOT", "bl"]);

    // A file that can't be read just now, as when Drive is part way through bringing it down, is
    // written whole rather than put together with nothing.
    writeFileSync(join(root, "dashboard.json"), '{"tracks": {"E/Tr');
    mac.update("E/Track 1", (state) => { state.formURL = "https://example.com/form-again"; });
    assert.equal(stored().tracks["E/Track 1"].formURL, "https://example.com/form-again");
    assert.deepEqual(stored().tracks["E/Track 1"].edits, { run1: { song: "Song.mp3", songStart: 12.25 } });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
