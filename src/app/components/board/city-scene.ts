import type { BoardPos, TileDef } from "@core/board";
import type { CityTier } from "@core/economy";

export interface TileVisualState {
  /** 持有者 colorIndex(null=无主)。 */
  ownerColorIndex: number | null;
  /** 持有者国号(小旌旗文字)。 */
  ownerGuohao: string | null;
  /** 该城等级(0=未持有)。 */
  level: number;
  /** 是否某玩家都城 + 都城主 colorIndex(王旗)。 */
  capitalColorIndex: number | null;
  capitalGuohao: string | null;
  /** 当前回合玩家所在城(bv-tile-border 金描边高亮)。 */
  isActive: boolean;
  /** 选都阶段已被选(标灰禁用)。 */
  isTaken: boolean;
  /** 可交互高亮(轮到本地的可点候选集:选都候选 / 目标段选城候选,#1388 T2 并入,
   *  呼吸脉冲金圈在氛围层,本态兼类契约与压暗例外)。 */
  isSelectable: boolean;
  /** X4(#23) 选都候选序号(1 基,引擎滚出顺序;null=非候选)。候选集全座位可见:
   *  静态低透明金圈(bv-candidate)是非决策席档,本地可点脉冲由 isSelectable 升档。 */
  capitalCandidateOrder: number | null;
  /** 目标段选城候选(#1388 T2 立,#1389 锦囊城指向域同款复用):技/锦囊城目标段的可点
   *  候选格(金环呼吸在氛围层 crown,与选都同通路;本态挂 data-city-target 供
   *  e2e/选择器契约)。 */
  isCityTarget: boolean;
  /** 目标段选城·选中定靶(#1388 T2,#417 同族):实金双环停持(呼吸停、恒定不闪),
   *  挂 data-city-target-selected。 */
  isCityPicked: boolean;
  /** 当前防御值(#1391 T5,满值表单源 core/defense.ts):有主城由上游显式下发
   *  (holding.defense),盾排常显、盾数=当前值;null=无主城不渲染盾排(免疫,
   *  无防御语义)。必填(#585 口径:漏传在类型层面不可表达——有主城漏传=静默不渲染,
   *  是说谎不是缺省;上游 BoardView/TileThumb 恒显式写键)。 */
  defense: number | null;
}

export interface CityScene {
  tile: TileDef;
  tier: CityTier;
  maxLevel: number;
  state: TileVisualState;
}

/** 城楼、触区、缩略图和城池贴图共享同一局部坐标。 */
export const TILE_SCALE = 2.6;
export const CITY_ART_BOX = { x: -70, y: -92, w: 140, h: 164 };
export const CITY_HIT_RADIUS = 62;
export const CITY_FRAME = { x: -52, y: -44, width: 104, height: 88, rx: 10 };

export function cityTransform(position: BoardPos): string {
  return `translate(${position.x} ${position.y}) scale(${TILE_SCALE})`;
}

export function cityOpacity(city: CityScene, focused: boolean): number {
  const { state } = city;
  if (focused && !state.isSelectable && state.capitalCandidateOrder === null) return 0.45;
  if (state.isTaken) return 0.4;
  return state.ownerColorIndex === null ? 0.92 : 1;
}
