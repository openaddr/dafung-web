import type { GameEngine } from "./authority";
import type { PropertyDef } from "./economy";
import { emitGameEvent } from "./game-events";
import { formatMoney } from "./money";
import type { PropertyHolding } from "./model";
import type { MomentContinuation } from "./moment-stages";

/** 国库为每点实际敌城伤害发放的即时奖励，单位为两。 */
export const CITY_IMMEDIATE_REWARD_PER_POINT = 5;

export function cityPriceShare(def: PropertyDef, percent: number): number {
  return Math.round((def.purchasePrice * percent) / 100);
}

export interface CityDamageEntry {
  readonly seat: number;
  readonly damage: number;
}

/** 替换整份排行榜，保留相同累计伤害的到达顺序。 */
export function recordCityDamage(holding: PropertyHolding, seat: number, damage: number): void {
  const previous = holding.damageRanking.find((entry) => entry.seat === seat);
  const next = holding.damageRanking.filter((entry) => entry.seat !== seat);
  next.push({ seat, damage: previous === undefined ? damage : previous.damage + damage });
  next.sort((a, b) => b.damage - a.damage);
  holding.damageRanking = next;
}

export interface CityReward {
  seat: number;
  amount: number;
  reason: string;
  description: string;
  audit: string;
}

export function planCityDamageReward(
  g: GameEngine,
  seat: number,
  tileIndex: number,
  damage: number,
): CityReward {
  return {
    seat,
    amount: CITY_IMMEDIATE_REWARD_PER_POINT * damage,
    reason: "city-damage",
    description: `对「${g.board.at(tileIndex).name}」造成 ${damage} 点伤害，得即时奖励`,
    audit: `cityDamageReward damage=${damage}`,
  };
}

/** 城池奖励先到账，再派发得银时机。 */
export function awardCityReward(
  g: GameEngine,
  seat: number,
  propertyId: string,
  reward: Omit<CityReward, "seat">,
  continuation?: MomentContinuation,
): void {
  const { amount, reason, description, audit } = reward;
  if (amount === 0) return;
  const player = g.players[seat];
  player.cash += amount;
  emitGameEvent(g, seat, { kind: "cashChanged", delta: amount, reason });
  g.logEvent(
    "system",
    player.guohao,
    `${player.guohao} ${description} ${formatMoney(amount)}`,
    `${audit} player=${player.id} property=${propertyId} amount=${amount}`,
    amount,
  );
  g.dispatchMoment("CashGained", { subject: seat, amount }, continuation);
}
