// What the Mac app made of every colour of the dense chart, read from its video's own numbers
// (luma and the two colour differences) and turned into red, green and blue by the standard's
// arithmetic, in full precision. (FFmpeg's quick way of doing that for a picture file reads a
// level or two low near white, and a table made that way made every video a little dark.)
import { openSync, readSync, closeSync, writeFileSync } from "node:fs";
import { N, pw, ph, hold, perPicture, pictures, place } from "./dense.mjs";
const W = 1920, H = 1080, size = W * H * 1.5;
const fd = openSync("mac-dense.yuv", "r");
const frame = (index) => { const data = Buffer.alloc(size); readSync(fd, data, 0, size, index * size); return data; };
const plane = (data, offset, width, cx, cy, hx, hy) => { let sum = 0, n = 0; for (let y = Math.round(cy - hy); y <= Math.round(cy + hy); y += 1) for (let x = Math.round(cx - hx); x <= Math.round(cx + hx); x += 1) { sum += data[offset + y * width + x]; n += 1; } return sum / n; };
const lines = ["# What the Mac app's video engine makes of each colour of a goggle recording", "# (full-range BT.601 in, as FFmpeg reads it; BT.709 out). Measured off that engine, not worked out.", `LUT_3D_SIZE ${N}`];
const made = new Float64Array(N * N * N * 3);
for (let picture = 0; picture < pictures; picture += 1) {
  // The last five frames of each picture's hold, taken together.
  const frames = [6, 5, 4, 3, 2].map((back) => frame(picture * hold + hold - back));
  for (let index = picture * perPicture; index < Math.min(N * N * N, (picture + 1) * perPicture); index += 1) {
    const { x, y } = place(index), cx = (x + pw / 2) * 1.5 - 0.5, cy = (y + ph / 2) * 1.5 - 0.5;
    let Y = 0, U = 0, V = 0;
    for (const data of frames) { Y += plane(data, 0, W, cx, cy, 8, 5); U += plane(data, W * H, W / 2, cx / 2, cy / 2, 3, 2); V += plane(data, W * H * 1.25, W / 2, cx / 2, cy / 2, 3, 2); }
    const luma = (Y / 5 - 16) / 219, pb = (U / 5 - 128) / 224, pr = (V / 5 - 128) / 224;
    const rgb = [luma + 1.5748 * pr, luma - 0.187324 * pb - 0.468124 * pr, luma + 1.8556 * pb];
    for (let c = 0; c < 3; c += 1) made[index * 3 + c] = Math.min(1, Math.max(0, rgb[c]));
  }
}
closeSync(fd);
for (let index = 0; index < N * N * N; index += 1) lines.push([0, 1, 2].map((c) => made[index * 3 + c].toFixed(5)).join(" "));
writeFileSync("mac-picture.cube", lines.join("\n") + "\n");
const at = (r, g, b) => [0, 1, 2].map((c) => (made[((b * N + g) * N + r) * 3 + c] * 255).toFixed(1));
console.log("greys:", [0, 2, 4, 8, 16, 24, 32].map((i) => `${Math.round((i * 255) / 32)}->${at(i, i, i).join("/")}`).join("  "));
console.log("red, green, blue at full:", at(32, 0, 0).join(","), "|", at(0, 32, 0).join(","), "|", at(0, 0, 32).join(","));
