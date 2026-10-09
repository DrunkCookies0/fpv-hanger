// The season's leaderboards, as the series keeps them in a spreadsheet anyone can read: a tab for
// each track with every entry in order, and tabs for the season's standings. The app reads them as
// they stand. Nothing of them is part of the app: what is kept is a copy of the last reading, to
// show when there is no network, and it can always be read again.

import { rows } from "./series.js";

/** The series' leaderboard spreadsheet. */
export const sheet = "https://docs.google.com/spreadsheets/d/1NlHUmlZBcdx-xbylgw_E51gP1FyMtYXIHR79ptQF9iA";
/** The page of it that lists its tabs, and one tab as comma-separated text. */
export const tabsPage = `${sheet}/htmlview`;
export const tabAddress = (gid) => `${sheet}/export?format=csv&gid=${gid}`;

const tidy = (cell) => String(cell ?? "").replace(/\s+/g, " ").trim();

/** The tabs of the spreadsheet, from its page: each one's name and the number its sheet goes by. */
export function tabsIn(html) {
  const found = [];
  for (const match of html.matchAll(/items\.push\(\{\s*name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)) {
    // The name is written the way a script writes text: a few characters are spelt out.
    const name = match[1].replace(/\\x([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/\\(.)/g, "$1");
    if (!found.some((tab) => tab.gid === match[2])) found.push({ name: tidy(name), gid: match[2] });
  }
  return found;
}

/** A track's number from its tab's name: "Track1", "Track 12". Null for any other tab. */
export function trackOf(name) {
  const match = /^\s*track\s*(\d+)\s*$/i.exec(name);
  return match ? Number(match[1]) : null;
}

/** A time as the sheet gives it, in seconds: "13.580", or "1:02.345". Null for anything else, such as "TBD". */
export function seconds(cell) {
  const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(tidy(cell));
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : null;
}

/** A link to a video, when it is one on YouTube. Anything else a pilot typed there isn't offered to click. */
export function videoLink(cell) {
  try {
    const link = new URL(tidy(cell));
    const host = link.hostname.toLowerCase().replace(/^(www|m)\./, "");
    return link.protocol === "https:" && (host === "youtube.com" || host === "youtu.be") ? link.href : null;
  } catch {
    return null;
  }
}

/** How many rows and columns of a tab that isn't a track's are shown, and how long a cell can be. */
const most = { rows: 300, columns: 8, cell: 80 };

/**
 * What a tab holds, from its comma-separated text.
 *   { kind: "soon", says }                     it says only that it is coming
 *   { kind: "track", number, entries }         a track's entries in the sheet's order, each
 *                                              { rank, id, pilot, time, official, video }
 *   { kind: "table", headers, rows }           anything else with rows in it, shown as it is
 */
export function boardIn(name, csv) {
  const all = rows(csv).map((row) => row.map(tidy)).filter((row) => row.some((cell) => cell !== ""));
  const filled = all.flat().filter((cell) => cell !== "");
  if (filled.length <= 1) return { name, kind: "soon", says: filled[0] ?? "" };
  const heads = all[0].map((cell) => cell.toLowerCase());
  const column = (test) => heads.findIndex(test);
  const at = {
    rank: column((head) => head.includes("rank")), id: column((head) => head.includes("reg")), pilot: column((head) => head.includes("pilot")),
    unofficial: column((head) => head.includes("unofficial")), official: column((head) => head.includes("official") && !head.includes("unofficial")),
    video: column((head) => head.includes("video")),
  };
  const number = trackOf(name);
  if (number !== null && at.pilot >= 0 && (at.unofficial >= 0 || at.official >= 0)) {
    const entries = [];
    for (const row of all.slice(1)) {
      // The official time once there is one. Until then the one the pilot sent in.
      const official = at.official >= 0 ? seconds(row[at.official]) : null;
      const time = official ?? (at.unofficial >= 0 ? seconds(row[at.unofficial]) : null);
      const pilot = tidy(row[at.pilot]);
      if (pilot === "" || time === null) continue;
      entries.push({ rank: at.rank >= 0 ? tidy(row[at.rank]) : "", id: at.id >= 0 ? tidy(row[at.id]) : "", pilot, time, official: official !== null, video: at.video >= 0 ? videoLink(row[at.video]) : null });
    }
    return { name, kind: "track", number, entries };
  }
  const width = Math.min(most.columns, Math.max(...all.map((row) => row.length)));
  const cut = (row) => Array.from({ length: width }, (_, index) => (row[index] ?? "").slice(0, most.cell));
  return { name, kind: "table", headers: cut(all[0]), rows: all.slice(1, most.rows + 1).map(cut) };
}

/**
 * Which entry is the pilot's own: the one with their number, where they have one, or else the one
 * in their name. A pilot can be there more than once, and the tab is in order, so the first is
 * their best. -1 when they aren't there.
 */
export function placeOf(entries, { id = "", name = "" }) {
  const number = /^\s*\d+\s*$/.test(id) ? Number.parseInt(id, 10) : null;
  const called = tidy(name).toLowerCase();
  if (number !== null) {
    const byNumber = entries.findIndex((entry) => /^\d+$/.test(entry.id) && Number.parseInt(entry.id, 10) === number);
    if (byNumber >= 0) return byNumber;
  }
  return called === "" ? -1 : entries.findIndex((entry) => entry.pilot.toLowerCase() === called);
}

/** First, second, third: "43rd". */
export function ordinal(place) {
  const tens = place % 100, ones = place % 10;
  return `${place}${tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

/**
 * Reads every tab as it stands now. Gives { read, tabs }: when it was read, and each tab as
 * `boardIn` has it, or { kind: "unread", problem } for one that couldn't be had. Throws when the
 * spreadsheet itself can't be reached.
 */
export async function readBoards(fetcher = fetch, now = new Date()) {
  const page = await fetcher(tabsPage);
  if (!page.ok) throw new Error(`the leaderboard spreadsheet answered ${page.status}`);
  let tabs = tabsIn(await page.text());
  // If its page is ever laid out another way, the first tab can still be read by its number.
  if (tabs.length === 0) tabs = [{ name: "Track1", gid: "0" }];
  const boards = [];
  for (const tab of tabs.slice(0, 40)) {
    try {
      const answer = await fetcher(tabAddress(tab.gid));
      if (!answer.ok) throw new Error(`it answered ${answer.status}`);
      boards.push(boardIn(tab.name, await answer.text()));
    } catch (error) {
      boards.push({ name: tab.name, kind: "unread", problem: error.message });
    }
  }
  return { read: now.toISOString(), tabs: boards };
}
