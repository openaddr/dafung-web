// 城池详情卷轴(#33/#34/#35):
//   - 只读查看:城名 / 地域 / 持有者(含都城等级)/ 购入价 / 等级收益表;
//     特殊地点(Chance/驿站/税关等非地产格)显示类型说明,同样可点开查看。
//   - #34:去右上 ×,关闭 = 点遮罩空白 / Esc(ScrollShell.hideClose)。
//   - #35:选都模式下详情内嵌「定都于此 / 再想想」,确认才落子(整合旧 pendingCapital 确认框)。
import { formatMoney } from "@core/money";
import type { TileType } from "@core/types";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { ValueTable } from "./ValueTable";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

/** 非地产格的类型说明(口径对齐 core/game.ts 的落格处理)。 */
const SPECIAL_TILE_DESC: Record<Exclude<TileType, "Property">, string> = {
  Wolong: "卧龙岗:途经可招贤纳士(名士三选一)",
  Chance: "锦囊:落格触发随机吉事,得失约 100~250 两",
  Fate: "天命:落格触发随机凶事,得失约 100~250 两",
  Tax: "税关:落格缴税 200 两",
  Stock: "商市:落格行情波动,得失约 100~200 两",
  TreasureCity: "宝物城:不可购买;落格拼点探宝(双骰 ≥ 珍宝等级即得宝)",
};

export interface TileDetailScrollProps {
  /** 格索引(仅展示用,引擎定位由主线完成)。 */
  tileIndex: number;
  tileName: string;
  /** 格类型:非 Property 走特殊地点说明分支。 */
  tileType: TileType;
  /** 地域名(如 幽州;特殊地点可为空)。 */
  region: string;
  /** 城池定义(价/等级/价值);特殊地点为 null。 */
  property: {
    id: string;
    purchasePrice: number;
    maxLevel: number;
    valueByLevel: number[];
  } | null;
  /** 持有者国号;null = 无主。 */
  ownerGuohao: string | null;
  /** 持有者当前城等级(0 起);无主时忽略。 */
  ownerLevel: number;
  /** 是否某家都城(都城展示 Lv 徽记)。 */
  isCapital: boolean;
  onClose: () => void;
  /** #35 选都模式:传了才渲染「定都于此 / 再想想」按钮。 */
  pickCapital?: { onConfirm: () => void };
}

export function TileDetailScroll({
  tileIndex,
  tileName,
  tileType,
  region,
  property,
  ownerGuohao,
  ownerLevel,
  isCapital,
  onClose,
  pickCapital,
}: TileDetailScrollProps) {
  return (
    <ScrollShell title={`「${tileName}」`} onClose={onClose} hideClose testid={T.tileDetailScroll}>
      <span hidden data-tile-index={tileIndex} />
      {property ? (
        <>
          <p className="m-1 mb-3 text-center text-sm text-ink-dim">
            {region} · {ownerGuohao ? `持有:${ownerGuohao}` : "无主"}
            {isCapital ? ` · 都城 Lv.${ownerLevel}` : ""} · 购入 {formatMoney(property.purchasePrice)}
          </p>
          {/* 等级价值表:抽成共用 ValueTable(购地卷轴复用同一张表,避免两处漂移) */}
          <ValueTable property={property} />
        </>
      ) : (
        <p className="m-1 mb-2 text-center leading-7 text-sm text-ink-dim">
          {/* board-loader 不变量:Property 格必有 propertyId(即必有 property),走到此分支的必是特殊格 */}
          {SPECIAL_TILE_DESC[tileType as Exclude<TileType, "Property">]}
        </p>
      )}
      {pickCapital && (
        <div className="mt-4 flex justify-center gap-3">
          <ScrollButton primary testid={TESTIDS.confirmCapitalOk} onClick={pickCapital.onConfirm}>
            定都于此
          </ScrollButton>
          <ScrollButton testid={TESTIDS.confirmCapitalCancel} onClick={onClose}>
            再想想
          </ScrollButton>
        </div>
      )}
    </ScrollShell>
  );
}
