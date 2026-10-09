// A track as the track view keeps it, and the arithmetic of drawing one. Nothing here touches the
// screen, so it can be tested by itself.
//
// A track is built of pipe sections of one length, so every joint sits on a grid one section apart.
// Grid directions: x to the right from the start gate's side, y away from it, z up.
//
//   pipes   pairs of joints, each a section apart
//   lap     the moves of a lap in order, each a few points to fly through
//   start   where the start gate is flown through, and which way
//   parts   what the build is made of, by name, with how many sections each takes
//   from    where it was made from: the track video, and the stretches of it

const isPoint = (point) => Array.isArray(point) && point.length === 3 && point.every((value) => Number.isFinite(value));

/** Checks that something read from a file is a track, and gives it back with only what a track
 *  has. Null when it isn't one. `unbuilt` lets through one with no pipes yet, for building on. */
export function readTrack(found, { unbuilt = false } = {}) {
  if (!found || typeof found !== "object") return null;
  const pipes = Array.isArray(found.pipes) ? found.pipes.filter((pipe) => Array.isArray(pipe) && pipe.length === 2 && pipe.every(isPoint)) : [];
  if ((pipes.length === 0 && !unbuilt) || pipes.length !== (found.pipes?.length ?? 0)) return null;
  const lap = (Array.isArray(found.lap) ? found.lap : [])
    .map((move) => ({ move: String(move?.move ?? ""), by: Array.isArray(move?.by) ? move.by.filter(isPoint) : [] }))
    .filter((move) => move.by.length > 0);
  const start = isPoint(found.start?.at) ? { at: found.start.at, heading: isPoint(found.start.heading) ? found.start.heading : [0, 1, 0] } : null;
  const parts = (Array.isArray(found.parts) ? found.parts : [])
    .filter((part) => part && typeof part.name === "string" && Number.isFinite(part.sections))
    .map((part) => ({ name: part.name, sections: part.sections }));
  const video = typeof found.from?.video === "string" && /^https:\/\//.test(found.from.video) ? found.from.video : null;
  return {
    event: typeof found.event === "string" ? found.event : "",
    track: Number.isFinite(found.track) ? found.track : null,
    from: video ? { video } : null,
    parts, pipes, start, lap,
  };
}

/** The two corners of the box the pipes take up, and its middle. A track with no pipes yet is
 *  given one section's worth of room. */
export function extent(track) {
  const joints = track.pipes.length > 0 ? track.pipes.flat() : [[0, 0, 0], [1, 1, 1]];
  const low = [0, 1, 2].map((axis) => Math.min(...joints.map((joint) => joint[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...joints.map((joint) => joint[axis])));
  return { low, high, middle: low.map((value, axis) => (value + high[axis]) / 2) };
}

/** Every joint once. */
export function jointsOf(track) {
  return [...new Map(track.pipes.flat().map((joint) => [joint.join(","), joint])).values()];
}

/**
 * The lap as a smooth closed line through every point of every move, with how far round each
 * piece of it starts. Null for a track with no lap.
 */
export function lapLine(track, pieces = 16) {
  const through = track.lap.flatMap((move, index) => move.by.map((point) => ({ point, move: index })));
  if (through.length < 3) return null;
  const line = [];
  for (let index = 0; index < through.length; index += 1) {
    const at = (step) => through[(index + step + through.length) % through.length].point;
    const [a, b, c, d] = [at(-1), at(0), at(1), at(2)];
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = piece / pieces;
      // Catmull and Rom's curve from b to c, leaning on their neighbours.
      const point = [0, 1, 2].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - 3 * c[k] + d[k] - a[k]) * t * t * t));
      line.push({ point, move: through[index].move, from: 0 });
    }
  }
  let whole = 0;
  line.forEach((entry, index) => {
    entry.from = whole;
    const next = line[(index + 1) % line.length].point;
    whole += Math.hypot(next[0] - entry.point[0], next[1] - entry.point[1], next[2] - entry.point[2]);
  });
  /** Where the drone is a share of the way round, 0 to 1, and which move that is. */
  const placeAt = (share) => {
    const far = (((share % 1) + 1) % 1) * whole;
    let low = 0, high = line.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (line[mid].from <= far) low = mid;
      else high = mid - 1;
    }
    const here = line[low], next = line[(low + 1) % line.length];
    const span = (low === line.length - 1 ? whole : next.from) - here.from;
    const t = span ? (far - here.from) / span : 0;
    return { point: here.point.map((value, k) => value + (next.point[k] - value) * t), move: here.move };
  };
  /** The share of the way round at which each move begins. */
  const moveStarts = track.lap.map((_, index) => line.find((entry) => entry.move === index).from / whole);
  return { line, whole, placeAt, moveStarts };
}

/** The view a track opens in: a little to one side and above. */
export const homeView = { turn: 0.62, tilt: 0.36, far: 5.7 };

/** How far back the camera has to be for a track this big to fit. */
export function farFor(track) {
  const { low, high } = extent(track);
  const across = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
  // Track 1 is two sections by two by two, and was laid out by eye at 5.7.
  return Math.max(3.6, (5.7 * across) / Math.hypot(2, 2, 2));
}

/**
 * A camera that circles a point, looking at it. Gives a way of turning a place on the grid into a
 * place in a picture `width` by `height`: x and y, how far away it is, and how big one section
 * looks there. Null for a place behind the camera.
 */
export function camera({ turn, tilt, far, width, height }, middle) {
  const s = Math.sin(turn), c = Math.cos(turn), st = Math.sin(tilt), ct = Math.cos(tilt);
  const ahead = [s * ct, c * ct, -st], right = [c, -s, 0], up = [s * st, c * st, ct];
  const eye = middle.map((value, k) => value - ahead[k] * far);
  const zoom = (Math.min(height, width * 0.72) / 2) / Math.tan((19 * Math.PI) / 180);
  return (point) => {
    const d = point.map((value, k) => value - eye[k]);
    const depth = d[0] * ahead[0] + d[1] * ahead[1] + d[2] * ahead[2];
    if (depth < 0.2) return null;
    return {
      x: width / 2 + (zoom * (d[0] * right[0] + d[1] * right[1])) / depth,
      y: height * 0.54 - (zoom * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2])) / depth,
      depth, size: zoom / depth,
    };
  };
}

// ---- Building a track by hand.

/** How far out from where it starts a track can be built, in sections, and how high. */
export const reach = { out: 12, up: 6 };

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** One name for a pipe whichever end it is given from. */
export const pipeKey = (a, b) => [a, b].map((joint) => joint.join(",")).sort().join(" ");

/** The pipes with the one between two joints added, or taken away if it was there. */
export function togglePipe(pipes, a, b) {
  const key = pipeKey(a, b);
  const without = pipes.filter((pipe) => pipeKey(...pipe) !== key);
  // Kept low end first, so a file made by hand reads the same however it was clicked.
  return without.length < pipes.length ? without : [...pipes, [a, b].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2])];
}

/**
 * Where a section could go next: one step along the grid from any joint there is, and not
 * through the floor. With nothing built yet, the steps from where the first joint will be.
 */
export function openSteps(pipes) {
  const joints = pipes.length > 0 ? [...new Map(pipes.flat().map((joint) => [joint.join(","), joint])).values()] : [[0, 0, 0]];
  const taken = new Set(pipes.map((pipe) => pipeKey(...pipe)));
  const found = new Map();
  for (const joint of joints) {
    for (const [axis, by] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const to = joint.map((value, k) => (k === axis ? value + by : value));
      if (to[2] < 0 || to[2] > reach.up || Math.abs(to[0]) > reach.out || Math.abs(to[1]) > reach.out) continue;
      const key = pipeKey(joint, to);
      if (!taken.has(key) && !found.has(key)) found.set(key, [joint, to]);
    }
  }
  return [...found.values()];
}

/**
 * Which of some lengths between joints is under a place in the picture. `see` is a camera's way
 * of placing a joint. Gives the index of the nearest within `within` pixels, the one in front
 * when two are as near, or -1.
 */
export function edgeAt(edges, see, x, y, within = 9) {
  let best = -1, bestFar = Infinity, bestDepth = Infinity;
  edges.forEach(([a, b], index) => {
    const pa = see(a), pb = see(b);
    if (!pa || !pb) return;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, long = dx * dx + dy * dy;
    // Its ends are left to the joints, which several share: the middle of a section is its own.
    const t = long ? Math.max(0.12, Math.min(0.88, ((x - pa.x) * dx + (y - pa.y) * dy) / long)) : 0.5;
    const far = Math.hypot(x - (pa.x + dx * t), y - (pa.y + dy * t)), depth = pa.depth + (pb.depth - pa.depth) * t;
    if (far > within) return;
    if (far < bestFar - 2 || (Math.abs(far - bestFar) <= 2 && depth < bestDepth)) [best, bestFar, bestDepth] = [index, far, depth];
  });
  return best;
}

/** A number brought to the nearest step, a quarter of a section unless told otherwise. */
export const snap = (value, step = 0.25) => Math.round(value / step) * step;

/** A lap as one list of points, each with the name of the move it starts, or null when it carries
 *  on the move before. */
export function lapPoints(lap) {
  return lap.flatMap((move) => move.by.map((at, index) => ({ at: [...at], name: index === 0 ? move.move : null })));
}

/** The lap a list of points makes: a new move wherever a point starts one. */
export function lapFrom(points) {
  const lap = [];
  for (const point of points) {
    if (lap.length === 0 || point.name !== null) lap.push({ move: point.name ?? "", by: [] });
    lap.at(-1).by.push([...point.at]);
  }
  return lap;
}

/** Where the start gate is and which way it is flown, when it is at one of the lap's points: the
 *  way is the grid direction nearest to the line through that point. */
export function startAt(points, index) {
  if (index < 0 || index >= points.length) return null;
  const at = points[index].at, before = points[(index - 1 + points.length) % points.length].at, after = points[(index + 1) % points.length].at;
  const along = [after[0] - before[0], after[1] - before[1]];
  const heading = Math.abs(along[0]) > Math.abs(along[1]) ? [Math.sign(along[0]) || 1, 0, 0] : [0, Math.sign(along[1]) || 1, 0];
  return { at: [...at], heading };
}

/** Which of the lap's points the start gate is at, or -1. */
export function startIndex(points, start) {
  return start ? points.findIndex((point) => same(point.at, start.at)) : -1;
}
