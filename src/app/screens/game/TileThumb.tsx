// 名下城池清单行首缩略图(#623,规格 #621):非交互真实格缩略图——独立 <svg> 壳
// 原样复用棋盘 <Tile>,与棋盘逐像素同源:竖排城名木匾、等级档位珠(满级金框)、
// 都城金台座+王旗、宝物城宝印、持有者燕尾旗全是 Tile 自带渲染,本件零特判。
// 三条同源口径:
// ① 状态推导与 BoardView 同一实现(board 族单源 tileOwnership.ts,#665 收编):
//    归属=holdingsOf(全体 players[].properties 对 propertyId 的首见者,players 序即
//    座位序),都城=capitalHolderOf(全体玩家 capitalIndex 判定,不只看被查看者);
//    交互位全关(isActive/isTaken/isSelectable/candidate 恒 false/null、不传 onClick)
//    ——活跃虚线环、选都候选印、呼吸金圈、聚焦压暗天然不出现。
// ② 渐变 defs(url(#bv-roof-grad/#bv-wall-grad/#bv-capital-glow-grad))引用同文档
//    棋盘已挂的 BoardDefs——弹层经 Base UI Dialog portal 仍在同一 document,引用
//    必然解析;不复制兜底副本(零兜底:棋盘不在场本件也不该被用)。
// ③ 包围盒自算:Tile 以 translate(格心) scale(TILE_SCALE,自 Tile.tsx 导入)落位,
//    局部包围盒(格坐标)取格内容极值(见 THUMB_BBOX 注),× TILE_SCALE 平移到板
//    坐标即 viewBox——四态共用同一盒,行内缩略图等大对齐。
// 非交互由壳承担:pointer-events:none 后 board.css 的 :hover/:active 系(cursor/
// 金盘/描边升亮)摸不到不可命中元素,天然失效;Tile 的 `tile-${index}` id 与棋盘
// 重复无害(消费面只有 CSS 类选择器与 data-tile,无 getElementById 依赖)。
import type { TileDef } from "@core/board";
import type { PropertyDef } from "@core/economy";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { Tile, TILE_SCALE } from "@app/components/board/Tile";
import type { TileVisualState } from "@app/components/board/Tile";
import { capitalHolderOf, holdingsOf } from "@app/components/board/tileOwnership";
import { TESTIDS } from "./testids";

/** 局部包围盒(格坐标,scale 前),按 Tile 当前几何极值定格,四态共用:
 *  x ∈ [-70,70] = 都城金晕圆 r=70(bv-capital-glow,都城呼吸可见,须完整入盒);
 *  y 上界 -92 = 王旗杆顶缨金珠(cy=-89 r=2.2 → -91.2);
 *  y 下界 72 = 三字城名木匾底(y0=-22 + 3×23 步距 + 12 = 59)加都城匾流苏(约 +12)。
 *  各态最富元素(王旗/三字匾/满级金框)均在盒内,普通城留白对称不裁切。 */
const THUMB_BBOX = { x: -70, y: -92, w: 140, h: 164 } as const;

export function TileThumb({
  tile,
  def,
  tileIndex,
  players,
}: {
  /** 棋盘格定义(board.at(tileIndex),含格心 position)。 */
  tile: TileDef;
  /** 城表定义(catalog.get(propertyId)):group 选建筑形制、maxLevel 判满级金框。 */
  def: PropertyDef;
  /** 棋盘格 index(都城判定 + Tile 内部 id/data-tile)。 */
  tileIndex: number;
  /** 全体玩家快照(归属首见者 + capitalIndex 判都城的推导源)。 */
  players: SnapshotPlayer[];
}) {
  // 归属/都城判定单源 board 族 tileOwnership.ts(#665):首见者得与 capitalIndex
  // 判都城和 BoardView 走同一实现,不再靠注释互证约定同步。
  const holding = tile.propertyId ? holdingsOf(players).get(tile.propertyId) : undefined;
  const capitalP = capitalHolderOf(players, tileIndex);
  const state: TileVisualState = {
    ownerColorIndex: holding?.colorIndex ?? null,
    ownerGuohao: holding?.guohao ?? null,
    level: holding?.level ?? 0,
    capitalColorIndex: capitalP?.colorIndex ?? null,
    capitalGuohao: capitalP?.guohao ?? null,
    isActive: false,
    isTaken: false,
    isSelectable: false,
    capitalCandidateOrder: null,
  };
  return (
    <svg
      data-testid={TESTIDS.cityLedgerThumb(def.id)}
      aria-hidden="true"
      /* 板坐标盒:格心 + 局部包围盒 × scale;宽高比 308:360.8,基准高 96px 时宽约
          82px。高度走 city-ledger-thumb 规范类(单源 pile-modal.css,基准 96px/
          矮屏档 48px):#708 行高自适应,缩略图不再把清单行高钉死在桌面档。 */
      viewBox={[
        tile.position.x + THUMB_BBOX.x * TILE_SCALE,
        tile.position.y + THUMB_BBOX.y * TILE_SCALE,
        THUMB_BBOX.w * TILE_SCALE,
        THUMB_BBOX.h * TILE_SCALE,
      ].join(" ")}
      className="city-ledger-thumb pointer-events-none block"
    >
      <Tile tile={tile} group={def.group} maxLevel={def.maxLevel} state={state} />
    </svg>
  );
}
