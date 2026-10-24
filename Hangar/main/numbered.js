// A recording made to see where each frame goes. Every frame carries its own number, as twelve
// black or white blocks across the bottom of the picture, and its frames are timed the way an MP4
// from the goggles times them: by the clock, in a file that counts in 1/15360 s rather than the
// 1/90000 s of a transport stream, with a gap wherever a frame was dropped. The app's checks of
// itself and the tests put one through what the app does and read back which frame landed where.

const bits = 12;

/**
 * Makes one: `seconds` of frames at sixty a second, `width` wide and 16:9, in HEVC, or H.264 when
 * this FFmpeg can't make HEVC. Nearly one frame in three is followed by a gap of one frame, so the
 * file runs longer by the clock than its frames do at sixty a second. `reordered` stores some
 * frames after the ones they are shown before (B-frames), as some cameras do: no copy with exact
 * frame times is made of such a recording, and a video is made from the recording itself.
 * Says { ok, problem }.
 */
export async function numberedRecording(ffmpeg, file, { seconds = 20, width = 640, reordered = false } = {}) {
  const height = Math.round((width * 9) / 32) * 2;
  const block = width / 20, top = Math.round(height * 0.84), tall = Math.round(height * 0.1);
  const marks = [`drawbox=x=0:y=${top}:w=${block * bits}:h=${tall}:color=black:t=fill`];
  for (let bit = 0; bit < bits; bit += 1) marks.push(`drawbox=x=${block * bit}:y=${top}:w=${block}:h=${tall}:color=white:t=fill:enable='mod(floor(n/${2 ** bit}),2)'`);
  const picture = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${width}x${height}:r=60:d=${seconds}`,
    "-vf", `${marks.join(",")},setpts=N+floor(N*0.3),format=yuv420p`, "-fps_mode", "passthrough", "-enc_time_base:v", "1/60"];
  const out = ["-video_track_timescale", "15360", "-f", "mp4", file];
  const bframes = reordered ? 3 : 0;
  let made = await ffmpeg.run([...picture, "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", `log-level=error:bframes=${bframes}:keyint=60`, "-tag:v", "hvc1", ...out]);
  if (made.code !== 0) made = await ffmpeg.run([...picture, "-c:v", "libx264", "-preset", "ultrafast", "-bf", String(bframes), "-g", "60", ...out]);
  return made.code === 0 ? { ok: true, problem: null } : { ok: false, problem: made.said.trim().split("\n").slice(-3).join(" ") || "FFmpeg wrote nothing" };
}

/** The number on each frame of a video made from one, in the order its frames are stored. Null when it can't be read. */
export async function numbersIn(ffmpeg, file) {
  const answer = await ffmpeg.run(["-v", "error", "-i", file, "-map", "0:v:0", "-vf", `crop=iw*3/5:ih/20:0:ih*87/100,scale=${bits}:1:flags=area,format=gray`,
    "-fps_mode", "passthrough", "-f", "rawvideo", "-"], { bytes: true });
  if (answer.code !== 0) return null;
  const numbers = [];
  for (let at = 0; at + bits <= answer.out.length; at += bits) {
    let number = 0;
    for (let bit = 0; bit < bits; bit += 1) if (answer.out[at + bit] > 128) number += 2 ** bit;
    numbers.push(number);
  }
  return numbers;
}

/** When each frame of a video is shown, in seconds, in the order its frames are stored. Null when it can't be read. */
export async function frameTimes(ffmpeg, file) {
  const answer = await ffmpeg.run(["-v", "error", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"]);
  const base = /#tb 0: (\d+)\/(\d+)/.exec(answer.out);
  if (answer.code !== 0 || !base) return null;
  return answer.out.split("\n").filter((row) => row && !row.startsWith("#")).map((row) => (Number(row.split(",")[2]) * Number(base[1])) / Number(base[2]));
}
