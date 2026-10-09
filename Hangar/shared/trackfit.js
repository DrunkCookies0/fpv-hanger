// Finding a RaceGOW track in a picture of it.
//
// A RaceGOW track is PVC sections of one length joined at fittings. So every section runs along one
// of three directions at right angles, and every joint sits on a grid whose step is one section.
// That turns "what is in this picture" into two smaller questions: where is the camera against that
// grid, and which steps of the grid have a pipe along them. Both are answered here, from two
// black and white pictures of the same view: where the picture got brighter once the track was
// built (`changed`), and where it shows something thin and white (`thin`).
//
// Which steps have a pipe is the sure part: given the camera, it has found every pipe of the one
// track tried so far. Where the camera is, with no help, is not sure yet. A camera facing a track
// sees little of its depth, pipes lean and sag, and a long lens far off looks much like a plain
// one close by; on that track the search got the front and one side and missed the far corner.
// From six joints pointed out by hand (`cameraFromJoints`) it is right.
//
// Grid directions: x to the right as the camera sees it, y away from the camera, z up. Pixels have
// y down. Nothing here needs Node: it works on plain arrays.

// ---------------------------------------------------------------------------------------------
// Pictures

/** Brightness of every pixel of an RGBA picture, 0 to 255. */
export function brightness(data, count) {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  return out;
}

function slide(values, width, height, reach, pick) {
  const across = new Float32Array(values.length), out = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let best = values[y * width + x];
    for (let d = Math.max(0, x - reach); d <= Math.min(width - 1, x + reach); d += 1) best = pick(best, values[y * width + d]);
    across[y * width + x] = best;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let best = across[y * width + x];
    for (let d = Math.max(0, y - reach); d <= Math.min(height - 1, y + reach); d += 1) best = pick(best, across[d * width + x]);
    out[y * width + x] = best;
  }
  return out;
}

/** Where a picture shows something thin, bright and colourless, which is what a white pipe is.
 *  `reach` has to be more than a pipe is wide, in pixels: anything bright that is wider is left out. */
export function thinBright(data, width, height, { reach = 8, rise = 32, grey = 0.3, least = 105 } = {}) {
  const count = width * height, light = brightness(data, count);
  const without = slide(slide(light, width, height, reach, Math.min), width, height, reach, Math.max);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const most = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const fewest = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const colour = most ? (most - fewest) / most : 0;
    if (light[i] - without[i] > rise && colour < grey && light[i] > least) out[i] = 1;
  }
  return out;
}

/** How far every pixel is from the nearest marked one, in pixels (near enough: 3-4 chamfer). */
export function distances(mask, width, height) {
  const far = 1e6, out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = mask[i] ? 0 : far;
  const lower = (i, other, step) => { if (out[other] + step < out[i]) out[i] = out[other] + step; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    if (x) lower(i, i - 1, 3);
    if (y) { lower(i, i - width, 3); if (x) lower(i, i - width - 1, 4); if (x < width - 1) lower(i, i - width + 1, 4); }
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const i = y * width + x;
    if (x < width - 1) lower(i, i + 1, 3);
    if (y < height - 1) { lower(i, i + width, 3); if (x < width - 1) lower(i, i + width + 1, 4); if (x) lower(i, i + width - 1, 4); }
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= 3;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Straight strokes

/** The straight strokes in a black and white picture, longest evidence first: `{ x1, y1, x2, y2 }`,
 *  each along the middle of its stroke. A stroke may have breaks up to `gap` long (a pipe's tape,
 *  another pipe across it) and still be one. */
export function strokes(mask, width, height, { shortest = 45, gap = 30, rounds = 90 } = {}) {
  const xs = [], ys = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (mask[y * width + x]) { xs.push(x); ys.push(y); }
  const count = xs.length, alive = new Uint8Array(count).fill(1);
  const turns = 360, cos = new Float64Array(turns), sin = new Float64Array(turns);
  for (let k = 0; k < turns; k += 1) { cos[k] = Math.cos((k * Math.PI) / turns); sin[k] = Math.sin((k * Math.PI) / turns); }
  const reach = Math.hypot(width, height), step = 1.5, bins = Math.ceil((2 * reach) / step) + 1;
  const votes = new Int32Array(turns * bins), found = [];

  for (let round = 0; round < rounds; round += 1) {
    votes.fill(0);
    for (let i = 0; i < count; i += 1) {
      if (!alive[i]) continue;
      const x = xs[i], y = ys[i];
      for (let k = 0; k < turns; k += 1) votes[k * bins + (((x * cos[k] + y * sin[k] + reach) / step) | 0)] += 1;
    }
    let top = 0, at = 0;
    for (let i = 0; i < votes.length; i += 1) if (votes[i] > top) { top = votes[i]; at = i; }
    if (top < shortest * 0.6) break;
    const k = Math.floor(at / bins), offset = ((at % bins) + 0.5) * step - reach;

    // The points near that line, and the longest unbroken run of them along it.
    let line = { nx: cos[k], ny: sin[k], offset };
    let run = longestRun(line, 4, null);
    if (!run) break;
    // The line through the middle of that run, then the run again along the better line.
    line = throughMiddle(run.members);
    run = longestRun(line, 5, [run.from - gap, run.to + gap]) ?? run;
    line = throughMiddle(run.members);
    const tx = -line.ny, ty = line.nx;
    let from = Infinity, to = -Infinity;
    for (const i of run.members) { const t = xs[i] * tx + ys[i] * ty; if (t < from) from = t; if (t > to) to = t; }
    if (to - from >= shortest) {
      const px = line.nx * line.offset, py = line.ny * line.offset;
      found.push({ x1: px + tx * from, y1: py + ty * from, x2: px + tx * to, y2: py + ty * to, weight: run.members.length });
    }
    for (let i = 0; i < count; i += 1) {
      if (!alive[i]) continue;
      const t = xs[i] * tx + ys[i] * ty;
      if (t >= from - 5 && t <= to + 5 && Math.abs(xs[i] * line.nx + ys[i] * line.ny - line.offset) <= 8) alive[i] = 0;
    }

    function longestRun(along, band, within) {
      const dx = -along.ny, dy = along.nx, near = [];
      for (let i = 0; i < count; i += 1) {
        if (!alive[i]) continue;
        if (Math.abs(xs[i] * along.nx + ys[i] * along.ny - along.offset) > band) continue;
        const t = xs[i] * dx + ys[i] * dy;
        if (within && (t < within[0] || t > within[1])) continue;
        near.push([t, i]);
      }
      if (near.length < 2) return null;
      near.sort((a, b) => a[0] - b[0]);
      let best = null, start = 0;
      for (let i = 1; i <= near.length; i += 1) {
        if (i < near.length && near[i][0] - near[i - 1][0] <= gap) continue;
        const length = near[i - 1][0] - near[start][0];
        if (!best || length > best.to - best.from) best = { from: near[start][0], to: near[i - 1][0], members: near.slice(start, i).map((pair) => pair[1]) };
        start = i;
      }
      return best;
    }
    function throughMiddle(members) {
      let mx = 0, my = 0;
      for (const i of members) { mx += xs[i]; my += ys[i]; }
      mx /= members.length; my /= members.length;
      let xx = 0, xy = 0, yy = 0;
      for (const i of members) { const dx = xs[i] - mx, dy = ys[i] - my; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      return { nx, ny, offset: mx * nx + my * ny };
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// A little arithmetic on threes

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

// ---------------------------------------------------------------------------------------------
// The camera

/** A camera against the grid. `axes` are the grid's x, y and z as the camera sees them (its own x
 *  to the right, y down, z forward); `eye` is where the camera is, in grid steps. `tall` is how
 *  much taller than wide a pixel shows things: a video's layout often squeezes the camera's picture
 *  a little one way, and a pipe standing up then measures shorter than the same pipe lying across. */
export class Camera {
  constructor({ focal, tall = 1, centre, axes, eye }) { Object.assign(this, { focal, tall, centre, axes, eye }); }

  /** The pixel a grid point falls on, or null when it is behind the camera. */
  pixel(point) {
    const from = sub(point, this.eye), [ax, ay, az] = this.axes;
    const x = ax[0] * from[0] + ay[0] * from[1] + az[0] * from[2];
    const y = ax[1] * from[0] + ay[1] * from[1] + az[1] * from[2];
    const z = ax[2] * from[0] + ay[2] * from[1] + az[2] * from[2];
    if (z < 0.05) return null;
    return [this.centre[0] + (this.focal * x) / z, this.centre[1] + (this.focal * this.tall * y) / z];
  }

  /** Which way a pixel looks, in the grid's directions. */
  ray([px, py]) {
    const seen = [(px - this.centre[0]) / this.focal, (py - this.centre[1]) / (this.focal * this.tall), 1];
    return this.axes.map((axis) => dot(axis, seen));
  }

  /** The same camera moved a little: `by` is eight numbers (zoom, three of turning, three of place,
   *  and how tall a pixel shows things). */
  nudged(by) {
    const turn = [by[1], by[2], by[3]], angle = Math.hypot(...turn);
    let axes = this.axes;
    if (angle > 1e-12) {
      const k = scale(turn, 1 / angle), c = Math.cos(angle), s = Math.sin(angle);
      axes = axes.map((v) => add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c))));
    }
    return new Camera({ focal: this.focal * Math.exp(by[0]), tall: this.tall * Math.exp(by[7]), centre: this.centre, axes, eye: add(this.eye, [by[4], by[5], by[6]]) });
  }
}

/** Where the pipes running away from the camera might be heading: pixels to try as the point they
 *  all aim at, which is also where the camera's eye level crosses the picture. Pipes running away
 *  from a camera that faces the track are the shortest in the picture and say little about it, so
 *  this is a plain spread across the upper middle of the picture, close enough together that one
 *  of them is within a few pixels of the truth. */
export function headings(width, height, every = 0.015) {
  const out = [], cx = width / 2, cy = height / 2;
  for (let across = -0.3; across <= 0.3001; across += every) for (let above = -0.06; above <= 0.5001; above += every) out.push([cx + across * width, cy - above * width]);
  return out;
}

/** The strokes that stand up, with the breaks in them mended: a leg's band of tape, or a bar
 *  crossing in front of it, cuts its stroke in two. Each is `{ x1, y1, x2, y2 }`, foot first. */
export function standing(found, { lean = 25, apart = 6, gap = 60 } = {}) {
  let list = found
    .filter((s) => Math.abs(s.x2 - s.x1) < Math.abs(s.y2 - s.y1) * Math.tan((lean * Math.PI) / 180))
    .map((s) => (s.y1 >= s.y2 ? { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 } : { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 }));
  const off = (s, x, y) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1; return Math.abs((x - s.x1) * dy - (y - s.y1) * dx) / Math.hypot(dx, dy); };
  for (let mended = true; mended;) {
    mended = false;
    for (let i = 0; i < list.length && !mended; i += 1) for (let j = i + 1; j < list.length && !mended; j += 1) {
      const a = list[i], b = list[j];
      const inLine = Math.max(off(a, b.x1, b.y1), off(a, b.x2, b.y2), off(b, a.x1, a.y1), off(b, a.x2, a.y2)) <= apart;
      const between = Math.max(a.y2, b.y2) - Math.min(a.y1, b.y1);
      if (!inLine || between > gap) continue;
      const foot = a.y1 >= b.y1 ? a : b, top = a.y2 <= b.y2 ? a : b;
      list = list.filter((s) => s !== a && s !== b).concat({ x1: foot.x1, y1: foot.y1, x2: top.x2, y2: top.y2 });
      mended = true;
    }
  }
  return list;
}

/** Cameras worth a closer look, from the legs alone. A leg stands on the floor, so under any guess
 *  at the camera the pixel at its foot says where on the floor it stands and the pixel at its top
 *  says how tall it is. Taking one leg as one or two steps tall fixes the size of a step; the guess
 *  is as good as the number of other legs that then stand on whole steps and are whole steps tall.
 *  It is quick enough to try every heading, zoom and leg. */
export function camerasFromLegs(legs, width, height, { zooms, talls = [0.92, 1, 1.08], within = 0.2 } = {}) {
  const centre = [width / 2, height / 2], out = [];
  const whole = (v) => Math.abs(v - Math.round(v));
  for (const heading of headings(width, height)) for (const zoom of zooms) for (const tall of talls) {
    const axes = axesToward(heading, zoom * width, tall, centre), base = new Camera({ focal: zoom * width, tall, centre, axes, eye: [0, 0, 0] });
    const rays = legs.map((leg) => [base.ray([leg.x1, leg.y1]), base.ray([leg.x2, leg.y2])]);
    for (let seed = 0; seed < legs.length; seed += 1) for (const count of [1, 2]) {
      const camera = cameraFromStroke(legs[seed], 2, count, axes, zoom * width, tall, centre);
      if (!camera || camera.eye[2] <= 0) continue;
      let agree = 0, miss = 0;
      for (let i = 0; i < legs.length; i += 1) {
        if (i === seed) continue;
        const [foot, top] = rays[i];
        if (foot[2] >= -1e-6) continue;
        const reach = -camera.eye[2] / foot[2], x = camera.eye[0] + reach * foot[0], y = camera.eye[1] + reach * foot[1];
        const up = ((x - camera.eye[0]) * top[0] + (y - camera.eye[1]) * top[1]) / (top[0] * top[0] + top[1] * top[1]);
        const tallness = camera.eye[2] + up * top[2];
        if (whole(x) > within || whole(y) > within || whole(tallness) > within || Math.round(tallness) < 1 || Math.round(tallness) > 3) continue;
        agree += Math.hypot(legs[i].x2 - legs[i].x1, legs[i].y2 - legs[i].y1);
        miss += whole(x) ** 2 + whole(y) ** 2 + whole(tallness) ** 2;
      }
      if (agree > 0) out.push({ camera, agree, miss });
    }
  }
  return out.sort((a, b) => b.agree - a.agree || a.miss - b.miss);
}

/** The grid's three directions as a level camera sees them, when pipes running away from it head
 *  for the pixel `heading`. Level because a camera on a tripod is, near enough; `settle` finds
 *  the rest. */
export function axesToward(heading, focal, tall, centre) {
  const y = unit([(heading[0] - centre[0]) / focal, (heading[1] - centre[1]) / (focal * tall), 1]);
  const z = unit([0, -y[2], y[1]]);
  return [cross(y, z), y, z];
}

/** The camera for which one stroke is `count` grid steps along `axis`, starting from grid point 0.
 *  Null when no such camera looks at it from in front. */
export function cameraFromStroke(stroke, axis, count, axes, focal, tall, centre) {
  const base = new Camera({ focal, tall, centre, axes, eye: [0, 0, 0] });
  for (const [a, b] of [[[stroke.x1, stroke.y1], [stroke.x2, stroke.y2]], [[stroke.x2, stroke.y2], [stroke.x1, stroke.y1]]]) {
    // far * ray(b) - near * ray(a) = count along the axis: two unknowns, three sums, least squares.
    const ra = base.ray(a), rb = base.ray(b), want = [0, 0, 0];
    want[axis] = count;
    const aa = dot(ra, ra), ab = -dot(ra, rb), bb = dot(rb, rb), ya = -dot(ra, want), yb = dot(rb, want);
    const bottom = aa * bb - ab * ab;
    if (Math.abs(bottom) < 1e-12) continue;
    const near = (ya * bb - ab * yb) / bottom, far = (aa * yb - ab * ya) / bottom;
    if (near <= 0 || far <= 0) continue;
    return new Camera({ focal, tall, centre, axes, eye: scale(ra, -near) });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Which steps of the grid have a pipe

/** Every step of the grid within `span` of grid point 0 that the camera sees whole and at a length
 *  least `least` pixels long: `{ a, b, axis, pa, pb, length }`, the last three in pixels. */
export function stepsSeen(camera, width, height, span, least = 24) {
  const side = 2 * span + 1, px = new Float64Array(side * side * side), py = new Float64Array(side * side * side);
  const index = (i, j, k) => ((i + span) * side + (j + span)) * side + (k + span);
  for (let i = -span; i <= span; i += 1) for (let j = -span; j <= span; j += 1) for (let k = -span; k <= span; k += 1) {
    const p = camera.pixel([i, j, k]), at = index(i, j, k);
    const inside = p && p[0] >= 0 && p[1] >= 0 && p[0] <= width - 1 && p[1] <= height - 1;
    px[at] = inside ? p[0] : NaN; py[at] = inside ? p[1] : NaN;
  }
  const out = [];
  for (let i = -span; i <= span; i += 1) for (let j = -span; j <= span; j += 1) for (let k = -span; k <= span; k += 1) {
    const from = index(i, j, k);
    if (Number.isNaN(px[from])) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      const b = [i, j, k];
      b[axis] += 1;
      if (b[axis] > span) continue;
      const to = index(b[0], b[1], b[2]);
      if (Number.isNaN(px[to])) continue;
      const length = Math.hypot(px[to] - px[from], py[to] - py[from]);
      if (length >= least) out.push({ a: [i, j, k], b, axis, pa: [px[from], py[from]], pb: [px[to], py[to]], length });
    }
  }
  return out;
}

/** The share of a step's length that passes `test`, looked at every `every` pixels and leaving
 *  out the joints at its ends. With `least`, gives up early on a step that plainly won't reach it. */
function share(step, test, { every = 2, ends = 0.08, least = 0 } = {}) {
  const count = Math.max(5, Math.round(step.length / every)), wx = (step.pb[0] - step.pa[0]) / step.length, wy = (step.pb[1] - step.pa[1]) / step.length;
  let hits = 0;
  for (let n = 0; n < count; n += 1) {
    const t = (ends + ((1 - 2 * ends) * (n + 0.5)) / count) * step.length;
    if (test(Math.round(step.pa[0] + wx * t), Math.round(step.pa[1] + wy * t), wx, wy)) hits += 1;
    else if (n + 1 - hits > count * (1 - least)) return 0;
  }
  return hits / count;
}

/** A picture saying, for every pixel on or beside a stroke, which stroke and how far along it. */
export function ownership(found, width, height, { reach = 5, piece = 4 } = {}) {
  const owner = new Int32Array(width * height).fill(-1);
  found.forEach((s, index) => {
    const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    for (let n = 0; n <= length; n += 1) {
      const x = s.x1 + ((s.x2 - s.x1) * n) / length, y = s.y1 + ((s.y2 - s.y1) * n) / length;
      for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) {
        const qx = Math.round(x + dx), qy = Math.round(y + dy);
        if (qx < 0 || qy < 0 || qx >= width || qy >= height || dx * dx + dy * dy > reach * reach) continue;
        if (owner[qy * width + qx] < 0) owner[qy * width + qx] = index * 4096 + Math.floor(n / piece);
      }
    }
  });
  const ways = found.map((s) => { const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); return [(s.x2 - s.x1) / length, (s.y2 - s.y1) / length]; });
  return { owner, ways, piece, seen: new Int32Array(found.length * 4096), round: 0 };
}

/** How well a camera explains the strokes. `explained` is the length of stroke that whole steps
 *  of the grid lie along, in pixels, a stretch counting once however many steps lie over it.
 *  `used` is how many steps it took (`along` is those steps), not counting a step that only lies
 *  over what another already explained, and `bare` is how many times two steps meet in a line with
 *  nothing else joining.
 *  `total` is the first less a small charge for each step and a large one for each bare meeting,
 *  so that of the grids that explain the same pipe the track's own comes first. `slack` is how
 *  near counts as along: pixels, and a share of the step's length, since pipes sag and lean by a
 *  few hundredths of their length. `whole` is how much of a step has to have pipe along it. */
export function worth(camera, field, owned, width, height, slack, { every = 2, whole = 0.7 } = {}) {
  owned.round += 1;
  let pieces = 0;
  const taken = [], used = [], joints = new Map();
  // Short steps are looked along too. A camera with a long lens far away sees nearly what a plain
  // one sees close by, with the track twice as deep, and what gives it away is that the pipes
  // running away from it then take a string of short steps each.
  for (const step of stepsSeen(camera, width, height, 4, 9)) {
    const near = slack[0] + slack[1] * step.length;
    if (share(step, (x, y) => field[y * width + x] <= near, { every: Math.min(every, step.length / 6), least: whole }) < whole) continue;
    taken.push(step);
    for (const end of [step.a, step.b]) {
      const at = end.join(",");
      if (!joints.has(at)) joints.set(at, []);
      joints.get(at).push(step.axis);
    }
    const wx = (step.pb[0] - step.pa[0]) / step.length, wy = (step.pb[1] - step.pa[1]) / step.length;
    let fresh = 0;
    for (let n = 0; n <= step.length; n += 2) {
      const at = owned.owner[Math.round(step.pa[1] + wy * n) * width + Math.round(step.pa[0] + wx * n)];
      if (!(at >= 0) || owned.seen[at] === owned.round) continue;
      const way = owned.ways[Math.floor(at / 4096)];
      if (Math.abs(way[0] * wx + way[1] * wy) > 0.99) { owned.seen[at] = owned.round; fresh += 1; }
    }
    pieces += fresh;
    if (fresh * owned.piece >= 0.3 * step.length) used.push(step);
  }
  // Two sections in a line meet at a fitting, and a fitting is there because something else joins
  // on. A grid that keeps needing two steps in a line with nothing joining where they meet is
  // cutting pipes in pieces: its step is too short, or it isn't this track's grid at all.
  let bare = 0;
  for (const axes of joints.values()) if (axes.length === 2 && axes[0] === axes[1]) bare += 1;
  const explained = pieces * owned.piece;
  return { explained, used: used.length, bare, total: explained - 12 * used.length - 70 * bare, taken, along: used };
}

/** Moves a camera until the grid steps in `taken` lie along the middles of the strokes. */
export function settle(camera, taken, middle, width, height, limit) {
  const cost = (by) => {
    const moved = camera.nudged(by);
    // A pixel a fifth off square, or a zoom half as much again, is the fit running away.
    if (Math.abs(Math.log(moved.tall)) > 0.18 || Math.abs(by[0]) > 0.4) return 1e9;
    let sum = 0, count = 0;
    for (const { a, b } of taken) {
      const pa = moved.pixel(a), pb = moved.pixel(b);
      for (let n = 0; n <= 12; n += 1) {
        count += 1;
        if (!pa || !pb) { sum += limit * limit; continue; }
        const x = Math.round(pa[0] + ((pb[0] - pa[0]) * n) / 12), y = Math.round(pa[1] + ((pb[1] - pa[1]) * n) / 12);
        const d = x < 0 || y < 0 || x >= width || y >= height ? limit : Math.min(limit, middle[y * width + x]);
        sum += d * d;
      }
    }
    return sum / Math.max(1, count);
  };
  return camera.nudged(downhill(cost, [0, 0, 0, 0, 0, 0, 0, 0], [0.06, 0.008, 0.008, 0.008, 0.04, 0.04, 0.04, 0.03], 1200));
}

/** Nelder and Mead's way downhill: no slopes needed. */
export function downhill(cost, start, spread, rounds) {
  const n = start.length;
  let points = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + spread[j] : v)))].map((p) => ({ p, c: cost(p) }));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let round = 0; round < rounds; round += 1) {
    points.sort((a, b) => a.c - b.c);
    const worst = points[n], centre = start.map((_, i) => points.slice(0, n).reduce((sum, q) => sum + q.p[i], 0) / n);
    const over = mix(worst.p, centre, 2), overCost = cost(over);
    if (overCost < points[0].c) {
      const further = mix(worst.p, centre, 3), furtherCost = cost(further);
      points[n] = furtherCost < overCost ? { p: further, c: furtherCost } : { p: over, c: overCost };
    } else if (overCost < points[n - 1].c) points[n] = { p: over, c: overCost };
    else {
      const back = mix(worst.p, centre, 0.5), backCost = cost(back);
      if (backCost < worst.c) points[n] = { p: back, c: backCost };
      else points = points.map((q, i) => (i === 0 ? q : (() => { const p = mix(points[0].p, q.p, 0.5); return { p, c: cost(p) }; })()));
    }
  }
  points.sort((a, b) => a.c - b.c);
  return points[0].p;
}

/** The camera that puts a handful of joints where someone pointed at them: `pairs` is a list of
 *  `{ at: [x, y, z], pixel: [u, v] }`, the joint on the grid and where it is in the picture. Six or
 *  more, not all at one depth. Returns the camera and how far off it leaves them, in pixels. */
export function cameraFromJoints(pairs, width, height) {
  const off = (camera) => Math.sqrt(pairs.reduce((sum, { at, pixel }) => {
    const p = camera.pixel(at);
    return sum + (p ? (p[0] - pixel[0]) ** 2 + (p[1] - pixel[1]) ** 2 : 1e7);
  }, 0) / pairs.length);
  const middle = [0, 1, 2].map((axis) => pairs.reduce((sum, pair) => sum + pair.at[axis], 0) / pairs.length);
  const across = Math.max(...pairs.map((pair) => pair.at[0])) - Math.min(...pairs.map((pair) => pair.at[0])) || 1;
  const shown = Math.max(...pairs.map((pair) => pair.pixel[0])) - Math.min(...pairs.map((pair) => pair.pixel[0])) || width / 4;
  let best = null;
  // A camera looking at the track from in front, a little down on it, at a few zooms: then downhill.
  for (const zoom of [0.6, 0.9, 1.3, 1.9]) for (const down of [4, 12, 22]) {
    const tilt = (down * Math.PI) / 180, far = (zoom * width * across) / shown;
    let camera = new Camera({
      focal: zoom * width, centre: [width / 2, height / 2],
      axes: [[1, 0, 0], [0, -Math.sin(tilt), Math.cos(tilt)], [0, -Math.cos(tilt), -Math.sin(tilt)]],
      eye: [middle[0], middle[1] - far * Math.cos(tilt), middle[2] + far * Math.sin(tilt)],
    });
    for (let round = 0; round < 4; round += 1) {
      const from = camera;
      camera = from.nudged(downhill((by) => {
        const moved = from.nudged(by);
        return Math.abs(Math.log(moved.tall)) > 0.18 ? 1e9 : off(moved);
      }, [0, 0, 0, 0, 0, 0, 0, 0], [0.05, 0.01, 0.01, 0.01, 0.1, 0.1, 0.1, 0.03], 2500));
    }
    if (!best || off(camera) < best.off) best = { camera, off: off(camera) };
  }
  return best;
}

/** Pipes that share a joint, gathered into the pieces they make. */
function pieces(pipes) {
  const key = (p) => p.join(","), groups = [];
  for (const pipe of pipes) {
    const touching = groups.filter((group) => group.joints.has(key(pipe.a)) || group.joints.has(key(pipe.b)));
    const into = touching[0] ?? { pipes: [], joints: new Set() };
    if (!touching.length) groups.push(into);
    for (const other of touching.slice(1)) {
      into.pipes.push(...other.pipes);
      for (const joint of other.joints) into.joints.add(joint);
      groups.splice(groups.indexOf(other), 1);
    }
    into.pipes.push(pipe);
    into.joints.add(key(pipe.a)); into.joints.add(key(pipe.b));
  }
  const size = (group) => group.pipes.reduce((sum, pipe) => sum + pipe.length, 0);
  return groups.sort((a, b) => size(b) - size(a));
}

/** Finds the track.
 *
 *  `changed` and `thin` are black and white pictures of one view, a byte a pixel. Returns the
 *  camera, the pipes as pairs of grid points with the floor at z = 0, and what each was told by.
 *  `near` is a camera to start from in place of searching: last week's, if the tripod stays put.
 *
 *  Several ways of seeing the picture are tried, and the one believed most is given. The rest come
 *  back too, as `readings`, one for each number of pipes found: a camera that has the depth of the
 *  room a little wrong finds the front of the track and misses the back, and is sometimes believed
 *  a little more than the right one. `sections` is how many pipes the track is known to have, when
 *  that is known (the video's parts list says): a reading with that many is then taken first. */
export function findTrack({ changed, thin, width, height }, { log = () => {}, near = null, sections = null } = {}) {
  const sure = new Uint8Array(width * height);
  for (let i = 0; i < sure.length; i += 1) sure[i] = changed[i] && thin[i] ? 1 : 0;
  const found = strokes(sure, width, height, { shortest: 32 });
  log(`${found.length} straight strokes`);

  // The middles of the strokes, as a picture, for lining the grid up on.
  const middles = new Uint8Array(width * height);
  for (const s of found) {
    const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    for (let n = 0; n <= length; n += 1) middles[Math.round(s.y1 + ((s.y2 - s.y1) * n) / length) * width + Math.round(s.x1 + ((s.x2 - s.x1) * n) / length)] = 1;
  }
  const toSure = distances(sure, width, height), toMiddle = distances(middles, width, height), toThin = distances(thin, width, height);
  const owned = ownership(found, width, height);

  // First the legs alone say which cameras are worth a closer look; then each of those is scored on
  // every stroke, settled, and scored again.
  const tries = [];
  if (near) tries.push({ camera: new Camera(near), ...worth(new Camera(near), toSure, owned, width, height, [5, 0.03]) });
  else {
    const legs = standing(found);
    if (legs.length < 3) throw new Error("Too few pipes standing up in the picture to place the camera by.");
    const guesses = camerasFromLegs(legs, width, height, { zooms: [0.6, 0.68, 0.76, 0.85, 0.95, 1.06, 1.2, 1.35, 1.5, 1.7, 1.9, 2.15] });
    log(`${legs.length} legs, ${guesses.length} cameras they could agree on; the best has ${guesses[0]?.agree.toFixed(0)} px of leg standing on the grid`);
    // The legs agree on a great many cameras, and loose parts and leaning poles mean the right one
    // is seldom their favourite. So a good share of them go on to be scored on every stroke.
    for (const guess of guesses.slice(0, 20000)) tries.push({ camera: guess.camera, ...worth(guess.camera, toSure, owned, width, height, [5, 0.03], { every: 4 }) });
  }
  tries.sort((a, b) => b.total - a.total);
  // Settling follows only the steps that explain pipe of their own, and a move that explains less
  // than where it started from is not kept.
  const strictly = (camera) => ({ camera, ...worth(camera, toSure, owned, width, height, [3, 0.03]) });
  const tidy = (start) => {
    let now = { camera: start.camera, ...worth(start.camera, toSure, owned, width, height, [7, 0.04]) }, kept = strictly(start.camera);
    for (const [limit, slack] of [[16, [7, 0.04]], [12, [5, 0.03]], [10, [4, 0.03]], [8, [3, 0.03]], [8, [3, 0.03]]]) {
      const follow = now.along.filter((step) => step.length >= 24);
      if (follow.length < 3) break;
      const camera = settle(now.camera, follow, toMiddle, width, height, limit);
      now = { camera, ...worth(camera, toSure, owned, width, height, slack) };
      const strict = strictly(camera);
      if (strict.total > kept.total) kept = strict;
    }
    return kept;
  };

  // What a camera makes of the picture: every step of the grid, is there a pipe along it? The
  // longest stretch of pipe is taken first and keeps the pixels it lies on, so a step behind it, or
  // one that runs away from the camera straight up the picture over it, can't be told by the same
  // pipe twice.
  const agrees = (x, y, wx, wy) => {
    const at = owned.owner[y * width + x];
    if (!(at >= 0)) return true;
    const way = owned.ways[Math.floor(at / 4096)];
    return Math.abs(way[0] * wx + way[1] * wy) > 0.97;
  };
  const key = (p) => p.join(",");
  const trackSeenBy = (camera) => {
    // Which pipe has taken each pixel, if any. Round a joint, the pipes that meet there share the
    // fitting, so a pipe doesn't lose those pixels to one it joins on to, nor mind there that the
    // other's stroke runs a different way: a short pipe is mostly fitting.
    const claimed = new Int16Array(width * height).fill(-1), ends = [], fitting = 14;
    const by = (p, x, y) => Math.hypot(x - p[0], y - p[1]) <= fitting;
    const free = (step, x, y) => {
      const taker = claimed[y * width + x];
      if (taker < 0) return true;
      return (ends[taker].has(key(step.a)) && by(step.pa, x, y)) || (ends[taker].has(key(step.b)) && by(step.pb, x, y));
    };
    const all = stepsSeen(camera, width, height, 5).map((step) => {
      const close = 3 + 0.03 * step.length;
      const bySure = () => share(step, (x, y, wx, wy) => toSure[y * width + x] <= close && free(step, x, y) && (by(step.pa, x, y) || by(step.pb, x, y) || agrees(x, y, wx, wy)));
      return { ...step, close, bySure, changed: bySure(), thin: 0 };
    });
    let pipes = [];
    for (let open = all.filter((step) => step.changed >= 0.6); open.length;) {
      open.sort((a, b) => b.changed * b.length - a.changed * a.length);
      const pipe = open.shift();
      pipes.push({ ...pipe, told: "changed" });
      ends.push(new Set([key(pipe.a), key(pipe.b)]));
      const reach = Math.ceil(pipe.close + 3), wx = (pipe.pb[0] - pipe.pa[0]) / pipe.length, wy = (pipe.pb[1] - pipe.pa[1]) / pipe.length;
      for (let n = 0; n <= pipe.length; n += 1) for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) {
        const x = Math.round(pipe.pa[0] + wx * n + dx), y = Math.round(pipe.pa[1] + wy * n + dy);
        if (x >= 0 && y >= 0 && x < width && y < height && claimed[y * width + x] < 0) claimed[y * width + x] = ends.length - 1;
      }
      for (const step of open) step.changed = step.bySure();
      open = open.filter((step) => step.changed >= 0.6);
    }
    if (!pipes.length) return null;
    // How squarely each lies on its stroke: 1 along the middle, down to nothing 7 pixels off it.
    for (const pipe of pipes) {
      let sum = 0, count = 0;
      for (let n = 0; n <= 16; n += 1) {
        const x = Math.round(pipe.pa[0] + ((pipe.pb[0] - pipe.pa[0]) * (n + 1)) / 18), y = Math.round(pipe.pa[1] + ((pipe.pb[1] - pipe.pa[1]) * (n + 1)) / 18);
        sum += Math.min(14, toMiddle[y * width + x]); count += 1;
      }
      pipe.square = Math.max(0, 1 - (sum / count / 7) ** 2);
    }
    // Thin white lines count only where no pipe has been found already: a step that runs away from
    // the camera up the picture lies over the legs standing in front of it.
    for (const step of all) step.thin = share(step, (x, y) => toThin[y * width + x] <= step.close && free(step, x, y));
    // A pipe lying where a loose one lay before the build changes nothing in the picture, and the
    // parts are laid out on the floor. So along the floor, a thin white line on a grid step counts
    // as a pipe when it joins on to what is already there and is white nearly all the way along.
    // (A mat's edge is a thin pale line along the floor too, which is why it has to be nearly all.)
    const floor = Math.min(...pieces(pipes)[0].pipes.flatMap((pipe) => [pipe.a[2], pipe.b[2]]));
    for (let grew = true; grew;) {
      grew = false;
      const joints = new Set(pipes.flatMap((pipe) => [key(pipe.a), key(pipe.b)]));
      for (const step of all) {
        if (step.axis === 2 || step.a[2] !== floor) continue;
        if (pipes.some((pipe) => key(pipe.a) === key(step.a) && pipe.axis === step.axis)) continue;
        const joined = (joints.has(key(step.a)) ? 1 : 0) + (joints.has(key(step.b)) ? 1 : 0);
        if (joined && step.thin >= 0.9) { pipes.push({ ...step, told: "thin" }); grew = true; }
      }
    }
    // A track is one piece. Anything else that lined up with the grid is something in the room.
    const [track, ...rest] = pieces(pipes);
    // How much to believe it: the length of pipe the one piece accounts for by what changed in the
    // picture, counted for less the further off its stroke a pipe lies, less the same charges as
    // before. A camera that sees the pipes as scattered bits has little in its biggest piece,
    // however much it explains in all, and one that has the depth wrong lies a little off
    // everything behind the front gate.
    const meeting = new Map();
    for (const pipe of track.pipes) for (const end of [pipe.a, pipe.b]) meeting.set(key(end), [...(meeting.get(key(end)) ?? []), pipe.axis]);
    const bare = [...meeting.values()].filter((axes) => axes.length === 2 && axes[0] === axes[1]).length;
    const seen = track.pipes.filter((pipe) => pipe.told === "changed");
    const believed = seen.reduce((sum, pipe) => sum + pipe.length * pipe.changed * pipe.square, 0) - 12 * seen.length - 70 * bare;
    return { camera, pipes: track.pipes, others: rest.flatMap((group) => group.pipes), believed };
  };
  // A camera that is nearly right has the near end of the track on the grid and the far end a
  // little off it. A track is one piece, so the steps that join on to what has been found and have
  // pipe somewhere near them are taken to be the rest of it, and the camera is settled on those as
  // well: that pulls the far end on to the grid. It can take a round or two to get there, so it is
  // given a few, and the best believed along the way is kept.
  const polish = (start) => {
    const name = (step) => `${key(step.a)}>${step.axis}`;
    let seen = start, kept = start;
    for (let round = 0; round < 6; round += 1) {
      const have = new Set(seen.pipes.map(name)), joints = new Set(seen.pipes.flatMap((pipe) => [key(pipe.a), key(pipe.b)]));
      const follow = seen.pipes.filter((pipe) => pipe.told === "changed");
      const steps = stepsSeen(seen.camera, width, height, 5);
      for (let grew = true; grew;) {
        grew = false;
        for (const step of steps) {
          if (have.has(name(step)) || (!joints.has(key(step.a)) && !joints.has(key(step.b)))) continue;
          const loose = 6 + 0.1 * step.length;
          if (share(step, (x, y) => toSure[y * width + x] <= loose, { least: 0.7 }) < 0.7) continue;
          follow.push(step); have.add(name(step)); joints.add(key(step.a)); joints.add(key(step.b));
          grew = true;
        }
      }
      const again = trackSeenBy(settle(seen.camera, follow, toMiddle, width, height, 24));
      if (!again) break;
      seen = again;
      if (seen.believed > kept.believed) kept = seen;
    }
    return kept;
  };
  // The few best at each zoom go on, not the best overall: a long lens far away explains nearly as
  // much as the right one, in many more ways, and would crowd it out.
  const going = [], perZoom = new Map();
  for (const one of tries) {
    const zoom = Math.round((one.camera.focal / width) * 100), so = perZoom.get(zoom) ?? 0;
    if (so < 4) { going.push(one); perZoom.set(zoom, so + 1); }
  }
  const seen = [];
  for (const start of going) {
    const one = trackSeenBy(tidy(start).camera);
    if (one) seen.push(one);
  }
  seen.sort((a, b) => b.believed - a.believed);
  const polished = [];
  for (const one of seen.slice(0, 8)) {
    const after = polish(one);
    log(`  zoom ${(one.camera.focal / width).toFixed(2)}: one piece of ${one.pipes.length} pipes, believed ${one.believed.toFixed(0)}; polished to zoom ${(after.camera.focal / width).toFixed(2)}, ${after.pipes.length} pipes, believed ${after.believed.toFixed(0)}`);
    if (after.believed > 0) polished.push(after);
  }
  if (polished.length === 0) throw new Error("No grid lines up with the pipes in the picture.");
  polished.sort((a, b) => b.believed - a.believed);
  // The floor is the lowest joint, and the corner nearest the camera's left is 0, 0.
  const place = (one) => {
    const low = [0, 1, 2].map((axis) => Math.min(...one.pipes.flatMap((pipe) => [pipe.a[axis], pipe.b[axis]])));
    const placed = one.pipes.map((pipe) => ({ a: sub(pipe.a, low), b: sub(pipe.b, low), told: pipe.told, changed: pipe.changed, thin: pipe.thin }));
    placed.sort((p, q) => p.a[1] - q.a[1] || p.a[0] - q.a[0] || p.a[2] - q.a[2] || p.b[1] - q.b[1] || p.b[0] - q.b[0]);
    return { camera: new Camera({ ...one.camera, eye: sub(one.camera.eye, low) }), pipes: placed, leftOut: one.others.length, believed: one.believed };
  };
  // One reading for each number of pipes, the most believed of those with that many.
  const readings = [];
  for (const one of polished) if (!readings.some((other) => other.pipes.length === one.pipes.length)) readings.push(place(one));
  const best = (sections ? readings.find((one) => one.pipes.length === sections) : null) ?? readings[0];
  log(`settled: zoom ${(best.camera.focal / width).toFixed(2)}, pixels ${best.camera.tall.toFixed(2)} tall, ${best.pipes.length} pipes`);
  return { camera: best.camera, pipes: best.pipes, strokes: found, leftOut: best.leftOut, readings };
}
