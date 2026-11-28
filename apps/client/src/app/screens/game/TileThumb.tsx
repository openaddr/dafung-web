// 城池缩略图:非交互真实格缩略图——独立 <svg> 壳
// 原样复用棋盘 <Tile>,与棋盘逐像素同源:竖排城名木匾、等级徽记、
// 都城金台座+王旗、特殊城池两字徽标、持有者燕尾旗全是 Tile 自带渲染,本件零特判。
// 签条、渐变和包围盒与 Canvas 城池贴图共用单源，缩略图以原图稿按当前状态绘制。
import type { SeatCity } from "@dafung/core/protocol/seat-queries";
import { Tile } from "@app/components/board/Tile";
import { CITY_ART_BOX, TILE_SCALE, type TileVisualState } from "@app/components/board/city-scene";
import { cn } from "@app/utils/cn";
import { TESTIDS } from "./testids";

export function TileThumb({ city, className }: { city: SeatCity; className?: string }) {
  const { tile, property, owner, capital } = city;
  const state: TileVisualState = {
    ownerColorIndex: owner?.colorIndex ?? null,
    ownerGuohao: owner?.guohao ?? null,
    level: owner?.level ?? null,
    capitalColorIndex: capital?.colorIndex ?? null,
    capitalGuohao: capital?.guohao ?? null,
    isActive: false,
    isTaken: false,
    isSelectable: false,
    capitalCandidateOrder: null,
    isCityTarget: false, // 缩略图无目标段语境(#1388 T2 状态字段显式归零,非兜底)
    isCityPicked: false,
    defense: owner?.defense ?? null,
    fireMarks: owner?.burning?.marks ?? 0,
    fireProgress: owner?.burning?.progress ?? 0,
  };
  return (
    <svg
      data-testid={TESTIDS.cityLedgerThumb(property.id)}
      aria-hidden="true"
      /* 板坐标盒为格心加缩放后的局部包围盒。显示尺寸由调用方指定。 */
      viewBox={[
        tile.position.x + CITY_ART_BOX.x * TILE_SCALE,
        tile.position.y + CITY_ART_BOX.y * TILE_SCALE,
        CITY_ART_BOX.w * TILE_SCALE,
        CITY_ART_BOX.h * TILE_SCALE,
      ].join(" ")}
      className={cn("city-ledger-thumb pointer-events-none block", className)}
    >
      <Tile tile={tile} tier={property.tier} state={state} />
    </svg>
  );
}
