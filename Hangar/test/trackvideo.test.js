// Reading a track out of its video: finding the video, the chapter the track is built in, and the
// moments of it to look at.
import test from "node:test";
import assert from "node:assert/strict";
import { videoPage, chaptersIn, clock, buildShot, standingMoments, captureBuild } from "../shared/trackvideo.js";

test("a link to a YouTube video, however it was passed on", () => {
  const page = "https://www.youtube.com/watch?v=madeUp_-123";
  for (const link of ["https://youtu.be/madeUp_-123", "https://youtu.be/madeUp_-123?si=abc", " https://www.youtube.com/watch?v=madeUp_-123&t=43s ", "https://m.youtube.com/watch?v=madeUp_-123", "https://youtube.com/live/madeUp_-123?feature=share"]) assert.equal(videoPage(link), page, link);
  for (const link of ["http://youtu.be/madeUp_-123", "https://youtube.com.evil.example/watch?v=madeUp_-123", "https://vimeo.com/123456", "https://www.youtube.com/watch", "https://www.youtube.com/watch?v=a b", "not a link", ""]) assert.equal(videoPage(link), null, link);
});

test("the chapters a description lists, and the one the track is built in", () => {
  const description = "This week's track!\n\nSponsor: Somebody\n0:00 Intro\n0:43 Track Build\n1:29 Flythrough\n3:29 - Closing\nBuilt 3 times, 2:1 odds\n1:02:03 A long way in";
  const chapters = chaptersIn(description);
  assert.deepEqual(chapters, [{ at: 0, title: "Intro" }, { at: 43, title: "Track Build" }, { at: 89, title: "Flythrough" }, { at: 209, title: "Closing" }, { at: 3723, title: "A long way in" }]);
  assert.deepEqual(buildShot(chapters, 264), { from: 43, to: 89 });
  // The last chapter runs to the end of the video. No chapter about building is no answer.
  assert.deepEqual(buildShot([{ at: 0, title: "Intro" }, { at: 21, title: "Building it" }], 60), { from: 21, to: 60 });
  assert.equal(buildShot(chaptersIn("0:00 Intro\n1:00 Flythrough"), 200), null);
  assert.equal(buildShot([{ at: 10, title: "Build" }, { at: 12, title: "Fly" }], 200), null);
  assert.deepEqual(chaptersIn(""), []);
  assert.deepEqual([clock("43"), clock("0:43"), clock(" 1:29 "), clock("1:02:03"), clock("1:29.5"), clock("soon"), clock("")], [43, 43, 89, 3723, 89.5, null, null]);
});

test("the moments the track is taken to be standing", () => {
  const after = standingMoments({ from: 43, to: 89 });
  assert.equal(after.length, 15);
  assert.ok(after[0] === 56.8 && after.at(-1) === 87 && after.every((time, index) => index === 0 || time > after[index - 1]));
  // A short build keeps clear of the next chapter by a tenth of its length.
  assert.equal(standingMoments({ from: 0, to: 10 }).at(-1), 9);
  // The routine that reads them goes into the page as text, so it has to stand by itself.
  assert.match(captureBuild.toString(), /^async function captureBuild\(video, \{/);
});
