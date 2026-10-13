import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, countsAddress, countsProblem, keyAddress, readCounts, videoIdOf } from "../shared/counts.js";

test("counts: a YouTube video is known by its own name, whichever way it is linked", () => {
  assert.equal(videoIdOf("https://youtu.be/AbC_dEf-123"), "AbC_dEf-123");
  assert.equal(videoIdOf("https://www.youtube.com/shorts/AbC_dEf-123?feature=share"), "AbC_dEf-123");
  assert.equal(videoIdOf("https://www.tiktok.com/@test.pilot/video/7400000000000000001"), null);
  assert.equal(videoIdOf(null), null);
  assert.equal(countsAddress("https://example.com/v3/", ["AbC_dEf-123", "BbC_dEf-123"], "made up+key"), "https://example.com/v3/videos?part=statistics&id=AbC_dEf-123,BbC_dEf-123&key=made%20up%2Bkey");
  assert.ok(keyAddress("https://example.com/v3/", "k").includes("chart=mostPopular&maxResults=1&key=k"));
});

test("counts: YouTube's answer gives each video's views, likes and comments, with hidden ones left out", () => {
  const counts = readCounts({ items: [
    { id: "AbC_dEf-123", statistics: { viewCount: "1240", likeCount: "56", commentCount: "7", favoriteCount: "0" } },
    // Likes hidden by the owner, and comments off.
    { id: "BbC_dEf-123", statistics: { viewCount: "3" } },
    { statistics: { viewCount: "9" } },
  ] });
  assert.deepEqual(counts, { "AbC_dEf-123": { views: 1240, likes: 56, comments: 7 }, "BbC_dEf-123": { views: 3, likes: null, comments: null } });
  assert.deepEqual(readCounts(null), {});
  assert.equal(countWords(1240, "view"), "1,240 views");
  assert.equal(countWords(1, "like"), "1 like");
  assert.equal(countWords(0, "comment"), "0 comments");
  assert.equal(countWords(null, "like"), null);
});

test("counts: what YouTube says is wrong is put in the pilot's words", () => {
  const error = (code, reason, extra = {}) => ({ error: { code, message: "", errors: [{ reason }], ...extra } });
  assert.match(countsProblem(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }), /doesn't know that key/);
  assert.match(countsProblem(403, error(403, "accessNotConfigured", { details: [{ reason: "SERVICE_DISABLED" }] })), /isn't turned on/);
  assert.match(countsProblem(403, error(403, "quotaExceeded")), /used up/);
  assert.match(countsProblem(403, { error: { details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] } }), /isn't allowed to read YouTube/);
  assert.match(countsProblem(500, null), /answered 500/);
});
