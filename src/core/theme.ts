// 古风水墨设计系统:宣纸色板、墨/朱砂/赭石/石青/金/青绿、地产分组色、玩家色、动效时长/缓动。
// 改这里即全局换肤/换动效节奏。
//
// 配色与动效唯一源:本文件 Theme / Motion 对象。Tailwind token 由
// scripts/generate-theme-tokens.ts 自动生成 src/app/styles/tokens.css(bun run gen:theme),
// 改色改节奏只改这里——旧「与 style.css 双源人工同步」的约定已随 React/Tailwind 迁移作废。

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const hex = (h: string): Rgb => {
  const s = h.replace("#", "");
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
};

export const rgba = (c: Rgb, a = 1): string => `rgba(${c.r},${c.g},${c.b},${a})`;

export const Theme = {
  // 古风核心配色(视觉重做 v2「一纸墨戏,方寸庙堂」:纸提亮半档降黄褐,
  // 新增 lacquer/goldDeep/lacquerGold 三个「墨钮/金字」材质位,详见 docs/design/DESIGN.md §4)
  bg: hex("eae0c6"), // 宣纸(案头桌面)
  bgDeep: hex("dccfa9"), // 宣纸深(远山/阴影)
  panel: hex("f4ecd8"), // 浅宣纸面板(笺纸面)
  panelHi: hex("e6d9b4"), // 笺纸衬里/hover
  paperHi: hex("faf3df"), // 卷轴体渐变亮端(ScrollShell/ConfirmDialog 纸面)
  paperLo: hex("eee0bc"), // 卷轴体渐变暗端
  ink: hex("2b2317"), // 焦墨(正文/标题)
  inkDim: hex("6f6146"), // 重墨(次级文字)
  lacquer: hex("332a1e"), // 浓墨漆木(主按钮底/卷轴杆)——墨=落子无悔,主行动色
  lacquerGold: hex("d9b95c"), // 漆底金字(墨钮文字/杆箍线)
  gold: hex("c8a13a"), // 鎏金(轮次/能量/金印,不再作按钮底)
  goldBright: hex("d4af37"), // 亮金(都城光晕/行军拖影)
  goldDeep: hex("8a6a1c"), // 熟金(纸底金字可读档,对比 ≥4.5:1)
  money: hex("4a7a4a"), // 青绿(收入)
  danger: hex("b23a2e"), // 朱砂(印章/扣减/税/破产)
  success: hex("059669"), // 在线/成功(原 emerald-600,收编进单源)
  sealQing: hex("3f6a6b"), // 黛青(次级印章,中性事件)

  // 驿道
  roadMain: hex("7a5c38"), // 主路褐(加深一档增墨感)
  roadSide: hex("b5713a"), // 支路赭石

  // 墨色深浅(远山/书法)
  inkwash: hex("9c8a5e"),

  // 地产分组色(a–h,降饱和配宣纸)
  groupColors: {
    a: hex("8a5a3a"), // 中原
    b: hex("3a6a8a"), // 荆楚
    c: hex("7a3a6a"), // 岭南
    d: hex("c47a2a"), // 巴蜀
    e: hex("5a8a4a"), // 西凉
    f: hex("9a3a2a"), // 幽燕
    g: hex("2a6a8a"), // 青徐
    h: hex("2a8a7a"), // 江东
  } as Record<string, Rgb>,

  groupNames: {
    a: "中原",
    b: "荆楚",
    c: "岭南",
    d: "巴蜀",
    e: "西凉",
    f: "幽燕",
    g: "青徐",
    h: "江东",
  } as Record<string, string>,

  // 玩家色(8 色,用于旌旗/边框/王旗;上限 8 人,一席一色)
  playerColors: [
    hex("2a6a8a"), // 石青
    hex("b23a2e"), // 朱砂
    hex("5a8a4a"), // 青绿
    hex("7a3a6a"), // 紫
    hex("c47a2a"), // 赭橙
    hex("2a8a7a"), // 松绿
    hex("9a7a1f"), // 鎏金
    hex("4a3a2a"), // 玄茶
  ],
} as const;

// ── 动效 token(R3-C1 #88):时长 + 缓动唯一源,CSS 一律 var() 消费 ──
// 与 Theme 同走 gen:theme 管线生成 --dur-* / --ease-*。呼吸/脉冲类统一挂 --dur-ambient,
// 个体允许整数倍/半频特例(如 calc(var(--dur-ambient) / 2) = 1.3s 半频);
// dur 值为毫秒数:CSS 侧由生成器拼 ms 单位序列化,JS 侧(fx/timings.ts)直接取数,
// 数值恰等于某 token 的 FX/DICE 字段引用 Motion(单点同步),其余编排窗口保留字面量。
export const Motion = {
  /** 时长阶梯(毫秒):短→长依次承担 反馈 → 面板 → 大件 → 演出 → 常驻。 */
  dur: {
    /** 按压/hover 即时反馈(80ms,一触即应)。 */
    instant: 80,
    /** 遮罩、高亮等轻量快过渡(150ms;对齐旧 fast 0.15s 口径)。 */
    fast: 150,
    /** 面板入退场、屏幕切换(250ms;对齐旧 mid 0.25s 口径)。 */
    med: 250,
    /** 大件入场单拍(400ms;对齐旧 slow 0.4s 口径)。 */
    slow: 400,
    /** 胜利阶梯、镜头等揭晓感长拍(600ms);骰子落定停留 DICE.holdMs 同源(经 Motion)。 */
    reveal: 600,
    /** 浮字类瞬时演出(1300ms)。fx/timings.ts FX.floaterMs 与 --dur-fx 同源(经 Motion)。 */
    fx: 1300,
    /** 回合旌旗横幅飞行(1800ms):fx.css fx-banner-fly 消费 var(--dur-banner);
     *  JS 编排窗 FX.bannerMs = 本值 + 100ms 清理余量(fx/timings.ts 单点换算,#117 收编)。 */
    banner: 1800,
    /** 常驻呼吸基准(2600ms):旌旗摇曳/光晕脉动等 infinite 呼吸统一挂此,个体允许整数倍/半频。 */
    ambient: 2600,
  },
  /** 缓动四条:入场/退场/回弹/呼吸各一,替换全仓 8 种并存缓动。 */
  ease: {
    /** 入场/放大类默认:起快收慢(cubic-bezier(0.22,1,0.36,1),即旧 easeOutQuint 系手感)。 */
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    /** 退场/离场类:起慢收快(cubic-bezier(0.4,0,1,1)),元素加速离场不拖泥带水。 */
    in: "cubic-bezier(0.4, 0, 1, 1)",
    /** 回弹弹入(back 类统一此条):过冲再落定(cubic-bezier(0.34,1.56,0.64,1)),签面/标题弹跳用。 */
    outBack: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    /** 呼吸/脉冲与行军/镜头:easeInOutSine(cubic-bezier(0.45,0,0.55,1)),两端缓中段匀。 */
    sine: "cubic-bezier(0.45, 0, 0.55, 1)",
  },
} as const;

export const groupColor = (group: string | null): Rgb =>
  group && Theme.groupColors[group] ? Theme.groupColors[group] : Theme.inkDim;

export const playerColor = (index: number): Rgb =>
  Theme.playerColors[index % Theme.playerColors.length];

/** 玩家可选国号字池(装饰用)。 */
export const GUOHAO_POOL = [
  "魏", "蜀", "吴", "燕", "齐", "楚", "韩", "赵", "秦", "晋",
  "凉", "雍", "徐", "豫", "青", "幽", "荆", "扬", "益", "交",
  "梁", "隋", "唐", "宋", "越", "巴", "黔", "滇", "陇", "衮",
];
