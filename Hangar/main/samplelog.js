// A made-up blackbox dump, written as Betaflight's encoder writes one, for the app's checks of
// itself and its tests: a whoop that never flew, with answers known in advance. The pack sags
// 0.5 V at full motor, the gyro follows the setpoint 3 ms late through a 15 ms lag, the motors
// hum at 100 + 300 × output Hz and the frame at 180 Hz, and the rates are Actual 70 and 670.
// Nothing in it is anyone's real flight.

const names = ["loopIteration", "time", "axisP[0]", "axisP[1]", "axisP[2]", "axisI[0]", "axisI[1]", "axisI[2]", "axisD[0]", "axisD[1]", "axisF[0]", "axisF[1]", "axisF[2]",
  "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]", "setpoint[0]", "setpoint[1]", "setpoint[2]", "setpoint[3]", "vbatLatest", "amperageLatest", "rssi",
  "gyroADC[0]", "gyroADC[1]", "gyroADC[2]", "accSmooth[0]", "accSmooth[1]", "accSmooth[2]",
  "motor[0]", "motor[1]", "motor[2]", "motor[3]", "gyroUnfilt[0]", "gyroUnfilt[1]", "gyroUnfilt[2]"];
const signed = names.map((n) => (/^(loopIteration|time|vbatLatest|motor|rcCommand\[3\]|setpoint\[3\]|rssi|amperageLatest)/.test(n) ? 0 : 1));
const predI = names.map((n) => (n === "rcCommand[3]" ? 4 : n === "vbatLatest" ? 9 : n === "motor[0]" ? 11 : /motor\[[123]\]/.test(n) ? 5 : 0));
const encI = names.map((_, i) => (signed[i] ? 0 : 1));
const predP = names.map((n) => (n === "loopIteration" ? 6 : n === "time" ? 2 : /gyro|motor/.test(n) ? 3 : 1));
const encP = names.map((n) => (n === "loopIteration" ? 9 : /rcCommand|setpoint/.test(n) ? 8 : /axisI/.test(n) ? 7 : 0));
const index = (name) => names.indexOf(name);

/** Bytes out, with the variable-byte and tagged encodings Betaflight writes. */
class Writer {
  constructor() { this.out = []; }
  byte(b) { this.out.push(b & 0xff); }
  text(s) { for (const c of s) this.out.push(c.charCodeAt(0) & 0xff); }
  uvb(v) {
    v >>>= 0;
    while (v > 127) { this.byte((v & 0x7f) | 0x80); v >>>= 7; }
    this.byte(v);
  }
  svb(v) { this.uvb(((v << 1) ^ (v >> 31)) >>> 0); }
  tag2_3s32(v) {
    const m = Math.max(...v.map((x) => (x < 0 ? -x - 1 : x)));
    if (m <= 1) return this.byte(((v[0] & 3) << 4) | ((v[1] & 3) << 2) | (v[2] & 3));
    if (m <= 7) { this.byte((1 << 6) | (v[0] & 0x0f)); return this.byte(((v[1] & 0x0f) << 4) | (v[2] & 0x0f)); }
    if (m <= 31) { this.byte((2 << 6) | (v[0] & 0x3f)); this.byte(v[1] & 0x3f); return this.byte(v[2] & 0x3f); }
    let sizes = 0;
    for (let x = 2; x >= 0; x -= 1) {
      sizes <<= 2;
      const a = v[x];
      sizes |= a < 128 && a >= -128 ? 0 : a < 32768 && a >= -32768 ? 1 : a < 8388608 && a >= -8388608 ? 2 : 3;
    }
    this.byte((3 << 6) | sizes);
    for (let x = 0; x < 3; x += 1, sizes >>= 2) for (let k = 0; k < (sizes & 3) + 1; k += 1) this.byte(v[x] >> (8 * k));
  }
  tag8_4s16(v) {
    let sel = 0;
    for (let x = 3; x >= 0; x -= 1) {
      sel <<= 2;
      const a = v[x];
      sel |= a === 0 ? 0 : a < 8 && a >= -8 ? 1 : a < 128 && a >= -128 ? 2 : 3;
    }
    this.byte(sel);
    let nibble = 0, held = 0;
    for (let x = 0; x < 4; x += 1, sel >>= 2) {
      switch (sel & 3) {
        case 0: break;
        case 1: if (nibble === 0) { held = (v[x] << 4) & 0xff; nibble = 1; } else { this.byte(held | (v[x] & 0x0f)); nibble = 0; } break;
        case 2: if (nibble === 0) this.byte(v[x]); else { this.byte(held | ((v[x] >> 4) & 0x0f)); held = (v[x] << 4) & 0xff; } break;
        case 3: if (nibble === 0) { this.byte(v[x] >> 8); this.byte(v[x]); } else { this.byte(held | ((v[x] >> 12) & 0x0f)); this.byte(v[x] >> 4); held = (v[x] << 4) & 0xff; } break;
      }
    }
    if (nibble === 1) this.byte(held);
  }
}

function header(vbat, { craft, uid }) {
  return [
    "H Product:Blackbox flight data recorder by Nicholas Sherlock", "H Data version:2", "H I interval:32", "H P interval:1",
    "H Firmware type:Cleanflight", "H Firmware revision:Betaflight 4.5.1 (00000000) STM32F411", "H Board information:MADE MADEUPF411",
    `H DeviceUID:${uid}`, `H Craft name:${craft}`,
    `H Field I name:${names.join(",")}`, `H Field I signed:${signed.join(",")}`, `H Field I predictor:${predI.join(",")}`,
    `H Field I encoding:${encI.join(",")}`, `H Field P predictor:${predP.join(",")}`, `H Field P encoding:${encP.join(",")}`,
    "H Field S name:flightModeFlags,stateFlags,failsafePhase,rxSignalReceived,rxFlightChannelsValid", "H Field S signed:0,0,0,0,0",
    "H Field S predictor:0,0,0,0,0", "H Field S encoding:1,1,7,9,9", "H minthrottle:1070", "H motorOutput:48,2047", `H vbatref:${vbat}`,
    "H looptime:500", "H rates_type:3", "H rc_rates:7,7,7", "H rc_expo:0,0,0", "H rates:67,67,67", "H rate_limits:1998,1998,1998",
    "H rollPID:45,80,30", "H pitchPID:47,84,34", "H yawPID:45,80,0", "H acc_1G:2048", "H motor_poles:12", "H debug_mode:0",
    "H simplified_dterm_filter_multiplier:100", "",
  ].join("\n");
}

/**
 * A dump of `arms`, each `{ seconds, powerUp }` (arms with the same powerUp share one, its clock
 * running on; a new powerUp starts the clock again on a full pack). `rate` is frames a second.
 * `craft` and `uid` name the made-up whoop. Gives the dump's bytes.
 */
export function sampleDump({ arms = [{ seconds: 20, powerUp: 0 }], rate = 1000, craft = "Test Whoop", uid = "MADEUP000000000000000001", seed = 11 } = {}) {
  const w = new Writer();
  let next = seed;
  const rnd = () => { next = (next * 1103515245 + 12345) & 0x7fffffff; return next / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  let clock = 0, pack = 4.2, lastPowerUp = null;
  for (const arm of arms) {
    if (arm.powerUp !== lastPowerUp) {
      clock = 5;
      pack = 4.2;
      lastPowerUp = arm.powerUp;
    }
    const N = Math.round(arm.seconds * rate);
    w.text(header(Math.round(pack * 100), { craft, uid }));
    // The throttle: cruising, punches and chops, and the sticks moving each axis about.
    const thr = new Float64Array(N);
    for (let v = 0.4, i = 0; i < N;) {
      const len = Math.round((0.3 + rnd() * 1.2) * rate), kind = rnd();
      const target = kind < 0.15 ? 1 : kind < 0.3 ? 0.02 : 0.3 + rnd() * 0.35;
      for (let j = 0; j < len && i < N; j += 1, i += 1) { v += (target - v) * 0.02; thr[i] = v; }
    }
    const spv = [0, 1, 2].map(() => new Float64Array(N));
    for (const a of [0, 1, 2]) {
      for (let v = 0, i = 0; i < N;) {
        const len = Math.round((0.15 + rnd() * 0.5) * rate);
        const target = rnd() < 0.4 ? 0 : (rnd() - 0.5) * 2 * (a === 2 ? 300 : 600);
        for (let j = 0; j < len && i < N; j += 1, i += 1) { v += (target - v) * 0.05; spv[a][i] = v; }
      }
    }
    const delay = Math.round(0.003 * rate), alpha = 1 - Math.exp(-1 / (0.015 * rate));
    const gy = [0, 1, 2].map(() => new Float64Array(N)), un = [0, 1, 2].map(() => new Float64Array(N));
    const mavg = Float64Array.from(thr, (v) => Math.min(1, 0.08 + 0.92 * v));
    for (const a of [0, 1, 2]) {
      let y = 0;
      for (let i = 0; i < N; i += 1) { y += ((i >= delay ? spv[a][i - delay] : 0) - y) * alpha; gy[a][i] = y; }
    }
    let phase = 0;
    for (let i = 0; i < N; i += 1) {
      phase += 2 * Math.PI * (100 + 300 * mavg[i]) / rate;
      for (const a of [0, 1, 2]) {
        const noise = 3 * Math.sin(phase + a) + 1.2 * Math.sin(2 * Math.PI * 180 * i / rate + a) + 0.5 * gauss();
        un[a][i] = gy[a][i] + noise;
        gy[a][i] += noise * 0.15;
      }
    }
    let prev = null, prev2 = null;
    const start = clock;
    for (let k = 0; k < N; k += 1) {
      const m = mavg[k];
      const drain = 0.6 * (k / N) * (arm.seconds / 60);
      const vb = Math.round(100 * (pack - drain - 0.5 * m));
      const mot = [0, 1, 2, 3].map((q) => Math.round(48 + 1999 * Math.min(1, Math.max(0, m + 0.03 * gauss() + (q === 2 ? 0.02 : 0)))));
      const row = names.map((n) => {
        if (n === "loopIteration") return k;
        if (n === "time") return Math.round((start + k / rate) * 1e6);
        let found = n.match(/^setpoint\[(\d)\]/);
        if (found) return found[1] === "3" ? Math.round(thr[k] * 1000) : Math.round(spv[Number(found[1])][k]);
        found = n.match(/^rcCommand\[(\d)\]/);
        if (found) return found[1] === "3" ? Math.round(1000 + thr[k] * 1000) : Math.round(spv[Number(found[1])][k] / 670 * 500);
        found = n.match(/^gyroADC\[(\d)\]/);
        if (found) return Math.round(gy[Number(found[1])][k]);
        found = n.match(/^gyroUnfilt\[(\d)\]/);
        if (found) return Math.round(un[Number(found[1])][k]);
        found = n.match(/^motor\[(\d)\]/);
        if (found) return mot[Number(found[1])];
        if (n === "vbatLatest") return k % 20 === 0 || !prev ? vb : prev[index("vbatLatest")];
        if (n === "amperageLatest") return Math.round(100 * (0.5 + 9 * m));
        if (n === "accSmooth[2]") return 2048;
        if (n === "rssi") return 1023;
        found = n.match(/^axisD\[(\d)\]/);
        if (found) return Math.round((un[Number(found[1])][k] - (k ? un[Number(found[1])][k - 1] : 0)) * 2);
        return 0;
      });
      const isI = k % 32 === 0, enc = isI ? encI : encP, pr = isI ? predI : predP;
      const resid = row.map((v, i) => {
        let p = 0;
        switch (pr[i]) {
          case 1: p = prev[i]; break;
          case 2: p = 2 * prev[i] - prev2[i]; break;
          case 3: p = signed[i] ? Math.trunc((prev[i] + prev2[i]) / 2) : Math.floor((prev[i] + prev2[i]) / 2); break;
          case 4: p = 1070; break;
          case 5: p = row[index("motor[0]")]; break;
          case 9: p = Math.round(pack * 100); break;
          case 11: p = 48; break;
        }
        return v - p;
      });
      w.byte(isI ? 0x49 : 0x50);
      for (let i = 0; i < names.length;) {
        if (pr[i] === 6) { i += 1; continue; }
        const e = enc[i];
        if (e === 0) { w.svb(resid[i]); i += 1; }
        else if (e === 1) { w.uvb(resid[i]); i += 1; }
        else if (e === 9) i += 1;
        else if (e === 7) { w.tag2_3s32(resid.slice(i, i + 3)); i += 3; }
        else if (e === 8) { w.tag8_4s16(resid.slice(i, i + 4)); i += 4; }
      }
      if (isI) { prev = row; prev2 = row; } else { prev2 = prev; prev = row; }
      if (k % 500 === 3) { w.byte(0x53); w.uvb(1); w.uvb(0); w.tag2_3s32([0, 1, 0]); }
    }
    // Disarmed by the switch, then the end of this arm's log.
    w.byte(0x45); w.byte(15); w.uvb(4);
    w.byte(0x45); w.byte(255); w.text("End of log\0");
    clock = start + arm.seconds + 2;
    pack -= 0.6 * (arm.seconds / 60) + 0.05;
  }
  return new Uint8Array(w.out);
}
