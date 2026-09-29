// 珍宝+随机事件+城主交涉域(#322,ADR-0019 委托式拆分):宝物城落格与辅路格结算
// (resolveTreasureCity/resolveBranchCell)、抽宝拼点(drawTreasureAt)、随机事件结算
// (applyRandomEvent)与城主交涉(resolveTreasureOwner)。
// 域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;与数据表 treasures.ts 分层
// (流程≠数据)。escrow 托管两步(deliverEscrow/returnEscrowToSeller)在 bankruptcy.ts
// (#321),本域经 g. 壳上薄委托往返消费,不在本模块重复实现。
import type { GameEngine } from "./authority";
import type { BranchCell } from "./board";
import { CHANCE_EVENTS } from "./events";
import { guidePriceOf, premiumPriceOf } from "./treasures";
import { findHolding } from "./player";
import { formatMoney } from "./money";
import { canUpgrade } from "./types";
import type { Player, TileDef } from "./types";

/** 宝物城落格:从牌堆抽 1 件 → 掷双骰(2d6)判定 → ≥ 等级则获得。 */
export function resolveTreasureCity(g: GameEngine, mover: Player, tile: TileDef): void {
  drawTreasureAt(g, mover, tile.name, tile.index);
}

/** 抽珍宝并拼点判定(复用于宝物城落格 + 辅路 treasure 格)。
 *  sourceName=来源名(城名/「辅路探宝」),atTile=浮动金额锚点 tile 索引。 */
export function drawTreasureAt(g: GameEngine, mover: Player, sourceName: string, atTile: number): void {
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
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 在「${sourceName}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} ≥ ${treasure.level},喜得珍宝!`,
      `treasureGain player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`,
      guidePrice,
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

/** 随机事件(锦囊/天命 + 辅路 event 格):抽一条事件,结算 cashDelta(经 payOrLiquidate)。 */
export function applyRandomEvent(
  g: GameEngine,
  mover: Player,
  sourceName: string,
  atTile: number,
  pool: ReadonlyArray<{ id: string; text: string; cashDelta: number; jinnangDraw?: true }>,
  logTag: string,
): void {
  g.lastLandOutcome = { kind: "Noop" };
  g.turnPhase = "Land";
  const ev = pool[Math.floor(g.dice.nextFloat() * pool.length)];
  let bankrupt = false;
  if (ev.cashDelta >= 0) {
    mover.cash += ev.cashDelta;
  } else {
    const r = g.payOrLiquidate(mover, null, -ev.cashDelta);
    if (r === "liquidating") return; // 进入清算,confirm 后 endTurn
    bankrupt = r === "bankrupt";
  }
  g.pushFloater(mover, ev.cashDelta, atTile, ev.cashDelta >= 0 ? "income" : "expense");
  if (ev.cashDelta < 0)
    g.dispatchMoment("CashLost", {
      subject: g.players.indexOf(mover),
      amount: -ev.cashDelta,
    }); // 时机·CashLost:被动失银(锦囊/天命/辅路事件)
  if (ev.cashDelta > 0)
    g.dispatchMoment("CashGained", {
      subject: g.players.indexOf(mover),
      amount: ev.cashDelta,
    }); // 时机·CashGained:被动得银(随机事件得款)
  if (ev.jinnangDraw) {
    // 军师来投(#147):事件额外献锦囊一张
    g.pushFloaterText(mover, "军师来投,献计一封", atTile);
    g.drawJinnang(g.players.indexOf(mover), 1);
  }
  g.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 落 ${sourceName}:${ev.text} ${ev.cashDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(ev.cashDelta))}${bankrupt ? " → 破产" : ""}`,
    `${logTag} player=${mover.id} event=${ev.id} delta=${ev.cashDelta} cash=${mover.cash}`,
    ev.cashDelta,
  );
  g.endTurn();
}

/** 辅路格落格:treasure=拼点探宝(复用 drawTreasureAt);event=锦囊(复用 applyRandomEvent);
 *  penalty=中伏,skipTurns=1(下回合跳过)。 */
export function resolveBranchCell(g: GameEngine, mover: Player, cell: BranchCell): void {
  if (cell.kind === "treasure") {
    drawTreasureAt(g, mover, "辅路探宝", mover.position);
    return;
  }
  if (cell.kind === "event") {
    applyRandomEvent(g, mover, "辅路锦囊", mover.position, CHANCE_EVENTS, "branchChance");
    return;
  }
  // penalty:中伏,下回合跳过
  g.lastLandOutcome = { kind: "Noop" };
  g.turnPhase = "Land";
  mover.skipTurns = 1;
  g.logEvent(
    "branch",
    mover.guohao,
    `${mover.guohao} 在辅路中伏,下回合跳过`,
    `branchPenalty player=${mover.id} skipTurns=1`,
  );
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
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 不交易`,
      `treasureSkip owner=${owner.id}`,
    );
    g.treasureVisitor = null;
    g.endTurn();
    return;
  }

  const tIdx = owner.treasures.findIndex((t) => t.id === action.treasureId);
  if (tIdx < 0) {
    g.warn(`珍宝 ${action.treasureId} 不在手中`);
    return;
  }
  const guidePrice = guidePriceOf(owner.treasures[tIdx].level);
  const holding = findHolding(owner, def.id);
  const cityLevel = holding?.level ?? 0;

  // 售价:fair=指导价;premium=坐地起价(per-level 加价/乘数)
  const price = action.type === "fair" ? guidePrice : premiumPriceOf(guidePrice, def, cityLevel);

  const treasure = owner.treasures.splice(tIdx, 1)[0];

  // 公道买卖且交易达成 → 城池 +1 级(满级封顶)。升级是对城主选择公道的奖励:
  // 挂在交易达成时(城主选定 fair 且珍宝已离手入托管),此后买家破产退宝也不回滚。
  if (action.type === "fair" && holding && canUpgrade(holding)) {
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
  const r = g.payOrLiquidate(mover, owner, price);
  if (r === "liquidating") return; // 清算自救:escrow 挂起,confirmBankruptcySettle 里交割/退还
  const bankrupt = r === "bankrupt";
  if (bankrupt) g.returnEscrowToSeller(); // 买家破产:珍宝退回卖家
  else g.deliverEscrow(); // 付款到账:交货
  g.pushFloater(mover, -price, mover.position, "expense");
  g.pushFloater(owner, price, mover.position, "income");
  if (price > 0)
    g.dispatchMoment("CashLost", { subject: g.players.indexOf(mover), amount: price }); // 时机·CashLost:被动失银(珍宝交涉付款,访客不可拒)
  g.lastLandOutcome = {
    kind: "TreasureTrade",
    property: def,
    owner,
    amount: price,
    causedBankruptcy: bankrupt,
  };
  const verb = action.type === "fair" ? "公道买卖" : "坐地起价";
  g.logEvent(
    "trade",
    owner.guohao,
    `${owner.guohao} ${verb}「${treasure.name}」给 ${mover.guohao},售价 ${formatMoney(price)}${bankrupt ? " → 破产" : ""}`,
    `treasure${action.type === "fair" ? "Fair" : "Premium"} owner=${owner.id} visitor=${mover.id} treasure=${treasure.id} level=${treasure.level} price=${price} bankrupt=${bankrupt}`,
    -price,
  );
  g.treasureVisitor = null;
  g.endTurn();
}
