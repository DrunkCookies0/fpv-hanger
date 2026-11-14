// OSD fonts: reading and writing an .mcm file, the boot logo as one picture, changing pictures,
// and a picture from the computer made into dots. Every font here is made up.
import test from "node:test";
import assert from "node:assert/strict";
import {
  readFont, writeFont, emptyFont, copyFont, glyphOf, setGlyph, dotAt, setDot, logoOf, setLogo, setLogoDot, logo,
  inverted, shifted, outlined, dotsFromPicture, describeGlyph, takeGlyphs, fontName, groups, BLACK, WHITE, CLEAR, width, height, dots,
} from "../shared/osdfont.js";

/** A made-up font: each picture has a white dot at a place set by its number, and a black one beside it. */
function madeUp(count = 256) {
  const font = emptyFont(count);
  for (let index = 0; index < count; index += 1) {
    setDot(font, index, index % width, index % height, WHITE);
    setDot(font, index, (index + 1) % width, index % height, BLACK);
  }
  return font;
}

test("a font is written as Betaflight writes one, and read back the same", () => {
  const font = madeUp();
  const text = writeFont(font);
  const lines = text.split("\n");
  assert.equal(lines[0], "MAX7456");
  assert.equal(lines.length, 1 + 256 * 64);
  assert.ok(lines.slice(1).every((line) => /^[01]{8}$/.test(line)));
  // The same length as Betaflight's own files: no line break at the end.
  assert.equal(text.length, 8 + 256 * 64 * 9 - 1);
  // Picture 0: white at (0,0), black at (1,0), the rest see-through: 10 00 01 01.
  assert.equal(lines[1], "10000101");
  // The ten filler bytes after a picture's 54 are see-through.
  assert.deepEqual(lines.slice(55, 65), Array(10).fill("01010101"));
  const back = readFont(text);
  assert.equal(back.count, 256);
  assert.deepEqual(back.glyphs, font.glyphs);
});

test("a font with Windows line ends, another first line, or 512 pictures is read too; anything else isn't", () => {
  const font = madeUp();
  const text = writeFont(font);
  assert.deepEqual(readFont(text.replace(/\n/g, "\r\n")).glyphs, font.glyphs);
  assert.deepEqual(readFont(`${text}\n`).glyphs, font.glyphs);
  // A font keeps its own first line, and whatever it keeps after each picture's dots.
  const own = text.replace("MAX7456", "FBOSD_SMALL").replace(/(\n[01]{8}){54}\n01010101/, (found) => found.replace(/01010101$/, "00000000"));
  const ownFont = readFont(own);
  assert.deepEqual(ownFont.glyphs, font.glyphs);
  assert.equal(writeFont(ownFont), own);
  const big = madeUp(512);
  const read = readFont(writeFont(big));
  assert.equal(read.count, 512);
  assert.deepEqual(read.glyphs, big.glyphs);
  // 11 is see-through as well as 01.
  const eleven = readFont(text.replace(/\n01010101/, "\n11111111"));
  assert.ok(eleven);
  assert.equal(readFont(""), null);
  assert.equal(readFont("MAX7456\n0101"), null);
  assert.equal(readFont(text.split("\n").slice(0, 1000).join("\n")), null);
  assert.equal(readFont(text.replace("\n01010101", "\n0101010x")), null);
});

test("the boot logo is pictures 160 to 255, 24 across and 4 down, as one picture of 288 by 72", () => {
  assert.deepEqual([logo.first, logo.width, logo.height], [160, 288, 72]);
  const font = emptyFont();
  // The dot at the logo's bottom right corner is the last dot of picture 255.
  setLogoDot(font, 287, 71, WHITE);
  assert.equal(dotAt(font, 255, 11, 17), WHITE);
  // Second row, third column, top left: picture 160 + 24 + 2.
  setLogoDot(font, 24, 18, BLACK);
  assert.equal(dotAt(font, 186, 0, 0), BLACK);
  const picture = logoOf(font);
  assert.equal(picture.length, 288 * 72);
  assert.equal(picture[71 * 288 + 287], WHITE);
  assert.equal(picture[18 * 288 + 24], BLACK);
  // Set back from a picture, it is the same, and pictures before 160 aren't touched.
  const other = madeUp();
  const before = glyphOf(other, 159);
  setLogo(other, picture);
  assert.deepEqual(logoOf(other), picture);
  assert.deepEqual(glyphOf(other, 159), before);
});

test("a picture's dots are changed: swapped, moved and edged", () => {
  const glyph = new Uint8Array(dots).fill(CLEAR);
  glyph[0] = WHITE;
  glyph[1] = BLACK;
  const swapped = inverted(glyph);
  assert.deepEqual([swapped[0], swapped[1], swapped[2]], [BLACK, WHITE, CLEAR]);
  const right = shifted(glyph, width, 1, 0);
  assert.deepEqual([right[0], right[1], right[2]], [CLEAR, WHITE, BLACK]);
  const up = shifted(glyph, width, 0, -1);
  assert.ok(up.every((dot) => dot === CLEAR));
  // A white dot in the middle gets black all round it.
  const middle = new Uint8Array(dots).fill(CLEAR);
  middle[9 * width + 6] = WHITE;
  const edged = outlined(middle, width);
  assert.equal(edged[9 * width + 6], WHITE);
  for (const [x, y] of [[5, 8], [6, 8], [7, 8], [5, 9], [7, 9], [5, 10], [6, 10], [7, 10]]) assert.equal(edged[y * width + x], BLACK, `${x},${y}`);
  assert.equal(edged[9 * width + 8], CLEAR);
});

test("a picture from the computer is made into white, black and see-through", () => {
  // Four by two: a red corner background, a white dot, a dark grey dot, a see-through pixel.
  const red = [200, 30, 30, 255];
  const rgba = new Uint8Array([
    ...red, ...[255, 255, 255, 255], ...[40, 40, 40, 255], ...red,
    ...red, ...[0, 0, 0, 0], ...[250, 250, 250, 255], ...red,
  ]);
  const plain = dotsFromPicture(rgba, 4, 2, { outline: false });
  assert.deepEqual([...plain], [CLEAR, WHITE, BLACK, CLEAR, CLEAR, CLEAR, WHITE, CLEAR]);
  // The background kept as it is, the split higher, and the other way round.
  const kept = dotsFromPicture(rgba, 4, 2, { background: "keep", outline: false });
  assert.equal(kept[0], BLACK);
  const flipped = dotsFromPicture(rgba, 4, 2, { invert: true, outline: false });
  assert.deepEqual([flipped[1], flipped[2]], [BLACK, WHITE]);
  const darker = dotsFromPicture(rgba, 4, 2, { split: 252, outline: false });
  assert.equal(darker[6], BLACK);
  // With an outline, see-through beside white turns black.
  const edged = dotsFromPicture(rgba, 4, 2);
  assert.equal(edged[0], BLACK);
});

test("each picture says what Betaflight uses it for", () => {
  assert.deepEqual(describeGlyph(0x41), { index: 0x41, hex: "0x41", character: "A", purpose: "The character A", group: "text" });
  assert.equal(describeGlyph(0x01).purpose, "Signal strength (RSSI)");
  assert.equal(describeGlyph(0x90).group, "battery");
  assert.equal(describeGlyph(0x61).purpose, "Direction arrow 2 of 16");
  assert.equal(describeGlyph(0xa0).purpose, "Boot logo, row 1, column 1");
  assert.equal(describeGlyph(0xff).purpose, "Boot logo, row 4, column 24");
  assert.equal(describeGlyph(0x00).purpose, "Not used by Betaflight");
  assert.equal(groups.find((group) => group.id === "logo").glyphs.length, 96);
});

test("some of another font's pictures are taken in place of a font's own", () => {
  const font = emptyFont(), other = madeUp();
  const battery = groups.find((group) => group.id === "battery").glyphs;
  const mine = copyFont(font);
  takeGlyphs(mine, other, battery);
  for (const index of battery) assert.deepEqual(glyphOf(mine, index), glyphOf(other, index));
  assert.deepEqual(glyphOf(mine, 0x41), glyphOf(font, 0x41));
  // The font it came from is left as it was.
  assert.ok(glyphOf(font, 0x90).every((dot) => dot === CLEAR));
  setGlyph(mine, 0x41, new Uint8Array(dots).fill(WHITE));
  assert.ok(glyphOf(mine, 0x41).every((dot) => dot === WHITE));
  assert.equal(height * width, dots);
});

test("a font's name is kept to what a file can be called", () => {
  assert.equal(fontName("My whoop font.mcm"), "My whoop font");
  assert.equal(fontName("  race/../../logo?  "), "racelogo");
  assert.equal(fontName("a/b\\c:d"), "abcd");
  assert.equal(fontName(""), "");
  assert.equal(fontName("x".repeat(80)).length, 40);
});
