import { readFileSync } from "node:fs";
import { patches } from "./chart.mjs";
const mac = readFileSync("mac-1.0.rgb");
const mean = (data, cx, cy, half) => { const sum = [0, 0, 0]; let n = 0; for (let y = Math.round(cy) - half; y <= Math.round(cy) + half; y += 1) for (let x = Math.round(cx) - half; x <= Math.round(cx) + half; x += 1) { const i = (y * 1920 + x) * 3; sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n += 1; } return sum.map((v) => v / n); };
for (const file of process.argv.slice(2)) {
  const mine = readFileSync(file); let signed = [0, 0, 0], total = 0;
  for (const p of patches) { const a = mean(mac, p.x * 1.5, p.y * 1.5, 6), b = mean(mine, p.x * 1.5, p.y * 1.5, 6); for (let c = 0; c < 3; c += 1) { signed[c] += b[c] - a[c]; total += Math.abs(b[c] - a[c]); } }
  const grey = mean(mine, patches[364].x * 1.5, patches[364].y * 1.5, 6), black = mean(mine, patches[0].x * 1.5, patches[0].y * 1.5, 6), white = mean(mine, patches[728].x * 1.5, patches[728].y * 1.5, 6);
  console.log(file.padEnd(22), "leans", signed.map((s) => (s / patches.length).toFixed(2)).join(" / "), "| average", (total / patches.length / 3).toFixed(2), "| black", black.map((v) => v.toFixed(0)).join(","), "grey", grey.map((v) => v.toFixed(0)).join(","), "white", white.map((v) => v.toFixed(0)).join(","));
}
