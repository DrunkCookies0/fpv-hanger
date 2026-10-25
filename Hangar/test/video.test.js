// How the music is laid under a video, and what FFmpeg is told for each shape.
import test from "node:test";
import assert from "node:assert/strict";
import { musicPlan, musicFilter, plan, stretch, shapes } from "../shared/video.js";
import { Race, FrameRate } from "../shared/timing.js";
import { raceDay, eyebrowLines, headingHeight } from "../shared/panel.js";

test("the stretch a video covers", () => {
  const crossings = [10, 20, 30, 40];
  assert.deepEqual(stretch(crossings), { start: 7, end: 48 });
  assert.deepEqual(stretch(crossings, { videoStart: 9, videoEnd: 41 }), { start: 9, end: 41 });
  assert.deepEqual(stretch([1, 5]), { start: 0, end: 13 });
  assert.deepEqual(stretch(crossings, {}, 45), { start: 7, end: 45 });
  assert.equal(stretch(crossings, { videoStart: 50, videoEnd: 41 }), null);
});

test("music under a video", () => {
  // A song already under way when the video starts is eased in over 0.4 s and dies away over the last second.
  assert.deepEqual(musicPlan({ start: 7, end: 77, songLength: 230, songStart: -145 }), { from: 152, to: 222, delay: 0, ramp: 0.4, fade: 1 });
  // A song that starts after the video does comes in at full, that far in.
  assert.deepEqual(musicPlan({ start: 7, end: 77, songLength: 230, songStart: 10 }), { from: 0, to: 67, delay: 3, ramp: 0, fade: 1 });
  // Told to come in at a point, it comes in at once there.
  assert.deepEqual(musicPlan({ start: 7, end: 77, songLength: 230, songStart: -145, musicIn: 10 }), { from: 155, to: 222, delay: 3, ramp: 0.01, fade: 1 });
  // Told to stop, it stops there. A song that runs out stops when it does.
  assert.equal(musicPlan({ start: 7, end: 77, songLength: 230, songStart: -145, musicOut: 60 }).to, 205);
  assert.equal(musicPlan({ start: 7, end: 77, songLength: 200, songStart: -145 }).to, 200);
  // A short stretch of music fades over half of itself.
  assert.equal(musicPlan({ start: 0, end: 10, songLength: 1.2, songStart: 2 }).fade, 0.6);
  // None of the song falls inside the video.
  assert.equal(musicPlan({ start: 7, end: 77, songLength: 100, songStart: -145 }), null);
  assert.equal(musicPlan({ start: 7, end: 77, songLength: 230, songStart: 80 }), null);
});

test("the music's filter is exact to the sample", () => {
  const filter = musicFilter(2, { from: 155, to: 222, delay: 3, ramp: 0.01, fade: 1 });
  assert.equal(filter, "[2:a]atrim=start=155:end=222,asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:st=0:d=0.01,afade=t=out:st=66:d=1,adelay=144000S:all=1[sound]");
  assert.ok(!musicFilter(2, { from: 152, to: 222, delay: 0, ramp: 0.4, fade: 1 }).includes("adelay"));
});

const facts = { codec: "hevc", width: 1280, height: 720, fps: new FrameRate(60), frames: 6022, fullRange: true, matrix: "bt601" };
const race = Race.from([10.033333, 19.716667, 29.433333, 39.566667, 48.816667, 59.5, 69.366667]);
const look = { accent: [1, 0.84, 0.04], title: "A Pilot", badge: "ID 042", event: "An Event", track: "Track 1", position: "tr", logo: null };

test("a 16:9 video: whole frames, one clock, the box in its corner", () => {
  const made = plan({ shape: "landscape", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look, output: "out.mp4" });
  assert.equal(made.first, 422);
  assert.equal(made.count, 4220);
  assert.deepEqual(made.at, { x: 1920 - 400 - 54, y: 54 });
  const graph = made.args[made.args.indexOf("-filter_complex") + 1];
  // Jumped into just before the first frame wanted, and both streams counted in whole frames.
  assert.equal(made.args[made.args.indexOf("-ss") + 1], String(421.5 / 60));
  assert.equal(graph.split("settb=1/60,setpts=N").length - 1, 2);
  // The picture is read as the recording has it and shown as the Mac app shows it, from the table.
  assert.ok(graph.includes("scale=in_color_matrix=bt601:in_range=full,format=gbrp,lut3d=file=mac-picture.cube"));
  // The box is mixed in over the part of the frame it covers, in light, and that part put back.
  assert.ok(graph.includes(`crop=${made.canvas.width}:${made.canvas.height}:${1920 - 400 - 54}:54`));
  assert.ok(graph.includes("maskedmerge"));
  assert.ok(graph.includes(`overlay=${1920 - 400 - 54}:54`));
  assert.equal(made.canvas.width % 2 + made.canvas.height % 2, 0);
  // It is cut at its last frame in the graph: FFmpeg 6.0 told to stop after so many frames stops the music early too.
  assert.ok(graph.includes("[out]trim=end_frame=4220[cut]"));
  assert.equal(made.args[made.args.indexOf("-map") + 1], "[cut]");
  assert.ok(!made.args.includes("-frames:v"));
  assert.ok(!made.args.includes("-c:a"));
});

test("a race's day is on its 16:9 video, at the right of the group's line", () => {
  assert.equal(raceDay("2026-09-21"), "21 SEP 2026");
  assert.equal(raceDay("2026-04-01"), "1 APR 2026");
  assert.equal(raceDay(""), null);
  assert.equal(raceDay(null), null);
  const club = { ...look, event: "Circle City FPV", track: "Spring Cup" };
  const undated = plan({ shape: "landscape", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look: club, output: "out.mp4" });
  const dated = plan({ shape: "landscape", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look: { ...club, date: "2026-04-11" }, output: "out.mp4" });
  assert.equal(undated.panel.day, null);
  assert.equal(undated.panel.stripLines, 1);
  // With a day, the race has the line under the group's, and the box is that much taller.
  assert.equal(dated.panel.day, "11 APR 2026");
  assert.equal(dated.panel.stripLines, 2);
  assert.equal(dated.panel.height - undated.panel.height, 58 - 36);
});

test("a 9:16 video has the group above the race when they would be cut short or the race has a day", () => {
  // A season's track shares a line with its series, as it always has.
  assert.deepEqual(eyebrowLines({ event: "RaceGOW6", track: "Track 1" }), [["RACEGOW6  ·  TRACK 1", ""]]);
  // A race with a day: the day follows the group, and the race has the line under them.
  assert.deepEqual(eyebrowLines({ event: "Central Texas Drone Racing", track: "Practice Night 4", date: "2026-10-23" }),
    [["CENTRAL TEXAS DRONE RACING", "  ·  23 OCT 2026"], ["PRACTICE NIGHT 4", ""]]);
  // Names too long to share a line, beside a logo, without a day.
  assert.equal(eyebrowLines({ event: "Circle City FPV", track: "Zero Traction Open Whoop Race #5", logo: {} }).length, 2);
  // Only one name: the day goes after it on the one line.
  assert.deepEqual(eyebrowLines({ track: "Spring Cup", date: "2026-04-11" }), [["SPRING CUP", "  ·  11 APR 2026"]]);
  assert.deepEqual(eyebrowLines({}), []);
  // Two lines over a name take no more room than one, so the heading still starts below the apps' bar.
  const named = { title: "A Pilot", badge: "ID 042", event: "Central Texas Drone Racing", track: "Practice Night 4" };
  assert.equal(headingHeight({ ...named, date: "2026-10-23" }), headingHeight(named));
  assert.equal(headingHeight({ ...named, date: "2026-10-23" }), 200);
  assert.equal(headingHeight({ event: "Central Texas Drone Racing", track: "Practice Night 4", date: "2026-10-23" }), 84);
});

test("a clip without exact times is read from its start and cut by frame", () => {
  const made = plan({ shape: "landscape", facts, source: "clip.ts", exactTimes: false, start: 7.033333, end: 77.366667, race, look, output: "out.mp4" });
  assert.ok(!made.args.includes("-ss"));
  // Numbered afresh, its frames are each made to last a frame too: FFmpeg 6.1 and later, told the
  // rate with -r, wrote a frame twice where it had lasted two in the recording. -r stays for the encoders.
  assert.ok(made.args[made.args.indexOf("-filter_complex") + 1].includes("[0:v]trim=start_frame=422:end_frame=4642,settb=1/60,setpts=N,fps=60/1,"));
  assert.equal(made.args[made.args.indexOf("-r") + 1], "60/1");
  assert.ok(!made.args.includes("-fps_mode"));
});

test("a 9:16 video: the picture cropped to itself, the box under it, music after the heading", () => {
  const made = plan({
    shape: "upright", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look, picture: { x: 40, y: 0, width: 1200, height: 720 },
    headingFile: "heading.png", music: { file: "song.mp3", songLength: 231.758, songStart: -145.823 }, output: "out.mp4",
  });
  const graph = made.args[made.args.indexOf("-filter_complex") + 1];
  assert.ok(graph.startsWith("[0:v]settb=1/60,setpts=N,fps=60/1,crop=1200:720:40:0,"));
  assert.ok(graph.includes("scale=1080:648:"));
  // The box sits under the picture and fills the room down to the captions. It starts in from the
  // left, clear of what a phone cuts off, and ends short of the apps' column of buttons on the right.
  assert.deepEqual(made.at, { x: 90, y: 468 + 648 + 26 });
  assert.equal(made.at.x + made.panel.pixelWidth, 900);
  assert.ok(made.panel.pixelHeight <= shapes.upright.height * 0.8 - made.at.y + 1);
  // The heading ends above the picture and starts below the bar the apps put across the top.
  const heading = /\[headed\]/.test(graph) ? Number(/\[headed_mixed\]overlay=0:(\d+):/.exec(graph)[1]) : null;
  assert.ok(heading >= 240, `the heading starts at ${heading}`);
  assert.ok(graph.includes("[3:a]atrim="));
  assert.deepEqual(made.args.filter((argument, index) => made.args[index - 1] === "-i"), ["clip.mp4", "pipe:0", "heading.png", "song.mp3"]);
  // The heading is one picture given once. Nothing but a bookend's picture is held as an input, and that for a set time.
  assert.ok(!made.args.includes("-loop"));
  assert.equal(made.music.delay < 1e-9, true);
});

test("bookends: a picture before and a clip after are joined on, and the sound keeps step", () => {
  const made = plan({
    shape: "landscape", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look, output: "out.mp4",
    music: { file: "song.mp3", songLength: 231.758, songStart: -145.823 },
    bookends: { before: { file: "title.png", kind: "picture", seconds: 3, hasSound: false }, after: { file: "outro.mp4", kind: "clip", seconds: 4.5, hasSound: true } },
  });
  const graph = made.args[made.args.indexOf("-filter_complex") + 1];
  assert.deepEqual(made.args.filter((argument, index) => made.args[index - 1] === "-i"), ["clip.mp4", "pipe:0", "song.mp3", "title.png", "outro.mp4"]);
  // The picture is held for its three seconds. The clip plays through.
  assert.deepEqual(made.args.slice(made.args.indexOf("title.png") - 7, made.args.indexOf("title.png") - 1), ["-loop", "1", "-framerate", "60/1", "-t", "3"]);
  assert.ok(graph.includes("[before_picture][before_sound][main_picture][main_sound][after_picture][after_sound]concat=n=3:v=1:a=1[whole][whole_sound]"));
  // The picture is laid on black, see-through parts and all. The clip is fitted as it is.
  assert.ok(graph.includes("[3:v]format=gbrap,premultiply=inplace=1,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:out_color_matrix=bt709:out_range=limited:flags=bicubic,format=yuv420p,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,trim=duration=3,setpts=PTS-STARTPTS[before_picture]"));
  assert.ok(graph.includes("[4:v]fps=60/1,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:out_color_matrix=bt709:out_range=limited:flags=bicubic,format=yuv420p,pad="));
  // The picture has no sound of its own, so it is given silence. The clip keeps its own.
  assert.ok(graph.includes("anullsrc=r=48000:cl=stereo,atrim=0:3[before_sound]"));
  assert.ok(graph.includes("[4:a]aresample=48000"));
  // The video is as long as its parts: the run is cut at its own last frame inside the graph, so
  // that it doesn't run on to the end of the recording, and the whole is not cut again.
  assert.ok(graph.includes(`[out]trim=end_frame=${made.count},setsar=1,setpts=PTS-STARTPTS[main_picture]`));
  assert.ok(!made.args.includes("-frames:v"));
  assert.ok(made.args.includes("[whole]") && made.args.includes("[whole_sound]"));
});

test("bookends on a silent video stay silent", () => {
  const made = plan({ shape: "upright", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look, picture: { x: 40, y: 0, width: 1200, height: 720 }, output: "out.mp4",
    bookends: { after: { file: "end.png", kind: "picture", seconds: 2, hasSound: false } } });
  const graph = made.args[made.args.indexOf("-filter_complex") + 1];
  assert.ok(graph.includes("[main_picture][after_picture]concat=n=2:v=1:a=0[whole]"));
  // The cut is what ends the run, not the end of the recording.
  assert.ok(graph.includes(`[out]trim=end_frame=${made.count},`));
  assert.ok(!made.args.includes("-c:a"));
});

test("bookends: a clip's colours are read the way it stores them", () => {
  const graphOf = (after) => {
    const made = plan({ shape: "landscape", facts, source: "clip.mp4", exactTimes: true, start: 7.033333, end: 77.366667, race, look, output: "out.mp4", bookends: { after } });
    return made.args[made.args.indexOf("-filter_complex") + 1];
  };
  // One that doesn't say is read by its size, and one that is full range as that.
  assert.ok(graphOf({ file: "end.mp4", kind: "clip", seconds: 2, hasSound: false, matrix: "bt601", fullRange: true })
    .includes("scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=limited:flags=bicubic,format=yuv420p"));
  // A phone's HDR clip is brought down to an ordinary video's range, after it is made small.
  const bright = graphOf({ file: "end.mov", kind: "clip", seconds: 2, hasSound: true, matrix: "bt601", fullRange: false, hdr: "arib-std-b67" });
  assert.ok(bright.includes("[2:v]fps=60/1,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic,zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:rin=tv:t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.6:peak=4.926:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,pad="));
});
