import { test } from "node:test";
import assert from "node:assert/strict";
import { newestFirst, marked, tickedAtFirst, freshOn, isCardOnMac, removableOnWindows } from "../shared/cards.js";

const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).getTime();
const recording = (name, bytes, modified) => ({ path: `/card/movies/${name}`, name, bytes, modified });

test("cards: the newest recording first, and by name when the goggles didn't know the time", () => {
  const same = at(2020, 1, 1);
  const sorted = newestFirst([recording("rec_0002.ts", 1, same), recording("rec_0010.ts", 1, same), recording("rec_0001.ts", 1, at(2026, 5, 2)), recording("rec_0009.ts", 1, same)]);
  assert.deepEqual(sorted.map((one) => one.name), ["rec_0001.ts", "rec_0010.ts", "rec_0009.ts", "rec_0002.ts"]);
});

test("cards: a recording the library has is one with the same name and size", () => {
  const held = new Map([
    ["rec_0001.ts", [{ size: 100, track: "Event/Track 2" }, { size: 100, track: "Event/Track 1" }]],
    ["rec_0002.ts", [{ size: 999, track: "Event/Track 1" }]],
    ["rec_0003.ts", [{ size: 300, track: "Event/Track 2" }]],
  ]);
  const found = marked([recording("REC_0001.TS", 100, 1), recording("rec_0002.ts", 200, 1), recording("rec_0003.ts", 300, 1), recording("rec_0004.ts", 400, 1)], held, "Event/Track 1");
  // In two tracks: the one being added to is the one named.
  assert.equal(found[0].in, "Event/Track 1");
  // The same name after the card was wiped and the count began again is another recording.
  assert.equal(found[1].in, null);
  assert.equal(found[2].in, "Event/Track 2");
  assert.equal(found[3].in, null);
  assert.equal(freshOn({ recordings: found }), 2);
});

test("cards: the new recordings from the last day of flying are ticked", () => {
  const recordings = [
    { ...recording("rec_0005.ts", 1, at(2026, 10, 11, 18)), in: "Event/Track 1" },
    { ...recording("rec_0004.ts", 1, at(2026, 10, 10, 23)), in: null },
    { ...recording("rec_0003.ts", 1, at(2026, 10, 10, 9)), in: null },
    { ...recording("rec_0002.ts", 1, at(2026, 10, 10, 8)), in: "Event/Track 1" },
    { ...recording("rec_0001.ts", 1, at(2026, 10, 3)), in: null },
  ];
  // The newest of all is in the library already, so the day that counts is the one before.
  assert.deepEqual(tickedAtFirst(recordings), ["/card/movies/rec_0004.ts", "/card/movies/rec_0003.ts"]);
  assert.deepEqual(tickedAtFirst(recordings.map((one) => ({ ...one, in: "Event/Track 1" }))), []);
  assert.deepEqual(tickedAtFirst([]), []);
});

test("cards: a card is a disk that comes out of its reader", () => {
  const told = (media, protocol) => `<dict>\n\t<key>BusProtocol</key>\n\t<string>${protocol}</string>\n\t<key>Internal</key>\n\t<true/>\n\t<key>RemovableMedia</key>\n\t<${media}/>\n\t<key>RemovableMediaOrExternalDevice</key>\n\t<true/>\n</dict>`;
  assert.ok(isCardOnMac(told("true", "Secure Digital")));
  assert.ok(isCardOnMac(told("true", "USB")));
  // A disk on a cable, the Mac's own disk, and a disk image.
  assert.ok(!isCardOnMac(told("false", "USB")));
  assert.ok(!isCardOnMac(told("false", "Apple Fabric")));
  assert.ok(!isCardOnMac(told("true", "Disk Image")));
  assert.ok(!isCardOnMac(""));
});

test("cards: the removable disks Windows lists, by letter and name", () => {
  assert.deepEqual(removableOnWindows("F:|\r\nE:|GOGGLES\r\n\r\n"), [{ name: "GOGGLES (E:)", folder: "E:\\" }, { name: "F:", folder: "F:\\" }]);
  assert.deepEqual(removableOnWindows(""), []);
  assert.deepEqual(removableOnWindows("Get-CimInstance : not found"), []);
});
