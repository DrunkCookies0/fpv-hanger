// The WhoopStor V3, VIFLY's six-port 1S charger, running WS3 Unlocked or OpenWS3 (open firmware for
// it). Over its USB-C it is a HID device that sends a 64-byte report every 10 ms, in turn: page 1, the
// charger (each port's state, voltage and current), and page 2, its limits (what each port is set to).
// The layout is the firmware's USB.md. It takes a few commands the same way, as its buttons would: the
// Hangar sends them only when the pilot presses Start or Stop. How a pack is charged, its voltages,
// limits and cut-offs, stays the charger's own.
//
// From those reports it follows each charge: how much went in, and the pack's resistance, from how
// the voltage rises with the current while the charge starts. That resistance includes the port's
// own plug and lead, so it compares between packs on the same port. Nothing here touches the disk or
// the screen.

export const whoopstorVendor = 0x34bf;
export const whoopstorProduct = 0x1004;
export const isWhoopstor = (device) => Number(device?.vendorId) === whoopstorVendor && Number(device?.productId) === whoopstorProduct;

/** The firmware's units: volts and amps per count. */
export const voltsPerCount = 4.5 / 4096;
export const ampsPerCount = 1 / 68.25;

/** The four targets, by the number the charger sends. */
export const targetVolts = [4.2, 4.35, 3.8, 3.85];
/** Port states, by the number the charger sends. */
export const portStates = ["idle", "probe", "charge", "rest", "full", "bleed", "fault"];
/** Why the charger stopped (page 1, byte 11). */
export const stopWords = ["", "the input is too low", "its supply is too low", "its rail is out of range", "it was stopped", "the input fell below MIN IN VOLTS", "the board is too hot"];

const NO_CELL = 1.0;                 // volts: below this a port has no pack
const LOOK_BACK_MS = 1500;           // how much of a port's readings before a charge starts are kept
const TRACE_MS = 15000;              // how much of each charge's start is kept, reading by reading
const FIT_MS = 8000;                 // how much of the current's ramp the resistance is worked out over
export const CURVE_MS = 10000;       // a charge's whole curve, for its graph: a reading every 10 seconds
const SETTLE_MS = 150;               // after a pack is plugged in, its first readings are left out

/** A current setting by the name the charger gives it: its steps are 7 counts apart, 21 counts being
 *  what it calls 0.3 A. */
const setting = (counts) => Math.round(counts / 7) / 10;

/** A report as numbers, or null for one that isn't whole. `bytes` is the report's 64 bytes. */
export function parseReport(bytes) {
  const r = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (r.length !== 64 || r[0] !== 0x57 || r[1] !== 0x33 || !r[2] || r[2] !== r[63]) return null;
  const u16 = (i) => (r[i] << 8) | r[i + 1];
  const u32 = (i) => r[i] * 16777216 + (r[i + 1] << 16) + (r[i + 2] << 8) + r[i + 3];
  const six = (f) => [0, 1, 2, 3, 4, 5].map(f);
  const page = r[3];
  if (page === 1) {
    return {
      page, ms: u32(4),
      running: Boolean(r[8] & 1), target: targetVolts[(r[8] >> 1) & 3], outputs: Boolean(r[8] & 8),
      current: setting(r[9]),
      release: r[10] ? `${r[10] >> 4}.${r[10] & 15}` : null,
      stopped: r[11], condition: r[12] & 15,
      event: { seq: r[13], code: r[14], port: r[15] },
      cmdSeq: r[16], cmdResult: r[17],
      states: six((i) => portStates[r[18 + i]] ?? "idle"),
      bleeding: six((i) => Boolean(r[24] & (1 << i))),
      targetIndex: (r[8] >> 1) & 3,
      phase: r[25],
      volts: six((i) => u16(38 + 2 * i) * voltsPerCount),
      amps: six((i) => r[50 + i] * ampsPerCount),
      counts: six((i) => r[50 + i]),
      // The firmware's own formula for its input: (raw + 1) x 4 / 61, in tenths of a volt.
      input: (u16(58) + 1) * 4 / 610,
    };
  }
  if (page === 2) {
    return {
      page, ms: u32(4),
      setAmps: six((i) => setting(r[30 + i])),
      portValues: six((i) => r[36 + i]),
      targetCell: u16(44) * voltsPerCount,
      beta: r[47],
      build: u32(57).toString(16).padStart(8, "0"),
      dirty: Boolean(r[61]),
    };
  }
  return { page, ms: u32(4) };
}

/** The commands the Hangar sends, by the firmware's numbers (USB.md). Each goes in a 64-byte report:
 *  the command, its argument, a sequence number the charger echoes once it has run it (page 1, byte
 *  16, with the result in byte 17: 0 done, 1 refused, 2 unknown), and for a port's value, the value. */
export const commands = { stop: 1, start: 2, target: 4, portValue: 10 };

/** Full and storage, by the charger's numbers for its targets: LiHV is 4.35 V full and 3.85 V
 *  storage, LiPo 4.20 V and 3.80 V. From the charger's target as it is: a storage target goes with its own full one. */
export function chargeAndStorage(target) {
  const lipo = target === 4.2 || target === 3.8;
  return lipo ? { full: 0, storage: 2, fullVolts: 4.2, storageVolts: 3.8 } : { full: 1, storage: 3, fullVolts: 4.35, storageVolts: 3.85 };
}

/** Each port's storage load: an 18 ohm resistor (OpenWS3's HARDWARE.md, measured on the board). The
 *  charger can't measure the current through it, so what it takes out is worked out from the voltage:
 *  milliamp-hours over `ms` at `volts`. About right, by the resistor's tolerance. */
export const bleedOhms = 18;
export const bleedMah = (volts, ms) => (volts / bleedOhms) * (ms / 3600);

export function commandBytes(code, seq, arg = 0, extra = 0) {
  const bytes = new Uint8Array(64);
  bytes[0] = code;
  bytes[1] = arg;
  bytes[2] = seq;
  bytes[3] = extra;
  return bytes;
}

/** A port's value as the charger keeps it: 0 sits the run out, 1 charges at the charger's own
 *  current, and a current step of its own in counts (21 for 0.3 A, then 7 a tenth of an amp). */
export const portValueFor = (amps) => (amps === null ? 0 : Math.round(amps * 10) * 7);

/** The current for a pack: `rate` times its capacity, down to the charger's tenth of an amp so it is
 *  never more, at most 1.3 A. Null for a pack too small for the charger's least, 0.3 A, at that rate. */
export function currentFor(mah, rate = 2) {
  const amps = Math.min(1.3, Math.floor((rate * mah) / 100 + 1e-9) / 10);
  return amps >= 0.3 ? amps : null;
}

/**
 * What Start would do in each port: [{ port, pack, amps, value, why }], for the ports with a pack in.
 * `packFor(index)` is the pack the pilot said is in a port, or null. A known pack charges at `rate`
 * times its capacity; one not yet named at the charger's own current; one too small is left out.
 */
export function chargePlan(p1, packFor, rate = 2) {
  if (!p1) return [];
  const plan = [];
  p1.volts.forEach((volts, index) => {
    if (volts < NO_CELL) return;
    const pack = packFor(index);
    if (!pack) return plan.push({ port: index + 1, pack: null, amps: p1.current, value: 1, why: "no number yet: the charger's own current" });
    const amps = currentFor(pack.mah, rate);
    if (amps === null) return plan.push({ port: index + 1, pack, amps: null, value: 0, why: `too small for ${rate}C: the charger's least is 0.3 A, so it sits this run out` });
    plan.push({ port: index + 1, pack, amps, value: portValueFor(amps), why: `${rate}C for ${pack.mah} mAh` });
  });
  return plan;
}

/** The firmware's version, as a person would write it: "0.2-beta.6". */
export function firmwareWords(p1, p2) {
  if (!p1?.release) return null;
  return p2?.beta ? `${p1.release}-beta.${p2.beta}` : p1.release;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The way the resistance is worked out now. A kept charge worked out an older way, or not at all,
 *  is worked out again from its readings (see reworked). */
export const resistanceMethod = "ramp-8s";

/**
 * A pack's resistance from the start of its charge: { mohm, how, points, upTo } or null when there
 * isn't enough to go on yet. `samples` are [ms, volts, amps].
 *
 * The WhoopStor brings the current up slowly as a charge starts, a step every half second or so:
 * about 0.25 A after 8 seconds of a 0.6 A charge. All the while the voltage climbs by the current
 * times the pack's resistance (with its plug and lead). A straight line through the readings over
 * the first FIT_MS of current, voltage against current, with the voltage at rest just before, has
 * that resistance as its slope. On the pilot's charger the readings sit within a millivolt of such
 * a line. The same stretch of time every charge, so packs compare: over longer, the pack's slower
 * part creeps in and the figure rises a little.
 */
export function resistanceOf(samples) {
  if (!samples.length) return null;
  // A pack just plugged in: the charger's filtered reading takes a moment to catch up with it.
  let from = samples[0][0];
  for (let i = 1; i < samples.length; i += 1) if (samples[i - 1][1] < NO_CELL && samples[i][1] >= NO_CELL) from = samples[i][0] + SETTLE_MS;
  const usable = samples.filter(([ms, v]) => ms >= from && v >= NO_CELL);
  const onAt = usable.findIndex(([, , a]) => a > 1.5 * ampsPerCount);
  if (onAt < 0) return null;
  const on = usable[onAt][0];
  if (usable.at(-1)[0] - on < FIT_MS) return null;
  const rest = usable.slice(Math.max(0, onAt - 10), onAt).filter(([, , a]) => a === 0).map(([, v]) => v);
  const ramp = usable.slice(onAt).filter(([ms]) => ms <= on + FIT_MS);
  const currents = ramp.map(([, , a]) => a);
  const upTo = Math.max(...currents);
  // Too little current to tell by, as when the charger's input limits hold the port back.
  if (upTo - Math.min(...currents) < 8 * ampsPerCount) return null;
  const restVolts = rest.length ? median(rest) : null;
  const points = [...(restVolts === null ? [] : Array(Math.min(5, rest.length)).fill([0, restVolts])), ...ramp.map(([, v, a]) => [a, v])];
  const n = points.length;
  const mx = points.reduce((sum, [x]) => sum + x, 0) / n, my = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  if (!(sxx > 0)) return null;
  return { mohm: Math.round((sxy / sxx) * 10000) / 10, how: resistanceMethod, points: n, upTo: Math.round(upTo * 1000) / 1000 };
}

/** A kept charge with its resistance worked out again from its readings, when it was worked out an
 *  older way or not at all. The same charge when there is nothing to change. */
export function reworked(test) {
  if (test?.source !== "whoopstor" || !test.trace?.length || test.partial || test.resistanceHow === resistanceMethod) return test;
  const found = resistanceOf(test.trace);
  return { ...test, resistance: found?.mohm ?? null, resistanceHow: found ? found.how : resistanceMethod, upTo: found?.upTo ?? null };
}

/**
 * Follows every port's charges from the reports. `heard(report)` takes each one, parsed; the
 * callbacks say what happened: began(session) when a pack starts charging, measured(session) once
 * its resistance is known, ended(session) when it is full, faulted or pulled out.
 *
 * A session is one pack's time in a port: { port (1 to 6), began (a Date), mah, amps (the current
 * it was set to), target, startVolts, endVolts, resistance, end ("full", "fault", "removed",
 * "stopped" or "disconnected"), partial (true when the Hangar joined after it began), trace }.
 */
export class Charges {
  constructor({ began = () => {}, measured = () => {}, ended = () => {}, now = () => new Date() } = {}) {
    Object.assign(this, { began, measured, ended, now });
    this.p1 = null;
    this.p2 = null;
    this.ports = [0, 1, 2, 3, 4, 5].map(() => ({ before: [], session: null, present: false }));
  }

  /** Takes one parsed report. */
  heard(report) {
    if (!report) return;
    if (report.page === 2) {
      this.p2 = report;
      return;
    }
    if (report.page !== 1) return;
    const last = this.p1;
    this.p1 = report;
    if (report.phase !== 7) return;                       // before the charger runs, its readings are zero
    // A gap between readings counts as a second at most, except the time the USB was out (resume):
    // the charger went on by itself meanwhile, and its clock says for how long.
    const gap = last ? report.ms - last.ms : 0;
    const dt = gap > 0 ? Math.min(gap, this.resuming ? Infinity : 1000) : 0;
    this.resuming = false;
    report.states.forEach((state, index) => this.port(index, state, report, dt, last));
  }

  /** The USB is back after being out, with the charges still open: the next reading takes in the time
   *  between, what went in meanwhile made up from the currents either side of it. */
  resume() {
    this.resuming = true;
  }

  port(index, state, report, dt, last) {
    const port = this.ports[index];
    const v = report.volts[index], a = report.amps[index], ms = report.ms;
    const present = v >= NO_CELL;
    let session = port.session;
    if (session && !present) {
      this.end(index, "removed");
      session = null;
    }
    // A pack left in a port after the run was stopped charges again when it starts: a new charge.
    // A full one topping up while the run goes on is still the same charge.
    if (session?.end && !report.running) session.closed = true;
    if (session?.end && (session.end !== "full" || session.closed) && report.running && (state === "probe" || state === "charge")) {
      port.session = session = null;
      port.before = [];
    }
    if (!session) {
      port.before.push([ms, v, a]);
      while (port.before.length && port.before[0][0] < ms - LOOK_BACK_MS) port.before.shift();
      const charging = state === "probe" || state === "charge" || (state === "rest" && a > 0);
      if (present && charging) {
        // Joined part way when the first reading already has the current on and there was nothing before it.
        const partial = !last || (a > 0.5 * (this.setFor(index) || report.current) && port.before.length <= 1);
        session = port.session = {
          port: index + 1, began: this.now(), ms0: ms, msLast: ms, mah: 0, maxAmps: 0, amps: this.setFor(index) || report.current,
          target: report.target, startVolts: median(port.before.filter(([, , amps]) => amps === 0).map(([, volts]) => volts).concat(partial ? [] : [v])) || v,
          endVolts: v, resistance: null, end: null, partial, trace: [...port.before], kept: false,
          curve: [curvePoint(0, v, a)], curveMs: ms, lastAmps: a,
        };
        port.before = [];
        this.began(session);
      }
      return;
    }
    session.msLast = ms;
    session.endVolts = v;
    session.lastAmps = a;
    if (!session.end && ms - session.curveMs >= CURVE_MS) {
      session.curve.push(curvePoint(ms - session.ms0, v, a));
      session.curveMs = ms;
    }
    if (dt > 1000) {
      session.mah += (((a + (last?.amps?.[index] ?? a)) / 2) * dt) / 3600;
      session.unseen = (session.unseen ?? 0) + dt / 1000;
    } else session.mah += (a * dt) / 3600;
    session.maxAmps = Math.max(session.maxAmps, a);
    if (this.setFor(index)) session.amps = this.setFor(index);
    if (ms - session.ms0 <= TRACE_MS) session.trace.push([ms, v, a]);
    // Worked out twice a second, once the ramp could have run long enough, until the trace is full.
    if (!session.resistance && !session.partial && ms - session.ms0 >= FIT_MS && ms - session.ms0 <= TRACE_MS && ms >= (session.nextTry ?? 0)) {
      session.nextTry = ms + 500;
      const found = resistanceOf(session.trace);
      if (found) {
        session.resistance = found;
        this.measured(session);
      }
    }
    if (state === "full" && !session.end) this.end(index, "full", true);
    else if (state === "fault" && !session.end) this.end(index, "fault", true);
    else if (!report.running && state === "idle" && !session.end) this.end(index, "stopped", true);
  }

  /** The current a port is set to, from page 2, or 0 when it hasn't said. */
  setFor(index) {
    return this.p2?.setAmps?.[index] > 0 ? this.p2.setAmps[index] : 0;
  }

  /** Ends a port's session. A full pack stays in its port; its session is over but the port keeps it
   *  until the pack is pulled out, so a top-up doesn't start another. */
  end(index, why, staying = false) {
    const port = this.ports[index];
    const session = port.session;
    if (!session) return;
    if (!session.end) {
      // The last reading ends its curve.
      const at = session.msLast - session.ms0;
      if (session.curve?.length && at > (session.curve.at(-1)[0] * 1000)) session.curve.push(curvePoint(at, session.endVolts, session.lastAmps ?? 0));
      session.end = why;
      session.minutes = Math.round((session.msLast - session.ms0) / 600) / 100;
      this.ended(session);
    }
    if (!staying) port.session = null;
  }

  /** The charger went away: every session still open ends there. */
  lost() {
    this.ports.forEach((port, index) => {
      if (port.session && !port.session.end) this.end(index, "disconnected");
      port.session = null;
      port.before = [];
    });
    this.p1 = this.p2 = null;
  }
}

/** A point of a charge's curve, as kept: [seconds from its start, millivolts, milliamps]. A pack going
 *  down on the charger's load has its current below 0. */
export const curvePoint = (ms, volts, amps) => [Math.round(ms / 1000), Math.round(volts * 1000), Math.round(amps * 1000)];

/** One charge, as the library keeps it, from a session. Null when there's nothing worth keeping. */
export function keptCharge(session, { pack = null, firmware = null } = {}) {
  if (!session || (session.mah < 1 && !session.resistance)) return null;
  const began = session.began instanceof Date ? session.began : new Date(session.began);
  const t0 = session.trace[0]?.[0] ?? 0;
  return {
    id: `w${began.getTime().toString(36)}${session.port}${Math.floor(Math.random() * 1296).toString(36)}`,
    pack, at: began.toISOString(), kind: "charge", source: "whoopstor",
    port: session.port, target: session.target, amps: Math.round(session.amps * 1000) / 1000,
    mah: Math.round(session.mah * 10) / 10, minutes: session.minutes ?? null,
    startVolts: Math.round(session.startVolts * 1000) / 1000, endVolts: Math.round(session.endVolts * 1000) / 1000,
    resistance: session.resistance?.mohm ?? null, resistanceHow: session.resistance?.how ?? resistanceMethod, upTo: session.resistance?.upTo ?? null,
    end: session.end, partial: Boolean(session.partial), firmware,
    // Seconds the USB was out during the charge, when it was: what went in then is made up.
    ...(session.unseen ? { unseenSeconds: Math.round(session.unseen) } : {}),
    // The whole charge, a reading every 10 seconds, for its graph.
    ...(session.curve?.length > 1 ? { curve: session.curve } : {}),
    // The start of the charge, reading by reading, so the resistance can be worked out again later.
    trace: session.trace.map(([ms, v, a]) => [ms - t0, Math.round(v * 10000) / 10000, Math.round(a * 10000) / 10000]),
  };
}

/** What a charge's end means, in words. */
export const endWords = { full: "Full", fault: "Fault", removed: "Pulled out", stopped: "Stopped", disconnected: "Connection lost" };

/** A port's state, in words. */
export const stateWords = { idle: "Empty", probe: "Checking", charge: "Charging", rest: "Resting", full: "Full", bleed: "Down to storage", fault: "Fault" };

/** What a port is doing, in a word or two. "Full" means at the target, which on a storage target
 *  (3.80 V or 3.85 V) is a pack at storage, not a full one. */
export function portWords({ state, present, running, target, ended }) {
  if (!present) return "Empty";
  const atTarget = state === "full" || ended === "full";
  if (atTarget) return target === 3.8 || target === 3.85 ? "At storage" : "Full";
  if (state === "idle") return running ? "Waiting" : "Stopped";
  return stateWords[state] ?? state;
}

/** How a kept charge ended, in words: one that reached a storage target is at storage. */
export const endedWords = (test) => (test.end === "full" && (test.target === 3.8 || test.target === 3.85) ? "At storage" : endWords[test.end] ?? "");
