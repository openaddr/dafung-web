import type { GameEngine } from "./authority";
import type { PropertyDef } from "./economy";
import { emitGameEvent } from "./game-events";
import { formatMoney } from "./money";
import type { PropertyHolding } from "./model";
import type { MomentContinuation } from "./moment-stages";

/** 即时奖励取地图购入价的每点比例。 */
export const IMMEDIATE_DAMAGE_REWARD_PERCENT = 2;

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

export function awardCityDamage(
  g: GameEngine,
  seat: number,
  propertyId: string,
  tileIndex: number,
  damage: number,
): void {
  const property = g.catalog.get(propertyId);
  if (property === null) throw new Error(`即时奖励:城 ${propertyId} 不在目录`);
  const amount = cityPriceShare(property, IMMEDIATE_DAMAGE_REWARD_PERCENT) * damage;
  awardCityReward(g, seat, propertyId, {
    amount,
    reason: "city-damage",
    description: `对「${g.board.at(tileIndex).name}」造成 ${damage} 点伤害，得即时奖励`,
    audit: `cityDamageReward damage=${damage}`,
  });
}

/** 城池奖励先到账，再派发得银时机。 */
export function awardCityReward(
  g: GameEngine,
  seat: number,
  propertyId: string,
  reward: { amount: number; reason: string; description: string; audit: string },
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
