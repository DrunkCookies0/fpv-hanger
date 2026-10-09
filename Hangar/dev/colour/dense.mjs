// A denser chart: every mix of 33 levels of red, green and blue (35,937 patches), 2,070 to a
// picture, each picture held for twelve frames. Patches are 21 by 15 in the left three quarters.
import { writeSync } from "node:fs";
export const W = 1280, H = 720, N = 33, cols = 45, rowsPer = 46, pw = 21, ph = 15, hold = 12;
export const level = (i) => Math.round((i * 255) / (N - 1));
export const perPicture = cols * rowsPer, pictures = Math.ceil((N * N * N) / perPicture);
export const place = (index) => ({ picture: Math.floor(index / perPicture), x: ((index % perPicture) % cols) * pw, y: Math.floor((index % perPicture) / cols) * ph });
if (process.argv[2] === "frames") {
  for (let picture = 0; picture < pictures; picture += 1) {
    const frame = Buffer.alloc(W * H * 3, 64);
    for (let index = picture * perPicture; index < Math.min(N * N * N, (picture + 1) * perPicture); index += 1) {
      const rgb = [level(index % N), level(Math.floor(index / N) % N), level(Math.floor(index / (N * N)))];
      const { x, y } = place(index);
      for (let yy = y; yy < y + ph; yy += 1) for (let xx = x; xx < x + pw; xx += 1) frame.set(rgb, (yy * W + xx) * 3);
    }
    for (let repeat = 0; repeat < hold; repeat += 1) writeSync(1, frame);
  }
}
