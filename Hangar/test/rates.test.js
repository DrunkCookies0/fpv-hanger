// Rates: Betaflight's five rate types worked out as its firmware does, the same feel found in
// another type, and rates read from and written for Betaflight's CLI. The CLI text here is made up,
// in the shape Betaflight prints it.
import test from "node:test";
import assert from "node:assert/strict";
import { rateAt, topOf, centerOf, convert, strays, readRates, cliLines, defaultsFor, shown, fromShown, ceiling, axes } from "../shared/rates.js";

const near = (value, wanted, within = 0.01) => assert.ok(Math.abs(value - wanted) <= within, `${value} is not ${wanted}`);
const every = (setting) => ({ roll: { ...setting }, pitch: { ...setting }, yaw: { ...setting } });

test("each rate type turns as Betaflight works it out", () => {
  // Actual, as a new flight controller comes: 70 in the middle, 670 at full stick, no expo.
  const actual = { rc: 7, srate: 67, expo: 0 };
  near(rateAt("ACTUAL", actual, 1), 670);
  near(rateAt("ACTUAL", actual, 0.5), 0.5 * 70 + 600 * 0.25);
  near(centerOf("ACTUAL", actual), 70, 1);
  near(rateAt("ACTUAL", actual, -0.5), -185);
  near(rateAt("ACTUAL", actual, 0), 0);

  // Betaflight's own: RC Rate 1.00, Super Rate 0.70.
  const betaflight = { rc: 100, srate: 70, expo: 0 };
  near(rateAt("BETAFLIGHT", betaflight, 1), 200 / 0.3);
  near(rateAt("BETAFLIGHT", betaflight, 0.5), 100 / 0.65);
  near(centerOf("BETAFLIGHT", betaflight), 200, 1);
  // With expo the middle is softer and the end the same.
  const soft = { rc: 100, srate: 70, expo: 50 };
  near(rateAt("BETAFLIGHT", soft, 1), 200 / 0.3);
  near(rateAt("BETAFLIGHT", soft, 0.5), (200 * (0.0625 * 0.5 + 0.5 * 0.5)) / 0.65);
  // Above 2.00 the RC Rate climbs much faster.
  near(rateAt("BETAFLIGHT", { rc: 255, srate: 0, expo: 0 }, 0.1), 200 * (2.55 + 14.54 * 0.55) * 0.1);

  // KISS with no curve is the same as Betaflight's with no expo.
  near(rateAt("KISS", { rc: 100, srate: 70, expo: 0 }, 1), 200 / 0.3);
  near(rateAt("KISS", { rc: 100, srate: 70, expo: 0 }, 0.37), rateAt("BETAFLIGHT", betaflight, 0.37));

  // Quick: RC Rate 1.00 is 200 in the middle, and the max rate is the turn at full stick.
  const quick = { rc: 100, srate: 67, expo: 0 };
  near(rateAt("QUICK", quick, 1), 670);
  near(centerOf("QUICK", quick), 200, 1);
  near(rateAt("QUICK", { rc: 100, srate: 67, expo: 30 }, 1), 670);
  near(rateAt("QUICK", { rc: 100, srate: 67, expo: 30 }, 1, true), 670);

  // Raceflight: a rate of 370, Acro+ 80, expo 50.
  near(rateAt("RACEFLIGHT", { rc: 37, srate: 80, expo: 50 }, 1), 370 * 1.8);
  near(rateAt("RACEFLIGHT", { rc: 37, srate: 80, expo: 50 }, 0.5), 370 * (1 + 0.5 * (0.25 - 1)) * 0.5 * 1.4);
});

test("no rate turns faster than Betaflight's ceiling, or the axis's own limit", () => {
  assert.equal(rateAt("BETAFLIGHT", { rc: 255, srate: 100, expo: 0 }, 1), ceiling);
  assert.equal(rateAt("ACTUAL", { rc: 200, srate: 200, expo: 0 }, 1), ceiling);
  assert.equal(rateAt("ACTUAL", { rc: 7, srate: 67, expo: 0, limit: 500 }, 1), 500);
  assert.equal(topOf("ACTUAL", { rc: 7, srate: 67, expo: 0, limit: 500 }), 500);
  assert.equal(rateAt("KISS", { rc: 255, srate: 99, expo: 0 }, -1), -ceiling);
});

test("rates already the same in two types are found exactly", () => {
  const from = { type: "BETAFLIGHT", quickExpo: false, axes: every({ rc: 120, srate: 72, expo: 0, limit: ceiling }) };
  const kiss = convert(from, "KISS");
  for (const axis of axes) {
    assert.deepEqual({ rc: kiss.axes[axis].rc, srate: kiss.axes[axis].srate, expo: kiss.axes[axis].expo }, { rc: 120, srate: 72, expo: 0 });
    near(kiss.off[axis], 0, 1e-6);
  }
  // Into its own type, a setting stays as it is.
  const same = convert(from, "BETAFLIGHT");
  assert.equal(same.axes.roll.rc, 120);
  assert.equal(same.axes.roll.srate, 72);
});

test("another type's nearest curve keeps the feel: the middle and the top", () => {
  // A whoop's Betaflight rates, roll and pitch alike, a softer yaw.
  const from = {
    type: "BETAFLIGHT", quickExpo: false,
    axes: { roll: { rc: 110, srate: 75, expo: 20, limit: ceiling }, pitch: { rc: 110, srate: 75, expo: 20, limit: ceiling }, yaw: { rc: 100, srate: 65, expo: 0, limit: ceiling } },
  };
  for (const type of ["ACTUAL", "QUICK", "KISS", "RACEFLIGHT"]) {
    const found = convert(from, type);
    for (const axis of axes) {
      const top = topOf(from.type, from.axes[axis]);
      // The fastest turn comes out within a few degrees a second, and the whole curve within a few
      // percent of it. Raceflight's curve is shaped too differently to follow a super rate closely.
      near(topOf(type, found.axes[axis]), top, 12);
      assert.ok(found.off[axis] < top * (type === "RACEFLIGHT" ? 0.1 : 0.06), `${type} ${axis} strays ${found.off[axis].toFixed(1)}°/s`);
      near(found.off[axis], strays(from, found, axis), 1e-9);
    }
    assert.deepEqual(found.axes.roll, found.axes.pitch);
  }
  // Actual's center and max rate land close to the curve's own.
  const actual = convert(from, "ACTUAL");
  near(actual.axes.yaw.srate * 10, topOf("BETAFLIGHT", from.axes.yaw), 10);
  near(centerOf("ACTUAL", actual.axes.roll), centerOf("BETAFLIGHT", from.axes.roll), 12);
});

test("a curve another type can't take the shape of comes as near as it can, with the fastest turn kept", () => {
  // Actual as it comes rises steadily from 70 in the middle; a super rate's curve stays flat and
  // then climbs, so Betaflight's type can only come so near it.
  const from = { type: "ACTUAL", quickExpo: false, axes: every({ rc: 7, srate: 67, expo: 0, limit: ceiling }) };
  const found = convert(from, "BETAFLIGHT");
  near(topOf("BETAFLIGHT", found.axes.roll), 670, 5);
  assert.ok(found.off.roll > 25 && found.off.roll < 60, `strays ${found.off.roll.toFixed(1)}°/s`);
});

test("the settings found are always ones Betaflight's app allows", () => {
  const wild = { type: "BETAFLIGHT", quickExpo: false, axes: every({ rc: 255, srate: 100, expo: 100, limit: ceiling }) };
  const found = convert(wild, "ACTUAL");
  assert.ok(found.axes.roll.rc >= 1 && found.axes.roll.rc <= 200 && found.axes.roll.srate <= 200 && found.axes.roll.expo <= 100);
  const kiss = convert(wild, "KISS");
  assert.ok(kiss.axes.roll.srate <= 99);
});

test("a setting shows as Betaflight's app shows it, and what is typed comes back as the CLI's number", () => {
  assert.equal(shown("ACTUAL", "rc", 7), "70");
  assert.equal(shown("ACTUAL", "srate", 67), "670");
  assert.equal(shown("ACTUAL", "expo", 54), "0.54");
  assert.equal(shown("BETAFLIGHT", "rc", 100), "1.00");
  assert.equal(shown("RACEFLIGHT", "srate", 80), "80");
  assert.equal(fromShown("ACTUAL", "srate", "670"), 67);
  assert.equal(fromShown("ACTUAL", "srate", "674"), 67);
  assert.equal(fromShown("ACTUAL", "srate", "5000"), 200);
  assert.equal(fromShown("BETAFLIGHT", "rc", "1,25"), 125);
  assert.equal(fromShown("BETAFLIGHT", "rc", "0"), 1);
  assert.equal(fromShown("KISS", "srate", "1"), 99);
  assert.equal(fromShown("ACTUAL", "expo", ""), null);
  assert.equal(fromShown("ACTUAL", "expo", "abc"), null);
});

const diffAll = `# diff all

# version
# Betaflight / STM32F411 (S411) 4.5.1 Jan  1 2026 / 12:00:00 (abcdef123) MSP API: 1.46
# config rev: 1a2b3c4

# start the command batch
batch start

board_name MADEUPF411
manufacturer_id MADE

# name: Made-up Whoop

# master
set motor_pwm_protocol = DSHOT300

profile 0

# rateprofile 0
rateprofile 0

set rateprofile_name = RACE
set roll_rc_rate = 12
set pitch_rc_rate = 12
set roll_expo = 30
set pitch_expo = 30
set roll_srate = 80
set pitch_srate = 80
set yaw_srate = 50

# rateprofile 1
rateprofile 1

set rates_type = BETAFLIGHT
set roll_rc_rate = 110
set pitch_rc_rate = 110
set yaw_rc_rate = 90
set yaw_rate_limit = 800

# rateprofile 2
rateprofile 2

# restore original rateprofile selection
rateprofile 1

# save configuration
save
`;

test("rates are read from a diff all, with what it leaves out as the version has it", () => {
  const read = readRates(diffAll);
  assert.equal(read.version, "4.5.1");
  assert.equal(read.active, 1);
  assert.deepEqual(read.profiles.map((one) => one.index), [0, 1, 2]);
  const [race, other, untouched] = read.profiles;
  assert.equal(race.name, "RACE");
  assert.equal(race.type, "ACTUAL");
  assert.deepEqual(race.axes.roll, { rc: 12, srate: 80, expo: 30, limit: ceiling });
  assert.deepEqual(race.axes.yaw, { rc: 7, srate: 50, expo: 0, limit: ceiling });
  assert.equal(other.type, "BETAFLIGHT");
  // Changed to Betaflight's type, the rest are still the numbers Actual came with.
  assert.deepEqual(other.axes.yaw, { rc: 90, srate: 67, expo: 0, limit: 800 });
  assert.deepEqual(untouched.axes.roll, { rc: 7, srate: 67, expo: 0, limit: ceiling });
});

test("rates are read from older Betaflight, a plain diff and get", () => {
  const older = readRates("# BetaFlight / STM32F7X2 (S7X2) 4.2.11 Jan  1 2026 / 12:00:00 (abc) MSP API: 1.43\nrateprofile 0\nset roll_expo = 10\n");
  assert.equal(older.profiles[0].type, "BETAFLIGHT");
  assert.deepEqual(older.profiles[0].axes.roll, { rc: 100, srate: 70, expo: 10, limit: ceiling });
  const newer = readRates("# Betaflight / STM32F405 (S405) 2025.12.0 Jan  1 2026 / 12:00:00 (abc) MSP API: 1.47\nrateprofile 0\n");
  assert.equal(newer.profiles[0].type, "ACTUAL");
  // What `get rate` prints: no set, no profile.
  const got = readRates("rates_type = QUICK\nAllowed values: BETAFLIGHT, RACEFLIGHT, KISS, ACTUAL, QUICK\nquickrates_rc_expo = ON\nroll_rc_rate = 100\nAllowed range: 1 - 255\n");
  assert.equal(got.profiles.length, 1);
  assert.equal(got.profiles[0].index, null);
  assert.equal(got.active, null);
  assert.equal(got.profiles[0].type, "QUICK");
  assert.equal(got.profiles[0].quickExpo, true);
  assert.equal(got.profiles[0].axes.roll.rc, 100);
  assert.equal(readRates("set motor_pwm_protocol = DSHOT300\nfeature -AIRMODE"), null);
  assert.equal(readRates(""), null);
  assert.equal(defaultsFor(null).type, "ACTUAL");
});

test("the lines for Betaflight's CLI set the type and all nine numbers, in its order, and save", () => {
  const lines = cliLines({ type: "ACTUAL", axes: every({ rc: 7, srate: 67, expo: 54 }) }, 1);
  assert.deepEqual(lines, [
    "rateprofile 1",
    "set rates_type = ACTUAL",
    "set roll_rc_rate = 7", "set pitch_rc_rate = 7", "set yaw_rc_rate = 7",
    "set roll_expo = 54", "set pitch_expo = 54", "set yaw_expo = 54",
    "set roll_srate = 67", "set pitch_srate = 67", "set yaw_srate = 67",
    "save",
  ]);
  const quick = cliLines({ type: "QUICK", axes: every({ rc: 100, srate: 67, expo: 0 }) });
  assert.equal(quick[0], "set rates_type = QUICK");
  assert.equal(quick[1], "set quickrates_rc_expo = OFF");
  // Read back, the lines are the same rates.
  const back = readRates(lines.join("\n"));
  assert.equal(back.active, 1);
  assert.deepEqual(back.profiles[0].axes.pitch, { rc: 7, srate: 67, expo: 54, limit: ceiling });
});
