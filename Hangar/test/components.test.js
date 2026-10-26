// Other projects' tools: how far a tool's page may go, and reading a project's release. The
// release here is made up, in the shape GitHub gives one.
import test from "node:test";
import assert from "node:assert/strict";
import { outsideTools, isWithin, programs, versionOf, releaseOf, publishedSum, plainNotes, megabytes, familyOf, familyIn, nameFor, goesBeside, registryVersion } from "../shared/components.js";

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
  assert.equal(mac.sha256, null);
});

// EdgeTX's release: a zip for each kind of computer, and no list of checksums, only GitHub's own.
const hex = (letter) => letter.repeat(64);
const edgetxAt = (name) => `https://github.com/EdgeTX/edgetx/releases/download/v9.9.9/${name}`;
const edgetx = {
  tag_name: "v9.9.9", draft: false, prerelease: false, html_url: "https://github.com/EdgeTX/edgetx/releases/tag/v9.9.9",
  published_at: "2026-01-02T03:04:05Z", body: "A made-up change\n",
  assets: [
    { name: "edgetx-cpn-linux-v9.9.9.zip", size: 1, digest: `sha256:${hex("a")}`, browser_download_url: edgetxAt("edgetx-cpn-linux-v9.9.9.zip") },
    { name: "edgetx-cpn-macos-v9.9.9.zip", size: 162173991, digest: `sha256:${hex("B")}`, browser_download_url: edgetxAt("edgetx-cpn-macos-v9.9.9.zip") },
    { name: "edgetx-cpn-win64-v9.9.9.zip", size: 82140132, digest: `sha256:${hex("c")}`, browser_download_url: edgetxAt("edgetx-cpn-win64-v9.9.9.zip") },
    { name: "edgetx-firmware-v9.9.9.zip", size: 1, digest: `sha256:${hex("d")}`, browser_download_url: edgetxAt("edgetx-firmware-v9.9.9.zip") },
  ],
};

test("EdgeTX's release is read for each kind of computer, with GitHub's checksum for the file", () => {
  const program = programs.edgetxCompanion;
  const mac = releaseOf(program, edgetx, "darwin", "arm64");
  assert.deepEqual([mac.version, mac.file, mac.size, mac.sums, mac.sha256], ["9.9.9", "edgetx-cpn-macos-v9.9.9.zip", 162173991, null, hex("b")]);
  // One Mac download, for either kind of Mac.
  assert.equal(releaseOf(program, edgetx, "darwin", "x64").file, "edgetx-cpn-macos-v9.9.9.zip");
  const windows = releaseOf(program, edgetx, "win32", "x64");
  assert.deepEqual([windows.file, windows.sha256], ["edgetx-cpn-win64-v9.9.9.zip", hex("c")]);
  assert.equal(releaseOf(program, edgetx, "linux", "x64"), null);
  // A file GitHub keeps no checksum for, or not one that is a SHA-256, can't be checked.
  const without = (change) => ({ ...edgetx, assets: edgetx.assets.map((asset) => (asset.name.includes("macos") ? change(asset) : asset)) });
  assert.equal(releaseOf(program, without(({ digest, ...rest }) => rest), "darwin", "arm64"), null);
  assert.equal(releaseOf(program, without((asset) => ({ ...asset, digest: `sha1:${"e".repeat(40)}` })), "darwin", "arm64"), null);
  assert.equal(releaseOf(program, without((asset) => ({ ...asset, digest: `sha256:${hex("g")}` })), "darwin", "arm64"), null);
  assert.equal(releaseOf(program, without((asset) => ({ ...asset, browser_download_url: asset.browser_download_url.replace("EdgeTX/edgetx", "someone/edgetx") })), "darwin", "arm64"), null);
  assert.equal(releaseOf(program, { ...edgetx, prerelease: true }, "win32", "x64"), null);
  // What is inside each zip.
  assert.ok(program.inside("darwin").test("edgetx-companion-9.9.9.dmg"));
  assert.ok(program.inside("win32").test("companion-windows-9.9.9.exe"));
  assert.ok(!program.inside("win32").test("edgetx-companion-9.9.9.dmg"));
});

test("a program each of whose version families is a program of its own", () => {
  const { edgetxCompanion, elrsConfigurator } = programs;
  assert.equal(familyOf("2.12.5"), "2.12");
  assert.equal(familyOf("3.0"), "3.0");
  assert.equal(familyIn(edgetxCompanion.mac, "EdgeTX Companion 2.12.app"), "2.12");
  assert.equal(familyIn("Companion *", "Companion 3.0"), "3.0");
  assert.equal(familyIn(edgetxCompanion.mac, "EdgeTX Companion 2.12 copy.app"), null);
  assert.equal(familyIn(edgetxCompanion.mac, "EdgeTX Companion.app"), null);
  assert.equal(familyIn(elrsConfigurator.mac, "ExpressLRS Configurator.app"), "");
  assert.equal(familyIn(elrsConfigurator.mac, "ExpressLRS ConfiguratorXapp"), null);
  assert.equal(nameFor(edgetxCompanion.mac, "2.12.5"), "EdgeTX Companion 2.12.app");
  assert.equal(nameFor(edgetxCompanion.windows[0], "3.0.1"), "EdgeTX/Companion 3.0/bin/companion.exe");
  assert.equal(nameFor(elrsConfigurator.mac, "1.8.3"), "ExpressLRS Configurator.app");
  // A newer family goes in beside the one there; a newer release of the same family in its place.
  assert.equal(goesBeside(edgetxCompanion, "2.11.4", "2.12.5"), true);
  assert.equal(goesBeside(edgetxCompanion, "2.12", "2.12.5"), false);
  assert.equal(goesBeside(edgetxCompanion, null, "2.12.5"), false);
  assert.equal(goesBeside(elrsConfigurator, "1.7.0", "1.8.3"), false);
});

test("the version Windows has written down for a program", () => {
  const told = "\r\nHKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EdgeTX Companion 9.9\r\n    DisplayVersion    REG_SZ    9.9.9\r\n\r\n";
  assert.equal(registryVersion(told), "9.9.9");
  assert.equal(registryVersion(told.replace("9.9.9\r", "9.9.9-selfbuild\r")), null);
  assert.equal(registryVersion(""), null);
  assert.equal(registryVersion(null), null);
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
