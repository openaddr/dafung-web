// 全局共享常量(单一来源,避免多处重复导致漂移)。数值索引见 docs/reference/rules/10-关键数值总表.md。
// 抽签 1-面数 的汉字签面(签筒主题;骰子机制不变,仅展示;#1390 扩「七」=英姿第七面,
// 掷骰面数单源 skills.heroDieFaces,签面表长随域扩,呈现面一律按表长消费)
export const SIGN_FACES = ["一", "二", "三", "四", "五", "六", "七"];
// 同格多棋子的错位槽(按 slot % length 取用;SVG local 坐标)。
// #557 扩 4→8 槽:圆心 (0,6)(沿用旧 4 槽的下偏中轴)、r=26 圆周均布 8 点;
// 排序 1-4 落四方位(左右优先,既单子近原位、二人左右对称),5-8 落对角补位。
export const TOKEN_SLOT_OFFSETS = [
  { x: -26, y: 6 }, // 左
  { x: 26, y: 6 }, // 右
  { x: 0, y: -20 }, // 上
  { x: 0, y: 32 }, // 下
  { x: -18, y: -12 }, // 左上
  { x: 18, y: -12 }, // 右上
  { x: 18, y: 24 }, // 右下
  { x: -18, y: 24 }, // 左下
];
// 城池最小间距:防止 UI 重叠(地图装载校验阈值)
export const MIN_TILE_DIST = 80;

/** 城池持有等级范围。地图上限必须落在此范围内。 */
export const INITIAL_CITY_LEVEL = 1;
export const MAX_CITY_LEVEL = 4;
/** 燃烧约定的每次扣防间隔，单位为实际回合。 */
export const CITY_BURN_TURNS = 3;

// 名将(英雄):每人最多持有的数量
export const HERO_CAPACITY = 3;

/** 体力上限与开局值(#130):体力增减的夹紧边界。 */
export const STAMINA_MAX = 100;
export const STARTING_STAMINA = STAMINA_MAX;

/** 都城补给恢复已损失体力的比例，结果四舍五入。 */
export const CAPITAL_STAMINA_RECOVERY_RATE = 0.5;

/** 体力耗竭休整回合数:归 0 后跳过自己 N 个回合,休整期满体力回满(GLOSSARY「休整」)。 */
export const EXHAUSTION_REST_TURNS = 2;

/** 单个 CJK 汉字判定(国号校验共用;core 层,不依赖 DOM)。 */
export function isSingleCjk(s: string): boolean {
  return /^[㐀-鿿]$/.test(s);
}

/** 按反应窗类型配置默认时长（毫秒）。权威端开窗时写入 view.windowMs。 */
export const REACTION_WINDOW_MS = {
  jinnang: 30_000,
  march: 30_000,
} as const;
