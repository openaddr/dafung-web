// 地产交易:购买、升级、破产裁决(本作无过路费/升级费:自己到达己城可选免费扩军,
// 他人落城走珍宝交涉——公道买卖成交才升级;收入全靠卖珍宝与都城补给)。
import type {
  Player,
  PropertyDef,
  TransactionResult,
} from "./types";
import { canUpgrade } from "./types";
import { findHolding } from "./player";

/** 购买无主地产(购入即为 Lv.0)。现金不足拒绝。 */
export function buy(buyer: Player, def: PropertyDef): TransactionResult {
  if (buyer.cash < def.purchasePrice) return { status: "InsufficientFunds" };
  buyer.cash -= def.purchasePrice;
  buyer.properties.push({
    propertyId: def.id,
    group: def.group,
    purchasePrice: def.purchasePrice,
    level: 0,
    maxLevel: def.maxLevel,
  });
  return { status: "Ok", newLevel: 0 };
}

/** 升级自有地产(L+1,免费——自己到达己城可选扩军,本作无升级费)。满级/未持有拒绝。 */
export function upgrade(owner: Player, def: PropertyDef): TransactionResult {
  const h = findHolding(owner, def.id);
  if (!h) return { status: "NotOwned" };
  if (!canUpgrade(h)) return { status: "AlreadyMaxLevel", newLevel: h.level };
  h.level += 1;
  return { status: "Ok", newLevel: h.level };
}

/** 城池当前等级的变卖价(各等级价值显式定义于地图 json 的 valueByLevel,下标 = 等级)。 */
export function sellValueOf(def: PropertyDef, level: number): number {
  return def.valueByLevel[level];
}

/** 都城补给 = resupplyPerLevel × (level+1);def/level 缺失时为 0。集中一处,供引擎/bot/UI 复用。 */
export function supplyFor(resupplyPerLevel: number | undefined, level: number | undefined): number {
  return (resupplyPerLevel ?? 0) * ((level ?? 0) + 1);
}

/**
 * 破产裁决:玩家无法清偿债务时淘汰,资产(含都城地产)转移给债主(无债主归银行/销毁)。
 * 返回是否触发破产。都城补给为正收入,不走此路径。
 */
export function settleDebt(
  player: Player,
  creditor: Player | null,
  amount: number,
): boolean {
  if (player.cash >= amount) {
    player.cash -= amount;
    if (creditor) creditor.cash += amount;
    return false;
  }
  // 现金不足:先掏空现金给债主,然后破产转移资产
  if (creditor) creditor.cash += player.cash;
  player.cash = 0;
  if (creditor) {
    creditor.properties.push(...player.properties);
    creditor.treasures.push(...player.treasures);
  }
  player.properties = [];
  player.treasures = [];
  player.isBankrupt = true;
  return true;
}
