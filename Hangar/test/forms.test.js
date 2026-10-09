// Reading an entry form and knowing what the app can fill in. The form here is made up; a second
// test reads the season's real Track 1 form when the network answers.
import test from "node:test";
import assert from "node:assert/strict";
import { parseForm, parseDeadline, roleOf, fillScript, looksLikeEmail, looksLikeYouTube, isFormAddress } from "../shared/forms.js";
import { readSeason, zoned, stamp } from "../shared/series.js";

const data = [null, ["About the race", [
  [1, "What is your Pilot Handle?", null, 0, [[101, null, 1]]],
  [2, "What is your registration number? (3 digits)", null, 0, [[102, null, 1]]],
  [3, "What was your FASTEST THREE CONSECUTIVE LAP TIME?", null, 0, [[103, null, 1]]],
  [4, "Please paste the YouTube link to the video of your laps", null, 1, [[104, null, 1]]],
  [5, "Which lap time bracket are you in?", null, 2, [[105, [["Under 30", null], ["30 to 40", null], ["", null]], 1]]],
  [6, "Which prizes do you want?", null, 4, [[106, [["Stickers"], ["Props"]], 0]]],
  [7, "Deadline = Sunday, October 11th at 11:59:59pm PST", null, 6],
  [8, "Upload a picture", null, 13, [[108, null, 0]]],
], null, null, null, null, null, null, "A Made-up Form"]];
const page = `<html><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};</script></html>`;

test("a form's questions are read, and the ones the app can answer are known", () => {
  const form = parseForm(page, new Date("2026-10-08T12:00:00Z"));
  assert.equal(form.title, "A Made-up Form");
  assert.deepEqual(form.questions.map((question) => [question.id, question.kind, question.required, question.role]), [
    ["101", "text", true, "handle"], ["102", "text", true, "number"], ["103", "text", true, "time"], ["104", "paragraph", true, "link"],
    ["105", "choice", true, null], ["106", "checkboxes", false, null], ["108", "other", false, null],
  ]);
  assert.deepEqual(form.questions[4].options, ["Under 30", "30 to 40"]);
  assert.equal(stamp(form.deadline), "2026-10-12T06:59:59Z");
  assert.equal(parseForm("<html>not a form</html>"), null);
  // A multiple-choice question that mentions a lap time is not the lap time.
  assert.equal(roleOf({ kind: "choice", title: "Is your lap time under 30?" }), null);
});

test("a deadline with no year is this year's, or next year's when that is long gone", () => {
  assert.equal(stamp(parseDeadline("January 3rd at 11:59pm PST", new Date("2026-12-20T00:00:00Z"))), "2027-01-04T07:59:00Z");
  assert.equal(stamp(parseDeadline("October 11th, 9:00 am EST", new Date("2026-10-08T00:00:00Z"))), "2026-10-11T13:00:00Z");
  assert.equal(parseDeadline("no date here"), null);
  assert.equal(+zoned(2026, 10, 11, 23, 59, 59, "America/Los_Angeles"), +new Date("2026-10-12T06:59:59Z"));
});

test("the script that fills the form carries the answers, and small checks on what is typed", () => {
  const script = fillScript({ 101: ["A \"quoted\" pilot"], 105: ["Under 30"] }, "pilot@example.com");
  assert.ok(script.includes('"101":["A \\"quoted\\" pilot"]'));
  assert.ok(script.includes('"email":"pilot@example.com"'));
  assert.doesNotThrow(() => new Function(`return ${script.replace(/^\(function/, "(function").replace(/;$/, "")}`));
  assert.ok(looksLikeEmail("a@b.co") && !looksLikeEmail("a@b") && !looksLikeEmail("a b@c.d") && !looksLikeEmail("@b.co"));
  assert.ok(looksLikeYouTube("https://youtu.be/abc") && looksLikeYouTube("https://www.youtube.com/watch?v=abc") && !looksLikeYouTube("https://example.com/youtube"));
  assert.ok(isFormAddress("https://docs.google.com/forms/d/e/abc/viewform") && isFormAddress("https://forms.gle/abc") && !isFormAddress("http://docs.google.com/forms/x") && !isFormAddress("nonsense"));
});

test("the season's real Track 1 form reads as a form", { skip: process.env.HANGAR_OFFLINE ? "offline" : false }, async (context) => {
  let form;
  try {
    const season = await readSeason();
    const address = season.find((track) => track.form)?.form;
    if (!address) return context.skip("no form is posted at the moment");
    form = parseForm(await (await fetch(address, { signal: AbortSignal.timeout(20000) })).text());
  } catch (error) {
    return context.skip(`the network didn't answer: ${error.message}`);
  }
  assert.ok(form && form.questions.length >= 4);
  const roles = form.questions.map((question) => question.role).filter(Boolean).sort();
  assert.deepEqual(roles, ["handle", "link", "number", "time"]);
});
