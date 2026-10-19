// 珍宝+城主交涉域(#322,ADR-0019 委托式拆分):交易链收尾(finishTradeChain,含
// 宝物城链尾探宝挂件 ADR-0024)、抽宝拼点(drawTreasureAt)与城主交涉
// (resolveTreasureOwner)。域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;
// 与数据表 treasures.ts 分层(流程≠数据)。escrow 托管两步(deliverEscrow/
// returnEscrowToSeller)在 bankruptcy.ts(#321),本域经 g. 壳上薄委托往返消费,
// 不在本模块重复实现。
import type { GameEngine } from "./authority";
import { guidePriceOf, premiumPriceOf } from "./treasures";
import { findHolding } from "./player";
import { formatMoney } from "./money";
import { canUpgrade } from "./economy";
import type { Player } from "./model";

/** 交易链收尾(ADR-0024 落格结算顺序正典:机遇 roll → 城池交易链 → 探宝):
 *  普通城直接结束回合;落点是宝物城则链尾必接一次探宝(抽宝拼点,自带 endTurn)。
 *  交易链的全部时机(PropertyBought/PropertyUpgraded/CashLost 等)已由各命令在
 *  调用本函数前派发完毕——TreasureGained 恒后于交易结算点,不进决策挂起期。
 *  链中途转入清算(AwaitingBankruptcySettle 挂起)或付款破产的路径不经本函数,
 *  由调用方直接 endTurn(探宝不触发)。movement-flow 各终端与 resolveTreasureOwner
 *  经壳上 g.finishTradeChain 薄委托消费。 */
export function finishTradeChain(g: GameEngine, mover: Player): void {
  const tile = g.board.at(mover.position);
  if (tile.type === "TreasureCity") {
    drawTreasureAt(g, mover, tile.name, tile.index);
    return;
  }
  g.endTurn();
}

/** 抽珍宝并拼点判定(宝物城落格)。
 *  sourceName=来源名(城名),atTile=浮动金额锚点 tile 索引。 */
export function drawTreasureAt(
  g: GameEngine,
  mover: Player,
  sourceName: string,
  atTile: number,
): void {
  g.lastLandOutcome = { kind: "Noop" };
  g.turnPhase = "Land";
  if (g.treasureDeck.length === 0) {
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 至「${sourceName}」,珍宝已被搜刮一空`,
      `treasureEmpty player=${mover.id}`,
    );
    g.endTurn();
    return;
  }
  // 随机抽 1 件
  const drawIdx = Math.floor(g.dice.nextFloat() * g.treasureDeck.length);
  const treasure = g.treasureDeck.splice(drawIdx, 1)[0];
  const guidePrice = guidePriceOf(treasure.level);
  // 拼点:掷双骰(2–12),roll ≥ 等级 即得宝
  const d1 = 1 + Math.floor(g.dice.nextFloat() * 6);
  const d2 = 1 + Math.floor(g.dice.nextFloat() * 6);
  const roll = d1 + d2;
  if (roll >= treasure.level) {
    // 成功:获得珍宝
    mover.treasures.push(treasure);
    g.pushFloater(mover, guidePrice, atTile, "income");
    // #617:得宝是资产入册非现金收付,不挂 amount;指导价降为机读估价(detail value=)
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 在「${sourceName}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} ≥ ${treasure.level},喜得珍宝!`,
      `treasureGain player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2} value=${guidePrice}`,
    );
    g.dispatchMoment("TreasureGained", {
      subject: g.players.indexOf(mover),
      treasureId: treasure.id,
    }); // 时机·TreasureGained:拼点得宝(两挂点之一,另一处在 escrow 交割)
  } else {
    // 失败:珍宝放回牌堆底
    g.treasureDeck.push(treasure);
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 在「${sourceName}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} < ${treasure.level},失之交臂`,
      `treasureMiss player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`,
    );
  }
  g.endTurn();
}

/** 城主抉择:公道买卖(指导价,玩家间付银)/ 坐地起价(加价出售,玩家间付银)/ 跳过。
 *  公道买卖且成交 → 城池 +1 级(他人到达城池本身不升级,升级只挂在公道买卖上)。
 *  两种交易都是 visitor → owner 玩家间付银(无银行注入);成交后珍宝先进交割托管区(escrowTreasure),
 *  买家付清价款才交货——托管中的珍宝不可被买家变卖抵债(防"得宝后变卖抵债"白嫖套利),买家破产则退回卖家。 */
export function resolveTreasureOwner(
  g: GameEngine,
  action:
    | { type: "fair"; treasureId: string }
    | { type: "premium"; treasureId: string }
    | { type: "skip" },
): void {
  if (!g.assertPhase("AwaitingTreasureOwner", "ResolveTreasureOwner")) return;
  const tv = g.treasureVisitor!;
  const owner = g.players[tv.ownerIdx];
  const mover = g.activePlayer;
  const def = tv.def;

  if (action.type === "skip") {
    g.logEvent("system", owner.guohao, `${owner.guohao} 不交易`, `treasureSkip owner=${owner.id}`);
    g.treasureVisitor = null;
    // 不交易也是交涉终端 → 宝物城链尾探宝(普通城 endTurn,ADR-0024)
    finishTradeChain(g, mover);
    return;
  }

  const tIdx = owner.treasures.findIndex((t) => t.id === action.treasureId);
  if (tIdx < 0) {
    g.warn(`珍宝 ${action.treasureId} 不在手中`);
    return;
  }
  const guidePrice = guidePriceOf(owner.treasures[tIdx].level);
  // 交涉只在他人有主城触发(movement-flow 落城结算),城主必持有该城;缺失 = 引擎状态 bug
  const holding = findHolding(owner, def.id)!;
  const cityLevel = holding.level;

  // 售价:fair=指导价;premium=坐地起价(per-level 加价/乘数)
  const price = action.type === "fair" ? guidePrice : premiumPriceOf(guidePrice, def, cityLevel);

  const treasure = owner.treasures.splice(tIdx, 1)[0];

  // 公道买卖且交易达成 → 城池 +1 级(满级封顶)。升级是对城主选择公道的奖励:
  // 挂在交易达成时(城主选定 fair 且珍宝已离手入托管),此后买家破产退宝也不回滚。
  if (action.type === "fair" && canUpgrade(holding)) {
    holding.level += 1;
    // 城池变更留痕(ADR-0015):公道买卖成交升级(PropertyUpgraded 另一挂点),
    // 与扩军同维度(等级变更、归属不变)
    g.propertyChanges.push({
      tileIndex: g.tileIndexOfProperty(def.id),
      level: holding.level,
      ownerColorIndex: owner.colorIndex,
      levelChanged: true,
      ownerChanged: false,
    });
    g.logEvent(
      "upgrade",
      owner.guohao,
      `${owner.guohao} 公平交易,城池「${g.tileName(def)}」升 Lv.${holding.level}`,
      `fairUpgrade prop=${def.id} owner=${owner.id} visitor=${mover.id} level=${holding.level}`,
    );
    g.dispatchMoment("PropertyUpgraded", { subject: tv.ownerIdx, propertyId: def.id }); // 时机·PropertyUpgraded:公道买卖成交升级(两挂点之一,另一处在扩军)
  }

  // 先付款后交货:珍宝进交割托管区,买家付清价款(可能经破产清算变卖其他资产自救)后才交割。
  // 托管中的珍宝不在买家 treasures 里 → 不可被 sellTreasureBankruptcy 变卖抵债(封堵套利);
  // 买家最终破产时,托管珍宝退回卖家。
  g.escrowTreasure = {
    treasure,
    buyerIdx: g.players.indexOf(mover),
    sellerIdx: tv.ownerIdx,
    price,
  };
  const cashBefore = mover.cash; // 破产扫账锚点:settleDebt 破产支路把余现金尽数过手卖家,实付≠成交价
  const r = g.payOrLiquidate(mover, owner, price);
  if (r === "liquidating") return; // 清算自救:escrow 挂起,confirmBankruptcySettle 里交割/记账
  const bankrupt = r === "bankrupt";
  if (bankrupt) g.returnEscrowToSeller(); // 买家破产:珍宝退回卖家
  else g.deliverEscrow(); // 付款到账:交货
  g.pushFloater(mover, -price, mover.position, "expense");
  g.pushFloater(owner, price, mover.position, "income");
  if (price > 0) g.dispatchMoment("CashLost", { subject: g.players.indexOf(mover), amount: price }); // 时机·CashLost:被动失银(珍宝交涉付款,访客不可拒)
  g.lastLandOutcome = {
    kind: "TreasureTrade",
    property: def,
    owner,
    amount: price,
    causedBankruptcy: bankrupt,
  };
  // 双向记账(#617):amount 只记现金实收付——直付=成交价;破产=余现金扫账(非成交价,
  // detail price 仍是谈定价)。卖家行留成交痕(+实收),买家行 treasureBuy 留付款痕(-实付),
  // 替换原「卖家名下单行 -price」把卖方收入记负的错账。
  const cashMoved = bankrupt ? cashBefore : price;
  const kindKey = action.type === "fair" ? "treasureFair" : "treasurePremium";
  const verb = action.type === "fair" ? "公道买卖" : "坐地起价";
  const bankruptSuffix = bankrupt ? " → 破产" : "";
  g.logEvent(
    "trade",
    owner.guohao,
    `${owner.guohao} ${verb}「${treasure.name}」给 ${mover.guohao},售价 ${formatMoney(price)}${bankruptSuffix}`,
    `${kindKey} owner=${owner.id} visitor=${mover.id} treasure=${treasure.id} level=${treasure.level} price=${price} bankrupt=${bankrupt}`,
    cashMoved,
  );
  g.logEvent(
    "trade",
    mover.guohao,
    `${mover.guohao} 付 ${formatMoney(cashMoved)} 购「${treasure.name}」${bankruptSuffix}`,
    `treasureBuy buyer=${mover.id} seller=${owner.id} treasure=${treasure.id} price=${price} bankrupt=${bankrupt}`,
    -cashMoved,
  );
  g.treasureVisitor = null;
  if (bankrupt) {
    // 付款破产:交易链中断,探宝不触发(ADR-0024),直接收回合
    g.endTurn();
  } else {
    // 交涉成交终端(CashLost 已派发)→ 宝物城链尾探宝(普通城 endTurn)
    finishTradeChain(g, mover);
  }
}
