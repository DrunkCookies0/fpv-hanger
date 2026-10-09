// The lap timer as it is drawn: the corner box for a 16:9 video, the wide box under the picture of
// a 9:16 one, and that video's heading. One piece of drawing code, for the picture in the marker
// editor and for the finished videos alike, so what is seen while marking is what the video gets.
//
// Everything is laid out in "reference points": pixels of a 1080-high frame. `scale` maps them to
// the pixels actually drawn on. It draws on any 2D canvas context.

import { formatTime } from "./timing.js";

/** The typeface. A Mac draws with its own system face, as the Mac app always has. Everywhere else
 *  it is Inter, which the app carries, so that a video comes out the same on any other machine. */
const onMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? "");
export const typeface = onMac ? 'system-ui, "Inter", sans-serif' : '"Inter", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

const css = ([r, g, b], alpha = 1) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
const white = (alpha) => css([1, 1, 1], alpha);
const ink = [0.05, 0.05, 0.06];

export function parseHexColor(text) {
  const hex = String(text).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const value = parseInt(hex, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** Text on a canvas, placed the way the timer places it: centred up and down on the height of a
 *  capital letter, with optional spacing between letters, and with digits all one width when asked,
 *  so a running time doesn't jitter. */
class Pen {
  constructor(context) {
    this.context = context;
    this.measured = new Map();
  }

  font(size, weight) {
    return `${weight} ${size}px ${typeface}`;
  }

  /** What is known about a font: the height of its capitals and the width of its widest digit. */
  facts(font) {
    let facts = this.measured.get(font);
    if (!facts) {
      const context = this.context;
      context.save();
      context.font = font;
      context.letterSpacing = "0px";
      const capital = context.measureText("H");
      let digit = 0;
      for (const character of "0123456789") digit = Math.max(digit, context.measureText(character).width);
      facts = { cap: capital.actualBoundingBoxAscent, digit };
      context.restore();
      this.measured.set(font, facts);
    }
    return facts;
  }

  width(text, font, { kern = 0, tabular = false } = {}) {
    const context = this.context;
    context.save();
    context.font = font;
    let width = 0;
    if (tabular) {
      const digit = this.facts(font).digit;
      context.letterSpacing = "0px";
      for (const character of text) width += /\d/.test(character) ? digit : context.measureText(character).width;
    } else {
      context.letterSpacing = `${kern}px`;
      width = context.measureText(text).width;
    }
    context.restore();
    return width;
  }

  /** Draws text and returns how wide it came out. */
  put(text, font, color, { x, centerY, align = "left", kern = 0, tabular = false }) {
    const context = this.context;
    const width = this.width(text, font, { kern, tabular });
    const left = align === "left" ? x : x - width;
    context.save();
    context.font = font;
    context.fillStyle = color;
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    const baseline = centerY + this.facts(font).cap / 2;
    if (tabular) {
      const digit = this.facts(font).digit;
      context.letterSpacing = "0px";
      let at = left;
      for (const character of text) {
        const own = context.measureText(character).width;
        if (/\d/.test(character)) {
          // Each digit sits in the middle of a cell as wide as the widest of them.
          context.fillText(character, at + (digit - own) / 2, baseline);
          at += digit;
        } else {
          context.fillText(character, at, baseline);
          at += own;
        }
      }
    } else {
      context.letterSpacing = `${kern}px`;
      context.fillText(text, left, baseline);
    }
    context.restore();
    return width;
  }

  /** A font no bigger than asked, made smaller when the text would be wider than its room. */
  fitted(text, size, weight, room, options = {}) {
    const font = this.font(size, weight);
    const width = this.width(text, font, options);
    return room > 0 && width > room ? this.font((size * room) / width, weight) : font;
  }
}

/** The timer box. `layout` is "stack", the corner box of a 16:9 frame, or "wide", the box under the
 *  picture of an upright video. */
export class Panel {
  /** How wide the wide box is, in reference points. Its scale is whatever makes that the width `upright` gives it. */
  static wideWidth = 600;
  /** The smaller laps in the wide box go three to a row. */
  static #otherColumns = 3;
  static #wideHead = 132;
  static #wideJudged = 96;
  static #wideOtherRow = 42;
  static #wideOtherPad = 8;

  /**
   * @param {object} options
   * @param {import("./timing.js").Race} options.race
   * @param {number} options.scale pixels for each reference point
   * @param {number[]} options.accent the highlight colour, as red, green and blue from 0 to 1
   * @param {string|null} [options.title] the pilot's name
   * @param {string|null} [options.badge] such as "RaceGOW ID 042"
   * @param {string|null} [options.event]
   * @param {string|null} [options.track]
   * @param {number} [options.maxRows] how many laps the corner box lists at once
   * @param {"stack"|"wide"} [options.layout]
   * @param {number|null} [options.room] for the wide box: the height there is for it, in reference points
   * @param {CanvasImageSource|null} [options.logo] for the corner box: a picture across its head
   */
  constructor({ race, scale, accent, title = null, badge = null, event = null, track = null, maxRows = 8, layout = "stack", room = null, logo = null }) {
    Object.assign(this, { race, scale, title, badge, event, track, layout });
    this.accent = accent;
    const luminance = 0.2126 * accent[0] + 0.7152 * accent[1] + 0.0722 * accent[2];
    this.onAccent = luminance > 0.55 ? ink : [1, 1, 1];
    this.pad = 24;
    this.fit = 1;
    if (layout === "stack") {
      this.stripHeight = event === null && track === null ? 0 : 36;
      this.titleHeight = title === null && badge === null ? 0 : 44;
      this.rows = Math.min(race.lapCount, Math.max(0, maxRows));
      this.width = 400;
      this.headerHeight = 118;
      this.logo = logo && logoSize(logo).width > 0 && logoSize(logo).height > 0 ? logo : null;
      this.logoHeight = this.logo ? 104 : 0;
      this.height = this.logoHeight + this.stripHeight + this.titleHeight + this.headerHeight + (this.rows > 0 ? this.rows * 38 + 16 : 0) + 66;
      this.judged = [0, 0];
      this.others = [];
      this.otherPlaces = 0;
    } else {
      // The pilot, the event and its logo are in the heading above the picture, not in this box.
      this.logo = null;
      this.logoHeight = 0;
      this.stripHeight = this.titleHeight = this.headerHeight = 0;
      this.width = Panel.wideWidth;
      const laps = race.lapCount;
      const first = laps > race.window ? race.best(laps)?.start ?? 0 : 0;
      this.judged = [first, first + Math.min(race.window, laps)];
      const rest = [];
      for (let lap = 0; lap < laps; lap += 1) if (lap < this.judged[0] || lap >= this.judged[1]) rest.push(lap);
      const across = Panel.#otherColumns;
      let otherRows = Math.ceil(rest.length / across);
      const natural = (rows) => Panel.#wideHead + Panel.#wideJudged + (rows > 0 ? rows * Panel.#wideOtherRow + 2 * Panel.#wideOtherPad : 0);
      if (room !== null) {
        // Rows of the smaller laps are given up, last first, before the rest is squeezed further than reads well.
        while (otherRows > 0 && natural(otherRows) * 0.8 > room) otherRows -= 1;
        this.fit = Math.min(1.1, Math.max(0.8, room / natural(otherRows)));
      }
      this.others = rest;
      this.otherPlaces = Math.min(rest.length, otherRows * across);
      this.rows = this.judged[1] - this.judged[0];
      this.height = natural(otherRows) * this.fit;
    }
    this.pixelWidth = Math.ceil(this.width * scale);
    this.pixelHeight = Math.ceil(this.height * scale);
  }

  /** Draws the box as it reads `seconds` into the clip, with its top-left corner at the context's origin. */
  draw(context, seconds) {
    const pen = new Pen(context);
    context.save();
    context.scale(this.scale, this.scale);
    context.beginPath();
    context.roundRect(0, 0, this.width, this.height, 16);
    context.clip();
    context.fillStyle = css([0.03, 0.04, 0.05], 0.8);
    context.fillRect(0, 0, this.width, this.height);
    if (this.layout === "stack") this.#drawStack(context, pen, seconds);
    else this.#drawWide(context, pen, seconds);
    context.restore();
  }

  #hairline(context, y) {
    context.fillStyle = white(0.14);
    context.fillRect(0, y, this.width, 1);
  }

  /** The corner box: the lap being flown, every lap in a list under it, and the best laps so far at the foot. */
  #drawStack(context, pen, seconds) {
    const { race, width, pad } = this;
    const accent = css(this.accent);
    const perSecond = race.unitsPerSecond;
    const now = Math.round(seconds * perSecond);
    const laps = race.lapCount;
    const done = race.completed(now);
    const started = now >= race.bounds[0];
    const finished = done === laps;
    const best = race.best(done);
    const age = (bound) => seconds - race.bounds[bound] / perSecond;
    let y = 0;

    if (this.logo) {
      // Across the head of the box, in the middle, as big as its band lets it be.
      const picture = logoSize(this.logo);
      const fit = Math.min((width - 2 * pad) / picture.width, (this.logoHeight - 20) / picture.height);
      const size = { width: picture.width * fit, height: picture.height * fit };
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(this.logo, (width - size.width) / 2, (this.logoHeight - size.height) / 2 + 2, size.width, size.height);
      y += this.logoHeight;
    }

    if (this.stripHeight > 0) {
      const font = pen.font(13, 800);
      context.fillStyle = white(0.09);
      context.fillRect(0, y, width, this.stripHeight);
      // With both, the event sits left and the track right. One alone sits left.
      const first = this.event ?? this.track;
      if (first) pen.put(first.toUpperCase(), font, accent, { x: pad, centerY: y + this.stripHeight / 2 + 1, kern: 1.8 });
      if (this.event !== null && this.track) {
        pen.put(this.track.toUpperCase(), font, white(0.9), { x: width - pad, centerY: y + this.stripHeight / 2 + 1, kern: 1.8, align: "right" });
      }
      y += this.stripHeight;
    }

    if (this.titleHeight > 0) {
      if (this.title) pen.put(this.title, pen.font(16, 700), white(0.92), { x: pad, centerY: y + this.titleHeight / 2 + 1, kern: 0.3 });
      if (this.badge) {
        pen.put(this.badge.toUpperCase(), pen.font(13, 800), accent, { x: width - pad, centerY: y + this.titleHeight / 2 + 1, kern: 1.3, align: "right" });
      }
      y += this.titleHeight;
      this.#hairline(context, y);
    }

    // The lap being flown.
    const headFont = pen.font(17, 800);
    const headWidth = pen.put(finished ? "FINISHED" : `LAP ${done + 1}`, headFont, accent, { x: pad, centerY: y + 31, kern: 1.6 });
    if (!finished) pen.put(`/ ${laps}`, headFont, white(0.45), { x: pad + headWidth + 7, centerY: y + 31, kern: 1.6 });
    const running = finished ? race.lap(laps - 1) : started ? now - race.bounds[done] : 0;
    pen.put(race.time(running, true), pen.font(66, 800), white(started ? 1 : 0.5), { x: pad - 3, centerY: y + 77, tabular: true });

    // The laps, under it.
    if (this.rows > 0) this.#hairline(context, y + this.headerHeight);
    let rowY = y + this.headerHeight + 8;
    const rowHeight = 38;
    const first = laps <= this.rows ? 0 : Math.min(Math.max(done - this.rows + 1, 0), laps - this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      const lap = first + row;
      const complete = lap < done;
      const current = lap === done && started;
      const inBest = laps > race.window && best !== null && lap >= best.start && lap < best.start + race.window;
      if (complete) {
        const flash = 1 - age(lap + 1);
        if (flash > 0) {
          context.fillStyle = css(this.accent, 0.5 * flash);
          context.fillRect(0, rowY, width, rowHeight);
        }
      }
      if (inBest) {
        context.fillStyle = accent;
        context.fillRect(0, rowY + 5, 5, rowHeight - 10);
      }
      pen.put(`LAP ${lap + 1}`, pen.font(15, 700), inBest ? accent : white(complete ? 0.62 : current ? 0.9 : 0.3), { x: pad, centerY: rowY + rowHeight / 2, kern: 1.2 });
      pen.put(complete ? race.time(race.lap(lap)) : "–", pen.font(24, 700), white(complete ? 1 : 0.3), { x: width - pad, centerY: rowY + rowHeight / 2, align: "right", tabular: true });
      rowY += rowHeight;
    }

    // The laps in a row that are judged.
    const window = race.window;
    let label = laps === window ? `${window} LAPS` : `BEST ${window} LAPS`;
    let value = started ? Math.min(now, race.bounds[laps]) - race.bounds[0] : 0;
    let isSet = false;
    let setAge = Infinity;
    if (laps < window) {
      label = "TOTAL";
      isSet = finished;
      if (finished) setAge = age(laps);
    } else if (best !== null) {
      value = best.total;
      isSet = true;
      setAge = age(best.start + window);
    }
    const footerHeight = 66;
    const footerY = this.height - footerHeight;
    if (isSet) {
      const flash = Math.max(0, 1 - setAge / 0.8) * 0.75;
      context.fillStyle = css(this.accent.map((part) => part + (1 - part) * flash));
    } else {
      context.fillStyle = white(0.08);
    }
    context.fillRect(0, footerY, width, footerHeight);
    pen.put(label, pen.font(16, 800), isSet ? css(this.onAccent) : accent, { x: pad, centerY: footerY + footerHeight / 2, kern: 1.4 });
    pen.put(race.time(value, true), pen.font(32, 800), isSet ? css(this.onAccent) : white(0.6), { x: width - pad, centerY: footerY + footerHeight / 2, align: "right", tabular: true });
  }

  /** The box under an upright video's picture. The judged laps are the point of it: one big time for
   *  them together, which waits at nothing until the first of them starts, runs through them, and
   *  stops on what they came to. Under it those laps, each with its own time, and under them the
   *  other laps, smaller. A lap being flown shows its time as it runs. */
  #drawWide(context, pen, seconds) {
    const { race, width, pad, fit } = this;
    const accent = css(this.accent);
    const perSecond = race.unitsPerSecond;
    const now = Math.round(seconds * perSecond);
    const laps = race.lapCount;
    const done = race.completed(now);
    const started = now >= race.bounds[0];
    const age = (bound) => seconds - race.bounds[bound] / perSecond;
    const timeOf = (lap) => (lap < done ? race.time(race.lap(lap)) : lap === done && started ? race.time(now - race.bounds[lap]) : "–");
    const [from, to] = this.judged;

    // The judged laps as one time.
    const opens = race.bounds[from], closes = race.bounds[to];
    const running = now >= opens, isSet = now >= closes;
    const total = isSet ? closes - opens : running ? now - opens : 0;
    const headHeight = Panel.#wideHead * fit;
    if (isSet) {
      // It flashes as it lands, then stays lit.
      const flash = Math.max(0, 1 - age(to) / 0.8) * 0.75;
      context.fillStyle = css(this.accent.map((part) => part + (1 - part) * flash));
      context.fillRect(0, 0, width, headHeight);
    }
    const quiet = isSet ? css(this.onAccent, 0.62) : white(0.45);
    const labelFont = pen.font(17 * fit, 800);
    const labelY = 31 * fit;
    const label = laps > race.window ? `BEST ${race.window} LAPS` : laps === race.window ? `${laps} LAPS` : "TOTAL";
    const labelWidth = pen.put(label, labelFont, isSet ? css(this.onAccent) : accent, { x: pad, centerY: labelY, kern: 1.6 });
    if (laps > race.window) pen.put(`LAPS ${from + 1}–${to}`, labelFont, quiet, { x: pad + labelWidth + 12, centerY: labelY, kern: 1.6 });
    // Where the run has got to, at the right.
    pen.put(done === laps ? "FINISHED" : `LAP ${done + 1} / ${laps}`, labelFont, quiet, { x: width - pad, centerY: labelY, kern: 1.6, align: "right" });
    pen.put(race.time(total, true), pen.font(88 * fit, 800), isSet ? css(this.onAccent) : white(running ? 1 : 0.5), { x: pad - 3, centerY: 88 * fit, tabular: true });

    // The judged laps, side by side.
    let y = headHeight;
    const judgedHeight = Panel.#wideJudged * fit;
    const count = Math.max(to - from, 1);
    const cell = width / count;
    if (!isSet) this.#hairline(context, y);
    for (let lap = from; lap < to; lap += 1) {
      const column = lap - from;
      const x = column * cell;
      const flash = lap < done ? 1 - age(lap + 1) : 0;
      if (flash > 0) {
        context.fillStyle = css(this.accent, 0.5 * flash);
        context.fillRect(x, y, cell, judgedHeight);
      }
      if (column > 0) {
        context.fillStyle = white(0.14);
        context.fillRect(x, y, 1, judgedHeight);
      }
      context.fillStyle = accent;
      context.fillRect(x + (column > 0 ? 1 : 0), y + 16 * fit, 5, judgedHeight - 32 * fit);
      pen.put(`LAP ${lap + 1}`, pen.font(15 * fit, 700), accent, { x: x + 22, centerY: y + 30 * fit, kern: 1.2 });
      // Three times side by side are as big as they get. More than three share the same width.
      const size = 40 * fit * Math.min(1, 3 / count);
      const text = timeOf(lap);
      pen.put(text, pen.fitted(text, size, 700, cell - 40, { tabular: true }), white(lap <= done && started ? 1 : 0.3), { x: x + 21, centerY: y + 66 * fit, tabular: true });
    }
    y += judgedHeight;

    // The other laps, smaller. With more of them than places, the places follow the lap being flown.
    if (this.otherPlaces === 0) return;
    this.#hairline(context, y);
    const across = Panel.#otherColumns;
    const otherCell = width / across;
    const rowHeight = Panel.#wideOtherRow * fit;
    y += Panel.#wideOtherPad * fit;
    const reached = this.others.filter((lap) => lap <= done).length;
    const start = Math.min(Math.max(reached - this.otherPlaces, 0), this.others.length - this.otherPlaces);
    this.others.slice(start, start + this.otherPlaces).forEach((lap, index) => {
      const x = (index % across) * otherCell, top = y + Math.floor(index / across) * rowHeight;
      const complete = lap < done, current = lap === done && started;
      const flash = complete ? 1 - age(lap + 1) : 0;
      if (flash > 0) {
        context.fillStyle = css(this.accent, 0.35 * flash);
        context.fillRect(x, top, otherCell, rowHeight);
      }
      const named = pen.put(`LAP ${lap + 1}`, pen.font(13 * fit, 700), white(complete ? 0.55 : current ? 0.9 : 0.3), { x: x + 22, centerY: top + rowHeight / 2, kern: 1.1 });
      const text = timeOf(lap);
      pen.put(text, pen.fitted(text, 22 * fit, 700, otherCell - 44 - named - 8, { tabular: true }), white(complete ? 0.78 : current ? 1 : 0.3),
        { x: x + otherCell - 22, centerY: top + rowHeight / 2, align: "right", tabular: true });
    });
  }
}

/** A picture's own size, whatever kind of picture it is. */
function logoSize(picture) {
  return {
    width: picture.naturalWidth ?? picture.videoWidth ?? picture.displayWidth ?? picture.width ?? 0,
    height: picture.naturalHeight ?? picture.videoHeight ?? picture.displayHeight ?? picture.height ?? 0,
  };
}

/** Where a box goes in a frame, for one of the six positions: its top-left corner in pixels. Null
 *  for a position that isn't one of them. */
export function corner(position, { boxWidth, boxHeight, frameWidth, frameHeight, inset }) {
  switch (String(position).trim().toLowerCase().replaceAll(" ", "-")) {
    case "tl": case "top-left": return { x: inset, y: inset };
    case "tr": case "top-right": return { x: frameWidth - boxWidth - inset, y: inset };
    case "bl": case "bottom-left": return { x: inset, y: frameHeight - boxHeight - inset };
    case "br": case "bottom-right": return { x: frameWidth - boxWidth - inset, y: frameHeight - boxHeight - inset };
    case "tc": case "top-center": return { x: Math.trunc((frameWidth - boxWidth) / 2), y: inset };
    case "bc": case "bottom-center": return { x: Math.trunc((frameWidth - boxWidth) / 2), y: frameHeight - boxHeight - inset };
    default: return null;
  }
}

/** How far from the frame's edge the corner box sits, in reference points. */
export const cornerMargin = 54;

/** How tall the heading of an upright video is, for what it holds. */
export function headingHeight({ title = null, badge = null, eyebrow = null, logo = null }) {
  if (title === null && badge === null && eyebrow === null && !logo) return 0;
  return Math.max((title === null && badge === null ? 0 : 150) + (eyebrow === null ? 0 : 50), logo ? 170 : 0);
}

/** The heading of an upright video: the event and track in a line, the pilot's name, their ID, and
 *  the event's logo at the right, all `upright.side` in from the edges. Drawn `width` pixels wide
 *  with its top-left at the context's origin. */
export function drawHeading(context, { title = null, badge = null, eyebrow = null, accent, width, logo = null }) {
  const height = headingHeight({ title, badge, eyebrow, logo });
  if (height === 0) return;
  const pen = new Pen(context);
  const lift = eyebrow === null ? 0 : 50;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.6)";
  context.shadowBlur = 14;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 3;
  let wordsEnd = 0;
  const put = (text, font, color, kern, x, centerY) => {
    wordsEnd = Math.max(wordsEnd, x + pen.put(text, font, color, { x, centerY, kern }));
  };
  const side = upright.side;
  if (eyebrow !== null) put(eyebrow.toUpperCase(), pen.font(30, 800), white(0.85), 4, side + 3, 24);
  if (title !== null) put(title, pen.font(76, 800), white(1), 0, side, lift + (badge === null ? 75 : 46));
  if (badge !== null) put(badge.toUpperCase(), pen.font(30, 800), css(accent), 3, side + 3, lift + (title === null ? 75 : 120));
  if (logo) {
    // At the right, as far in from the edge as the words are from theirs, and no taller than they
    // are, so its top is no nearer the apps' bar than theirs. Left out when a long name leaves too
    // little room for it to be made out.
    const margin = side;
    const picture = logoSize(logo);
    const room = { width: Math.min(420, width - margin - (wordsEnd > 0 ? wordsEnd + 36 : margin)), height: height - 24 };
    const fit = Math.min(room.width / picture.width, room.height / picture.height);
    const size = { width: picture.width * fit, height: picture.height * fit };
    if (size.width >= 120) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(logo, width - margin - size.width, (height - size.height) / 2, size.width, size.height);
    }
  }
  context.restore();
}

/**
 * Where things go in an upright video, in pixels of its 1080 by 1920 frame.
 *
 * The apps it is watched in fill a tall phone's screen with it, which cuts a strip off each side,
 * and they lay their own buttons over it: a bar across the top, a column down the right-hand side
 * from the foot of the picture, and the caption across the bottom. Everything written on the video
 * keeps clear of all of those. Measured on YouTube Shorts on a large iPhone: 54 pixels cut from
 * each side, the top bar down to 209, the column from 918 across and 1130 down, the caption from
 * 1572. A smaller iPhone shows the same buttons bigger against the video: its bar comes down to
 * about 232, its column starts at about 912 and higher up, and its caption at about 1536.
 */
export const upright = {
  width: 1080,
  height: 1920,
  /** How far in from each side the words, the logo and the box stay. */
  side: 90,
  /** Where the box ends at the right, short of the apps' column of buttons. */
  boxRight: 900,
  /** The top of the picture. The heading grows upwards from `headingGap` above it, and with
   *  everything in it still starts below the apps' bar. */
  pictureTop: 468,
  headingGap: 24,
  /** Between the foot of the picture and the box. */
  boxGap: 26,
  /** The bottom fifth is left clear, for the captions the apps put there. */
  captionsFrom: 1536,
  /** The box runs from the left margin to the column of buttons. */
  boxScale: (900 - 90) / Panel.wideWidth,
};

/** Formats for the app's own readouts. */
export const clock = (seconds) => {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.trunc(milliseconds / 60000)}:${String(Math.trunc(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
};
export const lapTime = (milliseconds) => formatTime(milliseconds, { plain: true });
