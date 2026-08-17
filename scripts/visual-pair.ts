// 拼左右对照图:old | new,中间 8px 分隔线,供视觉模型比对。
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [aPath, bPath, outPath] = process.argv.slice(2);
const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));
const GAP = 8;
const out = new PNG({ width: a.width + GAP + b.width, height: Math.max(a.height, b.height) });
for (let y = 0; y < out.height; y++) {
  for (let x = 0; x < out.width; x++) {
    const i = (out.width * y + x) << 2;
    if (x < a.width && y < a.height) {
      const s = (a.width * y + x) << 2;
      out.data.set(a.data.subarray(s, s + 4), i);
    } else if (x >= a.width + GAP && y < b.height) {
      const s = (b.width * y + (x - a.width - GAP)) << 2;
      out.data.set(b.data.subarray(s, s + 4), i);
    } else {
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
    }
  }
}
writeFileSync(outPath, PNG.sync.write(out));
console.log(`[pair] ${outPath} (${out.width}x${out.height})`);
