// 配色单源生成器:从 core/theme.ts 的 Theme 对象生成 Tailwind v4 @theme token 文件。
// 唯一源 = theme.ts。改色只改 theme.ts,然后 `npm run gen:theme` 重新生成 tokens.css。
// 产出:src/app/styles/tokens.css(--color-* / --font-*),由 app.css @import。
// core/ 零 DOM 依赖的红线不破:本脚本属构建工具(scripts/),不进 core。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Theme } from "../src/core/theme.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/app/styles/tokens.css");

const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const lines: string[] = [
  "/* ⚠️ 自动生成,勿手改 — 来源 src/core/theme.ts,运行 `npm run gen:theme` 再生成 */",
  "@theme {",
];

for (const [key, value] of Object.entries(Theme)) {
  if (typeof value !== "object" || value === null || !("r" in (value as object))) continue; // 跳过 groupNames 等非颜色
  lines.push(`  --color-${kebab(key)}: ${toHex(value as { r: number; g: number; b: number })};`);
}

// 地产分组色:--color-group-a … --color-group-h
for (const [group, rgb] of Object.entries(Theme.groupColors)) {
  lines.push(`  --color-group-${group}: ${toHex(rgb)};`);
}

lines.push(
  '  --font-brush: "Ma Shan Zheng", "ZCOOL XiaoWei", "KaiTi", "STKaiti", serif;',
  '  --font-body: "Noto Serif SC", "ZCOOL XiaoWei", "KaiTi", "STKaiti", serif;',
  '  --font-deco: "ZCOOL XiaoWei", "KaiTi", serif;',
  "}",
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`[gen:theme] ${OUT} 已生成(${lines.length - 3} 个 token)`);
