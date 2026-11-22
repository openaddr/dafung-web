import type { GameEngine } from "./authority";
import { settleCityDamageMoments } from "./city-damage-moments";
import { CITY_BURN_TURNS } from "./constants";
import { setCityBurning, settleBurningDamage } from "./defense";
import { emitGameEvent } from "./game-events";
import { findHolding } from "./player";

export interface CityBurningContinuation {
  kind: "cityBurning";
  nextTile: number;
}

/** 逐格读取当前归属与燃烧。当前城选完后，才轮到后一格。 */
export function resumeCityBurning(g: GameEngine, { nextTile }: CityBurningContinuation): boolean {
  for (let i = nextTile; i < g.board.count; i++) {
    const propertyId = g.board.at(i).propertyId;
    if (propertyId === null) continue;
    const owner = g.findOwner(propertyId);
    if (owner === null) continue;
    const holding = findHolding(owner, propertyId);
    if (holding === null) throw new Error(`城 ${propertyId} 不在城主 ${owner.guohao} 名下`);
    const burning = holding.burning;
    if (burning === null || burning.ignitedTurn >= g.turnNumber) continue;
    const ownerSeat = g.players.indexOf(owner);
    const progress = burning.progress + 1;
    if (progress < CITY_BURN_TURNS) {
      setCityBurning(g, ownerSeat, holding, { ...burning, progress });
    } else {
      emitGameEvent(g, ownerSeat, {
        kind: "propertyBurningTicked",
        propertyId,
        marks: burning.marks,
      });
      const settlement = settleBurningDamage(g, owner, propertyId, burning);
      if (
        settleCityDamageMoments(g, ownerSeat, settlement, { kind: "cityBurning", nextTile: i + 1 })
      )
        return true;
    }
  }
  return false;
}
