// 棋盘氛围闸(ADR-0039,学 check-core-purity 的缩样版):常驻(infinite)动画只许
// 住在 HTML 合成层(氛围层,ambient.css——transform/opacity 由合成器线程承担),禁回
// 棋盘 SVG。SVG 子元素逐帧变动令整张 SVG 每帧重算(layout+restyle 全板失效),是
// 低端 WebView 掉帧根因(ADR-0039 归因),2026-10-31 治本后以此闸防旧病回流。
//
// 机械口径:逐行扫三个样式文件中含 infinite 的 animation 声明,animation-name 必须
// 命中本文件白名单。白名单 = 阶段性动画(只在相位窗内存活,静止期零贡献):
//   board.css   行军金环(接管期)/ 选都候选脉冲(选都期)
//   layout.css  HUD 类 HTML 元素(席位/骰签/等待点,自失效小件)+ 候选呼吸(出牌段)
//   ambient.css 四件氛围装饰(H 层即豁免理由,逐名列出防夹带)
// 新增白名单条目 = 新增阶段性动画,须先在 ADR-0039「承认的取舍」登记再动此处。
// 注:keyframes 体不含 infinite,块选择器与 animation 声明的跨行形态(项目惯例是
// animation 单行声明)不适用——声明行自含 name,dur,ease,infinite 全在一行。
const RULES: Array<{ file: string; allow: RegExp[] }> = [
  {
    file: "src/app/components/board/board.css",
    // bv-march-ring-rotor/breathe(架构体检 B 批):行军金环原单 keyframes 拆成
    // HTML 转子双动画(rotate+opacity),同一阶段性环、合成器通路,取舍同 ADR-0039。
    allow: [/^bv-march-ring-rotor$/, /^bv-march-ring-breathe$/],
  },
  {
    file: "src/app/components/board/ambient.css",
    // bv-select-pulse(架构体检 B 批):选都候选脉冲自 board.css 迁层(金盘+描边
    // 金环双通道呼吸出底板进合成层),同一阶段性口径(选都期存活),取舍同 ADR-0039。
    allow: [
      /^bv-pulse-glow$/,
      /^bv-mine-halo$/,
      /^bv-flag-sway$/,
      /^bv-token-active-breath$/,
      /^bv-select-pulse$/,
    ],
  },
  {
    file: "src/app/screens/game/layout.css",
    allow: [
      /^waiting-dots-breathe$/,
      /^war-dot-breathe$/,
      /^seat-glow$/,
      /^sign-await-breathe$/,
      /^gbtn-breathe$/, // 锦囊钮呼吸金光(#1006):窗态+架收起态的常驻呼吸,HTML 层按钮小面积辉光
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
  // 违规行号按剥前原文回查(此处只报文件+行文本,足够归因)。
  const code = content.replace(/\/\*[\s\S]*?\*\//g, "");
  // 多行声明并一行(oxfmt 对超宽值的两种规范折行都要吃):「属性冒号后换行」与
  // 「尾随逗号后换行」各并一拍,否则逗号多动画声明的名字段脱检
  // (架构体检 B 批行军金环拆双动画实踩,两种形态都出过)。
  const joined = code.replace(/([a-zA-Z-]+\s*:\s*)\n\s+/g, "$1 ").replace(/,\s*\n\s+/g, ", ");
  joined.split("\n").forEach((text) => {
    if (!text.includes("infinite")) return;
    const decl = text.match(/animation[^{;:]*:\s*([^;]+);/);
    // 名单口径 = 声明里每个动画段的名字都须在白名单(逐段验证,不看首名——
    // 首名合法掩护后续段回潮的洞要堵死)。时长可写裸数/calc()/var() 三种形态,
    // 先剥函数与关键字再认标识符;认不出名(陌生形态)保守报红。
    const keywords = new Set([
      "infinite",
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "alternate",
      "alternate-reverse",
      "reverse",
      "normal",
      "both",
      "forwards",
      "backwards",
      "none",
      "running",
      "paused",
      "step-start",
      "step-end",
    ]);
    const names: string[] = [];
    if (decl != null) {
      const flat = decl[1].replace(/var\([^)]*\)/g, " ").replace(/calc\([^)]*\)/g, " ");
      for (const seg of flat.split(",")) {
        for (const tok of seg.trim().split(/\s+/)) {
          if (!tok || keywords.has(tok) || /^[\d.]+m?s$/.test(tok)) continue;
          if (/^[a-zA-Z-]+$/.test(tok)) names.push(tok);
        }
      }
    }
    if (names.length === 0 || !names.every((n) => allow.some((re) => re.test(n)))) {
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
