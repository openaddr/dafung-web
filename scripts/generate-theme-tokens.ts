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
lines.push(
  "  /* ── 动效·时长(--dur-*):短→长承担 反馈→面板→大件→演出→常驻;呼吸类统一 --dur-ambient(允许整数倍/半频 calc 特例) ── */",
  "  --dur-instant: 80ms; /* 按压/hover 即时反馈,一触即应 */",
  "  --dur-fast: 150ms; /* 遮罩、高亮等轻量快过渡(旧 fast 0.15s 口径) */",
  "  --dur-med: 250ms; /* 面板入退场、屏幕切换(旧 mid 0.25s 口径) */",
  "  --dur-slow: 400ms; /* 大件入场单拍(旧 slow 0.4s 口径) */",
  "  --dur-reveal: 600ms; /* 胜利阶梯、镜头等揭晓感长拍 */",
  "  --dur-fx: 1300ms; /* 浮字类瞬时演出(对齐 fx 层 1300ms 口径,fx/timings.ts FX.floaterMs 同步) */",
  "  --dur-ambient: 2600ms; /* 常驻呼吸基准:摇曳/脉动等 infinite 动画挂此,个体允许整数倍/半频 */",
  "  /* ── 动效·缓动(--ease-*):入场/退场/回弹/呼吸各一,替换全仓并存的 8 种缓动字面量 ── */",
  "  --ease-out: cubic-bezier(0.22, 1, 0.36, 1); /* 入场/放大默认:起快收慢(覆盖 Tailwind 默认 ease-out) */",
  "  --ease-in: cubic-bezier(0.4, 0, 1, 1); /* 退场/离场:起慢收快,加速离场不拖泥带水 */",
  "  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1); /* 回弹弹入(back 类统一此条):过冲再落定 */",
  "  --ease-sine: cubic-bezier(0.45, 0, 0.55, 1); /* 呼吸/脉冲与行军/镜头:easeInOutSine,两端缓中段匀 */",
);

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
