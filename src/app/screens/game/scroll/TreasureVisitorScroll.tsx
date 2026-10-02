// 珍宝使交涉卷轴:对照旧 showTreasureOwnerScroll / showTreasurePickerScroll 的两步流。
// 城主(决策方)先选模式(不交易/公道/坐地,#362 起选定即弹选宝弹层:装裱卡点选+
// 二段式成交,TreasurePickModal;卷轴裸列表退役),「返回/Esc/X/关闭弹层」都回模式
// 选择步、不发命令;访客(落城的活跃玩家)非决策方,只看到等待交涉的只读视角——可关
// (X8 #27,关闭即回棋盘,等待反馈交还 WaitingBar 体系),关了本场合交涉不再重弹;
// 相位离开组件卸载,状态随之复位,下一场交涉照常弹出。
// 价格口径:公道 = guidePriceOf(level);坐地 = premiumPriceOf(指导价, 城定义, 城等级)。
// 协议零改:resolveTreasureOwner { action: { type: "fair"/"premium", treasureId } } 原样。
import { useState } from "react";
import type { GameCommand} from "@core/authority";
import { guidePriceOf, premiumPriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import type { SnapshotTreasure } from "@app/store/gameStore";
import { TreasurePickModal } from "../TreasurePickModal";
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

/** 模式名与口径句(Step 1 按钮注记 / 弹层语境条同一份,不写第二事实源)。 */
const MODE_META: Record<Mode, { label: string; terms: string }> = {
  fair: { label: "公道买卖", terms: "按指导价出售,成交后城池 +1 级" },
  premium: { label: "坐地起价", terms: "按城池等级加价出售,城池不升级" },
};

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
  // owner 两步:mode=null 在 Step 1(选模式,ADR-0013 选项集);选定后进 Step 2 =
  // 选宝弹层(拾取器是本地 UI 态,不是选项集;关层即回本步)。
  const [mode, setMode] = useState<Mode | null>(null);
  // X8(#27):访客只读面板可主动关掉(×/遮罩/Esc)——城主犹豫多久访客不再被困模态。
  // 本地 UI 态(不进引擎/快照):关掉后本场合交涉不再重弹,卸载即复位(见文件头注释)。
  const [visitorDismissed, setVisitorDismissed] = useState(false);

  const title = !mode
    ? `${ownerGuohao}·珍宝抉择`
    : `${MODE_META[mode].label}·选珍宝`;

  const priceOf = (t: SnapshotTreasure, m: Mode) => {
    const guide = guidePriceOf(t.level);
    return m === "fair" ? guide : premiumPriceOf(guide, property, cityLevel);
  };

  // ── 访客视角:只读等待(决策权在城主),可关(X8 #27)──
  if (role === "visitor") {
    if (visitorDismissed) return null;
    return (
      <ScrollShell
        title={`${ownerGuohao}·珍宝抉择`}
        testid={T.treasureScroll}
        onClose={() => setVisitorDismissed(true)}
      >
        <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
          {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {treasures.length}{" "}
          件珍宝,正在权衡是否出售…
        </p>
      </ScrollShell>
    );
  }

  return (
    <>
      <ScrollShell title={title} testid={T.treasureScroll}>
        {!mode ? (
          <>
            <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
              {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {treasures.length} 件珍宝。
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {/* W4b 逃生口:模式选择步随时可「暂不交易」退出(引擎 resolveTreasureOwner 已支持
                  skip 分支,core/authority.ts),城主不必在公道/坐地里二选一。 */}
              <ScrollButton
                primary
                testid={T.treasureSkip}
                onClick={() => onCommand({ type: "resolveTreasureOwner", action: { type: "skip" } })}
              >
                暂不交易
              </ScrollButton>
              <ScrollButton
                testid={T.treasureModeFair}
                onClick={() => setMode("fair")}
                title={MODE_META.fair.terms}
              >
                公道买卖
              </ScrollButton>
              <ScrollButton
                testid={T.treasureModePremium}
                onClick={() => setMode("premium")}
                title={MODE_META.premium.terms}
              >
                坐地起价
              </ScrollButton>
            </div>
          </>
        ) : (
          /* Step 2 本体在选宝弹层;卷轴只留语境(弹层盖住它,关层即回 Step 1)。 */
          <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
            {visitorGuohao} 落「{tileName}」。{ownerGuohao} 有 {treasures.length}{" "}
            件珍宝,在弹层中点选要出售的。
          </p>
        )}
      </ScrollShell>
      {mode !== null && (
        <TreasurePickModal
          title={`${MODE_META[mode].label} · 选珍宝`}
          seal="交"
          sub={`${ownerGuohao} · 卖出的珍宝离手入${visitorGuohao}`}
          context={
            <p className="treasure-pick-context">
              已选 <b>{MODE_META[mode].label}</b> · {MODE_META[mode].terms}
            </p>
          }
          treasures={treasures}
          tagOf={(t, selected) => {
            const price = priceOf(t, mode);
            return selected ? `成交 · 至 ${formatMoney(price)}` : `指导价 ${formatMoney(price)}`;
          }}
          summaryOf={(t) =>
            `卖出 ${t.name} · 入账 ${formatMoney(priceOf(t, mode))}` +
            (mode === "fair" ? ` · ${tileName} +1 级` : "")
          }
          hint="点选要出售的珍宝"
          confirmLabel="成交"
          testids={{
            container: T.treasurePick,
            item: T.treasureItem,
            confirm: T.treasureConfirm,
            back: T.treasureBack,
          }}
          onConfirm={(treasureId) =>
            onCommand({ type: "resolveTreasureOwner", action: { type: mode, treasureId } })
          }
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
