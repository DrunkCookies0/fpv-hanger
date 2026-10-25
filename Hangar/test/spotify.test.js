import { test } from "node:test";
import assert from "node:assert/strict";
import * as spotify from "../shared/spotify.js";

// The ids, names and keys are made up.
const clientId = "0123456789abcdef0123456789abcdef";

test("spotify: the pilot's browser is sent to Spotify with the app's own id, and comes back to this computer", () => {
  assert.ok(spotify.isClientId(clientId));
  assert.ok(spotify.isClientId(` ${clientId.toUpperCase()} `));
  assert.ok(!spotify.isClientId("not-an-id"));
  assert.equal(spotify.redirect, `http://127.0.0.1:${spotify.port}/spotify`);
  const address = new URL(spotify.signInAddress({ clientId, challenge: "made-up-challenge", state: "made-up-state" }));
  assert.equal(address.origin + address.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(address.searchParams.get("client_id"), clientId);
  assert.equal(address.searchParams.get("response_type"), "code");
  assert.equal(address.searchParams.get("redirect_uri"), spotify.redirect);
  assert.equal(address.searchParams.get("scope"), "user-library-read user-top-read");
  assert.equal(address.searchParams.get("code_challenge_method"), "S256");
  assert.equal(address.searchParams.get("code_challenge"), "made-up-challenge");
  assert.equal(address.searchParams.get("state"), "made-up-state");

  assert.deepEqual(spotify.cameBack("/spotify?code=abc&state=xyz"), { code: "abc", state: "xyz" });
  assert.deepEqual(spotify.cameBack("/spotify?error=access_denied&state=xyz"), { refused: "access_denied", state: "xyz" });
  assert.equal(spotify.cameBack("/favicon.ico"), null);
  assert.equal(spotify.cameBack("/spotify?state=xyz"), null);
});

test("spotify: the code is swapped for keys, which are kept until a minute before they run out", () => {
  const swap = new URLSearchParams(spotify.swapBody({ clientId, code: "abc", verifier: "made-up-verifier" }));
  assert.equal(swap.get("grant_type"), "authorization_code");
  assert.equal(swap.get("code_verifier"), "made-up-verifier");
  assert.equal(swap.get("redirect_uri"), spotify.redirect);
  const refresh = new URLSearchParams(spotify.refreshBody({ clientId, refresh: "made-up-refresh" }));
  assert.equal(refresh.get("grant_type"), "refresh_token");
  assert.equal(refresh.get("refresh_token"), "made-up-refresh");
  assert.equal(refresh.get("client_id"), clientId);
  assert.deepEqual(spotify.readKeys({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000), { access: "a", refresh: "r", expires: 1000 + 3540 * 1000 });
  // Spotify can keep the refresh key it gave before.
  assert.equal(spotify.readKeys({ access_token: "a", expires_in: 3600 }, 0).refresh, null);
  assert.equal(spotify.readKeys({ error: "invalid_grant" }), null);
});

test("spotify: Liked Songs become songs to list, copyrighted, and the most played artists bring their kinds of music", () => {
  const page = { items: [
    { added_at: "2026-10-01T00:00:00Z", track: { type: "track", id: "t1", name: "Night Gate", duration_ms: 201500, artists: [{ name: "Test Nerds" }, { name: "Elefant Made" }], external_urls: { spotify: "https://open.spotify.com/track/t1" }, album: { release_date: "2025-03-01" } } },
    // A podcast episode in the list isn't a song.
    { track: { type: "episode", id: "e1", name: "Talk" } },
    { track: null },
  ], next: null };
  const songs = spotify.likedIn(page);
  assert.equal(songs.length, 1);
  assert.deepEqual(songs[0], {
    key: "spotify:t1", source: "spotify", title: "Night Gate", artists: ["Test Nerds", "Elefant Made"], credit: "Test Nerds, Elefant Made",
    genre: null, tempo: null, length: 201.5, link: "https://open.spotify.com/track/t1", licence: "claimed", creditLine: null, released: "2025-03-01", liked: true,
  });
  assert.deepEqual(spotify.likedIn(null), []);
  assert.deepEqual(spotify.topArtistsIn({ items: [{ name: "Test Nerds", genres: ["drum and bass", 4] }, { name: "" }, { name: "Pipe Theory" }] }), [
    { name: "Test Nerds", genres: ["drum and bass"] }, { name: "Pipe Theory", genres: [] },
  ]);
  assert.equal(spotify.likedAddress(100, "https://example.com/v1/"), "https://example.com/v1/me/tracks?limit=50&offset=100");
});

test("spotify: what Spotify says is wrong is put in the pilot's words", () => {
  assert.match(spotify.spotifyProblem(400, { error: "invalid_client", error_description: "Invalid client" }), /doesn't know that Client ID/);
  assert.match(spotify.spotifyProblem(400, { error: "invalid_grant", error_description: "Invalid redirect URI" }), /Redirect URI/);
  assert.match(spotify.spotifyProblem(400, { error: "invalid_grant", error_description: "Refresh token revoked" }), /Connect again/);
  assert.match(spotify.spotifyProblem(401, { error: { status: 401, message: "The access token expired" } }), /Connect again/);
  assert.match(spotify.spotifyProblem(403, { error: { status: 403, message: "Forbidden" } }), /User Management/);
  assert.match(spotify.spotifyProblem(429, null), /too much/);
  assert.match(spotify.spotifyProblem(500, null), /answered 500/);
});
