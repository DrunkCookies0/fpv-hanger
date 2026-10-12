// Other projects' tools that the app brings in.
//
// Two of them are web apps and are shown inside the app's window, from the project's own site, so
// they are always that project's newest release and nothing of theirs is carried by the app. The
// third is a program of its own: the app fetches it from the project's own Releases page, checks it
// against the checksum published there, and says when a newer one is out. Reading a release is
// here; fetching and putting it in place is main/components.js.

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

/** The programs the app fetches and keeps up to date. `asset` picks a release's file for a kind
 *  of computer, and `sums` names the file on the release that lists its checksums. */
export const programs = {
  elrsConfigurator: {
    title: "ExpressLRS Configurator",
    owner: "ExpressLRS",
    repository: "ExpressLRS/ExpressLRS-Configurator",
    page: "https://github.com/ExpressLRS/ExpressLRS-Configurator/releases",
    bundle: "ExpressLRS Configurator.app",
    program: "ExpressLRS Configurator.exe",
    asset: (platform, arch) => (platform === "darwin" ? (arch === "arm64" ? /-arm64\.dmg$/ : /-x64\.dmg$/) : platform === "win32" ? /^ExpressLRS-Configurator-Setup-.*\.exe$/ : null),
    sums: (platform) => (platform === "darwin" ? "latest-mac.yml" : platform === "win32" ? "latest.yml" : null),
  },
};

/** A version as its numbers: "v1.8.3" and "1.8.3" are both [1, 8, 3]. Null when it isn't one. */
export function versionOf(text) {
  const found = /^v?(\d+(?:\.\d+){1,3})$/.exec(String(text ?? "").trim());
  return found ? found[1] : null;
}

/**
 * What a project's newest release holds for this kind of computer, from what GitHub says about
 * it: `{ version, file, address, size, sums, notes, page, published }`. `sums` is the address of
 * the file that lists the checksums. Null when the release has nothing for this computer, or isn't
 * a finished release.
 */
export function releaseOf(program, told, platform, arch) {
  if (!told || typeof told !== "object" || told.draft || told.prerelease || !Array.isArray(told.assets)) return null;
  const version = versionOf(told.tag_name), wanted = program.asset(platform, arch), list = program.sums(platform);
  if (!version || !wanted) return null;
  const ours = (asset) => typeof asset?.name === "string" && typeof asset.browser_download_url === "string" && asset.browser_download_url.startsWith(`https://github.com/${program.repository}/releases/download/`);
  const file = told.assets.find((asset) => ours(asset) && wanted.test(asset.name));
  const sums = told.assets.find((asset) => ours(asset) && asset.name === list);
  if (!file || !sums) return null;
  return {
    version, file: file.name, address: file.browser_download_url, size: Number(file.size) || 0, sums: sums.browser_download_url,
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
