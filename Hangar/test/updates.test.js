// Which version is the newest, for which kind of computer, and the script that swaps one in on Windows.
import test from "node:test";
import assert from "node:assert/strict";
import { releaseFor, isNewer, windowsSwap } from "../shared/updates.js";

const sum = "0123456789abcdef".repeat(4);
const told = { version: "0.13.0", file: "FPV-Hangar-v0.13.0.zip", sha256: sum.toUpperCase(), notes: "- Something new", windows: { file: "FPV-Hangar-v0.13.0-win64.zip", sha256: sum } };

test("each kind of computer has its own archive in the one file", () => {
  assert.deepEqual(releaseFor(told, "darwin"), { version: "0.13.0", file: "FPV-Hangar-v0.13.0.zip", sha256: sum, notes: "- Something new" });
  assert.deepEqual(releaseFor(told, "win32"), { version: "0.13.0", file: "FPV-Hangar-v0.13.0-win64.zip", sha256: sum, notes: "- Something new" });
  assert.equal(releaseFor(told, "linux"), null);
  // A release from before there was a Windows app has nothing for Windows, and says so by having nothing.
  assert.equal(releaseFor({ version: "0.12.1", file: "FPV-Hangar-v0.12.1.zip", sha256: sum, notes: "" }, "win32"), null);
  assert.equal(releaseFor({ version: "0.12.1", file: "FPV-Hangar-v0.12.1.zip", sha256: sum }, "darwin").notes, "");
});

test("a file that isn't what it should be is nothing", () => {
  for (const bad of [null, "text", {}, { ...told, version: "newest" }, { ...told, file: "../../elsewhere.zip" }, { ...told, file: "https://example.com/a.zip" }, { ...told, file: "a.exe" }, { ...told, sha256: "abc" }, { ...told, sha256: undefined }]) {
    assert.equal(releaseFor(bad, "darwin"), null, JSON.stringify(bad));
  }
  assert.equal(releaseFor({ ...told, windows: { file: "..\\up.zip", sha256: sum } }, "win32"), null);
});

test("which of two versions is later", () => {
  assert.equal(isNewer("0.10.0", "0.9.2"), true);
  assert.equal(isNewer("0.13.0", "0.13.0"), false);
  assert.equal(isNewer("0.12.1", "0.13"), false);
  assert.equal(isNewer("1.0", "0.99.9"), true);
});

test("the Windows swap waits for the app, keeps the old copy, and has a way back", () => {
  const script = windowsSwap({ app: "C:\\Users\\A Pilot\\Desktop\\FPV Hangar", fresh: "C:\\Temp\\new\\FPV Hangar", old: "C:\\Users\\A Pilot\\Desktop\\FPV Hangar (before update)", program: "FPV Hangar.exe", pid: 4242, after: ["--say-version", "C:\\Temp\\said.txt"] });
  const lines = script.split("\r\n");
  assert.equal(lines[0], "@echo off");
  assert.ok(lines.includes('set "APP=C:\\Users\\A Pilot\\Desktop\\FPV Hangar"'));
  assert.ok(lines.includes('tasklist /fi "PID eq 4242" /nh 2>nul | find /i ".exe" >nul'));
  // The old copy is moved aside before the new one comes in, and comes back if that fails.
  const at = (text) => lines.findIndex((line) => line.includes(text));
  assert.ok(at('move "%APP%" "%OLD%"') < at("robocopy") && at("robocopy") < at(":back") && at(":back") < at('move "%OLD%" "%APP%"'));
  assert.ok(lines.includes('start "" "%APP%\\%EXE%" "--say-version" "C:\\Temp\\said.txt"'));
  // Nothing in it waits on the keyboard: it runs where there is none.
  assert.ok(!/\btimeout\b|\bpause\b/.test(script));
  assert.ok(windowsSwap({ app: "a", fresh: "b", old: "c", program: "d.exe", pid: 1 }).includes('start "" "%APP%\\%EXE%"\r\nexit /b 0'));
});
