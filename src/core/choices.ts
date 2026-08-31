// 决策相位选项集(choice-set)集中注册表(ADR-0013):
// 每个决策相位一个计算器,选项带 available/reason——引擎在进入决策相位前先计算选项集,
// 除默认行为外可用选项为 0 时直接自动执行默认行为(战报+浮字),不弹卷轴;
// UI/bot/联机只消费结果(snapshot.choices 透出),禁止在 UI 层私自增删选项。
// 扩展口:未来技能(免委任状购城/低价买城)经时机框架在选项计算前修改玩家状态,
// 此处计算结果随之变化——与 timing 框架同构,无需改引擎流程。
import type { GameEngine } from "./game";
import type { TurnPhase } from "./types";
import { canUpgrade } from "./types";
import { findHolding } from "./player";
import { BUY_WARRANT_COST } from "./constants";

/** 单个选项:available=false 时 reason 说明不可用原因(「银两不足」「无委任状」「已满级」)。 */
export interface ChoiceOption {
  id: string; // 如 "buy" / "upgrade" / "skip" / "fair" / "premium" / "decline"
  label: string; // 玩家可读
  available: boolean;
  reason?: string; // 不可用原因
}

/** AwaitingDecision(购地/扩军,按 pendingLand 分流;spec #107 C2 决策载荷分离)。
 *  skip = 默认行为(不取/按兵不动),永远可用。 */
function decisionChoices(e: GameEngine): ChoiceOption[] {
  const pending = e.pendingLand;
  const p = e.activePlayer;
  if (pending?.kind === "PropertyAvailable") {
    const def = e.pendingLandDef();
    const affordable = p.cash >= def.purchasePrice;
    const hasWarrant = p.warrants >= BUY_WARRANT_COST;
    return [
      {
        id: "buy",
        label: `购地`,
        available: affordable && hasWarrant,
        // 委任优先报(与购地卷轴 F1 口径一致)
        reason: !hasWarrant ? "无委任状" : !affordable ? "银两不足" : undefined,
      },
      { id: "skip", label: "不取", available: true },
    ];
  }
  if (pending?.kind === "OwnProperty") {
    const def = e.pendingLandDef();
    const holding = findHolding(p, def.id);
    return [
      {
        id: "upgrade",
        label: "扩军(免费)",
        available: holding != null && canUpgrade(holding),
        reason: "已满级",
      },
      { id: "skip", label: "按兵不动", available: true },
    ];
  }
  // 非决策性 pendingLand(理论上到不了):仅剩默认行为
  return [{ id: "skip", label: "按兵不动", available: true }];
}

/** AwaitingTreasureOwner(城主三选,天然 ≥2,永不自动执行;registry 供 bot/未来技能消费)。 */
function treasureOwnerChoices(): ChoiceOption[] {
  return [
    { id: "fair", label: "公道买卖", available: true },
    { id: "premium", label: "坐地起价", available: true },
    { id: "decline", label: "不交易", available: true },
  ];
}

/** AwaitingBranch(两选,永不自动执行)。 */
function branchChoices(): ChoiceOption[] {
  return [
    { id: "main", label: "走大路", available: true },
    { id: "branch", label: "入辅路", available: true },
  ];
}

/** AwaitingHeroPick(候选三选一,永不自动执行)。 */
function heroPickChoices(e: GameEngine): ChoiceOption[] {
  return e.offeredHeroes.map((h) => ({
    id: `hero:${h.id}`,
    label: h.name,
    available: true,
  }));
}

/** AwaitingBankruptcySettle(各资产变卖 + 认赔)。ADR-0013 明确例外:重大不可逆事件,
 *  即使唯一选项(无可卖资产只能认赔)也不自动执行——见 EXCLUDED_FROM_AUTO。 */
function bankruptcyChoices(e: GameEngine): ChoiceOption[] {
  const p = e.activePlayer;
  // 凑足即止硬守卫(assertStillOwing 的注册表镜像):现金已达自救线后变卖全部不可用
  const stillOwing = e.pendingDebt != null && p.cash < e.pendingDebt.amount;
  const capProp = e.board.at(p.capitalIndex)?.propertyId;
  const tileNameOf = (propId: string): string =>
    e.board.tiles.find((t) => t.propertyId === propId)?.name ?? propId;
  return [
    ...p.treasures.map<ChoiceOption>((t) => ({
      id: `sell-treasure:${t.id}`,
      label: `变卖「${t.name}」`,
      available: stillOwing,
      reason: "已凑足债务",
    })),
    ...p.properties
      .filter((h) => h.propertyId !== capProp)
      .map<ChoiceOption>((h) => ({
        id: `sell-property:${h.propertyId}`,
        label: `变卖「${tileNameOf(h.propertyId)}」`,
        available: stillOwing,
        reason: "已凑足债务",
      })),
    ...p.heroes.map<ChoiceOption>((h) => ({
      id: `cash-hero:${h.id}`,
      label: `遣散「${h.name}」`,
      available: stillOwing,
      reason: "已凑足债务",
    })),
    { id: "settle", label: "认赔清偿", available: true },
  ];
}

/** 决策相位 → 选项计算器。未注册的相位(Roll/Land/EndTurn/GameOver)无决策。 */
export const PHASE_CHOICES: Partial<Record<TurnPhase, (e: GameEngine) => ChoiceOption[]>> = {
  AwaitingDecision: decisionChoices,
  AwaitingTreasureOwner: treasureOwnerChoices,
  AwaitingBranch: branchChoices,
  AwaitingHeroPick: heroPickChoices,
  AwaitingBankruptcySettle: bankruptcyChoices,
};

/** 自动执行例外名单(ADR-0013 决议 3):这些相位即使唯一选项也照常弹卷轴。 */
export const EXCLUDED_FROM_AUTO: ReadonlySet<TurnPhase> = new Set(["AwaitingBankruptcySettle"]);

/** 按相位查注册表计算选项集(引擎 choicesFor / 进入相位前的预检共用)。未注册相位返回空数组。 */
export function computeChoices(e: GameEngine, phase: TurnPhase): ChoiceOption[] {
  const compute = PHASE_CHOICES[phase];
  return compute ? compute(e) : [];
}
