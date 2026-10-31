// 城池详情卷轴(#33/#34/#35):
//   - 只读查看:城名 / 地域 / 持有者(含都城等级)/ 购入价 / 等级表(交易加成 + 变卖价
//     或都城补给,#671)。#826 全城池制:旧「特殊地点类型说明」分支随功能格退役而删。
//   - S10(#43):保留右上 ×(壳 44px 热区),关闭 = ×/遮罩/Esc;
//     hideClose 只留给必须决策的卷轴(详情卷轴均放弃性,不占用)。
//   - #35:选都模式下详情内嵌「定都于此 / 再想想」,确认才落子(整合旧 pendingCapital 确认框)。
//   - #767 弹窗详情族①②:城名下补真实格缩略图(TileThumb,与名下清单/CityLedgerModal
//     同源同件,置摘要上方、纯展示不抢焦点);「持有/需/余差」主数值行升格(AffordRow,
//     与购地抉择同一行——详情里先看一眼买不买得起,再翻等级表),元信息退居次要行。
import { formatMoney } from "@core/money";
import type { TileDef } from "@core/board";
import type { PropertyDef } from "@core/economy";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { BannerShell, BannerButton } from "./BannerShell";
import { AffordRow } from "./AffordRow";
import { ValueTable } from "./ValueTable";
import { TileThumb } from "../TileThumb";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

export interface TileDetailScrollProps {
  /** 格索引(仅展示用,引擎定位由主线完成)。 */
  tileIndex: number;
  /** 棋盘格定义(board.at(tileIndex),TileThumb 缩略图渲染源)。 */
  tile: TileDef;
  tileName: string;
  /** 地域行区名(=分组名,Theme.groupNames 单源经 DecisionScrollLayer;空=未知分组省略段)。 */
  groupLabel: string;
  /** 城表定义(价/等级/交易加成/变卖价/补给;#826 全城池制:每格必有)。 */
  property: PropertyDef;
  /** 全体玩家快照(TileThumb 归属/都城推导源,与名下清单同口径)。 */
  players: SnapshotPlayer[];
  /** 屏前玩家现金(主数值行「持有」,#453 视角契约:viewSeat 即屏前真人)。 */
  cash: number;
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
  tile,
  tileName,
  groupLabel,
  property,
  players,
  cash,
  ownerGuohao,
  ownerLevel,
  isCapital,
  onClose,
  pickCapital,
}: TileDetailScrollProps) {
  // #729:选都态「定都于此/再想想」钉底(壳 footer 槽);只读查看态不传 footer,
  // 槽不渲染零余白(详情内容矮,无需钉底段)。
  return (
    <BannerShell
      title={`「${tileName}」`}
      onClose={onClose}
      testid={T.tileDetailScroll}
      footer={
        pickCapital ? (
          <div className="flex justify-center gap-3">
            <BannerButton primary testid={TESTIDS.confirmCapitalOk} onClick={pickCapital.onConfirm}>
              定都于此
            </BannerButton>
            <BannerButton testid={TESTIDS.confirmCapitalCancel} onClick={onClose}>
              再想想
            </BannerButton>
          </div>
        ) : undefined
      }
    >
      <span hidden data-tile-index={tileIndex} />
      <>
        {/* 真实格缩略图(#767 ②):与棋盘/名下清单逐像素同源,置摘要上方纯展示;
            尺寸档(96px/矮横屏 48px)单源 banner.css 的横幅域 city-ledger-thumb 规则 */}
        <div className="mb-1 flex justify-center">
          <TileThumb tile={tile} def={property} tileIndex={tileIndex} players={players} />
        </div>
        <p className="m-1 mb-2 text-center text-xs text-paper-dim">
          {groupLabel ? `${groupLabel} · ` : ""}
          {ownerGuohao ? `持有:${ownerGuohao}` : "无主"}
          {isCapital ? ` · 都城 Lv.${ownerLevel}` : ""} · 购入 {formatMoney(property.purchasePrice)}
        </p>
        {/* 主数值行(#767 ①):屏前现金 vs 购入价,余绿/差红——详情里先答
            「买不买得起」,再看等级表 */}
        <AffordRow cash={cash} need={property.purchasePrice} />
        {/* 等级表:抽成共用 ValueTable(购地/扩军卷轴复用同一张表,避免三处漂移)。
            #671:主列=交易加成;第二列按城型——都城与选都候选显示补给(变卖价对都城
            是死信息:都城永不可变卖),普通城显示变卖价。
            #92:持有城高亮持有者当前档;无主城没有「当前」可言(ownerLevel 仅为占位 0),不标 */}
        <ValueTable
          property={property}
          second={isCapital || pickCapital ? "supply" : "sell"}
          highlight={ownerGuohao ? { level: ownerLevel, label: "当前" } : undefined}
        />
      </>
    </BannerShell>
  );
}
