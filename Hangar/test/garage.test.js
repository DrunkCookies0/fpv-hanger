// The Whoop Garage's index: whoops, logs kept and their flights, as the library keeps them. The
// whoops and packs here are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { garageDefaults, matchWhoop, newWhoopName, packGuess, keepLog, forgetLog, forgetFlight, changeFlight, renameWhoop, flightsNewestFirst, whoopCards } from "../shared/garage.js";

const now = "2026-11-19T20:00:00.000Z";
const packs = [{ id: "p1", name: "006" }, { id: "p2", name: "014" }, { id: "p3", name: "025" }, { id: "p4", name: "099", retired: "2026-11-01" }];
const summary = (seconds, lowest) => ({ flyingSeconds: seconds, lowest, headline: "Nothing stands out.", level: "good" });

function twoPowerUps() {
  return keepLog(garageDefaults(null), {
    log: { id: "aaaa", file: "dump.bbl", size: 1000, savedAt: "2026-11-15T18:00:00.000Z" },
    powerUps: [
      { whoop: { id: "w-uid1", name: "", uid: "uid1", craft: "Blue Comet", board: "MADE F411", firmware: "Betaflight 4.5.1" }, pack: "p1", what: "Practice", logs: [{ index: 0, summary: summary(30, 3.4) }, { index: 1, summary: summary(28, 3.3) }] },
      { whoop: "w-uid1", pack: null, what: "Practice", logs: [{ index: 3, summary: summary(40, 3.2) }] },
    ],
  }, now);
}

test("an empty or broken index is a Garage with nothing in it", () => {
  assert.deepEqual(garageDefaults(null), { whoops: {}, logs: {}, flights: {} });
  assert.deepEqual(garageDefaults({ whoops: [], logs: "x" }), { whoops: {}, logs: {}, flights: {} });
});

test("a log is kept with its whoop, and each kept arm a flight with its pack", () => {
  const garage = twoPowerUps();
  assert.deepEqual(Object.keys(garage.whoops), ["w-uid1"]);
  // A new whoop with no name given is named for its craft name.
  assert.equal(garage.whoops["w-uid1"].name, "Blue Comet");
  assert.deepEqual(Object.keys(garage.flights).sort(), ["aaaa-0", "aaaa-1", "aaaa-3"]);
  assert.equal(garage.flights["aaaa-1"].pack, "p1");
  assert.equal(garage.flights["aaaa-3"].powerUp, 1);
  assert.equal(garage.flights["aaaa-3"].pack, null);
  assert.equal(garage.logs.aaaa.keptAt, now);
  // Kept again, a log's flights are replaced, not added to.
  const again = keepLog(garage, { log: { id: "aaaa", file: "dump.bbl", size: 1000 }, powerUps: [{ whoop: "w-uid1", pack: "p2", what: "Heat 1", logs: [{ index: 3 }] }] }, now);
  assert.deepEqual(Object.keys(again.flights), ["aaaa-3"]);
  assert.equal(again.flights["aaaa-3"].pack, "p2");
  assert.throws(() => keepLog(garage, { log: { id: "b" }, powerUps: [{ whoop: "w-nobody", logs: [{ index: 0 }] }] }, now));
});

test("a log is known to be from a whoop in the Garage by its flight controller's number", () => {
  const garage = twoPowerUps();
  assert.equal(matchWhoop(garage, { uid: "uid1", craft: "Anything" }), "w-uid1");
  assert.equal(matchWhoop(garage, { uid: "uid2", craft: "Blue Comet" }), null);
  assert.equal(matchWhoop(garage, { uid: null }), null);
  // A new whoop's name: its craft name, unless one in the Garage has it.
  assert.equal(newWhoopName(garage, { craft: "Moth" }), "Moth");
  assert.equal(newWhoopName(garage, { craft: "blue comet" }), "Whoop 1");
  assert.equal(newWhoopName(garage, { craft: "" }), "Whoop 1");
});

test("the pack a file's name says, when its number is one of the pilot's packs", () => {
  assert.equal(packGuess("practice2-014.BBL", packs), "p2");
  assert.equal(packGuess("heat1_moth-2_006.BBL", packs), "p1");
  // A date's digits aren't a pack, nor is a number that isn't one, nor one that's retired.
  assert.equal(packGuess("BTFL_BLACKBOX_LOG_20261115_175950.BBL", packs), null);
  assert.equal(packGuess("heat-123.bbl", packs), null);
  assert.equal(packGuess("old-099.bbl", packs), null);
  // Two packs named is no guess.
  assert.equal(packGuess("006-and-014.bbl", packs), null);
  assert.equal(packGuess("014 again 014.bbl", packs), "p2");
});

test("a flight's pack or what it was changes for its whole power-up", () => {
  const garage = changeFlight(twoPowerUps(), "aaaa-0", { pack: "p3", what: "Heat 2" });
  assert.equal(garage.flights["aaaa-0"].pack, "p3");
  assert.equal(garage.flights["aaaa-1"].pack, "p3");
  assert.equal(garage.flights["aaaa-1"].what, "Heat 2");
  // The other power-up's pack is left alone.
  assert.equal(garage.flights["aaaa-3"].pack, null);
  assert.equal(changeFlight(garage, "aaaa-3", { whoop: "w-nobody" }).flights["aaaa-3"].whoop, "w-uid1");
});

test("taking flights out: the log goes once none of its flights is left", () => {
  let { garage, logGone } = forgetFlight(twoPowerUps(), "aaaa-0");
  assert.equal(logGone, null);
  assert.ok(garage.logs.aaaa);
  ({ garage, logGone } = forgetFlight(garage, "aaaa-1"));
  ({ garage, logGone } = forgetFlight(garage, "aaaa-3"));
  assert.equal(logGone, "aaaa");
  assert.deepEqual(garage.logs, {});
  assert.deepEqual(forgetFlight(garage, "nothing").logGone, null);
  assert.deepEqual(forgetLog(twoPowerUps(), "aaaa").flights, {});
});

test("a whoop is renamed, but not to another whoop's name", () => {
  let garage = keepLog(twoPowerUps(), { log: { id: "bbbb", file: "b.bbl", size: 1 }, powerUps: [{ whoop: { id: "w-uid2", name: "Moth", uid: "uid2" }, pack: null, what: "", logs: [{ index: 0 }] }] }, now);
  assert.equal(renameWhoop(garage, "w-uid2", "blue comet").problem, "Another whoop is called blue comet.");
  assert.equal(renameWhoop(garage, "w-uid2", "  ").problem, "Give the whoop a name.");
  garage = renameWhoop(garage, "w-uid2", "Night Owl").garage;
  assert.equal(garage.whoops["w-uid2"].name, "Night Owl");
});

test("flights newest first, and each whoop's card", () => {
  const garage = keepLog(twoPowerUps(), { log: { id: "bbbb", file: "b.bbl", size: 1, savedAt: "2026-11-16T10:00:00.000Z" }, powerUps: [{ whoop: { id: "w-uid2", name: "Moth", uid: "uid2" }, pack: "p1", what: "", logs: [{ index: 0, summary: summary(60, 3.1) }] }] }, now);
  assert.deepEqual(flightsNewestFirst(garage).map((one) => one.id), ["bbbb-0", "aaaa-3", "aaaa-1", "aaaa-0"]);
  assert.deepEqual(flightsNewestFirst(garage, { whoop: "w-uid1" }).map((one) => one.id), ["aaaa-3", "aaaa-1", "aaaa-0"]);
  assert.deepEqual(flightsNewestFirst(garage, { pack: "p1" }).map((one) => one.id), ["bbbb-0", "aaaa-1", "aaaa-0"]);
  const cards = whoopCards(garage);
  assert.deepEqual(cards.map((card) => card.name), ["Moth", "Blue Comet"]);
  assert.equal(cards[1].flights, 3);
  assert.equal(cards[1].flyingSeconds, 98);
  assert.equal(cards[1].latest.id, "aaaa-3");
});
