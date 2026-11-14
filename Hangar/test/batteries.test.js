import { test } from "node:test";
import assert from "node:assert/strict";
import { Lines, newPack, keptFrom, withTest, factsOf, typicalSag, verdictOf, limitsFor, withDefaults, chargeGrade, recommendLimits, limitsChecked, defaultLimits, cycleWindow, cycleGrade } from "../shared/batteries.js";

const at = (minute) => new Date(Date.UTC(2026, 9, 26, 12, minute));
const sag = (pack, r_end, minute, v_rest = 4.33) => keptFrom({ type: "sag", v_rest, r_5ms: r_end * 0.7, r_1s: r_end * 0.9, r_end, v_end: 3.9, a_end: 6.5, curve: [[0, 4.3, 0], [5, 4.0, 6.4]] }, { pack, at: at(minute) });

test("lines are split and read, whatever arrives in between", () => {
  const heard = [];
  const lines = new Lines((message) => heard.push(message));
  lines.push('{"type":"sta');
  lines.push('tus","s":1}\n\nnot json\n{"type":"sag"');
  assert.deepEqual(heard, [{ type: "status", s: 1 }]);
  lines.push(',"r_end":50}\r\n[1,2]\n');
  assert.deepEqual(heard.at(-1), { type: "sag", r_end: 50 });
  assert.equal(heard.length, 2);
});

test("a new pack needs a name and a sensible size", () => {
  assert.ok(newPack({ name: " ", mah: 300 }).problem);
  assert.ok(newPack({ name: "300 #1", mah: 20 }).problem);
  const { pack } = newPack({ name: " 300 #1 ", mah: "300" }, at(0));
  assert.equal(pack.name, "300 #1");
  assert.equal(pack.mah, 300);
  assert.equal(pack.retired, null);
  assert.notEqual(newPack({ name: "a", mah: 300 }, at(0)).pack.id, newPack({ name: "b", mah: 300 }, at(0)).pack.id);
});

test("what is kept from each kind of message", () => {
  assert.equal(keptFrom({ type: "status" }, { pack: "p" }), null);
  const s = sag("p", 50, 0);
  assert.equal(s.kind, "sag");
  assert.equal(s.r_end, 50);
  const full = keptFrom({ type: "result", job: "test", drain: { mah: 291.5, wh: 1.1 }, cutoff: 3.3, rate: 0.5, energy_efficiency: 0.93, charge_efficiency: 0.99,
    sags: [{ mah_out: 0, v_rest: 4.33, r_5ms: 40, r_end: 55 }], s: 7200 }, { pack: "p", at: at(1) });
  assert.equal(full.kind, "capacity");
  assert.equal(full.mah, 291.5);
  assert.equal(full.minutes, 120);
  assert.deepEqual(full.sags[0], { mahOut: 0, v_rest: 4.33, r_5ms: 40, r_end: 55 });
  assert.equal(keptFrom({ type: "result", job: "charge", charge: { mah: 100 } }, { pack: "p" }).kind, "charge");
});

test("only the latest sag test of a pack keeps its curve", () => {
  let kept = withDefaults(null);
  kept = withTest(kept, sag("a", 50, 0));
  kept = withTest(kept, sag("b", 60, 1));
  kept = withTest(kept, sag("a", 52, 2));
  const curves = Object.values(kept.tests).map((one) => [one.pack, one.r_end, one.curve.length]);
  assert.deepEqual(curves.sort(), [["a", 50, 0], ["a", 52, 2], ["b", 60, 2]].sort());
});

function library(sags, packs = { a: 300, b: 300, c: 300, d: 300 }) {
  let kept = withDefaults({ packs: Object.fromEntries(Object.entries(packs).map(([id, mah]) => [id, { id, name: id, mah, retired: null }])) });
  sags.forEach(([pack, r, v], index) => { kept = withTest(kept, sag(pack, r, index, v)); });
  return kept;
}

test("only sag tests on a full pack compare", () => {
  const facts = factsOf(library([["a", 50], ["a", 80, 3.9]]));
  assert.equal(facts.a.sag.r_end, 50);
  assert.equal(facts.a.latestSag.r_end, 80);
});

test("the typical pack needs three of a size", () => {
  assert.equal(typicalSag(factsOf(library([["a", 50], ["b", 60]])), 300), null);
  assert.equal(typicalSag(factsOf(library([["a", 50], ["b", 60], ["c", 100]])), 300), 60);
});

test("a pack that sags well past the typical one is one to retire", () => {
  const facts = factsOf(library([["a", 50], ["b", 52], ["c", 55], ["d", 90]]));
  assert.equal(verdictOf(facts.a, facts).word, "race");
  assert.equal(verdictOf(facts.d, facts).word, "retire");
  assert.match(verdictOf(facts.d, facts).reasons[0], /^Sags 68% more than your typical 300 mAh pack$/);
  assert.deepEqual(limitsFor(facts, "a"), { good_mohm: 61.5, bad_mohm: 85.6 });
  // The pilot's own limits: stricter for racing, and the same pack only fun.
  const strict = { raceResistance: 1.02, funResistance: 2, raceCapacity: 0.9, funCapacity: 0.7 };
  assert.equal(verdictOf(facts.c, facts, strict).word, "fun");
  assert.equal(verdictOf(facts.d, facts, strict).word, "fun");
});

test("with too few packs to compare, a pack is held to its own first test", () => {
  const facts = factsOf(library([["a", 50], ["a", 66]]));
  assert.equal(verdictOf(facts.a, facts).word, "fun");
  assert.match(verdictOf(facts.a, facts).reasons[0], /32% more than when first tested/);
  assert.equal(limitsFor(facts, "a"), null);
  assert.equal(verdictOf(facts.b, facts).word, null);
  assert.deepEqual(verdictOf(facts.b, facts).reasons, ["Not tested yet"]);
});

test("a pack that holds too little of its label is one to retire, whatever its sag", () => {
  let kept = library([["a", 50], ["b", 51], ["c", 52]]);
  kept = withTest(kept, keptFrom({ type: "result", job: "test", drain: { mah: 200 } }, { pack: "a", at: at(9) }));
  const facts = factsOf(kept);
  const verdict = verdictOf(facts.a, facts);
  assert.equal(verdict.word, "retire");
  assert.deepEqual(verdict.reasons, ["Sags 2% less than your typical 300 mAh pack", "Holds 67% of its 300 mAh"]);
});

/** A library of WhoopStor charges: [pack, port, mΩ as read], in the order they happened. */
function charged(readings, packs = { a: 300, b: 300, c: 300, d: 300 }) {
  let kept = withDefaults({ packs: Object.fromEntries(Object.entries(packs).map(([id, mah]) => [id, { id, name: id, mah, retired: null }])) });
  readings.forEach(([pack, port, resistance], index) => {
    kept = withTest(kept, { id: `w${index}`, pack, at: at(index).toISOString(), kind: "charge", source: "whoopstor", port, resistance, trace: [] });
  });
  return kept;
}

/** A library of WhoopStor cycle tests: [pack, port, mΩ from storage], in the order they happened.
 *  Each one's first charge reads 20% higher, as one after sitting can, and isn't the one graded. */
function cycled(readings, packs = { a: 300, b: 300, c: 300, d: 300 }, kept = null) {
  kept ??= withDefaults({ packs: Object.fromEntries(Object.entries(packs).map(([id, mah]) => [id, { id, name: id, mah, retired: null }])) });
  readings.forEach(([pack, port, resistance], index) => {
    kept = withTest(kept, {
      id: `y${index}`, pack, at: at(100 + index).toISOString(), kind: "cycle", source: "whoopstor", port, amps: 0.6, fullVolts: 4.35, storageVolts: 3.85, cycles: 2, end: "done",
      steps: [
        { kind: "charge", endVolts: 4.35, mah: 170, resistance: resistance * 1.2 }, { kind: "discharge", endVolts: 3.85, mah: 158 },
        { kind: "charge", endVolts: 4.35, mah: 171, resistance }, { kind: "discharge", endVolts: 3.85, mah: 157 },
      ],
    });
  });
  return kept;
}

test("packs are graded on their cycle tests' charges from storage, alike on every port", () => {
  // Other charges, before and after, start wherever the packs were: a top-up from full on port 6
  // reads low, a first charge after sitting high. Neither counts.
  const plain = charged([["a", 1, 190], ["d", 6, 100], ["b", 2, 150]]);
  const facts = factsOf(cycled([["a", 1, 140], ["b", 2, 145], ["c", 3, 150], ["d", 6, 200]], undefined, plain));
  // Typical: 147.5 mΩ, the middle of the four.
  assert.deepEqual(["a", "b", "c", "d"].map((id) => chargeGrade(facts[id], facts).word), ["race", "race", "race", "fun"]);
  assert.equal(facts.d.latestReading.resistance, 200);
  assert.match(chargeGrade(facts.d, facts).reason, /^Charging resistance from storage 36% above your typical 300 mAh pack's, in cycle tests$/);
  assert.equal(verdictOf(facts.d, facts).word, "fun");
  assert.ok(verdictOf(facts.d, facts).reasons.includes("200 mΩ charging from storage on port 6"));
  // A charge going on in a cycle test, after its first, is graded as it will be once kept.
  // Typical with it: the middle of 400, 145, 150 and 200, 175 mΩ.
  assert.equal(chargeGrade(facts.a, facts, { resistance: 400, port: 1 }).word, "retire");
});

test("a pack with charges but no cycle test isn't graded on them, and says what would", () => {
  const facts = factsOf(cycled([["a", 1, 140], ["b", 2, 145], ["c", 3, 150]], undefined, charged([["d", 1, 400]])));
  assert.equal(chargeGrade(facts.d, facts), null);
  const verdict = verdictOf(facts.d, facts);
  assert.equal(verdict.word, null);
  assert.ok(verdict.reasons.some((reason) => /A cycle test grades its charging resistance/.test(reason)), verdict.reasons.join(" | "));
  // Fewer than three of a size with cycle tests: nothing to say.
  const two = factsOf(cycled([["a", 1, 60], ["b", 1, 90]]));
  assert.equal(chargeGrade(two.b, two), null);
});

test("a step a stopped test was on isn't counted as a whole one", () => {
  const stopped = (steps) => ({ fullVolts: 4.35, storageVolts: 3.85, steps });
  // Stopped two minutes into its second charge, as run 5 was: what came out counts, the 22 mAh in doesn't.
  const partCharge = cycleWindow(stopped([{ kind: "charge", endVolts: 4.349, mah: 170 }, { kind: "discharge", endVolts: 3.853, mah: 159 }, { kind: "charge", endVolts: 3.994, mah: 22 }]));
  assert.deepEqual([partCharge.in, partCharge.out], [null, 159]);
  // Stopped on the way down: nothing to go by.
  assert.equal(cycleWindow(stopped([{ kind: "charge", endVolts: 4.35, mah: 170 }, { kind: "discharge", endVolts: 4.02, mah: 60 }])), null);
  // Its capacity goes by the latest test that got down to storage.
  let kept = cycled([["a", 1, 140], ["b", 2, 145], ["c", 3, 150]]);
  kept = withTest(kept, { id: "late", pack: "a", at: at(200).toISOString(), kind: "cycle", source: "whoopstor", port: 1, ...stopped([{ kind: "charge", endVolts: 4.35, mah: 170 }, { kind: "discharge", endVolts: 4.02, mah: 60 }]) });
  const facts = factsOf(kept);
  assert.equal(cycleGrade(facts.a, facts).word, "race");
});

test("limits are suggested from the pilot's own calls on their packs", () => {
  // Charging resistance against the typical 300 (the middle one, 76 mΩ): a 0.80, b 0.87, c 1.0, d 1.2, e 1.84.
  let kept = cycled([["a", 1, 61], ["b", 2, 66], ["c", 3, 76], ["d", 4, 91.5], ["e", 5, 140]], { a: 300, b: 300, c: 300, d: 300, e: 300 });
  const call = (id, word) => { kept.packs[id] = { ...kept.packs[id], call: word }; };
  call("a", "race"); call("b", "race"); call("c", "fun"); call("e", "retire");
  const suggested = recommendLimits(factsOf(kept));
  assert.equal(suggested.calls, 4);
  assert.ok(suggested.raceResistance > 0.87 && suggested.raceResistance < 1.0, `${suggested.raceResistance}`);
  assert.ok(suggested.funResistance > 1.0 && suggested.funResistance < 1.84, `${suggested.funResistance}`);
  // Nothing on one side of a limit: nothing to suggest for it.
  call("e", "fun");
  assert.equal(recommendLimits(factsOf(kept)).funResistance, null);
});

test("the limits the pilot sets are checked", () => {
  assert.deepEqual(limitsChecked(null), defaultLimits);
  assert.equal(limitsChecked({ raceResistance: 1.5, funResistance: 1.2 }), null);  // FUN stricter than RACE
  assert.equal(limitsChecked({ raceCapacity: 1.2 }), null);
  assert.deepEqual(limitsChecked({ raceResistance: "1.2" }).raceResistance, 1.2);
  assert.deepEqual(withDefaults({}).limits, defaultLimits);
});
