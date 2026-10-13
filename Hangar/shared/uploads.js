// Uploading a finished video to YouTube, TikTok and Instagram, through each site's own upload page
// shown inside the app. No developer account or app review is involved: the pilot signs in on the
// site's own page, once, and presses its own Post button. The app puts the video in for them,
// named for what it is, has the words for each site ready (a title and a description for
// YouTube, a caption for TikTok and Instagram), and for YouTube keeps the video's link for the
// entry form. Nothing here touches the disk or the network, so it can be tested by itself.

/**
 * Where a video can go. `shape` is the finished video each takes: "landscape" (16:9) or
 * "upright" (9:16). Sites that share a sign-in share a corner of the browser (`partition`).
 * The video is only ever put into a chooser on one of the site's own `hosts`, on a page whose
 * path matches `pages` when there is one, and inside a dialog when `inDialog` (so never into the
 * chooser of a message being written). `findsLink`: the page shows the video's link once it is
 * going up. `keepsLink`: that link is the one the run's entry form wants.
 */
export const sites = {
  youtube: {
    title: "YouTube", shape: "landscape",
    address: "https://www.youtube.com/upload",
    partition: "persist:upload-google",
    hosts: ["studio.youtube.com", "www.youtube.com"],
    findsLink: true, keepsLink: true,
  },
  shorts: {
    title: "YouTube Shorts", shape: "upright",
    address: "https://www.youtube.com/upload",
    partition: "persist:upload-google",
    hosts: ["studio.youtube.com", "www.youtube.com"],
    findsLink: true, keepsLink: false,
  },
  tiktok: {
    title: "TikTok", shape: "upright",
    address: "https://www.tiktok.com/tiktokstudio/upload",
    partition: "persist:upload-tiktok",
    hosts: ["www.tiktok.com"],
    pages: "^/(tiktokstudio/upload|upload|creator)",
    findsLink: false, keepsLink: false,
  },
  instagram: {
    title: "Instagram", shape: "upright",
    address: "https://www.instagram.com/",
    partition: "persist:upload-instagram",
    hosts: ["www.instagram.com"],
    inDialog: true,
    pages: "^/(?!direct/)",
    findsLink: false, keepsLink: false,
  },
};

/** The sites that take a video of a shape, in the order they are offered. */
export const sitesFor = (shape) => Object.keys(sites).filter((id) => sites[id].shape === shape);

/** What to do on each site once it is open, in a line or two. */
export const howTo = {
  youtube: "Sign in if it asks. Your video goes in by itself, or drag it onto the page. The title is on the clipboard: paste it over YouTube's, then copy the description and paste it below. Choose who can see it and press Publish.",
  shorts: "Sign in if it asks. Your video goes in by itself, or drag it onto the page. A 9:16 video up to three minutes long goes up as a Short. The title is on the clipboard: paste it over YouTube's, then copy the description and paste it below. Press Publish.",
  tiktok: "Log in if it asks. Your video goes in by itself, or drag it onto the page. Paste the caption and press Post.",
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
  if (!site.hosts.includes(url.hostname)) return false;
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

/**
 * The link of the video going up, from what the page reads (`readPage`). YouTube shows it in its
 * upload dialog as soon as the video starts going up, and that is taken first. Failing that, once
 * the app has put the video in (`put`), a link that wasn't on the page before then (`before`):
 * the list of the channel's other videos behind the dialog has theirs.
 */
export function uploadLink(read, before, put) {
  const inDialog = videoLinkIn(read?.dialog);
  if (inDialog) return inDialog;
  if (!put) return null;
  return videoLinksIn(read?.all).find((link) => !before.has(link)) ?? null;
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

/** The script that reads a site's page, shadows and all, for a video's link: the words and links
 *  in its upload dialog, and in the whole page. */
export const readPage = `(() => {
  const words = (root) => {
    const parts = [];
    const look = (at) => {
      for (const element of at.querySelectorAll("a[href]")) parts.push(element.href);
      for (const element of at.querySelectorAll("*")) if (element.shadowRoot) {
        parts.push(element.shadowRoot.textContent || "");
        look(element.shadowRoot);
      }
    };
    look(root);
    parts.push(root.innerText || root.textContent || "");
    return parts.join("\\n");
  };
  const dialogs = [...document.querySelectorAll("ytcp-uploads-dialog")];
  return JSON.stringify({ dialog: dialogs.map(words).join("\\n"), all: document.body ? words(document.body) : "" });
})()`;
