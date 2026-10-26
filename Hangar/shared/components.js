// Other projects' tools that the app brings in.
//
// Two of them are web apps and are shown inside the app's window, from the project's own site, so
// they are always that project's newest release and nothing of theirs is carried by the app. The
// others are programs of their own, the ExpressLRS Configurator and EdgeTX Companion: the app
// fetches each from the project's own Releases page, checks it against the checksum published
// there, and says when a newer one is out. Reading a release is here; fetching and putting it in
// place is main/components.js.

/** The tools that are another project's own app, opened inside the window. `within` is how far
 *  the page may go and still be the tool: any other address opens in the pilot's own browser. */
export const outsideTools = {
  betaflight: {
    title: "Betaflight",
    owner: "the Betaflight project",
    address: "https://app.betaflight.com/",
    within: ["https://app.betaflight.com/"],
    partition: "persist:tool-betaflight",
  },
  elrsFlasher: {
    title: "ExpressLRS Web Flasher",
    owner: "ExpressLRS",
    address: "https://expresslrs.github.io/web-flasher/",
    within: ["https://expresslrs.github.io/web-flasher/"],
    partition: "persist:tool-expresslrs",
  },
};

/** Whether an address is still inside a tool. */
export function isWithin(tool, address) {
  return typeof address === "string" && tool.within.some((start) => address === start.slice(0, -1) || address.startsWith(start));
}

/** The programs the app fetches and keeps up to date. `mac` and `windows` are where one is,
 *  inside a folder programs go in, with `*` for its version family where each family is a program
 *  of its own. `asset` picks a release's file for a kind of computer, and `inside` the file in it
 *  when that is a zip. `sums` names the file on the release that lists its checksums; without one,
 *  a file is checked against the checksum GitHub keeps for it. */
export const programs = {
  elrsConfigurator: {
    title: "ExpressLRS Configurator",
    owner: "ExpressLRS",
    repository: "ExpressLRS/ExpressLRS-Configurator",
    page: "https://github.com/ExpressLRS/ExpressLRS-Configurator/releases",
    mac: "ExpressLRS Configurator.app",
    windows: ["expresslrs-configurator/ExpressLRS Configurator.exe", "ExpressLRS Configurator/ExpressLRS Configurator.exe", "ExpressLRS Configurator.exe"],
    asset: (platform, arch) => (platform === "darwin" ? (arch === "arm64" ? /-arm64\.dmg$/ : /-x64\.dmg$/) : platform === "win32" ? /^ExpressLRS-Configurator-Setup-.*\.exe$/ : null),
    sums: (platform) => (platform === "darwin" ? "latest-mac.yml" : platform === "win32" ? "latest.yml" : null),
  },
  // Each version family (2.12, 3.0) is a program of its own, which EdgeTX keeps beside the others
  // on purpose. Its Mac copy doesn't say which version it is: its Windows installer writes it down.
  edgetxCompanion: {
    title: "EdgeTX Companion",
    owner: "EdgeTX",
    repository: "EdgeTX/edgetx",
    page: "https://github.com/EdgeTX/edgetx/releases",
    mac: "EdgeTX Companion *.app",
    windows: ["EdgeTX/Companion */bin/companion.exe"],
    registry: "EdgeTX Companion *",
    // Before it writes new firmware to a radio it backs up the old, in Documents/EdgeTX/backups,
    // and it doesn't write it when that folder isn't there. The app makes it, and keeps its own
    // backups of the radio's card there too (main/radio.js).
    backups: true,
    asset: (platform) => (platform === "darwin" ? /^edgetx-cpn-macos-v[\d.]+\.zip$/ : platform === "win32" ? /^edgetx-cpn-win64-v[\d.]+\.zip$/ : null),
    inside: (platform) => (platform === "darwin" ? /^edgetx-companion-[\d.]+\.dmg$/ : platform === "win32" ? /^companion-windows-[\d.]+\.exe$/ : null),
  },
};

/** A version as its numbers: "v1.8.3" and "1.8.3" are both [1, 8, 3]. Null when it isn't one. */
export function versionOf(text) {
  const found = /^v?(\d+(?:\.\d+){1,3})$/.exec(String(text ?? "").trim());
  return found ? found[1] : null;
}

/** The family a version is in: "2.12.5" is in 2.12. */
export const familyOf = (version) => String(version ?? "").split(".").slice(0, 2).join(".");

/** Which family a file's name says it is, by a pattern with `*` for the family: "" when the
 *  pattern has none, and null when the name isn't the program's. */
export function familyIn(pattern, name) {
  const parts = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const found = new RegExp(`^${parts.join("(\\d+\\.\\d+)")}$`).exec(String(name ?? ""));
  return found ? found[1] ?? "" : null;
}

/** A pattern's name for a version: "EdgeTX Companion *.app" is "EdgeTX Companion 2.12.app" for 2.12.5. */
export const nameFor = (pattern, version) => pattern.replace("*", familyOf(version));

/** Whether a release goes in beside the copy that is there, which stays, rather than in its place. */
export const goesBeside = (program, here, version) => program.mac.includes("*") && Boolean(here) && familyOf(here) !== familyOf(version);

/** The version Windows has written down for a program, from what `reg query` says. */
export function registryVersion(told) {
  const found = /^\s*DisplayVersion\s+REG_SZ\s+(\S+)\s*$/m.exec(String(told ?? ""));
  return found ? versionOf(found[1]) : null;
}

/**
 * What a project's newest release holds for this kind of computer, from what GitHub says about
 * it: `{ version, file, address, size, sums, sha256, notes, page, published }`. `sums` is the
 * address of the file that lists the checksums, and `sha256` the checksum GitHub keeps for the
 * file, for a project that publishes no list. Null when the release has nothing for this computer,
 * nothing to check it against, or isn't a finished release.
 */
export function releaseOf(program, told, platform, arch) {
  if (!told || typeof told !== "object" || told.draft || told.prerelease || !Array.isArray(told.assets)) return null;
  const version = versionOf(told.tag_name), wanted = program.asset(platform, arch), list = program.sums?.(platform);
  if (!version || !wanted || (program.sums && !list)) return null;
  const ours = (asset) => typeof asset?.name === "string" && typeof asset.browser_download_url === "string" && asset.browser_download_url.startsWith(`https://github.com/${program.repository}/releases/download/`);
  const file = told.assets.find((asset) => ours(asset) && wanted.test(asset.name));
  const sums = list ? told.assets.find((asset) => ours(asset) && asset.name === list) : null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(typeof file?.digest === "string" ? file.digest : "");
  if (!file || (list ? !sums : !digest)) return null;
  return {
    version, file: file.name, address: file.browser_download_url, size: Number(file.size) || 0,
    sums: sums ? sums.browser_download_url : null, sha256: list ? null : digest[1].toLowerCase(),
    notes: typeof told.body === "string" ? told.body : "", page: typeof told.html_url === "string" ? told.html_url : program.page,
    published: typeof told.published_at === "string" ? told.published_at : null,
  };
}

/**
 * The checksum a release publishes for one of its files: SHA-512, in base64, as the list that
 * comes with the release gives it. The list is the small YAML file the project's own updater
 * reads: a `- url:` line for each file with its `sha512:` under it. Null when the file isn't in it.
 */
export function publishedSum(list, file) {
  const lines = String(list ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const named = /^\s*-?\s*(?:url|path):\s*(.+?)\s*$/.exec(lines[index]);
    if (!named || named[1].replace(/^['"]|['"]$/g, "") !== file) continue;
    for (let next = index + 1; next < lines.length && !/^\s*-\s/.test(lines[next]); next += 1) {
      const sum = /^\s*sha512:\s*([A-Za-z0-9+/]{86}==)\s*$/.exec(lines[next]);
      if (sum) return sum[1];
    }
  }
  return null;
}

/** A release's notes as plain lines for a pilot to read: the headings, links and marks of
 *  Markdown taken out, and no more than `most` lines. */
export function plainNotes(notes, most = 12) {
  const lines = String(notes ?? "").split(/\r?\n/)
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/^\s*#+\s*/, "").replace(/^\s*[-*•+]\s+/, "- ").replace(/[*_`]/g, "").trimEnd())
    .filter((line) => line.trim() !== "" && !/^\s*(-\s*)?$/.test(line));
  return lines.length > most ? [...lines.slice(0, most), "…"] : lines;
}

/** A size for reading: 201 MB. */
export const megabytes = (bytes) => `${Math.round(bytes / 1048576)} MB`;
