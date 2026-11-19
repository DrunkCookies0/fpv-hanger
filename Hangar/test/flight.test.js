// Blackbox logs and the flights in them: a made-up dump, written as Betaflight's encoder writes one
// with answers known in advance, read back and worked out.
import test from "node:test";
import assert from "node:assert/strict";
import { sampleDump } from "../main/samplelog.js";
import { readLogs, isBlackbox } from "../shared/blackbox.js";
import { analyseDump, analyseLog, powerUps, sayingsOf, summaryOf, ratesOf, headerFacts, whoopOf } from "../shared/flight.js";

const near = (value, wanted, within) => assert.ok(Math.abs(value - wanted) <= within, `${value} is not within ${within} of ${wanted}`);

// Two power-ups: a flight and a hop on the first pack, a flight on the second.
const dump = sampleDump({ arms: [{ seconds: 24, powerUp: 0 }, { seconds: 2, powerUp: 0 }, { seconds: 20, powerUp: 1 }] });
const logs = readLogs(dump);

test("a dump is read log by log, each arm with its header, frames and events", () => {
  assert.ok(isBlackbox(dump));
  assert.ok(!isBlackbox(new TextEncoder().encode("not a log")));
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map((L) => L.frames), [24000, 2000, 20000]);
  assert.ok(logs.every((L) => L.ended && L.corrupt === 0));
  assert.equal(logs[0].hdr["Craft name"], "Test Whoop");
  // Disarmed by the switch at the end of each.
  assert.deepEqual(logs[0].events.filter((e) => e.name === "DISARM").map((e) => e.reason), [4]);
  // Time runs on through an arm, a frame a millisecond.
  const time = logs[0].col("time");
  near(time[1] - time[0], 1000, 1);
  assert.equal(logs[0].col("no such field"), null);
});

test("bytes that go wrong part way are passed over, and the rest is read", () => {
  const broken = new Uint8Array(dump);
  const start = Math.floor(broken.length / 6);
  for (let i = start; i < start + 300; i += 1) broken[i] = 0xa5;
  const read = readLogs(broken);
  assert.equal(read.length, 3);
  assert.ok(read[0].corrupt > 0);
  assert.ok(read[0].frames > 20000 && read[0].frames < 24000);
  assert.equal(read[2].frames, 20000);
});

test("a dump's logs are split into power-ups where the flight controller's clock starts again", () => {
  assert.deepEqual(powerUps(logs), [[0, 1], [2]]);
  assert.deepEqual(analyseDump(dump).powerUps, [[0, 1], [2]]);
});

test("a flight's numbers come out as the made-up whoop was made", () => {
  const f = analyseLog(logs[0]);
  near(f.seconds, 24, 0.1);
  assert.equal(f.logHz, 1000);
  assert.ok(f.flyingSeconds > 18 && f.flyingSeconds <= 24);
  // The pack: 4.20 V before arming, sagging 0.5 V at full motor.
  assert.equal(f.battery.beforeArm, 4.2);
  near(f.battery.sagFullMotorV, 0.5, 0.03);
  assert.ok(f.battery.currentSensor && f.battery.mah > 0);
  // The gyro follows 3 ms late through a 15 ms lag: halfway in about 13 ms, no overshoot.
  near(f.step.roll.latencyMs, 13.4, 2);
  assert.ok(f.step.roll.peak < 1.1);
  // Actual rates of 70 in the middle and 670 at full stick.
  assert.equal(f.rates.type, "ACTUAL");
  assert.equal(f.rates.axes.roll.topDps, 670);
  near(f.rates.axes.roll.centerDps, 70, 1);
  // A quiet whoop: little motor jitter, and the frame's 180 Hz line where it was put.
  assert.ok(f.motors.hfNoisePct.every((v) => v < 4));
  assert.equal(f.motors.count, 4);
  assert.ok(f.series.throttle.length >= 90 && f.series.volts.length === f.series.throttle.length);
  assert.ok(f.charts.spectrum.filtered.values.length > 20);
  assert.ok(f.charts.step.roll.length > 50);
  assert.deepEqual(f.disarm, ["switch"]);
});

test("the header says what the flight controller and its tune are", () => {
  const facts = headerFacts(logs[0].hdr);
  assert.match(facts.firmware, /^Betaflight 4\.5\.1/);
  assert.equal(facts.pids.roll, "45,80,30");
  assert.deepEqual(ratesOf(logs[0].hdr).axes.yaw, { rc: 7, srate: 67, expo: 0, limit: 1998 });
  assert.deepEqual(whoopOf(logs[0].hdr), { uid: "MADEUP000000000000000001", craft: "Test Whoop", board: "MADE MADEUPF411", firmware: "Betaflight 4.5.1 (00000000) STM32F411" });
  assert.equal(ratesOf({ rates_type: "1" }).type, "RACEFLIGHT");
  assert.equal(ratesOf({}).axes.roll.limit, 1998);
});

test("a short arm says only that it is short, and a flight says what stands out", () => {
  const hop = analyseLog(logs[1]);
  const said = sayingsOf(hop);
  assert.equal(said.length, 1);
  assert.match(said[0].text, /too short/);
  assert.deepEqual(sayingsOf({ tooShort: true }).map((one) => one.level), ["note"]);
  const flight = analyseLog(logs[0]);
  const lines = sayingsOf(flight);
  assert.ok(lines.length > 0);
  // Worst first.
  const order = { warn: 0, note: 1, good: 2 };
  assert.ok(lines.every((one, i) => i === 0 || order[lines[i - 1].level] <= order[one.level]));
  const summary = summaryOf(flight);
  assert.equal(summary.beforeArm, 4.2);
  assert.equal(summary.headline, lines[0].text);
});

test("what a flight says when something is wrong", () => {
  const base = {
    flyingSeconds: 60, seconds: 62, alarms: [], disarmCodes: [6], motors: { hfNoisePct: [7, 8, 7.5, 9], saturatedPct: 4, singlePinnedEvents: 1, imbalancePct: [0, 0, 0, 0] },
    battery: { minUnderLoad: 3.05 }, step: { roll: { windows: 30, peak: 1.4 } },
    rates: { axes: { yaw: { topUsedPct: 100, over90Pct: 7, topDps: 300 } } }, tracking: { yawSpMean: 2 },
  };
  const text = sayingsOf(base).map((one) => one.text).join(" | ");
  assert.match(text, /runaway takeoff/);
  assert.match(text, /The motors buzz: they jitter about 8%/);
  assert.match(text, /fell to 3\.05 V/);
  assert.match(text, /held at full/);
  assert.match(text, /Yaw runs out/);
  // With the motors buzzing, overshoot can't be trusted and isn't said.
  assert.doesNotMatch(text, /overshoots/);
  // A whoop leaning on one diagonal because it turned one way isn't a fault; one that didn't is.
  const leaning = { ...base, disarmCodes: [], motors: { hfNoisePct: [2, 2, 2, 2], imbalancePct: [-9, 9, 9, -9] } };
  assert.match(sayingsOf(leaning).map((one) => one.text).join(" "), /works 9% (harder|less)/);
  assert.doesNotMatch(sayingsOf({ ...leaning, tracking: { yawSpMean: 40 } }).map((one) => one.text).join(" "), /works 9%/);
});
