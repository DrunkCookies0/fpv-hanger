import { test } from "node:test";
import assert from "node:assert/strict";
import { belongs, copyRoot, driveAccount, isDue, isWithin, kindOf, plan, whyNot } from "../shared/drive.js";

test("drive: the copy goes in a folder of the app's name inside the one chosen", () => {
  assert.equal(copyRoot("/Users/pilot/Library/CloudStorage/GoogleDrive-pilot@example.com/My Drive"), "/Users/pilot/Library/CloudStorage/GoogleDrive-pilot@example.com/My Drive/FPV Hangar");
  assert.equal(copyRoot("G:\\My Drive", (a, b) => `${a}\\${b}`), "G:\\My Drive\\FPV Hangar");
  // A folder that is already the copy isn't given another inside it.
  assert.equal(copyRoot("/Volumes/Disk/FPV Hangar"), "/Volumes/Disk/FPV Hangar");
  assert.equal(copyRoot("G:\\My Drive\\fpv hangar\\", (a, b) => `${a}\\${b}`), "G:\\My Drive\\fpv hangar\\");
});

test("drive: a copy can't be inside the library, nor the library inside the copy", () => {
  assert.ok(isWithin("/a/b/c", "/a/b"));
  assert.ok(isWithin("/a/b", "/a/b"));
  assert.ok(isWithin("C:\\Videos\\FPV Hangar\\x", "c:\\videos\\fpv hangar"));
  assert.ok(!isWithin("/a/bc", "/a/b"));
  assert.ok(!isWithin("/a", "/a/b"));
  assert.match(whyNot("/Movies/FPV Hangar/Somewhere", "/Movies/FPV Hangar"), /inside your library/);
  // Choosing the folder the library is in would make the library its own copy.
  assert.match(whyNot("/Movies", "/Movies/FPV Hangar"), /would be the library itself/);
  assert.match(whyNot("/Movies/FPV Hangar", "/Movies/FPV Hangar"), /would be the library itself/);
  assert.match(whyNot("/Drive", "/Drive/FPV Hangar/Library"), /inside that folder already/);
  assert.equal(whyNot("/Drive/My Drive", "/Movies/FPV Hangar"), null);
});

test("drive: whose Drive a folder is, from its name on a Mac", () => {
  assert.equal(driveAccount("GoogleDrive-pilot@example.com"), "pilot@example.com");
  assert.equal(driveAccount("Dropbox"), null);
  assert.equal(driveAccount("GoogleDrive-"), null);
});

test("drive: what belongs in the copy", () => {
  assert.ok(belongs("Event/Track 1/Raw files/clip_0001.ts"));
  assert.ok(belongs("Event/Track 1/landscape/clip_0001.mp4"));
  assert.ok(belongs("dashboard.json"));
  assert.ok(belongs("Songs/A song.mp3"));
  // Hidden files, ones still being written, and programs.
  assert.ok(!belongs(".DS_Store"));
  assert.ok(!belongs("Event/Track 1/.fpv-hangar.json"));
  assert.ok(!belongs("Event/.hidden/clip.ts"));
  assert.ok(!belongs("Event/Track 1/landscape/clip_0001.mp4.part"));
  assert.ok(!belongs("Old.app/Contents/Info.plist"));
  assert.ok(!belongs(""));
  // Recordings can be left out. Everything else of the track still goes.
  assert.ok(!belongs("Event/Track 1/Raw files/clip_0001.ts", { recordings: false }));
  assert.ok(belongs("Event/Track 1/csv markers/clip_0001.csv", { recordings: false }));
  assert.ok(belongs("Event/Track 1/landscape/clip_0001.mp4", { recordings: false }));
  // A file that happens to be called that is not the folder.
  assert.ok(belongs("Event/Raw files", { recordings: false }));
});

test("drive: a file is copied when it is new, a different size, or newer than its copy", () => {
  const file = { size: 100, modified: 1_000_000 };
  assert.ok(isDue(file, null));
  assert.ok(isDue(file, { size: 99, modified: 2_000_000 }));
  assert.ok(isDue(file, { size: 100, modified: 990_000 }));
  assert.ok(!isDue(file, { size: 100, modified: 1_000_000 }));
  // Drive gives a file the time it arrived: later than the file's own, which is no reason to copy it again.
  assert.ok(!isDue(file, { size: 100, modified: 5_000_000 }));
  // Some disks keep times to two seconds.
  assert.ok(!isDue(file, { size: 100, modified: 998_500 }));
});

test("drive: a round takes what the copy hasn't got, the small files first", () => {
  const files = [
    { path: "E/T/Raw files/big.ts", size: 5000, modified: 10 },
    { path: "E/T/landscape/video.mp4", size: 900, modified: 10 },
    { path: "E/T/csv markers/run.csv", size: 12, modified: 10 },
    { path: "dashboard.json", size: 300, modified: 10 },
  ];
  const copies = new Map([["E/T/landscape/video.mp4", { size: 900, modified: 10 }]]);
  const todo = plan(files, copies);
  assert.deepEqual(todo.due.map((file) => file.path), ["E/T/csv markers/run.csv", "dashboard.json", "E/T/Raw files/big.ts"]);
  assert.equal(todo.bytes, 5312);
  assert.equal(todo.held, 1);
  assert.equal(todo.heldBytes, 900);
  assert.deepEqual(plan(files, new Map(files.map((file) => [file.path, file]))).due, []);
});

test("drive: what a file is, for saying what the copy holds", () => {
  assert.equal(kindOf("E/T/Raw files/clip.ts"), "recordings");
  assert.equal(kindOf("E/T/Raw files/clip.mp4"), "recordings");
  assert.equal(kindOf("E/T/landscape/clip.mp4"), "videos");
  assert.equal(kindOf("E/T/vertical/clip 2.mp4"), "videos");
  assert.equal(kindOf("E/T/csv markers/clip.csv"), "the rest");
  assert.equal(kindOf("dashboard.json"), "the rest");
  // An event's clip for before its videos isn't one of its finished videos.
  assert.equal(kindOf("E/Before.mp4"), "the rest");
});
