// Betaflight's blackbox logs (.bbl, .bfl): the header lines, then I, P, S, G, H and E frames with
// their variable-byte and tagged encodings, read from the published log format. Nothing of
// Betaflight's own code is used. A file is a flash dump that can hold many logs: one for each time
// the whoop was armed. Nothing here touches a page or a file, so it can be tested by itself, and it
// works on the bytes alone, in the app's main process or a page.

export const ENC = { SIGNED_VB: 0, UNSIGNED_VB: 1, NEG_14BIT: 3, TAG8_8SVB: 6, TAG2_3S32: 7, TAG8_4S16: 8, NULL: 9, TAG2_3SVARIABLE: 10 };
export const PRED = { ZERO: 0, PREVIOUS: 1, STRAIGHT_LINE: 2, AVERAGE_2: 3, MINTHROTTLE: 4, MOTOR_0: 5, INC: 6, HOME_COORD: 7, P1500: 8, VBATREF: 9, LAST_MAIN_FRAME_TIME: 10, MINMOTOR: 11 };
const MARK = { I: 0x49, P: 0x50, S: 0x53, G: 0x47, H: 0x48, E: 0x45 };
const FRAME_MARKS = new Set(Object.values(MARK));
const ascii = (text) => Uint8Array.from(text, (character) => character.charCodeAt(0));
/** Every log in a dump starts with this line. */
const PRODUCT = ascii("H Product:Blackbox flight data recorder by Nicholas Sherlock");
const END_MSG = "End of log\0";
/** A jump in time or loop count this big is a frame read wrongly, not a real one. */
const MAX_TIME_JUMP = 10 * 1000 * 1000; // µs
const MAX_ITER_JUMP = 500 * 10;

/** The low `bits` of a number, as a signed number. */
const se = (v, bits) => (v << (32 - bits)) >> (32 - bits);

/** Text from bytes, one character to a byte. */
function latin1(bytes, from, to) {
  let text = "";
  for (let index = from; index < to; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

/** Where a run of bytes is found in another, from `from` on: -1 when it isn't. */
function find(bytes, run, from = 0) {
  for (let at = bytes.indexOf(run[0], from); at >= 0 && at + run.length <= bytes.length; at = bytes.indexOf(run[0], at + 1)) {
    let same = true;
    for (let k = 1; k < run.length; k += 1) {
      if (bytes[at + k] !== run[k]) {
        same = false;
        break;
      }
    }
    if (same) return at;
  }
  return -1;
}

/** Reading a log's bytes one value at a time, in each of the encodings a field can have. */
export class Stream {
  constructor(bytes, start, end) {
    this.b = bytes;
    this.pos = start;
    this.end = end;
    this.eof = false;
  }

  byte() {
    if (this.pos >= this.end) {
      this.eof = true;
      return 0;
    }
    return this.b[this.pos++];
  }

  peek() { return this.pos < this.end ? this.b[this.pos] : -1; }

  uvb() {
    let value = 0, mul = 1;
    for (let i = 0; i < 5; i += 1) {
      const c = this.byte();
      value += (c & 0x7f) * mul;
      mul *= 128;
      if (c < 128) return value % 4294967296;
    }
    this.bad = true;
    return 0;
  }

  svb() {
    const u = this.uvb();
    return (u >>> 1) ^ -(u & 1);
  }

  s8() { return se(this.byte(), 8); }

  tag8_8svb(count) {
    const out = new Array(8).fill(0);
    if (count === 1) {
      out[0] = this.svb();
      return out;
    }
    let head = this.byte();
    for (let i = 0; i < 8; i += 1, head >>= 1) out[i] = head & 1 ? this.svb() : 0;
    return out;
  }

  tag2_3s32() {
    const lead = this.byte();
    const v = [0, 0, 0];
    switch (lead >> 6) {
      case 0: v[0] = se((lead >> 4) & 3, 2); v[1] = se((lead >> 2) & 3, 2); v[2] = se(lead & 3, 2); break;
      case 1: { v[0] = se(lead & 0x0f, 4); const b = this.byte(); v[1] = se(b >> 4, 4); v[2] = se(b & 0x0f, 4); break; }
      case 2: v[0] = se(lead & 0x3f, 6); v[1] = se(this.byte() & 0x3f, 6); v[2] = se(this.byte() & 0x3f, 6); break;
      case 3: this.var3(lead, v); break;
    }
    return v;
  }

  var3(lead, v) {
    for (let i = 0; i < 3; i += 1, lead >>= 2) {
      switch (lead & 3) {
        case 0: v[i] = this.s8(); break;
        case 1: { const a = this.byte(), b = this.byte(); v[i] = se(a | (b << 8), 16); break; }
        case 2: { const a = this.byte(), b = this.byte(), c = this.byte(); v[i] = se(a | (b << 8) | (c << 16), 24); break; }
        case 3: { const a = this.byte(), b = this.byte(), c = this.byte(), d = this.byte(); v[i] = (a | (b << 8) | (c << 16) | (d << 24)) | 0; break; }
      }
    }
  }

  tag2_3svariable() {
    const lead = this.byte();
    const v = [0, 0, 0];
    switch (lead >> 6) {
      case 0: v[0] = se((lead >> 4) & 3, 2); v[1] = se((lead >> 2) & 3, 2); v[2] = se(lead & 3, 2); break;
      case 1: { // 5, 5 and 4 bits
        v[0] = se((lead & 0x3e) >> 1, 5);
        const b = this.byte();
        v[1] = se(((lead & 0x01) << 4) | ((b & 0xf0) >> 4), 5);
        v[2] = se(b & 0x0f, 4);
        break;
      }
      case 2: { // 8, 7 and 7 bits
        const b1 = this.byte(), b2 = this.byte();
        v[0] = se(((lead & 0x3f) << 2) | ((b1 & 0xc0) >> 6), 8);
        v[1] = se(((b1 & 0x3f) << 1) | ((b2 & 0x80) >> 7), 7);
        v[2] = se(b2 & 0x7f, 7);
        break;
      }
      case 3: this.var3(lead, v); break;
    }
    return v;
  }

  tag8_4s16(version) {
    let sel = this.byte();
    const v = [0, 0, 0, 0];
    if (version < 2) {
      for (let i = 0; i < 4; i += 1, sel >>= 2) {
        switch (sel & 3) {
          case 0: v[i] = 0; break;
          case 1: { const c = this.byte(); v[i] = se(c & 0x0f, 4); i += 1; sel >>= 2; if (i < 4) v[i] = se(c >> 4, 4); break; }
          case 2: v[i] = this.s8(); break;
          case 3: { const a = this.byte(), b = this.byte(); v[i] = se(a | (b << 8), 16); break; }
        }
      }
      return v;
    }
    let nibble = 0, held = 0;
    for (let i = 0; i < 4; i += 1, sel >>= 2) {
      switch (sel & 3) {
        case 0: v[i] = 0; break;
        case 1:
          if (nibble === 0) { held = this.byte(); v[i] = se(held >> 4, 4); nibble = 1; }
          else { v[i] = se(held & 0x0f, 4); nibble = 0; }
          break;
        case 2:
          if (nibble === 0) v[i] = this.s8();
          else { let c = (held << 4) & 0xff; held = this.byte(); c |= held >> 4; v[i] = se(c, 8); }
          break;
        case 3:
          if (nibble === 0) { const a = this.byte(), b = this.byte(); v[i] = se((a << 8) | b, 16); }
          else { const a = this.byte(), b = this.byte(); v[i] = se(((held & 0x0f) << 12) | (a << 4) | (b >> 4), 16); held = b; }
          break;
      }
    }
    return v;
  }

  /** Four bytes as a float, as an in-flight adjustment carries one. */
  float() {
    const four = new Uint8Array([this.byte(), this.byte(), this.byte(), this.byte()]);
    return new DataView(four.buffer).getFloat32(0, true);
  }
}

/** The header's "H name:value" lines, and where the frames start after them. */
function parseHeader(bytes, start, end) {
  const header = {};
  let pos = start;
  while (pos < end && bytes[pos] === 0x48 && bytes[pos + 1] === 0x20) { // "H "
    let newline = bytes.indexOf(0x0a, pos);
    if (newline < 0 || newline > end) newline = end;
    const line = latin1(bytes, pos + 2, newline).replace(/\r$/, "");
    const colon = line.indexOf(":");
    if (colon > 0) header[line.slice(0, colon)] = line.slice(colon + 1);
    pos = newline + 1;
  }
  return { header, pos };
}

/** How one kind of frame is laid out: its fields, and how each is predicted and encoded. */
function frameDef(header, kind, namesFrom) {
  const names = header[`Field ${namesFrom || kind} name`];
  if (!names) return null;
  const list = (key) => (header[`Field ${key}`] || "").split(",").filter((part) => part !== "").map(Number);
  const name = names.split(",");
  const def = {
    name, count: name.length,
    signed: list(`${namesFrom || kind} signed`),
    predictor: list(`${kind} predictor`),
    encoding: list(`${kind} encoding`),
  };
  while (def.signed.length < def.count) def.signed.push(0);
  def.index = Object.fromEntries(name.map((one, i) => [one, i]));
  if (def.predictor.length !== def.count || def.encoding.length !== def.count) return null;
  return def;
}

/** One log: its header, its main frames (every field of every frame, and each frame's time in µs
 *  since the flight controller started), its slow frames, GPS frames and events. */
function parseLog(bytes, start, end, logIndex) {
  const { header: hdr, pos } = parseHeader(bytes, start, end);
  const defI = frameDef(hdr, "I");
  const defP = frameDef(hdr, "P", "I");
  const defS = frameDef(hdr, "S");
  const defG = frameDef(hdr, "G");
  const defH = frameDef(hdr, "H");
  if (!defI || !defP) return { index: logIndex, hdr, error: "missing field definitions", frames: 0, events: [], slow: [], times: new Float64Array(0), col: () => null, has: () => false };

  const dataVersion = Number(hdr["Data version"] || 2);
  const iInterval = Math.max(1, Number(hdr["I interval"] || 32));
  let pNum = 1, pDenom = 1;
  const pInterval = hdr["P interval"];
  // A bare number (Betaflight 4 and newer) means loopIteration counts logged frames, as
  // Betaflight's own decoder reads it, so nothing is skipped between them.
  if (pInterval) {
    const ratio = pInterval.match(/^(\d+)\/(\d+)$/);
    if (ratio) {
      pNum = Number(ratio[1]);
      pDenom = Number(ratio[2]);
    }
  }
  const motorOutput = (hdr.motorOutput || "").split(",").map(Number);
  const ctx = {
    minthrottle: Number(hdr.minthrottle ?? 1150),
    minmotor: Number.isFinite(motorOutput[0]) ? motorOutput[0] : 0,
    vbatref: Number(hdr.vbatref ?? 0),
    home: [0, 0],
  };
  const motor0 = defI.index["motor[0]"];
  const n = defI.count;
  const iterIdx = defI.index.loopIteration, timeIdx = defI.index.time;

  const shouldHave = (frame) => (((frame % iInterval) + pNum - 1) % pDenom) < pNum;
  const skippedSince = (last) => {
    if (last < 0) return 0;
    let count = 0;
    for (let frame = last + 1; !shouldHave(frame) && count < 4096; frame += 1) count += 1;
    return count;
  };

  let lastTime = null;
  const predict = (def, i, pred, v, cur, prev, prev2, homeSlot) => {
    switch (pred) {
      case PRED.ZERO: break;
      case PRED.PREVIOUS: if (prev) v += prev[i]; break;
      case PRED.STRAIGHT_LINE: if (prev) v += 2 * prev[i] - prev2[i]; break;
      case PRED.AVERAGE_2:
        if (prev) v += def.signed[i] ? Math.trunc((prev[i] + prev2[i]) / 2) : Math.floor(((prev[i] >>> 0) + (prev2[i] >>> 0)) / 2);
        break;
      case PRED.MINTHROTTLE: v += ctx.minthrottle; break;
      case PRED.MINMOTOR: v += ctx.minmotor; break;
      case PRED.P1500: v += 1500; break;
      case PRED.MOTOR_0: if (motor0 != null) v += cur[motor0]; break;
      case PRED.VBATREF: v += ctx.vbatref; break;
      case PRED.HOME_COORD: v += ctx.home[homeSlot.k++ & 1]; break;
      case PRED.LAST_MAIN_FRAME_TIME: if (lastTime != null) v += lastTime; break;
      default: throw new Error(`unknown predictor ${pred}`);
    }
    return def.signed[i] ? (v | 0) : (v >>> 0);
  };

  const readFields = (st, def, cur, prev, prev2, skipped) => {
    const homeSlot = { k: 0 };
    let i = 0;
    while (i < def.count) {
      if (def.predictor[i] === PRED.INC) {
        cur[i] = skipped + 1 + (prev ? prev[i] : 0);
        i += 1;
        continue;
      }
      const enc = def.encoding[i];
      let vals, group = 1;
      switch (enc) {
        case ENC.SIGNED_VB: vals = [st.svb()]; break;
        case ENC.UNSIGNED_VB: vals = [st.uvb()]; break;
        case ENC.NEG_14BIT: vals = [-se(st.uvb() & 0x3fff, 14)]; break;
        case ENC.NULL: vals = [0]; break;
        case ENC.TAG8_4S16: vals = st.tag8_4s16(dataVersion); group = 4; break;
        case ENC.TAG2_3S32: vals = st.tag2_3s32(); group = 3; break;
        case ENC.TAG2_3SVARIABLE: vals = st.tag2_3svariable(); group = 3; break;
        case ENC.TAG8_8SVB: {
          let j = i + 1;
          while (j < i + 8 && j < def.count && def.encoding[j] === ENC.TAG8_8SVB) j += 1;
          group = j - i;
          vals = st.tag8_8svb(group);
          break;
        }
        default: throw new Error(`unknown encoding ${enc}`);
      }
      for (let j = 0; j < group && i < def.count; j += 1, i += 1) cur[i] = predict(def, i, def.predictor[i], vals[j], cur, prev, prev2, homeSlot);
    }
  };

  // Main frames go into one flat array, each frame's time beside it, unwrapped past 2^32 µs.
  let cap = 1 << 16;
  let main = new Int32Array(cap * n);
  let times = new Float64Array(cap);
  let nMain = 0;
  const pushMain = (row, time) => {
    if (nMain >= cap) {
      cap *= 2;
      const grown = new Int32Array(cap * n);
      grown.set(main);
      main = grown;
      const grownTimes = new Float64Array(cap);
      grownTimes.set(times);
      times = grownTimes;
    }
    main.set(row, nMain * n);
    times[nMain] = time;
    nMain += 1;
  };
  const slow = [], events = [], gps = [];
  let corrupt = 0, skippedP = 0;

  let prev = null, prev2 = null, mainValid = false;
  let lastIter = -1, timeWrap = 0, lastRawTime = null;
  let prevG = null, prevG2 = null;
  const st = new Stream(bytes, pos, end);
  let ended = false;

  const nextOk = () => {
    const next = st.peek();
    return next === -1 || FRAME_MARKS.has(next);
  };
  const unwrap = (raw) => {
    if (lastRawTime != null && raw + 0x80000000 < lastRawTime) timeWrap += 4294967296;
    lastRawTime = raw;
    return raw + timeWrap;
  };

  while (!ended && st.pos < end) {
    const start0 = st.pos;
    st.bad = false;
    st.eof = false;
    const mark = st.byte();
    try {
      if (mark === MARK.I || mark === MARK.P) {
        const isI = mark === MARK.I;
        const def = isI ? defI : defP;
        const cur = new Int32Array(n);
        if (isI) readFields(st, def, cur, null, null, 0);
        else readFields(st, def, cur, prev, prev2, mainValid ? skippedSince(lastIter) : 0);
        let ok = !st.eof && !st.bad && nextOk();
        const time = cur[timeIdx] >>> 0, iteration = cur[iterIdx] >>> 0;
        if (ok && lastTime != null && mainValid) {
          const dt = time - (lastTime % 4294967296);
          if (dt < 0 && dt > -0x80000000) ok = false; // backwards
          if (dt > MAX_TIME_JUMP) ok = false;
          if (iteration < lastIter || iteration > lastIter + MAX_ITER_JUMP) ok = false;
        }
        if (!isI && !mainValid) {
          skippedP += 1;
          if (!ok) {
            corrupt += 1;
            st.pos = start0 + 1;
          }
          continue;
        }
        if (!ok) {
          corrupt += 1;
          mainValid = false;
          st.pos = start0 + 1;
          continue;
        }
        if (isI) {
          prev = cur;
          prev2 = cur;
        } else {
          prev2 = prev;
          prev = cur;
        }
        mainValid = true;
        lastIter = iteration;
        const unwrapped = unwrap(time);
        lastTime = unwrapped;
        pushMain(cur, unwrapped);
      } else if (mark === MARK.S && defS) {
        const cur = new Array(defS.count).fill(0);
        readFields(st, defS, cur, null, null, 0);
        if (st.eof || st.bad || !nextOk()) { corrupt += 1; st.pos = start0 + 1; continue; }
        slow.push({ t: lastTime, i: nMain, v: cur });
      } else if (mark === MARK.G && defG) {
        const cur = new Array(defG.count).fill(0);
        readFields(st, defG, cur, prevG, prevG2 || prevG, 0);
        if (st.eof || st.bad || !nextOk()) { corrupt += 1; st.pos = start0 + 1; continue; }
        prevG2 = prevG;
        prevG = cur;
        gps.push({ t: lastTime, v: cur });
      } else if (mark === MARK.H && defH) {
        const cur = new Array(defH.count).fill(0);
        readFields(st, defH, cur, null, null, 0);
        if (st.eof || st.bad || !nextOk()) { corrupt += 1; st.pos = start0 + 1; continue; }
        ctx.home = [cur[0] || 0, cur[1] || 0];
      } else if (mark === MARK.E) {
        const type = st.byte();
        const ev = { type, t: lastTime, i: nMain };
        switch (type) {
          case 0: ev.name = "SYNC_BEEP"; ev.time = st.uvb(); break;
          case 13: {
            ev.name = "INFLIGHT_ADJUSTMENT";
            const f = st.byte();
            ev.func = f & 127;
            ev.value = f & 128 ? st.float() : st.svb();
            break;
          }
          case 14: ev.name = "LOGGING_RESUME"; ev.iter = st.uvb(); ev.time = st.uvb(); lastIter = ev.iter; lastTime = unwrap(ev.time); mainValid = false; break;
          case 15: ev.name = "DISARM"; ev.reason = st.uvb(); break;
          case 30: ev.name = "FLIGHTMODE"; ev.flags = st.uvb(); ev.lastFlags = st.uvb(); break;
          case 255: {
            let said = "";
            for (let k = 0; k < END_MSG.length; k += 1) said += String.fromCharCode(st.byte());
            if (said === END_MSG) {
              ev.name = "LOG_END";
              ended = true;
            } else {
              corrupt += 1;
              st.pos = start0 + 1;
              continue;
            }
            break;
          }
          default: corrupt += 1; st.pos = start0 + 1; continue;
        }
        if (!ended && (st.eof || !nextOk())) { corrupt += 1; st.pos = start0 + 1; continue; }
        events.push(ev);
      } else {
        corrupt += 1; // not the start of a frame: found again byte by byte
      }
    } catch {
      corrupt += 1;
      st.pos = start0 + 1;
      mainValid = false;
    }
  }

  return {
    index: logIndex, hdr, defI, defS, dataVersion,
    frames: nMain, fieldCount: n, data: main.subarray(0, nMain * n), times: times.subarray(0, nMain),
    slow, events, gps, corrupt, skippedP, ended,
    /** One field across every main frame. Null when the log has no such field. */
    col(name) {
      const k = defI.index[name];
      if (k == null) return null;
      const out = new Float64Array(nMain);
      if (defI.signed[k]) for (let row = 0; row < nMain; row += 1) out[row] = main[row * n + k];
      else for (let row = 0; row < nMain; row += 1) out[row] = main[row * n + k] >>> 0;
      return out;
    },
    has(name) { return defI.index[name] != null; },
  };
}

/** Where each log in a dump starts and ends. */
function splitLogs(bytes) {
  const starts = [];
  for (let at = find(bytes, PRODUCT); at >= 0; at = find(bytes, PRODUCT, at + PRODUCT.length)) starts.push(at);
  return starts.map((start, i) => [start, i + 1 < starts.length ? starts[i + 1] : bytes.length]);
}

/** Every log in a dump's bytes, in order. */
export function readLogs(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return splitLogs(view).map(([start, end], i) => parseLog(view, start, end, i));
}

/** Whether some bytes look like a blackbox dump at all. */
export const isBlackbox = (bytes) => find(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), PRODUCT) >= 0;
