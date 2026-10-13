// Uploading a finished video to YouTube, TikTok and Instagram, through each site's own upload page.
// No developer account or app review is involved: the pilot signs in on the site's own page and
// presses its own Post button. TikTok's and Instagram's pages are shown inside the app, and the
// app puts the video in for them. YouTube's opens in the pilot's own browser, because Google
// doesn't let anyone sign in inside an app's browser; there the video is dragged in from the app,
// and the video's link, copied from YouTube, comes back to the app for the entry form. Either way
// the video goes up named for what it is, with the words for each site ready (a title and a
// description for YouTube, a caption for TikTok and Instagram), and its link on each site can be
// kept with its run, as the run's log of where it went up. Nothing here touches the disk or the
// network, so it can be tested by itself.

/**
 * Where a video can go. `shape` is the finished video each takes: "landscape" (16:9) or
 * "upright" (9:16). `browser`: its upload page opens in the pilot's own browser, not in the app.
 * `keepsLink`: the video's link there is the one the run's entry form wants. `example` is how a
 * video's link there looks.
 *
 * A page shown in the app has a corner of the browser of its own (`partition`), kept between
 * runs. The video is only ever put into a chooser on one of the site's own `hosts`, on a page
 * whose path matches `pages` when there is one, and inside a dialog when `inDialog` (so never into
 * the chooser of a message being written).
 */
export const sites = {
  youtube: {
    title: "YouTube", shape: "landscape", browser: true, keepsLink: true,
    address: "https://www.youtube.com/upload", example: "https://youtu.be/…",
  },
  shorts: {
    title: "YouTube Shorts", shape: "upright", browser: true, keepsLink: false,
    address: "https://www.youtube.com/upload", example: "https://youtube.com/shorts/…",
  },
  tiktok: {
    title: "TikTok", shape: "upright", browser: false, keepsLink: false,
    address: "https://www.tiktok.com/tiktokstudio/upload", example: "https://www.tiktok.com/@…/video/…",
    partition: "persist:upload-tiktok",
    hosts: ["www.tiktok.com"],
    pages: "^/(tiktokstudio/upload|upload|creator)",
  },
  instagram: {
    title: "Instagram", shape: "upright", browser: false, keepsLink: false,
    address: "https://www.instagram.com/", example: "https://www.instagram.com/reel/…",
    partition: "persist:upload-instagram",
    hosts: ["www.instagram.com"],
    inDialog: true,
    pages: "^/(?!direct/)",
  },
};

/** The sites that take a video of a shape, in the order they are offered. */
export const sitesFor = (shape) => Object.keys(sites).filter((id) => sites[id].shape === shape);

/** What to do on a site whose page is shown in the app, in a line or two. */
export const howTo = {
  tiktok: "Log in if it asks, with your email, phone or username: Google's sign-in doesn't work inside an app. Your video goes in by itself, or drag it onto the page. Paste the caption and press Post.",
  instagram: "Log in if it asks, then press Create and choose Post. Your video goes in by itself once Instagram asks for one, or drag it onto its window. It goes up as a Reel. Paste the caption and press Share.",
};

/** Whether a page is one the video may be put into on a site: one of its hosts, and its upload
 *  page there when it has one. */
export function mayTakeVideo(site, address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!site.hosts?.includes(url.hostname)) return false;
  return !site.pages || new RegExp(site.pages).test(url.pathname);
}

/** A hashtag made of words: "RaceGOW6" stays, "Circle City FPV" becomes "#CircleCityFPV". */
export function hashtag(words) {
  const joined = String(words ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
  return joined === "" ? null : `#${joined}`;
}

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-09-21" as "21 September 2026". */
export function dayInWords(date) {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  return found ? `${Number(found[3])} ${months[Number(found[2]) - 1]} ${found[1]}` : "";
}

/** The hashtags each site gets, the most telling first: YouTube shows the first three over a
 *  video's title. */
const tagsFor = {
  youtube: ["#fpv", "#tinywhoop", "#fpvracing"],
  shorts: ["#fpv", "#tinywhoop", "#fpvracing", "#shorts"],
  tiktok: ["#fpv", "#tinywhoop", "#fpvracing", "#whoop"],
  instagram: ["#fpv", "#tinywhoop", "#fpvracing", "#whoop", "#fpvdrone", "#reels"],
};

/** Puts lines together, with a blank line between each group of them. Empty ones are left out. */
const together = (...groups) => groups.map((group) => [group].flat().filter(Boolean).join("\n")).filter(Boolean).join("\n\n");

/** Cuts words down to a length, at a space where it can. */
function fit(text, most) {
  if (text.length <= most) return text;
  const cut = text.slice(0, most - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > most / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The words that go up with a video on each site, made from what is known about its run. `about`
 * is { pilot, id, idLabel, event, race, date, best, window, bestLap, laps, song }, any of which can
 * be missing. `own` is lines of the pilot's own that go on every one, such as their gear or links.
 *
 * YouTube and YouTube Shorts get a title of up to 100 characters and a description. TikTok and
 * Instagram have one caption, which comes back as the description, with no title. `name` is what
 * the video file is called when it goes up: YouTube and TikTok start from it.
 */
export function words(site, about = {}, own = "") {
  const { pilot = "", id = "", idLabel = "ID", event = "", race = "", date = "", best = null, window = 3, bestLap = null, laps = [], song = "" } = about;
  // A season's track is called "Track 1" by itself, so its series goes with it. A race has a name of its own.
  const numbered = /^Track \d+$/i.test(race);
  const where = (numbered ? [event, race] : [race || event]).filter(Boolean).join(" ") || "FPV";
  const time = best ? `${best} best ${window} laps in a row` : "";
  const day = dayInWords(date);
  const who = pilot ? `${pilot}${id ? ` (${idLabel} ${id})` : ""}` : "";
  const music = song ? `Music: ${String(song).replace(/\.[a-z0-9]{2,4}$/i, "")}` : "";
  const facts = [
    best && `Best ${window} laps in a row: ${best}`,
    bestLap && `Best lap: ${bestLap}`,
    laps.length > 0 && `Laps: ${laps.join(" · ")}`,
  ];
  const tags = [...new Set([...tagsFor[site] ?? tagsFor.youtube, hashtag(event)].filter(Boolean))].join(" ");
  const mine = String(own ?? "").trim();
  // Who flew where, and when: "Test Pilot flying Spring Cup with Circle City FPV, 11 April 2026."
  const story = `${[who || "Flying", who ? "flying" : null, numbered ? where : race || where, !numbered && race && event ? `with ${event}` : null].filter(Boolean).join(" ")}${day ? `, ${day}` : ""}.`;

  if (site === "youtube" || site === "shorts") {
    const tail = site === "shorts" ? " #shorts" : "";
    const lead = [where, best ? `${best} best ${window} laps` : ""].filter(Boolean).join(" · ");
    const withPilot = pilot ? `${lead} | ${pilot}` : lead;
    const title = (withPilot + tail).length <= 100 ? withPilot + tail : fit(lead, 100 - tail.length) + tail;
    const description = site === "youtube"
      ? together(story, facts, music, mine, tags)
      : together([`${where}${time ? `: ${time}` : ""}`, who && `Flown by ${who}`], music, mine, tags);
    return { title, description, name: fileName(pilot ? `${lead} - ${pilot}` : lead) };
  }
  const first = `${where}${time ? `: ${time}` : ""}`;
  const description = site === "tiktok"
    ? together([first, who && `Flown by ${who}`, music], mine, tags)
    : together([first, who && `Flown by ${who}`], facts, music, mine, tags);
  return { title: null, description, name: fileName([where, time, pilot].filter(Boolean).join(" - ")) };
}

/** Words made fit to be a file's name on a Mac and on Windows: plain letters, numbers and marks
 *  (a page's file chooser can turn away others without a word), none that either keeps for
 *  itself, and not too long. Empty when nothing is left. */
export function fileName(text) {
  const plain = String(text ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[·•–—]/g, "-").replace(/[^\x20-\x7e]+/g, " ");
  return fit(plain.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, ""), 120).replace(/…$/, "");
}

const videoLink = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?(?:[^\s"'<>]*&)?v=|embed\/))([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/g;

/** Every YouTube video's address in some text, each made the same short way
 *  ("https://youtu.be/<id>"), once, in the order they come. */
export function videoLinksIn(text) {
  return [...new Set([...String(text ?? "").matchAll(videoLink)].map((found) => `https://youtu.be/${found[1]}`))];
}

/** The first YouTube video's address in some text, or null. */
export const videoLinkIn = (text) => videoLinksIn(text)[0] ?? null;

/** How a video's link is written on TikTok (the long way, or the short one its Share gives) and
 *  on Instagram (a reel, or a post), for finding one in some text. */
const linkWays = {
  tiktok: /(?:https?:\/\/)?(?:(?:www\.|m\.)?tiktok\.com\/(?:@[\w.-]+\/(?:video|photo)\/\d+|t\/[\w-]+)|(?:vm|vt)\.tiktok\.com\/[\w-]+)/i,
  instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:reels?|p)\/[\w-]+/i,
};

/** The first link to a video on a site in some text, written one way (YouTube's the short way),
 *  or null. */
export function linkFor(site, text) {
  if (site === "youtube" || site === "shorts") return videoLinkIn(text);
  const found = linkWays[site]?.exec(String(text ?? ""));
  return found ? `https://${found[0].replace(/^https?:\/\//i, "")}` : null;
}

/** A video's link on a site when that is all the text is, as when it was copied with the site's
 *  own copy button, or null: an address in among other words, such as a description, isn't one. */
export const linkAlone = (site, text) => (/^\S+$/.test(String(text ?? "").trim()) ? linkFor(site, text) : null);

/**
 * Where a run's videos went up: { [site]: { link, at } }, in the order the sites are offered, from
 * a track's state. `at` is when it was kept, or null when that isn't known. YouTube's is the link
 * the run's entry form has, wherever it was put in.
 */
export function uploadsOf(state, run) {
  const logged = state?.uploads?.[run] ?? {};
  const all = {};
  for (const site of Object.keys(sites)) {
    if (site === "youtube") {
      const link = videoLinkIn(state?.links?.[run]);
      if (link) all.youtube = { link, at: logged.youtube?.link === link ? logged.youtube.at ?? null : null };
    } else if (logged[site]?.link) {
      all[site] = { link: logged[site].link, at: logged[site].at ?? null };
    }
  }
  return all;
}

/**
 * The script run in a site's page to find where its video goes: the page's own file chooser, in
 * the page or inside any of its parts' shadows. One that takes video, or anything, is taken;
 * one only for pictures or words isn't. With `inDialog`, only one inside a dialog. It gives the
 * chooser itself, for the browser to put the file in.
 */
export function chooserScript({ inDialog = false } = {}) {
  return `(() => {
  const all = [];
  const look = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.tagName === "INPUT" && element.type === "file") all.push(element);
      if (element.shadowRoot) look(element.shadowRoot);
    }
  };
  look(document);
  const takes = (input) => {
    const accept = (input.getAttribute("accept") || "").toLowerCase();
    return accept === "" || accept.includes("video") || accept.includes(".mp4") || accept.includes("*");
  };
  const inDialog = (input) => {
    for (let at = input; at; at = at.parentElement || (at.getRootNode && at.getRootNode().host) || null) {
      if (at.getAttribute && (at.getAttribute("role") === "dialog" || at.tagName === "DIALOG")) return true;
    }
    return false;
  };
  return all.find((input) => !input.disabled && takes(input) && (${inDialog ? "inDialog(input)" : "true"})) || null;
})()`;
}

/** Whether a page is Google turning away a sign-in, as it does in an app's own browser: "This
 *  browser or app may not be secure", or the same for a site's "Continue with Google". */
export const googleSaysNo = (address) => /^https:\/\/accounts\.google\.com\/\S*(rejected|oauth\/error|disallowed_useragent)/i.test(String(address ?? ""));
