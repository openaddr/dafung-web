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
import { BUY_WARRANT_COST, HERO_CAPACITY } from "./constants";
import { HEROES } from "./heroes";
import type { EncounterChoiceOption } from "./encounters";
import { jinnangCardOf, type JinnangEffect } from "./jinnang";

/** 已接入结算的锦囊效果种类(T2:自身域两张;T3/T4 逐票点亮,灰置原因「此计暂未启用」)。 */
export const JINNANG_LIVE_EFFECTS: ReadonlySet<JinnangEffect["kind"]> = new Set([
  "jinnangShield",
  "grantHero",
  "levyAll", // T3:指向他人四牌
  "stealTreasure",
  "demolish",
  "skipTurn",
  "duel", // T4:连环计二虎竞食
  "peek", // T4:军情密探
]);

/** 单个选项:available=false 时 reason 说明不可用原因(「银两不足」「无委任状」「已满级」)。 */
export interface ChoiceOption {
  id: string; // 如 "buy" / "upgrade" / "skip" / "fair" / "premium" / "decline"
  label: string; // 玩家可读
  available: boolean;
  reason?: string; // 不可用原因
  /** 抉择机遇选项专属(#124):机遇 id/文段随选项经 snapshot.choices 派生透出——机遇上下文
   *  过网的唯一通道(UI 卷轴渲染文段、restoreFromSnapshot 按 id 回链目录);其余相位不携带。 */
  encounterId?: string;
  encounterText?: string;
  /** 耗竭选项专属(#130):结算目标房产与处置方式。 */
  holdingPropertyId?: string;
  exhaustionKind?: "downgrade" | "lose";
  /** 锦囊卷轴专属(#122/T2):牌名/标签/牌面文案随选项派生透出(同 encounterId 通道口径);
   *  id 即 cardId(pass=今不用)。 */
  cardText?: string;
  cardTags?: string[];
  /** 目标段选项(#122/T3):候选座位(id=`t${seat}`,label=国号)。 */
  targetSeat?: number;
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

/** 以宝换贤的换贤代价(目录约定:2 件珍宝换 1 名将,见 ENCOUNTERS 以宝换贤文段)。 */
export const ENCOUNTER_HERO_TREASURE_COST = 2;

/** 抉择选项可用门槛(#124):grantHero 型选项(以宝换贤)需珍宝 ≥2 且麾下未满、名将池
 *  未尽——任一不满足则换贤必落空(effect 的 fallbackCash=0,白损两件珍宝),选项必须
 *  拦下并报原因。其余选项恒可用:目录约定每条抉择机遇都自带一个无门槛的「不作」型
 *  选项,保证 ≤1 可用时自动执行永不死锁。 */
function encounterOptionGate(
  e: GameEngine,
  c: EncounterChoiceOption,
): { available: boolean; reason?: string } {
  if (c.effect?.kind === "grantHero") {
    const p = e.activePlayer;
    if (p.treasures.length < ENCOUNTER_HERO_TREASURE_COST) return { available: false, reason: "珍宝不足" };
    if (p.heroes.length >= HERO_CAPACITY) return { available: false, reason: "麾下已满" };
    if (!HEROES.some((h) => !e.recruitedHeroIds.has(h.id))) return { available: false, reason: "名将已尽" };
  }
  return { available: true };
}

/** AwaitingEncounter(抉择机遇,#124):目录选项逐一映射,顺序与 def.choices 一致
 *  (resolveEncounterChoice 的 index 即此下标)。encounterId/encounterText 随选项出快照。 */
function encounterChoices(e: GameEngine): ChoiceOption[] {
  const def = e.pendingEncounter;
  if (!def?.choices) return [];
  return def.choices.map((c, i) => {
    const gate = encounterOptionGate(e, c);
    return {
      id: `choice:${i}`,
      label: c.text,
      available: gate.available,
      reason: gate.reason,
      encounterId: def.id,
      encounterText: def.text,
    };
  });
}

/** AwaitingExhaustion(体力耗竭,#130):选项=每座房产「降 1 级」;全部 0 级 →
 *  每座非都城「失去整座」(都城可降不可失)。结算在引擎 settleExhaustionChoice。 */
function exhaustionChoices(e: GameEngine): ChoiceOption[] {
  const seat = e.pendingExhaustionSeat;
  if (seat == null) return [];
  const p = e.players[seat];
  const capitalPropId = p.capitalIndex >= 0 ? (e.board.at(p.capitalIndex)?.propertyId ?? null) : null;
  const tileName = (propertyId: string) => e.board.tiles.find((t) => t.propertyId === propertyId)?.name ?? propertyId;
  if (p.properties.some((h) => h.level > 0)) {
    return p.properties.filter((h) => h.level > 0).map((h, i) => ({
      id: `exhaust:${i}`,
      label: `「${tileName(h.propertyId)}」降 1 级`,
      available: true,
      holdingPropertyId: h.propertyId,
      exhaustionKind: "downgrade" as const,
    }));
  }
  return p.properties
    .filter((h) => h.propertyId !== capitalPropId)
    .map((h, i) => ({
      id: `exhaust:${i}`,
      label: `「${tileName(h.propertyId)}」失去城池`,
      available: true,
      holdingPropertyId: h.propertyId,
      exhaustionKind: "lose" as const,
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

/** 目标有效性(#122/T3):非己、存活、未被免战庇护;卡面附加条件由 effectKind 分派。 */
export function jinnangTargetOk(e: GameEngine, user: number, target: number, effectKind: JinnangEffect["kind"]): { ok: boolean; reason?: string } {
  const t = e.players[target];
  if (target === user) return { ok: false, reason: "不能指定自己" };
  if (t.isBankrupt) return { ok: false, reason: "已出局" };
  if (t.jinnangShield) return { ok: false, reason: "免战庇护" };
  switch (effectKind) {
    case "stealTreasure":
      if (t.treasures.length === 0) return { ok: false, reason: "无珍宝" };
      break;
    case "demolish":
      if (t.properties.length === 0) return { ok: false, reason: "无城池" };
      break;
  }
  return { ok: true };
}

/** AwaitingJinnang(锦囊,#122/T2):卡牌段=手牌逐张 +「今不用」;目标段(T3)=
 *  pendingJinnang 在场时改列候选座位 +「作罢」。effect 尚未接入结算的种类灰置。 */
function jinnangChoices(e: GameEngine): ChoiceOption[] {
  const p = e.activePlayer;
  const pending = e.pendingJinnang;
  if (pending) {
    const def = jinnangCardOf(pending.cardId);
    const exclude = pending.stage === "two-b" ? pending.picked : [];
    const targets: ChoiceOption[] = e.players.map((t, seat): ChoiceOption => {
      const excluded = exclude.includes(seat);
      const verdict = jinnangTargetOk(e, e.players.indexOf(p), seat, def.effect.kind);
      const ok = !excluded && verdict.ok;
      return {
        id: `t${seat}`,
        label: t.guohao || t.name,
        available: ok,
        reason: excluded ? "已指定" : ok ? undefined : verdict.reason,
        targetSeat: seat,
      };
    });
    return [...targets, { id: "cancel", label: "作罢", available: true }];
  }
  const used = new Set(e.jinnangUsedTags);
  const cards = p.jinnangHand.map((cardId): ChoiceOption => {
    const def = jinnangCardOf(cardId);
    const quotaBlocked = def.tags.some((t) => used.has(t));
    const implemented = JINNANG_LIVE_EFFECTS.has(def.effect.kind);
    // 连环计需要两名有效目标:候选不足即灰置「对手不足」(T4)
    const needTwo = def.targetDomain === "two-others";
    const validTargets = needTwo
      ? e.players.filter((_, i) => jinnangTargetOk(e, e.players.indexOf(p), i, def.effect.kind).ok).length
      : 0;
    const targetsShort = needTwo && validTargets < 2;
    return {
      id: cardId,
      label: def.id,
      available: !quotaBlocked && implemented && !targetsShort,
      reason: !implemented
        ? "此计暂未启用"
        : targetsShort
          ? "对手不足"
          : quotaBlocked
            ? `本回合已用过〔${def.tags.filter((t) => used.has(t)).join("〕〔")}〕`
            : undefined,
      cardText: def.text,
      cardTags: def.tags,
    };
  });
  return [...cards, { id: "pass", label: "今不用", available: true }];
}

/** 锦囊卡牌段「仍有可用牌」单源判定(#122):相位进入与用牌收尾共用,防两处漂移。 */
export function hasUsableJinnang(e: GameEngine): boolean {
  return computeChoices(e, "AwaitingJinnang").some((o) => o.available && o.cardTags != null);
}

/** 决策相位 → 选项计算器。未注册的相位(Roll/Land/EndTurn/GameOver)无决策。 */
export const PHASE_CHOICES: Partial<Record<TurnPhase, (e: GameEngine) => ChoiceOption[]>> = {
  AwaitingDecision: decisionChoices,
  AwaitingTreasureOwner: treasureOwnerChoices,
  AwaitingBranch: branchChoices,
  AwaitingHeroPick: heroPickChoices,
  AwaitingEncounter: encounterChoices,
  AwaitingJinnang: jinnangChoices,
  AwaitingExhaustion: exhaustionChoices,
  AwaitingBankruptcySettle: bankruptcyChoices,
};

/** 自动执行例外名单(ADR-0013 决议 3):这些相位即使唯一选项也照常弹卷轴。 */
export const EXCLUDED_FROM_AUTO: ReadonlySet<TurnPhase> = new Set(["AwaitingBankruptcySettle"]);

/** 按相位查注册表计算选项集(引擎 choicesFor / 进入相位前的预检共用)。未注册相位返回空数组。 */
export function computeChoices(e: GameEngine, phase: TurnPhase): ChoiceOption[] {
  const compute = PHASE_CHOICES[phase];
  return compute ? compute(e) : [];
}
