// 移动结算域(#323,ADR-0019 委托式拆分):行军三件(rollAndMove/marchTraverse/
// settleMarchLanding,含伏兵挂点/驻跸必停)、
// 待决策落格定义(pendingLandDef)、地产决策命令(buyProperty/upgradeProperty/
// endDecision)、落格结算(resolveLanding;resolveCityEvent/resolveProperty/
// enterDecisionPhase 域内自洽不留壳)与都城补给(capitalSupplyOf;applyResupply
// 域内自洽不留壳)。
// 域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;GameEngine 侧保留同名公共
// 方法薄委托(外部 importer 无感),src/core/authority.ts「回合状态机」区段。
// 跨域往返统一经壳上薄委托(与既有票一致):机遇 g.maybeApplyEncounter、抽宝拼点
// g.drawTreasureAt(珍宝城落格固定事件位,#825)、escrow 清算
// g.payOrLiquidate、锦囊抽牌 g.drawJinnang、招贤 g.tryRecruitHero;唯一例外是开拦检窗
// 直调 reaction-window.openReactionWindow(已导出自由函数,#318 预留的私有壳委托随本域
// 迁出而删);reaction-window 续走则经壳上 g.marchTraverse/g.settleMarchLanding 回调。
import type { GameEngine } from "./authority";
import { computeChoices } from "./choices";
import { buy, upgrade } from "./economy";
import { findHolding } from "./player";
import { jinnangCardOf } from "./jinnang";
import { openReactionWindow } from "./reaction-window";
import { formatMoney } from "./money";
import { emitGameEvent, requireMovePath } from "./game-events";
import { SIGN_FACES, WARRANTS_PER_PASS, BUY_WARRANT_COST } from "./constants";
import type { Player } from "./model";
import type { PropertyDef } from "./economy";
import { isEventCity } from "./board";
import type { TileDef } from "./board";

// ── 落格结果类型(#326 types.ts 解散,ADR-0019 类型随域走)──
/** 落格结果。 */
export type LandOutcomeKind = "Noop" | "PropertyAvailable" | "OwnProperty" | "TreasureTrade";

export interface LandOutcome {
  kind: LandOutcomeKind;
  property?: PropertyDef;
  owner?: Player;
  amount?: number; // 珍宝成交价
  resupply?: number; // 都城补给
  causedBankruptcy?: boolean;
}

// ── 决策载荷与表现态分离(spec #107 C2)──
/** 待决策落格的决策种类:无主城可购 / 己城可扩军。 */
export type PendingLandKind = "PropertyAvailable" | "OwnProperty";

/** 待决策落格载荷:决策上下文(购地/扩军命令与选项集计算的唯一依据),与表现态
 *  LandOutcome 分离。只含最小可序列化上下文——propertyId 是唯一句柄,价格/等级口径
 *  由 catalog 按 id 现查,恢复/联机不丢引用(旧 lastLandOutcome 兼任决策载荷时,曾因
 *  property 引用的序列化缺口在恢复后丢失决策上下文)。 */
export interface PendingLand {
  kind: PendingLandKind;
  propertyId: string;
}

/** LandOutcome 的快照行(纯表现态;propertyId 句柄,定义由 catalog 按需现查)。 */
export interface LandOutcomeSnapshot {
  kind: LandOutcomeKind;
  propertyId: string | null;
  amount: number | null;
  resupply: number | null;
  causedBankruptcy: boolean | null;
}

/** 抽签 → 移动 → 经过自己都城必停(补给+结束回合);否则落格结算。
 *  主路途经遍历(#281):每格途经棋子派发;他人城主城池可被半路杀出拦检,窗挂起时
 *  本调用返回,respondReaction 应答后续走/落格。 */
export function rollAndMove(g: GameEngine): void {
  if (!g.assertPhase("Roll", "RollAndMove")) return;
  const mover = g.activePlayer;
  g.dispatchMoment("BeforeMarch", { subject: g.activeIndex }); // 时机·BeforeMarch:掷骰前(行军加成挂点,如周瑜 moveBonus)
  g.dispatchMoment("BeforeRoll", { subject: g.activeIndex }); // 时机·BeforeRoll:掷骰前、BeforeMarch 之后(骰子机制系技能挂点,与 BeforeMarch 的语义区分见 timing.ts)
  const roll = g.dice.roll();
  g.lastRoll = roll;
  g.dispatchMoment("DieRolled", { subject: g.activeIndex, die: roll.die }); // 时机·DieRolled:骰面已定(张星彩 gainIfFace 等)
  const moveBonus = g.takeMarchBonus(); // 取走 BeforeMarch 时机累计的行军加成
  const drumBonus = g.heroDiceBonus; // 取走擂鼓加成(#188 档 3):发动与掷骰同回合
  g.heroDiceBonus = 0;
  const steps = roll.die + moveBonus + drumBonus;
  const path = g.board.computePath(mover.position, steps, mover.capitalIndex);
  const fromPos = mover.position;
  g.lastMove = path;
  const destName = g.board.at(path.landIndex).name;
  g.logEvent(
    "roll",
    mover.guohao,
    `${mover.guohao} 抽签 ${SIGN_FACES[roll.die - 1]}${moveBonus + drumBonus ? `(+${moveBonus + drumBonus})` : ""} → ${destName}`,
    `roll player=${mover.id} die=${roll.die} steps=${steps} bonus=${moveBonus + drumBonus} from=#${fromPos} land=#${path.landIndex} passedCapital=${path.passedCapital} wps=${path.waypoints.length}`,
  );

  // 逐格途经遍历,#281 反应窗可中途拦停
  const walked = marchTraverse(
    g,
    mover,
    path.traversed,
    path.traversed.length,
    path.landIndex,
    fromPos,
    steps,
  );
  if (walked !== "landed") return; // suspended=拦检窗挂起(respondReaction 续走);halted=必停已结算
  settleMarchLanding(g, mover, path.landIndex);
}

/** 途经遍历(#281):逐格走 remaining(原 traversed 的未走切片,不含起点含落点),
 *  每格依次:① PassedPlayer(途经非破产他人棋子,座位序);② 己都城——颁发委任状,
 *  落点不在都城则必停截断(放弃剩余步数,机遇→补给→结束回合,ADR-0035);③ 他人城主城池
 *  (城主存活)——派发 MarchPassedCity,城主持半路杀出则开拦检窗(挂停返回 "suspended",
 *  respondReaction 续走),拦停成功即止、后续城不再问。
 *  返回:"suspended"=拦检窗挂起、"halted"=必停都城已结算(调用方直接返回)、
 *  "landed"=走完无停,由调用方 settleMarchLanding 落格。 */
export function marchTraverse(
  g: GameEngine,
  mover: Player,
  remaining: number[],
  totalLen: number,
  landIndex: number,
  fromPos: number,
  steps: number,
): "landed" | "halted" | "suspended" {
  const moverSeat = g.players.indexOf(mover);
  while (remaining.length > 0) {
    const tIdx = remaining[0];
    // ① 途经他人棋子(座位序,确定性;主体=行军者,ctx.passedSeat=被途经者)
    for (let seat = 0; seat < g.players.length; seat++) {
      const other = g.players[seat];
      if (other === mover || other.isBankrupt || other.position !== tIdx) continue;
      g.dispatchMoment("PassedPlayer", {
        subject: moverSeat,
        passedSeat: seat,
        tileIndex: tIdx,
      });
    }
    // ② 己都城:巡幸委任状;若落点不在都城 → 必停截断(lastMove 只走到都城)
    if (tIdx === mover.capitalIndex) {
      mover.warrants += WARRANTS_PER_PASS;
      g.dispatchMoment("WarrantGained", {
        subject: moverSeat,
        tileIndex: tIdx,
      }); // 时机·WarrantGained:途经己都城巡幸得委任状(#456,必停截断/恰落都城两路同挂)
      g.logEvent(
        "supply",
        mover.guohao,
        `${mover.guohao} 巡幸都城,获 ${WARRANTS_PER_PASS} 委任状`,
        `warrantGrant player=${mover.id} +${WARRANTS_PER_PASS} warrants=${mover.warrants}`,
      );
      if (landIndex !== mover.capitalIndex) {
        const walkedCount = totalLen - remaining.length;
        g.lastMove = g.board.computePath(fromPos, walkedCount + 1, mover.capitalIndex);
        mover.position = mover.capitalIndex;
        g.dispatchMoment("AfterMarch", { subject: moverSeat }); // 时机·AfterMarch:移动完成(必停都城)、落格结算前
        g.dispatchMoment("CapitalHalt", {
          subject: moverSeat,
          tileIndex: mover.capitalIndex,
        }); // 时机·CapitalHalt:必停都城(AfterMarch 后、落格结算处)
        // 机遇必出(ADR-0035,#776):驻跸截断同走「机遇先于落格结算」单链,零豁免;
        // 抉择机遇占用本落格时置 pendingEncounterHalt,解完由 settleEncounterChoice 续跑
        // finishCapitalHalt;清算/破产/耗竭接管本落格,驻跸尾不再续跑(人倒下了不领补给)。
        g.turnPhase = "Land";
        g.pendingEncounterHalt = true;
        const enc = g.maybeApplyEncounter(mover);
        if (enc === "deciding") return "halted"; // 抉择机遇解完续跑驻跸尾(标记保持)
        g.pendingEncounterHalt = false; // 直落/中断占用:标记作废
        if (enc === "none" || enc === "settled") finishCapitalHalt(g, mover);
        return "halted"; // 必停已完整结算或已移交接管方:调用方不得再走落格收尾
      }
    }
    // ③ 他人城主城池(城主存活):MarchPassedCity 挂点 → 半路杀出拦检窗
    const tile = g.board.at(tIdx);
    if (tile.propertyId != null) {
      const owner = g.findOwner(tile.propertyId);
      if (owner != null && owner !== mover && !owner.isBankrupt) {
        const ownerSeat = g.players.indexOf(owner);
        g.dispatchMoment("MarchPassedCity", {
          subject: moverSeat,
          ownerSeat,
          tileIndex: tIdx,
        }); // 时机·MarchPassedCity:途经他人城主城池(反应窗挂点)
        const ambushId = owner.jinnangHand.find((id) => jinnangCardOf(id).effect.kind === "ambush");
        if (ambushId != null) {
          const walkedCount = totalLen - remaining.length;
          openReactionWindow(
            g,
            { kind: "march", cardId: ambushId, userSeat: moverSeat, ownerSeat },
            {
              kind: "march",
              moverSeat,
              tileIndex: tIdx,
              stepsToTile: walkedCount + 1,
              totalTiles: totalLen,
              resumeTiles: remaining.slice(1),
              landIndex,
              fromPos,
              steps,
            },
          );
          return "suspended"; // 窗挂起:人类被询问时等 respondReaction;bot 全代答时续走已在窗结算内完成
        }
      }
    }
    remaining = remaining.slice(1);
  }
  return "landed";
}

/** 驻跸截断结算尾(ADR-0035):补给(cause=halt 战报)+ 结束回合。直落(marchTraverse)
 *  与机遇解完续跑(settleEncounterChoice 经壳上 g.finishCapitalHalt 委托)两路共用。 */
export function finishCapitalHalt(g: GameEngine, mover: Player): void {
  const supply = applyResupply(g, mover, "halt");
  g.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
  g.turnPhase = "Land";
  g.endTurn();
}

/** 落格收尾(走完遍历无拦停):落位、AfterMarch、落格结算(机遇/城池)。 */
export function settleMarchLanding(g: GameEngine, mover: Player, landIndex: number): void {
  mover.position = landIndex;
  emitGameEvent(g, g.players.indexOf(mover), {
    kind: "marchArrived",
    tileIndex: landIndex,
    path: requireMovePath(g, "marchArrived"), // #385:路径随事件走(合并批多段行军各播各段)
  }); // 事件流(#375):行军落格
  g.dispatchMoment("AfterMarch", { subject: g.players.indexOf(mover) }); // 时机·AfterMarch:移动完成(落位)、落格结算(resolveLanding)前
  g.turnPhase = "Land";
  // 机遇必出(ADR-0035,#776):早于落格结算,零豁免(驻跸截断同链);清算/破产
  // 则中断落格结算。enabled=false 为系统总开关(引擎缺省关,测试隔离)。
  // 特殊城池免掷(#823/#824,ADR-0037):落点是事件城 → 固定事件即此地固定机遇,随机
  // 机遇不掷(驻跸截断不落格、不走此门,机遇必出零豁免照旧)。
  // 抉择机遇(#124)返回 deciding:机遇占用本落格——含 ≤1 可用选项自动执行已收尾的场合,
  // 机遇早于城池结算:即时机遇 settled → 继续本落格结算;抉择机遇 deciding → 待解,
  // 解完在 settleEncounterChoice 内继续落格结算(#120 决策 2);清算/破产已中断;
  // 耗竭 exhausted(#132):体力归 0 → 耗竭相位/自动惩罚占用本落格——人倒下了不买地。
  const enc = isEventCity(g.board.at(mover.position)) ? "none" : g.maybeApplyEncounter(mover);
  if (enc === "deciding" || enc === "liquidating" || enc === "bankrupt" || enc === "exhausted")
    return;
  resolveLanding(g);
}

/** 待决策落格的地产定义:价格/等级口径的单一出处(catalog 按 pendingLand.propertyId 现查;
 *  快照恢复只带 id 句柄,定义不序列化)。查无定义 = 数据 bug,显式抛错(零兜底)。 */
export function pendingLandDef(g: GameEngine): PropertyDef {
  if (g.pendingLand == null)
    throw new Error("pendingLandDef:当前无待决策落格(仅 AwaitingDecision 相位有决策上下文)");
  const def = g.catalog.get(g.pendingLand.propertyId);
  if (def == null)
    throw new Error(`pendingLand:城 ${g.pendingLand.propertyId} 不在 catalog(数据 bug)`);
  return def;
}

/** 购地(决策命令):委任状不足拒绝(NoWarrant);购入消耗委任状 + 留痕(ADR-0015)+ 战报。 */
export function buyProperty(g: GameEngine): void {
  if (!g.assertPhase("AwaitingDecision", "BuyProperty")) return;
  const def = pendingLandDef(g);
  const buyer = g.activePlayer;
  // 进驻(买)新城需要委任状;不足则拒绝(NoWarrant),UI 会禁用购买按钮
  if (buyer.warrants < BUY_WARRANT_COST) {
    g.lastTransaction = { status: "NoWarrant" };
    g.endTurn(); // 自动拒绝也是交易链终端:收口结束回合(探宝已在落格先行,#825)
    return;
  }
  const r = buy(buyer, def);
  g.lastTransaction = r;
  if (r.status === "Ok") {
    buyer.warrants -= BUY_WARRANT_COST; // 消耗委任状
    // 城池变更留痕(ADR-0015):购入即易主(无主 → 买家),等级维度不变(购入为 Lv.0)
    g.propertyChanges.push({
      tileIndex: buyer.position,
      level: r.newLevel,
      ownerColorIndex: buyer.colorIndex,
      levelChanged: false,
      ownerChanged: true,
    });
    g.logEvent(
      "buy",
      buyer.guohao,
      `${buyer.guohao} 购「${g.tileName(def)}」(${BUY_WARRANT_COST}委任 + ${formatMoney(def.purchasePrice)})`,
      `buy player=${buyer.id} prop=${def.id} price=${def.purchasePrice} warrant-${BUY_WARRANT_COST} warrants=${buyer.warrants} cash=${buyer.cash}`,
      -def.purchasePrice,
    );
    g.dispatchMoment("PropertyBought", { subject: g.activeIndex, propertyId: def.id }); // 时机·PropertyBought:购城成功尾
  }
  // 交易链终端(买成/拒买):先收尾交易链全部时机派发,再结束回合(链序随 #825 迁移:
  // 探宝已在落格固定事件位先行,链尾零探宝)。
  g.endTurn();
}

/** 扩军(决策命令):免费升一级,留痕(ADR-0015,等级维度)+ 战报。 */
export function upgradeProperty(g: GameEngine): void {
  if (!g.assertPhase("AwaitingDecision", "UpgradeProperty")) return;
  const def = pendingLandDef(g);
  const r = upgrade(g.activePlayer, def);
  g.lastTransaction = r;
  if (r.status === "Ok") {
    // 城池变更留痕(ADR-0015):扩军 = 等级维度变更(印重钤 + 楼生长),归属不变
    g.propertyChanges.push({
      tileIndex: g.activePlayer.position,
      level: r.newLevel,
      ownerColorIndex: g.activePlayer.colorIndex,
      levelChanged: true,
      ownerChanged: false,
    });
    g.logEvent(
      "upgrade",
      g.activePlayer.guohao,
      `${g.activePlayer.guohao} 扩军「${g.tileName(def)}」至 Lv.${r.newLevel}(免费)`,
      `upgrade player=${g.activePlayer.id} prop=${def.id} level=${r.newLevel} cash=${g.activePlayer.cash}`,
    );
    g.dispatchMoment("PropertyUpgraded", { subject: g.activeIndex, propertyId: def.id }); // 时机·PropertyUpgraded:扩军成功(两挂点之一,另一处在公道买卖成交)
  }
  // 交易链终端(升成):PropertyUpgraded 派发完后结束回合(探宝已在落格先行,#825)
  g.endTurn();
}

/** 按兵不动(决策命令):放弃购地/扩军,交易链终端收口结束回合(探宝已在落格先行,#825)。 */
export function endDecision(g: GameEngine): void {
  if (!g.assertPhase("AwaitingDecision", "EndDecision")) return;
  g.logEvent(
    "system",
    g.activePlayer.guohao,
    `${g.activePlayer.guohao} 按兵不动`,
    `skip player=${g.activePlayer.id}`,
  );
  g.endTurn();
}

/** 落格结算(#826 全城池制):己都城(补给+招贤)/ 普通城掷机遇后的城池交易链 /
 *  特殊城池(固定事件 → 交易链,#824 ADR-0037)。落格结算顺序正典(ADR-0024 链序随
 *  #825 迁移):**机遇必出(事件城免掷,ADR-0035/0037)→ [固定事件 →] 城池交易链
 *  (购地/扩军/按兵不动/珍宝交涉,含自动拒绝;一次落格至多一段)→ 结束回合**。珍宝城的
 *  探宝是固定事件本身(movement-flow resolveCityEvent 经壳上 g.drawTreasureAt 消费),
 *  **先于交易链**:链中清算/破产不再抑制探宝(已结算),交易链收口零探宝(链尾钩子已拆)。 */
export function resolveLanding(g: GameEngine): void {
  const mover = g.activePlayer;
  // 落点恰为自己都城:补给 + 招贤纳士(都城特化先于固定事件与城池结算:事件化的
  // 都城落格补给+招贤、不触发其他固定事件,途经必停照旧驻跸)
  if (mover.capitalIndex === mover.position) {
    const supply = applyResupply(g, mover);
    g.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
    g.turnPhase = "Land";
    if (g.tryRecruitHero(mover) === "silent") g.endTurn(); // 招贤纳士:三选一(或无货→直接 endTurn)
    return;
  }
  const tile = g.board.at(mover.position);
  // 特殊城池固定事件(#823/#824,ADR-0037;珍宝城随 #825 迁移入列):落格分流「普通城
  // 掷机遇 / 特殊城走固定事件」的结算半边——固定事件先于交易链(链序对镜普通城的
  // 「机遇必出 → 交易链」)。pendingCityEvent=固定事件已解(招贤经 AwaitingHeroPick、
  // 探宝/锦囊/天命/商市解毕直置)续跑至此:消费即清、直入交易链不再触发。
  if (g.pendingCityEvent) {
    g.pendingCityEvent = false;
  } else if (isEventCity(tile)) {
    resolveCityEvent(g, mover, tile);
    return;
  }
  resolveProperty(g, mover, tile);
}

/** 特殊城池固定事件结算(#823/#824/#825,ADR-0037;#826 起盘面唯一事件承载):
 *  招贤/锦囊/天命/商市四体 + 探宝抽宝拼点(treasure-flow drawTreasureAt 域),解毕续跑
 *  交易链(continueCityEvent)。招贤池空或麾下满员、牌堆空事件沉默、交易链照常;商市行情
 *  致清算/破产则中断落格(与机遇同规则,人倒下了不买地);探宝已先行结算,交易链中
 *  清算/破产不再抑制它(#825 语义位移)。 */
function resolveCityEvent(g: GameEngine, mover: Player, tile: TileDef): void {
  switch (tile.event) {
    case "hero": {
      g.lastLandOutcome = { kind: "Noop" };
      g.turnPhase = "Land";
      if (g.tryRecruitHero(mover) === "silent") {
        continueCityEvent(g); // 池空/满员:事件沉默,交易链照常
      } else {
        g.pendingCityEvent = true; // 三选一解完(resolveHeroPick)续跑交易链
      }
      return;
    }
    case "jinnang":
      applyJinnangDraw(g, mover, tile);
      continueCityEvent(g);
      return;
    case "fate":
      applyFateReputation(g, mover, tile);
      continueCityEvent(g);
      return;
    case "market":
      if (applyMarketSwing(g, mover, tile) !== "settled") return; // 清算/破产中断落格
      continueCityEvent(g);
      return;
    case "treasure":
      g.drawTreasureAt(mover, tile.name); // 探宝=珍宝城固定事件本体(#825,不收口回合)
      continueCityEvent(g); // 探宝毕续跑交易链
      return;
  }
}

/** 固定事件解毕续跑交易链(#824):置待续跑标记 → resolveLanding 重入(标记消费即清、
 *  跳过固定事件直入城池结算)。与 pendingEncounterHalt 的「机遇解完续跑」同构。 */
function continueCityEvent(g: GameEngine): void {
  g.pendingCityEvent = true;
  g.turnPhase = "Land";
  g.resolveLanding();
}

/** 天命城固定事件体(#824/#826):落格固定 +20 声望(声望泉,#121;±100 夹紧在
 *  addReputation),落账 + 事件宣告 + 战报;解毕由调用方续跑交易链。 */
function applyFateReputation(g: GameEngine, mover: Player, tile: TileDef): void {
  const repBefore = mover.reputation;
  g.addReputation(g.players.indexOf(mover), 20);
  emitGameEvent(g, g.players.indexOf(mover), {
    kind: "reputationChanged",
    delta: mover.reputation - repBefore,
    reason: "fate",
  }); // 事件流(#384):声望变更(天命泉,夹紧后实际增减;献计进手已随落账自产 jinnangDrawn;浮字由 fx 面按 reason=fate 派生「天命眷顾」)
  g.lastLandOutcome = { kind: "Noop" };
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 落 ${tile.name}:天命眷顾,声望 +20`,
    `fate player=${mover.id} reputation=${mover.reputation}`,
    0,
  );
}

/** 锦囊城固定事件体(#824/#826):落格必抽一张锦囊(#147 的 drawJinnang;牌库空落空
 *  语义同起手),宣告 + 抽牌 + 进手事件;解毕由调用方续跑交易链。 */
function applyJinnangDraw(g: GameEngine, mover: Player, tile: TileDef): void {
  g.lastLandOutcome = { kind: "Noop" };
  g.turnPhase = "Land";
  // 抽牌宣告由 jinnangDrawn(reason=jinnangTile)/jinnangExhausted 事件在 fx 面派生
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 落 ${tile.name}:抽一张锦囊`,
    `jinnangTile player=${mover.id} tile=#${tile.index}`,
  );
  const drawn = g.drawJinnang(g.players.indexOf(mover), 1);
  if (drawn > 0)
    emitGameEvent(g, g.players.indexOf(mover), {
      kind: "jinnangDrawn",
      count: drawn,
      reason: "jinnangTile",
    }); // 事件流(#384):抽锦囊进手(牌库空落空=无转移,不产)
}

/** 商市城固定事件体(#824/#826):随机行情波动 ±100~200(简化版;完整买/卖/持股系统留
 *  后续),落账 + 事件宣告 + 战报;返回走向——liquidating=清算挂起 / bankrupt=已收回合
 *  (两者均中断落格,调用方不再续跑),settled=续交易链。 */
function applyMarketSwing(
  g: GameEngine,
  mover: Player,
  tile: TileDef,
): "settled" | "liquidating" | "bankrupt" {
  const gain = g.dice.nextFloat() < 0.5;
  const amt = 100 + Math.floor(g.dice.nextFloat() * 100);
  const delta = gain ? amt : -amt;
  let bankrupt = false;
  if (delta >= 0) mover.cash += delta;
  else {
    const r = g.payOrLiquidate(mover, null, amt);
    if (r === "liquidating") return "liquidating";
    bankrupt = r === "bankrupt";
  }
  emitGameEvent(g, g.players.indexOf(mover), {
    kind: "cashChanged",
    delta: gain ? delta : -amt,
    reason: "stock",
  }); // 事件流(#375):金钱变更(浮字由 fx 面消费派生)
  if (gain) g.dispatchMoment("CashGained", { subject: g.players.indexOf(mover), amount: delta }); // 时机·CashGained:被动得银(商市行情看涨,#455 A1 补派,与看跌侧对称)
  else g.dispatchMoment("CashLost", { subject: g.players.indexOf(mover), amount: amt }); // 时机·CashLost:被动失银(商市行情下跌)
  g.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
  g.logEvent(
    "system",
    mover.guohao,
    `${mover.guohao} 落 ${tile.name}(商市):${gain ? "行情看涨" : "行情看跌"} ${gain ? "+" : "−"}${formatMoney(amt)}${bankrupt ? " → 破产" : ""}`,
    `stock player=${mover.id} delta=${delta} cash=${mover.cash}`,
    delta,
  );
  return bankrupt ? "bankrupt" : "settled";
}

/** 城池落格结算(含珍宝城 event:"treasure",ADR-0024 同权):无主 → 可购决策;
 *  己城 → 可扩军决策;他人城 → 珍宝交涉(城主有宝)或无事发生。各终端收口统一
 *  endTurn(探宝已在落格固定事件位先行,链尾零探宝,#825)。 */
function resolveProperty(g: GameEngine, mover: Player, tile: TileDef): void {
  const def = g.catalog.get(tile.propertyId);
  if (!def) {
    // 城池格必进 catalog(loader 同口径入册):查无定义=引擎/loader 失步,炸出来而不是静默跳过
    throw new Error(`城池格 ${tile.propertyId} 无 catalog 定义`);
  }
  const owner = g.findOwner(def.id);
  if (owner == null) {
    // 无主城(含分歧点城)。ADR-0013:选项集经注册表计算;买不起/无委任状时仅剩默认
    // 行为「不取」→ 自动执行(战报+浮字),不进决策相位(原 L51 内联预检迁入注册表)。
    // 决策上下文置 pendingLand(决策命令消费);lastLandOutcome 仅表现态(UI 卷轴字段)。
    g.pendingLand = { kind: "PropertyAvailable", propertyId: def.id };
    g.lastLandOutcome = { kind: "PropertyAvailable", property: def };
    if (enterDecisionPhase(g)) {
      g.logEvent(
        "buy",
        mover.guohao,
        `${mover.guohao} 至 ${tile.name},可购(${formatMoney(def.purchasePrice)})`,
        `available player=${mover.id} prop=${def.id} price=${def.purchasePrice}`,
      );
    }
    return;
  }
  if (owner === mover) {
    // 己城扩军。ADR-0013:满级时仅剩「按兵不动」假选择 → 自动执行(战报+浮字)。
    g.pendingLand = { kind: "OwnProperty", propertyId: def.id };
    g.lastLandOutcome = { kind: "OwnProperty", property: def, owner };
    if (enterDecisionPhase(g)) {
      g.logEvent(
        "upgrade",
        mover.guohao,
        `${mover.guohao} 至己城 ${tile.name},可扩军(免费)`,
        `own player=${mover.id} prop=${def.id}`,
      );
    }
    return;
  }
  g.dispatchMoment("LandedOnProperty", {
    subject: g.players.indexOf(mover),
    ownerSeat: g.players.indexOf(owner),
    propertyId: def.id,
    tileIndex: tile.index,
  }); // 时机·LandedOnProperty:落他人城(城池有主且非本人,无论后续是否触发珍宝交涉;回合外玩家高频触发点)
  // 他人到达城池不升级:仅当城主对该访客的珍宝交涉选择公道买卖且成交时才 +1 级
  // (见 resolveTreasureOwner 的 fair 分支;坐地起价/不交易均不升级)。
  // 珍宝交涉:城主有珍宝 → 公道买卖/坐地起价;无珍宝 → 无事发生
  if (owner.treasures.length > 0) {
    g.treasureVisitor = { def, ownerIdx: g.players.indexOf(owner) };
    g.turnPhase = "AwaitingTreasureOwner";
    g.lastLandOutcome = { kind: "TreasureTrade", property: def, owner };
    g.logEvent(
      "trade",
      owner.guohao,
      `${mover.guohao} 落「${tile.name}」,${owner.guohao} 可公道买卖/坐地起价(${owner.treasures.length}件珍宝)`,
      `treasureAwait owner=${owner.id} visitor=${mover.id} treasures=${owner.treasures.length}`,
    );
  } else {
    // 城主无珍宝:无事发生(他人城终端 → 收口结束回合,探宝已在落格先行 #825)
    g.lastLandOutcome = { kind: "Noop" };
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 落「${tile.name}」(${owner.guohao} 无珍宝),无事发生`,
      `noTreasure owner=${owner.id} visitor=${mover.id}`,
    );
    g.endTurn();
  }
}

/** ADR-0013 决策收口:进入 AwaitingDecision 前先经注册表(choices.ts)计算选项集;
 *  除默认行为(skip)外无可用选项 → 直接自动执行默认行为(战报 + propertyRejected 事件宣告 + endTurn),
 *  不进决策相位,返回 false;否则进入 AwaitingDecision 等待玩家,返回 true。
 *  调用前须已置 pendingLand(注册表按其分购地/扩军选项)。 */
function enterDecisionPhase(g: GameEngine): boolean {
  const options = computeChoices(g, "AwaitingDecision");
  const hasRealChoice = options.some((o) => o.available && o.id !== "skip");
  if (hasRealChoice) {
    g.turnPhase = "AwaitingDecision";
    return true;
  }
  const p = g.activePlayer;
  const tile = g.board.at(p.position);
  const def = g.pendingLand != null ? pendingLandDef(g) : null;
  g.lastLandOutcome = { kind: "Noop" };
  if (def != null && options.some((o) => o.id === "buy")) {
    // 购地不可行(银两/委任状不足):默认行为=不取(文案口径见 ADR-0013 决议 2,浮字由 fx 按 reason 派生)
    const noWarrant = p.warrants < BUY_WARRANT_COST;
    emitGameEvent(g, g.players.indexOf(p), {
      kind: "propertyRejected",
      propertyId: def.id,
      reason: noWarrant ? "no-warrant" : "insufficient-cash",
    }); // 事件流(#385):购地被拒(文案浮字由 fx 按 reason 派生)
    g.logEvent(
      "buy",
      p.guohao,
      `${p.guohao} 至 ${tile.name},${noWarrant ? "无委任状" : "银两不足"},不可购`,
      `skipAvailable player=${p.id} prop=${def.id} price=${def.purchasePrice} cash=${p.cash} warrants=${p.warrants}`,
    );
  } else if (def != null) {
    // 扩军不可行(城已满级):默认行为=按兵不动
    emitGameEvent(g, g.players.indexOf(p), {
      kind: "propertyRejected",
      propertyId: def.id,
      reason: "maxed",
    }); // 事件流(#385):按兵不动(城已满级)
    g.logEvent(
      "upgrade",
      p.guohao,
      `${p.guohao} 至己城 ${tile.name},城已满级,按兵不动`,
      `skipMaxed player=${p.id} prop=${def.id} cash=${p.cash}`,
    );
  } else {
    // 无待决策地产:默认行为=按兵不动(与 endDecision 同款战报)
    g.logEvent("system", p.guohao, `${p.guohao} 按兵不动`, `skip player=${p.id}`);
  }
  // 自动拒绝终端(买不起/无委任状/城满级):交易链收口结束回合(探宝已在落格先行 #825)
  g.endTurn();
  return false;
}

/** 都城补给量(供 bot/UI 复用,集中 tile→def 查找链)。
 *  返回 { supply, level }:supply=补给金额(地图固定值,不随等级),level=都城当前等级。
 *  一并返回 level 是为让 applyResupply 写日志时免再做一次 board.at+findHolding(原重复查找)。
 *  只在 Setup 完成后调用:都城恒为城池格、建都即持有且都城不可失——缺失 = 引擎状态 bug,直接炸。 */
export function capitalSupplyOf(g: GameEngine, player: Player): { supply: number; level: number } {
  const tile = g.board.at(player.capitalIndex);
  const def = g.catalog.get(tile.propertyId!)!; // 都城恒为城池格,def 必在册
  const h = findHolding(player, def.id)!; // 建都即持有且都城不可失
  return { supply: def.resupply, level: h.level };
}

/** 都城补给 = 地图 resupply(固定值,不随城池等级);结算(+现金/浮动/战报),查找走 capitalSupplyOf(单次)。
 *  cause="halt"(经过必停)战报写「军至都城 X,驻跸补给(+N)」;"land"(落点恰为都城)维持原补给文案。 */
function applyResupply(g: GameEngine, mover: Player, cause: "land" | "halt" = "land"): number {
  const { supply, level } = capitalSupplyOf(g, mover);
  if (supply > 0) {
    mover.cash += supply;
    emitGameEvent(g, g.players.indexOf(mover), {
      kind: "cashChanged",
      delta: supply,
      reason: "supply",
    }); // 事件流(#375):金钱变更(补给铜钱雨由 fx 面按 reason=supply 派生,S7)
    g.dispatchMoment("CashGained", { subject: g.players.indexOf(mover), amount: supply }); // 时机·CashGained:被动得银(都城补给,驻跸/落都城同挂)
  }
  if (cause === "halt") {
    g.logEvent(
      "halt",
      mover.guohao,
      `${mover.guohao} 军至都城「${g.board.at(mover.capitalIndex).name}」,驻跸补给(+${formatMoney(supply)})`,
      `haltSupply player=${mover.id} capital=#${mover.capitalIndex} level=${level} amount=${supply} cash=${mover.cash}`,
      supply,
    );
  } else if (supply > 0) {
    g.logEvent(
      "supply",
      mover.guohao,
      `${mover.guohao} 都城补给 +${formatMoney(supply)}`,
      `supply player=${mover.id} capital=#${mover.capitalIndex} level=${level} amount=${supply} cash=${mover.cash}`,
      supply,
    );
  }
  return supply;
}
