// One flight from a blackbox log, worked out: how long it flew, the throttle, the motors, the pack's
// sag, the noise and the tune, the rates used and anything alarming; and in a few plain words what
// it says. A dump holds every arm since it was last erased, often across several power-ups (packs),
// so it is split here into power-ups too. Nothing here touches a page or a file, so it can be
// tested by itself.

import { readLogs } from "./blackbox.js";
import { rateAt, centerOf } from "./rates.js";

// ---- Small maths

const finite = (a) => Array.from(a).filter(Number.isFinite);
const sorted = (a) => finite(a).sort((x, y) => x - y);
export function median(a) {
  const s = sorted(a);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(a, p) {
  const s = sorted(a);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}
function mean(a) {
  let sum = 0, n = 0;
  for (const v of a) if (Number.isFinite(v)) { sum += v; n += 1; }
  return n ? sum / n : NaN;
}
function rms(a) {
  let sum = 0, n = 0;
  for (const v of a) if (Number.isFinite(v)) { sum += v * v; n += 1; }
  return n ? Math.sqrt(sum / n) : NaN;
}
/** A number rounded to `d` places, or null when it isn't one, so it keeps in JSON. */
const r = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const maxOf = (a) => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
const minOf = (a) => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };

function movAvg(x, w) {
  w = Math.max(1, Math.round(w));
  const n = x.length, out = new Float64Array(n);
  const h = w >> 1;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) pre[i + 1] = pre[i] + x[i];
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - h), b = Math.min(n, i - h + w);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j += 1) {
        const a = i + j, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const nextPow2 = (x) => 2 ** Math.round(Math.log2(x));
const hann = (N) => Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));

/** Welch's power spectrum over the segments starting at `segs`, each N long: units² per Hz. */
function welch(x, fs, segs, N) {
  const w = hann(N);
  let wss = 0;
  for (const v of w) wss += v * v;
  const psd = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N), im = new Float64Array(N);
  let k = 0;
  for (const s of segs) {
    let m = 0;
    for (let i = 0; i < N; i += 1) m += x[s + i];
    m /= N;
    for (let i = 0; i < N; i += 1) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i <= N / 2; i += 1) psd[i] += (re[i] * re[i] + im[i] * im[i]) * (i === 0 || i === N / 2 ? 1 : 2) / (fs * wss);
    k += 1;
  }
  if (k) for (let i = 0; i < psd.length; i += 1) psd[i] /= k;
  const f = Float64Array.from({ length: N / 2 + 1 }, (_, i) => i * fs / N);
  return { f, psd, n: k };
}
function bandRms(sp, lo, hi) {
  let s = 0;
  const df = sp.f[1];
  for (let i = 0; i < sp.f.length; i += 1) if (sp.f[i] >= lo && sp.f[i] < hi) s += sp.psd[i] * df;
  return Math.sqrt(s);
}
/** The strongest lines in a spectrum, each well above the floor round it. */
function peaks(sp, lo, hi, count = 3) {
  const { f, psd } = sp;
  const idx = [];
  for (let i = 2; i < f.length - 2; i += 1) {
    if (f[i] >= lo && f[i] <= hi && psd[i] >= psd[i - 1] && psd[i] >= psd[i + 1] && psd[i] >= psd[i - 2] && psd[i] >= psd[i + 2]) idx.push(i);
  }
  const band = [];
  for (let i = 0; i < f.length; i += 1) if (f[i] >= lo && f[i] <= hi) band.push(psd[i]);
  const floor = median(band);
  return idx.map((i) => ({ hz: r(f[i]), amp: Math.sqrt(psd[i] * f[1]), x: psd[i] / floor }))
    .filter((p) => p.x > 4).sort((a, b) => b.amp - a.amp).slice(0, count)
    .map((p) => ({ hz: p.hz, dps: r(p.amp, 2), overFloor: r(p.x, 1) }));
}

/** A spectrum for drawing: its amplitude in each band of `bins`, the largest in each, from 0 Hz to Nyquist. */
function spectrumLine(sp, bins = 160) {
  const n = sp.psd.length, per = Math.max(1, Math.ceil(n / bins)), out = [];
  for (let i = 0; i < n; i += per) {
    let m = 0;
    for (let j = i; j < Math.min(n, i + per); j += 1) m = Math.max(m, Math.sqrt(sp.psd[j] * sp.f[1]));
    out.push(r(m, 3));
  }
  return { hzStep: r(sp.f[1] * per, 3), values: out };
}

// ---- Rates, as Betaflight lists their types

export const rateTypes = ["BETAFLIGHT", "RACEFLIGHT", "KISS", "ACTUAL", "QUICK"];
/** The rate type and each axis's setting, from a log's header. */
export function ratesOf(h) {
  const type = rateTypes[Number(h.rates_type)] || (rateTypes.includes(h.rates_type) ? h.rates_type : "BETAFLIGHT");
  const tri = (k) => (h[k] || "").split(",").map(Number);
  const rc = tri("rc_rates"), expo = tri("rc_expo"), srate = tri("rates"), limit = tri("rate_limits");
  const axes = {};
  ["roll", "pitch", "yaw"].forEach((name, a) => {
    axes[name] = { rc: rc[a], srate: srate[a], expo: expo[a], limit: Number.isFinite(limit[a]) && limit[a] > 0 ? limit[a] : 1998 };
  });
  return { type, axes };
}

/** Why Betaflight disarmed, by the number it logs. */
export const disarmReasons = {
  0: "arming disabled", 1: "failsafe", 2: "throttle timeout", 3: "sticks", 4: "switch", 5: "crash protection", 6: "runaway takeoff",
  7: "GPS rescue", 8: "serial command", 9: "landing", 10: "crash flip (turtle) done", 11: "launch abort",
};

// ---- One armed log

/**
 * Everything worked out from one arm's log. Fewer than 200 frames is too short to say anything
 * and says so. The numbers are those of the race-night analysis this came from, checked against
 * Betaflight's own decoder on the pilot's logs; `series` and `charts` are what the flight's page
 * draws.
 */
export function analyseLog(L) {
  const h = L.hdr, n = L.frames;
  const res = { log: L.index, frames: n, corrupt: L.corrupt, ended: L.ended };
  if (n < 200) {
    res.tooShort = true;
    return res;
  }
  const t = Float64Array.from(L.times, (v) => (v - L.times[0]) / 1e6);
  const dts = [];
  for (let i = 1; i < n; i += Math.max(1, (n / 5000) | 0)) dts.push(t[i] - t[i - 1]);
  const dt = median(dts), fs = 1 / dt;
  res.seconds = r(t[n - 1], 1);
  res.logHz = r(fs);
  const get = (name) => L.col(name);
  const hi = Number(h.blackbox_high_resolution) === 1 ? 10 : 1;
  const scale = (a, s) => { if (a && s !== 1) for (let i = 0; i < a.length; i += 1) a[i] /= s; return a; };
  const gyro = [0, 1, 2].map((a) => scale(get(`gyroADC[${a}]`), hi));
  let unf = [0, 1, 2].map((a) => scale(get(`gyroUnfilt[${a}]`), hi));
  let unfSource = "gyroUnfilt";
  if (!unf[0]) {
    if (Number(h.debug_mode) === 6 && L.has("debug[0]")) {
      unf = [0, 1, 2].map((a) => get(`debug[${a}]`));
      unfSource = "debug GYRO_SCALED";
    } else {
      unf = null;
      unfSource = "none";
    }
  }
  const sp = [0, 1, 2].map((a) => scale(get(`setpoint[${a}]`), hi));
  const rc = [0, 1, 2, 3].map((a) => get(`rcCommand[${a}]`));
  const nMot = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => L.has(`motor[${k}]`)).length;
  if (!gyro[0] || !sp[0] || !rc[0] || nMot === 0) {
    res.missing = true;
    return res;
  }
  const mo = (h.motorOutput || "0,2047").split(",").map(Number);
  const lo = mo[0], top = mo[1];
  const mot = Array.from({ length: nMot }, (_, k) => Float64Array.from(get(`motor[${k}]`), (v) => (v - lo) / (top - lo)));
  const mAvg = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (const m of mot) s += m[i];
    mAvg[i] = s / nMot;
  }
  const sp3 = get("setpoint[3]");
  const thr = sp3 ? Float64Array.from(sp3, (v) => v / 10) : Float64Array.from(rc[3], (v) => (v - 1000) / 10);

  // Flying: the motors above idle, near enough.
  const flyMask = new Uint8Array(n);
  const mS = movAvg(mAvg, 0.2 * fs);
  for (let i = 0; i < n; i += 1) flyMask[i] = mS[i] > 0.12 ? 1 : 0;
  let flyN = 0;
  for (const v of flyMask) flyN += v;
  res.flyingSeconds = r(flyN * dt, 1);
  const flyVals = (a) => {
    const o = [];
    for (let i = 0; i < n; i += 1) if (flyMask[i]) o.push(a[i]);
    return o;
  };

  // Throttle
  const thF = flyVals(thr);
  const share = (arr, f) => r(100 * arr.filter(f).length / Math.max(1, arr.length));
  res.throttle = {
    p10: r(pct(thF, 10)), p50: r(pct(thF, 50)), p90: r(pct(thF, 90)), full: share(thF, (v) => v >= 95), low: share(thF, (v) => v <= 20),
    bands: [share(thF, (v) => v < 25), share(thF, (v) => v >= 25 && v < 50), share(thF, (v) => v >= 50 && v < 75), share(thF, (v) => v >= 75)],
  };

  // Motors
  const sat = 0.995;
  let anySat = 0;
  const perSat = new Array(nMot).fill(0), perMean = [];
  for (let i = 0; i < n; i += 1) {
    if (!flyMask[i]) continue;
    let any = false;
    for (let k = 0; k < nMot; k += 1) if (mot[k][i] >= sat) { perSat[k] += 1; any = true; }
    if (any) anySat += 1;
  }
  for (let k = 0; k < nMot; k += 1) perMean.push(mean(flyVals(mot[k])));
  const allMean = mean(perMean);
  res.motors = {
    count: nMot, output: `${lo}..${top}`,
    saturatedPct: r(100 * anySat / Math.max(1, flyN), 1), perMotorSaturatedPct: perSat.map((v) => r(100 * v / Math.max(1, flyN), 1)),
    meanPct: perMean.map((v) => r(100 * v, 1)), imbalancePct: perMean.map((v) => r(100 * (v / allMean - 1), 1)),
    p50: r(100 * median(flyVals(mAvg))), p95: r(100 * pct(flyVals(mAvg), 95)),
  };

  // The pack
  const vRaw = get("vbatLatest");
  let Vs = null;
  if (vRaw) {
    const vs = median(vRaw) > 100 ? 100 : 10;
    const V = Float64Array.from(vRaw, (v) => v / vs);
    Vs = movAvg(V, 0.1 * fs);
    const ms = movAvg(mAvg, 0.1 * fs);
    let vmin = Infinity, imin = 0;
    for (let i = Math.round(0.5 * fs); i < n; i += 1) if (flyMask[i] && Vs[i] < vmin) { vmin = Vs[i]; imin = i; }
    const endN = Math.round(0.5 * fs);
    const vEnd = mean(V.subarray(n - endN));
    const firstFly = flyMask.indexOf(1);
    const vStartLoad = firstFly >= 0 ? mean(V.subarray(firstFly, Math.min(n, firstFly + Math.round(fs)))) : NaN;
    // Sag: voltage against motor output in 2 s windows where the motors moved enough.
    const W = Math.round(2 * fs), step = Math.round(fs), slopes = [];
    for (let s0 = 0; s0 + W <= n; s0 += step) {
      let fly = 0;
      for (let i = s0; i < s0 + W; i += 1) fly += flyMask[i];
      if (fly < 0.8 * W) continue;
      let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
      for (let i = s0; i < s0 + W; i += 4) { const x = ms[i], y = Vs[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; c += 1; }
      const vx = sxx / c - (sx / c) ** 2;
      if (Math.sqrt(vx) < 0.08) continue;
      slopes.push((sxy / c - (sx / c) * (sy / c)) / vx);
    }
    // Punch-outs: the motors from under 35% to over 80% within a quarter of a second.
    const punches = [];
    let last = -1e9;
    for (let i = Math.round(0.3 * fs); i < n - Math.round(0.3 * fs); i += 1) {
      if (ms[i] > 0.8 && i - last > fs) {
        const back = Math.round(0.25 * fs);
        let lowAt = -1;
        for (let j = i - back; j < i; j += 1) if (ms[j] < 0.35) lowAt = j;
        if (lowAt < 0) continue;
        const before = mean(V.subarray(Math.max(0, lowAt - Math.round(0.2 * fs)), lowAt));
        let mn = Infinity;
        for (let j = i; j < Math.min(n, i + Math.round(0.3 * fs)); j += 1) mn = Math.min(mn, Vs[j]);
        punches.push({ t: r(t[i], 1), sag: before - mn });
        last = i;
      }
    }
    // A current sensor, when the whoop has one (in hundredths of an amp).
    const amp = get("amperageLatest");
    let ohm = null, ampMax = null, mah = null;
    if (amp && pct(amp, 99) > 50) {
      const A = movAvg(Float64Array.from(amp, (v) => v / 100), 0.1 * fs);
      let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
      for (let i = 0; i < n; i += 4) if (flyMask[i]) { sx += A[i]; sy += Vs[i]; sxx += A[i] ** 2; sxy += A[i] * Vs[i]; c += 1; }
      ohm = -((sxy / c - sx / c * sy / c) / (sxx / c - (sx / c) ** 2));
      ampMax = pct(A, 99.5);
      mah = 0;
      for (let i = 1; i < n; i += 1) mah += (amp[i] / 100) * (t[i] - t[i - 1]) / 3.6;
    }
    res.battery = {
      cells: Math.max(1, Math.ceil(Number(h.vbatref || 0) / vs / 4.4)),
      beforeArm: r(Number(h.vbatref) / vs, 2), firstSecondUnderLoad: r(vStartLoad, 2),
      minUnderLoad: Number.isFinite(vmin) ? r(vmin, 2) : null, minAt: r(t[imin], 1), minAtMotorPct: r(100 * ms[imin]), atDisarm: r(vEnd, 2),
      sagFullMotorV: slopes.length ? r(-median(slopes), 2) : null, sagWindows: slopes.length,
      punchSagV: punches.length ? r(median(punches.map((p) => p.sag)), 2) : null, punches: punches.length,
      punchSagMaxV: punches.length ? r(Math.max(...punches.map((p) => p.sag)), 2) : null,
      currentSensor: ohm != null, resistanceMilliOhm: ohm != null ? r(ohm * 1000) : null, ampsP99: ampMax != null ? r(ampMax, 1) : null,
      mah: mah != null ? r(mah) : null,
    };
  }

  // What the flight's page draws over time: a quarter of a second at a time.
  {
    const per = Math.max(1, Math.round(0.25 * fs));
    const throttle = [], motor = [], volts = [];
    for (let i = 0; i < n; i += per) {
      const end = Math.min(n, i + per);
      throttle.push(r(mean(thr.subarray(i, end))));
      motor.push(r(100 * mean(mAvg.subarray(i, end))));
      volts.push(Vs ? r(mean(Vs.subarray(i, end)), 2) : null);
    }
    res.series = { step: r(per / fs, 3), throttle, motor, volts: Vs ? volts : null };
  }

  // Spectra
  const N = Math.min(nextPow2(fs / 4), 1024 * 4), hop = N >> 1;
  const segsAll = [], segM = [];
  for (let s0 = 0; s0 + N <= n; s0 += hop) {
    let f = 0;
    for (let i = s0; i < s0 + N; i += 1) f += flyMask[i];
    if (f === N) {
      segsAll.push(s0);
      segM.push(mean(mAvg.subarray(s0, s0 + N)));
    }
  }
  res.spectrum = { window: N, segments: segsAll.length, unfilteredFrom: unfSource };
  res.charts = {};
  const nyq = fs / 2;
  const bandsOfMotor = [[0.12, 0.3], [0.3, 0.45], [0.45, 0.6], [0.6, 1.01]];
  if (segsAll.length >= 2) {
    const both = (arrs) => {
      const a = welch(arrs[0], fs, segsAll, N), b = welch(arrs[1], fs, segsAll, N);
      return { f: a.f, psd: a.psd.map((v, i) => (v + b.psd[i]) / 2), n: a.n };
    };
    const gF = both(gyro);
    res.spectrum.filtered = { rp_rms_80up: r(bandRms(gF, 80, nyq), 2), rp_rms_20_80: r(bandRms(gF, 20, 80), 2), peaks: peaks(gF, 40, nyq * 0.98) };
    res.spectrum.filtered.yaw_rms_80up = r(bandRms(welch(gyro[2], fs, segsAll, N), 80, nyq), 2);
    res.charts.spectrum = { nyquist: r(nyq), filtered: spectrumLine(gF) };
    if (unf) {
      const gU = both(unf);
      res.spectrum.unfiltered = { rp_rms_80up: r(bandRms(gU, 80, nyq), 2), peaks: peaks(gU, 40, nyq * 0.98, 4) };
      res.charts.spectrum.unfiltered = spectrumLine(gU);
      // The strongest line at each level of motor output, to tell a motor's line (which moves with
      // the motors) from the frame's (which stays put).
      res.spectrum.byMotor = bandsOfMotor.map(([a, b]) => {
        const segs = segsAll.filter((_, i) => segM[i] >= a && segM[i] < b);
        const band = `${(a * 100) | 0}-${Math.min(100, (b * 100) | 0)}%`;
        if (segs.length < 2) return { band, segments: segs.length };
        const s1 = welch(unf[0], fs, segs, N), s2 = welch(unf[1], fs, segs, N);
        const pk = peaks({ f: s1.f, psd: s1.psd.map((v, i) => (v + s2.psd[i]) / 2) }, 60, nyq * 0.98, 1)[0] || null;
        return { band, segments: segs.length, peakHz: pk?.hz ?? null, peakDps: pk?.dps ?? null };
      });
    }
    // The D term
    const dT = [0, 1].map((a) => get(`axisD[${a}]`));
    if (dT[0] && dT[1]) {
      const dS = both(dT);
      res.dterm = { rms_total: r(Math.sqrt(dS.psd.reduce((s, v) => s + v * dS.f[1], 0)), 1), rms_100up: r(bandRms(dS, 100, nyq), 1), peaks: peaks(dS, 40, nyq * 0.98, 2) };
      res.dterm.hfShare = r(100 * res.dterm.rms_100up / Math.max(1e-9, res.dterm.rms_total));
    }
    // How much the motors jitter above 100 Hz, as a share of their range.
    res.motors.hfNoisePct = mot.map((m) => r(bandRms(welch(Float64Array.from(m, (v) => v * 100), fs, segsAll, N), 100, nyq), 2));
    // Motor speed, from bidirectional DShot
    if (L.has("eRPM[0]")) {
      const poles = Number(h.motor_poles || 14);
      const hz = Array.from({ length: nMot }, (_, k) => Float64Array.from(get(`eRPM[${k}]`), (v) => v * 100 / (poles / 2) / 60));
      const avgHz = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        let s = 0;
        for (const a of hz) s += a[i];
        avgHz[i] = s / nMot;
      }
      res.erpm = { motorHzP50: r(median(flyVals(avgHz))), motorHzP95: r(pct(flyVals(avgHz), 95)), maxRpm: r(Math.max(...hz.map((a) => pct(flyVals(a), 99.5))) * 60) };
      if (res.spectrum.byMotor) {
        res.spectrum.byMotor.forEach((band, j) => {
          const [a, c] = bandsOfMotor[j];
          const segs = segsAll.filter((_, i) => segM[i] >= a && segM[i] < c);
          if (segs.length) band.motorHz = r(mean(segs.map((s) => mean(avgHz.subarray(s, s + N)))));
        });
      }
      // A motor whose speed collapses while it is told to spin hard: a prop strike or a desync.
      const lag = Math.round(0.01 * fs);
      let count = 0, lastD = -1e9;
      const at = [];
      for (let i = lag; i < n; i += 1) {
        for (let k = 0; k < nMot; k += 1) {
          if (mot[k][i] > 0.5 && hz[k][i - lag] > 100 && hz[k][i] < 0.4 * hz[k][i - lag] && i - lastD > fs) {
            count += 1;
            at.push(r(t[i], 1));
            lastD = i;
          }
        }
      }
      res.erpm.desyncLike = count;
      res.erpm.desyncAt = at.slice(0, 5);
    }
  }

  // One motor held at full while the others are well below: a desync, or a bad motor or prop.
  {
    let count = 0, run = 0, lastE = -1e9;
    const at = [];
    for (let i = 0; i < n; i += 1) {
      let pinned = -1, others = 0;
      for (let k = 0; k < nMot; k += 1) {
        if (mot[k][i] >= sat) pinned = pinned === -1 ? k : -2;
        else others = Math.max(others, mot[k][i]);
      }
      if (pinned >= 0 && others < 0.6 && flyMask[i]) run += 1;
      else {
        if (run > 0.03 * fs && i - lastE > fs) {
          count += 1;
          at.push(r(t[i], 1));
          lastE = i;
        }
        run = 0;
      }
    }
    res.motors.singlePinnedEvents = count;
    res.motors.singlePinnedAt = at.slice(0, 5);
  }

  // How well the gyro follows the sticks, and propwash after throttle chops
  const err = [0, 1].map((a) => Float64Array.from(gyro[a], (g, i) => g - sp[a][i]));
  res.tracking = {
    rollErrRms: r(rms(flyVals(err[0])), 1), pitchErrRms: r(rms(flyVals(err[1])), 1),
    rollSpRms: r(rms(flyVals(sp[0])), 1), pitchSpRms: r(rms(flyVals(sp[1])), 1),
    // A whoop flown round one way most of a lap leans on one diagonal of motors: not a fault.
    yawSpMean: r(mean(flyVals(sp[2])), 1),
  };
  {
    const thS = movAvg(thr, 0.03 * fs);
    const chops = [];
    let lastC = -1e9;
    const hp = err.map((e) => { const m = movAvg(e, 0.03 * fs); return Float64Array.from(e, (v, i) => v - m[i]); });
    for (let i = Math.round(0.2 * fs); i < n - Math.round(0.6 * fs); i += 1) {
      if (thS[i] <= 25 && thS[i - Math.round(0.2 * fs)] >= 50 && i - lastC > fs && flyMask[i]) {
        const a = i + Math.round(0.05 * fs), b = i + Math.round(0.5 * fs);
        const v = Math.max(rms(hp[0].subarray(a, b)), rms(hp[1].subarray(a, b)));
        const ax = rms(hp[0].subarray(a, b)) > rms(hp[1].subarray(a, b)) ? 0 : 1;
        let zc = 0;
        for (let j = a + 1; j < b; j += 1) if ((hp[ax][j] > 0) !== (hp[ax][j - 1] > 0)) zc += 1;
        chops.push({ t: r(t[i], 1), dps: v, hz: zc / 2 / ((b - a) / fs) });
        lastC = i;
      }
    }
    const ref = [];
    for (let s0 = 0; s0 + Math.round(0.45 * fs) < n; s0 += Math.round(0.45 * fs)) {
      const e0 = s0 + Math.round(0.45 * fs);
      let ok = true;
      for (let i = s0; i < e0; i += 8) if (!flyMask[i] || thS[i] < 30 || thS[i] > 70) { ok = false; break; }
      if (ok) ref.push(Math.max(rms(hp[0].subarray(s0, e0)), rms(hp[1].subarray(s0, e0))));
    }
    res.propwash = {
      chops: chops.length, medianDps: chops.length ? r(median(chops.map((c) => c.dps)), 1) : null,
      worstDps: chops.length ? r(Math.max(...chops.map((c) => c.dps)), 1) : null, hz: chops.length ? r(median(chops.map((c) => c.hz))) : null,
      steadyDps: ref.length ? r(median(ref), 1) : null,
    };
  }

  // Step response, setpoint to gyro by deconvolution, for each axis
  {
    const M = nextPow2(fs * 1.5), hopS = M >> 2, L5 = Math.round(0.5 * fs), w = hann(M);
    res.step = {};
    res.charts.step = { ms: r(1000 / fs, 3) };
    const shown = Math.round(0.25 * fs);
    for (const a of [0, 1, 2]) {
      const axis = ["roll", "pitch", "yaw"][a];
      const acc = new Float64Array(L5);
      let k = 0;
      for (let s0 = 0; s0 + M <= n; s0 += hopS) {
        let f = 0, mx = 0;
        for (let i = s0; i < s0 + M; i += 1) { f += flyMask[i]; mx = Math.max(mx, Math.abs(sp[a][i])); }
        if (f < 0.9 * M || mx < 60 || mx > 1900) continue;
        const xr = new Float64Array(M), xi = new Float64Array(M), yr = new Float64Array(M), yi = new Float64Array(M);
        for (let i = 0; i < M; i += 1) { xr[i] = sp[a][s0 + i] * w[i]; yr[i] = gyro[a][s0 + i] * w[i]; }
        fft(xr, xi);
        fft(yr, yi);
        let px = 0;
        for (let i = 0; i < M; i += 1) px += xr[i] ** 2 + xi[i] ** 2;
        px /= M;
        const reg = 1e-3 * px;
        const hr = new Float64Array(M), him = new Float64Array(M);
        for (let i = 0; i < M; i += 1) {
          const d = xr[i] ** 2 + xi[i] ** 2 + reg;
          hr[i] = (yr[i] * xr[i] + yi[i] * xi[i]) / d;
          him[i] = (yr[i] * xi[i] - yi[i] * xr[i]) / d;
        }
        fft(hr, him); // the forward FFT of conj(H) is conj(ifft(H)) times M
        const step = new Float64Array(L5);
        let c = 0;
        for (let i = 0; i < L5; i += 1) { c += hr[i] / M; step[i] = c; }
        const ss = mean(step.subarray(Math.round(0.2 * fs), L5));
        if (!(ss > 0.6 && ss < 1.4)) continue;
        for (let i = 0; i < L5; i += 1) acc[i] += step[i] / ss;
        k += 1;
      }
      if (!k) {
        res.step[axis] = null;
        continue;
      }
      for (let i = 0; i < L5; i += 1) acc[i] /= k;
      let peak = 0, peakAt = 0;
      for (let i = 0; i < Math.round(0.2 * fs); i += 1) if (acc[i] > peak) { peak = acc[i]; peakAt = i; }
      const t50 = acc.findIndex((v) => v >= 0.5);
      res.step[axis] = { windows: k, peak: r(peak, 2), peakMs: r(1000 * peakAt / fs), latencyMs: t50 >= 0 ? r(1000 * t50 / fs, 1) : null };
      res.charts.step[axis] = Array.from(acc.subarray(0, shown), (v) => r(v, 3));
    }
  }

  // How much of the rates is used
  {
    const rates = ratesOf(h);
    res.rates = { type: rates.type, axes: {} };
    ["roll", "pitch", "yaw"].forEach((name, a) => {
      const set = rates.axes[name];
      const known = Number.isFinite(set.rc);
      const topDps = known ? rateAt(rates.type, set, 1) : null;
      const stick = flyVals(rc[a]).map((v) => Math.abs(v) / 500);
      const spAbs = flyVals(sp[a]).map(Math.abs);
      res.rates.axes[name] = {
        setting: { rc: set.rc, srate: set.srate, expo: set.expo }, limit: set.limit, topDps: r(topDps), centerDps: known ? r(centerOf(rates.type, set)) : null,
        stickP50: r(100 * pct(stick, 50)), stickP95: r(100 * pct(stick, 95)), stickP99: r(100 * pct(stick, 99)), stickMax: r(100 * maxOf(stick)),
        over90Pct: r(100 * stick.filter((v) => v > 0.9).length / Math.max(1, stick.length), 1),
        rateP99: r(pct(spAbs, 99)), rateMax: r(maxOf(spAbs)), topUsedPct: topDps ? r(100 * pct(spAbs, 99) / topDps) : null,
      };
    });
  }

  // Anything alarming
  const alarms = [];
  if (L.defS) {
    const fi = L.defS.index.failsafePhase, rx = L.defS.index.rxSignalReceived;
    const inFailsafe = L.slow.filter((s) => fi != null && s.v[fi] > 0).length;
    const lost = L.slow.filter((s) => rx != null && s.v[rx] === 0);
    if (inFailsafe) alarms.push({ kind: "failsafe", text: `Failsafe in ${inFailsafe} of the log's slow frames` });
    if (lost.length) alarms.push({ kind: "rxLost", text: `The radio link dropped (first at ${r(lost[0].t / 1e6 - L.times[0] / 1e6, 1)} s)` });
  }
  const disarms = L.events.filter((e) => e.name === "DISARM");
  res.disarm = disarms.map((e) => disarmReasons[e.reason] || `reason ${e.reason}`);
  res.disarmCodes = disarms.map((e) => e.reason);
  const rssi = get("rssi");
  if (rssi && maxOf(rssi) > 0) {
    const rp = flyVals(rssi).map((v) => v / 10.23);
    res.rssi = { min: r(minOf(rp)), p5: r(pct(rp, 5)), median: r(median(rp)) };
  }
  res.gyroMaxDps = r(Math.max(...gyro.map((g) => maxOf(flyVals(g).map(Math.abs)))));
  const acc1g = Number(h.acc_1G || 2048);
  const ax = [0, 1, 2].map((a) => get(`accSmooth[${a}]`));
  if (ax[0] && ax[1] && ax[2]) {
    let hits = 0, lastH = -1e9;
    for (let i = 0; i < n; i += 1) {
      const g = Math.hypot(ax[0][i], ax[1][i], ax[2][i]) / acc1g;
      if (g > 6 && i - lastH > fs) { hits += 1; lastH = i; }
    }
    res.hardHits = hits;
  }
  res.alarms = alarms;
  res.events = L.events.filter((e) => e.name !== "LOG_END").map((e) => ({ name: e.name, t: e.t != null ? r((e.t - L.times[0]) / 1e6, 1) : null, reason: e.reason ?? null }));
  return res;
}

// ---- The header

/** What a log's header says about the flight controller and its tune. */
export function headerFacts(h) {
  const pick = (k) => h[k] ?? null;
  const joined = (...parts) => parts.filter((part) => part !== null && part !== "").join(" ");
  return {
    firmware: pick("Firmware revision"), firmwareDate: pick("Firmware date"), board: pick("Board information"), craft: pick("Craft name") || null,
    uid: pick("DeviceUID"), looptimeUs: Number(pick("looptime")) || null, pidDenom: pick("pid_process_denom"),
    blackboxRate: pick("P interval"), debugMode: pick("debug_mode"), motorProtocol: pick("motor_pwm_protocol"), dshotBidir: pick("dshot_bidir"), motorPoles: pick("motor_poles"),
    pids: { roll: pick("rollPID"), pitch: pick("pitchPID"), yaw: pick("yawPID") },
    dMax: pick("d_max") ?? pick("d_min"), dMaxGain: pick("d_max_gain") ?? pick("d_min_gain"), ff: pick("ff_weight"),
    antiGravity: pick("anti_gravity_gain"), tpa: pick("tpa_rate") !== null ? `${pick("tpa_rate")}% from ${pick("tpa_breakpoint")}` : null,
    thrustLinear: pick("thrust_linear"), motorOutputLimit: pick("motor_output_limit"), dynIdle: pick("dyn_idle_min_rpm"),
    gyroLpf1: joined(pick("gyro_lowpass_type"), pick("gyro_lowpass_hz"), pick("gyro_lowpass_dyn_hz") ? `dyn ${pick("gyro_lowpass_dyn_hz")}` : null),
    gyroLpf2: joined(pick("gyro_lowpass2_type"), pick("gyro_lowpass2_hz")),
    dtermLpf1: joined(pick("dterm_lpf1_type") ?? pick("dterm_filter_type"), pick("dterm_lpf1_static_hz") ?? pick("dterm_lpf_hz"), pick("dterm_lpf1_dyn_hz") ? `dyn ${pick("dterm_lpf1_dyn_hz")}` : null),
    dtermLpf2: joined(pick("dterm_lpf2_type"), pick("dterm_lpf2_static_hz") ?? pick("dterm_lpf2_hz")),
    dynNotch: pick("dyn_notch_count") !== null ? `${pick("dyn_notch_count")} notch${pick("dyn_notch_count") === "1" ? "" : "es"}, ${pick("dyn_notch_min_hz")}–${pick("dyn_notch_max_hz")} Hz` : null,
    rpmFilter: pick("rpm_filter_harmonics") !== null ? `${pick("rpm_filter_harmonics")} harmonics from ${pick("rpm_filter_min_hz")} Hz` : null,
    rates: ratesOf(h),
    simplified: Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith("simplified_"))),
  };
}

/** Which whoop a log came from: its flight controller's unique number, its craft name and board. */
export function whoopOf(h) {
  return { uid: h.DeviceUID || null, craft: h["Craft name"] || null, board: h["Board information"] || null, firmware: h["Firmware revision"] || null };
}

// ---- A whole dump

/**
 * Which logs went with which power-up. The flight controller's clock starts again at each
 * power-up, so a log that starts before the one before it ended belongs to a new one. Logs with
 * nothing in them go with the power-up they were found in.
 */
export function powerUps(logs) {
  const groups = [];
  let lastEnd = null;
  for (const L of logs) {
    const start = L.frames ? L.times[0] : null;
    if (!groups.length || (start !== null && lastEnd !== null && start < lastEnd)) groups.push([]);
    groups.at(-1).push(L.index);
    if (L.frames) lastEnd = L.times[L.frames - 1];
  }
  return groups;
}

/** A flight shorter than this is an arm on the bench or a hop, not worth keeping by itself. */
export const shortFlight = 5;

/** Everything in a dump: each log's header facts and flight, and its power-ups. */
export function analyseDump(bytes) {
  const logs = readLogs(bytes);
  return {
    logs: logs.map((L) => ({
      index: L.index, frames: L.frames, error: L.error ?? null,
      whoop: whoopOf(L.hdr), facts: headerFacts(L.hdr),
      flight: L.error ? null : analyseLog(L),
    })),
    powerUps: powerUps(logs),
  };
}

// ---- What a flight says

const pctWords = (v) => `${Math.round(v)}%`;

/**
 * What a flight says, in a few plain lines, worst first: each `{ level, text }`, with level
 * "warn" for something to look at now, "note" for something worth knowing and "good" for
 * what is fine. The limits are where the pilot's own logs showed a difference that mattered.
 */
export function sayingsOf(f) {
  if (!f || f.tooShort || f.missing) return [{ level: "note", text: "Too short to say anything." }];
  const out = [];
  const add = (level, text) => out.push({ level, text });
  for (const alarm of f.alarms ?? []) add("warn", `${alarm.text}.`);
  const codes = f.disarmCodes ?? [];
  if (codes.includes(1)) add("warn", "Disarmed by failsafe.");
  if (codes.includes(6)) add("warn", "Disarmed by runaway takeoff protection: check the motor order and direction, and the props.");
  if (codes.includes(5)) add("warn", "Disarmed by crash protection.");
  if (codes.includes(10)) add("note", "Ended with a turtle flip.");
  // An arm on the bench, a hop or a crash at take-off: its motors and pack say nothing worth saying.
  if ((f.flyingSeconds ?? 0) < shortFlight) {
    add("note", `Only ${f.flyingSeconds ?? 0} s in the air: too short to say much.`);
    return out;
  }
  if ((f.motors?.singlePinnedEvents ?? 0) > 0) add("warn", `One motor was held at full while the others weren't, ${f.motors.singlePinnedEvents} time${f.motors.singlePinnedEvents === 1 ? "" : "s"}: a desync, or a bad motor or prop.`);
  if ((f.erpm?.desyncLike ?? 0) > 0) add("note", `A motor's speed collapsed while it was told to spin hard ${f.erpm.desyncLike} time${f.erpm.desyncLike === 1 ? "" : "s"}: a prop strike, or a desync if there was no crash.`);
  const buzz = median(f.motors?.hfNoisePct ?? []);
  const flewEnough = (f.flyingSeconds ?? 0) >= 10;
  if (Number.isFinite(buzz) && flewEnough) {
    if (buzz >= 6) add("warn", `The motors buzz: they jitter about ${pctWords(buzz)} of their range. Check the props first, then the D-term filter.`);
    else if (buzz >= 4) add("note", `Some motor buzz: about ${pctWords(buzz)} jitter.`);
    else add("good", `The motors run smooth: ${buzz.toFixed(1)}% jitter.`);
  }
  if ((f.motors?.saturatedPct ?? 0) >= 3) add("warn", `A motor was at full ${f.motors.saturatedPct}% of the time in the air: the whoop asked for more than it had.`);
  if (f.battery?.minUnderLoad != null && f.battery.minUnderLoad < 3.2) add("warn", `The pack fell to ${f.battery.minUnderLoad.toFixed(2)} V under load.`);
  if (flewEnough && Number.isFinite(buzz) && buzz < 6) {
    for (const axis of ["roll", "pitch"]) {
      const step = f.step?.[axis];
      if (step && step.windows >= 10 && step.peak >= 1.25) add("note", `${axis[0].toUpperCase()}${axis.slice(1)} overshoots about ${Math.round((step.peak - 1) * 100)}% after quick moves.`);
    }
  }
  for (const axis of ["roll", "pitch", "yaw"]) {
    const use = f.rates?.axes?.[axis];
    if (use && use.topUsedPct >= 95 && use.over90Pct >= 3) add("note", `${axis[0].toUpperCase()}${axis.slice(1)} runs out: full stick ${use.over90Pct}% of the time, at its top of ${use.topDps} °/s.`);
  }
  const imbalance = f.motors?.imbalancePct ?? [];
  const worst = imbalance.reduce((best, v, k) => (Math.abs(v) > Math.abs(best.v) ? { v, k } : best), { v: 0, k: -1 });
  if (flewEnough && Math.abs(worst.v) >= 8 && Math.abs(f.tracking?.yawSpMean ?? 0) < 10) {
    add("note", `Motor ${worst.k + 1} works ${Math.abs(worst.v)}% ${worst.v > 0 ? "harder" : "less"} than the others: a bent prop, a tired motor or the weight off centre.`);
  }
  if (out.length === 0) add("good", "Nothing stands out.");
  const order = { warn: 0, note: 1, good: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** A flight in a line, for the Garage's lists: what is kept of it beside its pack and whoop. */
export function summaryOf(f) {
  const says = sayingsOf(f);
  const buzz = median(f?.motors?.hfNoisePct ?? []);
  return {
    seconds: f?.seconds ?? null, flyingSeconds: f?.flyingSeconds ?? null,
    beforeArm: f?.battery?.beforeArm ?? null, lowest: f?.battery?.minUnderLoad ?? null, atDisarm: f?.battery?.atDisarm ?? null,
    mah: f?.battery?.mah ?? null, buzz: Number.isFinite(buzz) ? r(buzz, 1) : null,
    stepRoll: f?.step?.roll?.peak ?? null, stepPitch: f?.step?.pitch?.peak ?? null,
    yawUsed: f?.rates?.axes?.yaw?.topUsedPct ?? null,
    headline: says[0]?.text ?? "", level: says[0]?.level ?? "good",
  };
}
