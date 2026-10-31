// 棋盘氛围闸(ADR-0039,学 check-core-purity 的缩样版):常驻(infinite)动画只许
// 住在 HTML 合成层(氛围层,ambient.css——transform/opacity 由合成器线程承担),禁回
// 棋盘 SVG。SVG 子元素逐帧变动令整张 SVG 每帧重算(layout+restyle 全板失效),是
// 低端 WebView 掉帧根因(ADR-0039 归因),2026-10-31 治本后以此闸防旧病回流。
//
// 机械口径:逐行扫三个样式文件中含 infinite 的 animation 声明,animation-name 必须
// 命中本文件白名单。白名单 = 阶段性动画(只在相位窗内存活,静止期零贡献):
//   board.css   行军金环(接管期)/ 选都候选脉冲(选都期)
//   layout.css  HUD 类 HTML 元素(席位/骰签/等待点,自失效小件)+ 候选呼吸(出牌段)
//   ambient.css 五件氛围装饰(H 层即豁免理由,逐名列出防夹带)
// 新增白名单条目 = 新增阶段性动画,须先在 ADR-0039「承认的取舍」登记再动此处。
// 注:keyframes 体不含 infinite,块选择器与 animation 声明的跨行形态(项目惯例是
// animation 单行声明)不适用——声明行自含 name,dur,ease,infinite 全在一行。
const RULES: Array<{ file: string; allow: RegExp[] }> = [
  {
    file: "src/app/components/board/board.css",
    allow: [/^bv-march-ring$/, /^bv-select-pulse$/],
  },
  {
    file: "src/app/components/board/ambient.css",
    allow: [
      /^bv-pulse-glow$/,
      /^bv-ring-orbit$/,
      /^bv-mine-halo$/,
      /^bv-flag-sway$/,
      /^bv-token-active-breath$/,
    ],
  },
  {
    file: "src/app/screens/game/layout.css",
    allow: [
      /^waiting-dots-breathe$/,
      /^war-dot-breathe$/,
      /^seat-glow$/,
      /^sign-await-breathe$/,
      /^seat-selglow$/,
      /^rotate-hint-turn$/, // 竖屏「请横屏」提示层(全屏 HTML 元素,自失效小件)
      /^bv-token-target-pulse$/,
    ],
  },
];

interface Violation {
  file: string;
  text: string;
}

const violations: Violation[] = [];
for (const { file, allow } of RULES) {
  const content = await Bun.file(`${import.meta.dir}/../${file}`).text();
  // 先剥块注释再扫描(同 check-core-purity 口径):红线禁的是「使用」,注释提及不算;
  // 剥完逐行行号已不可对齐原文——违规行号按剥前原文回查(此处只报文件+行文本,足够归因)。
  const code = content.replace(/\/\*[\s\S]*?\*\//g, "");
  code.split("\n").forEach((text) => {
    if (!text.includes("infinite")) return;
    const m = text.match(/animation\s*:\s*([a-zA-Z-]+)/);
    const name = m?.[1] ?? "";
    if (!allow.some((re) => re.test(name))) {
      violations.push({ file, text: text.trim().slice(0, 90) });
    }
  });
}

if (violations.length > 0) {
  console.error("[check:board] 棋盘 SVG 常驻动画回流(ADR-0039):infinite 动画只许住氛围层");
  for (const v of violations) {
    console.error(`  ${v.file}  ${v.text}`);
  }
  console.error("  阶段性动画白名单新增须先登记 ADR-0039「承认的取舍」;常驻装饰一律走氛围层。");
  process.exit(1);
}
console.log("[check:board] OK:常驻动画全数住在氛围层,白名单内阶段性动画无回流");
