// Whether WS3 Unlocked has a newer release than the WhoopStor's firmware.
import test from "node:test";
import assert from "node:assert/strict";
import { tagVersion, versionWords, compareVersions, releasesFrom, chargerRelease, firmwareNews } from "../shared/ws3.js";

// As GitHub gave them on 8 November 2026, cut down: every release is a pre-release, and the rolling
// build comes first in the list although it is older.
const page = "https://github.com/Pogaldock/ws3-unlocked/releases/tag/";
const releases = [
  { tag_name: "rot-latest", name: "WS3 Unlocked, latest build (b6fa0077)", prerelease: true, draft: false, published_at: "2026-11-03T19:01:22Z", html_url: `${page}rot-latest` },
  { tag_name: "v0.2.0-beta.6", name: "WS3 Unlocked v0.2.0-beta.6", prerelease: true, draft: false, published_at: "2026-11-06T22:57:50Z", html_url: `${page}v0.2.0-beta.6` },
  { tag_name: "v0.2.0-beta.4", name: "WS3 Unlocked v0.2.0-beta.4", prerelease: true, draft: false, published_at: "2026-11-03T19:13:12Z", html_url: `${page}v0.2.0-beta.4` },
];
const tags = [
  { name: "v0.2.0-beta.6", commit: { sha: "6bb3f90d2f4cf66d9f76a4e82eca759df452b751" } },
  { name: "v0.2.0-beta.4", commit: { sha: "c9477d1eceea3df494b9f786d57774e8af0e41d0" } },
  { name: "rot-latest", commit: { sha: "b6fa00777218aaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
];
const later = (tag, at, extra = {}) => ({ tag_name: tag, draft: false, prerelease: true, published_at: at, html_url: `${page}${tag}`, ...extra });
const charger = (release, beta, build) => [{ release }, { beta, build }];

test("a tag is a version, and the rolling build isn't", () => {
  assert.deepEqual(tagVersion("v0.2.0-beta.6"), { major: 0, minor: 2, patch: 0, beta: 6 });
  assert.deepEqual(tagVersion("0.3.1"), { major: 0, minor: 3, patch: 1, beta: 0 });
  for (const tag of ["rot-latest", "", null, "v0.2", "v0.2.0-rc.1", "v0.2.0-beta."]) assert.equal(tagVersion(tag), null, String(tag));
  assert.equal(versionWords(tagVersion("v0.2.0-beta.6")), "0.2.0-beta.6");
  assert.equal(versionWords(tagVersion("v1.0.0")), "1.0.0");
});

test("a final release is later than its betas, and betas go by their number", () => {
  const v = (tag) => tagVersion(tag);
  assert.ok(compareVersions(v("v0.2.0"), v("v0.2.0-beta.6")) > 0);
  assert.ok(compareVersions(v("v0.2.0-beta.7"), v("v0.2.0-beta.6")) > 0);
  assert.ok(compareVersions(v("v0.2.0-beta.10"), v("v0.2.0-beta.9")) > 0);
  assert.ok(compareVersions(v("v0.2.1-beta.1"), v("v0.2.0")) > 0);
  assert.ok(compareVersions(v("v0.3.0-beta.1"), v("v0.2.9")) > 0);
  assert.equal(compareVersions(v("v0.2.0-beta.6"), v("v0.2.0-beta.6")), 0);
});

test("the releases with a version, newest first, each with the commit its tag is on", () => {
  const found = releasesFrom(releases, tags);
  assert.deepEqual(found.map((one) => one.tag), ["v0.2.0-beta.6", "v0.2.0-beta.4"]);
  assert.equal(found[0].commit, "6bb3f90d");
  assert.equal(found[0].words, "0.2.0-beta.6");
  assert.equal(found[0].url, `${page}v0.2.0-beta.6`);
  assert.equal(found[0].published, "2026-11-06T22:57:50Z");
  // Drafts are left out; a release whose tags weren't given has no commit.
  assert.deepEqual(releasesFrom([...releases, later("v0.2.0-beta.7", "2026-11-09T00:00:00Z", { draft: true })], []).map((one) => [one.tag, one.commit]), [["v0.2.0-beta.6", null], ["v0.2.0-beta.4", null]]);
  // A link that isn't to the project's own page is never followed: its own is made instead.
  assert.equal(releasesFrom([later("v0.2.0-beta.7", null, { html_url: "https://example.com/x" })])[0].url, `${page}v0.2.0-beta.7`);
  for (const bad of [null, "text", {}, [null, 3, { tag_name: 5 }]]) assert.deepEqual(releasesFrom(bad, bad), []);
});

test("the charger's release, by the commit it was built from or by its numbers", () => {
  const known = releasesFrom(releases, tags);
  // The pilot's: 0.2 and beta 6. Built from the tag's commit, it is that release exactly.
  assert.equal(chargerRelease(...charger("0.2", 6, "6bb3f90d"), known).release.tag, "v0.2.0-beta.6");
  // Built from another commit (the rolling build, as the pretend charger is), it goes by its numbers.
  const rolling = chargerRelease(...charger("0.2", 6, "b6fa0077"), known);
  assert.deepEqual([rolling.major, rolling.minor, rolling.patch, rolling.beta, rolling.release?.tag], [0, 2, 0, 6, "v0.2.0-beta.6"]);
  // A patch release says only 0.2 over USB; its commit tells it from 0.2.0.
  const patched = releasesFrom([...releases, later("v0.2.1", "2026-12-01T00:00:00Z"), later("v0.2.0", "2026-11-20T00:00:00Z")], [...tags, { name: "v0.2.1", commit: { sha: "aaaabbbbcccc" } }]);
  assert.equal(chargerRelease(...charger("0.2", 0, "aaaabbbb"), patched).patch, 1);
  // Firmware from before the version byte doesn't say.
  assert.equal(chargerRelease({ release: null }, { beta: 0 }, known), null);
  assert.equal(chargerRelease({ release: "0.2" }, null, known), null);
});

test("whether a newer one is out", () => {
  const ws3 = { releases: releasesFrom(releases, tags), checked: "2026-11-08T23:00:00Z" };
  // On 8 November the pilot's 0.2-beta.6 is the newest; the rolling build of 3 November isn't newer.
  const today = firmwareNews(ws3, ...charger("0.2", 6, "6bb3f90d"), "WS3 Unlocked");
  assert.deepEqual([today.newer, today.mine, today.latest.words, today.checked], [false, "0.2.0-beta.6", "0.2.0-beta.6", "2026-11-08T23:00:00Z"]);
  assert.equal(firmwareNews(ws3, ...charger("0.2", 4, "c9477d1e"), "WS3 Unlocked").newer, true);
  const next = { releases: releasesFrom([later("v0.2.0-beta.7", "2026-11-12T00:00:00Z"), ...releases], tags) };
  const news = firmwareNews(next, ...charger("0.2", 6, "6bb3f90d"), "WS3 Unlocked");
  assert.deepEqual([news.newer, news.latest.words, news.latest.url], [true, "0.2.0-beta.7", `${page}v0.2.0-beta.7`]);
  assert.equal(firmwareNews({ releases: releasesFrom([later("v0.2.0", "2026-11-20T00:00:00Z"), ...releases], tags) }, ...charger("0.2", 6, "6bb3f90d")).newer, true);
  // Nothing to say before the page has been looked at, without the firmware's version, or on OpenWS3.
  assert.equal(firmwareNews({ releases: [] }, ...charger("0.2", 6, "6bb3f90d")), null);
  assert.equal(firmwareNews(undefined, ...charger("0.2", 6, "6bb3f90d")), null);
  assert.equal(firmwareNews(ws3, { release: null }, { beta: 0 }), null);
  assert.equal(firmwareNews(ws3, ...charger("0.2", 6, "6bb3f90d"), "OpenWS3"), null);
});
