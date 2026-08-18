// 四个常规决策卷轴(驻跸/岔口/购地/扩军):从旧侧栏 ActionInline 迁入卷轴体系。
// 交互重构原则:所有需要玩家权衡的选择一律走卷轴弹层,侧栏手牌区不再有决策按钮;
// 卷轴轮到即自动弹出(DecisionScrollLayer 按相位路由),且无可关 ×——决策相位必须选择。
// 按钮 testid 沿用旧 action-* 命名(action-halt/action-buy/…),文案与语义不变,
// 只是位置从侧栏搬进卷轴,e2e 断言零语义变化。
import { useEffect, useRef, useState } from "react";
import type { GameCommand } from "@core/types";
import { formatMoney } from "@core/money";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { ValueTable } from "./ValueTable";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

/** G-19:数字快捷键(1/2/3)触发选项 —— 挂载绑、卸载解;actions 顺序即角标顺序。
 *  Esc 不做(决策不可关是产品设定)。回调里的 disabled 判断由各卷轴自行收口。 */
function useNumberShortcuts(actions: Array<() => void>) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= ref.current.length) ref.current[n - 1]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

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
  // G-19:1=驻跸 2=行进
  useNumberShortcuts([
    () => onCommand({ type: "haltAtCapital" }),
    () => onCommand({ type: "continueMove" }),
  ]);
  return (
    <ScrollShell title="驻跸或行进" testid={T.haltScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
        大军途经都城「{capitalName}」。驻跸可暂避锋芒,亦可即刻开拔,前往「{nextName}」。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          shortcut={1}
          testid={TESTIDS.actionButton("halt")}
          onClick={() => onCommand({ type: "haltAtCapital" })}
        >
          驻跸·{capitalName}
        </ScrollButton>
        <ScrollButton
          shortcut={2}
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
  // G-19:1=大路 2=辅路
  useNumberShortcuts([
    () => onCommand({ type: "selectBranch", kind: "Main" }),
    () => onCommand({ type: "selectBranch", kind: "Branch" }),
  ]);
  return (
    <ScrollShell title="驿道岔口" testid={T.branchScroll}>
      <p className="m-1 mb-3.5 text-center text-sm text-ink-dim">
        驿道至此分岔:大路平坦快捷,辅路僻静多机。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <ScrollButton
          primary
          shortcut={1}
          testid={TESTIDS.actionButton("main")}
          onClick={() => onCommand({ type: "selectBranch", kind: "Main" })}
        >
          走大路
        </ScrollButton>
        <ScrollButton
          shortcut={2}
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
  property: { purchasePrice: number; maxLevel: number; valueByLevel: number[] };
  cash: number;
  warrants: number;
  onCommand: (cmd: GameCommand) => void;
}) {
  // F1 口径(与旧 ActionInline 同源):银两或委任不足 → disabled + 原因(委任优先报)
  const canBuy = cash >= property.purchasePrice && warrants >= 1;
  const reason = warrants < 1 ? "委任状不足" : "银两不足";
  // G-20:买不起时价值表默认折叠(决策已不可行,全表只是噪音);可点开查看
  const [showValues, setShowValues] = useState(canBuy);
  // G-19:1=购地(不可购时无效)2=不取
  useNumberShortcuts([
    () => { if (canBuy) onCommand({ type: "buyProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  // G-20:资产行 —— 一眼看清持有/需付/差额(负差红字)
  const diff = cash - property.purchasePrice;
  return (
    <ScrollShell title="购地抉择" testid={T.buyScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」{region ? ` · ${region}` : ""} · 无主 · 购入 {formatMoney(property.purchasePrice)} · 耗 1 委任状
      </p>
      <p className="m-1 mb-2.5 text-center text-sm text-ink">
        持有 {formatMoney(cash)} · 需 {formatMoney(property.purchasePrice)} · 差{" "}
        <span className={diff < 0 ? "text-danger" : undefined}>{formatMoney(diff)}</span>
      </p>
      {/* 复用城池详情的等级价值表:买地的权衡核心是逐级价值(升级免费,Lv0 起逐级升) */}
      {showValues ? (
        <ValueTable property={property} />
      ) : (
        <button
          type="button"
          onClick={() => setShowValues(true)}
          className="mx-auto mb-1 block font-deco text-xs text-gold underline cursor-pointer hover:text-ink"
        >
          查看等级价值
        </button>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={!canBuy}
          title={canBuy ? undefined : reason}
          shortcut={1}
          testid={TESTIDS.actionButton("buy")}
          onClick={() => onCommand({ type: "buyProperty" })}
        >
          购地 {formatMoney(property.purchasePrice)}·1委任
        </ScrollButton>
        <ScrollButton
          shortcut={2}
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

// ── 扩军抉择(AwaitingDecision + OwnProperty;升级免费,由到达己城触发)──
export function UpgradeDecisionScroll({
  tileName,
  level,
  property,
  onCommand,
}: {
  tileName: string;
  level: number;
  property: { maxLevel: number; valueByLevel: number[] };
  onCommand: (cmd: GameCommand) => void;
}) {
  // 满级 → disabled;升级免费,无银两门槛。价值变化 = 当前级 → 下一级城池价值(下标 = 等级)
  const maxed = level >= property.maxLevel;
  const valueNow = property.valueByLevel[level] ?? 0;
  const valueNext = !maxed ? property.valueByLevel[level + 1] ?? valueNow : valueNow;
  // G-19:1=扩军(不可升时无效)2=按兵不动
  useNumberShortcuts([
    () => { if (!maxed) onCommand({ type: "upgradeProperty" }); },
    () => onCommand({ type: "endDecision" }),
  ]);
  return (
    <ScrollShell title="扩军抉择" testid={T.upgradeScroll}>
      <p className="m-1 text-center text-sm text-ink-dim">
        「{tileName}」当前 Lv.{level} · 扩军免费
      </p>
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">
        城池价值:{formatMoney(valueNow)} → {maxed ? "(已满级)" : formatMoney(valueNext)}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ScrollButton
          primary
          disabled={maxed}
          title={maxed ? "已满级" : undefined}
          shortcut={1}
          testid={TESTIDS.actionButton("upgrade")}
          onClick={() => onCommand({ type: "upgradeProperty" })}
        >
          扩军(免费)
        </ScrollButton>
        <ScrollButton
          shortcut={2}
          testid={TESTIDS.actionButton("skip")}
          onClick={() => onCommand({ type: "endDecision" })}
        >
          按兵不动
        </ScrollButton>
      </div>
      {maxed && <p className="mt-2 text-center text-xs text-ink-dim">已满级</p>}
    </ScrollShell>
  );
}
