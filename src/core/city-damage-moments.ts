import type { GameEngine } from "./authority";
import type { CityBurningContinuation } from "./city-burning";
import { awardCityReward } from "./city-damage";
import type { CityDamageOutcome, CityDamageSettlement } from "./defense";
import type { ExhaustionCityDamageContinuation } from "./encounter-flow";
import type { FireWallContinuation } from "./jinnang-execution";

type CityDamageSuccessor =
  | CityBurningContinuation
  | ExhaustionCityDamageContinuation
  | FireWallContinuation
  | { kind: "jinnangExit" };

/** 已完成扣防和归属结算，从下一笔奖励接着处理。 */
export interface CityDamageContinuation {
  kind: "cityDamage";
  originalOwnerSeat: number;
  settlement: CityDamageSettlement;
  after: CityDamageSuccessor;
  nextReward: number;
}

/** 按序发银，结完每笔得银时机，再派发当前城的城损时机。 */
export function settleCityDamageMoments(
  g: GameEngine,
  originalOwnerSeat: number,
  settlement: CityDamageSettlement,
  after: CityDamageSuccessor,
  nextReward = 0,
): boolean {
  const { outcome, rewards } = settlement;
  for (let i = nextReward; i < rewards.length; i++) {
    const reward = rewards[i];
    awardCityReward(g, reward.seat, outcome.propertyId, reward, {
      kind: "cityDamage",
      originalOwnerSeat,
      settlement,
      after,
      nextReward: i + 1,
    });
    if (g.pendingMoment !== null) return true;
  }
  return dispatchCityDamageMoment(g, originalOwnerSeat, outcome, after);
}

/** 以这一击的原城主为主体。返回当前城的时机是否仍待决。 */
function dispatchCityDamageMoment(
  g: GameEngine,
  originalOwnerSeat: number,
  outcome: CityDamageOutcome,
  continuation: CityDamageSuccessor,
): boolean {
  if (outcome.kind === "absorbed") return false;
  g.dispatchMoment(
    outcome.kind === "demolished" ? "PropertyDemolished" : "PropertyLost",
    {
      subject: originalOwnerSeat,
      propertyId: outcome.propertyId,
      tileIndex: outcome.tileIndex,
    },
    continuation,
  );
  return g.pendingMoment !== null;
}
