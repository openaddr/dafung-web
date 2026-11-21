// 城池防御值、持有期初态及统一伤害结算。见 ADR-0064、ADR-0067。
import type { GameEngine } from "./authority";
import { tileIndexOfProperty } from "./board";
import { awardCityConquest, planCityConquest } from "./city-conquest";
import { awardCityDamage, recordCityDamage } from "./city-damage";
import type { PropertyDef } from "./economy";
import { emitGameEvent } from "./game-events";
import { findHolding } from "./player";
import type { Player, PropertyHolding } from "./model";

/** 满值表(下标=城池等级,机制域单源):0 级 5 / 1 级 4 / 2 级 3 / 3 级 2——等级越低
 *  城防越厚的橡皮筋设计(#1386)。内置图 maxLevel 均 =3;越界等级(负级/超表)取值
 *  为 undefined 即响亮抛错(零兜底:越界=数据 bug,不回退)。 */
const DEFENSE_BY_LEVEL = [5, 4, 3, 2] as const;

/** 该等级的防御满值(等级越界响亮抛错)。 */
export function fullDefenseOf(level: number): number {
  const full = DEFENSE_BY_LEVEL[level];
  if (full == null)
    throw new Error(
      `fullDefenseOf:城池等级 ${level} 越出满值表(0..${DEFENSE_BY_LEVEL.length - 1}),防御值无定义`,
    );
  return full;
}

/** 升降级后回当前等级满防，沿用本次持有期。 */
export function resetToFull(h: PropertyHolding): void {
  h.defense = fullDefenseOf(h.level);
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
    damageRanking: [],
  };
}

/** 调用侧根据结果派发城损时机。打空都城仍为 absorbed。 */
export type CityDamageOutcome =
  | { kind: "demolished"; propertyId: string; tileIndex: number }
  | { kind: "lost"; propertyId: string; tileIndex: number }
  | { kind: "absorbed"; propertyId: string; tileIndex: number };

/** 按实际扣除的防御记伤害，攻陷后先定归属与份额，再发银。 */
export function applyCityDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  damage: number,
  source: Player | null,
): CityDamageOutcome {
  if (!Number.isInteger(damage) || damage <= 0)
    throw new Error(`applyCityDamage:城池伤害须为正整数(收到 ${damage})`);
  const h = findHolding(victim, propertyId);
  if (h == null) throw new Error(`applyCityDamage:城 ${propertyId} 不在 ${victim.guohao} 名下`);
  const ownerSeat = g.players.indexOf(victim);
  const tileIndex = tileIndexOfProperty(g.board, propertyId);
  const isCapital = tileIndex === victim.capitalIndex;
  if (h.defense === 0) {
    if (h.level !== 0 || !isCapital)
      throw new Error(
        `applyCityDamage:城 ${propertyId} 防御为 0 但非打空都城(等级=${h.level},都城=${isCapital})`,
      );
    return { kind: "absorbed", propertyId, tileIndex };
  }
  let demolished = false;
  let remaining = damage;
  while (remaining > 0 && h.defense > 0) {
    h.defense -= 1;
    remaining -= 1;
    if (h.defense > 0) continue; // 纯扣防,未归零
    if (h.level > 0) {
      h.level -= 1; // 归零降 1 级并回满,剩余点数继续扣新防
      resetToFull(h);
      demolished = true;
      g.propertyChanges.push({
        tileIndex,
        level: h.level,
        ownerColorIndex: victim.colorIndex,
        levelChanged: true,
        ownerChanged: false,
      }); // 降级留痕(ADR-0015)
    }
  }

  const actualDamage = damage - remaining;
  const attackerSeat =
    source !== null && source !== victim && !source.isBankrupt ? g.players.indexOf(source) : null;
  if (attackerSeat !== null) recordCityDamage(h, attackerSeat, actualDamage);
  emitGameEvent(g, ownerSeat, {
    kind: "propertyDamaged",
    propertyId,
    level: h.level,
    defense: h.defense,
    damageRanking: h.damageRanking,
  });

  const lost = h.defense === 0 && !isCapital;
  const conquest = lost ? planCityConquest(g, ownerSeat, h, attackerSeat) : null;
  if (conquest !== null) {
    const newOwner = conquest.toSeat === null ? null : g.players[conquest.toSeat];
    victim.properties.splice(victim.properties.indexOf(h), 1);
    if (newOwner !== null) {
      resetTransferredHolding(h);
      newOwner.properties.push(h);
    }
    g.propertyChanges.push({
      tileIndex,
      level: 0,
      ownerColorIndex: newOwner === null ? null : newOwner.colorIndex,
      levelChanged: false,
      ownerChanged: true,
    });
    emitGameEvent(g, ownerSeat, { kind: "assetTransferred", propertyId, toSeat: conquest.toSeat });
  }

  if (attackerSeat !== null) awardCityDamage(g, attackerSeat, propertyId, tileIndex, actualDamage);
  if (conquest !== null) awardCityConquest(g, propertyId, tileIndex, conquest.rewards);
  const kind = lost ? "lost" : demolished && h.defense > 0 ? "demolished" : "absorbed";
  return { kind, propertyId, tileIndex };
}
