// The track in 3D: what counts as a track file, and the line a lap is flown along.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrack, extent, jointsOf, lapLine, camera, farFor, homeView } from "../shared/trackview.js";

// A made-up track: one gate, flown round and through.
const gate = {
  event: "An Event", track: 3,
  from: { video: "https://example.com/watch?v=made-up" },
  parts: [{ name: "Gate", sections: 3 }],
  pipes: [[[0, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 1]], [[1, 0, 0], [1, 0, 1]]],
  start: { at: [0.5, 0, 0.5], heading: [0, 1, 0] },
  lap: [
    { move: "Through the gate", by: [[0.5, -1, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5]] },
    { move: "Round to the right and back", by: [[1.5, 1.5, 0.5], [2, 0, 0.5], [1.5, -1.5, 0.5]] },
  ],
};

test("what counts as a track", () => {
  assert.deepEqual(readTrack(gate), { ...gate });
  assert.equal(readTrack(null), null);
  assert.equal(readTrack({ pipes: [] }), null);
  // A pipe that isn't two places on the grid spoils the whole file: half a track would mislead.
  assert.equal(readTrack({ ...gate, pipes: [...gate.pipes, [[0, 0, 0], [0, "up", 1]]] }), null);
  // What is missing is left out, and a link that isn't to a web page is dropped.
  const bare = readTrack({ pipes: gate.pipes, from: { video: "file:///etc/passwd" }, lap: [{ move: 7, by: [[0, 0, 0], "nowhere"] }, { by: [] }] });
  assert.deepEqual(bare, { event: "", track: null, from: null, parts: [], pipes: gate.pipes, start: null, lap: [{ move: "7", by: [[0, 0, 0]] }] });
});

test("the box a track takes up, and its joints", () => {
  assert.deepEqual(extent(gate), { low: [0, 0, 0], high: [1, 0, 1], middle: [0.5, 0, 0.5] });
  assert.deepEqual(jointsOf(gate), [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]]);
  assert.ok(farFor(gate) >= 3.6);
});

test("the lap is a closed line through every point, in order", () => {
  const lap = lapLine(gate);
  assert.equal(lap.line.length, 6 * 16);
  // It passes through each point it was given.
  const all = gate.lap.flatMap((move) => move.by);
  all.forEach((point, index) => assert.deepEqual(lap.line[index * 16].point.map((value) => Math.round(value * 1e9) / 1e9), point));
  // Round once and it is back where it started, without a jump on the way.
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(near(lap.placeAt(0).point, lap.placeAt(1).point) < 1e-9);
  assert.ok(near(lap.placeAt(-0.25).point, lap.placeAt(0.75).point) < 1e-9);
  for (let step = 0; step < 400; step += 1) assert.ok(near(lap.placeAt(step / 400).point, lap.placeAt((step + 1) / 400).point) < lap.whole / 300);
  // Each move starts where the last ended, and the first at the start.
  assert.equal(lap.moveStarts[0], 0);
  assert.ok(lap.moveStarts[1] > 0.3 && lap.moveStarts[1] < 0.7);
  assert.equal(lap.placeAt(lap.moveStarts[1] + 0.001).move, 1);
  assert.equal(lap.placeAt(0.999).move, 1);
  // Too few points to go round is no lap.
  assert.equal(lapLine({ ...gate, lap: [{ move: "", by: [[0, 0, 0], [1, 1, 1]] }] }), null);
});

test("the camera looks at the middle of the track", () => {
  const see = camera({ ...homeView, width: 800, height: 500 }, [0.5, 0, 0.5]);
  const middle = see([0.5, 0, 0.5]);
  assert.ok(Math.abs(middle.x - 400) < 1e-6 && Math.abs(middle.y - 270) < 1e-6);
  assert.ok(Math.abs(middle.depth - homeView.far) < 1e-9);
  // Higher up is higher in the picture, and nearer things are bigger.
  assert.ok(see([0.5, 0, 1.5]).y < middle.y);
  assert.ok(see([0.5, -2, 0.5]).size > see([0.5, 2, 0.5]).size);
  // What is behind the camera isn't drawn.
  assert.equal(camera({ turn: 0, tilt: 0, far: 2, width: 800, height: 500 }, [0, 0, 0])([0, -5, 0]), null);
});

test("the tracks that come with the app are tracks", () => {
  const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "tracks");
  const names = readdirSync(folder).filter((name) => name.endsWith(".json"));
  assert.ok(names.length > 0);
  for (const name of names) {
    const track = readTrack(JSON.parse(readFileSync(join(folder, name), "utf8")));
    assert.ok(track, name);
    assert.ok(track.event !== "" && track.track !== null, name);
    // One whose video isn't out yet has no lap. One that has a lap has a start gate, and goes round.
    if (track.lap.length > 0) assert.ok(track.start && lapLine(track), name);
    // Every pipe is one section long, along the grid, stands on the floor or above it, and is there once.
    for (const [a, b] of track.pipes) {
      assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]), 1, name);
      assert.ok(a[2] >= 0 && b[2] >= 0, name);
    }
    assert.equal(new Set(track.pipes.map((pipe) => pipeKey(...pipe))).size, track.pipes.length, name);
    if (track.parts.length > 0) assert.equal(track.parts.reduce((sum, part) => sum + part.sections, 0), track.pipes.length, name);
  }
});

// ---- Building one by hand.
import { togglePipe, openSteps, edgeAt, snap, lapPoints, lapFrom, startAt, startIndex, pipeKey } from "../shared/trackview.js";

test("a track with nothing built yet can be read for building on, and has room to start in", () => {
  assert.equal(readTrack({ pipes: [] }), null);
  const blank = readTrack({ pipes: [], lap: [] }, { unbuilt: true });
  assert.deepEqual(blank.pipes, []);
  assert.deepEqual(extent(blank), { low: [0, 0, 0], high: [1, 1, 1], middle: [0.5, 0.5, 0.5] });
  assert.equal(lapLine(blank), null);
});

test("sections go on and come off, and the next ones are a step from a joint", () => {
  // From nothing: every way from the first joint but down.
  assert.deepEqual(openSteps([]).map(([, to]) => to), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]);
  let pipes = togglePipe([], [0, 0, 1], [0, 0, 0]);
  assert.deepEqual(pipes, [[[0, 0, 0], [0, 0, 1]]]);
  pipes = togglePipe(pipes, [0, 0, 1], [1, 0, 1]);
  // None of the steps on offer is a pipe that is there, each is offered once, and none goes under the floor.
  const steps = openSteps(pipes), keys = steps.map((step) => pipeKey(...step));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!keys.includes(pipeKey([0, 0, 0], [0, 0, 1])) && keys.includes(pipeKey([1, 0, 1], [1, 0, 0])));
  assert.ok(steps.every(([a, b]) => a[2] >= 0 && b[2] >= 0));
  // Given from either end, the same pipe comes off.
  assert.deepEqual(togglePipe(pipes, [0, 0, 0], [0, 0, 1]), [[[0, 0, 1], [1, 0, 1]]]);
});

test("the section under the pointer is the nearest, and the one in front when two cross", () => {
  const see = camera({ ...homeView, width: 800, height: 500 }, [0.5, 0, 0.5]);
  const edges = gate.pipes;
  const middleOf = ([a, b]) => see(a.map((value, k) => (value + b[k]) / 2));
  edges.forEach((edge, index) => {
    const at = middleOf(edge);
    assert.equal(edgeAt(edges, see, at.x + 2, at.y - 1), index);
  });
  assert.equal(edgeAt(edges, see, 5, 5), -1);
  // Two lengths that cross in the picture: the nearer one is picked.
  const cross = [[[0, 3, 0.5], [1, 3, 0.5]], [[0, -3, 0.5], [1, -3, 0.5]]];
  const level = camera({ turn: 0, tilt: 0, far: 6, width: 800, height: 500 }, [0.5, 0, 0.5]);
  const there = level([0.5, -3, 0.5]);
  assert.equal(edgeAt(cross, level, there.x, there.y, 400), 1);
});

test("a lap as points and back again", () => {
  const points = lapPoints(gate.lap);
  assert.equal(points.length, 6);
  assert.deepEqual(points.map((point) => point.name), ["Through the gate", null, null, "Round to the right and back", null, null]);
  assert.deepEqual(lapFrom(points), gate.lap);
  // A point told to start a move starts one, and one in the middle taken out leaves the rest.
  points[1].name = "The gate itself";
  points.splice(4, 1);
  assert.deepEqual(lapFrom(points).map((move) => [move.move, move.by.length]), [["Through the gate", 1], ["The gate itself", 2], ["Round to the right and back", 2]]);
  assert.equal(snap(0.62), 0.5);
  assert.equal(snap(0.63), 0.75);
  assert.equal(snap(-0.9, 0.5), -1);
});

test("the start gate is at one of the lap's points, flown the way the line goes there", () => {
  const points = lapPoints(gate.lap);
  assert.equal(startIndex(points, gate.start), 1);
  assert.deepEqual(startAt(points, 1), gate.start);
  assert.deepEqual(startAt(points, 4).heading, [0, -1, 0]);
  assert.equal(startAt(points, 9), null);
  assert.equal(startIndex(points, null), -1);
});
