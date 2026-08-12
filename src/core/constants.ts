// 全局共享常量(单一来源,避免多处重复导致漂移)。数值说明见 RULES.md §11 关键数值表。
// 抽签 1-6 的汉字签面(签筒主题;骰子机制不变,仅展示)
export const SIGN_FACES = ["一", "二", "三", "四", "五", "六"];
// 同格多棋子的错位槽(按 slot % length 取用;SVG local 坐标)
export const TOKEN_SLOT_OFFSETS = [
  { x: -22, y: -8 },
  { x: 22, y: -8 },
  { x: -22, y: 20 },
  { x: 22, y: 20 },
];
// 城池最小间距:防止 UI 重叠(加载器校验 + 编辑器红圈高亮共用同一阈值)
export const MIN_TILE_DIST = 80;
// 城池"轻点"判定:按下→松手位移超过此值(像素)视为拖动,不触发点击
export const TAP_MAX_MOVE = 24;

// 委任状:进驻(买)新城的额度,防止运气好的玩家一圈跑下来把城全占光。
export const STARTING_WARRANTS = 3; // 开局每人 3 张(都城颁发)
export const WARRANTS_PER_PASS = 2; // 经过自己都城(起点)+2 张(Monopoly 式过起点)
export const BUY_WARRANT_COST = 1; // 进驻一座城消耗的委任状数(扩军不耗)

// 名士(英雄):每人最多持有的数量
export const HERO_CAPACITY = 3;

/** 单个 CJK 汉字判定(国号校验共用;core 层,不依赖 DOM)。 */
export function isSingleCjk(s: string): boolean {
  return /^[㐀-鿿]$/.test(s);
}
