// Whether there is a newer WS3 Unlocked than the one on the pilot's WhoopStor V3.
//
// WS3 Unlocked is Pogaldock's open firmware for the charger. Its releases are on the project's
// GitHub page, all marked pre-release while it is in beta, so GitHub's "latest release" leaves them
// out and the whole list is read instead. A release is named by its tag, "v0.2.0-beta.6". The
// rolling "rot-latest" build has no version number and is never offered.
//
// The charger says less than a tag does: major and minor (page 1 byte 10), the beta number (page 2
// byte 47) and the commit it was built from (page 2 bytes 57 to 60; USB.md). The commit tells
// which release it is exactly when it was built from a release's tag; otherwise the release with
// the same numbers is taken. The Hangar only says that a newer one is out: flashing is done with
// the project's own page, as its README says.

export const ws3Repository = "Pogaldock/ws3-unlocked";
export const ws3Releases = `https://github.com/${ws3Repository}/releases`;

/** A tag's version: "v0.2.0-beta.6" gives { major 0, minor 2, patch 0, beta 6 }, a final release
 *  beta 0. Null for a tag that isn't a version. */
export function tagVersion(tag) {
  const found = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(tag ?? "").trim());
  if (!found) return null;
  const [major, minor, patch, beta] = found.slice(1).map((part) => Number(part ?? 0));
  return { major, minor, patch, beta };
}

/** How a version is written: "0.2.0-beta.6", or "0.2.0" for a final release. */
export function versionWords(version) {
  if (!version) return "";
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.beta ? `${base}-beta.${version.beta}` : base;
}

/** Above 0 when `a` is later than `b`. A final release is later than any of its betas. */
export function compareVersions(a, b) {
  for (const part of ["major", "minor", "patch"]) if (a[part] !== b[part]) return a[part] - b[part];
  if (a.beta === b.beta) return 0;
  if (!a.beta) return 1;
  if (!b.beta) return -1;
  return a.beta - b.beta;
}

/**
 * The project's releases that have a version, newest first, from GitHub's list of releases and of
 * tags: `{ tag, version, words, url, published, commit }`, with `commit` the first eight hex
 * digits of the commit the tag is on (as the charger gives it), or null when the tags don't say.
 * Drafts and tags without a version are left out.
 */
export function releasesFrom(releases, tags = []) {
  const commits = new Map((Array.isArray(tags) ? tags : []).filter((one) => typeof one?.name === "string" && typeof one?.commit?.sha === "string").map((one) => [one.name, one.commit.sha.slice(0, 8).toLowerCase()]));
  return (Array.isArray(releases) ? releases : [])
    .filter((one) => one && !one.draft && typeof one.tag_name === "string")
    .map((one) => {
      const version = tagVersion(one.tag_name);
      if (!version) return null;
      const url = typeof one.html_url === "string" && one.html_url.startsWith(`https://github.com/${ws3Repository}/`) ? one.html_url : `${ws3Releases}/tag/${encodeURIComponent(one.tag_name)}`;
      return { tag: one.tag_name, version, words: versionWords(version), url, published: typeof one.published_at === "string" ? one.published_at : null, commit: commits.get(one.tag_name) ?? null };
    })
    .filter(Boolean)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Which release is on the charger, from its reports: the one whose tag is on the commit it was
 * built from, else the newest with its numbers, else its numbers with patch 0. Null when the
 * charger doesn't say (firmware older than the version byte).
 */
export function chargerRelease(p1, p2, known = []) {
  const found = /^(\d+)\.(\d+)$/.exec(p1?.release ?? "");
  if (!found || !p2) return null;
  const major = Number(found[1]), minor = Number(found[2]), beta = Number(p2.beta) || 0;
  const build = typeof p2.build === "string" && p2.build !== "00000000" ? p2.build.toLowerCase() : null;
  const exact = build && known.find((one) => one.commit === build);
  if (exact) return { ...exact.version, release: exact, build };
  const same = known.find((one) => one.version.major === major && one.version.minor === minor && one.version.beta === beta);
  return { major, minor, patch: same ? same.version.patch : 0, beta, release: same ?? null, build };
}

/**
 * What to say about the charger's firmware: null when there's nothing to say (no firmware read, no
 * look at the project's page yet, or firmware that isn't WS3 Unlocked), else `{ newer, latest,
 * mine, checked }`: `latest` the newest release, `mine` the charger's version written out.
 */
export function firmwareNews(ws3, p1, p2, name = "") {
  if (!ws3?.releases?.length || /openws3/i.test(name)) return null;
  const mine = chargerRelease(p1, p2, ws3.releases);
  if (!mine) return null;
  const latest = ws3.releases[0];
  return { newer: compareVersions(latest.version, mine) > 0, latest, mine: versionWords(mine), checked: ws3.checked ?? null };
}
