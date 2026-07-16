// 古风水墨设计系统:宣纸色板、墨/朱砂/赭石/石青/金/青绿、地产分组色、玩家色。
// 改这里即全局换肤。对应 C# 版 DafungTheme.cs。

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
  // 古风核心配色
  bg: hex("e8dcc0"), // 宣纸
  bgDeep: hex("d9c9a3"), // 宣纸深(远山/阴影)
  panel: hex("f2e8cf"), // 浅宣纸面板
  panelHi: hex("e0d3ac"),
  ink: hex("2b2317"), // 墨黑(正文)
  inkDim: hex("6b5d40"),
  gold: hex("c8a13a"), // 金(主操作/王权)
  goldBright: hex("d4af37"), // 都城光晕
  money: hex("4a7a4a"), // 青绿(收入)
  danger: hex("b23a2e"), // 朱砂(扣减/税/破产)

  // 驿道
  roadMain: hex("8a6a3f"), // 主路褐
  roadSide: hex("c47a2a"), // 支路赭橙

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

  // 玩家色(4 色,用于旌旗/边框/王旗)
  playerColors: [
    hex("2a6a8a"), // 石青
    hex("b23a2e"), // 朱砂
    hex("5a8a4a"), // 青绿
    hex("7a3a6a"), // 紫
  ],
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
