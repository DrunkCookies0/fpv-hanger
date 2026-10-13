// How many views, likes and comments a run's YouTube videos have, asked of YouTube's own data
// service with the pilot's own key (see shared/counts.js). What YouTube said is remembered for a
// while, so going from track to track doesn't ask again each time. A copy trying itself out asks
// only a page of its own standing in for YouTube, never YouTube.

import { service, most, countsAddress, keyAddress, readCounts, countsProblem } from "../shared/counts.js";
import { log } from "./paths.js";

/** How long what YouTube said is good for, unless the pilot asks again. */
const fresh = 10 * 60 * 1000;

/** `key()` is the pilot's key, or "". `quiet` is a copy trying itself out. */
export function makeCounts({ key, quiet = false, fetcher = fetch }) {
  let base = quiet ? null : service;
  /** Each video's counts as last read: id → { views, likes, comments, read }. */
  const known = new Map();

  /** Asks YouTube one question. Its answer, or { problem }. */
  async function ask(address) {
    try {
      const answer = await fetcher(address, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await answer.json().catch(() => null);
      return answer.ok ? { body } : { problem: countsProblem(answer.status, body) };
    } catch (error) {
      log(`YouTube's counts: ${error.message}`);
      return { problem: "YouTube couldn't be reached. Check the connection." };
    }
  }

  return {
    /**
     * The counts of some YouTube videos, by id: { counts, problem }. Those read in the last ten
     * minutes aren't asked for again, unless `again`. Without a key there are none, and `needsKey`.
     */
    async countsOf(ids, { again = false } = {}) {
      const mine = key().trim();
      if (mine === "") return { counts: {}, problem: null, needsKey: true };
      const now = Date.now();
      const wanted = [...new Set(ids)].filter((id) => again || !known.has(id) || now - known.get(id).read > fresh);
      let problem = null;
      if (base) {
        for (let at = 0; at < wanted.length; at += most) {
          const some = wanted.slice(at, at + most);
          const answer = await ask(countsAddress(base, some, mine));
          if (answer.problem) {
            problem = answer.problem;
            break;
          }
          const read = readCounts(answer.body);
          // A video YouTube didn't give is private or gone: it has no counts to show.
          for (const id of some) {
            if (read[id]) known.set(id, { ...read[id], read: now });
            else known.delete(id);
          }
        }
      }
      const counts = {};
      for (const id of ids) if (known.has(id)) counts[id] = known.get(id);
      return { counts, problem, needsKey: false };
    },

    /** Tries a key out with YouTube. What is wrong with it, or null when it works. */
    async tryKey(candidate) {
      const mine = String(candidate ?? "").trim();
      if (mine === "") return null;
      if (!base) return "YouTube can't be asked from this copy.";
      const answer = await ask(keyAddress(base, mine));
      return answer.problem ?? null;
    },

    /** Forgets what YouTube said, as when the key changes. */
    forget() {
      known.clear();
    },

    /** For the app's checks of itself: a page of its own to stand in for YouTube's service. */
    useStandIn(address) {
      if (quiet) base = address;
      known.clear();
    },
  };
}
