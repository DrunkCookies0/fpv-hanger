import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReport, Charges, keptCharge, resistanceOf, reworked, firmwareWords, ampsPerCount, currentFor, portValueFor, chargePlan, commandBytes, commands, portWords, endedWords } from "../shared/whoopstor.js";
import { PretendWhoopStor } from "../shared/whoopstor-sim.js";

/** Runs a pretend charger for `ms` of its time, every report to `charges`; quickly where nothing starts. */
function run(sim, charges, ms, { every = 1 } = {}) {
  for (let done = 0; done < ms; done += 10) {
    sim.step(10);
    const report = sim.report();
    if ((sim.ms / 10) % every < 2) charges.heard(parseReport(report));            // both pages, side by side
  }
}

function watch() {
  const seen = { began: [], measured: [], ended: [] };
  const charges = new Charges({ began: (s) => seen.began.push(s), measured: (s) => seen.measured.push(s), ended: (s) => seen.ended.push(s), now: () => new Date(Date.UTC(2026, 10, 7, 12)) });
  return { charges, seen };
}

test("reports are read as the firmware's USB.md lays them out", () => {
  const sim = new PretendWhoopStor();
  sim.insert(2, { soc: 0.5 });
  sim.start();
  sim.step(20000);
  const first = parseReport(sim.report()), second = parseReport(sim.report());
  const p1 = first.page === 1 ? first : second, p2 = first.page === 2 ? first : second;
  assert.equal(p1.running, true);
  assert.equal(p1.target, 4.35);
  assert.equal(p1.states[1], "charge");
  assert.equal(p1.states[0], "idle");
  assert.ok(Math.abs(p1.volts[1] - 3.87) < 0.06, `${p1.volts[1]}`);
  assert.ok(Math.abs(p1.amps[1] - 0.3) < 0.03, `${p1.amps[1]}`);
  assert.ok(Math.abs(p1.input - 11.8) < 0.05, `${p1.input}`);
  assert.equal(p2.setAmps[1], 0.3);
  assert.equal(p1.current, 0.3);
  assert.equal(p2.setAmps[0], 0);
  assert.equal(p2.build, "b6fa0077");
  assert.equal(firmwareWords(p1, p2), "0.2-beta.6");
  const broken = sim.report();
  broken[63] = 0;
  assert.equal(parseReport(broken), null);
  assert.equal(parseReport(new Uint8Array(10)), null);
});

test("a charge is followed from start to full, with what went in and the pack's resistance", () => {
  const sim = new PretendWhoopStor();
  const { charges, seen } = watch();
  sim.start();
  run(sim, charges, 1000);
  sim.insert(1, { soc: 0.5, r0: 0.06, r1: 0.03, tau: 2 });
  run(sim, charges, 40000);
  assert.equal(seen.began.length, 1);
  assert.equal(seen.began[0].port, 1);
  assert.equal(seen.measured.length, 1);
  const r = seen.measured[0].resistance;
  // The port's plug and lead (12 mΩ) are in it, and some of the slower part of the cell's own (30 mΩ).
  assert.ok(r.mohm > 65 && r.mohm < 105, `${r.mohm} mΩ by ${r.how}`);
  assert.equal(r.how, "ramp-8s");
  run(sim, charges, 3 * 3600 * 1000, { every: 20 });
  assert.equal(seen.ended.length, 1);
  const done = seen.ended[0];
  assert.equal(done.end, "full");
  assert.ok(done.mah > 130 && done.mah < 165, `${done.mah} mAh`);
  assert.ok(done.endVolts > 4.3, `${done.endVolts} V`);
  const kept = keptCharge(done, { pack: "p1", firmware: "0.2-beta.6" });
  assert.equal(kept.kind, "charge");
  assert.equal(kept.source, "whoopstor");
  assert.equal(kept.port, 1);
  assert.equal(kept.target, 4.35);
  assert.equal(kept.amps, 0.3);
  assert.equal(kept.resistance, r.mohm);
  assert.equal(kept.trace[0][0] <= 0, true);
  assert.ok(kept.trace.length > 500 && kept.trace.length < 1000, `${kept.trace.length}`);
  // Pulled out once full: still one charge.
  sim.remove(1);
  run(sim, charges, 1000);
  assert.equal(seen.ended.length, 1);
});

test("the same pack reads higher on a port with a longer lead", () => {
  const read = (port) => {
    const sim = new PretendWhoopStor();
    const { charges, seen } = watch();
    sim.start();
    run(sim, charges, 500);
    sim.insert(port, { soc: 0.4, r0: 0.05, r1: 0.02, tau: 2 });
    run(sim, charges, 15000);
    return seen.measured[0].resistance.mohm;
  };
  const near = read(1), far = read(5);
  assert.ok(far - near > 30 && far - near < 60, `${near} on port 1, ${far} on port 5`);
});

test("a pack pulled out part way, a charge joined part way, and a run stopped and started again", () => {
  const sim = new PretendWhoopStor();
  sim.start();
  sim.insert(3, { soc: 0.3 });
  sim.step(20000);
  const { charges, seen } = watch();
  run(sim, charges, 5000);
  assert.equal(seen.began.length, 1);
  assert.equal(seen.began[0].partial, true);
  assert.equal(seen.measured.length, 0);
  sim.remove(3);
  run(sim, charges, 500);
  assert.equal(seen.ended[0].end, "removed");
  assert.ok(seen.ended[0].mah > 0.2);

  sim.insert(4, { soc: 0.3 });
  run(sim, charges, 10000);
  sim.stop();
  run(sim, charges, 1000);
  assert.equal(seen.ended.at(-1).end, "stopped");
  assert.equal(seen.ended.at(-1).port, 4);
  sim.start();
  run(sim, charges, 10000);
  assert.equal(seen.began.length, 3);
  assert.equal(seen.began.at(-1).partial, false);
});

test("the resistance is the slope of voltage against current over the ramp's first 8 seconds", () => {
  assert.equal(resistanceOf([]), null);
  const flat = Array.from({ length: 50 }, (_, i) => [i * 20, 3.8, 0]);
  assert.equal(resistanceOf(flat), null);
  // Up a count every half second, 120 mΩ, readings every 20 ms: too soon at 7 seconds, known at 8.
  const ramp = (ms) => [...Array.from({ length: 20 }, (_, i) => [i * 20, 3.9, 0]),
    ...Array.from({ length: ms / 20 }, (_, i) => { const a = ampsPerCount * (2 + Math.floor((i * 20) / 500)); return [400 + i * 20, 3.9 + 0.12 * a, a]; })];
  assert.equal(resistanceOf(ramp(7000)), null);
  const found = resistanceOf(ramp(8200));
  assert.ok(Math.abs(found.mohm - 120) < 0.5, `${found.mohm}`);
  assert.ok(found.upTo > 0.25 && found.upTo < 0.27, `${found.upTo}`);
  // The current on at once and held: no ramp to tell by.
  const jump = [...Array.from({ length: 10 }, (_, i) => [i * 20, 3.8, 0]), ...Array.from({ length: 500 }, (_, i) => [200 + i * 20, 3.83, 0.3])];
  assert.equal(resistanceOf(jump), null);
});

test("a charge kept before is worked out again the way it is now", () => {
  const old = { source: "whoopstor", trace: Array.from({ length: 600 }, (_, i) => { const a = i < 10 ? 0 : ampsPerCount * (2 + Math.floor(((i - 10) * 20) / 500)); return [i * 20, 4.0 + 0.15 * a, a]; }), resistance: null, resistanceHow: null };
  const again = reworked(old);
  assert.ok(Math.abs(again.resistance - 150) < 0.5, `${again.resistance}`);
  assert.equal(reworked(again), again);
  assert.equal(reworked({ ...old, partial: true }).resistance, null);
});

test("2C for each pack, in the charger's tenths of an amp and never more", () => {
  assert.deepEqual([300, 450, 550, 250, 280, 650, 1000, 150].map((mah) => currentFor(mah)), [0.6, 0.9, 1.1, 0.5, 0.5, 1.3, 1.3, 0.3]);
  assert.equal(currentFor(120), null);
  assert.equal(currentFor(300, 1), 0.3);
  assert.deepEqual([0.3, 0.6, 1.3, null].map(portValueFor), [21, 42, 91, 0]);
  const p1 = { current: 0.3, volts: [4.0, 0, 3.9, 3.8, 0.2, 4.1] };
  const packs = [{ name: "001", mah: 300 }, null, { name: "002", mah: 450 }, null, null, { name: "009", mah: 100 }];
  const plan = chargePlan(p1, (index) => packs[index]);
  assert.deepEqual(plan.map((step) => [step.port, step.amps, step.value]), [[1, 0.6, 42], [3, 0.9, 63], [4, 0.3, 1], [6, null, 0]]);
});

test("the pretend charger takes commands as the real one does, and says so", () => {
  const sim = new PretendWhoopStor();
  sim.insert(1, { soc: 0.5 });
  sim.command(commandBytes(commands.portValue, 7, 0, 42));
  assert.equal(sim.ports[0].value, 42);
  sim.command(commandBytes(commands.start, 8));
  assert.equal(sim.running, true);
  sim.step(20000);
  let p1 = [parseReport(sim.report()), parseReport(sim.report())].find((one) => one.page === 1);
  assert.equal(p1.cmdSeq, 8);
  assert.equal(p1.cmdResult, 0);
  assert.ok(Math.abs(p1.amps[0] - 0.6) < 0.03, `${p1.amps[0]}`);
  sim.command(commandBytes(commands.portValue, 9, 0, 21));
  assert.equal(sim.ports[0].value, 42);                                   // refused while running
  p1 = [parseReport(sim.report()), parseReport(sim.report())].find((one) => one.page === 1);
  assert.deepEqual([p1.cmdSeq, p1.cmdResult], [9, 1]);
  sim.command(commandBytes(commands.stop, 10));
  assert.equal(sim.running, false);
  sim.command(commandBytes(commands.start, 10));                          // the same number again does nothing
  assert.equal(sim.running, false);
});

test("a pack at a storage target is at storage, not full", () => {
  assert.equal(portWords({ state: "full", present: true, running: true, target: 4.35 }), "Full");
  assert.equal(portWords({ state: "full", present: true, running: true, target: 3.85 }), "At storage");
  assert.equal(portWords({ state: "idle", present: true, running: false, target: 3.8, ended: "full" }), "At storage");
  assert.equal(portWords({ state: "bleed", present: true, running: true, target: 3.85 }), "Down to storage");
  assert.equal(portWords({ state: "charge", present: false, running: true, target: 4.35 }), "Empty");
  assert.equal(endedWords({ end: "full", target: 3.85 }), "At storage");
  assert.equal(endedWords({ end: "full", target: 4.35 }), "Full");
});
