import type { GameEngine } from "./authority";
import { cityPriceShare, type CityDamageEntry, type CityReward } from "./city-damage";
import type { PropertyHolding } from "./model";

const CONQUEST_REWARD_PERCENT = 5;
const CONQUEST_POOL_PERCENT = 10;

interface ConquestReward {
  seat: number;
  amount: number;
  kind: "last-hit" | "pool";
}

/** 伤害榜决定接城人，座位环序决定分池次序与取整余差。 */
export function planCityConquest(
  g: GameEngine,
  ownerSeat: number,
  holding: PropertyHolding,
  attackerSeat: number | null,
  tileIndex: number,
): { toSeat: number | null; rewards: CityReward[] } {
  const eligible = holding.damageRanking.filter(
    ({ seat }) => seat !== ownerSeat && !g.players[seat].isBankrupt,
  );
  const winner = eligible[0];
  if (winner === undefined) return { toSeat: null, rewards: [] };

  const property = g.catalog.get(holding.propertyId);
  if (property === null) throw new Error(`攻陷奖励:城 ${holding.propertyId} 不在目录`);
  const count = g.players.length;
  const distanceFromActor = (seat: number) => (seat - g.activeIndex + count) % count;
  eligible.sort((a, b) => distanceFromActor(a.seat) - distanceFromActor(b.seat));

  const rewards: ConquestReward[] = [];
  if (attackerSeat !== null) {
    rewards.push({
      seat: attackerSeat,
      amount: cityPriceShare(property, CONQUEST_REWARD_PERCENT),
      kind: "last-hit",
    });
  }
  rewards.push(...splitConquestPool(cityPriceShare(property, CONQUEST_POOL_PERCENT), eligible));
  rewards.sort((a, b) => distanceFromActor(a.seat) - distanceFromActor(b.seat));
  return { toSeat: winner.seat, rewards: describeConquestRewards(g, tileIndex, rewards) };
}

function splitConquestPool(pool: number, eligible: CityDamageEntry[]): ConquestReward[] {
  const totalDamage = eligible.reduce((total, entry) => total + entry.damage, 0);
  const shares = eligible.map(({ seat, damage }) => {
    const numerator = pool * damage;
    const amount = Math.round(numerator / totalDamage);
    return { seat, amount, rounding: amount * totalDamage - numerator };
  });
  const difference = pool - shares.reduce((total, share) => total + share.amount, 0);
  if (difference > 0) {
    for (const share of shares.filter(({ rounding }) => rounding < 0).slice(0, difference))
      share.amount += 1;
  } else if (difference < 0) {
    for (const share of shares.filter(({ rounding }) => rounding > 0).slice(difference))
      share.amount -= 1;
  }
  return shares.map(({ seat, amount }) => ({ seat, amount, kind: "pool" }));
}

function describeConquestRewards(
  g: GameEngine,
  tileIndex: number,
  rewards: ConquestReward[],
): CityReward[] {
  const cityName = g.board.at(tileIndex).name;
  return rewards.map(({ seat, amount, kind }) => {
    const lastHit = kind === "last-hit";
    return {
      seat,
      amount,
      reason: lastHit ? "city-conquest" : "city-conquest-pool",
      description: `得「${cityName}」${lastHit ? "攻陷奖励" : "结算奖励"}`,
      audit: lastHit ? "cityConquestReward" : "cityConquestPoolReward",
    };
  });
}
