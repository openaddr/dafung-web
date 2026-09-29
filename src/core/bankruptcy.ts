// 破产清算+交割托管域(#321,ADR-0019 委托式拆分):escrow 交割/退回(买家付清价款才
// 交货;破产则未付款的托管珍宝退回卖家)、付款或清算(payOrLiquidate)、债务结算留痕
// (settleDebtTraced)、可变卖资产判定(hasMarketableAssets)、破产善后
// (finalizeBankruptcy)、凑足即止硬守卫(assertStillOwing)、三变卖
// (sellTreasure/sellProperty/cashHero)与清算确认(confirmBankruptcySettle)。
// 域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;与 economy.ts 分层(清算流程≠
// 经济交易原语 settleDebt/sellValueOf,原语零状态)。GameEngine 侧保留同名方法薄委托
// (game.ts):公共入口 payOrLiquidate/sellTreasureBankruptcy/sellPropertyBankruptcy/
// cashHeroBankruptcy/confirmBankruptcySettle(UI/bot/联机经 submitCommand 分发 + testing.ts
// 白盒窄面 + encounter-flow 经 g.payOrLiquidate 消费),escrow 交割/退回两步(去私有化:
// resolveTreasureOwner 壳内消费、confirmBankruptcySettle 域内直调);共享留痕辅助
// tileIndexOfProperty 留壳(#321 去私有化,域内经 g.tileIndexOfProperty 直调)。
import type { GameEngine } from "./game";
import { settleDebt, sellValueOf } from "./economy";
import { guidePriceOf } from "./treasures";
import { formatMoney } from "./money";
import type { Player } from "./types";

/** 交割托管:买家付清价款 → 珍宝交货给买家。买家得宝(TreasureGained)/卖家售出(TreasureSold)/
 *  交易成局(TradeSettled)/卖家收款(CashGained)四个时机都在此派发——无论直接付清还是
 *  清算变卖自救后付清,走到这里 = 交割完成(此时卖家两路都已被付款);买家破产走退宝路径,不触发。 */
export function deliverEscrow(g: GameEngine): void {
  const e = g.escrowTreasure;
  if (!e) return;
  g.escrowTreasure = null;
  const buyer = g.players[e.buyerIdx];
  const seller = g.players[e.sellerIdx];
  buyer.treasures.push(e.treasure);
  g.logEvent(
    "trade",
    buyer.guohao,
    `交割:「${e.treasure.name}」由 ${seller.guohao} 付予 ${buyer.guohao}(价款 ${formatMoney(e.price)} 已结)`,
    `escrowDeliver buyer=${buyer.id} seller=${seller.id} treasure=${e.treasure.id} price=${e.price}`,
  );
  g.dispatchMoment("TreasureGained", { subject: e.buyerIdx, treasureId: e.treasure.id }); // 时机·TreasureGained:escrow 交割买家得宝
  g.dispatchMoment("TreasureSold", {
    subject: e.sellerIdx,
    treasureId: e.treasure.id,
    amount: e.price,
  }); // 时机·TreasureSold:交涉成交(卖家视角)
  g.dispatchMoment("TradeSettled", {
    subject: e.sellerIdx,
    buyerSeat: e.buyerIdx,
    sellerSeat: e.sellerIdx,
    amount: e.price,
  }); // 时机·TradeSettled:买家付清、交割完成(主体=城主/卖家)
  if (e.price > 0) g.dispatchMoment("CashGained", { subject: e.sellerIdx, amount: e.price }); // 时机·CashGained:被动得银(交涉收款,卖家)
}

/** 交割托管:买家破产 → 未付款的托管珍宝退回卖家。 */
export function returnEscrowToSeller(g: GameEngine): void {
  const e = g.escrowTreasure;
  if (!e) return;
  g.escrowTreasure = null;
  const seller = g.players[e.sellerIdx];
  if (!seller.isBankrupt) {
    seller.treasures.push(e.treasure);
    g.logEvent(
      "trade",
      seller.guohao,
      `买家破产,托管珍宝「${e.treasure.name}」退回 ${seller.guohao}`,
      `escrowReturn seller=${seller.id} buyer=${g.players[e.buyerIdx].id} treasure=${e.treasure.id}`,
    );
  } else {
    g.treasureDeck.push(e.treasure); // 卖家也已被清算出局 → 珍宝回牌堆
    g.logEvent(
      "trade",
      null,
      `买卖双方俱已破产,托管珍宝「${e.treasure.name}」归入牌堆`,
      `escrowReturnToDeck treasure=${e.treasure.id}`,
    );
  }
}

/** 付款或触发清算:现金够→扣款("ok");不够但有可变卖资产→AwaitingBankruptcySettle("liquidating");无资产→破产("bankrupt")。 */
export function payOrLiquidate(
  g: GameEngine,
  mover: Player,
  creditor: Player | null,
  amount: number,
): "ok" | "liquidating" | "bankrupt" {
  if (mover.cash >= amount) {
    mover.cash -= amount;
    if (creditor) creditor.cash += amount;
    return "ok";
  }
  if (hasMarketableAssets(g, mover)) {
    g.pendingDebt = { amount, creditor };
    g.turnPhase = "AwaitingBankruptcySettle";
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 现金不足,变卖资产自救(欠 ${formatMoney(amount - mover.cash)})`,
      `awaitingBankruptcy player=${mover.id} debt=${amount} cash=${mover.cash}`,
    );
    return "liquidating";
  }
  settleDebtTraced(g, mover, creditor, amount);
  finalizeBankruptcy(g, mover);
  return "bankrupt";
}

/** 结算债务并留痕资产转移(ADR-0015):破产即转移/销毁的每处地产写一条 ownerChanged
 *  留痕(债主接管,无债主回无主),表现提取器据此产出易主宣告。等级不因转移改变。
 *  引擎内一切 settleDebt 调用须经此口,防破产易主漏播(与 pushFloater 同一收口思路)。 */
export function settleDebtTraced(
  g: GameEngine,
  player: Player,
  creditor: Player | null,
  amount: number,
): boolean {
  const moved = player.properties.map((h) => ({ propertyId: h.propertyId, level: h.level }));
  const bankrupt = settleDebt(player, creditor, amount);
  if (bankrupt) {
    for (const m of moved) {
      g.propertyChanges.push({
        tileIndex: g.tileIndexOfProperty(m.propertyId),
        level: m.level,
        ownerColorIndex: creditor ? creditor.colorIndex : null,
        levelChanged: false,
        ownerChanged: true,
      });
    }
  }
  return bankrupt;
}

export function hasMarketableAssets(g: GameEngine, p: Player): boolean {
  if (p.treasures.length > 0 || p.heroes.length > 0) return true;
  const capProp = g.board.at(p.capitalIndex)?.propertyId;
  return p.properties.some((h) => h.propertyId !== capProp);
}

/** 破产善后:名将释放回招贤池(treasures 已由 settleDebt 转债主);锦囊手牌清入弃牌堆
 *  (#198,设计定稿 §3「破产清空」——不转债主、不变卖、不回流)。 */
export function finalizeBankruptcy(g: GameEngine, p: Player): void {
  for (const h of p.heroes) g.recruitedHeroIds.delete(h.id);
  p.heroes = [];
  if (p.jinnangHand.length > 0) {
    g.jinnangDiscard.push(...p.jinnangHand);
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }
  // 都城已转债主(settleDebt 转移了 properties),玩家不再持有都城。
  // 清 capitalIndex 使 capitalOwnerOf/renderTiles 不再返回破产者。
  p.capitalIndex = -1;
  g.dispatchMoment("PlayerBankrupt", { subject: g.players.indexOf(p) }); // 时机·PlayerBankrupt:破产出局善后完成(名将已释放、资产已转债主)
}

/** 凑足即止硬守卫:现金已达自救线(≥债务)后,一切变卖命令直接拒绝(零兜底:引擎硬拒绝,不靠 UI 禁用自觉)。 */
export function assertStillOwing(g: GameEngine, label: string): boolean {
  if (g.activePlayer.cash >= g.pendingDebt!.amount) {
    g.warn(`${label}:已凑足债务,不可再卖`);
    return false;
  }
  return true;
}

export function sellTreasureBankruptcy(g: GameEngine, treasureId: string): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "SellTreasureBankruptcy")) return;
  if (!assertStillOwing(g, "SellTreasureBankruptcy")) return;
  const p = g.activePlayer;
  const idx = p.treasures.findIndex((t) => t.id === treasureId);
  if (idx < 0) {
    g.warn(`珍宝 ${treasureId} 不在手中`);
    return;
  }
  const t = p.treasures.splice(idx, 1)[0];
  const gain = guidePriceOf(t.level);
  p.cash += gain;
  g.pushFloater(p, gain, p.position, "income");
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 变卖「${t.name}」得 ${formatMoney(gain)}`,
    `bkSellTreasure player=${p.id} treasure=${t.id} +${gain}`,
    gain,
  );
  g.dispatchMoment("TreasureSold", {
    subject: g.activeIndex,
    treasureId: t.id,
    amount: gain,
  }); // 时机·TreasureSold:破产变卖珍宝(两挂点之一,另一处在交割)
  g.dispatchMoment("BankruptcySettle", { subject: g.activeIndex, amount: gain }); // 时机·BankruptcySettle:变卖珍宝成功(三变卖命令之一)
}

export function sellPropertyBankruptcy(g: GameEngine, propId: string): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "SellPropertyBankruptcy")) return;
  if (!assertStillOwing(g, "SellPropertyBankruptcy")) return;
  const p = g.activePlayer;
  if (propId === g.board.at(p.capitalIndex)?.propertyId) {
    g.warn("都城不可变卖");
    return;
  }
  const idx = p.properties.findIndex((h) => h.propertyId === propId);
  if (idx < 0) {
    g.warn(`城 ${propId} 不在手中`);
    return;
  }
  const h = p.properties.splice(idx, 1)[0];
  // 变卖价 = 该等级的城池价值(地图 json valueByLevel 显式定义),非购入价
  const gain = sellValueOf(g.catalog.get(propId)!, h.level);
  p.cash += gain;
  // 城池变更留痕(ADR-0015):变卖给银行即回无主,等级维度不变
  g.propertyChanges.push({
    tileIndex: g.tileIndexOfProperty(propId),
    level: h.level,
    ownerColorIndex: null,
    levelChanged: false,
    ownerChanged: true,
  });
  g.pushFloater(p, gain, p.position, "income");
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 变卖城池得 ${formatMoney(gain)}`,
    `bkSellProp player=${p.id} prop=${propId} +${gain}`,
    gain,
  );
  g.dispatchMoment("BankruptcySettle", { subject: g.activeIndex, amount: gain }); // 时机·BankruptcySettle:变卖城池成功(三变卖命令之一)
}

export function cashHeroBankruptcy(g: GameEngine, heroId: string): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "CashHeroBankruptcy")) return;
  if (!assertStillOwing(g, "CashHeroBankruptcy")) return;
  const p = g.activePlayer;
  const idx = p.heroes.findIndex((h) => h.id === heroId);
  if (idx < 0) {
    g.warn(`名将 ${heroId} 不在手中`);
    return;
  }
  const h = p.heroes.splice(idx, 1)[0];
  g.recruitedHeroIds.delete(heroId);
  p.cash += 200; // 名将换银(200 两)
  g.pushFloater(p, 200, p.position, "income");
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 遣散「${h.name}」得 ${formatMoney(200)}`,
    `bkCashHero player=${p.id} hero=${heroId} +200`,
    200,
  );
  g.dispatchMoment("BankruptcySettle", { subject: g.activeIndex, amount: 200 }); // 时机·BankruptcySettle:遣散名将成功(三变卖命令之一)
}

export function confirmBankruptcySettle(g: GameEngine): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "ConfirmBankruptcySettle")) return;
  const p = g.activePlayer;
  const debt = g.pendingDebt!;
  g.pendingDebt = null;
  if (g.treasureVisitor) g.treasureVisitor = null;
  if (p.cash >= debt.amount) {
    p.cash -= debt.amount;
    if (debt.creditor) debt.creditor.cash += debt.amount;
    deliverEscrow(g); // 清算自救成功:托管珍宝交货给买家
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 清偿债务 ${formatMoney(debt.amount)},转危为安`,
      `bkConfirm player=${p.id} paid=${debt.amount}`,
    );
  } else {
    settleDebtTraced(g, p, debt.creditor, debt.amount);
    finalizeBankruptcy(g, p);
    returnEscrowToSeller(g); // 破产:未付款的托管珍宝退回卖家
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 变卖殆尽仍不足,破产出局`,
      `bkBankrupt player=${p.id} debt=${debt.amount}`,
    );
  }
  g.turnPhase = "Land";
  g.endTurn();
}
