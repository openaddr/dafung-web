// 地产交易:购买、升级、租金(整组加成)、破产裁决。对应 C# 版 Economy/。
import type {
  Player,
  PropertyDef,
  TransactionResult,
} from "./types";
import { canUpgrade } from "./types";
import { findHolding } from "./player";

/** 购买无主地产。现金不足拒绝。 */
export function buy(buyer: Player, def: PropertyDef): TransactionResult {
  if (buyer.cash < def.purchasePrice) return { status: "InsufficientFunds" };
  buyer.cash -= def.purchasePrice;
  buyer.properties.push({
    propertyId: def.id,
    group: def.group,
    purchasePrice: def.purchasePrice,
    totalUpgradeCost: 0,
    level: 0,
    maxLevel: def.maxLevel,
  });
  return { status: "Ok", newLevel: 0 };
}

/** 升级自有地产(L+1)。满级/现金不足/未持有拒绝。 */
export function upgrade(owner: Player, def: PropertyDef): TransactionResult {
  const h = findHolding(owner, def.id);
  if (!h) return { status: "NotOwned" };
  if (!canUpgrade(h)) return { status: "AlreadyMaxLevel", newLevel: h.level };
  if (owner.cash < def.upgradeCost)
    return { status: "InsufficientFunds", newLevel: h.level };
  owner.cash -= def.upgradeCost;
  h.level += 1;
  h.totalUpgradeCost += def.upgradeCost;
  return { status: "Ok", newLevel: h.level };
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
