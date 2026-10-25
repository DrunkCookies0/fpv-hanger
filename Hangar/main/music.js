// Finding music: the pilot's Spotify, and the catalogs of NCS and SoundScout, read for Find music
// in the marker editor (see shared/music.js and shared/catalogs.js).
//
// Spotify is signed in to in the pilot's own browser, through an app of their own in Spotify for
// Developers: the browser comes back to an address on this computer that only FPV Hangar listens
// on, for as long as it waits for it. The key Spotify gives is kept in this computer's own
// settings, not in the library, so a library in Google Drive doesn't carry it: each computer
// connects for itself. It only reads the pilot's Liked Songs and the artists they play most.
//
// A copy trying itself out asks only a service of its own standing in for all of them, never
// Spotify, NCS or SoundScout.

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as spotify from "../shared/spotify.js";
import { catalogs, ncs, ncsCredit } from "../shared/catalogs.js";
import { config, setConfig, log } from "./paths.js";

/** How long the pilot's Spotify as read is good for. A catalog says for itself. */
const spotifyFresh = 30 * 60 * 1000;
/** How long FPV Hangar waits for the pilot in their browser. */
const signInWait = 5 * 60 * 1000;

const base64url = (bytes) => bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The page the pilot's browser shows once it has come back from Spotify. */
const backPage = (said) => `<!doctype html><meta charset="utf-8"><title>FPV Hangar</title>
<body style="font: 16px system-ui, sans-serif; background: #0b0d10; color: #fff; display: grid; place-items: center; height: 90vh; margin: 0">
<div style="max-width: 420px; text-align: center"><h1 style="font-size: 22px">${said}</h1><p style="color: rgba(255,255,255,.6)">You can close this tab and go back to FPV Hangar.</p></div>`;

/**
 * `cache` is the folder for what can be read again. `open(address)` opens a page in the pilot's
 * own browser. `tell(kind, details)` sends news to the pages. `quiet` is a copy trying itself out.
 */
export function makeMusic({ cache, open, tell = () => {}, quiet = false, fetcher = fetch }) {
  /** Where each service is: their own, or for a copy trying itself out, nowhere until a stand-in is given. */
  let bases = quiet ? null : { accounts: spotify.accounts, service: spotify.service, ...Object.fromEntries(Object.entries(catalogs).map(([key, one]) => [key, one.base])) };
  /** The key to the pilot's Spotify while it lasts, and what was last read from it. */
  let access = null, read = null;
  /** While FPV Hangar waits for the pilot in their browser: how to stop waiting. */
  let waiting = null;
  /** Each catalog as last read, and the reading of it under way, if one is. */
  const catalogsRead = new Map(), reading = new Map();

  const kept = () => config().spotify ?? {};
  const keep = (patch) => setConfig({ spotify: { ...kept(), ...patch } });

  async function ask(address, options = {}) {
    try {
      const answer = await fetcher(address, { cache: "no-store", signal: AbortSignal.timeout(20000), ...options });
      const text = await answer.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {}
      return { ok: answer.ok, status: answer.status, body, text };
    } catch (error) {
      log(`Finding music, asking ${new URL(address).hostname}: ${error.message}`);
      return { ok: false, status: 0, body: null, text: "" };
    }
  }

  /** Spotify's answer about keys: the keys, or a problem. */
  async function keysFrom(body) {
    const answer = await ask(`${bases.accounts}api/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (answer.status === 0) return { problem: "Spotify couldn't be reached. Check the connection." };
    const keys = answer.ok ? spotify.readKeys(answer.body) : null;
    return keys ? { keys } : { problem: spotify.spotifyProblem(answer.status, answer.body) };
  }

  /** A key to the pilot's Spotify, fresh if the last has run out: { key } or { problem }. */
  async function key() {
    if (access && access.expires > Date.now()) return { key: access.access };
    const { clientId, refresh } = kept();
    if (!clientId || !refresh) return { problem: "Spotify isn't connected." };
    const got = await keysFrom(spotify.refreshBody({ clientId, refresh }));
    if (got.problem) {
      // Signed out on Spotify's side: the key is no good any more.
      if (/signed FPV Hangar out/.test(got.problem)) keep({ refresh: null });
      return { problem: got.problem };
    }
    access = got.keys;
    if (got.keys.refresh) keep({ refresh: got.keys.refresh });
    return { key: access.access };
  }

  /** Asks Spotify's Web API, as the pilot: { body } or { problem }. */
  async function askSpotify(address) {
    const got = await key();
    if (got.problem) return got;
    const answer = await ask(address, { headers: { Authorization: `Bearer ${got.key}` } });
    if (answer.status === 0) return { problem: "Spotify couldn't be reached. Check the connection." };
    if (answer.status === 401) access = null;
    return answer.ok ? { body: answer.body } : { problem: spotify.spotifyProblem(answer.status, answer.body) };
  }

  /** Waits for the pilot's browser to come back from Spotify: { code, state }, { refused }, or { problem }. */
  function comeBack(expected) {
    return new Promise((done) => {
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        server.close();
        waiting = null;
        done(result);
      };
      const server = createServer((request, response) => {
        const back = spotify.cameBack(request.url ?? "");
        if (!back || back.state !== expected) {
          response.writeHead(404, { "Content-Type": "text/plain" });
          return response.end("Not here.");
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(backPage(back.refused ? "FPV Hangar wasn't let in to your Spotify." : "Your Spotify is connected."));
        finish(back);
      });
      const timer = setTimeout(() => finish({ problem: "Nothing came back from Spotify in five minutes. Press Connect to try again." }), signInWait);
      server.once("error", (error) => finish({ problem: error.code === "EADDRINUSE" ? `Something else on this computer is using the port FPV Hangar listens on for Spotify (${spotify.port}). Close it and try again.` : `FPV Hangar couldn't listen for Spotify: ${error.message}` }));
      server.listen(spotify.port, "127.0.0.1");
      waiting = () => finish({ cancelled: true });
    });
  }

  return {
    /** How Spotify stands on this computer, for Pilot & settings: { clientId, connected, name, waiting }. */
    spotifyNow() {
      const { clientId = "", refresh = null, name = null } = kept();
      return { clientId, connected: Boolean(clientId && refresh), name, waiting: waiting !== null, redirect: spotify.redirect };
    },

    /**
     * Connects the pilot's Spotify with the Client ID of their app: Spotify's page opens in their
     * browser, and once they say yes it comes back here. { problem } when it didn't work, with
     * `cancelled` when the pilot stopped it.
     */
    async connectSpotify(clientId) {
      const id = String(clientId ?? "").trim();
      if (!spotify.isClientId(id)) return { problem: "That isn't a Client ID. It is 32 letters and numbers, under your app's name in Spotify for Developers." };
      if (!bases) return { problem: "Spotify can't be asked from this copy." };
      waiting?.();
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(createHash("sha256").update(verifier).digest());
      const state = base64url(randomBytes(16));
      const coming = comeBack(state);
      open(spotify.signInAddress({ clientId: id, challenge, state, base: bases.accounts }));
      const back = await coming;
      if (back.cancelled) return { problem: null, cancelled: true };
      if (back.problem) return { problem: back.problem };
      if (back.refused) return { problem: back.refused === "access_denied" ? "You didn't let FPV Hangar in on Spotify's page, so nothing is connected." : spotify.spotifyProblem(400, { error: back.refused }) };
      const got = await keysFrom(spotify.swapBody({ clientId: id, code: back.code, verifier }));
      if (got.problem) return { problem: got.problem };
      access = got.keys;
      read = null;
      keep({ clientId: id, refresh: got.keys.refresh, name: null });
      const me = await askSpotify(spotify.meAddress(bases.service));
      if (me.body) keep({ name: me.body.display_name || me.body.id || null });
      return { problem: null };
    },

    /** Stops waiting for the pilot in their browser. */
    cancelSpotify() {
      waiting?.();
    },

    /** Forgets the pilot's Spotify on this computer. The Client ID stays, to connect again. */
    disconnectSpotify() {
      waiting?.();
      access = null;
      read = null;
      keep({ refresh: null, name: null });
    },

    /**
     * The pilot's Spotify for Find music: their Liked Songs, newest first, as songs to list and as
     * taste, and the artists they play most. Read again after half an hour, or with `again`.
     */
    async spotifyMusic({ again = false } = {}) {
      const now = this.spotifyNow();
      const none = { connected: false, needsSetup: now.clientId === "", songs: [], liked: [], top: [], problem: null };
      if (!now.connected) return none;
      if (!bases) return { ...none, connected: true, problem: "Spotify can't be asked from this copy." };
      if (read && !again && Date.now() - read.at < spotifyFresh) return read.music;
      const songs = [];
      let problem = null;
      for (let offset = 0; offset < spotify.mostLiked; offset += spotify.perPage) {
        const page = await askSpotify(spotify.likedAddress(offset, bases.service));
        if (page.problem) {
          problem = page.problem;
          break;
        }
        songs.push(...spotify.likedIn(page.body));
        if (!page.body?.next) break;
      }
      const top = await askSpotify(spotify.topArtistsAddress(bases.service));
      const music = {
        connected: this.spotifyNow().connected, needsSetup: false, songs,
        liked: songs.map((song) => ({ title: song.title, artists: song.artists })),
        top: top.body ? spotify.topArtistsIn(top.body) : [], problem: problem ?? null,
      };
      if (!problem) read = { at: Date.now(), music };
      return music;
    },

    /**
     * A catalog's songs: { songs, read, problem, reading }. Its list is kept between times, so Find
     * music opens at once and works without a connection. When it is older than the catalog says
     * it is good for, or with `again`, it is read again behind what the pilot is doing, and the
     * pages hear ("musicCatalog") how far that has got and when it is done. Only the first time,
     * with nothing kept, is the reading waited for.
     */
    async catalog(which, { again = false } = {}) {
      const catalog = catalogs[which];
      if (!catalog) return { songs: [], read: null, problem: "There is no such catalog.", reading: false };
      const file = join(cache, "Music", `${which}.json`);
      let held = catalogsRead.get(which) ?? null;
      if (!held) {
        try {
          held = JSON.parse(readFileSync(file, "utf8"));
          catalogsRead.set(which, held);
        } catch {}
      }
      if (!bases) return { songs: held?.songs ?? [], read: held?.read ?? null, problem: held ? null : `${catalog.name} can't be read from this copy.`, reading: false };
      const stale = !held || again || Date.now() - held.read > catalog.fresh;
      if (stale && !reading.has(which)) {
        const work = (async () => {
          const got = await catalog.read({
            base: bases[which], get: (address) => ask(address),
            heard: (page, pages) => tell("musicCatalog", { which, page, pages, done: false }),
          });
          // A reading that stopped part of the way keeps what it read, as long as that is more than was kept.
          const songs = got.songs ?? [];
          if (got.problem) log(`Reading ${catalog.name}: ${got.problem}`);
          if (songs.length > 0 && (!got.problem || songs.length > (held?.songs.length ?? 0))) {
            const fresh = { songs, read: got.problem ? 0 : Date.now() };
            catalogsRead.set(which, fresh);
            try {
              mkdirSync(join(cache, "Music"), { recursive: true });
              writeFileSync(file, JSON.stringify(fresh));
            } catch (error) {
              log(`Keeping ${catalog.name}: ${error.message}`);
            }
          }
          return got.problem ?? null;
        })().finally(() => reading.delete(which));
        reading.set(which, work);
        work.then((problem) => tell("musicCatalog", { which, done: true, problem }));
      }
      // Nothing kept yet: this time the pilot waits for it.
      if (!held && reading.has(which)) {
        const problem = await reading.get(which);
        held = catalogsRead.get(which) ?? null;
        return { songs: held?.songs ?? [], read: held?.read ?? null, problem, reading: false };
      }
      return { songs: held?.songs ?? [], read: held?.read ?? null, problem: null, reading: reading.has(which) };
    },

    /**
     * Fetches a song from NCS, as its own Download does, with the credit NCS gives for it:
     * { bytes, credit, name } or { problem }, `name` being what NCS calls the file, if it says.
     * Asked for by the pilot, one song at a time.
     */
    async fromNcs(id) {
      if (!bases) return { problem: "NCS can't be asked from this copy." };
      const info = await ask(ncs.info(id, bases.ncs));
      const credit = info.ok ? ncsCredit(info.text) : null;
      if (!credit) return { problem: info.status === 0 ? "NCS couldn't be reached. Check the connection." : "NCS didn't give the credit for this song, so it isn't added. Try again, or get it from its page." };
      try {
        const answer = await fetcher(ncs.download(id, bases.ncs), { signal: AbortSignal.timeout(120000) });
        const bytes = Buffer.from(await answer.arrayBuffer());
        const kind = answer.headers.get("content-type") ?? "";
        if (!answer.ok || bytes.length < 50_000 || !/audio|octet-stream/i.test(kind)) return { problem: `NCS didn't give the song${answer.ok ? "" : ` (it answered ${answer.status})`}. It may not be out yet: try its page.` };
        const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(answer.headers.get("content-disposition") ?? "")?.[1] ?? null;
        let name = null;
        try {
          name = named ? decodeURIComponent(named) : null;
        } catch {
          name = named;
        }
        return { bytes, credit, name };
      } catch (error) {
        log(`Fetching a song from NCS: ${error.message}`);
        return { problem: "NCS couldn't be reached. Check the connection." };
      }
    },

    /** For the app's checks of itself: a service of its own to stand in for Spotify's and the catalogs'. */
    useStandIn(address) {
      if (!quiet) return;
      bases = address === null ? null : { accounts: `${address}accounts/`, service: `${address}spotify/`, ...Object.fromEntries(Object.keys(catalogs).map((key) => [key, `${address}${key}/`])) };
      access = null;
      read = null;
      catalogsRead.clear();
    },
  };
}
