// OSD fonts for an analog flight controller's on-screen display: the MAX7456 chip and the AT7456E
// most whoop boards carry. A font is 256 small pictures, each 12 dots wide and 18 high, and each
// dot is white, black or see-through, so the camera's picture shows through. Betaflight draws its
// boot logo from pictures 160 to 255, 24 across and 4 down. Nothing here touches a page, so it
// can be tested by itself.
//
// A font file (.mcm) is text: a first line naming it (MAX7456), then 64 lines of eight 0s and 1s for
// each picture. Each line is a byte, four dots of two bits each, the first dot in the highest two:
// 00 black, 10 white, 01 (or 11) see-through. The 18 rows of 12 dots take 54 bytes; the other 10
// are filler, see-through in Betaflight's fonts; whatever a font keeps there is kept, as is its first
// line, so a font is written back as it came.

export const width = 12;
export const height = 18;
export const dots = width * height;
export const glyphCount = 256;

/** A dot: black, white, or see-through. */
export const BLACK = 0;
export const CLEAR = 1;
export const WHITE = 2;
/** Whether a dot is see-through: 01, or the 11 a few fonts use. */
export const isClear = (dot) => (dot & 1) === 1;

/** Where Betaflight draws its boot logo from: pictures 160 to 255, 24 across and 4 down. */
export const logo = { first: 0xa0, columns: 24, rows: 4, width: 24 * width, height: 4 * height };

/** Betaflight's own fonts, as its app offers them. Each is fetched from Betaflight when asked for. */
export const betaflightFonts = [
  ["default", "Default"], ["betaflight", "Betaflight"], ["bold", "Bold"], ["clarity", "Clarity"], ["digital", "Digital"],
  ["extra_large", "Extra large"], ["impact", "Impact"], ["impact_mini", "Impact mini"], ["large", "Large"], ["vision", "Vision"],
];
/** Where Betaflight keeps them: its configurator's own copies, for Betaflight 4 and newer. */
export const betaflightFontAddress = (id) => `https://raw.githubusercontent.com/betaflight/betaflight-configurator/master/resources/osd/2/${id}.mcm`;

const linesPerGlyph = 64;
const usedBytes = (width / 4) * height;

/**
 * A font from an .mcm file's text: `{ glyphs, count, first, filler }`, with `glyphs` a dot for each
 * of each picture's 216 dots, picture after picture, row by row, `first` the file's first line and
 * `filler` the ten bytes after each picture's dots. Some flight controllers take 512 pictures: a
 * font of more than 256 keeps them all. Null when it isn't a font.
 */
export function readFont(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (lines.length < 2 || !/^MAX7456/i.test(lines[0].trim()) && !/^[A-Za-z_]/.test(lines[0].trim())) return null;
  const bytes = [];
  for (const line of lines.slice(1)) {
    const tidy = line.trim();
    if (tidy === "") continue;
    if (!/^[01]{8}$/.test(tidy)) return null;
    bytes.push(Number.parseInt(tidy, 2));
  }
  const count = Math.floor(bytes.length / linesPerGlyph);
  if (count < glyphCount || bytes.length % linesPerGlyph !== 0) return null;
  const glyphs = new Uint8Array(count * dots);
  const filler = new Uint8Array(count * (linesPerGlyph - usedBytes));
  for (let glyph = 0; glyph < count; glyph += 1) {
    for (let byte = usedBytes; byte < linesPerGlyph; byte += 1) filler[glyph * (linesPerGlyph - usedBytes) + byte - usedBytes] = bytes[glyph * linesPerGlyph + byte];
    for (let byte = 0; byte < usedBytes; byte += 1) {
      const value = bytes[glyph * linesPerGlyph + byte];
      for (let part = 0; part < 4; part += 1) {
        const bits = (value >> (6 - part * 2)) & 3;
        // A dot is kept as its two bits: 11 is see-through as 01 is, and is written back as it came.
        glyphs[glyph * dots + byte * 4 + part] = bits;
      }
    }
  }
  return { glyphs, count, first: lines[0].trim(), filler };
}

/** A font as an .mcm file's text, as Betaflight's app writes one. */
export function writeFont({ glyphs, count, first = "MAX7456", filler = null }) {
  const lines = [first];
  const bits = (dot) => (dot === WHITE ? "10" : dot === BLACK ? "00" : dot === 3 ? "11" : "01");
  for (let glyph = 0; glyph < count; glyph += 1) {
    for (let byte = 0; byte < linesPerGlyph; byte += 1) {
      if (byte >= usedBytes) {
        lines.push((filler ? filler[glyph * (linesPerGlyph - usedBytes) + byte - usedBytes] : 0x55).toString(2).padStart(8, "0"));
        continue;
      }
      let line = "";
      for (let part = 0; part < 4; part += 1) line += bits(glyphs[glyph * dots + byte * 4 + part]);
      lines.push(line);
    }
  }
  return lines.join("\n");
}

/** A font with every picture see-through. */
export const emptyFont = (count = glyphCount) => ({ glyphs: new Uint8Array(count * dots).fill(CLEAR), count, first: "MAX7456", filler: null });

/** A copy of a font, to change without changing the one it came from. */
export const copyFont = (font) => ({ glyphs: new Uint8Array(font.glyphs), count: font.count, first: font.first ?? "MAX7456", filler: font.filler ? new Uint8Array(font.filler) : null });

/** One picture's dots, row by row. */
export const glyphOf = (font, index) => font.glyphs.slice(index * dots, (index + 1) * dots);

/** Puts one picture's dots in. */
export function setGlyph(font, index, values) {
  font.glyphs.set(values.slice(0, dots), index * dots);
}

/** The dot at a place in a picture. */
export const dotAt = (font, index, x, y) => font.glyphs[index * dots + y * width + x];

/** Sets the dot at a place in a picture. */
export function setDot(font, index, x, y, value) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  font.glyphs[index * dots + y * width + x] = value;
}

// ---- The boot logo, as one picture of 288 by 72 dots

/** The picture and the place in it of a dot of the logo. */
function logoPlace(x, y) {
  const column = Math.floor(x / width), row = Math.floor(y / height);
  return { index: logo.first + row * logo.columns + column, x: x % width, y: y % height };
}

/** The logo's dots, row by row across the whole of it. */
export function logoOf(font) {
  const picture = new Uint8Array(logo.width * logo.height);
  for (let y = 0; y < logo.height; y += 1) {
    for (let x = 0; x < logo.width; x += 1) {
      const place = logoPlace(x, y);
      picture[y * logo.width + x] = dotAt(font, place.index, place.x, place.y);
    }
  }
  return picture;
}

/** Puts a logo of 288 by 72 dots into the font's pictures 160 to 255. */
export function setLogo(font, picture) {
  for (let y = 0; y < logo.height; y += 1) {
    for (let x = 0; x < logo.width; x += 1) {
      const place = logoPlace(x, y);
      setDot(font, place.index, place.x, place.y, picture[y * logo.width + x]);
    }
  }
}

/** Sets one dot of the logo. */
export function setLogoDot(font, x, y, value) {
  if (x < 0 || y < 0 || x >= logo.width || y >= logo.height) return;
  const place = logoPlace(x, y);
  setDot(font, place.index, place.x, place.y, value);
}

// ---- Changing a picture: any rectangle of dots, a picture or the logo

/** White becomes black and black white; see-through stays. */
export const inverted = (picture) => picture.map((dot) => (dot === WHITE ? BLACK : dot === BLACK ? WHITE : dot));

/** Moves every dot one place, with see-through coming in at the edge it leaves. */
export function shifted(picture, across, dx, dy) {
  const down = picture.length / across;
  const moved = new Uint8Array(picture.length).fill(CLEAR);
  for (let y = 0; y < down; y += 1) {
    for (let x = 0; x < across; x += 1) {
      const fromX = x - dx, fromY = y - dy;
      if (fromX >= 0 && fromY >= 0 && fromX < across && fromY < down) moved[y * across + x] = picture[fromY * across + fromX];
    }
  }
  return moved;
}

/** Black round the edge of every white shape, where it meets see-through, so it stands out on
 *  any picture from the camera, as Betaflight's own letters do. */
export function outlined(picture, across) {
  const down = picture.length / across;
  const edged = new Uint8Array(picture);
  for (let y = 0; y < down; y += 1) {
    for (let x = 0; x < across; x += 1) {
      if (!isClear(picture[y * across + x])) continue;
      let beside = false;
      for (let oy = -1; oy <= 1 && !beside; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox, ny = y + oy;
          if (nx >= 0 && ny >= 0 && nx < across && ny < down && picture[ny * across + nx] === WHITE) {
            beside = true;
            break;
          }
        }
      }
      if (beside) edged[y * across + x] = BLACK;
    }
  }
  return edged;
}

/**
 * A picture from the computer, made into dots: `rgba` is its pixels, four bytes each, already
 * fitted to `across` by `down`. A pixel more see-through than not stays see-through, as does one
 * near the colour of the picture's corners when `background` is "corners" (for a logo drawn on a
 * plain colour). The rest is white where it is brighter than `split` (0 to 255) and black where it
 * is darker, the other way round with `invert`. With `outline`, white shapes get a black edge.
 */
export function dotsFromPicture(rgba, across, down, { split = 128, invert = false, background = "corners", outline = true } = {}) {
  const at = (x, y) => (y * across + x) * 4;
  const cornerColours = [[0, 0], [across - 1, 0], [0, down - 1], [across - 1, down - 1]].map(([x, y]) => [...rgba.slice(at(x, y), at(x, y) + 4)]).filter((colour) => colour[3] >= 128);
  const plain = background === "corners" && cornerColours.length > 0 ? cornerColours : [];
  const near = (r, g, b) => plain.some(([cr, cg, cb]) => Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb) < 48);
  const picture = new Uint8Array(across * down);
  for (let y = 0; y < down; y += 1) {
    for (let x = 0; x < across; x += 1) {
      const [r, g, b, a] = rgba.slice(at(x, y), at(x, y) + 4);
      if (a < 128 || near(r, g, b)) {
        picture[y * across + x] = CLEAR;
        continue;
      }
      const bright = 0.299 * r + 0.587 * g + 0.114 * b >= split;
      picture[y * across + x] = bright !== invert ? WHITE : BLACK;
    }
  }
  return outline ? outlined(picture, across) : picture;
}

// ---- What each picture is for, in Betaflight's OSD

/** Groups of pictures, by what Betaflight draws with them. Letters and numbers are the plain
 *  characters at their own places: space to underscore, capitals only. */
export const groups = [
  { id: "text", name: "Letters and numbers", glyphs: range(0x20, 0x5f) },
  { id: "battery", name: "Battery", glyphs: [...range(0x90, 0x97), 0x06, 0x9a, 0x07] },
  { id: "link", name: "Signal", glyphs: [0x01, 0x7b, 0x12] },
  { id: "timers", name: "Timers and laps", glyphs: [0x9b, 0x9c, 0x24, 0x79, 0x10] },
  { id: "crosshair", name: "Crosshair and horizon", glyphs: [0x72, 0x73, 0x74, 0x02, 0x03, 0x13, ...range(0x80, 0x88)] },
  { id: "flight", name: "Throttle, speed and height", glyphs: [0x04, 0x70, 0x9d, 0x9e, 0x9f, 0x99, 0x7f, 0x09, 0x0a, 0x75, 0x76, 0x14, 0x15, 0x7a, 0x0c, 0x0d, 0x0e, 0x0f, 0x7d, 0x7e] },
  { id: "gps", name: "GPS and home", glyphs: [0x05, 0x11, 0x1e, 0x1f, 0x89, 0x98, 0x71, ...range(0x18, 0x1d), ...range(0x60, 0x6f)] },
  { id: "sticks", name: "Stick overlay", glyphs: [0x08, 0x09, 0x0a, 0x0b, 0x16, 0x17] },
  { id: "bar", name: "Progress bar", glyphs: range(0x8a, 0x8f) },
  { id: "logo", name: "Boot logo", glyphs: range(logo.first, logo.first + logo.columns * logo.rows - 1) },
];

function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** What Betaflight draws a picture for, in a few words. */
const purposes = {
  0x01: "Signal strength (RSSI)", 0x02: "Horizon, right end", 0x03: "Horizon, left end; the menu's cursor", 0x04: "Throttle", 0x05: "Distance from home",
  0x06: "Volts", 0x07: "mAh used", 0x08: "Stick overlay, high; GPS degrees", 0x09: "Stick overlay, middle; above the highest", 0x0a: "Stick overlay, low; below zero",
  0x0b: "Stick overlay, centre", 0x0c: "Metres", 0x0d: "Degrees Fahrenheit", 0x0e: "Degrees Celsius", 0x0f: "Feet",
  0x10: "Blackbox logging", 0x11: "Home", 0x12: "Headset", 0x13: "Horizon's side marks", 0x14: "Roll", 0x15: "Pitch",
  0x16: "Stick overlay, up and down", 0x17: "Stick overlay, across", 0x18: "Heading N", 0x19: "Heading S", 0x1a: "Heading E", 0x1b: "Heading W",
  0x1c: "Heading, divided line", 0x1d: "Heading line", 0x1e: "Satellites, left", 0x1f: "Satellites, right", 0x24: "Chequered flag",
  0x70: "Speed", 0x71: "Distance flown", 0x72: "Crosshair, left", 0x73: "Crosshair, centre", 0x74: "Crosshair, right", 0x75: "Small arrow up", 0x76: "Small arrow down",
  0x79: "Last lap's time", 0x7a: "Temperature", 0x7b: "Link quality", 0x7d: "Kilometres", 0x7e: "Miles", 0x7f: "Altitude",
  0x89: "Latitude", 0x8a: "Progress bar, start", 0x8b: "Progress bar, full", 0x8c: "Progress bar, half", 0x8d: "Progress bar, empty", 0x8e: "Progress bar, end", 0x8f: "Progress bar, close",
  0x90: "Battery, full", 0x91: "Battery, 5 of 6", 0x92: "Battery, 4 of 6", 0x93: "Battery, 3 of 6", 0x94: "Battery, 2 of 6", 0x95: "Battery, 1 of 6", 0x96: "Battery, empty", 0x97: "Main battery",
  0x98: "Longitude", 0x99: "Feet a second", 0x9a: "Amps", 0x9b: "Time switched on", 0x9c: "Time flying", 0x9d: "Miles an hour", 0x9e: "Kilometres an hour", 0x9f: "Metres a second",
};

/** What a picture is: its number, the character it is when it is one, and what Betaflight uses it for. */
export function describeGlyph(index) {
  const character = index >= 0x20 && index <= 0x5f ? String.fromCharCode(index) : null;
  const group = groups.find((one) => one.glyphs.includes(index));
  let purpose = purposes[index] ?? null;
  if (index >= 0x60 && index <= 0x6f) purpose = `Direction arrow ${index - 0x5f} of 16`;
  if (index >= 0x80 && index <= 0x88) purpose = `Horizon bar, step ${index - 0x80 + 1} of 9`;
  if (index >= logo.first && index < logo.first + logo.columns * logo.rows) {
    const place = index - logo.first;
    purpose = `Boot logo, row ${Math.floor(place / logo.columns) + 1}, column ${(place % logo.columns) + 1}`;
  }
  if (character && !purpose) purpose = character === " " ? "Space" : `The character ${character}`;
  return { index, hex: `0x${index.toString(16).toUpperCase().padStart(2, "0")}`, character, purpose: purpose ?? "Not used by Betaflight", group: group?.id ?? null };
}

/** Puts some of another font's pictures in place of a font's own. */
export function takeGlyphs(font, from, indexes) {
  for (const index of indexes) {
    if (index < from.count && index < font.count) setGlyph(font, index, glyphOf(from, index));
  }
}

/** A font's file name as the pilot gives it: letters, numbers, spaces and a few marks, and not too long. */
export function fontName(text) {
  const name = String(text ?? "").replace(/\.mcm$/i, "").replace(/[^A-Za-z0-9 _()+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name;
}
