// 古风设计系统:玄墨鎏金色板(漆黑为纸/鎏金为骨)、朱砂/青绿/黛青/靛青、地产分组色、玩家色、动效时长/缓动。
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
  // 玄墨鎏金核心配色(方向 D #489/ADR-0026,值换血 #509:漆黑为纸,鎏金为骨——
  // 纸系=玄墨深底阶,纸色文字阶(原 ink 系,ADR-0038 改名对齐值),金系=漆金阶;详见 docs/design/DESIGN.md §3 方向 D)
  bg: hex("1f1a13"), // 玄墨底(全局底·案头漆黑)
  bgDeep: hex("16110c"), // 玄墨底之深(远山/阴影衬,比底更沉)
  panel: hex("2b2317"), // 墨面板(笺纸面→墨面)
  panelHi: hex("3d3325"), // 墨面板衬里/hover
  paperHi: hex("3b3222"), // 卷轴体渐变亮端(ScrollShell/ConfirmDialog 深纸面)
  paperLo: hex("241d13"), // 卷轴体渐变暗端
  paper: hex("f4ecd8"), // 纸色(正文/标题;深底上的纸色字,ADR-0038 由 ink 改名对齐值)
  paperDim: hex("c6b491"), // 淡纸(次级文字,对 panelHi 仍 ≥4.5:1;ADR-0038 由 inkDim 改名)
  lacquer: hex("332a1e"), // 浓墨漆木(主按钮底/卷轴杆)——墨=落子无悔,主行动色
  lacquerGold: hex("d9b95c"), // 漆底金字(墨钮文字/杆箍线)
  gold: hex("d9b95c"), // 鎏金(轮次/能量/金印/描边,不再作按钮底)
  goldBright: hex("ecd28a"), // 亮金(都城光晕/行军拖影)
  goldDeep: hex("c8a13a"), // 熟金(金字可读档:对 panel/paperHi 各底 ≥5:1,小字红线优先;
  // #509 就地调值——票面建议 #8a6a1c 对深底仅 ≈3.3:1 不达 4.5,故取亮一档)
  money: hex("79a965"), // 青绿(收入,深底提亮档)
  danger: hex("e2634d"), // 朱砂(危险/破产/朱钮/扣减文字;语义收窄 #506,
  // 值取「深底小字 ≥4.5」与「朱钮纸白字 ≈2.9(过渡,S4/S9 印章漆金化后重形)」的平衡点)
  // 在线/成功(深底提亮档:对 panel 4.9:1)
  success: hex("35a374"),
  sealQing: hex("76aaa5"), // 黛青(次级印章,中性事件;深底提亮档)
  jishi: hex("82a4cc"), // 靛青(即时族,#281 反应锦囊标签章/族色:与朱砂标签章、金底技章
  // 区分的第三种章色;深底面板上 ≈6:1 达 AA,生成 token --color-jishi)

  // 驿道
  roadMain: hex("8a6c44"), // 主路褐(深底提亮一档,S6 棋盘深底化可再调)
  roadSide: hex("c07f47"), // 支路赭石(深底提亮一档)

  // 暗金饰线(远山/书法;ADR-0038 由 inkwash 改名 goldWash:色相归金族、低亮度装饰线)
  goldWash: hex("9c8a5e"),

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

  // ── 属性色变体(#253 布局骨架)──
  // 一属性一色;每属性两档:无后缀 = 墨面档(#509 换血后宣纸面已是深底,此档按
  // panel/panelHi 深底调亮,小字 ≥4.5:1),Bright = 漆木深底(仪表条)亮变体(值沿用)。
  // 徽章/数值一律吃 --color-attr-* token,组件零硬编码色值。
  // 生成器(gen:theme)只认顶层 Rgb,故平铺为 attr* 键;其中三处与既有 token 同值
  // (委任=goldDeep / 城=sealQing / 名将=danger),语义同源由本注释锚定,改色时同步。
  attrCash: hex("7cab66"), // 现金 = 青绿(重要数字最高优先,brush 加大)
  attrCashBright: hex("8fbf77"), // 现金·漆底亮档
  attrWarrant: hex("c8a13a"), // 委任 = 熟金(与 goldDeep 同值互证,语义同源)
  attrWarrantBright: hex("e0c06a"), // 委任·漆底亮档
  attrCity: hex("76aaa5"), // 城池 = 黛青(同 sealQing)
  attrCityBright: hex("7fb0ad"), // 城池·漆底亮档(黛青提亮,原型无此件,按同族推导)
  attrRep: hex("b58cc5"), // 声望 = 蓝紫(2026-10-19 由紫 c28cc2 偏蓝 ~17°,与名将朱砂拉开色相;声望专用 token 单动,不涉 danger 同值)
  attrRepBright: hex("c383c5"), // 声望·漆底亮档(随主档同步偏蓝)
  attrGem: hex("d89a55"), // 珍宝 = 橙金
  attrGemBright: hex("e09a52"), // 珍宝·漆底亮档
  attrHero: hex("e2634d"), // 名将 = 朱砂(同 danger)
  attrHeroBright: hex("e07a6a"), // 名将·漆底亮档

  // 玩家色(8 色,用于旌旗/边框/王旗;上限 8 人,一席一色;#509 降饱和提亮配玄墨深底。
  // #557 归属可辨性(主线裁决):deutan 靠明度差分红绿,故青绿**提亮**而非压暗——
  // 朱砂/青绿是 4 人局唯一红绿对(前四色),提亮后 1.69:1;松绿压明度保对鎏金 1.63;
  // 暖金三色(赭橙/鎏金/玄茶)互距 1.35/1.62/1.2,6-8 人局不再近撞;旗面国号字是
  // 身份主通道,8 人局鎏金/青绿 ~1.1 的 rare 场合由它兜底)
  playerColors: [
    hex("70a4c4"), // 石青
    hex("e2634d"), // 朱砂(同 danger)
    hex("98c27a"), // 青绿(#557:85b570 提亮,对朱砂 1.69:1——压暗方向数学不可达,见上)
    hex("c28cc2"), // 紫
    hex("cc8340"), // 赭橙(#557:d5a055 压暗向橙,离鎏金 1.35:1)
    hex("4c9182"), // 松绿(#557:58ae9a 压明度,对鎏金 1.63:1)
    hex("c8a95a"), // 鎏金
    hex("9a8262"), // 玄茶(#557:b59d7c 压暗,离鎏金 1.62:1)
  ],

  // 国号印印字亮档(#743 判词 B/#751 C 批):座位色小字(格上印 8.5px)直接作印字时
  // 8 色中 6 色对印底(26% 座色混玄墨底)<4.5:1(松绿/玄茶 3.28 最低)——座位色本体
  // 受 #557 近色链约束不可动,故印字单走一档亮变体(座色 60%+纸色 40%,attr-*-bright
  // 同族先例):印边框仍吃座位色本体(身份锚不变),唯字提线。八色对各自印底逐一
  // 实测 ≥4.5(WCAG 2.1 正文线;contrast-calc 通路复跑,2026-10-29):
  //   石青 5.81 / 朱砂 5.36 / 青绿 6.13 / 紫 5.76 / 赭橙 5.62 / 松绿 5.38 / 鎏金 6.02 / 玄茶 5.42
  // 消费通路:SeatRail 经 playerSealText() 以 --pc-seal 行内注入(同 --pc 注入先例),
  // 不进 gen:theme token 面——印字随格走、无全局消费方。
  playerSealTexts: [
    hex("a5c1cc"), // 石青·印字
    hex("e99a85"), // 朱砂·印字
    hex("bdd3a0"), // 青绿·印字
    hex("d6b2cb"), // 紫·印字
    hex("dcad7d"), // 赭橙·印字
    hex("8fb5a4"), // 松绿·印字
    hex("dac48c"), // 鎏金·印字
    hex("beac91"), // 玄茶·印字
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

export const playerColor = (index: number): Rgb =>
  Theme.playerColors[index % Theme.playerColors.length];

/** 国号印印字(#743 B/#751 C 批):座位色亮档,配 playerColors 同序取用——格上小印
 *  字色单源;边框/旗面等身份锚仍走 playerColor 本体(见 playerSealTexts 注记)。 */
export const playerSealText = (index: number): Rgb =>
  Theme.playerSealTexts[index % Theme.playerSealTexts.length];

/** 玩家可选国号字池(装饰用)。 */
export const GUOHAO_POOL = [
  "魏",
  "蜀",
  "吴",
  "燕",
  "齐",
  "楚",
  "韩",
  "赵",
  "秦",
  "晋",
  "凉",
  "雍",
  "徐",
  "豫",
  "青",
  "幽",
  "荆",
  "扬",
  "益",
  "交",
  "梁",
  "隋",
  "唐",
  "宋",
  "越",
  "巴",
  "黔",
  "滇",
  "陇",
  "衮",
];
