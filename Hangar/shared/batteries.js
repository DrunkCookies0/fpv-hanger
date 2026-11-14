// The battery tester: the pilot's packs, what the tester measured on each, and which of them to
// retire. The tester is a board of the pilot's own with a Raspberry Pi Pico on it. Over the Pico's
// USB it sends one JSON message per line: "status" every second, "progress" during a job, "sag"
// after each sag test, and "result" when a job ends. Nothing here touches the disk or the screen.

/** The Pico's USB maker number: the tester shows up as a serial port with it. */
export const testerVendor = 0x2e8a;

/** A sag test only compares with another when both were done on a full pack. */
export const fullVolts = 4.25;

/** Splits what arrives from the tester into whole lines, and each line into a message. */
export class Lines {
  constructor(heard) {
    this.heard = heard;
    this.partial = "";
  }

  push(text) {
    this.partial += text;
    let end;
    while ((end = this.partial.indexOf("\n")) >= 0) {
      const line = this.partial.slice(0, end).trim();
      this.partial = this.partial.slice(end + 1);
      if (line === "") continue;
      try {
        const message = JSON.parse(line);
        if (message && typeof message === "object" && !Array.isArray(message)) this.heard(message);
      } catch {
        // Not one of the tester's messages: something the Pico printed before its program started.
      }
    }
    // A line that never ends is not the tester's.
    if (this.partial.length > 100000) this.partial = "";
  }
}

/**
 * Where a pack's status changes, as the pilot has set them. A pack is RACE while its resistance is no
 * more than `raceResistance` times your typical pack of its size and its capacity at least
 * `raceCapacity` times; FUN within the looser pair, as sag hardly matters for flying about; RETIRE
 * past them. Starting points, to be dialled in once there are packs to go by.
 */
export const defaultLimits = { raceResistance: 1.15, funResistance: 1.6, raceCapacity: 0.9, funCapacity: 0.7 };

/** The limits as they may be set: resistance from half to 3 times typical, capacity 30% to 100%, the
 *  FUN pair no stricter than the RACE pair. Null when they aren't. */
export function limitsChecked(limits) {
  const next = { ...defaultLimits, ...(limits ?? {}) };
  const number = (value, low, high) => Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high;
  if (!number(next.raceResistance, 0.5, 3) || !number(next.funResistance, 0.5, 3) || !number(next.raceCapacity, 0.3, 1) || !number(next.funCapacity, 0.3, 1)) return null;
  if (Number(next.funResistance) < Number(next.raceResistance) || Number(next.funCapacity) > Number(next.raceCapacity)) return null;
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, Math.round(Number(value) * 1000) / 1000]));
}

/** What the library keeps, with nothing missing. */
export const withDefaults = (kept) => ({ packs: { ...(kept?.packs ?? {}) }, tests: { ...(kept?.tests ?? {}) }, limits: limitsChecked(kept?.limits) ?? { ...defaultLimits } });

/** A pack's status, in the words the pilot uses. */
export const statusWords = { race: "RACE", fun: "FUN", retire: "RETIRE", retired: "Retired" };

const statusFrom = (ratio, race, fun) => (ratio <= race ? "race" : ratio <= fun ? "fun" : "retire");
const statusFromCapacity = (ratio, race, fun) => (ratio >= race ? "race" : ratio >= fun ? "fun" : "retire");

/** A new pack, as the pilot names it: "300 #4", 300 mAh. */
export function newPack({ name, mah, brand = "" }, now = new Date()) {
  const label = String(name ?? "").trim();
  const size = Math.round(Number(mah));
  if (label === "") return { problem: "Give the pack a name, such as the number written on it." };
  if (!Number.isFinite(size) || size < 50 || size > 5000) return { problem: "Its capacity is the mAh on its label, between 50 and 5000." };
  // The time it was added, and a little chance: two added in the same moment are still two.
  const id = `p${now.getTime().toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
  return { pack: { id, name: label, mah: size, brand: String(brand ?? "").trim(), added: now.toISOString(), retired: null } };
}

/** One test, as the library keeps it, from the tester's message. Null for a message that isn't a test's end. */
export function keptFrom(message, { pack, at = new Date() }) {
  const base = { id: `t${at.getTime().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, pack, at: at.toISOString() };
  if (message.type === "sag") {
    const { v_rest, r_5ms, r_1s, r_end, v_end, a_end, v_min, v_after, hold_ms, curve } = message;
    return { ...base, kind: "sag", v_rest, r_5ms, r_1s, r_end, v_end, a_end, v_min, v_after, hold_ms, curve: Array.isArray(curve) ? curve : [] };
  }
  if (message.type !== "result") return null;
  if (message.job === "test") {
    return {
      ...base, kind: "capacity", mah: message.drain?.mah ?? null, wh: message.drain?.wh ?? null, cutoff: message.cutoff, rate: message.rate,
      energyEfficiency: message.energy_efficiency ?? null, chargeEfficiency: message.charge_efficiency ?? null,
      sags: (message.sags ?? []).map(({ mah_out, v_rest, r_5ms, r_end }) => ({ mahOut: mah_out, v_rest, r_5ms, r_end })),
      minutes: Math.round((message.s ?? 0) / 60),
    };
  }
  if (message.job === "charge") return { ...base, kind: "charge", mah: message.charge?.mah ?? null, wh: message.charge?.wh ?? null };
  if (message.job === "storage") return { ...base, kind: "storage", v_rest: message.v_rest ?? null };
  return null;
}

/** How many of a pack's charges on the WhoopStor keep their start, reading by reading. */
const keptTraces = 3;

/** Adds a test to what is kept, or puts a changed one in its place. Only each pack's latest sag test
 *  keeps its curve, and its latest few WhoopStor charges their start: the rest keep their numbers. */
export function withTest(batteries, test) {
  const next = withDefaults(batteries);
  next.tests[test.id] = test;
  if (test.kind === "sag") {
    for (const [id, one] of Object.entries(next.tests)) {
      if (id !== test.id && one.pack === test.pack && one.kind === "sag" && one.curve?.length) next.tests[id] = { ...one, curve: [] };
    }
  }
  if (test.source === "whoopstor" && test.pack) {
    const traced = Object.values(next.tests).filter((one) => one.pack === test.pack && one.source === "whoopstor" && one.trace?.length).sort((a, b) => b.at.localeCompare(a.at));
    for (const one of traced.slice(keptTraces)) next.tests[one.id] = { ...one, trace: [] };
  }
  return next;
}

/** The next pack number, three digits as the pilot writes them on the packs: "009" after "008". */
export function nextPackName(batteries) {
  const numbers = Object.values(withDefaults(batteries).packs).map((pack) => (/^\d+$/.test(pack.name) ? Number(pack.name) : 0));
  return String(Math.max(0, ...numbers) + 1).padStart(3, "0");
}

const byTime = (a, b) => a.at.localeCompare(b.at);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Everything known about each pack: { [id]: { pack, sags, fullSags, capacities, latestSag, sag, firstSag, capacity,
 *  charges, latestCharge, cycles, latestCycle, readings, latestReading } }. `sag` is the latest sag test on a full
 *  pack, the one that compares with other packs'. `charges` are its charges on the WhoopStor with a resistance,
 *  oldest first; `readings` the ones of them that compare with other packs' (cycleReadings), oldest first. */
export function factsOf(batteries) {
  const kept = withDefaults(batteries);
  const facts = {};
  for (const pack of Object.values(kept.packs)) facts[pack.id] = { pack, sags: [], fullSags: [], capacities: [], latestSag: null, sag: null, firstSag: null, capacity: null, charges: [], latestCharge: null, cycles: [], latestCycle: null, readings: [], latestReading: null };
  for (const test of Object.values(kept.tests).sort(byTime)) {
    const one = facts[test.pack];
    if (!one) continue;
    if (test.kind === "sag" && typeof test.r_end === "number") {
      one.sags.push(test);
      if (test.v_rest >= fullVolts) one.fullSags.push(test);
    }
    if (test.kind === "capacity" && typeof test.mah === "number") one.capacities.push(test);
    if (test.source === "whoopstor" && typeof test.resistance === "number") one.charges.push(test);
    if (test.kind === "cycle") {
      one.cycles.push(test);
      one.readings.push(...cycleReadings(test));
    }
  }
  for (const one of Object.values(facts)) {
    one.latestSag = one.sags.at(-1) ?? null;
    one.sag = one.fullSags.at(-1) ?? null;
    one.firstSag = one.fullSags[0] ?? null;
    one.capacity = one.capacities.at(-1) ?? null;
    one.latestCharge = one.charges.at(-1) ?? null;
    one.latestCycle = one.cycles.at(-1) ?? null;
    one.latestReading = one.readings.at(-1) ?? null;
  }
  return facts;
}

/** The typical sag of packs of one size, from each one's latest test on a full charge, once there are
 *  three to go by. Retired packs don't count. */
export function typicalSag(facts, mah) {
  const values = Object.values(facts).filter((one) => one.pack.mah === mah && !one.pack.retired && one.sag).map((one) => one.sag.r_end);
  return values.length >= 3 ? median(values) : null;
}

const percent = (ratio) => `${Math.round(Math.abs(ratio - 1) * 100)}%`;

/**
 * What to make of a pack: { word, reasons }. The word is "race", "fun", "retire" (or "retired", for
 * one the pilot has retired), or null when there isn't enough to say. Each measure is against your
 * typical pack of its size, from three packs up: its sag on the tester board or its charging
 * resistance from storage in the WhoopStor's cycle tests, and its capacity, from the tester's full
 * test against its label or the WhoopStor's cycle test against the typical one. The pack takes the
 * worst status any of them gives, by the pilot's `limits`.
 */
export function verdictOf(one, facts, limits = defaultLimits) {
  if (one.pack.retired) return { word: "retired", reasons: [`Retired ${one.pack.retired.slice(0, 10)}`] };
  const reasons = [];
  let worst = 0;
  const rank = { race: 1, fun: 2, retire: 3 };
  const weigh = (word, reason) => {
    reasons.push(reason);
    worst = Math.max(worst, rank[word]);
  };
  const typical = typicalSag(facts, one.pack.mah);
  if (one.sag && typical) {
    const ratio = one.sag.r_end / typical;
    const words = ratio <= 1 ? `${percent(ratio)} less than` : `${percent(ratio)} more than`;
    weigh(statusFrom(ratio, limits.raceResistance, limits.funResistance), `Sags ${ratio === 1 ? "the same as" : words} your typical ${one.pack.mah} mAh pack`);
  } else if (one.sag && one.firstSag && one.firstSag !== one.sag) {
    const ratio = one.sag.r_end / one.firstSag.r_end;
    weigh(statusFrom(ratio, limits.raceResistance, limits.funResistance), ratio <= 1 ? "Sags no more than when first tested" : `Sags ${percent(ratio)} more than when first tested`);
  }
  if (one.capacity) {
    const held = one.capacity.mah / one.pack.mah;
    weigh(statusFromCapacity(held, limits.raceCapacity, limits.funCapacity), `Holds ${Math.round(held * 100)}% of its ${one.pack.mah} mAh`);
  }
  const grade = chargeGrade(one, facts, one.latestReading, limits);
  if (grade) weigh(grade.word, grade.reason);
  const held = cycleGrade(one, facts, limits);
  if (held) weigh(held.word, held.reason);
  reasons.push(...chargeReasons(one), ...cycleReasons(one));
  if (worst === 0) {
    if (one.latestReading || one.latestCycle) {
      reasons.push(`Needs three ${one.pack.mah} mAh packs measured the same way to compare with`);
      return { word: null, reasons };
    }
    // Only plain charges: chargeReasons has said a cycle test grades it.
    if (one.latestCharge) return { word: null, reasons };
    if (!one.sag) reasons.push(one.latestSag ? "Its sag tests so far weren't on a full charge" : "Not tested yet");
    else reasons.push("Test more packs of its size, or this one again later, to compare");
    return { word: null, reasons };
  }
  return { word: Object.keys(rank).find((word) => rank[word] === worst), reasons };
}

/** A pack's capacity from its latest cycle test (what going down to storage took out) against the
 *  typical pack of its size: { word, ratio, typical, reason } or null, from three packs up. */
export function cycleGrade(one, facts, limits = defaultLimits) {
  const mine = latestWindow(one);
  if (!mine) return null;
  const peers = Object.values(facts)
    .filter((other) => other.pack.mah === one.pack.mah && !other.pack.retired && other.pack.id !== one.pack.id)
    .map(latestWindow)
    .filter((other) => other && other.fullVolts === mine.fullVolts);
  if (peers.length < 2) return null;
  const typical = median([mine.out, ...peers.map((other) => other.out)]);
  const ratio = mine.out / typical;
  return {
    word: statusFromCapacity(ratio, limits.raceCapacity, limits.funCapacity), ratio, typical,
    reason: `Gives back ${Math.round(ratio * 100)}% of what your typical ${one.pack.mah} mAh pack does between ${mine.storageVolts} and ${mine.fullVolts} V`,
  };
}

/** Where each of a pack's measures puts it against the typical pack of its size: { resistance,
 *  capacity }, as ratios, or null for those not known. For suggesting limits. */
export function ratiosOf(one, facts) {
  const typical = typicalSag(facts, one.pack.mah);
  const resistance = chargeGrade(one, facts)?.ratio ?? (one.sag && typical ? one.sag.r_end / typical : null);
  const capacity = cycleGrade(one, facts)?.ratio ?? (one.capacity ? one.capacity.mah / one.pack.mah : null);
  return { resistance, capacity };
}

/**
 * Limits that agree best with the pilot's own calls on their packs (pack.call: "race", "fun" or
 * "retire"): { raceResistance, funResistance, raceCapacity, funCapacity, calls }, each null where
 * there isn't a call on both sides of it to go by. Each is the point that puts the fewest called
 * packs on the wrong side of it, the middle of the range of such points, rounded to a percent.
 */
export function recommendLimits(facts) {
  const called = Object.values(facts).filter((one) => !one.pack.retired && ["race", "fun", "retire"].includes(one.pack.call))
    .map((one) => ({ call: one.pack.call, ...ratiosOf(one, facts) }));
  // `passes(row)` says which side of the limit the pilot put a pack; `low` limits are "at most".
  const best = (key, passes, low) => {
    const rows = called.filter((row) => typeof row[key] === "number");
    if (!rows.some(passes) || !rows.some((row) => !passes(row))) return null;
    const values = [...new Set(rows.map((row) => row[key]))].sort((a, b) => a - b);
    const cuts = [values[0] - 0.01, ...values.slice(1).map((value, index) => (value + values[index]) / 2), values.at(-1) + 0.01];
    const wrong = (cut) => rows.filter((row) => (low ? row[key] <= cut : row[key] >= cut) !== passes(row)).length;
    const least = Math.min(...cuts.map(wrong));
    const good = cuts.filter((cut) => wrong(cut) === least);
    return Math.round(((good[0] + good.at(-1)) / 2) * 100) / 100;
  };
  const race = (row) => row.call === "race", notRetire = (row) => row.call !== "retire";
  return {
    raceResistance: best("resistance", race, true), funResistance: best("resistance", notRetire, true),
    raceCapacity: best("capacity", race, false), funCapacity: best("capacity", notRetire, false),
    calls: called.length,
  };
}

/**
 * The charges in a cycle test that compare from pack to pack: each charge after its first, which starts
 * from storage after the 5-minute rest, at the test's 2C, whichever port: `{ at, port, resistance,
 * amps, test }`. A pack's other charges start wherever it happens to be (a first charge after sitting
 * read up to 20% high, a top-up from full 25% low), so they aren't compared. The ports read alike
 * this way (the pilot's packs of one make within about 5% on every port in each run), so no port is
 * allowed for: what moves the readings more is the day, about 5% from one run to the next.
 */
export function cycleReadings(test) {
  return (test?.steps ?? []).flatMap((step, index) => (index > 0 && step.kind === "charge" && step.resistance > 0
    ? [{ at: test.at, port: test.port, resistance: step.resistance, amps: test.amps, test: test.id }]
    : []));
}

/**
 * RACE, FUN or RETIRE from the WhoopStor's cycle tests, as the words "race", "fun" and "retire":
 * { word, ratio, typical, reason }, or null without enough to go on. The pack's charging resistance from
 * storage (its latest cycle reading, or `latest`, a charge going on that is one) against the typical
 * pack of its size (the middle one), each by its latest cycle reading. Three packs of its size first.
 * Where the status changes is the pilot's `limits`.
 */
export function chargeGrade(one, facts, latest = one.latestReading, limits = defaultLimits) {
  if (!(latest?.resistance > 0)) return null;
  const peers = Object.values(facts)
    .filter((other) => other.pack.mah === one.pack.mah && !other.pack.retired && other.pack.id !== one.pack.id && other.latestReading)
    .map((other) => other.latestReading.resistance);
  if (peers.length < 2) return null;
  const typical = median([latest.resistance, ...peers]);
  const ratio = latest.resistance / typical;
  const word = statusFrom(ratio, limits.raceResistance, limits.funResistance);
  const how = Math.abs(ratio - 1) < 0.005 ? "the same as" : ratio < 1 ? `${percent(ratio)} below` : `${percent(ratio)} above`;
  return { word, ratio, typical, reason: `Charging resistance from storage ${how} your typical ${one.pack.mah} mAh pack's, in cycle tests` };
}

/** What the WhoopStor's charges say about a pack, in words: its latest resistance from storage in a
 *  cycle test, and how it has moved since its first; or, with charges but no cycle test, that one
 *  is needed to grade it. */
export function chargeReasons(one) {
  const last = one.latestReading;
  if (!last) return one.latestCharge ? ["A cycle test grades its charging resistance: its other charges started wherever the pack was"] : [];
  const words = [`${Math.round(last.resistance)} mΩ charging from storage on port ${last.port}`];
  const first = one.readings[0];
  if (first && first !== last) {
    const ratio = last.resistance / first.resistance;
    if (Math.abs(ratio - 1) >= 0.1) words.push(`${percent(ratio)} ${ratio > 1 ? "higher" : "lower"} than in its first cycle test, ${first.at.slice(0, 10)}`);
  }
  return words;
}

/** What a cycle test measured, as one number each way: what a charge from storage to full put in,
 *  and what going back down to storage took out (the latter worked out, not measured). Null for a
 *  test without both. */
export function cycleWindow(test) {
  const steps = test?.steps ?? [];
  // Only steps that got there: a test stopped part way keeps the step it was on, but not as a whole one.
  const got = (step) => typeof step.endVolts !== "number" || (step.kind === "charge" ? step.endVolts >= test.fullVolts - 0.03 : step.endVolts <= test.storageVolts + 0.03);
  // A charge counts from the second step on: the first started wherever the pack was.
  const ins = steps.filter((step, index) => step.kind === "charge" && index > 0 && got(step)).map((step) => step.mah);
  const outs = steps.filter((step) => step.kind === "discharge" && got(step)).map((step) => step.mah);
  if (!outs.length) return null;
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return { in: mean(ins), out: mean(outs), fullVolts: test.fullVolts, storageVolts: test.storageVolts };
}

/** What a pack's latest cycle test that took it down to storage measured (cycleWindow), or null. */
const latestWindow = (one) => {
  for (let index = one.cycles.length - 1; index >= 0; index -= 1) {
    const window = cycleWindow(one.cycles[index]);
    if (window) return window;
  }
  return null;
};

/** What a pack's latest cycle test says, in words. */
export function cycleReasons(one) {
  const window = latestWindow(one);
  if (!window) return [];
  const between = `between ${window.storageVolts} and ${window.fullVolts} V`;
  return [window.in !== null
    ? `Cycle test: ${Math.round(window.in)} mAh in and about ${Math.round(window.out)} out ${between}`
    : `Cycle test: about ${Math.round(window.out)} mAh out ${between}`];
}

/** The limits the tester's light should go by for a pack, so it agrees with the Hangar: null until
 *  there is a typical pack of its size. */
export function limitsFor(facts, packId, limits = defaultLimits) {
  const one = facts[packId];
  const typical = one && typicalSag(facts, one.pack.mah);
  if (!typical) return null;
  return { good_mohm: Math.round(typical * limits.raceResistance * 10) / 10, bad_mohm: Math.round(typical * limits.funResistance * 10) / 10 };
}

/** What the tester is doing, in words. */
export const phaseWords = {
  charge: "Charging",
  rest: "Letting it settle",
  sag: "Sag test",
  drain: "Draining at about 0.5 A",
  drain_rest: "Letting it settle before a sag test",
  drain_sag: "Sag test on the way down",
  drain_cooling: "Waiting for the tester to cool",
  recharge: "Charging it back up",
  storage: "Taking it to storage voltage",
};

/** Why the tester stopped a job, in words. */
export const problemWords = {
  no_power: "The tester's power socket has nothing plugged in, or it went out.",
  pack_removed: "The pack was unplugged.",
  charge_too_long: "Charging went on for over five hours and was stopped.",
  pack_too_low_for_pull: "The pack is under 3.5 V, too low for a sag test. Charge it first.",
  master_switch_leaks: "The heavy load's master switch lets current through when it should be off. The tester needs looking at before another sag test.",
  port_switch_leaks: "The port's heavy-load switch lets current through when it should be off. The tester needs looking at before another sag test.",
  no_current: "The heavy load drew nothing. Is the cement resistor soldered in?",
  fault: "Something went wrong in the tester's program.",
};

/** Why the tester wouldn't start something, in words. */
export const refusalWords = {
  no_power: "Plug a USB-C charger into the tester's power socket first. Your computer's USB only carries the data.",
  no_pack: "Plug a pack into the tester first.",
  busy: "The tester is already doing something. Stop it first.",
  port_fault: "The tester found a fault when it started. Unplug it and plug it back in; if it says so again, it needs looking at.",
};
