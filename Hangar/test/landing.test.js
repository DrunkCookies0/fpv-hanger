// Putting a file into the library whole, as into a library in Google Drive, where a folder that is
// new can be gone for a moment, along with a file still being written in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearStaging, land, place } from "../main/landing.js";

const quick = { wait: 5 };

function scratch() {
  const folder = mkdtempSync(join(tmpdir(), "hangar-landing-"));
  return { folder, staging: join(folder, "Arriving"), track: join(folder, "Library", "Event", "Track 1", "Raw files"), done: () => rmSync(folder, { recursive: true, force: true }) };
}

test("landing: written in the app's own folder and moved in whole, leaving nothing behind", async () => {
  const { staging, track, done } = scratch();
  try {
    const target = join(track, "clip.MOV");
    const written = [];
    await land(target, (first) => {
      written.push(first);
      writeFileSync(first, "recording");
    }, { staging, ...quick });
    assert.equal(readFileSync(target, "utf8"), "recording");
    assert.ok(written[0].startsWith(staging));
    assert.deepEqual(readdirSync(staging), []);
    assert.deepEqual(readdirSync(track), ["clip.MOV"]);
  } finally {
    done();
  }
});

test("landing: without a folder of its own, it is written beside where it goes, under .part", async () => {
  const { track, done } = scratch();
  try {
    const target = join(track, "clip.MOV");
    let first = null;
    await land(target, (path) => {
      first = path;
      writeFileSync(path, "recording");
    }, quick);
    assert.equal(first, `${target}.part`);
    assert.deepEqual(readdirSync(track), ["clip.MOV"]);
  } finally {
    done();
  }
});

test("landing: a folder gone for a moment is made again, and a file lost on the way is written again", async () => {
  const { staging, track, done } = scratch();
  try {
    // The track's folder goes while the clip is being written.
    const target = join(track, "clip.MOV");
    await land(target, (first) => {
      writeFileSync(first, "recording");
      rmSync(join(track, ".."), { recursive: true, force: true });
    }, { staging, ...quick });
    assert.equal(readFileSync(target, "utf8"), "recording");

    // The file being written is taken away before it can be put in place: it is written again.
    let calls = 0;
    const second = join(track, "clip 2.MOV");
    await land(second, (first) => {
      calls += 1;
      writeFileSync(first, "recording 2");
      if (calls === 1) rmSync(first);
    }, { staging, ...quick });
    assert.equal(calls, 2);
    assert.equal(readFileSync(second, "utf8"), "recording 2");

    // Writing beside it, the folder isn't there when the file is opened: it is made again and tried again.
    calls = 0;
    const third = join(track, "clip 3.MOV");
    await land(third, (first) => {
      calls += 1;
      if (calls === 1) rmSync(track, { recursive: true, force: true });
      writeFileSync(first, "recording 3");
    }, quick);
    assert.equal(calls, 2);
    assert.equal(readFileSync(third, "utf8"), "recording 3");
  } finally {
    done();
  }
});

test("landing: what isn't a passing problem is said at once, and nothing is left", async () => {
  const { staging, track, done } = scratch();
  try {
    let calls = 0;
    await assert.rejects(land(join(track, "Logo.png"), (first) => {
      calls += 1;
      writeFileSync(first, "half");
      throw Object.assign(new Error("not a picture"), { code: "UNREADABLE" });
    }, { staging, ...quick }), /not a picture/);
    assert.equal(calls, 1);
    assert.deepEqual(readdirSync(staging), []);
    assert.ok(!existsSync(join(track, "Logo.png")));
  } finally {
    done();
  }
});

test("landing: a file on another disk is copied beside where it goes, keeping its date", { skip: (() => {
  try {
    return statSync("/dev/shm").dev === statSync(tmpdir()).dev ? "there is no second disk here" : false;
  } catch {
    return "there is no second disk here";
  }
})() }, async () => {
  const { track, done } = scratch();
  const other = mkdtempSync("/dev/shm/hangar-landing-");
  try {
    const made = join(other, "video.mp4"), target = join(track, "video.mp4");
    writeFileSync(made, "video");
    const then = new Date(2026, 9, 1, 12, 0, 0);
    utimesSync(made, then, then);
    mkdirSync(track, { recursive: true });
    await place(made, target, quick);
    assert.equal(readFileSync(target, "utf8"), "video");
    assert.equal(Math.round(statSync(target).mtimeMs / 1000), Math.round(then.getTime() / 1000));
    assert.ok(!existsSync(made));
    assert.deepEqual(readdirSync(track), ["video.mp4"]);
  } finally {
    rmSync(other, { recursive: true, force: true });
    done();
  }
});

test("landing: what a stopped copy of the app left on its way is cleared", () => {
  const { staging, done } = scratch();
  try {
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "123-abc clip.MOV"), "half");
    clearStaging(staging);
    assert.deepEqual(readdirSync(staging), []);
    clearStaging(join(staging, "not there"));
  } finally {
    done();
  }
});

test("landing: a small file written at once is tried again if its folder is gone for a moment", async () => {
  const { track, done } = scratch();
  try {
    const { landNow } = await import("../main/landing.js");
    const target = join(track, "..", "csv markers", "clip.csv");
    landNow(target, "1,2,3\n", { wait: 5 });
    assert.equal(readFileSync(target, "utf8"), "1,2,3\n");
    assert.deepEqual(readdirSync(join(track, "..", "csv markers")), ["clip.csv"]);
  } finally {
    done();
  }
});
