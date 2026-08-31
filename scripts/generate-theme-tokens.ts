// 配色与动效单源生成器:从 core/theme.ts 的 Theme/Motion 对象生成 Tailwind v4 @theme token 文件。
// 唯一源 = theme.ts。改色/改节奏只改 theme.ts,然后 `bun run gen:theme` 重新生成 tokens.css。
// 产出:src/app/styles/tokens.css(--color-* / --font-* / --dur-* / --ease-*),由 app.css @import。
// core/ 零 DOM 依赖的红线不破:本脚本属构建工具(scripts/),不进 core。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Theme, Motion } from "../src/core/theme.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/app/styles/tokens.css");

const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const lines: string[] = [
  "/* ⚠️ 自动生成,勿手改 — 来源 src/core/theme.ts(Theme + Motion),运行 `bun run gen:theme` 再生成 */",
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

// ── 动效 token(R3-C1 #88):唯一源 core/theme.ts Motion,消费一律 var(),不写回退值 ──
// --ease-out/--ease-in 有意落在 Tailwind v4 的 --ease-* 命名空间上:同值覆盖框架默认
// 缓动,TSX 里写 ease-out/ease-in 工具类即得到同一曲线。
// dur 以毫秒数存于 Motion,单位 ms 在此序列化时拼接;逐键调参理由见 theme.ts 各键注释。
lines.push(
  "  /* ── 动效·时长(--dur-*):短→长承担 反馈→面板→大件→演出→常驻;呼吸类统一 --dur-ambient(允许整数倍/半频 calc 特例) ── */",
);
for (const [key, ms] of Object.entries(Motion.dur)) {
  lines.push(`  --dur-${kebab(key)}: ${ms}ms;`);
}

lines.push(
  "  /* ── 动效·缓动(--ease-*):入场/退场/回弹/呼吸各一,替换全仓并存的 8 种缓动字面量 ── */",
);
for (const [key, curve] of Object.entries(Motion.ease)) {
  lines.push(`  --ease-${kebab(key)}: ${curve};`);
}

lines.push(
  '  --font-brush: "Ma Shan Zheng", "ZCOOL XiaoWei", "KaiTi", "STKaiti", serif;',
  '  --font-deco: "ZCOOL XiaoWei", "KaiTi", serif;',
  // A4(#51):霞鹜文楷——规则/事件说明正文用(public/fonts/wenkai/ 分片自托管,OFL)。
  // 排在字栈首位,语料外字符回退 KaiTi(同为楷体)。
  '  --font-wenkai: "LXGW WenKai", "KaiTi", "STKaiti", serif;',
  // A7(#54):龙藏行书——玩家国号输入位点缀用(public/fonts/long-cang/ 分片自托管,OFL)。
  // 手写字体;语料外罕用字回退 Ma Shan Zheng(同为手写体)。
  '  --font-hand: "Long Cang", "Ma Shan Zheng", "KaiTi", cursive;',
  "}",
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`[gen:theme] ${OUT} 已生成(${lines.length - 3} 个 token)`);
