// One whoop's build and health: its parts, the changes noted, and how each motor's share of the
// work and buzz move from flight to flight. The whoops and flights here are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { sampleDump } from "../main/samplelog.js";
import { readLogs } from "../shared/blackbox.js";
import { headerFacts } from "../shared/flight.js";
import { keepLog, garageDefaults } from "../shared/garage.js";
import { partsFromLog, partsOf, setPart, noteChange, forgetChange, changeTime, changesWithTime, shareOf, healthRow, shapeOf, healthOf, comparisonOf } from "../shared/whoop.js";

const now = "2026-11-19T20:00:00.000Z";
const garage = () => keepLog(garageDefaults(null), {
  log: { id: "aaaa", file: "a.bbl", size: 1, savedAt: "2026-11-10T18:00:00.000Z" },
  powerUps: [{ whoop: { id: "w-1", name: "Blue Comet", uid: "uid1" }, pack: null, what: "", logs: [{ index: 0, summary: { flyingSeconds: 60 } }, { index: 1, summary: { flyingSeconds: 40 } }] }],
}, now);

test("what a log says about the whoop's build", () => {
  const [log] = readLogs(sampleDump({ arms: [{ seconds: 3, powerUp: 0 }] }));
  const parts = partsFromLog(headerFacts(log.hdr));
  assert.deepEqual(parts, {
    firmware: "4.5.1 on an STM32F411", board: "MADEUPF411", motorProtocol: "DShot300, bidirectional, 12 poles",
    receiver: "CRSF (ExpressLRS or Crossfire)", loop: "2 kHz gyro, 1 kHz PID loop",
  });
  // Betaflight's own starting KV says nothing; one the pilot set does. A receiver on SPI is on the board.
  assert.equal(partsFromLog({ motorKv: "25000" }).motors, "25000 KV");
  assert.equal(partsFromLog({ receiver: "9", features: String(1 << 25) }).receiver, "On the board (SPI)");
  assert.equal(partsFromLog({ receiver: "99", features: "8" }).receiver, undefined);
  assert.deepEqual(partsFromLog(null), {});
});

test("a whoop's parts: typed over what its log says, and back when cleared", () => {
  const facts = { board: "MADE MADEUPF411", firmware: "Betaflight 4.5.1 (00000000) STM32F411" };
  let g = setPart(garage(), "w-1", "frame", "  65 mm made-up frame ");
  g = setPart(g, "w-1", "board", "Another board");
  g = setPart(g, "w-1", "nonsense", "x");
  assert.deepEqual(g.whoops["w-1"].parts, { frame: "65 mm made-up frame", board: "Another board" });
  const parts = Object.fromEntries(partsOf(g.whoops["w-1"], facts).map((part) => [part.key, part]));
  assert.equal(parts.frame.value, "65 mm made-up frame");
  assert.equal(parts.board.value, "Another board");
  assert.equal(parts.board.fromLog, false);
  assert.equal(parts.firmware.value, "4.5.1 on an STM32F411");
  assert.equal(parts.firmware.fromLog, true);
  g = setPart(g, "w-1", "board", "");
  assert.equal(partsOf(g.whoops["w-1"], facts).find((part) => part.key === "board").value, "MADEUPF411");
});

test("changes noted to a whoop, with the time flown since each", () => {
  let { garage: g, problem } = noteChange(garage(), "w-1", { at: "2026-11-10T00:00:00.000Z", text: "New props, all four" }, "c1");
  assert.equal(problem, null);
  assert.equal(noteChange(g, "w-1", { at: "2026-11-11T00:00:00.000Z", text: " " }).problem, "Say what was changed.");
  assert.equal(noteChange(g, "w-nobody", { at: now, text: "x" }).problem, "That whoop isn't in the Garage.");
  ({ garage: g } = noteChange(g, "w-1", { at: "2026-11-12T00:00:00.000Z", text: "Motor 3 replaced" }, "c2"));
  const flights = Object.values(g.flights);
  assert.deepEqual(changesWithTime(g.whoops["w-1"], flights).map((c) => [c.id, c.flights, c.flyingSeconds]), [["c1", 2, 100], ["c2", 0, 0]]);
  g = forgetChange(g, "w-1", "c1");
  assert.deepEqual(g.whoops["w-1"].changes.map((c) => c.id), ["c2"]);
  // A change made today is now; one on another day, from the start of it; none in the future.
  const today = new Date(2026, 10, 19, 15, 30);
  assert.equal(changeTime("2026-11-19", today).at, today.toISOString());
  assert.equal(changeTime("2026-11-12", today).at, new Date(2026, 10, 12).toISOString());
  assert.equal(changeTime("2026-11-20", today).problem, "That day hasn't come yet.");
  assert.equal(changeTime("", today).problem, "Say which day it was changed.");
});

test("each motor's share of the work, and the shape a difference takes", () => {
  assert.deepEqual(shareOf([30, 30, 30, 30]), [25, 25, 25, 25]);
  assert.deepEqual(shareOf([22, 28, 28, 22]), [22, 28, 28, 22]);
  assert.equal(shareOf([1, 2, 3]), null);
  assert.equal(shareOf([0, 0, 0, 0]), null);
  const row = healthRow({ id: "aaaa-0", savedAt: now, index: 0 }, { flyingSeconds: 30, motors: { meanPct: [40, 40, 40, 40], hfNoisePct: [2, 2, 2, 2], singlePinnedEvents: 1 } });
  assert.deepEqual(row.share, [25, 25, 25, 25]);
  assert.equal(row.pinned, 1);
  assert.deepEqual(shapeOf([-0.6, -0.6, 1.8, -0.6]), { kind: "corner", motor: 2, more: true, fits: 1 });
  assert.equal(shapeOf([0.4, 0.4, 0.4, -1.2]).kind, "corner");
  assert.equal(shapeOf([0.4, 0.4, 0.4, -1.2]).more, false);
  assert.deepEqual([shapeOf([1, -1, 1, -1]).kind, shapeOf([1, -1, 1, -1]).more], ["back", true]);
  assert.deepEqual([shapeOf([-1, -1, 1, 1]).kind, shapeOf([-1, -1, 1, 1]).more], ["right", false]);
  assert.deepEqual([shapeOf([-3, 3, 3, -3]).kind, shapeOf([-3, 3, 3, -3]).more], ["diagonal", true]);
});

// Made-up flights: one a day from 1 November, each with the four motors' shares and buzz.
const day = (n) => `2026-11-${String(n).padStart(2, "0")}T18:00:00.000Z`;
const flight = (n, share, buzz = [2.5, 2.5, 2.5, 2.5], extra = {}) => ({ id: `f${n}`, at: day(n), index: 0, flyingSeconds: 60, share, buzz, pinned: 0, ...extra });
const wobble = (n) => [25 + ((n * 7) % 5 - 2) * 0.2, 25 - ((n * 3) % 5 - 2) * 0.2, 25 + ((n * 11) % 5 - 2) * 0.15, 0].map((v, k, a) => (k === 3 ? Math.round((100 - a[0] - a[1] - a[2]) * 10) / 10 : Math.round(v * 10) / 10));
const even = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => flight(from + i, wobble(from + i)));

test("health needs a few flights first, and says so", () => {
  const health = healthOf(even(1, 3));
  assert.equal(health.compare, null);
  assert.match(health.checks[0].title, /needs about 5 flights.*3 so far/);
  // Hops and crashes don't count.
  assert.equal(healthOf([flight(1, [25, 25, 25, 25], undefined, { flyingSeconds: 4 })]).flights.length, 0);
});

test("a steady whoop: nothing stands out", () => {
  const health = healthOf(even(1, 10));
  assert.equal(health.compare.kind, "lately");
  assert.equal(health.compare.now.length, 3);
  assert.equal(health.compare.then.length, 7);
  assert.deepEqual(health.checks.map((check) => check.level), ["good"]);
  assert.match(health.checks[0].title, /Nothing stands out/);
});

test("a motor working harder since a change says which, where, and what to check", () => {
  const changes = [{ id: "c1", at: "2026-11-09T00:00:00.000Z", text: "New props, all four" }];
  const rows = [...even(1, 8), flight(9, [24.3, 24.3, 27, 24.4]), flight(10, [24.4, 24.2, 27.1, 24.3]), flight(11, [24.2, 24.4, 26.9, 24.5])];
  const health = healthOf(rows, changes);
  assert.equal(health.compare.kind, "change");
  assert.equal(health.compare.now.length, 3);
  const [first] = health.checks;
  assert.equal(first.level, "note");
  assert.match(first.title, /^Since “New props, all four”: motor 3 \(back left\) works harder than it did: 25\.\d% of the work before, 27\.0% now\./);
  assert.match(first.steps[0], /prop 3/);
});

test("the work shared more evenly since a change is good news", () => {
  const changes = [{ id: "c1", at: "2026-11-09T00:00:00.000Z", text: "Prop 3 replaced" }];
  const rows = [...Array.from({ length: 8 }, (_, i) => flight(i + 1, [24, 24, 28, 24])), ...even(9, 11)];
  const health = healthOf(rows, changes);
  assert.equal(health.checks[0].level, "good");
  assert.match(health.checks[0].title, /shared more evenly/);
});

test("a whoop that has always leant on one diagonal is told so, with the props to check", () => {
  const rows = Array.from({ length: 6 }, (_, i) => flight(i + 1, [22, 28, 28.2, 21.8]));
  const health = healthOf(rows);
  const lean = health.checks.find((check) => /It leans/.test(check.title));
  assert.equal(lean.level, "note");
  assert.match(lean.title, /motors 2 and 3, one diagonal, work harder than 1 and 4: 56\.2% of the work between them, where even is 50%/);
  assert.match(lean.why, /props on 1 and 4/);
});

test("one motor buzzing more on its own, and a motor held at full in more than one flight", () => {
  const rows = [...even(1, 7), ...[8, 9, 10].map((n) => flight(n, wobble(n), [2.5, 4.4, 2.6, 2.5], { pinned: n === 10 ? 0 : 1 }))];
  const titles = healthOf(rows).checks.filter((check) => check.level === "warn").map((check) => check.title).join(" | ");
  assert.match(titles, /motor 2 \(front right\) buzzes more than it did: 2\.5% jitter before, 4\.4% now/);
  assert.match(titles, /held at full while the others weren't, in 2 of the last 3 flights/);
});

test("which flights are compared", () => {
  const rows = even(1, 12);
  // No change: the last three against up to eight before them.
  assert.deepEqual(comparisonOf(rows, []).compare.then.map((row) => row.id), ["f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);
  // A change with nothing flown since: waiting for it.
  const fresh = [{ id: "c", at: "2026-11-30T00:00:00.000Z", text: "New frame" }];
  const waiting = healthOf(rows, fresh);
  assert.equal(waiting.compare, null);
  assert.match(waiting.checks.map((check) => check.title).join(" "), /Fly two packs since “New frame”/);
  // Two changes: before the newest goes back only to the one before it, when enough were flown between.
  const two = [{ id: "a", at: day(5), text: "A" }, { id: "b", at: day(10), text: "B" }];
  const { compare } = comparisonOf(rows, two);
  assert.equal(compare.kind, "change");
  assert.deepEqual(compare.then.map((row) => row.id), ["f5", "f6", "f7", "f8", "f9"]);
  assert.deepEqual(compare.now.map((row) => row.id), ["f10", "f11", "f12"]);
});
