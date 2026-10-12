// Other projects' tools: how far a tool's page may go, and reading a project's release. The
// release here is made up, in the shape GitHub gives one.
import test from "node:test";
import assert from "node:assert/strict";
import { outsideTools, isWithin, programs, versionOf, releaseOf, publishedSum, plainNotes, megabytes } from "../shared/components.js";

test("a tool's page stays the tool only on the project's own address", () => {
  const { betaflight, elrsFlasher } = outsideTools;
  assert.ok(isWithin(betaflight, "https://app.betaflight.com/"));
  assert.ok(isWithin(betaflight, "https://app.betaflight.com/#/firmware"));
  assert.ok(!isWithin(betaflight, "https://app.betaflight.com.example.net/"));
  assert.ok(!isWithin(betaflight, "https://betaflight.com/docs"));
  assert.ok(!isWithin(betaflight, "http://app.betaflight.com/"));
  assert.ok(isWithin(elrsFlasher, "https://expresslrs.github.io/web-flasher"));
  assert.ok(isWithin(elrsFlasher, "https://expresslrs.github.io/web-flasher/index.html"));
  // Another project's pages on the same host are not the flasher.
  assert.ok(!isWithin(elrsFlasher, "https://expresslrs.github.io/somewhere-else/"));
  assert.ok(!isWithin(elrsFlasher, null));
});

const sum = (letter) => `${letter.repeat(86)}==`;
const at = (name) => `https://github.com/ExpressLRS/ExpressLRS-Configurator/releases/download/v9.9.9/${name}`;
const told = {
  tag_name: "v9.9.9", draft: false, prerelease: false, html_url: "https://github.com/ExpressLRS/ExpressLRS-Configurator/releases/tag/v9.9.9",
  published_at: "2026-01-02T03:04:05Z", body: "## What's Changed\n* **A thing** by [someone](https://example.com) in #1\n\n- Another\n<!-- hidden -->\n",
  assets: [
    { name: "ExpressLRS-Configurator-9.9.9-arm64.dmg", size: 210886546, browser_download_url: at("ExpressLRS-Configurator-9.9.9-arm64.dmg") },
    { name: "ExpressLRS-Configurator-9.9.9-x64.dmg", size: 219153886, browser_download_url: at("ExpressLRS-Configurator-9.9.9-x64.dmg") },
    { name: "ExpressLRS-Configurator-Setup-9.9.9.exe", size: 254803968, browser_download_url: at("ExpressLRS-Configurator-Setup-9.9.9.exe") },
    { name: "ExpressLRS-Configurator-Setup-9.9.9.exe.blockmap", size: 1, browser_download_url: at("ExpressLRS-Configurator-Setup-9.9.9.exe.blockmap") },
    { name: "latest-mac.yml", size: 1, browser_download_url: at("latest-mac.yml") },
    { name: "latest.yml", size: 1, browser_download_url: at("latest.yml") },
  ],
};

test("a project's release is read for each kind of computer", () => {
  const program = programs.elrsConfigurator;
  const mac = releaseOf(program, told, "darwin", "arm64");
  assert.deepEqual([mac.version, mac.file, mac.size, mac.sums], ["9.9.9", "ExpressLRS-Configurator-9.9.9-arm64.dmg", 210886546, at("latest-mac.yml")]);
  assert.equal(releaseOf(program, told, "darwin", "x64").file, "ExpressLRS-Configurator-9.9.9-x64.dmg");
  const windows = releaseOf(program, told, "win32", "x64");
  assert.deepEqual([windows.file, windows.sums], ["ExpressLRS-Configurator-Setup-9.9.9.exe", at("latest.yml")]);
  assert.equal(releaseOf(program, told, "linux", "x64"), null);
  // Not a finished release, or not one at all.
  assert.equal(releaseOf(program, { ...told, prerelease: true }, "darwin", "arm64"), null);
  assert.equal(releaseOf(program, { ...told, tag_name: "nightly" }, "darwin", "arm64"), null);
  assert.equal(releaseOf(program, null, "darwin", "arm64"), null);
  // A file that would come from somewhere other than the project's own releases isn't taken.
  const elsewhere = { ...told, assets: told.assets.map((asset) => ({ ...asset, browser_download_url: asset.browser_download_url.replace("github.com/ExpressLRS", "github.com/someone-else") })) };
  assert.equal(releaseOf(program, elsewhere, "darwin", "arm64"), null);
  // Without the list of checksums there is nothing to check a download against.
  assert.equal(releaseOf(program, { ...told, assets: told.assets.filter((asset) => !asset.name.endsWith(".yml")) }, "darwin", "arm64"), null);
});

test("version numbers, with or without the v", () => {
  assert.equal(versionOf("v1.8.3"), "1.8.3");
  assert.equal(versionOf(" 2026.6.2 "), "2026.6.2");
  assert.equal(versionOf("1.8.3-RC1"), null);
  assert.equal(versionOf(""), null);
});

test("the checksum a release publishes for a file", () => {
  const list = `version: 9.9.9
files:
  - url: ExpressLRS-Configurator-9.9.9-x64.dmg
    sha512: ${sum("A")}
    size: 219153886
  - url: ExpressLRS-Configurator-9.9.9-arm64.dmg
    sha512: ${sum("B")}
    size: 210886546
path: ExpressLRS-Configurator-9.9.9-x64.dmg
sha512: ${sum("A")}
releaseDate: '2026-01-02T03:04:05.000Z'
`;
  assert.equal(publishedSum(list, "ExpressLRS-Configurator-9.9.9-arm64.dmg"), sum("B"));
  assert.equal(publishedSum(list, "ExpressLRS-Configurator-9.9.9-x64.dmg"), sum("A"));
  assert.equal(publishedSum(list.replace(/\n/g, "\r\n"), "ExpressLRS-Configurator-9.9.9-arm64.dmg"), sum("B"));
  assert.equal(publishedSum(list, "something-else.dmg"), null);
  // A sum that isn't the length of one is not taken for one.
  assert.equal(publishedSum("files:\n  - url: a.dmg\n    sha512: abc\n", "a.dmg"), null);
  assert.equal(publishedSum("", "a.dmg"), null);
});

test("a release's notes as plain lines", () => {
  assert.deepEqual(plainNotes(told.body), ["What's Changed", "- A thing by someone in #1", "- Another"]);
  assert.deepEqual(plainNotes("a\nb\nc\nd", 2), ["a", "b", "…"]);
  assert.deepEqual(plainNotes(null), []);
  assert.equal(megabytes(210886546), "201 MB");
});
