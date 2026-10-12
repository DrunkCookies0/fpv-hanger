// Moving the library into another folder, as into Google Drive's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFolder, measure, moveFolder } from "../main/move.js";

/** A small library: a recording, markers, a hidden file the app keeps, an empty folder, and what a
 *  Mac and a half-made file leave behind. */
function aLibrary(root) {
  const track = join(root, "Event", "Track 1");
  mkdirSync(join(track, "Raw files"), { recursive: true });
  mkdirSync(join(track, "csv markers"), { recursive: true });
  mkdirSync(join(track, "landscape"), { recursive: true });
  writeFileSync(join(track, "Raw files", "clip_0001.ts"), Buffer.alloc(300_000, 1));
  writeFileSync(join(track, "csv markers", "clip_0001.csv"), "1,2,3\n");
  writeFileSync(join(track, ".fpv-hangar.json"), "{}");
  writeFileSync(join(root, "dashboard.json"), "{}");
  writeFileSync(join(root, ".DS_Store"), "x");
  writeFileSync(join(track, "Raw files", "clip_0002.ts.part"), "half");
  const then = new Date(2026, 9, 1, 12, 0, 0);
  utimesSync(join(track, "Raw files", "clip_0001.ts"), then, then);
  return then;
}

test("move: what a library holds is counted, with its recordings", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-move-"));
  try {
    aLibrary(join(scratch, "library"));
    assert.deepEqual(await measure(join(scratch, "library")), { files: 4, recordings: 1, bytes: 300_000 + 6 + 2 + 2 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("move: on one disk the folder is renamed, and nothing goes to the Trash", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-move-"));
  try {
    const from = join(scratch, "library"), to = join(scratch, "My Drive", "FPV Hangar Library");
    aLibrary(from);
    mkdirSync(join(scratch, "My Drive"));
    const trashed = [];
    assert.deepEqual(await moveFolder(from, to, { trash: async (path) => trashed.push(path) }), { how: "renamed" });
    assert.ok(!existsSync(from));
    assert.ok(existsSync(join(to, "Event", "Track 1", "Raw files", "clip_0001.ts")));
    assert.deepEqual(trashed, []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("move: copied whole, keeping times and the app's hidden files, and only then put in place", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-move-"));
  try {
    const from = join(scratch, "library"), to = join(scratch, "My Drive", "FPV Hangar Library");
    const then = aLibrary(from);
    mkdirSync(join(scratch, "My Drive"));
    const heard = [];
    await copyFolder(from, to, (share) => heard.push(share));
    const clip = join(to, "Event", "Track 1", "Raw files", "clip_0001.ts");
    assert.deepEqual(readFileSync(clip), readFileSync(join(from, "Event", "Track 1", "Raw files", "clip_0001.ts")));
    assert.equal(Math.round(statSync(clip).mtimeMs / 1000), Math.round(then.getTime() / 1000));
    assert.ok(existsSync(join(to, "Event", "Track 1", ".fpv-hangar.json")));
    assert.ok(existsSync(join(to, "Event", "Track 1", "landscape")));
    assert.ok(!existsSync(join(to, ".DS_Store")));
    assert.deepEqual(readdirSync(join(to, "Event", "Track 1", "Raw files")), ["clip_0001.ts"]);
    assert.deepEqual(readdirSync(join(scratch, "My Drive")), ["FPV Hangar Library"]);
    assert.equal(heard.at(-1), 1);
    assert.ok(heard.every((share, index) => share >= 0 && share <= 1 && (index === 0 || share >= heard[index - 1])));
    // The library it was copied from is left as it was.
    assert.ok(existsSync(join(from, "dashboard.json")));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("move: a copy that can't be finished leaves nothing behind", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-move-"));
  try {
    const to = join(scratch, "My Drive", "FPV Hangar Library");
    mkdirSync(join(scratch, "My Drive"));
    await assert.rejects(copyFolder(join(scratch, "not there"), to));
    assert.deepEqual(readdirSync(join(scratch, "My Drive")), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
