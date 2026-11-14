// 防御值机制域(#1386/#1387):城池等级附带的受损额度,火焰伤害的吸收实体。
// 本域三件:满值表(fullDefenseOf)/等级变动重置(resetToFull)/火焰伤害完整结算
// 单点(applyFireDamage)。语义定稿见 GLOSSARY「防御值」「火焰伤害」词条与规格 #1386;
// ADR 归 #1387 棒2。距离谓词(双向最短/前方距离)不属本域,棒2 另立。
import type { GameEngine } from "./authority";
import { tileIndexOfProperty } from "./board";
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

/** 等级变动(升级/降级/易主)后的防御重置单口:回当前等级满值(升级回满=奖励,
 *  #1386);平时不回复。等级写点(购入/建都/赐城/扩军/公道买卖升级/破产转移易主/
 *  火焰伤害降级)一律经此口取值;唯一例外=外敌乘虚直接降级不走防御值
 *  (encounter-flow.exhaustIfDepleted,#1386 显式两分)。 */
export function resetToFull(h: PropertyHolding): void {
  h.defense = fullDefenseOf(h.level);
}

/** 火焰伤害结算结果(供调用侧按果
 *  择一派城损时机;本单点只结算不派发,#457 口径):
 *  demolished=本次结算发生过「归零降级回满」(等级>0);lost=0 级非都城归零失城
 *  (回无主);absorbed=伤害被防御吸收未致城损(纯扣防未归零,或打空都城的免疫
 *  吸收——剩余点数作废)。0 级都城打空不是降级也不是失城,归 absorbed:调用侧不派
 *  PropertyDemolished/Lost,盾排空态由防御值本体呈现。 */
export type FireDamageOutcome =
  | { kind: "demolished"; propertyId: string; tileIndex: number }
  | { kind: "lost"; propertyId: string; tileIndex: number }
  | { kind: "absorbed"; propertyId: string; tileIndex: number };

/** 火焰伤害完整结算单点(全局唯一,#1386):victim 名下 propertyId 这座城挨 damage
 *  点火焰伤害,逐点扣防;防御归 0 时——等级>0 降 1 级并回满新等级满值(剩余点数
 *  继续扣新防)、0 级都城打空即停(此后对一切火焰伤害免疫:再次传入走 absorbed)、
 *  0 级非都城失城(回无主,无补偿)。
 *  无主城(城不在 victim 名下)传入即响亮抛错(零兜底:调用侧必须先解析城主,
 *  「无主城不受火焰伤害」由调用侧目标门把守)。
 *  留痕:降级/失城照 ADR-0015 既有维度写 propertyChanges;
 *  战报与城损时机归调用侧(火攻主动技路不派、火烧连营按果择一逐城派,T2/T3 接线)。 */
export function applyFireDamage(
  g: GameEngine,
  victim: Player,
  propertyId: string,
  damage: number,
): FireDamageOutcome {
  if (!Number.isInteger(damage) || damage <= 0)
    throw new Error(`applyFireDamage:火焰伤害须为正整数(收到 ${damage})`);
  const h = findHolding(victim, propertyId);
  if (h == null)
    throw new Error(
      `applyFireDamage:城 ${propertyId} 不在 ${victim.guohao} 名下(无主城不受火焰伤害,传入即状态 bug)`,
    );
  const tileIndex = tileIndexOfProperty(g.board, propertyId);
  const isCapital = propertyId === g.board.at(victim.capitalIndex)?.propertyId;
  // 打空都城=免疫既成态(打空即停),火焰伤害原样吸收。防御为 0 的其余形态均不可达
  // (高等级归 0 必降级回满、0 级非都城归 0 必失城),到得了这里就是状态 bug,当场炸。
  if (h.defense === 0) {
    if (h.level !== 0 || !isCapital)
      throw new Error(
        `applyFireDamage:城 ${propertyId} 防御为 0 但非打空都城(等级=${h.level},都城=${isCapital})——不可达状态`,
      );
    return { kind: "absorbed", propertyId, tileIndex };
  }
  let demolished = false;
  let remaining = damage;
  while (remaining > 0) {
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
      continue;
    }
    if (isCapital) return { kind: "absorbed", propertyId, tileIndex }; // 打空即停,剩余点数作废(免疫)
    // 0 级非都城:失城回无主(无补偿;properties 移除+ownerChanged 留痕,ADR-0015)
    victim.properties.splice(victim.properties.indexOf(h), 1);
    g.propertyChanges.push({
      tileIndex,
      level: 0,
      ownerColorIndex: null,
      levelChanged: false,
      ownerChanged: true,
    });
    return { kind: "lost", propertyId, tileIndex };
  }
  // 点数耗尽:发生过降级按 demolished 报果,否则纯吸收
  return demolished
    ? { kind: "demolished", propertyId, tileIndex }
    : { kind: "absorbed", propertyId, tileIndex };
}
