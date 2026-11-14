// Whether WS3 Unlocked, the WhoopStor's firmware, has a newer release than the charger's (see
// shared/ws3.js and main/firmware.js): a few words beside the firmware on the Batteries page, and a
// note on Home's Batteries card when there is one.

import { app, ask } from "../core.js";
import { h, plain, when } from "../ui.js";
import { firmwareNews, ws3Releases } from "../../shared/ws3.js";

const day = (moment) => new Date(moment).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const flashing = "The Hangar never flashes the charger: the release page says how, with the project's own flasher.";

const newsOf = (seen) => (seen ? firmwareNews(app.state.ws3, seen.p1, seen.p2, seen.name) : null);

/** Beside "Firmware 0.2-beta.6": "newest", or the newer release as a link to its page. */
export function ws3News(seen) {
  const news = newsOf(seen);
  if (!news) return null;
  const looked = news.checked ? ` Looked at ${when(news.checked)}; it's looked at again once a day while the WhoopStor is connected.` : "";
  if (!news.newer) {
    return [h("span", "·"), h("span", { probe: "ws3 current", help: `No newer WS3 Unlocked on its Releases page than the ${news.mine} on this charger.${looked}` }, "the newest")];
  }
  const out = news.latest.published ? ` (${day(news.latest.published)})` : "";
  return [h("span", "·"), plain(`${news.latest.words} is out${out}`, () => ask("openLink", news.latest.url), {
    icon: "arrowUpRight", class: "ws3-newer", probe: "ws3 newer",
    help: `WS3 Unlocked ${news.latest.words} is on the project's Releases page; this charger has ${news.mine}. Opens its notes in your browser. ${flashing}${looked}`,
  })];
}

/** On Home's Batteries card, only when a newer release is out. */
export function ws3Note(seen) {
  const news = newsOf(seen);
  if (!news?.newer) return null;
  return h("p.small.home-note.ws3-note", { probe: "home ws3" },
    `WS3 Unlocked ${news.latest.words} is out; your WhoopStor has ${news.mine}. `,
    plain("Release notes", () => ask("openLink", news.latest.url ?? ws3Releases), { icon: "arrowUpRight", class: "ws3-newer", help: flashing }));
}
