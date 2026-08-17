// 视觉对照(React 重构验收):两版截图的像素差异统计 + 差异热区图。
// 用法:tsx scripts/visual-diff.ts screenshots/old-board.png screenshots/new-board.png
// 输出:差异像素占比 / 平均通道差 / 按行聚类的差异热区(前 5 块),并写 *-diff.png。
// 注意:两版状态并非逐字节同局(版式/字号有差异),指标用于定位"差异集中在哪",
// 人工再对照截图判断是否可接受。
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) throw new Error("用法: visual-diff.ts <old.png> <new.png>");
const a = PNG.sync.read(readFileSync(aPath));
const b = PNG.sync.read(readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  throw new Error(`尺寸不一致:${a.width}x${a.height} vs ${b.width}x${b.height}`);
}

const diff = new PNG({ width: a.width, height: a.height });
let diffPixels = 0;
let sumDelta = 0;
const rowDiff = new Uint32Array(a.height);
for (let y = 0; y < a.height; y++) {
  for (let x = 0; x < a.width; x++) {
    const i = (a.width * y + x) << 2;
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    const over = d > 30; // 通道合计差阈值(抗噪)
    if (over) {
      diffPixels++;
      rowDiff[y]++;
    }
    sumDelta += d;
    // 热区图:差异越大越红,底为白
    const heat = over ? Math.min(255, 80 + d) : 0;
    diff.data[i] = 255 - heat;
    diff.data[i + 1] = 255 - heat;
    diff.data[i + 2] = 255;
    diff.data[i + 3] = 255;
  }
}
writeFileSync(aPath.replace(/\.png$/, "") + "-diff.png", PNG.sync.write(diff));

const total = a.width * a.height;
console.log(`${aPath.split(/[\\/]/).pop()} vs ${bPath.split(/[\\/]/).pop()}`);
console.log(`  差异像素占比: ${((diffPixels / total) * 100).toFixed(1)}%  平均通道差: ${(sumDelta / total / 3).toFixed(1)}`);

// 行聚类:连续高差异行 → 热区块
const bands: { from: number; to: number }[] = [];
let start = -1;
for (let y = 0; y < a.height; y++) {
  const heavy = rowDiff[y] > a.width * 0.05;
  if (heavy && start < 0) start = y;
  if ((!heavy || y === a.height - 1) && start >= 0) {
    bands.push({ from: start, to: y });
    start = -1;
  }
}
console.log(`  差异热区(行带,自上而下): ${bands.slice(0, 8).map((x) => `[${x.from}-${x.to}]`).join(" ") || "无"}`);
