// 破产清算与交割托管域:现金不足统一挂债进入确认;仅珍宝与非都城城池可卖。
// 清偿与认破产是不同公共命令;认破产复用 economy 的资产处置,名将只回池不筹款。
// 域逻辑为自由函数,GameEngine 保留同名薄委托;所有模式经同一公共命令消费。
import type { GameEngine } from "./authority";
import { seizeBankruptAssets, sellValueOf } from "./economy";
import { guidePriceOf } from "./treasures";
import { formatMoney } from "./money";
import { emitGameEvent } from "./game-events";
import type { Player } from "./model";

/** 交割托管:买家付清价款 → 珍宝交货给买家。买家得宝(TreasureGained)/卖家售出(TreasureSold)/
 *  交易成局(TradeSettled)三个时机在此派发——无论直接付清还是清算变卖自救后付清,走到这里 =
 *  交割完成(此时卖家两路都已被付款);买家破产走退宝路径,不触发。
 *  卖家收款 CashGained 不在此派(#455 A3+A5 收款派发下沉):挂在 payOrLiquidate 直付收款点
 *  与 confirm 清偿收款点(creditor 视角),此处派会与通道派发双计。 */
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
  emitGameEvent(g, e.sellerIdx, {
    kind: "treasureTraded",
    buyerSeat: e.buyerIdx,
    sellerSeat: e.sellerIdx,
    treasureId: e.treasure.id,
    price: e.price,
  }); // 事件流(#375):珍宝交割(交易的最终事实;买卖双方银两动账已含 price)
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

/** 付款或触发清算:现金够即扣款("ok"),不足统一进入 AwaitingBankruptcySettle("liquidating")。
 *  玩家间收款统一通道(#455 A3+A5):直付到账点对债主派 CashGained(收款方视角,amount=实收);
 *  creditor=null(归银行)无玩家收款,不派发。 */
export function payOrLiquidate(
  g: GameEngine,
  mover: Player,
  creditor: Player | null,
  amount: number,
): "ok" | "liquidating" {
  if (mover.cash >= amount) {
    mover.cash -= amount;
    if (creditor) {
      creditor.cash += amount;
      g.dispatchMoment("CashGained", {
        subject: g.players.indexOf(creditor),
        amount,
      }); // 时机·CashGained:被动得银(直付收款,债主)
    }
    return "ok";
  }
  g.pendingDebt = { amount, creditor };
  g.turnPhase = "AwaitingBankruptcySettle";
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 现金不足,进入清算(欠 ${formatMoney(amount - mover.cash)})`,
    `awaitingBankruptcy player=${mover.id} debt=${amount} cash=${mover.cash}`,
  );
  return "liquidating";
}

/** 实际破产并留痕资产转移(ADR-0015):破产即转移/销毁的每处地产写一条 ownerChanged
 *  留痕(债主接管,无债主回无主),表现提取器据此产出易主宣告。等级不因转移改变。
 *  引擎内一切破产资产处置须经此口,防破产易主漏播(逐城 assetTransferred 事件在同一收口)。
 *  时机·AssetsSeized(#457):破产终局恰一派(债主视角,与 PlayerBankrupt 破产者视角
 *  成对)——珍宝在 economy.seizeBankruptAssets 内转移、名将是释放非转移,均不逐件派;
 *  无债主(归银行/销毁)无收走方,不派。 */
function seizeBankruptAssetsTraced(g: GameEngine, player: Player, creditor: Player | null): void {
  const moved = player.properties.map((h) => ({ propertyId: h.propertyId, level: h.level }));
  const treasureCount = player.treasures.length;
  seizeBankruptAssets(player, creditor);
  const toSeat = creditor ? g.players.indexOf(creditor) : null;
  for (const m of moved) {
    g.propertyChanges.push({
      tileIndex: g.tileIndexOfProperty(m.propertyId),
      level: creditor === null ? null : m.level,
      ownerColorIndex: creditor ? creditor.colorIndex : null,
      levelChanged: false,
      ownerChanged: true,
    });
    emitGameEvent(g, g.players.indexOf(player), {
      kind: "assetTransferred",
      propertyId: m.propertyId,
      toSeat,
    });
  }
  if (creditor) {
    const creditorSeat = g.players.indexOf(creditor);
    g.dispatchMoment("AssetsSeized", {
      subject: creditorSeat,
      creditorSeat,
      cities: moved.map((m) => m.propertyId),
      treasureCount,
    });
  }
}

/** 破产善后:名将释放回招贤池(treasures 已转债主);锦囊手牌清入弃牌堆
 *  (#198,设计定稿 §3「破产清空」——不转债主、不变卖、不回流)。
 *  creditor=债主(#384):随 PlayerBankrupt 派发进事件体(creditorSeat,null=归银行)。 */
function finalizeBankruptcy(g: GameEngine, p: Player, creditor: Player | null): void {
  for (const slot of p.heroes) g.recruitedHeroIds.delete(slot.heroId);
  p.heroes = [];
  if (p.jinnangHand.length > 0) {
    g.jinnangDiscard.push(...p.jinnangHand);
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }
  // 都城已转债主(资产处置已转移 properties),玩家不再持有都城。
  // 清 capitalIndex 使 capitalOwnerOf/renderTiles 不再返回破产者。
  p.capitalIndex = -1;
  g.dispatchMoment("PlayerBankrupt", {
    subject: g.players.indexOf(p),
    creditorSeat: creditor ? g.players.indexOf(creditor) : null,
  }); // 时机·PlayerBankrupt:破产出局善后完成(名将已释放、资产已转债主)
}

/** 有序逐件明细:同标识技能书可重复出现,每项消费一件真实库存。 */
export type BankruptcyAsset = { kind: "treasure" | "property"; id: string };

function liquidateTreasure(g: GameEngine, treasureId: string): void {
  const p = g.activePlayer;
  const idx = p.treasures.findIndex((t) => t.id === treasureId);
  const t = p.treasures.splice(idx, 1)[0];
  const gain = guidePriceOf(t.level);
  p.cash += gain;
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
  emitGameEvent(g, g.activeIndex, {
    kind: "assetLiquidated",
    asset: { kind: "treasure", id: t.id },
    amount: gain,
  }); // 事件流(#375):破产变卖(两类变卖之一)
  g.dispatchMoment("BankruptcySettle", { subject: g.activeIndex, amount: gain }); // 时机·BankruptcySettle:批次中一件珍宝变卖成功
}

function liquidateProperty(g: GameEngine, propId: string): void {
  const p = g.activePlayer;
  const idx = p.properties.findIndex((h) => h.propertyId === propId);
  const h = p.properties.splice(idx, 1)[0];
  // 变卖价 = 该等级的变卖价(地图 json valueByLevel 显式定义,#671 正名,旧称城池价值),非购入价
  const gain = sellValueOf(g.catalog.get(propId)!, h.level);
  p.cash += gain;
  // 城池变更留痕(ADR-0015):变卖给银行即回无主,等级维度不变
  g.propertyChanges.push({
    tileIndex: g.tileIndexOfProperty(propId),
    level: null,
    ownerColorIndex: null,
    levelChanged: false,
    ownerChanged: true,
  });
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 变卖城池得 ${formatMoney(gain)}`,
    `bkSellProp player=${p.id} prop=${propId} +${gain}`,
    gain,
  );
  g.dispatchMoment("BankruptcySettle", { subject: g.activeIndex, amount: gain }); // 时机·BankruptcySettle:批次中一座城池变卖成功
  emitGameEvent(g, g.activeIndex, {
    kind: "assetLiquidated",
    asset: { kind: "property", id: propId },
    amount: gain,
  }); // 事件流(#375):破产变卖(两类变卖之一)
}

/** 先在库存副本上核验整批,再逐件变现并一次清偿;失败不改变任何资产与现金。 */
export function confirmBankruptcySettle(g: GameEngine, assets: BankruptcyAsset[]): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "ConfirmBankruptcySettle")) return;
  const p = g.activePlayer;
  const debt = g.pendingDebt!;
  const treasures = [...p.treasures];
  const properties = [...p.properties];
  const capitalId = g.board.at(p.capitalIndex).propertyId;
  let proceeds = p.cash;
  for (const asset of assets) {
    if (proceeds >= debt.amount) {
      g.warnCommand("settlementAlreadyCovered", "清偿:已凑足债务,不可再卖");
      return;
    }
    if (asset.kind === "treasure") {
      const index = treasures.findIndex((t) => t.id === asset.id);
      if (index < 0) {
        g.warnCommand("settlementTreasureUnavailable", `清偿:珍宝 ${asset.id} 数量不足或不在手中`);
        return;
      }
      proceeds += guidePriceOf(treasures.splice(index, 1)[0].level);
    } else if (asset.kind === "property") {
      if (asset.id === capitalId) {
        g.warnCommand("capitalSaleForbidden", "清偿:都城不可变卖");
        return;
      }
      const index = properties.findIndex((h) => h.propertyId === asset.id);
      if (index < 0) {
        g.warnCommand("settlementCityUnavailable", `清偿:城 ${asset.id} 不在手中或重复选择`);
        return;
      }
      const holding = properties.splice(index, 1)[0];
      proceeds += sellValueOf(g.catalog.get(holding.propertyId)!, holding.level);
    } else {
      g.warnCommand("settlementInvalidAsset", "清偿:仅可变卖珍宝与非都城城池");
      return;
    }
  }
  if (proceeds < debt.amount) {
    g.warnCommand("settlementInsufficient", "清偿:所选资产不足,请调整预选或明确认破产");
    return;
  }
  for (const asset of assets) {
    if (asset.kind === "treasure") liquidateTreasure(g, asset.id);
    else liquidateProperty(g, asset.id);
  }
  g.pendingDebt = null;
  g.treasureVisitor = null;
  p.cash -= debt.amount;
  const escrow = g.escrowTreasure; // 非空 ⟺ 本笔债即珍宝价款(玩家间债唯一入口=resolveTreasureOwner 挂起)
  if (debt.creditor) {
    debt.creditor.cash += debt.amount;
    g.dispatchMoment("CashGained", {
      subject: g.players.indexOf(debt.creditor),
      amount: debt.amount,
    }); // 时机·CashGained:被动得银(清偿收款,债主;#455 A3+A5 收款派发下沉,deliverEscrow 不再补派)
  }
  deliverEscrow(g); // 清算自救成功:托管珍宝交货给买家
  // 时机·CashLost:被动失银(清算后清偿,#452 口径归一)——与现金直付同口径,按实付
  // 现金额派发(渔利等 CashLost 监听方三路径行为一致);破产分支为资产转移(非
  // 现金支出),不派发。
  g.dispatchMoment("CashLost", { subject: g.activeIndex, amount: debt.amount });
  // #617:清偿即买家现金支出,bkConfirm 挂 amount 作对账锚点(通用债同口径)
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 清偿债务 ${formatMoney(debt.amount)},转危为安`,
    `bkConfirm player=${p.id} paid=${debt.amount}`,
    -debt.amount,
  );
  if (escrow) {
    // #617 清算成交补卖家收款行(与直付成交卖家行同形,amount=+price)。fair/premium 以
    // 价款对指导价判定:escrow 只存价款,premium 恒溢价(坐地起价无平价参数),公平——
    // 若未来地图配出平价 premium,此处标签失真属配置边角,价格数字仍准。
    const seller = g.players[escrow.sellerIdx];
    const fair = escrow.price === guidePriceOf(escrow.treasure.level);
    g.logEvent(
      "trade",
      seller.guohao,
      `${seller.guohao} ${fair ? "公道买卖" : "坐地起价"}「${escrow.treasure.name}」给 ${p.guohao},售价 ${formatMoney(escrow.price)}`,
      `treasure${fair ? "Fair" : "Premium"} owner=${seller.id} visitor=${p.id} treasure=${escrow.treasure.id} level=${escrow.treasure.level} price=${escrow.price} bankrupt=false`,
      escrow.price,
    );
  }

  emitGameEvent(g, g.activeIndex, {
    kind: "bankruptcySettled",
    cashAfter: p.cash,
    creditor: debt.creditor
      ? { seat: g.players.indexOf(debt.creditor), cashAfter: debt.creditor.cash }
      : null,
  });
  g.turnPhase = "Land";
  g.endTurn();
}

/** 明确认破产:即使现金已凑足也尊重放弃自救的选择,沿用既有扫账、回池和托管退回。 */
export function declareBankruptcy(g: GameEngine): void {
  if (!g.assertPhase("AwaitingBankruptcySettle", "DeclareBankruptcy")) return;
  const p = g.activePlayer;
  const debt = g.pendingDebt!;
  g.pendingDebt = null;
  g.treasureVisitor = null;
  // #617:破产扫账——把买家余现金整扫给债主(无债主则现金销毁)。
  // 买家侧 bkBankrupt 的 amount 记录非零扫账金额。有债主时补卖家收款行，
  // amount 记实收，detail.price 记谈定价。
  const swept = p.cash;
  const escrow = g.escrowTreasure; // 先于退宝捕获(有债主必在托管:玩家间债唯一入口=resolveTreasureOwner 挂起)
  seizeBankruptAssetsTraced(g, p, debt.creditor);
  finalizeBankruptcy(g, p, debt.creditor);
  returnEscrowToSeller(g); // 破产:未付款的托管珍宝退回卖家
  g.logEvent(
    "system",
    p.guohao,
    `${p.guohao} 认破产,出局`,
    `bkBankrupt player=${p.id} debt=${debt.amount}`,
    swept > 0 ? -swept : undefined,
  );
  if (escrow && swept > 0) {
    const seller = g.players[escrow.sellerIdx];
    const deal = escrow;
    const fair = deal.price === guidePriceOf(deal.treasure.level);
    g.logEvent(
      "trade",
      seller.guohao,
      `${seller.guohao} ${fair ? "公道买卖" : "坐地起价"}「${deal.treasure.name}」给 ${p.guohao},售价 ${formatMoney(deal.price)},破产扫账实收 ${formatMoney(swept)}`,
      `${fair ? "treasureFair" : "treasurePremium"} owner=${seller.id} visitor=${p.id} treasure=${deal.treasure.id} level=${deal.treasure.level} price=${deal.price} bankrupt=true`,
      swept,
    );
  }
  g.turnPhase = "Land";
  g.endTurn();
}
