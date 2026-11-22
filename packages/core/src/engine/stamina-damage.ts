// 体力伤害及耗竭。时机应答后从已落账的最后一步继续结算。
import type { GameEngine } from "./authority";
import { settleCityDamageMoments } from "./city-damage-moments";
import { EXHAUSTION_REST_TURNS } from "./constants";
import { applyCityDamage } from "./defense";
import { emitGameEvent } from "./game-events";
import { findHolding } from "./player";
import type { MomentCtx } from "./timing";

type StaminaDamageSuccessor = "jinnangExit" | null;

interface StaminaDamageContinuation {
  kind: "staminaDamage";
  sourceSeat: number | null;
  depletes: boolean;
  after: StaminaDamageSuccessor;
}

interface ExhaustionContinuation {
  kind: "exhaustion";
  sourceSeat: number | null;
  downgradedCount: number;
  lostCount: number;
  after: StaminaDamageSuccessor;
}

export interface ExhaustionCityDamageContinuation {
  kind: "exhaustionCityDamage";
  seat: number;
  sourceSeat: number | null;
  remainingPropertyIds: string[];
  downgradedPropertyIds: string[];
  lostPropertyIds: string[];
  after: StaminaDamageSuccessor;
}

export type StaminaDamageMoment =
  | StaminaDamageContinuation
  | ExhaustionCityDamageContinuation
  | ExhaustionContinuation;

/** 扣减体力并保存这次损耗的来源，供应答后结算归零。 */
export function damageStamina(
  g: GameEngine,
  seat: number,
  amount: number,
  sourceSeat: number | null,
  after: StaminaDamageSuccessor = null,
): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`体力伤害须为正数（${amount}）`);
  if (sourceSeat !== null && g.players[sourceSeat] === undefined)
    throw new Error(`体力伤害来源座位 ${sourceSeat} 不存在`);
  const before = g.players[seat].stamina;
  if (before === 0) return before;
  const continuation: StaminaDamageContinuation = {
    kind: "staminaDamage",
    sourceSeat,
    depletes: amount >= before,
    after,
  };
  const stamina = g.addStamina(seat, -amount, continuation);
  if (g.pendingMoment === null && continuation.depletes)
    resolveExhaustion(g, seat, sourceSeat, after);
  return stamina;
}

export function resumeStaminaDamageMoment(
  g: GameEngine,
  ctx: MomentCtx,
  state: StaminaDamageMoment,
): void {
  switch (state.kind) {
    case "staminaDamage":
      if (ctx.delta == null || ctx.delta >= 0) throw new Error("体力伤害续接缺少实际体力损耗");
      if (state.depletes) resolveExhaustion(g, ctx.subject, state.sourceSeat, state.after);
      break;
    case "exhaustionCityDamage":
      resumeExhaustionCityDamage(g, state);
      break;
    case "exhaustion":
      resumeExhaustion(g, ctx.subject, state);
      break;
  }
}

/** 外敌乘虚扣掉每座城的当前防御，随后进入休整。 */
function resolveExhaustion(
  g: GameEngine,
  seat: number,
  sourceSeat: number | null,
  after: StaminaDamageSuccessor,
): void {
  resumeExhaustionCityDamage(g, {
    kind: "exhaustionCityDamage",
    seat,
    sourceSeat,
    remainingPropertyIds: g.players[seat].properties.map(({ propertyId }) => propertyId),
    downgradedPropertyIds: [],
    lostPropertyIds: [],
    after,
  });
}

function resumeExhaustionCityDamage(g: GameEngine, state: ExhaustionCityDamageContinuation): void {
  const { seat, sourceSeat, remainingPropertyIds } = state;
  const p = g.players[seat];
  const source = sourceSeat === null ? null : g.players[sourceSeat];
  const downgraded = [...state.downgradedPropertyIds];
  const lost = [...state.lostPropertyIds];
  for (const [i, propertyId] of remainingPropertyIds.entries()) {
    const holding = findHolding(p, propertyId);
    if (holding == null) continue; // 前一城的时机结算可能已经改变持有关系。
    if (holding.defense === 0 && g.tileIndexOfProperty(propertyId) === p.capitalIndex) continue;
    const settlement = applyCityDamage(g, p, propertyId, holding.defense, source);
    const { outcome } = settlement;
    if (outcome.kind === "demolished") downgraded.push(propertyId);
    if (outcome.kind === "lost") lost.push(propertyId);
    if (
      settleCityDamageMoments(g, seat, settlement, {
        ...state,
        remainingPropertyIds: remainingPropertyIds.slice(i + 1),
        downgradedPropertyIds: downgraded,
        lostPropertyIds: lost,
      })
    )
      return;
  }
  p.resting = true;
  p.skipTurns += EXHAUSTION_REST_TURNS;
  emitGameEvent(g, seat, {
    kind: "exhaustionResolved",
    sourceSeat,
    downgradedPropertyIds: downgraded,
    lostPropertyIds: lost,
    restTurns: EXHAUSTION_REST_TURNS,
  });
  const continuation: ExhaustionContinuation = {
    kind: "exhaustion",
    sourceSeat,
    downgradedCount: downgraded.length,
    lostCount: lost.length,
    after: state.after,
  };
  g.dispatchMoment("TurnSkipImposed", { subject: seat, reason: "exhaustion" }, continuation);
  if (g.pendingMoment == null) resumeExhaustion(g, seat, continuation);
}

/** 休整时机的阶段和应答结清后，完成耗竭善后。 */
function resumeExhaustion(g: GameEngine, seat: number, state: ExhaustionContinuation): void {
  const p = g.players[seat];
  const { sourceSeat, downgradedCount, lostCount } = state;
  const source = sourceSeat === null ? null : g.players[sourceSeat];
  const sourceName = source === null ? "无" : source.guohao;
  const downgraded = downgradedCount > 0 ? `，${downgradedCount} 座城池降级` : "";
  const lost = lostCount > 0 ? `，${lostCount} 座城池失守` : "";
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 体力耗竭（伤害来源：${sourceName}），外敌乘虚而入${downgraded}${lost}，卧床休整${EXHAUSTION_REST_TURNS}回合，期满体力回满`,
    `exhaustionSettle player=${p.id} downgraded=${downgradedCount} skipTurns=${p.skipTurns} resting=1 source=${source === null ? "-" : source.id} lost=${lostCount}`,
  );
  if (seat === g.activeIndex) g.endTurn();
}
