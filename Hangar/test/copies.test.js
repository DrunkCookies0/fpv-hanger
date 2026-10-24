// The copies of a recording that the marker editor plays and the videos are made from, tried on an
// MP4 timed as the goggles time theirs (main/numbered.js). Every frame has to be where it was in
// each copy, and a video made from it has to start on the frame asked for. FFmpeg 8, which the
// Windows app has, once put the frames of such an MP4 far apart in the copy videos are made from,
// and a video's timer then started seconds away from the gate.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FFmpeg } from "../main/ffmpeg.js";
import { numberedRecording, numbersIn, frameTimes } from "../main/numbered.js";
import { plan } from "../shared/video.js";
import { Race } from "../shared/timing.js";

const here = dirname(fileURLToPath(import.meta.url));
const binary = join(here, "..", "vendor", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

test("every frame of an MP4 from the goggles is where it was, in each copy and in a video", { skip: existsSync(binary) ? false : "FFmpeg hasn't been fetched", timeout: 300000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-copies-"));
  const ffmpeg = new FFmpeg(binary);
  const where = process.cwd();
  try {
    const recording = join(scratch, "hdz_0001.mp4");
    assert.equal((await numberedRecording(ffmpeg, recording, { seconds: 10 })).problem, null);
    const facts = await ffmpeg.probe(recording);
    // Its frame rate is read from how far apart most frames are, not from how long it lasts by the clock.
    assert.equal(facts.fps.label, "60");
    assert.equal(facts.frames, 600);
    assert.ok(facts.duration > 12, `${facts.duration} s by the clock`);
    const every = Array.from({ length: facts.frames }, (_, n) => n);
    for (const kind of ["rewrap", "plainCopy", "lightCopy"]) {
      const copy = join(scratch, `${kind}.mp4`);
      const copied = await ffmpeg[kind](recording, copy, facts);
      assert.equal(copied.ok, true, copied.problem);
      assert.deepEqual(await numbersIn(ffmpeg, copy), every, `the frames of the ${kind}`);
      const late = (await frameTimes(ffmpeg, copy)).map((time, n) => [n, time]).filter(([n, time]) => Math.abs(time - n / 60) > 0.001);
      assert.deepEqual(late, [], `frames of the ${kind} at the wrong time`);
    }

    // A 16:9 video of 4 s to 6 s, made from the copy as the app makes it, with the timer's box left empty.
    const output = join(scratch, "video.mp4");
    const made = plan({ shape: "landscape", facts, source: join(scratch, "rewrap.mp4"), exactTimes: true, start: 4, end: 6, race: Race.from([4.5, 5, 5.5]), look: { accent: [1, 0.84, 0.04], title: "A Pilot", position: "tr", logo: null }, output, encoder: "libx264" });
    const empty = Buffer.alloc(made.canvas.width * made.canvas.height * 4);
    // FFmpeg is run where the colour table is, as the app runs it.
    process.chdir(join(here, "..", "assets", "colour"));
    const ran = await ffmpeg.run(made.args, {
      feed: async (child) => {
        child.stdin.on("error", () => {});
        for (let frame = 0; frame < made.count; frame += 1) if (!child.stdin.write(empty)) await new Promise((done) => child.stdin.once("drain", done));
        child.stdin.end();
      },
    });
    process.chdir(where);
    assert.equal(ran.code, 0, ran.said);
    assert.deepEqual(await numbersIn(ffmpeg, output), Array.from({ length: 120 }, (_, n) => 240 + n));
  } finally {
    process.chdir(where);
    rmSync(scratch, { recursive: true, force: true });
  }
});
