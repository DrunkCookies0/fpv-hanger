// The season's leaderboards, read from a spreadsheet. Everything here is made up: no pilot, time
// or link below is anybody's.
import test from "node:test";
import assert from "node:assert/strict";
import { tabsIn, trackOf, seconds, videoLink, boardIn, placeOf, ordinal, readBoards, tabsPage, tabAddress } from "../shared/leaderboard.js";

const page = `<script>items.push({name: "Track1", pageUrl: "https:\\/\\/docs.example\\/sheet?headers\\x3dtrue&gid=0", gid: "0", initialSheet: true});
items.push({name: "Rank LB", pageUrl: "https:\\/\\/docs.example\\/sheet?gid=77", gid: "77"});
items.push({name: "Track 2", pageUrl: "https:\\/\\/docs.example\\/sheet?gid=1234", gid: "1234"});</script>`;

const track = `Rank,Reg#,Pilot Name,Unofficial Time,Official Time,Video Link,Batteries,Build,Comments
1,007,Fast Fox,12.500,TBD,https://youtu.be/madeUp00001,2-5,"A frame, some motors",
2,019 ,quick  quail ,13.250,13.300,https://www.youtube.com/watch?v=madeUp00002,6-12,,"Great track, ""loved"" it"
3,007,Fast Fox,14.000,TBD,http://example.com/not-a-video,2-5,,
4,042,Test Pilot,1:02.345,TBD,https://evil.example/watch?v=x,25-50,Stock,
,,,,,,,,
5,050,No Time Yet,TBD,TBD,,,,
`;

test("the spreadsheet's tabs are found on its page", () => {
  assert.deepEqual(tabsIn(page), [{ name: "Track1", gid: "0" }, { name: "Rank LB", gid: "77" }, { name: "Track 2", gid: "1234" }]);
  assert.deepEqual(tabsIn("<html>nothing of the kind</html>"), []);
  assert.deepEqual([trackOf("Track1"), trackOf(" track 12 "), trackOf("Rank LB"), trackOf("Track")], [1, 12, null, null]);
});

test("times and links", () => {
  assert.deepEqual([seconds("13.580"), seconds(" 28.2 "), seconds("1:02.345"), seconds("TBD"), seconds(""), seconds("12,5")], [13.58, 28.2, 62.345, null, null, null]);
  assert.equal(videoLink("https://youtu.be/madeUp00001?si=abc"), "https://youtu.be/madeUp00001?si=abc");
  assert.equal(videoLink(" https://www.youtube.com/watch?v=madeUp00002 "), "https://www.youtube.com/watch?v=madeUp00002");
  // Only a secure link to YouTube is offered to click.
  for (const other of ["http://youtu.be/madeUp00001", "https://youtube.com.evil.example/watch", "https://evil.example/youtu.be", "javascript:alert(1)", "not a link", ""]) assert.equal(videoLink(other), null, other);
});

test("a track's tab is its entries in order", () => {
  const board = boardIn("Track1", track);
  assert.equal(board.kind, "track");
  assert.equal(board.number, 1);
  assert.deepEqual(board.entries, [
    { rank: "1", id: "007", pilot: "Fast Fox", time: 12.5, official: false, video: "https://youtu.be/madeUp00001" },
    // The official time takes over once there is one. Names and numbers lose their stray spaces.
    { rank: "2", id: "019", pilot: "quick quail", time: 13.3, official: true, video: "https://www.youtube.com/watch?v=madeUp00002" },
    { rank: "3", id: "007", pilot: "Fast Fox", time: 14, official: false, video: null },
    { rank: "4", id: "042", pilot: "Test Pilot", time: 62.345, official: false, video: null },
  ]);
});

test("a tab that is only coming, and one that is something else", () => {
  assert.deepEqual(boardIn("Rank LB", "Coming Soon\n"), { name: "Rank LB", kind: "soon", says: "Coming Soon" });
  assert.deepEqual(boardIn("Time LB", "\n,,\n"), { name: "Time LB", kind: "soon", says: "" });
  const table = boardIn("Rank LB", "Place,Pilot,Points\n1,Fast Fox,25\n2,quick quail,18\n");
  assert.deepEqual(table, { name: "Rank LB", kind: "table", headers: ["Place", "Pilot", "Points"], rows: [["1", "Fast Fox", "25"], ["2", "quick quail", "18"]] });
  // A track's tab laid out some other way is still shown, as a table.
  assert.equal(boardIn("Track3", "Who,How fast\nFast Fox,12.5\n").kind, "table");
  // Long cells and wide tabs are cut down.
  const wide = boardIn("EMAX LB", `${Array.from({ length: 12 }, (_, index) => `h${index}`).join(",")}\n${"x".repeat(200)},b\n`);
  assert.equal(wide.headers.length, 8);
  assert.equal(wide.rows[0][0].length, 80);
});

test("the pilot's own entry is found by number, or else by name", () => {
  const { entries } = boardIn("Track1", track);
  assert.equal(placeOf(entries, { id: "42", name: "Somebody Else" }), 3);
  assert.equal(placeOf(entries, { id: "007", name: "" }), 0);
  assert.equal(placeOf(entries, { id: "", name: "QUICK QUAIL" }), 1);
  // A number nobody there has falls back on the name.
  assert.equal(placeOf(entries, { id: "999", name: "fast fox" }), 0);
  assert.equal(placeOf(entries, { id: "999", name: "Nobody" }), -1);
  assert.equal(placeOf(entries, {}), -1);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 43, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "43rd", "101st", "111th"]);
});

test("every tab is read, and one that can't be is said so", async () => {
  const asked = [];
  const fetcher = async (address) => {
    asked.push(address);
    if (address === tabsPage) return { ok: true, status: 200, text: async () => page };
    if (address === tabAddress("0")) return { ok: true, status: 200, text: async () => track };
    if (address === tabAddress("77")) return { ok: true, status: 200, text: async () => "Coming Soon" };
    return { ok: false, status: 404, text: async () => "" };
  };
  const boards = await readBoards(fetcher, new Date("2026-10-09T02:00:00Z"));
  assert.equal(boards.read, "2026-10-09T02:00:00.000Z");
  assert.deepEqual(boards.tabs.map((tab) => [tab.name, tab.kind]), [["Track1", "track"], ["Rank LB", "soon"], ["Track 2", "unread"]]);
  assert.equal(boards.tabs[2].problem, "it answered 404");
  assert.deepEqual(asked, [tabsPage, tabAddress("0"), tabAddress("77"), tabAddress("1234")]);
  // With no way to the spreadsheet at all, that is the answer.
  await assert.rejects(readBoards(async () => ({ ok: false, status: 503, text: async () => "" })), /answered 503/);
});
