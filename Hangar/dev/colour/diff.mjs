import { spawnSync } from "node:child_process";
const [ff, a, b, size] = process.argv.slice(2);
const read = (file) => spawnSync(ff, ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 }).stdout;
const one = read(a), two = read(b);
let total = 0, signed = [0, 0, 0], big = 0;
for (let i = 0; i < one.length; i += 1) { const d = two[i] - one[i]; total += Math.abs(d); signed[i % 3] += d; if (Math.abs(d) > 12) big += 1; }
const n = one.length / 3;
console.log(`${size}: on average ${(total / one.length).toFixed(2)} levels apart; the new app is ${signed.map((s) => (s / n >= 0 ? "+" : "") + (s / n).toFixed(2)).join(" / ")} (red / green / blue) against the Mac app; ${((big / one.length) * 100).toFixed(2)}% of values more than 12 apart`);
