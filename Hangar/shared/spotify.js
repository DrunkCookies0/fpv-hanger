// The pilot's Spotify, for finding music: their Liked Songs and the artists they play most. It is
// read with Spotify's own Web API, through an app of the pilot's own made in Spotify for Developers
// (a Client ID, which is free), signed in to in the pilot's own browser. FPV Hangar only reads what
// it is let to and never sees a password. Spotify's music can't be saved from it, so a song found
// here is only named and linked to. Nothing here touches the network, so it can be tested by itself.

/** Where Spotify signs the pilot in, and where its Web API is. */
export const accounts = "https://accounts.spotify.com/";
export const service = "https://api.spotify.com/v1/";
/** Where an app of the pilot's own is made. */
export const dashboard = "https://developer.spotify.com/dashboard";

/** The port FPV Hangar listens on for the pilot's browser coming back from Spotify, and the
 *  address it comes back to. The pilot's app has to have this address, exactly, as a Redirect URI:
 *  Spotify only sends a browser back to an address an app has. */
export const port = 43827;
export const redirect = `http://127.0.0.1:${port}/spotify`;

/** What FPV Hangar asks to see: the pilot's Liked Songs, and the artists and songs they play most. Nothing is changed. */
export const scopes = ["user-library-read", "user-top-read"];

/** How many of the pilot's Liked Songs are read, newest first: enough to know their taste. */
export const mostLiked = 500;
/** How many songs one question for Liked Songs gets. */
export const perPage = 50;

/** True for what looks like a Client ID: 32 letters and numbers. */
export const isClientId = (text) => /^[0-9a-f]{32}$/i.test(String(text ?? "").trim());

/** The address the pilot's browser is sent to, to say whether FPV Hangar may read their Spotify. */
export function signInAddress({ clientId, challenge, state, base = accounts }) {
  const query = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirect, scope: scopes.join(" "),
    code_challenge_method: "S256", code_challenge: challenge, state,
  });
  return `${base}authorize?${query}`;
}

/** What is sent to swap the code the browser came back with for keys to the pilot's Spotify. */
export function swapBody({ clientId, code, verifier }) {
  return new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }).toString();
}

/** What is sent for a fresh key when the last has run out. */
export function refreshBody({ clientId, refresh }) {
  return new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }).toString();
}

/**
 * The keys from Spotify's answer: { access, refresh, expires } with `expires` a time in
 * milliseconds, a minute early so a key is never used as it runs out. Spotify may send a new
 * refresh key or keep the old one: `refresh` is null when it kept it. Null when the answer has none.
 */
export function readKeys(answer, now = Date.now()) {
  if (typeof answer?.access_token !== "string" || answer.access_token === "") return null;
  const lasts = Number.isFinite(answer.expires_in) ? answer.expires_in : 3600;
  return { access: answer.access_token, refresh: typeof answer.refresh_token === "string" && answer.refresh_token !== "" ? answer.refresh_token : null, expires: now + Math.max(0, lasts - 60) * 1000 };
}

/** What the browser came back with: { code, state } or { refused } when the pilot said no, or null when it isn't Spotify's answer. */
export function cameBack(address) {
  let url;
  try {
    url = new URL(address, redirect);
  } catch {
    return null;
  }
  if (url.pathname !== new URL(redirect).pathname) return null;
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.get("error")) return { refused: url.searchParams.get("error"), state };
  const code = url.searchParams.get("code");
  return code ? { code, state } : null;
}

/** The question for a page of the pilot's Liked Songs. */
export const likedAddress = (offset, base = service) => `${base}me/tracks?limit=${perPage}&offset=${offset}`;
/** The question for the artists the pilot plays most, over the last six months or so. */
export const topArtistsAddress = (base = service) => `${base}me/top/artists?limit=50&time_range=medium_term`;
/** The question for who is signed in. */
export const meAddress = (base = service) => `${base}me`;

/** A song from Spotify, as Find music lists it (see shared/music.js). Null for anything that isn't a playable song. */
export function songFrom(track, liked = false) {
  if (!track || track.type !== "track" || typeof track.id !== "string" || typeof track.name !== "string") return null;
  const artists = (track.artists ?? []).map((artist) => artist?.name).filter((name) => typeof name === "string" && name !== "");
  return {
    key: `spotify:${track.id}`, source: "spotify", title: track.name, artists, credit: artists.join(", "),
    genre: null, tempo: null, length: Number.isFinite(track.duration_ms) ? track.duration_ms / 1000 : null,
    link: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
    licence: "claimed", creditLine: null, released: track.album?.release_date ?? null, liked,
  };
}

/** The songs in a page of Liked Songs, newest first. */
export function likedIn(answer) {
  return (answer?.items ?? []).map((item) => songFrom(item?.track, true)).filter(Boolean);
}

/** The artists the pilot plays most, most played first: { name, genres }. */
export function topArtistsIn(answer) {
  return (answer?.items ?? []).filter((artist) => typeof artist?.name === "string" && artist.name !== "")
    .map((artist) => ({ name: artist.name, genres: Array.isArray(artist.genres) ? artist.genres.filter((one) => typeof one === "string") : [] }));
}

/** What went wrong, in words for the pilot, from Spotify's answer when it wasn't a yes. */
export function spotifyProblem(status, answer) {
  const said = String(answer?.error_description ?? answer?.error?.message ?? answer?.error ?? "");
  if (/invalid_client|invalid client/i.test(said)) return "Spotify doesn't know that Client ID. Copy it again from your app in Spotify for Developers.";
  if (/redirect/i.test(said)) return `Your Spotify app doesn't have FPV Hangar's address. In its settings, add ${redirect} as a Redirect URI, exactly, and save.`;
  if (/invalid_grant|revoked|refresh token/i.test(said)) return "Spotify has signed FPV Hangar out. Connect again.";
  if (status === 401) return "Spotify has signed FPV Hangar out. Connect again.";
  if (status === 403) return "Spotify won't let your app read this account. In Spotify for Developers, open your app's User Management and add the email of the Spotify account you connect with, then connect again.";
  if (status === 429) return "Spotify has been asked too much just now. Try again in a minute.";
  return `Spotify didn't answer as it should (it answered ${status}).`;
}
