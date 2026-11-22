// 名下城池清单行首缩略图(#623,规格 #621):非交互真实格缩略图——独立 <svg> 壳
// 原样复用棋盘 <Tile>,与棋盘逐像素同源:竖排城名木匾、等级徽记、
// 都城金台座+王旗、特殊城池两字徽标、持有者燕尾旗全是 Tile 自带渲染,本件零特判。
// 签条、渐变和包围盒与 Canvas 城池贴图共用单源，缩略图以原图稿按当前状态绘制。
import type { TileDef } from "@dafung/core/engine/board";
import type { PropertyDef } from "@dafung/core/engine/economy";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { Tile } from "@app/components/board/Tile";
import { CITY_ART_BOX, TILE_SCALE, type TileVisualState } from "@app/components/board/city-scene";
import { capitalHolderOf, holdingsOf } from "@app/components/board/tileOwnership";
import { TESTIDS } from "./testids";

export function TileThumb({
  tile,
  def,
  tileIndex,
  players,
}: {
  /** 棋盘格定义(board.at(tileIndex),含格心 position)。 */
  tile: TileDef;
  /** 城表定义(catalog.get(propertyId)):tier 选建筑形制(ADR-0042)。 */
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
    level: holding ? holding.level : null,
    capitalColorIndex: capitalP?.colorIndex ?? null,
    capitalGuohao: capitalP?.guohao ?? null,
    isActive: false,
    isTaken: false,
    isSelectable: false,
    capitalCandidateOrder: null,
    isCityTarget: false, // 缩略图无目标段语境(#1388 T2 状态字段显式归零,非兜底)
    isCityPicked: false,
    defense: holding != null ? holding.defense : null,
    fireMarks: holding?.burning?.marks ?? 0,
    fireProgress: holding?.burning?.progress ?? 0,
  };
  return (
    <svg
      data-testid={TESTIDS.cityLedgerThumb(def.id)}
      aria-hidden="true"
      /* 板坐标盒:格心 + 局部包围盒 × scale;宽高比 308:360.8,基准高 96px 时宽约
          82px。高度走 city-ledger-thumb 规范类(单源 pile-modal.css,基准 96px/
          矮屏档 48px):#708 行高自适应,缩略图不再把清单行高钉死在高视口档。 */
      viewBox={[
        tile.position.x + CITY_ART_BOX.x * TILE_SCALE,
        tile.position.y + CITY_ART_BOX.y * TILE_SCALE,
        CITY_ART_BOX.w * TILE_SCALE,
        CITY_ART_BOX.h * TILE_SCALE,
      ].join(" ")}
      className="city-ledger-thumb pointer-events-none block"
    >
      <Tile tile={tile} tier={def.tier} state={state} />
    </svg>
  );
}
