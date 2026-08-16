// 珍宝使交涉卷轴:对照旧 showTreasureOwnerScroll / showTreasurePickerScroll 的两步流。
// 城主(决策方)先选模式(不交易/公道/坐地),再选要出售的珍宝;
// 访客(落城的活跃玩家)非决策方,只看到等待交涉的只读视角。
// 价格口径:公道 = guidePriceOf(level);坐地 = premiumPriceOf(指导价, 城定义, 城等级)。
import { useState } from "react";
import type { GameCommand } from "@core/types";
import { guidePriceOf, premiumPriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import type { SnapshotTreasure } from "@app/store/gameStore";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

/** 城定义里定价要用的字段(接受完整 PropertyDef,也接受裁剪版)。 */
export interface TradePropertyInfo {
  id: string;
  tradeAdd?: number[];
  tradeMult?: number[];
}

export interface TreasureVisitorScrollProps {
  /** 当前视角:owner = 城主(可决策);visitor = 访客(只读等待)。 */
  role: "owner" | "visitor";
  /** 城主国号。 */
  ownerGuohao: string;
  /** 访客(落城的活跃玩家)国号。 */
  visitorGuohao: string;
  /** 落脚城名。 */
  tileName: string;
  /** 城主持有的珍宝(快照展示子集;价格由 level 经 guidePriceOf/premiumPriceOf 推导)。 */
  treasures: SnapshotTreasure[];
  /** 交涉城的定义(算坐地起价用)+ 当前城等级。 */
  property: TradePropertyInfo;
  cityLevel: number;
  onCommand: (cmd: GameCommand) => void;
}

type Mode = "fair" | "premium";

export function TreasureVisitorScroll({
  role,
  ownerGuohao,
  visitorGuohao,
  tileName,
  treasures,
  property,
  cityLevel,
  onCommand,
}: TreasureVisitorScrollProps) {
  // owner 两步:mode=null 在 Step 1(选模式),选定后进 Step 2(选珍宝)。与旧版 openScroll 重弹等价。
  const [mode, setMode] = useState<Mode | null>(null);

  const title = !mode
    ? `${ownerGuohao}·珍宝抉择`
    : mode === "fair"
      ? "公道买卖·选珍宝"
      : "坐地起价·选珍宝";

  const priceOf = (t: SnapshotTreasure, m: Mode) => {
    const guide = guidePriceOf(t.level);
    return m === "fair" ? guide : premiumPriceOf(guide, property, cityLevel);
  };

  // ── 访客视角:只读等待(决策权在城主)──
  if (role === "visitor") {
    return (
      <ScrollShell title={`${ownerGuohao}·珍宝抉择`} testid={T.treasureScroll}>
        <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
          {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {treasures.length} 件珍宝,正在权衡是否出售…
        </p>
      </ScrollShell>
    );
  }

  return (
    <ScrollShell title={title} testid={T.treasureScroll}>
      {!mode ? (
        <>
          <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
            {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {treasures.length} 件珍宝。
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <ScrollButton primary testid={T.treasureSkip} onClick={() => onCommand({ type: "resolveTreasureOwner", action: { type: "skip" } })}>
              不交易
            </ScrollButton>
            <ScrollButton testid={T.treasureModeFair} onClick={() => setMode("fair")}>
              公道买卖 · 按指导价
            </ScrollButton>
            <ScrollButton testid={T.treasureModePremium} onClick={() => setMode("premium")}>
              坐地起价 · 加价出售
            </ScrollButton>
          </div>
        </>
      ) : (
        <>
          <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">选择要出售的珍宝:</p>
          <div className="flex flex-wrap justify-center gap-3">
            {treasures.map((t) => (
              <ScrollButton
                key={t.id}
                testid={T.treasureItem(t.id)}
                onClick={() =>
                  onCommand({ type: "resolveTreasureOwner", action: { type: mode, treasureId: t.id } })
                }
              >
                {t.name} → {formatMoney(priceOf(t, mode))}
              </ScrollButton>
            ))}
            {/* 返回 Step 1(本地状态回退,不发命令) */}
            <ScrollButton testid={T.treasureBack} onClick={() => setMode(null)}>
              ← 返回
            </ScrollButton>
          </div>
        </>
      )}
    </ScrollShell>
  );
}
