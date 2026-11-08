// A pretend WhoopStor V3, for trying the Batteries page and the app's checks without one: six ports,
// packs that charge like 1S LiHV cells, each port with a plug and lead of its own and a current
// reading a little off in its own way, and the charger sending the reports the real one sends
// (shared/whoopstor.js) every 10 ms of its own time. Its charging follows WS3 Unlocked's in outline:
// a check with the output off, a slow ramp up to the set current (a step of one count every half
// second, as the pilot's charger was seen to do), constant voltage at the target, and full once the
// current has tailed off. On a storage target, a pack above it is bled down on the port's 18 ohm
// load, which the port's current reading doesn't see, as on the real board (OpenWS3's HARDWARE.md).

import { voltsPerCount, ampsPerCount, targetVolts, portStates } from "./whoopstor.js";

// A 1S LiHV cell's voltage at rest, by how full it is.
const restCurve = [[0, 3.3], [0.05, 3.6], [0.15, 3.7], [0.4, 3.8], [0.5, 3.85], [0.65, 3.95], [0.85, 4.12], [1, 4.36]];
const restVolts = (soc) => {
  const s = Math.max(0, Math.min(1, soc));
  for (let i = 1; i < restCurve.length; i += 1) {
    const [s1, v1] = restCurve[i], [s0, v0] = restCurve[i - 1];
    if (s <= s1) return v0 + ((s - s0) / (s1 - s0)) * (v1 - v0);
  }
  return restCurve.at(-1)[1];
};

const RAMP_STEP_MS = 500, RAMP_MS = 30000, PROBE_MS = 20, REST_MS = 1000, TAIL_MS = 36000;
export const BLEED_OHMS = 18;
const TAIL_AMPS = 5 * ampsPerCount;

export class PretendWhoopStor {
  /** paths: each port's plug and lead, in ohms; gains: how far each port's current reading is off. */
  constructor({ paths = [0.012, 0.02, 0.035, 0.03, 0.055, 0.04], gains = [0, 0.02, -0.03, 0.01, 0.06, -0.02], input = 11.8 } = {}) {
    this.ms = 0;
    this.seq = 0;
    this.nextPage = 1;
    this.running = false;
    this.target = 1;
    this.setCount = 21;
    this.input = input;
    this.event = { seq: 0, code: 0, port: 0 };
    this.lastCommand = { seq: 0, result: 0 };
    this.ports = paths.map((path, index) => ({ path, gain: gains[index] ?? 0, value: 1, cell: null, state: "idle", amps: 0, since: 0, tail: 0, v1: 0, readV: 0, readA: 0 }));
  }

  /** Puts a pack in a port (1 to 6): { mah, soc (0 to 1), r0 and r1 in ohms, tau in seconds }. */
  insert(port, { mah = 300, soc = 0.5, r0 = 0.06, r1 = 0.03, tau = 2 } = {}) {
    Object.assign(this.ports[port - 1], { cell: { mah, soc, r0, r1, tau }, state: "idle", amps: 0, since: this.ms, tail: 0, v1: 0 });
  }

  remove(port) {
    Object.assign(this.ports[port - 1], { cell: null, state: "idle", amps: 0, v1: 0 });
  }

  start() {
    this.running = true;
  }

  /** Stops the run: every port goes idle, a full one too, and checks its pack again at the next start. */
  stop() {
    this.running = false;
    for (const port of this.ports) Object.assign(port, { state: "idle", amps: 0 });
  }

  /** Sets the charge current, in amps, to the nearest of the charger's steps (0.3 to 1.3 A). */
  setAmps(amps) {
    this.setCount = Math.max(21, Math.min(91, Math.round(amps / ampsPerCount / 7) * 7));
  }

  get setAmpsNow() {
    return this.setCount * ampsPerCount;
  }

  /** A port's own current in counts: its value when it has one of its own, else the charger's. */
  countFor(port) {
    return port.value > 1 ? port.value : this.setCount;
  }

  /** Takes a command report, as the charger does from USB (shared/whoopstor.js's commandBytes). A
   *  number already run is not run again. */
  command(bytes) {
    const [code, arg, seq, extra] = bytes;
    if (seq && seq === this.lastCommand.seq) return;
    let result = 0;
    if (code === 1) this.stop();
    else if (code === 2) {
      if (this.running) result = 1;
      else this.start();
    } else if (code === 4) {
      if (this.running || arg > 3) result = 1;
      else this.target = arg;
    } else if (code === 10) {
      const valid = extra === 0 || extra === 1 || (extra >= 21 && extra <= 91 && extra % 7 === 0);
      if (this.running || arg > 5 || !valid) result = 1;
      else this.ports[arg].value = extra;
    } else if (code !== 5) result = 2;
    this.lastCommand = { seq, result };
  }

  /** Moves its time on by `ms`, 10 ms at a time. */
  step(ms = 10) {
    for (let done = 0; done < ms; done += 10) {
      this.ms += 10;
      this.ports.forEach((port, index) => this.stepPort(port, index, 10));
    }
  }

  stepPort(port, index, dt) {
    const cell = port.cell, now = this.ms, set = this.countFor(port) * ampsPerCount, target = targetVolts[this.target];
    const go = (state) => Object.assign(port, { state, since: now, tail: 0 });
    if (!cell) {
      port.amps = 0;
      if (port.state !== "idle") go("idle");
    } else if (!this.running || port.value === 0) {
      port.amps = 0;
    } else if (port.state === "idle") {
      go("probe");
      port.amps = 0;
    } else if (port.state === "probe") {
      port.amps = 0;
      // On a storage target, a pack above it is bled down; one below it is charged up to it.
      if (now - port.since >= PROBE_MS) go(this.target >= 2 && restVolts(cell.soc) > target + 0.01 ? "bleed" : "charge");
    } else if (port.state === "bleed") {
      port.amps = -(restVolts(cell.soc) + port.v1) / BLEED_OHMS;
      if (restVolts(cell.soc) <= target) {
        go("full");
        this.event = { seq: (this.event.seq % 255) + 1, code: 1, port: index };
      }
    } else if (port.state === "charge") {
      // Up a count at a time to the set current, then held at the target voltage, as the port's output sees it.
      const ramp = Math.min(set, ampsPerCount * (2 + Math.floor((now - port.since) / RAMP_STEP_MS)));
      const atTarget = (target - restVolts(cell.soc) - port.v1) / (cell.r0 + port.path);
      port.amps = Math.max(0, Math.min(ramp, atTarget));
      if (port.amps <= TAIL_AMPS && now - port.since > RAMP_MS) port.tail += dt;
      else port.tail = 0;
      if (port.tail >= TAIL_MS) go("rest");
    } else if (port.state === "rest") {
      port.amps = 0;
      if (now - port.since >= REST_MS) {
        if (restVolts(cell.soc) + port.v1 >= target - 0.022) {
          go("full");
          this.event = { seq: (this.event.seq % 255) + 1, code: 1, port: index };
        } else go("charge");
      }
    } else port.amps = 0;
    if (cell) {
      cell.soc += (port.amps * dt) / 3600 / cell.mah;
      port.v1 += (dt / 1000 / cell.tau) * (port.amps * cell.r1 - port.v1);
    }
    const volts = cell ? restVolts(cell.soc) + port.amps * (cell.r0 + port.path) + port.v1 : 0;
    // The charger's readings are filtered a little, as the real one's are. Its current reading only
    // sees charging: the bleed's current returns through it the other way and reads as nothing.
    port.readV += 0.5 * (volts - port.readV);
    port.readA += 0.5 * (Math.max(0, port.amps) * (1 + port.gain) - port.readA);
  }

  /** The next report, as the charger would send it: page 1 and page 2 in turn. */
  report() {
    const r = new Uint8Array(64);
    this.seq = (this.seq % 255) + 1;
    const page = this.nextPage;
    this.nextPage = page === 1 ? 2 : 1;
    const u16 = (at, value) => { r[at] = (value >> 8) & 255; r[at + 1] = value & 255; };
    const u32 = (at, value) => { r[at] = (value >>> 24) & 255; r[at + 1] = (value >> 16) & 255; r[at + 2] = (value >> 8) & 255; r[at + 3] = value & 255; };
    r[0] = 0x57; r[1] = 0x33; r[2] = this.seq; r[3] = page; r[63] = this.seq;
    u32(4, this.ms);
    if (page === 1) {
      r[8] = (this.running ? 1 : 0) | (this.target << 1) | (this.running ? 8 : 0);
      r[9] = this.setCount;
      r[10] = 0x02;
      r[11] = this.running ? 0 : 4;
      r[13] = this.event.seq; r[14] = this.event.code; r[15] = this.event.port;
      r[16] = this.lastCommand.seq; r[17] = this.lastCommand.result;
      r[24] = this.ports.reduce((bits, port, index) => bits | (port.state === "bleed" ? 1 << index : 0), 0);
      this.ports.forEach((port, index) => {
        r[18 + index] = Math.max(0, portStates.indexOf(port.state));
        u16(38 + 2 * index, Math.max(0, Math.round(port.readV / voltsPerCount)));
        r[50 + index] = Math.max(0, Math.min(255, Math.round(port.readA / ampsPerCount)));
      });
      r[25] = 7;
      u16(58, Math.round((this.input * 610) / 4 - 1));
    } else {
      this.ports.forEach((port, index) => {
        r[30 + index] = ["probe", "charge", "rest"].includes(port.state) ? this.countFor(port) : 0;
        r[36 + index] = port.value;
      });
      u16(44, Math.round(targetVolts[this.target] / voltsPerCount));
      r[47] = 6;
      u32(57, 0xb6fa0077);
    }
    return r;
  }
}
