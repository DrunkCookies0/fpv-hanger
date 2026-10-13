import { test } from "node:test";
import assert from "node:assert/strict";
import { dayInWords, fileName, googleSaysNo, hashtag, linkAlone, linkFor, mayTakeVideo, sites, sitesFor, uploadsOf, videoLinkIn, videoLinksIn, words } from "../shared/uploads.js";

test("uploads: each site takes the video of its shape, and YouTube's page is in the pilot's own browser", () => {
  assert.equal(sites.youtube.shape, "landscape");
  assert.deepEqual(sitesFor("landscape"), ["youtube"]);
  assert.deepEqual(sitesFor("upright"), ["shorts", "tiktok", "instagram"]);
  // Google turns away a sign-in inside an app, so both YouTubes go through the pilot's browser.
  assert.deepEqual(Object.keys(sites).filter((id) => sites[id].browser), ["youtube", "shorts"]);
  assert.notEqual(sites.tiktok.partition, sites.instagram.partition);
  assert.ok(Object.values(sites).every((site) => site.address.startsWith("https://")));
  assert.ok(Object.values(sites).filter((site) => !site.browser).every((site) => site.partition && mayTakeVideo(site, site.address)));
  // Only the 16:9 video's link is the one an entry form wants.
  assert.deepEqual(Object.keys(sites).filter((id) => sites[id].keepsLink), ["youtube"]);
});

test("uploads: the video only goes into a chooser on the site's own upload page", () => {
  // Nothing is put into a page in the pilot's own browser.
  assert.ok(!mayTakeVideo(sites.youtube, "https://www.youtube.com/upload"));
  assert.ok(mayTakeVideo(sites.tiktok, "https://www.tiktok.com/tiktokstudio/upload?from=creator_center"));
  assert.ok(!mayTakeVideo(sites.tiktok, "https://www.tiktok.com.example.com/tiktokstudio/upload"));
  assert.ok(!mayTakeVideo(sites.tiktok, "https://www.tiktok.com/messages"));
  assert.ok(mayTakeVideo(sites.instagram, "https://www.instagram.com/"));
  assert.ok(!mayTakeVideo(sites.instagram, "https://www.instagram.com/direct/inbox/"));
  assert.ok(!mayTakeVideo(sites.instagram, "not an address"));
});

test("uploads: each site gets words of its own, made from the run", () => {
  const about = { pilot: "Test Pilot", id: "042", idLabel: "Reg#", event: "RaceGOW6", race: "Track 1", best: "28.316", window: 3, bestLap: "9.120", laps: ["9.500", "9.120", "9.696"], song: "Made Up Song.mp3" };
  const youtube = words("youtube", about, "Gear: a made-up whoop");
  assert.equal(youtube.title, "RaceGOW6 Track 1 · 28.316 best 3 laps | Test Pilot");
  assert.equal(youtube.description, "Test Pilot (Reg# 042) flying RaceGOW6 Track 1.\n\nBest 3 laps in a row: 28.316\nBest lap: 9.120\nLaps: 9.500 · 9.120 · 9.696\n\nMusic: Made Up Song\n\nGear: a made-up whoop\n\n#fpv #tinywhoop #fpvracing #RaceGOW6");
  // The video goes up named for what it is: YouTube starts its title from that.
  assert.equal(youtube.name, "RaceGOW6 Track 1 - 28.316 best 3 laps - Test Pilot");
  const shorts = words("shorts", about);
  assert.ok(shorts.title.endsWith(" #shorts") && shorts.description.includes("#shorts"));
  // TikTok and Instagram have a caption, and no title.
  const tiktok = words("tiktok", about), instagram = words("instagram", about);
  assert.equal(tiktok.title, null);
  assert.equal(tiktok.description, "RaceGOW6 Track 1: 28.316 best 3 laps in a row\nFlown by Test Pilot (Reg# 042)\nMusic: Made Up Song\n\n#fpv #tinywhoop #fpvracing #whoop #RaceGOW6");
  assert.equal(instagram.title, null);
  assert.ok(instagram.description.includes("Laps: 9.500 · 9.120 · 9.696") && instagram.description.endsWith("#reels #RaceGOW6"));
});

test("uploads: a race of a club's goes by its own name, with the club and the day in the description", () => {
  const club = words("youtube", { pilot: "Test Pilot", event: "Circle City FPV", race: "Spring Cup", date: "2026-04-11", best: "31.002", window: 3 });
  assert.equal(club.title, "Spring Cup · 31.002 best 3 laps | Test Pilot");
  assert.ok(club.description.startsWith("Test Pilot flying Spring Cup with Circle City FPV, 11 April 2026.\n"));
  assert.ok(club.description.endsWith("#CircleCityFPV"));
  assert.equal(dayInWords("2026-09-21"), "21 September 2026");
  assert.equal(dayInWords(""), "");
  // A title is kept to YouTube's 100 characters, the pilot going first.
  const long = words("shorts", { pilot: "Test Pilot", race: "A".repeat(150), best: "1.000" });
  assert.ok(long.title.length <= 100 && long.title.endsWith("… #shorts"), long.title);
  // Nothing known still makes words.
  assert.deepEqual(words("tiktok", {}), { title: null, description: "FPV\n\n#fpv #tinywhoop #fpvracing #whoop", name: "FPV" });
  assert.equal(hashtag("RaceGOW6"), "#RaceGOW6");
  assert.equal(hashtag("Circle City FPV"), "#CircleCityFPV");
  assert.equal(hashtag(" — "), null);
});

test("uploads: a file name has nothing a Mac or Windows keeps for itself", () => {
  assert.equal(fileName('Race #5: "Final" / heat 2?'), "Race #5 Final heat 2");
  assert.equal(fileName("Café Cup · 28.316 – Test Pilot ✓"), "Cafe Cup - 28.316 - Test Pilot");
  assert.equal(fileName("..."), "");
  assert.ok(fileName("x".repeat(300)).length <= 120);
});

test("uploads: a YouTube link is found, whichever way it is written", () => {
  assert.equal(videoLinkIn("Video link https://youtu.be/AbC_dEf-123 copied"), "https://youtu.be/AbC_dEf-123");
  assert.equal(videoLinkIn("https://www.youtube.com/shorts/AbC_dEf-123?feature=share"), "https://youtu.be/AbC_dEf-123");
  assert.equal(videoLinkIn("https://www.youtube.com/watch?app=desktop&v=AbC_dEf-123"), "https://youtu.be/AbC_dEf-123");
  assert.equal(videoLinkIn("youtube.com/embed/AbC_dEf-123"), "https://youtu.be/AbC_dEf-123");
  assert.equal(videoLinkIn("https://studio.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx/videos/upload"), null);
  assert.equal(videoLinkIn("https://youtu.be/tooshort"), null);
  assert.equal(videoLinkIn(null), null);
  assert.deepEqual(videoLinksIn("youtu.be/AAAAAAAAAAA and youtu.be/BBBBBBBBBBB, youtu.be/AAAAAAAAAAA"), ["https://youtu.be/AAAAAAAAAAA", "https://youtu.be/BBBBBBBBBBB"]);
});

test("uploads: only a link copied by itself is taken from the clipboard, not one in among words", () => {
  assert.equal(linkAlone("youtube", "https://youtu.be/NewVideo_12"), "https://youtu.be/NewVideo_12");
  assert.equal(linkAlone("shorts", "  https://youtube.com/shorts/NewVideo_12\n"), "https://youtu.be/NewVideo_12");
  // A description with a link of the pilot's own in it, or the title, isn't the video's link.
  assert.equal(linkAlone("youtube", "Spring Cup\n\nMy last race: https://youtu.be/OlderVideo1"), null);
  assert.equal(linkAlone("youtube", "Spring Cup · 31.002 best 3 laps | Test Pilot"), null);
  assert.equal(linkAlone("youtube", "https://studio.youtube.com/video/NewVideo_12/edit"), null);
  assert.equal(linkAlone("youtube", ""), null);
  // Nor is another site's.
  assert.equal(linkAlone("youtube", "https://www.tiktok.com/@test.pilot/video/7400000000000000001"), null);
});

test("uploads: a video's link on TikTok and on Instagram is found, and written one way", () => {
  assert.equal(linkFor("tiktok", "https://www.tiktok.com/@test.pilot/video/7400000000000000001?is_from_webapp=1&sender_device=pc"), "https://www.tiktok.com/@test.pilot/video/7400000000000000001");
  assert.equal(linkFor("tiktok", "Look: https://vm.tiktok.com/ZMmadeUp1/ !"), "https://vm.tiktok.com/ZMmadeUp1");
  assert.equal(linkFor("tiktok", "tiktok.com/t/ZTmadeUp2/"), "https://tiktok.com/t/ZTmadeUp2");
  assert.equal(linkFor("tiktok", "https://www.tiktok.com/@test.pilot"), null);
  assert.equal(linkFor("instagram", "https://www.instagram.com/reel/CmadeUp3_x/?igsh=abc"), "https://www.instagram.com/reel/CmadeUp3_x");
  assert.equal(linkFor("instagram", "https://www.instagram.com/test.pilot/p/CmadeUp4/"), "https://www.instagram.com/test.pilot/p/CmadeUp4");
  assert.equal(linkFor("instagram", "https://www.instagram.com/test.pilot/"), null);
  assert.equal(linkFor("youtube", "https://www.youtube.com/watch?v=AbC_dEf-123"), "https://youtu.be/AbC_dEf-123");
  assert.equal(linkFor("elsewhere", "https://youtu.be/AbC_dEf-123"), null);
});

test("uploads: a run's log of where it went up has YouTube's from its entry form link", () => {
  const at = "2026-10-13T15:00:00.000Z";
  const state = {
    links: { "Run 1": "https://www.youtube.com/watch?v=AbC_dEf-123", "Run 2": "not a link" },
    uploads: { "Run 1": { tiktok: { link: "https://vm.tiktok.com/ZMmadeUp1", at }, youtube: { link: "https://youtu.be/AbC_dEf-123", at } }, "Run 2": { youtube: { link: "https://youtu.be/Gone_______", at } } },
  };
  // In the order the sites are offered, YouTube's written the short way.
  assert.deepEqual(Object.keys(uploadsOf(state, "Run 1")), ["youtube", "tiktok"]);
  assert.deepEqual(uploadsOf(state, "Run 1").youtube, { link: "https://youtu.be/AbC_dEf-123", at });
  // The entry form's link is what counts for YouTube: one taken out there is gone here too.
  assert.deepEqual(uploadsOf(state, "Run 2"), {});
  // One put in only in the entry form shows, with no time.
  assert.deepEqual(uploadsOf({ links: { "Run 3": "https://youtu.be/AbC_dEf-123" } }, "Run 3"), { youtube: { link: "https://youtu.be/AbC_dEf-123", at: null } });
  assert.deepEqual(uploadsOf({}, "Run 4"), {});
});

test("uploads: Google turning away a sign-in is told apart from signing in", () => {
  assert.ok(googleSaysNo("https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.tiktok.com"));
  assert.ok(googleSaysNo("https://accounts.google.com/signin/oauth/error?authError=Cg9kaXNhbGxvd2VkX3VzZXJhZ2VudA"));
  assert.ok(!googleSaysNo("https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.tiktok.com"));
  assert.ok(!googleSaysNo("https://www.tiktok.com/login/rejected"));
  assert.ok(!googleSaysNo(undefined));
});
