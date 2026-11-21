import type { GameEngine } from "./authority";
import { tileIndexOfProperty } from "./board";
import { awardCityReward, cityPriceShare } from "./city-damage";
import type { PropertyDef } from "./economy";
import type { MomentContinuation } from "./moment-stages";

export const CITY_INCOME_PERCENT = 3;

export function cityIncomeOf(property: PropertyDef): number {
  return cityPriceShare(property, CITY_INCOME_PERCENT);
}

interface CityIncome {
  seat: number;
  propertyId: string;
  tileIndex: number;
  amount: number;
}

/** 在轮末各阶段完成后，按此刻归属定稿，等待选择的城款沿用本轮清单。 */
export function planCityIncome(g: GameEngine): CityIncome[] {
  const payments: CityIncome[] = [];
  for (const [seat, player] of g.players.entries()) {
    if (player.isBankrupt) continue;
    for (const holding of player.properties) {
      const { propertyId } = holding;
      const tileIndex = tileIndexOfProperty(g.board, propertyId);
      if (tileIndex === player.capitalIndex) continue;
      const property = g.catalog.get(propertyId);
      if (property == null) throw new Error(`持城收益:城 ${propertyId} 不在目录`);
      payments.push({ seat, propertyId, tileIndex, amount: cityIncomeOf(property) });
    }
  }
  return payments;
}

export function awardCityIncome(
  g: GameEngine,
  { seat, propertyId, tileIndex, amount }: CityIncome,
  continuation: MomentContinuation,
): void {
  awardCityReward(
    g,
    seat,
    propertyId,
    {
      amount,
      reason: "city-income",
      description: `得「${g.board.at(tileIndex).name}」持城收益`,
      audit: "cityIncome",
    },
    continuation,
  );
}
