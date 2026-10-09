// Reading a track out of the series' video of it.
//
// The video has a chapter in which the track is built in front of one fixed camera: the parts
// lying on the floor, a time-lapse, then the track standing. What is here finds that chapter from
// the video's description, picks the moments to look at, and has the routine that reads them out
// of the page that is playing the video. `trackfit.js` finds the track in what comes back.

/** The address of a YouTube video's own page, from any of the links people pass round. Null for
 *  anything else: only YouTube's player is known to hand its frames over. */
export function videoPage(link) {
  try {
    const address = new URL(String(link).trim());
    const host = address.hostname.toLowerCase().replace(/^(www|m)\./, "");
    if (address.protocol !== "https:") return null;
    const id = host === "youtu.be" ? address.pathname.slice(1).split("/")[0]
      : host === "youtube.com" && address.pathname === "/watch" ? address.searchParams.get("v")
        : host === "youtube.com" && /^\/(live|shorts|embed)\//.test(address.pathname) ? address.pathname.split("/")[2]
          : null;
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch {
    return null;
  }
}

/** The chapters a video's description lists, as the moment each starts, in seconds, and its title:
 *  lines that begin with a time, "0:43 Track Build". */
export function chaptersIn(description) {
  const found = [];
  for (const line of String(description ?? "").split(/\r?\n/)) {
    const match = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–:]?\s+(.{1,80})/.exec(line);
    if (match) found.push({ at: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), title: match[4].trim() });
  }
  return found.sort((a, b) => a.at - b.at);
}

/** A time as a pilot types it, in seconds: "43", "0:43", "1:02:03". Null for anything else. */
export function clock(text) {
  const match = /^\s*(?:(?:(\d{1,2}):)?(\d{1,3}):)?(\d{1,5}(?:\.\d+)?)\s*$/.exec(String(text ?? ""));
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3]) : null;
}

/** The stretch of the video in which the track is built: the chapter that says so, up to the next
 *  one. Null when the description names no such chapter. */
export function buildShot(chapters, length) {
  const index = chapters.findIndex((chapter) => /\bbuild/i.test(chapter.title));
  if (index < 0) return null;
  const to = chapters[index + 1]?.at ?? length;
  return Number.isFinite(to) && to - chapters[index].at >= 4 ? { from: chapters[index].at, to } : null;
}

/**
 * The moments of the build at which the track is taken to be standing when the time-lapse can't be
 * told from the picture (see captureBuild, which finds it when it can): spread from a third of the
 * way in to just short of where the next chapter cuts in.
 */
export function standingMoments({ from, to }) {
  const first = from + (to - from) * 0.3, last = to - Math.min(2, (to - from) * 0.1);
  return Array.from({ length: 15 }, (_, index) => Math.round((first + ((last - first) * index) / 14) * 100) / 100);
}

/**
 * Runs in the page that is playing the video, because that is the one place its frames can be
 * read. `from` and `to` are the chapter the track is built in.
 *
 * The chapter is not all time-lapse. It opens with the builder standing among the parts, with the
 * parts lists drawn over the picture. Then the lists fade and the build runs fast. Then the track
 * stands, and after a moment more may be drawn over it: Track 2's video lays two photos of the
 * track over the corners a second and a half after the build ends. So the chapter is first looked
 * at once a second, and its two sudden changes are what tell its parts apart:
 *
 *   the lists going       the first second, after the chapter's own first, in which the picture
 *                         changes a lot. The time-lapse begins there
 *   something laid over   a later second that changes a lot after calmer ones
 *   the track standing    the second before that, or, with nothing laid over, from a few seconds
 *                         into the time-lapse on
 *   the bare floor        the half second after the lists have gone, which is where the picture
 *                         suddenly comes much closer to the track standing
 *
 * It takes the middle of the frames of the track standing, and of the bare floor (with a few from
 * while the lists were up, so that whoever is building is not in one place in most of them), and
 * says where the picture got brighter between the two and holds still.
 *
 * `after` and `before` give the moments outright, in place of looking for them. `fallback` is
 * the moments to take the track as standing at when no time-lapse can be told.
 *
 * Gives the standing track as RGBA, a byte a pixel that is 1 where the picture changed, and what
 * it took the chapter's parts to be. It is put into the page as text, so it can use nothing from
 * outside itself.
 */
export async function captureBuild(video, { from, to, after = null, before = null, fallback = [], width = 1280, soft = 854, rise = 28, still = 30 }) {
  const height = Math.round((width * video.videoHeight) / video.videoWidth), count = width * height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  // Every frame is first made as soft as a 480-line video, whatever the video is. The search for
  // pipes was worked out on a picture that soft, and not every video comes in 480 lines.
  const small = document.createElement("canvas");
  small.width = soft;
  small.height = Math.round((soft * video.videoHeight) / video.videoWidth);
  const smallPen = small.getContext("2d");
  const frame = async (time) => {
    video.currentTime = time;
    await new Promise((done) => {
      video.addEventListener("seeked", done, { once: true });
      setTimeout(done, 5000);
    });
    await new Promise((done) => setTimeout(done, 350));
    if (video.videoWidth > soft) {
      smallPen.drawImage(video, 0, 0, small.width, small.height);
      pen.drawImage(small, 0, 0, width, height);
    } else {
      pen.drawImage(video, 0, 0, width, height);
    }
    return pen.getImageData(0, 0, width, height).data;
  };
  const frames = async (times) => {
    const out = [];
    for (const time of times) out.push(await frame(time));
    return out;
  };
  const middle = (list) => {
    const out = new Uint8ClampedArray(count * 4), values = new Uint8Array(list.length);
    for (let i = 0; i < count * 4; i += 1) {
      if ((i & 3) === 3) {
        out[i] = 255;
        continue;
      }
      for (let k = 0; k < list.length; k += 1) values[k] = list[k][i];
      values.sort();
      out[i] = values[list.length >> 1];
    }
    return out;
  };
  const light = (data, i) => data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  const spread = (first, last, many) => Array.from({ length: many }, (_, index) => Math.round((first + ((last - first) * index) / Math.max(1, many - 1)) * 100) / 100);
  // A frame as a small grey picture, every eighth pixel each way, and how much of one differs from another.
  const smallOf = (data) => {
    const out = [];
    for (let y = 4; y < height; y += 8) for (let x = 4; x < width; x += 8) out.push(light(data, y * width + x));
    return out;
  };
  const differ = (one, other) => one.reduce((far, value, index) => far + (Math.abs(value - other[index]) > 40 ? 1 : 0), 0) / one.length;

  video.pause();
  let standingAt = after, lapse = null, changes = [];
  if (!standingAt) {
    // Once a second through the chapter.
    const looks = [];
    for (let time = from; time <= to - 0.5; time += 1) looks.push({ time, small: smallOf(await frame(time)) });
    const change = looks.slice(1).map((look, index) => differ(look.small, looks[index].small));
    const calm = [...change].sort((x, y) => x - y)[change.length >> 1] ?? 0;
    changes = change.map((value) => Math.round(value * 100));
    // The lists going is the first second, after the chapter's own first, in which the picture
    // changes a lot. The time-lapse begins there. (The build itself changes the picture less from
    // second to second than that, and not evenly, so it can't be told by being busy.)
    const fade = change.findIndex((value, index) => index >= 1 && value >= Math.max(0.07, calm * 3));
    const begins = fade >= 0 ? looks[fade].time : from;
    // A later second that changes a lot, after calmer ones, is something being laid over the
    // picture. The track stands, with nothing over it, in the second before that.
    let over = -1;
    for (let i = Math.max(fade, 0) + 3; i < change.length && over < 0; i += 1) {
      if (change[i] >= Math.max(0.08, Math.max(change[i - 1], change[i - 2], change[i - 3]) * 1.8)) over = i;
    }
    // With nothing laid over it, the track is taken as standing from a few seconds into the
    // time-lapse: the build is over early, and the middle of many frames is the track as it ends up.
    const [first, last] = over >= 0
      ? [Math.max(looks[over].time - 1.3, begins + 3), looks[over].time - 0.2]
      : [begins + 4.25, Math.min(to - Math.min(2, (to - from) * 0.1), begins + 34.25)];
    lapse = { from: begins, faded: fade >= 0, over: over >= 0 ? looks[over].time : null, standing: [first, last] };
    if (last - first >= 0.4) standingAt = spread(first, last, 15);
    standingAt ??= fallback;
  }
  const standing = await frames(standingAt), built = middle(standing);

  // How much of a frame is unlike the track standing.
  const builtSmall = smallOf(built), unlike = (data) => differ(smallOf(data), builtSmall);
  // Where the lists go: four times a second round the start of the time-lapse, or through the
  // start of the chapter when no time-lapse was told. The biggest fall over half a second is the
  // lists fading, when it is a big one. A video with nothing drawn over its build has none.
  const looked = [];
  const [scanFrom, scanTo] = lapse ? [Math.max(from, lapse.from - 1.5), lapse.from + 2.5] : [from, Math.min(from + 10, standingAt[0] - 1)];
  for (let time = scanFrom; time <= scanTo; time += 0.25) looked.push({ time, unlike: unlike(await frame(time)) });
  let start = lapse ? Math.max(from, lapse.from) : from, fell = 0, faded = false;
  for (let i = 2; i < looked.length; i += 1) {
    const by = looked[i - 2].unlike - looked[i].unlike;
    if (by > fell && by >= 0.03 && by >= looked[i - 2].unlike * 0.18) {
      [start, fell, faded] = [looked[i].time, by, true];
    }
  }
  // The floor before any pipe is up: the half second after the lists have gone, and a few moments
  // from while they were up, fewer than those, so that the lists are outvoted and so is the builder.
  const justAfter = Array.from({ length: 8 }, (_, index) => Math.round((start + 0.05 + index * 0.06) * 100) / 100);
  const earlier = faded && start - from > 1.5 ? spread(from + 0.3, start - 0.75, 5) : [];
  const bare = middle(await frames(before ?? [...earlier, ...justAfter]));

  // Lights that chase and screens that play are brighter in one middle than the other by chance.
  // What holds still shows about the same in most frames of the track standing: leave out any spot
  // whose brightness wanders by more than `still` across the middle half of them.
  const changed = new Uint8Array(count), levels = new Float32Array(standing.length);
  for (let i = 0; i < count; i += 1) {
    if (light(built, i) - light(bare, i) < rise) continue;
    for (let k = 0; k < standing.length; k += 1) levels[k] = light(standing[k], i);
    levels.sort();
    if (levels[Math.floor(standing.length * 0.75)] - levels[Math.floor(standing.length * 0.25)] <= still) changed[i] = 1;
  }
  return { width, height, built, changed, start, looked, lapse, standingAt, changes };
}
