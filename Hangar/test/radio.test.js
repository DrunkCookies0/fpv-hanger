// A radio's own card and its backups: what its settings say of it, what a backup is called, and
// what is copied in which order. The radio's settings here are made up, in the shape EdgeTX writes.
import test from "node:test";
import assert from "node:assert/strict";
import { radioFacts, radioName, backupName, notTheRadios, copyOrder, unchanged, somethingChanged } from "../shared/radio.js";

test("what a radio's settings say of it", () => {
  assert.deepEqual(radioFacts("semver: 2.12.5\nboard: tx15\ncalib:\n  0:\n    mid: 0\n"), { board: "tx15", version: "2.12.5" });
  assert.deepEqual(radioFacts("semver: \"2.12.5\"\r\nboard: 'TX16SMK3'\r\n"), { board: "tx16smk3", version: "2.12.5" });
  // A setting further in that happens to be called "board" isn't the radio's.
  assert.deepEqual(radioFacts("calib:\n  board: x\n"), { board: "", version: "" });
  assert.deepEqual(radioFacts("board: ../../x\nsemver: 2.12.5-selfbuild\n"), { board: "", version: "" });
  assert.deepEqual(radioFacts(null), { board: "", version: "" });
});

test("what a radio and its backups are called", () => {
  assert.equal(radioName("tx15"), "TX15");
  assert.equal(radioName(""), "Radio");
  assert.equal(backupName("tx15", new Date(2026, 9, 25, 22, 40, 3)), "TX15 SD card 2026-10-25 22.40.03");
  assert.equal(backupName("", new Date(2026, 0, 2, 3, 4, 5)), "Radio SD card 2026-01-02 03.04.05");
});

test("a card's settings and models are copied first, and what the computer put there isn't", () => {
  assert.deepEqual(copyOrder(["SOUNDS", "THEMES", "MODELS", ".Spotlight-V100", "RADIO", "System Volume Information", "$RECYCLE.BIN", "WIDGETS", "._RADIO"], true), ["RADIO", "MODELS", "SOUNDS", "THEMES", "WIDGETS"]);
  // Further in, names go in order, numbers by their size.
  assert.deepEqual(copyOrder(["model10.yml", "RADIO", "model2.yml", "labels.yml"], false), ["labels.yml", "model2.yml", "model10.yml", "RADIO"]);
  assert.ok(notTheRadios(".fseventsd"));
  assert.ok(!notTheRadios("MODELS"));
});

test("a file is the same as its copy when it is as long and changed at the same time", () => {
  assert.ok(unchanged({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 2500 }));
  assert.ok(!unchanged({ size: 10, mtimeMs: 1000 }, { size: 10, mtimeMs: 3500 }));
  assert.ok(!unchanged({ size: 10, mtimeMs: 1000 }, { size: 11, mtimeMs: 1000 }));
  assert.ok(!unchanged({ size: 10, mtimeMs: 1000 }, null));
});

test("a backup is kept when it found something changed", () => {
  assert.ok(somethingChanged(0, 6, null));
  assert.ok(somethingChanged(1, 6, 6));
  // A file taken off the card since.
  assert.ok(somethingChanged(0, 5, 6));
  assert.ok(!somethingChanged(0, 6, 6));
});
