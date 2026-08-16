// 四个常规决策卷轴(驻跸/岔口/购地/扩军):从旧侧栏 ActionInline 迁入卷轴体系。
// 交互重构原则:所有需要玩家权衡的选择一律走卷轴弹层,侧栏手牌区不再有决策按钮;
// 卷轴轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-halt/action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进卷轴,e2e 断言零语义变化。
import type { GameCommand } from "@core/types";
import { formatMoney } from "@core/money";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { RentTable } from "./RentTable";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

// ── 驻跸或行进(AwaitingCapitalHalt)──
export function HaltDecisionScroll({
  capitalName,
  nextName,
  onCommand,
}: {
  capitalName: string;
  nextName: string;
  onCommand: (cmd: GameCommand) => void;
}) {
  return (
    <ScrollShell title="驻跸或行进" testid={T.haltScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
        大军途经都城「{capitalName}」。驻跸可暂避锋芒,亦可即刻开拔,前往「{nextName}」。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          testid={TESTIDS.actionButton("halt")}
          onClick={() => onCommand({ type: "haltAtCapital" })}
        >
          驻跸·{capitalName}
        </ScrollButton>
        <ScrollButton
          testid={TESTIDS.actionButton("continue")}
          onClick={() => onCommand({ type: "continueMove" })}
        >
          继续→{nextName}
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

// ── 驿道岔口(AwaitingBranch)──
export function BranchDecisionScroll({
  onCommand,
}: {
  onCommand: (cmd: GameCommand) => void;
}) {
  return (
    <ScrollShell title="驿道岔口" testid={T.branchScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
        驿道至此分岔:大路平坦快捷,辅路僻静多机。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          testid={TESTIDS.actionButton("main")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Main" })}
        >
          走大路
        </ScrollButton>
        <ScrollButton
          testid={TESTIDS.actionButton("branch")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Branch" })}
        >
          入辅路
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

// ── 购地抉择(AwaitingDecision + PropertyAvailable)──
export function BuyDecisionScroll({
  tileName,
  region,
  property,
  cash,
  warrants,
  onCommand,
}: {
  tileName: string;
  region: string;
  property: { purchasePrice: number; upgradeCost: number; maxLevel: number; rentByLevel: number[] };
  cash: number;
  warrants: number;
  onCommand: (cmd: GameCommand) => void;
}) {
  // F1 口径(与旧 ActionInline 同源):银两或委任不足 → disabled + 原因(委任优先报)
  const canBuy = cash >= property.purchasePrice && warrants >= 1;
  const reason = warrants < 1 ? "委任状不足" : "银两不足";
  return (
    <ScrollShell title="购地抉择" testid={T.buyScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」{region ? ` · ${region}` : ""} · 无主 · 购入 {formatMoney(property.purchasePrice)} · 耗 1 委任状
      </p>
      {/* 复用城池详情的等级收益表:买地的权衡核心是逐级过路费回报 */}
      <RentTable property={property} />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!canBuy}
          title={canBuy ? undefined : reason}
          testid={TESTIDS.actionButton("buy")}
          onClick={() => onCommand({ type: "buyProperty" })}
        >
          购地 {formatMoney(property.purchasePrice)}·1委任
        </ScrollButton>
        <ScrollButton
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          不取
        </ScrollButton>
      </div>
      {!canBuy && <p className="mt-2 text-center text-xs text-ink-dim">{reason}</p>}
    </ScrollShell>
  );
}

// ── 扩军抉择(AwaitingDecision + OwnProperty)──
export function UpgradeDecisionScroll({
  tileName,
  level,
  property,
  cash,
  onCommand,
}: {
  tileName: string;
  level: number;
  property: { upgradeCost: number; maxLevel: number; rentByLevel: number[] };
  cash: number;
  onCommand: (cmd: GameCommand) => void;
}) {
  // F1 口径:满级 / 银两不足 → disabled + 原因;收益变化 = 当前级 → 下一级过路费
  const maxed = level >= property.maxLevel;
  const canUp = !maxed && cash >= property.upgradeCost;
  const reason = maxed ? "已满级" : "银两不足";
  const rentNow = property.rentByLevel[level] ?? 0;
  const rentNext = !maxed ? property.rentByLevel[level + 1] ?? rentNow : rentNow;
  return (
    <ScrollShell title="扩军抉择" testid={T.upgradeScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」当前 Lv.{level} · 升级费 {formatMoney(property.upgradeCost)}
      </p>
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">
        过路费:{formatMoney(rentNow)} → {maxed ? "(已满级)" : formatMoney(rentNext)}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!canUp}
          title={canUp ? undefined : reason}
          testid={TESTIDS.actionButton("upgrade")}
          onClick={() => onCommand({ type: "upgradeProperty" })}
        >
          扩军 {formatMoney(property.upgradeCost)}
        </ScrollButton>
        <ScrollButton
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          按兵不动
        </ScrollButton>
      </div>
      {!canUp && <p className="mt-2 text-center text-xs text-ink-dim">{reason}</p>}
    </ScrollShell>
  );
}
