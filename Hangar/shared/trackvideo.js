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
 * The moments of the build at which the track is taken to be standing: spread from a third of the
 * way in to just short of where the next chapter cuts in. The build is a time-lapse and is over
 * early in it; after that whoever built the track stands in it and talks. The middle of all these
 * is taken, so somebody in front of a pipe for some of them is lost.
 */
export function standingMoments({ from, to }) {
  const first = from + (to - from) * 0.3, last = to - Math.min(2, (to - from) * 0.1);
  return Array.from({ length: 15 }, (_, index) => Math.round((first + ((last - first) * index) / 14) * 100) / 100);
}

/**
 * Runs in the page that is playing the video, because that is the one place its frames can be
 * read. `after` are the moments the track is standing, and `from` is where the build's chapter
 * starts.
 *
 * It takes the middle of the frames of the track standing. Then it finds where the time-lapse
 * really starts: the chapter opens with the builder standing among the parts with lists drawn over
 * the picture, and the bare floor is only seen in the half second after those lists go. That
 * moment is where the picture suddenly comes much closer to the track standing. The middle of the
 * frames just after it is the floor before any pipe is up. Last, it says where the picture got
 * brighter between the two and holds still.
 *
 * Gives the standing track as RGBA, a byte a pixel that is 1 where that is so, and the moment it
 * took the time-lapse to start at. It is put into the page as text, so it can use nothing from
 * outside itself.
 */
export async function captureBuild(video, { from, after, before = null, width = 1280, rise = 28, still = 30 }) {
  const height = Math.round((width * video.videoHeight) / video.videoWidth), count = width * height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d", { willReadFrequently: true });
  const frame = async (time) => {
    video.currentTime = time;
    await new Promise((done) => {
      video.addEventListener("seeked", done, { once: true });
      setTimeout(done, 5000);
    });
    await new Promise((done) => setTimeout(done, 350));
    pen.drawImage(video, 0, 0, width, height);
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

  video.pause();
  const standing = await frames(after), built = middle(standing);

  // How much of a frame is unlike the track standing, looked at every eighth pixel each way.
  const unlike = (data) => {
    let far = 0, all = 0;
    for (let y = 4; y < height; y += 8) {
      for (let x = 4; x < width; x += 8) {
        all += 1;
        if (Math.abs(light(data, y * width + x) - light(built, y * width + x)) > 40) far += 1;
      }
    }
    return far / all;
  };
  // Twice a second through the start of the build. While the lists are over the picture it is
  // much less like the track standing than it is once they have gone, and they fade out over a
  // second or so. So the level at the very start is set against the level of the rest: when the
  // start is well above, the time-lapse begins at the first moment that is down with the rest. A
  // video with nothing drawn over its build shows no such step, and starts where its chapter does.
  const looked = [];
  for (let time = from; time <= Math.min(from + 10, after[0] - 1); time += 0.5) looked.push({ time, unlike: unlike(await frame(time)) });
  const level = (list) => list.map((one) => one.unlike).sort((a, b) => a - b)[list.length >> 1] ?? 0;
  const first = level(looked.slice(0, 3)), rest = level(looked.slice(4));
  let start = from;
  if (looked.length >= 8 && first > rest * 1.35 && first - rest > 0.03) {
    const down = (one) => one.unlike <= rest * 1.3;
    const at = looked.findIndex((one, index) => index > 0 && down(one));
    if (at > 0) {
      start = looked[at].time;
      // Half a step back, if the lists had already gone by then: the first pipe is up within a second.
      const sooner = { time: start - 0.25, unlike: unlike(await frame(start - 0.25)) };
      looked.push(sooner);
      if (down(sooner)) start = sooner.time;
    }
  }
  // `before` is for telling it the moments of the bare floor outright.
  const bare = middle(await frames(before ?? Array.from({ length: 8 }, (_, index) => start + 0.05 + index * 0.07)));

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
  return { width, height, built, changed, start, looked };
}
