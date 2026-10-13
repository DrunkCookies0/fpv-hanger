// How many views, likes and comments a run's videos have on YouTube, as YouTube's own data
// service (the YouTube Data API) tells anyone with a key. The key is the pilot's own, made in
// Google Cloud, and reads only what anyone can see on YouTube: nothing is signed in to. Nothing
// here touches the network, so it can be tested by itself.

import { videoLinkIn } from "./uploads.js";

/** Where YouTube's data service is. */
export const service = "https://www.googleapis.com/youtube/v3/";

/** Where in Google Cloud a key is made, and the service it needs turned on. */
export const keyPages = {
  service: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  keys: "https://console.cloud.google.com/apis/credentials",
};

/** How many videos one question to YouTube can ask about. */
export const most = 50;

/** A YouTube video's own name for itself, from any link to it, or null. */
export function videoIdOf(link) {
  return /youtu\.be\/([A-Za-z0-9_-]{11})$/.exec(videoLinkIn(link) ?? "")?.[1] ?? null;
}

/** The question for some videos' counts. */
export function countsAddress(base, ids, key) {
  return `${base}videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(key)}`;
}

/** The question that tries a key out: the one most popular video, which any working key can read. */
export function keyAddress(base, key) {
  return `${base}videos?part=id&chart=mostPopular&maxResults=1&key=${encodeURIComponent(key)}`;
}

/**
 * Each video's counts from YouTube's answer: { [id]: { views, likes, comments } }. A count the
 * video's owner hides (likes, or comments when they are off) is null. A video YouTube doesn't
 * give, because it is private or gone, isn't there.
 */
export function readCounts(answer) {
  const counts = {};
  for (const item of answer?.items ?? []) {
    if (typeof item?.id !== "string") continue;
    const number = (value) => (value === undefined || value === null || !Number.isFinite(Number(value)) ? null : Number(value));
    const statistics = item.statistics ?? {};
    counts[item.id] = { views: number(statistics.viewCount), likes: number(statistics.likeCount), comments: number(statistics.commentCount) };
  }
  return counts;
}

/** What went wrong, in words for the pilot, from YouTube's answer when it wasn't a yes. */
export function countsProblem(status, answer) {
  const error = answer?.error ?? {};
  const reasons = [...(error.errors ?? []).map((one) => one?.reason), ...(error.details ?? []).map((one) => one?.reason)].filter(Boolean).map(String);
  const said = (...some) => some.some((reason) => reasons.includes(reason));
  if (said("API_KEY_INVALID", "keyInvalid") || /API key not valid/i.test(error.message ?? "")) return "YouTube doesn't know that key. Copy it again from Google Cloud.";
  if (said("SERVICE_DISABLED", "accessNotConfigured")) return "The YouTube Data API isn't turned on for that key's project. Turn it on in Google Cloud, then try again in a few minutes.";
  if (said("quotaExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED", "rateLimitExceeded")) return "That key has used up what YouTube allows it today. The counts come back tomorrow.";
  if (said("API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED", "forbidden", "ipRefererBlocked")) {
    return "That key isn't allowed to read YouTube. In Google Cloud, let it use the YouTube Data API v3, with no website or app limits.";
  }
  return `YouTube didn't give the counts (it answered ${status}).`;
}

/** A count in words: "1,240 views", "1 like", or null when it is hidden. */
export function countWords(count, one, many = `${one}s`) {
  if (count === null || count === undefined) return null;
  return `${Number(count).toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
