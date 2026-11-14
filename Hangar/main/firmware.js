// Looks at WS3 Unlocked's Releases page once a day for a newer version of the WhoopStor's firmware
// (see shared/ws3.js). It only reads the project's public page, as anyone's browser would, and
// sends nothing of the pilot's. Nothing is downloaded or flashed: the Batteries page says when a
// newer one is out and links to it.
//
//   --ws3-feed <folder>   read releases.json and tags.json from this folder in place of GitHub,
//                         for trying this out (a copy without a window looks only there)

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argument, config, setConfig, log } from "./paths.js";
import { ws3Repository, releasesFrom } from "../shared/ws3.js";

/** How long a look stays good. */
const DAY = 20 * 3600 * 1000;

async function read(what) {
  const folder = argument("--ws3-feed");
  if (folder) {
    const file = join(resolve(folder), `${what}.json`);
    if (!existsSync(file)) throw new Error(`there is no ${what}.json in ${folder}`);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const answer = await fetch(`https://api.github.com/repos/${ws3Repository}/${what}?per_page=50`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "FPV-Hangar", Accept: "application/vnd.github+json" },
  });
  if (!answer.ok) throw new Error(`its Releases page answered ${answer.status}`);
  return answer.json();
}

/** `ws3Now` for what is known, `checkWs3` to look again, and `ws3IfDue` for the look the Batteries
 *  page asks for once it hears a WhoopStor's firmware. */
export function makeFirmwareCheck({ tell, quiet }) {
  let busy = false, problem = null;
  const kept = () => config().ws3 ?? {};

  const api = {
    /** The releases known of, newest first, when they were looked at, and why the last look failed. */
    ws3Now() {
      const { releases = [], checked = null } = kept();
      return { releases, checked, checking: busy, problem };
    },

    /** Looks at the project's page. */
    async checkWs3() {
      if (busy) return api.ws3Now();
      if (quiet && !argument("--ws3-feed")) return api.ws3Now();
      busy = true;
      tell("changed");
      try {
        const [releases, tags] = await Promise.all([read("releases"), read("tags")]);
        const found = releasesFrom(releases, tags);
        problem = null;
        setConfig({ ws3: { releases: found, checked: new Date().toISOString() } });
      } catch (error) {
        problem = `Couldn't look for a newer WS3 Unlocked: ${error.message}.`;
        log(problem);
      }
      busy = false;
      tell("changed");
      return api.ws3Now();
    },

    /** Looks again when the last look is more than most of a day old. */
    ws3IfDue(now = Date.now()) {
      const checked = Date.parse(kept().checked ?? "");
      if (!busy && !(now - checked < DAY)) api.checkWs3();
      return api.ws3Now();
    },
  };
  return api;
}
