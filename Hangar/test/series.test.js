// Reading what the series publishes: the pilot list, the schedule, and each track's form. On
// made-up text that needs no network. The names in it are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { rows, pilotsIn, findPilots, zoned, day, tracksIn, formsIn, stamp, zone } from "../shared/series.js";

const list = `,,,,,A note above the headings
Reg#,Pilot Name,Name,Location,,You can search the page
503,310,Sam,Somewhere,,
232,_-Ember-_,Kit,Elsewhere
042,SkyBiscuit,Pat,Nowhere
007,"Comma, The Pilot",Jo,"A Town, A State"
310,"Quote ""Q"" Pilot",Al,Anywhere
,,,,
045,Sky Otter,Bo,Far Away
`;

test("the pilot list is read, quoted names whole", () => {
  const pilots = pilotsIn(list);
  assert.deepEqual(pilots.map((pilot) => pilot.name), ["310", "_-Ember-_", "SkyBiscuit", "Comma, The Pilot", 'Quote "Q" Pilot', "Sky Otter"]);
  const numbers = (query) => findPilots(query, pilots).map((pilot) => pilot.number).sort();
  assert.deepEqual(numbers("SkyBiscuit"), ["042"]);
  assert.deepEqual(numbers("  skybiscuit "), ["042"]);
  assert.deepEqual(numbers("ember"), ["232"]);
  assert.deepEqual(numbers("42"), ["042"]);
  assert.deepEqual(numbers("#042"), ["042"]);
  assert.deepEqual(numbers("310"), ["310", "503"]);
  assert.deepEqual(numbers("sky"), ["042", "045"]);
  assert.deepEqual(numbers("comma, the pilot"), ["007"]);
  assert.deepEqual(numbers("NoSuchPilotAnywhere"), []);
  assert.deepEqual(numbers("s"), []);
  assert.deepEqual(rows('a,"b ""c"" d",e\r\nf,,g'), [["a", 'b "c" d', "e"], ["f", "", "g"]]);
});

const at = (year, month, date, hour = 12, minute = 0, second = 0) => zoned(year, month, date, hour, minute, second, zone);

test("a time on the Pacific coast, either side of the clocks changing", () => {
  assert.equal(stamp(at(2026, 10, 9, 9)), "2026-10-09T16:00:00Z");
  assert.equal(stamp(at(2026, 12, 18, 9)), "2026-12-18T17:00:00Z");
  assert.equal(stamp(at(2026, 10, 11, 23, 59, 59)), "2026-10-12T06:59:59Z");
});

// The schedule laid out as the series' sheet is, slips and all.
const sheet = `,,RaceGOW6 Schedule,,,
Track,Release: ,Deadline: ,Livestream:,Title,Track
Number,Friday ~9am PST,Sunday 11:59pm PST ,Saturday ~12 noon pST,Sponsor,Designer
1,Sepetember 25th,October 11th,October 17th,Prop Shop,GateKeeper
2,October 9th,October 25th,October 31st,Whoops.example,GateKeeper
3,October 23rd,November 8th,November 14th,TinyMotors,TBD
7,December 18th,"January 3rd, 2027","January 9th, 2027",someSPONSORfpv,LoopDeLoop
,A Meet-Up 2027,"A Town, A State",January 16th-18th 2027,Link to stream = TBD,
`;

test("the schedule reads as its tracks, with each day in the right year", () => {
  const now = at(2026, 10, 8);
  const made = tracksIn(sheet, now);
  assert.deepEqual(made.map((track) => track.number), [1, 2, 3, 7]);
  assert.equal(+made[0].release, +at(2026, 9, 25, 9));
  assert.equal(+made[0].deadline, +at(2026, 10, 11, 23, 59, 59));
  assert.equal(+made[3].deadline, +at(2027, 1, 3, 23, 59, 59));
  assert.equal(+made[3].release, +at(2026, 12, 18, 9));
  assert.equal(+tracksIn(sheet, at(2027, 1, 5))[0].release, +at(2026, 9, 25, 9));
  assert.equal(made[0].sponsor, "Prop Shop");
  assert.equal(made[0].designer, "GateKeeper");
  assert.equal(made[2].designer, null);
  assert.equal(+made[0].livestream, +at(2026, 10, 17, 12));
  assert.equal(day("no day here", { hour: 9 }, now), null);
});

test("each track gets its own form from the page, and the track-building form is nobody's", () => {
  const page = `
    <p>If you create a track for IGOW<span>6</span> please submit it here: <a href="https://www.google.com/url?q=https%3A%2F%2Fforms.gle%2FBuildABCD&amp;sa=D">https://forms.gle/BuildABCD</a></p>
    <h2>RaceGOW<span>6</span> Track <span>1</span></h2><p>Deadline = Sunday, <b>October 11th</b> at 11:59:59pm PST</p>
    <p>Submission Form is <a href="https://www.google.com/url?q=https%3A%2F%2Fforms.gle%2FTrackOne111&amp;sa=D">https://forms.gle/TrackOne111</a></p>
    <h2>RaceGOW6 Track2</h2><p>Deadline = Sunday, October 25th 11:59:59pm PST</p><p>Submission Form = <a href="https://docs.google.com/forms/d/e/abcDEF_123/viewform">here</a></p>
    <h2>RaceGOW6 Track3</h2><p>Opens October 23rd</p>`;
  assert.deepEqual([...formsIn(page)], [[1, "https://forms.gle/TrackOne111"], [2, "https://docs.google.com/forms/d/e/abcDEF_123/viewform"]]);
});
