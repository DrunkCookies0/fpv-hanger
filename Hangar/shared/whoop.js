// One whoop in the Whoop Garage: what it's built from, the changes made to it, and its health.
//
// The build is what the pilot types, with what the whoop's newest log says filled in where they
// haven't: the board, Betaflight, the motor protocol, the receiver and the loop. The changes are
// dated notes (new props, a motor swapped), kept so the health can be read before and after each.
//
// The health compares the whoop with itself. Each flight says how much of the work each motor did
// (its share of the four motors' output) and how much each one buzzed. A motor that starts doing
// more than it used to is making up for something at its corner; a pair that does is the weight or
// the props on that side; a diagonal pair is the whoop fighting a twist. Nothing here touches a
// page or a file, so it can be tested by itself.

import { garageDefaults } from "./garage.js";
import { median } from "./flight.js";

const round1 = (v) => Math.round(v * 10) / 10;

/** Where each motor sits on a quad X in Betaflight's order. */
export const corners = ["back right", "front right", "back left", "front left"];

/** The parts a whoop is built from, in the order they're shown. Those with `log` are filled in from
 *  the whoop's newest log until the pilot types over them. */
export const partFields = [
  { key: "frame", label: "Frame", hint: "65 mm, its make" },
  { key: "motors", label: "Motors", hint: "0702 25000 KV, their make", log: true },
  { key: "props", label: "Props", hint: "31 mm 3-blade, 1 mm shaft" },
  { key: "board", label: "Board", hint: "the flight controller, ESCs and receiver in one", log: true },
  { key: "escFirmware", label: "ESC firmware", hint: "Bluejay, 48 kHz" },
  { key: "motorProtocol", label: "Motor protocol", log: true },
  { key: "receiver", label: "Receiver", log: true },
  { key: "video", label: "Camera and video", hint: "analog or HDZero, its camera and VTX" },
  { key: "lead", label: "Battery lead", hint: "BT2.0, PH2.0" },
  { key: "weight", label: "Weight, dry", hint: "21.4 g" },
  { key: "firmware", label: "Betaflight", log: true },
  { key: "loop", label: "Gyro and PID loop", log: true },
];

const protocols = ["PWM", "OneShot125", "OneShot42", "MultiShot", "Brushed", "DShot150", "DShot300", "DShot600"];
const receivers = { 2: "SBUS", 7: "iBUS", 9: "CRSF (ExpressLRS or Crossfire)", 12: "FPort", 13: "SRXL2", 14: "Ghost" };
/** Betaflight's feature bits for a receiver on a serial port and one on the board's SPI bus. */
const featureRxSerial = 1 << 3, featureRxSpi = 1 << 25;
/** The motor KV Betaflight starts with, which says nothing about the motors fitted. */
const defaultKv = 1960;

/** What a whoop's log says about its build, from its header's facts (shared/flight.js). */
export function partsFromLog(facts) {
  if (!facts) return {};
  const out = {};
  const firmware = String(facts.firmware ?? "").match(/^Betaflight\s+(\S+)(?:\s+\([^)]*\))?\s*(\S+)?/);
  if (firmware) out.firmware = firmware[2] ? `${firmware[1]} on an ${firmware[2]}` : firmware[1];
  if (facts.board) out.board = String(facts.board).replace(/^[A-Z0-9]{4}\s+/, "");
  const protocol = Number(facts.motorProtocol);
  if (facts.motorProtocol != null && Number.isInteger(protocol)) {
    const poles = Number(facts.motorPoles);
    out.motorProtocol = [protocols[protocol] ?? `protocol ${protocol}`, String(facts.dshotBidir) === "1" ? "bidirectional" : null, poles > 0 ? `${poles} poles` : null].filter(Boolean).join(", ");
  }
  const features = Number(facts.features);
  if (Number.isFinite(features) && features & featureRxSpi) out.receiver = "On the board (SPI)";
  else if (facts.receiver != null && (!Number.isFinite(features) || features & featureRxSerial) && receivers[Number(facts.receiver)]) out.receiver = receivers[Number(facts.receiver)];
  const kv = Number(facts.motorKv);
  if (kv > 0 && kv !== defaultKv) out.motors = `${kv} KV`;
  const looptime = Number(facts.looptimeUs), denom = Number(facts.pidDenom) || 1;
  if (looptime > 0) {
    const khz = (hz) => `${round1(hz / 1000)} kHz`;
    out.loop = `${khz(1e6 / looptime)} gyro, ${khz(1e6 / looptime / denom)} PID loop`;
  }
  return out;
}

/** A whoop's parts as shown: each field with what the pilot typed, or else what its log says. */
export function partsOf(whoop, facts) {
  const typed = whoop?.parts ?? {};
  const logged = partsFromLog(facts);
  return partFields.map((field) => {
    const own = String(typed[field.key] ?? "").trim();
    const fromLog = field.log ? logged[field.key] ?? null : null;
    return { ...field, value: own || fromLog || "", fromLog: !own && Boolean(fromLog), logValue: fromLog };
  });
}

/** The Garage with one of a whoop's parts typed; an empty one goes back to what the log says. */
export function setPart(found, whoopId, key, value) {
  const garage = garageDefaults(found);
  const whoop = garage.whoops[whoopId];
  if (!whoop || !partFields.some((field) => field.key === key)) return garage;
  const parts = { ...(whoop.parts ?? {}) };
  const tidy = String(value ?? "").trim().slice(0, 120);
  if (tidy) parts[key] = tidy;
  else delete parts[key];
  garage.whoops[whoopId] = { ...whoop, parts };
  return garage;
}

/** The time a change made on a day is kept at: now, if it was today, or else the start of that day,
 *  so every flight saved that day or after counts as after it. `day` is "YYYY-MM-DD". */
export function changeTime(day, now = new Date()) {
  const local = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) return { problem: "Say which day it was changed." };
  if (day > local(now)) return { problem: "That day hasn't come yet." };
  if (day === local(now)) return { at: now.toISOString() };
  return { at: new Date(`${day}T00:00:00`).toISOString() };
}

/** The Garage with a change to a whoop noted: `{ at, text }`, `at` an ISO time. */
export function noteChange(found, whoopId, { at, text }, id = `c${Date.now().toString(36)}`) {
  const garage = garageDefaults(found);
  const whoop = garage.whoops[whoopId];
  const tidy = String(text ?? "").trim().slice(0, 140);
  if (!whoop) return { garage, problem: "That whoop isn't in the Garage." };
  if (!tidy) return { garage, problem: "Say what was changed." };
  if (!at || Number.isNaN(Date.parse(at))) return { garage, problem: "Say which day it was changed." };
  const changes = [...(whoop.changes ?? []), { id, at, text: tidy }].sort((a, b) => a.at.localeCompare(b.at));
  garage.whoops[whoopId] = { ...whoop, changes };
  return { garage, problem: null };
}

/** The Garage without one of a whoop's changes. */
export function forgetChange(found, whoopId, changeId) {
  const garage = garageDefaults(found);
  const whoop = garage.whoops[whoopId];
  if (!whoop) return garage;
  garage.whoops[whoopId] = { ...whoop, changes: (whoop.changes ?? []).filter((change) => change.id !== changeId) };
  return garage;
}

/** A whoop's changes, oldest first, each with the flights flown and the time in the air since. */
export function changesWithTime(whoop, flights) {
  return [...(whoop?.changes ?? [])].sort((a, b) => a.at.localeCompare(b.at)).map((change) => {
    const after = flights.filter((flight) => String(flight.savedAt ?? flight.keptAt ?? "") >= change.at);
    return { ...change, flights: after.length, flyingSeconds: Math.round(after.reduce((sum, flight) => sum + (flight.summary?.flyingSeconds ?? 0), 0)) };
  });
}

// ---- Health

/** A flight counts towards a whoop's health once it has been in the air this long, in seconds:
 *  shorter ones are hops and crashes, and their motors say little. */
export const healthMinimum = 10;
/** A motor's share that moves this far, in points of the whole, from what it was is worth a look;
 *  the pilot's own whoops moved about a point from flight to flight. */
export const shareMove = 1.5;
/** A whoop leaning this far from an even 25% each is worth knowing about. */
export const shareLean = 3;

/** Each motor's share of the work, in % of the four together, from their mean outputs. */
export function shareOf(meanPct) {
  if (!Array.isArray(meanPct) || meanPct.length !== 4 || !meanPct.every(Number.isFinite)) return null;
  const sum = meanPct.reduce((a, b) => a + b, 0);
  return sum > 0 ? meanPct.map((v) => round1((100 * v) / sum)) : null;
}

/** What health needs of one flight: its record in the Garage and what was worked out from it. */
export function healthRow(record, f) {
  const buzz = f?.motors?.hfNoisePct;
  return {
    id: record.id, at: record.savedAt ?? record.keptAt ?? null, index: record.index ?? 0, what: record.what ?? "", pack: record.pack ?? null,
    flyingSeconds: f?.flyingSeconds ?? 0, share: shareOf(f?.motors?.meanPct),
    buzz: Array.isArray(buzz) && buzz.length === 4 && buzz.every(Number.isFinite) ? buzz : null,
    // A motor held at full while the others weren't. (A motor's speed collapsing once is left out:
    // the pilot's own logs had one in a flight in four, from props hitting gates.)
    pinned: f?.motors?.singlePinnedEvents ?? 0,
  };
}

const byTime = (a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")) || a.index - b.index;
const motorsOf = (rows, pick) => [0, 1, 2, 3].map((k) => {
  const value = median(rows.map((row) => pick(row)?.[k]).filter(Number.isFinite));
  return Number.isFinite(value) ? round1(value) : null;
});

/**
 * How the work is spread, as the shape that fits it best: one corner doing more or less than the
 * rest, the back pair against the front, the right pair against the left, or one diagonal against
 * the other. `d` is each motor's share less what it is compared with, in motor order.
 */
export function shapeOf(d) {
  const shapes = [
    ...[0, 1, 2, 3].map((k) => ({ kind: "corner", motor: k, v: [0, 1, 2, 3].map((j) => (j === k ? 1 : -1 / 3)) })),
    { kind: "back", v: [1, -1, 1, -1] },
    { kind: "right", v: [1, 1, -1, -1] },
    { kind: "diagonal", v: [-1, 1, 1, -1] },
  ];
  let best = null;
  for (const shape of shapes) {
    const dot = shape.v.reduce((sum, v, k) => sum + v * d[k], 0);
    const fit = (dot * dot) / shape.v.reduce((sum, v) => sum + v * v, 0);
    if (!best || fit > best.fit) best = { kind: shape.kind, motor: shape.motor ?? null, more: dot > 0, fit };
  }
  const size = d.reduce((sum, v) => sum + v * v, 0);
  return { kind: best.kind, motor: best.motor, more: best.more, fits: size > 0 ? round1(best.fit / size) : 0 };
}

const pct = (v) => `${v.toFixed(1)}%`;
/** A sentence carried on after a colon, with its first letter small. */
const lower = (text) => `${text[0].toLowerCase()}${text.slice(1)}`;
const motorWords = (k) => `Motor ${k + 1} (${corners[k]})`;

/** What a shape of the work means and what to do about it, with the shares that show it. */
function shapeWords(shape, then, now) {
  // A motor's share, or a pair's between them, before and now, or now against an even share.
  const was = (a, b = null) => {
    const of = (values) => pct(b === null ? values[a] : values[a] + values[b]);
    const work = b === null ? "of the work" : "of the work between them";
    return then ? `${of(then)} ${work} before, ${of(now)} now` : `${of(now)} ${work}, where even is ${b === null ? "25%" : "50%"}`;
  };
  if (shape.kind === "corner" && shape.more) {
    const n = shape.motor + 1;
    return {
      title: `${motorWords(shape.motor)} works harder${then ? " than it did" : " than the others"}: ${was(shape.motor)}.`,
      why: "It is making up for something at that corner: most often its prop (bent, chipped, or not pushed fully on), then the motor itself.",
      steps: [`Look at prop ${n} against the light, and swap it.`, `Spin motor ${n} by hand: it should feel like the others, with no grit.`, `Fly a pack and read it: motor ${n} should come back towards 25%.`],
    };
  }
  if (shape.kind === "corner") {
    return {
      title: `${motorWords(shape.motor)} does less of the work${then ? " than it did" : " than the others"}: ${was(shape.motor)}.`,
      why: "The other three are making up for something, or the weight has moved away from that corner.",
      steps: ["Check that the pack sits where it always does in its strap, and that the camera hasn't moved.", `If prop ${shape.motor + 1} is newer than the others, put a fresh set on all four.`],
    };
  }
  if (shape.kind === "back") {
    const [a, b, where, other] = shape.more ? [0, 2, "back", "front"] : [1, 3, "front", "back"];
    return {
      title: `The ${where} motors (${a + 1} and ${b + 1}) work harder${then ? " than they did" : " than the " + other}: ${was(a, b)}.`,
      why: `The weight sits further to the ${where}: the pack further ${where} in its strap, or a heavier camera or lead. Or the ${where} props are more worn than the ${other} ones.`,
      steps: [`Move the pack ${shape.more ? "forward" : "back"} to where it sits for a race.`, `Swap the ${where} two props.`],
    };
  }
  if (shape.kind === "right") {
    const [a, b, side, other] = shape.more ? [0, 1, "right", "left"] : [2, 3, "left", "right"];
    return {
      title: `The ${side}-hand motors (${a + 1} and ${b + 1}) work harder${then ? " than they did" : " than the " + other}: ${was(a, b)}.`,
      why: `The weight sits off to the ${side}: the pack, the antenna or the camera. Or the ${side}-hand props are more worn.`,
      steps: ["Centre the pack in its strap.", `Swap the ${side}-hand two props.`],
    };
  }
  const [a, b, c, e] = shape.more ? [1, 2, 0, 3] : [0, 3, 1, 2];
  return {
    title: `Motors ${a + 1} and ${b + 1}, one diagonal, work harder${then ? " than they did" : ` than ${c + 1} and ${e + 1}`}: ${was(a, b)}.`,
    why: `The whoop is fighting a twist. Each diagonal spins its props one way, so props on ${c + 1} and ${e + 1} that drag more (worn, or a different kind), or a motor that leans on a bent arm, make the other pair work harder. Turning mostly one way round a track adds a little.`,
    steps: ["Put a fresh set of four props on, all from one bag.", "Look at each motor from the side: all four should stand straight up."],
  };
}

/**
 * Which flights to compare: the last three against the ones before them since the newest change,
 * or, when there are only a few since it, those against the flights before it. `{ kind, change,
 * then, now }`, kind "lately" or "change"; null when there aren't enough. `waiting` is a change
 * with too few flights since it to say what it did.
 */
export function comparisonOf(flights, changes) {
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at));
  const newest = sorted.at(-1) ?? null;
  const previous = sorted.at(-2) ?? null;
  const since = newest ? flights.filter((row) => row.at >= newest.at) : flights;
  // Before it: back to the change before, unless too few were flown between the two.
  const allBefore = newest ? flights.filter((row) => row.at < newest.at) : [];
  const between = allBefore.filter((row) => !previous || row.at >= previous.at);
  const before = between.length >= 2 ? between : allBefore;
  if (since.length >= 5) return { compare: { kind: "lately", change: newest, then: since.slice(0, -3).slice(-8), now: since.slice(-3) }, waiting: null };
  if (newest && since.length >= 2 && before.length >= 2) return { compare: { kind: "change", change: newest, then: before.slice(-8), now: since.slice(-5) }, waiting: null };
  return { compare: null, waiting: newest && since.length < 2 ? newest : null };
}

/**
 * A whoop's health from its flights (`healthRow`s) and its changes: the flights that count, oldest
 * first, what is compared, each motor's share and buzz then and now, and what to check, each
 * `{ level, title, why, steps }` worst first.
 */
export function healthOf(rows, changes = []) {
  const flights = [...rows].filter((row) => row.flyingSeconds >= healthMinimum && row.share).sort(byTime);
  const { compare, waiting } = comparisonOf(flights, changes);
  const checks = [];
  const add = (level, words) => checks.push({ level, ...words });
  const since = (change) => `Since “${change.text}”`;
  const latest = flights.slice(-3);
  const nowShare = compare ? motorsOf(compare.now, (row) => row.share) : latest.length ? motorsOf(latest, (row) => row.share) : null;
  const thenShare = compare ? motorsOf(compare.then, (row) => row.share) : null;
  const nowBuzz = compare ? motorsOf(compare.now, (row) => row.buzz) : latest.length ? motorsOf(latest, (row) => row.buzz) : null;
  const thenBuzz = compare ? motorsOf(compare.then, (row) => row.buzz) : null;
  const lean = (shares) => Math.max(...shares.map((v) => Math.abs(v - 25)));
  let described = null;

  if (compare && thenShare.every(Number.isFinite) && nowShare.every(Number.isFinite)) {
    const d = nowShare.map((v, k) => round1(v - thenShare[k]));
    const moved = Math.max(...d.map(Math.abs));
    const lead = compare.kind === "change" ? `${since(compare.change)}: ` : "In the last 3 flights: ";
    if (moved >= shareMove && lean(nowShare) <= lean(thenShare) - 1) {
      add("good", { title: `${lead}the work is shared more evenly. ${shapeWords(shapeOf(d), thenShare, nowShare).title}`, why: null, steps: [] });
    } else if (moved >= shareMove) {
      described = shapeOf(d);
      const words = shapeWords(described, thenShare, nowShare);
      add(moved >= 2.5 ? "warn" : "note", { ...words, title: `${lead}${lower(words.title)}` });
    } else if (compare.kind === "change") {
      add("good", { title: `${lead}each motor does the same share of the work as before.`, why: null, steps: [] });
    }
  }

  // A lean the whoop has had all along, or has now.
  if (nowShare?.every(Number.isFinite) && lean(nowShare) >= shareLean) {
    const shape = shapeOf(nowShare.map((v) => v - 25));
    if (!described || described.kind !== shape.kind || described.motor !== shape.motor) {
      const words = shapeWords(shape, null, nowShare);
      add(lean(nowShare) >= 5 ? "warn" : "note", { ...words, title: `It leans: ${lower(words.title)}` });
    }
  }

  // The motors' buzz: one rising alone is its prop or bearing; all four together, the props or tune.
  if (compare && thenBuzz.every(Number.isFinite) && nowBuzz.every(Number.isFinite)) {
    const rise = nowBuzz.map((v, k) => round1(v - thenBuzz[k]));
    const order = [0, 1, 2, 3].sort((a, b) => rise[b] - rise[a]);
    const [top, second] = order;
    const all = { then: median(thenBuzz), now: median(nowBuzz) };
    const lead = compare.kind === "change" ? `${since(compare.change)}, ` : "In the last 3 flights, ";
    if (rise[top] >= 1 && nowBuzz[top] >= thenBuzz[top] * 1.4 && rise[second] < rise[top] / 2) {
      const n = top + 1;
      add("warn", {
        title: `${lead}motor ${n} (${corners[top]}) buzzes more than it did: ${pct(thenBuzz[top])} jitter before, ${pct(nowBuzz[top])} now, while the others stayed put.`,
        why: "One motor buzzing on its own is its prop (bent or unbalanced) or a bearing going.",
        steps: [`Swap prop ${n}.`, `Spin motor ${n} by hand and listen: a rough or gritty one wants replacing.`],
      });
    } else if (all.now - all.then >= 1 && all.now >= all.then * 1.4) {
      add("note", { title: `${lead}all four motors buzz more than they did: ${pct(all.then)} jitter before, ${pct(all.now)} now.`, why: "Worn props, or a change to the filters or the tune.", steps: ["Put a fresh set of props on, then fly a pack and read it."] });
    } else if (all.then - all.now >= 1 && all.now <= all.then * 0.7) {
      add("good", { title: `${lead}the motors buzz less: ${pct(all.then)} jitter before, ${pct(all.now)} now.`, why: null, steps: [] });
    }
  }

  // A motor held at full on its own, in more than one recent flight.
  const troubled = latest.filter((row) => row.pinned > 0).length;
  if (troubled >= 2) {
    add("warn", { title: `A motor was held at full while the others weren't, in ${troubled} of the last ${latest.length} flights.`, why: "A desync, a prop strike that bent something, or a motor or its solder joint failing.", steps: ["Open those flights and look at what they say.", "Spin each motor by hand, and check the motor wires' joints on the board."] });
  }

  if (waiting) add("note", { title: `Fly ${flights.filter((row) => row.at >= waiting.at).length ? "another pack" : "two packs"} since “${waiting.text}” to see what it did.`, why: null, steps: [] });
  if (!compare && !waiting) add("note", { title: flights.length < 5 ? `Health compares this whoop with itself, so it needs about 5 flights of ${healthMinimum} s or more: ${flights.length === 0 ? "none yet" : `${flights.length} so far`}.` : "Fly another pack or two to compare it with itself.", why: null, steps: [] });
  if (checks.length === 0) add("good", { title: "Nothing stands out: each motor does about the share it did, and buzzes as it did.", why: null, steps: [] });
  const rank = { warn: 0, note: 1, good: 2 };
  checks.sort((a, b) => rank[a.level] - rank[b.level]);
  return { flights, compare, thenShare, nowShare, thenBuzz, nowBuzz, checks };
}
