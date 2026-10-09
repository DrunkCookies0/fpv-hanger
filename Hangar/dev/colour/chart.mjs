// Two test pictures as raw RGB, each held for two seconds at 60 frames a second:
//   A: every mix of nine levels of red, green and blue (729 patches), in the left three quarters
//   B: ramps of grey, red, green, blue, cyan, magenta and yellow, 189 steps each
import { writeSync } from "node:fs";
const W = 1280, H = 720, levels = [0, 32, 64, 96, 128, 160, 192, 224, 255];
const A = Buffer.alloc(W * H * 3, 64), B = Buffer.alloc(W * H * 3, 64);
export const patches = [], steps = [];
for (let index = 0; index < 729; index += 1) {
  const r = levels[index % 9], g = levels[Math.floor(index / 9) % 9], b = levels[Math.floor(index / 81)];
  const col = index % 27, row = Math.floor(index / 27);
  patches.push({ x: col * 35 + 17, y: row * 26 + 13, rgb: [r, g, b] });
  for (let y = row * 26; y < row * 26 + 26; y += 1) for (let x = col * 35; x < col * 35 + 35; x += 1) A.set([r, g, b], (y * W + x) * 3);
}
const bands = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
bands.forEach((mix, band) => {
  for (let step = 0; step < 189; step += 1) {
    const value = Math.round((step * 255) / 188);
    const rgb = mix.map((on) => on * value);
    steps.push({ x: step * 5 + 2, y: band * 100 + 50, rgb, band });
    for (let y = band * 100; y < band * 100 + 100; y += 1) for (let x = step * 5; x < step * 5 + 5; x += 1) B.set(rgb, (y * W + x) * 3);
  }
});
if (process.argv[2] === "frames") {
  for (let frame = 0; frame < 120; frame += 1) writeSync(1, A);
  for (let frame = 0; frame < 150; frame += 1) writeSync(1, B);
}
