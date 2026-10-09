// How a finished video is put together: what FFmpeg is asked to do for each shape, and how the
// music is laid under it. Nothing here runs anything. It only works out the instructions, so it can
// be checked on its own.

import { Panel, upright, cornerMargin, corner, headingHeight } from "./panel.js";

/** The two finished videos a run can have. */
export const shapes = {
  landscape: { name: "16:9", folder: "landscape", title: "16:9 video", width: 1920, height: 1080, bitrate: 16 },
  upright: { name: "9:16", folder: "vertical", title: "9:16 video", width: upright.width, height: upright.height, bitrate: 14 },
};

/** How long before lap 1 and after the finish a video runs when the stretch is left to the app. */
export const leadIn = 3, hold = 8;

/** The stretch of a clip a video covers, in seconds: what the pilot chose, or else from just before
 *  lap 1 to a while after the finish. */
export function stretch(crossings, { videoStart = null, videoEnd = null } = {}, clipLength = Infinity) {
  const first = crossings[0], last = crossings[crossings.length - 1];
  const start = Math.max(0, videoStart ?? first - leadIn);
  const end = Math.min(clipLength, videoEnd ?? last + hold);
  return end > start ? { start, end } : null;
}

/**
 * The music under a video. A moment `m` seconds into the song is heard `songStart + m` seconds into
 * the clip. Gives the stretch of the song that is heard, how far into the video it comes in, how
 * long it takes to come up to full, and how long it takes to die away at the end. Null when none of
 * the song falls inside the video.
 */
export function musicPlan({ start, end, songLength, songStart, musicIn = null, musicOut = null }) {
  let from = Math.max(0, start - songStart);
  // The music can be told to come in later than the video starts, and to stop before it ends.
  let comesInWhereSet = false;
  if (musicIn !== null && musicIn - songStart > from) {
    from = musicIn - songStart;
    comesInWhereSet = true;
  }
  let to = Math.min(songLength, end - songStart);
  if (musicOut !== null) to = Math.min(to, musicOut - songStart);
  if (!(to > from)) return null;
  return {
    from,
    to,
    delay: songStart + from - start,
    // A song joined part-way through is eased in. Where the pilot set it to come in, it comes in at
    // once, with only enough of a ramp not to click: a drop put there has to land whole.
    ramp: from > 0.05 ? (comesInWhereSet ? 0.01 : 0.4) : 0,
    fade: Math.min(1, (to - from) / 2),
  };
}

const soundRate = 48000;

/**
 * What FFmpeg is told for each way of encoding the picture. "libx264" works everywhere and is the
 * slowest. The others hand the work to the computer's own video chip, which is two or three times
 * as fast: a Mac's, or on Windows the graphics card's (NVIDIA, Intel or AMD).
 */
export function encoderArguments(encoder, megabits) {
  const rate = ["-b:v", `${megabits}M`, "-maxrate", `${Math.round(megabits * 1.25)}M`, "-bufsize", `${megabits * 2}M`];
  switch (encoder) {
    case "h264_videotoolbox": return ["-c:v", encoder, "-b:v", `${megabits}M`, "-profile:v", "high", "-pix_fmt", "yuv420p"];
    case "h264_nvenc": return ["-c:v", encoder, "-preset", "p5", "-rc", "vbr", ...rate, "-profile:v", "high", "-pix_fmt", "yuv420p"];
    case "h264_qsv": return ["-c:v", encoder, "-preset", "medium", ...rate, "-profile:v", "high", "-pix_fmt", "nv12"];
    case "h264_amf": return ["-c:v", encoder, "-quality", "quality", "-rc", "vbr_peak", ...rate, "-profile:v", "high", "-pix_fmt", "nv12"];
    default: return ["-c:v", "libx264", "-preset", "veryfast", ...rate, "-profile:v", "high", "-pix_fmt", "yuv420p"];
  }
}

/** The filter that cuts, fades and places the song. `input` is which of FFmpeg's inputs it is. */
export function musicFilter(input, plan) {
  const parts = [`atrim=start=${plan.from}:end=${plan.to}`, "asetpts=PTS-STARTPTS", `aresample=${soundRate}`];
  if (plan.ramp > 0) parts.push(`afade=t=in:st=0:d=${plan.ramp}`);
  parts.push(`afade=t=out:st=${plan.to - plan.from - plan.fade}:d=${plan.fade}`);
  const delay = Math.round(plan.delay * soundRate);
  if (delay > 0) parts.push(`adelay=${delay}S:all=1`);
  return `[${input}:a]${parts.join(",")}[sound]`;
}

/**
 * The Mac app's video engine does three things to colour, all of them side effects of how macOS
 * converts between its colour spaces, and all of them part of how its videos look. They are done
 * here on purpose, so that a video comes out the same from either app and on either kind of computer.
 *
 * 1. It lightens the recording's picture and shifts its colours a little. What it makes of each
 *    colour was measured off that engine with a test chart, 33 levels of each of red, green and
 *    blue, and is kept as a table (assets/colour). FFmpeg is started in that folder, so the table
 *    is named here without a path. It was measured on a goggle recording (full-range BT.601);
 *    other kinds of recording are given the same table, which has not been checked against the Mac.
 * 2. It mixes everything in light itself, not in the numbers that stand for it: the dimming of a
 *    9:16 video's background, its blur, and the laying of the timer box and the heading over the
 *    picture. A box that lets a fifth of the light through looks half see-through that way.
 * 3. It takes what is drawn (the box, the heading) to be in a screen's colours and the video to be
 *    2.4 to the power, so drawn greys come out a little lighter than they were drawn.
 */
export const pictureTable = "mac-picture.cube";

/** The recording's picture as red, green and blue, the way the Mac app's video shows it. */
const asTheMacShows = (facts) => `scale=in_color_matrix=${facts.matrix}:in_range=${facts.fullRange ? "full" : "limited"},format=gbrp,lut3d=file=${pictureTable}`;
/** Red, green and blue back to the colours a finished video is kept in. */
const toVideo = "out_color_matrix=bt709:out_range=limited";
/** Every level of a sixteen-bit picture raised to a power: 2.4 turns the video's numbers into light, 1/2.4 turns light back. */
const power = (exponent, gain = [1, 1, 1]) => `lutrgb=${["r", "g", "b"].map((channel, index) => `${channel}='65535*pow(${gain[index]}*val/65535,${exponent})'`).join(":")}`;
/** What is drawn is in a screen's colours (sRGB). This turns those into light. */
const drawnToLight = (() => {
  const each = "65535*if(lte(val/65535,0.04045),val/65535/12.92,pow((val/65535+0.055)/1.055,2.4))";
  return `lutrgb=r='${each}':g='${each}':b='${each}'`;
})();

/**
 * Lays drawn graphics over the video the way the Mac app does: mixed in light. Only the part of
 * the frame under the graphics is worked on, sixteen bits deep while it is light, and put back.
 * `under` and `graphics` are the names of the two streams, `to` what the result is called.
 */
function layOver(graph, { under, graphics, to, x, y, width, height, last = false }) {
  graph.push(
    `[${under}]split=2[${to}_whole][${to}_part]`,
    `[${to}_part]crop=${width}:${height}:${x}:${y},scale=in_color_matrix=bt709:in_range=limited,format=gbrp16le,${power(2.4)}[${to}_lit]`,
    `[${graphics}]split=2[${to}_colour][${to}_cover]`,
    `[${to}_colour]format=gbrp16le,${drawnToLight}[${to}_ink]`,
    // How much each point of the graphics covers, as a picture of its own, the same in all three colours.
    `[${to}_cover]alphaextract,scale=in_range=full:out_range=full,format=gbrp16le[${to}_mask]`,
    `[${to}_lit][${to}_ink][${to}_mask]maskedmerge,${power("1/2.4")},scale=${toVideo},format=yuv420p[${to}_mixed]`,
    `[${to}_whole][${to}_mixed]overlay=${x}:${y}:format=yuv420${last ? ":shortest=1" : ""}[${to}]`,
  );
}

/**
 * What goes before or after a video, fitted into its frame on black and brought to the video's own
 * colours. It is shown as it is: the lift the Mac gives a recording is for recordings, and this is
 * somebody's finished picture.
 */
function fitBookend(end, shape, rate) {
  const fit = `${shape.width}:${shape.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const steps = [];
  if (end.kind === "picture") {
    // The see-through parts of a picture show the black behind it, not whatever colour happens to be stored under them.
    steps.push("format=gbrap", "premultiply=inplace=1", `scale=${fit}:${toVideo}:flags=bicubic`);
  } else if (end.hdr) {
    // A clip in HDR, as a phone makes them, is brought down to an ordinary video's range. Left as
    // it is, it would come out grey and flat. It is made small first: the rest is slow work.
    // Light is counted so that 1 is HDR's own white, 203 nits. Everything up to 0.6 of that is
    // kept as it is, which is the middle of the picture, and what is brighter is eased in under
    // the top, as far as the 1,000 nits such clips are made for.
    steps.push(
      `fps=${rate}`, `scale=${fit}:flags=bicubic`,
      `zscale=tin=${end.hdr}:pin=bt2020:min=bt2020nc:rin=${end.fullRange ? "pc" : "tv"}:t=linear:npl=203`, "format=gbrpf32le",
      "zscale=p=bt709", `tonemap=tonemap=mobius:param=0.6:peak=${(1000 / 203).toFixed(3)}:desat=0`, "zscale=t=bt709:m=bt709:r=tv",
    );
  } else {
    // A clip that doesn't say which arithmetic its colours use is read the way its size implies, as players do.
    const from = end.matrix ? `in_color_matrix=${end.matrix}:in_range=${end.fullRange ? "full" : "limited"}:` : "";
    steps.push(`fps=${rate}`, `scale=${fit}:${from}${toVideo}:flags=bicubic`);
  }
  steps.push("format=yuv420p", `pad=${shape.width}:${shape.height}:(ow-iw)/2:(oh-ih)/2:black`, "setsar=1", `trim=duration=${end.seconds}`, "setpts=PTS-STARTPTS");
  return steps.join(",");
}

/** A place and size on whole even numbers that takes in a box: the video's colour is kept at half
 *  size, so a part cut out of it has to start and end on even ones. */
function evenPlace({ x, y, width, height }) {
  const left = x - (x % 2), top = y - (y % 2);
  const even = (value) => value + (value % 2);
  return { x: left, y: top, width: even(width + x - left), height: even(height + y - top), dx: x - left, dy: y - top };
}

/**
 * Everything about one video that is settled before a frame is drawn: where the box goes, how big
 * it is, and what FFmpeg is to be told.
 *
 * @param {object} job
 * @param {"landscape"|"upright"} job.shape
 * @param {object} job.facts what `FFmpeg.probe` found in the clip
 * @param {string} job.source the file the pictures are read from
 * @param {boolean} job.exactTimes whether `source` has frame n at exactly n / fps, so it can be jumped into
 * @param {number} job.start
 * @param {number} job.end the stretch of the clip, in seconds
 * @param {import("./timing.js").Race} job.race
 * @param {object} job.look accent, title, badge, event, track, position, maxRows, logo (a picture, or null)
 * @param {{x: number, y: number, width: number, height: number}} [job.picture] the part of the frame that is picture (upright)
 * @param {object|null} [job.music] file, songLength, songStart, musicIn, musicOut
 * @param {string|null} [job.headingFile] the heading as a picture file, when there is one (upright)
 * @param {string} [job.encoder] which of `encoderArguments`' ways to encode the picture
 * @param {{before?: object, after?: object}} [job.bookends] what goes before and after: each is
 *   { file, kind: "clip" | "picture", seconds, hasSound }, and for a clip what `FFmpeg.probe` found
 *   of its colours: matrix, fullRange and hdr
 * @param {string} job.output
 */
export function plan(job) {
  const shape = shapes[job.shape];
  const fps = job.facts.fps;
  const rate = `${fps.num}/${fps.den}`;
  // Every stream is put on one clock that counts whole frames, so that frame n of the clip meets
  // frame n of the box. Left on their own clocks, FFmpeg pairs each picture with the box before it.
  const clock = `settb=${fps.den}/${fps.num},setpts=N`;
  const first = Math.max(0, Math.round(job.start * fps.value));
  const count = Math.max(1, Math.min(job.facts.frames - first, Math.round((job.end - job.start) * fps.value)));
  const look = job.look;
  let panel, at, graph;
  const inputs = [];

  // The clip. A copy with exact frame times is jumped into. Anything else is read from its start.
  if (job.exactTimes) inputs.push("-ss", String(Math.max(0, (first - 0.5) / fps.value)), "-i", job.source);
  else inputs.push("-i", job.source);
  const cut = job.exactTimes ? "" : `trim=start_frame=${first}:end_frame=${first + count},`;

  let canvas;
  if (job.shape === "landscape") {
    panel = new Panel({ race: job.race, scale: 1, accent: look.accent, title: look.title, badge: look.badge, event: look.event, track: look.track, maxRows: look.maxRows ?? 8, logo: look.logo ?? null });
    at = corner(look.position ?? "tr", { boxWidth: panel.pixelWidth, boxHeight: panel.pixelHeight, frameWidth: shape.width, frameHeight: shape.height, inset: Math.round(cornerMargin * panel.scale) })
      ?? { x: shape.width - panel.pixelWidth - cornerMargin, y: cornerMargin };
    canvas = evenPlace({ ...at, width: panel.pixelWidth, height: panel.pixelHeight });
    // The whole frame, scaled to fit, on black, with the box in its corner.
    graph = [
      `[0:v]${cut}${clock},${asTheMacShows(job.facts)},scale=${shape.width}:${shape.height}:force_original_aspect_ratio=decrease:${toVideo}:flags=bicubic,pad=${shape.width}:${shape.height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[base]`,
      `[1:v]${clock}[box]`,
    ];
    layOver(graph, { under: "base", graphics: "box", to: "out", ...canvas, last: true });
  } else {
    // Upright, top-down: heading, picture, box, each where `upright` puts it, clear of the apps' buttons.
    const picture = job.picture ?? { x: 0, y: 0, width: job.facts.width, height: job.facts.height };
    const pictureHeight = Math.round((picture.height * shape.width) / picture.width);
    const boxTop = upright.pictureTop + pictureHeight + upright.boxGap;
    panel = new Panel({ race: job.race, scale: upright.boxScale, accent: look.accent, layout: "wide", room: (upright.captionsFrom - boxTop) / upright.boxScale });
    at = { x: upright.side, y: boxTop };
    canvas = evenPlace({ ...at, width: panel.pixelWidth, height: panel.pixelHeight });
    const crop = `crop=${picture.width}:${picture.height}:${picture.x}:${picture.y}`;
    // The background is the same picture filling the frame, blurred and dimmed to about a third of
    // its light (a touch more of the blue), as the Mac app does it. Blurred at quarter size to keep it cheap.
    const small = { width: shape.width / 4, height: shape.height / 4 };
    graph = [
      `[0:v]${cut}${clock},${crop},${asTheMacShows(job.facts)},split=2[near][far]`,
      `[near]scale=${shape.width}:${pictureHeight}:${toVideo}:flags=bicubic,format=yuv420p[front]`,
      `[far]scale=${small.width}:${small.height}:force_original_aspect_ratio=increase:flags=bilinear,crop=${small.width}:${small.height},format=gbrp16le,${power(2.4)},` +
        `gblur=sigma=9,${power("1/2.4", [0.32, 0.32, 0.34])},scale=${shape.width}:${shape.height}:${toVideo}:flags=bilinear,format=yuv420p[back]`,
      `[back][front]overlay=0:${upright.pictureTop}:format=yuv420[pictured]`,
      `[1:v]${clock}[box]`,
    ];
    let last = "pictured";
    if (job.headingFile) {
      const height = headingHeight({ title: look.title, badge: look.badge, eyebrow: eyebrowOf(look), logo: look.logo ?? null });
      graph.push(`[2:v]${clock}[heading]`);
      layOver(graph, { under: last, graphics: "heading", to: "headed", ...evenPlace({ x: 0, y: upright.pictureTop - upright.headingGap - height, width: shape.width, height }) });
      last = "headed";
    }
    layOver(graph, { under: last, graphics: "box", to: "out", ...canvas, last: true });
  }

  // The box, a frame at a time, from the window that draws it.
  inputs.push("-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${canvas.width}x${canvas.height}`, "-framerate", rate, "-i", "pipe:0");
  // The heading is given once, as the one picture it is, and FFmpeg holds it for as long as the
  // video lasts. Held without end as an input of its own ("-loop 1"), it kept FFmpeg 6 running for
  // ever whenever the music ended before the picture did, and was worked on again for every frame.
  if (job.shape === "upright" && job.headingFile) inputs.push("-i", job.headingFile);

  const music = job.music ? musicPlan({ start: first / fps.value, end: (first + count) / fps.value, ...job.music }) : null;
  let inputCount = job.shape === "upright" && job.headingFile ? 3 : 2;
  let picture = "out", sound = null;
  if (music) {
    inputs.push("-i", job.music.file);
    graph.push(musicFilter(inputCount, music));
    inputCount += 1;
    sound = "sound";
  }

  // Bookends: a clip or a picture before the video, and one after it. Each is fitted into the
  // frame on black and joined on in the same run, so the video itself is encoded once. A clip
  // keeps its own sound, and the run's music still starts with the run.
  const ends = [["before", job.bookends?.before], ["after", job.bookends?.after]].filter(([, end]) => end && end.seconds > 0);
  if (ends.length > 0) {
    const seconds = count / fps.value;
    const heard = Boolean(music) || ends.some(([, end]) => end.hasSound);
    const silence = (length, name) => `anullsrc=r=${soundRate}:cl=stereo,atrim=0:${length}[${name}]`;
    const fitted = (length) => `aresample=${soundRate},aformat=channel_layouts=stereo,apad=whole_dur=${length},atrim=0:${length},asetpts=PTS-STARTPTS`;
    const parts = [];
    for (const [name, end] of ends) {
      // A picture is held for as long as was asked. A clip plays through at the video's own frame rate.
      if (end.kind === "picture") inputs.push("-loop", "1", "-framerate", rate, "-t", String(end.seconds), "-i", end.file);
      else inputs.push("-i", end.file);
      graph.push(`[${inputCount}:v]${fitBookend(end, shape, rate)}[${name}_picture]`);
      if (heard) graph.push(end.hasSound ? `[${inputCount}:a]${fitted(end.seconds)}[${name}_sound]` : silence(end.seconds, `${name}_sound`));
      parts.push({ name, at: name === "before" ? 0 : 2 });
      inputCount += 1;
    }
    if (heard) graph.push(sound ? `[sound]${fitted(seconds)}[main_sound]` : silence(seconds, "main_sound"));
    // The video itself is cut at its last frame here. Left to itself it would run on to the end of
    // the recording.
    graph.push(`[out]trim=end_frame=${count},setsar=1,setpts=PTS-STARTPTS[main_picture]`);
    const order = [...parts.filter((part) => part.at === 0).map((part) => part.name), "main", ...parts.filter((part) => part.at === 2).map((part) => part.name)];
    graph.push(`${order.map((name) => `[${name}_picture]${heard ? `[${name}_sound]` : ""}`).join("")}concat=n=${order.length}:v=1:a=${heard ? 1 : 0}[whole]${heard ? "[whole_sound]" : ""}`);
    picture = "whole";
    sound = heard ? "whole_sound" : null;
  }
  const maps = ["-map", `[${picture}]`];
  if (sound) maps.push("-map", `[${sound}]`, "-c:a", "aac", "-b:a", "192k", "-ar", String(soundRate), "-ac", "2");

  const args = [
    "-v", "error", "-y", ...inputs, "-filter_complex", graph.join(";"), ...maps,
    // With nothing joined on, the video is exactly its frames. With bookends the cut is made in the
    // graph, and the video ends when the last of them does.
    ...(ends.length > 0 ? [] : ["-frames:v", String(count)]), "-r", rate,
    ...encoderArguments(job.encoder ?? "libx264", shape.bitrate), "-g", "120",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-f", "mp4", job.output,
  ];
  // `canvas` is what the box is drawn on: its size, and how far in from its corner the box starts.
  return { args, panel, at, canvas, first, count, fps: fps.value, music };
}

/** The line above the pilot's name in an upright video: the event and the track. */
export function eyebrowOf(look) {
  const parts = [look.event, look.track].filter((part) => part);
  return parts.length > 0 ? parts.join("  ·  ") : null;
}
