// 城池防御值、持有期初态及统一伤害结算。见 ADR-0070。
import type { GameEngine } from "./authority";
import { tileIndexOfProperty } from "./board";
import { planCityConquest } from "./city-conquest";
import { planCityDamageReward, recordCityDamage, type CityReward } from "./city-damage";
import { INITIAL_CITY_LEVEL, MAX_CITY_LEVEL } from "./constants";
import type { PropertyDef } from "./economy";
import { emitGameEvent } from "./game-events";
import { findHolding } from "./player";
import type { CityBurning, Player, PropertyHolding } from "./model";

/** 1–4 级满防。等级越低，城防越厚。 */
const DEFENSE_BY_LEVEL = [40, 30, 20, 10] as const;
const FIRE_MARKS_PER_IGNITION = 3;
export const CITY_BURN_DAMAGE = 1;

/** 该等级的防御满值(等级越界响亮抛错)。 */
export function fullDefenseOf(level: number): number {
  const full = DEFENSE_BY_LEVEL[level - INITIAL_CITY_LEVEL];
  if (full == null)
    throw new Error(
      `fullDefenseOf:城池等级 ${level} 越出满值表(${INITIAL_CITY_LEVEL}..${MAX_CITY_LEVEL}),防御值无定义`,
    );
  return full;
}

/** 升降级后回当前等级满防并清除异常，沿用本次持有期。 */
export function resetToFull(h: PropertyHolding): void {
  h.defense = fullDefenseOf(h.level);
  h.burning = null;
}

/** 易主后开启新的持有期。 */
export function resetTransferredHolding(h: PropertyHolding): void {
  resetToFull(h);
  h.damageRanking = [];
}

export function createPropertyHolding(def: PropertyDef, level: number): PropertyHolding {
  return {
    propertyId: def.id,
    group: def.group,
    level,
    maxLevel: def.maxLevel,
    defense: fullDefenseOf(level),
    burning: null,
    damageRanking: [],
  };
}

/** 燃烧计时独立变化时同步城池状态，seat 为当前城主。 */
export function setCityBurning(
  g: GameEngine,
  ownerSeat: number,
  holding: PropertyHolding,
  burning: CityBurning | null,
): void {
  holding.burning = burning;
  emitGameEvent(g, ownerSeat, {
    kind: "propertyBurningChanged",
    propertyId: holding.propertyId,
    burning,
  });
}

/** 调用侧根据结果派发城损时机。打空都城仍为 absorbed。 */
export type CityDamageOutcome =
  | { kind: "demolished"; propertyId: string; tileIndex: number }
  | { kind: "lost"; propertyId: string; tileIndex: number }
  | { kind: "absorbed"; propertyId: string; tileIndex: number };

export interface CityDamageSettlement {
  outcome: CityDamageOutcome;
  rewards: CityReward[];
}

type CityDamageSource =
  | { kind: "normal"; player: Player | null }
  | { kind: "directFire"; player: Player }
  | { kind: "burning"; player: Player; remaining: CityBurning | null };

/** 扣防并定下归属和奖励，调用侧续接得银和城损时机。 */
export function applyCityDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  damage: number,
  source: Player | null,
): CityDamageSettlement {
  return settleCityDamage(g, victim, propertyId, damage, { kind: "normal", player: source });
}

/** 火攻与火烧连营共用，实际扣防且未破防时施加或续燃烧。 */
export function applyDirectFireDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  damage: number,
  source: Player,
): CityDamageSettlement {
  return settleCityDamage(g, victim, propertyId, damage, { kind: "directFire", player: source });
}

/** 扣防与消耗标记一同落账，银两及得银时机由回合收尾逐笔结清。 */
export function settleBurningDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  burning: CityBurning,
): CityDamageSettlement {
  return settleCityDamage(g, victim, propertyId, CITY_BURN_DAMAGE, {
    kind: "burning",
    player: g.players[burning.sourceSeat],
    remaining: burning.marks === 1 ? null : { ...burning, marks: burning.marks - 1, progress: 0 },
  });
}

/** 按实际扣除的防御记伤害，攻陷后先定归属与份额，再发银。 */
function settleCityDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  damage: number,
  damageSource: CityDamageSource,
): CityDamageSettlement {
  if (!Number.isInteger(damage) || damage <= 0)
    throw new Error(`applyCityDamage:城池伤害须为正整数(收到 ${damage})`);
  const h = findHolding(victim, propertyId);
  if (h == null) throw new Error(`applyCityDamage:城 ${propertyId} 不在 ${victim.guohao} 名下`);
  const ownerSeat = g.players.indexOf(victim);
  const tileIndex = tileIndexOfProperty(g.board, propertyId);
  const isCapital = tileIndex === victim.capitalIndex;
  if (h.defense === 0) {
    if (h.level !== INITIAL_CITY_LEVEL || !isCapital)
      throw new Error(
        `applyCityDamage:城 ${propertyId} 防御为 0 但非打空都城(等级=${h.level},都城=${isCapital})`,
      );
    return { outcome: { kind: "absorbed", propertyId, tileIndex }, rewards: [] };
  }
  const actualDamage = Math.min(damage, h.defense);
  h.defense -= actualDamage;
  const breached = h.defense === 0;
  if (breached) {
    h.burning = null;
  } else if (damageSource.kind === "directFire") {
    const previous = h.burning;
    h.burning = {
      sourceSeat: g.players.indexOf(damageSource.player),
      marks: FIRE_MARKS_PER_IGNITION,
      progress: previous === null ? 0 : previous.progress,
      ignitedTurn: previous === null ? g.turnNumber : previous.ignitedTurn,
    };
  } else if (damageSource.kind === "burning") {
    h.burning = damageSource.remaining;
  }
  const demolished = breached && h.level > INITIAL_CITY_LEVEL;
  if (demolished) {
    h.level -= 1;
    resetToFull(h);
    g.propertyChanges.push({
      tileIndex,
      level: h.level,
      ownerColorIndex: victim.colorIndex,
      levelChanged: true,
      ownerChanged: false,
    });
  }

  const source = damageSource.player;
  const attackerSeat =
    source !== null && source !== victim && !source.isBankrupt ? g.players.indexOf(source) : null;
  if (attackerSeat !== null) recordCityDamage(h, attackerSeat, actualDamage);
  emitGameEvent(g, ownerSeat, {
    kind: "propertyDamaged",
    propertyId,
    level: h.level,
    defense: h.defense,
    burning: h.burning,
    damageRanking: h.damageRanking,
  });

  const lost = h.defense === 0 && !isCapital;
  const conquest = lost ? planCityConquest(g, ownerSeat, h, attackerSeat, tileIndex) : null;
  if (conquest !== null) {
    const newOwner = conquest.toSeat === null ? null : g.players[conquest.toSeat];
    victim.properties.splice(victim.properties.indexOf(h), 1);
    if (newOwner !== null) {
      resetTransferredHolding(h);
      newOwner.properties.push(h);
    }
    g.propertyChanges.push({
      tileIndex,
      level: newOwner === null ? null : h.level,
      ownerColorIndex: newOwner === null ? null : newOwner.colorIndex,
      levelChanged: false,
      ownerChanged: true,
    });
    emitGameEvent(g, ownerSeat, { kind: "assetTransferred", propertyId, toSeat: conquest.toSeat });
  }

  const rewards = [];
  if (attackerSeat !== null)
    rewards.push(planCityDamageReward(g, attackerSeat, tileIndex, actualDamage));
  if (conquest !== null) rewards.push(...conquest.rewards);
  const kind = lost ? "lost" : demolished ? "demolished" : "absorbed";
  return { outcome: { kind, propertyId, tileIndex }, rewards };
}
