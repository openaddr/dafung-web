// 移动结算域(#323,ADR-0019 委托式拆分):行军三件(rollAndMove/marchTraverse/
// settleMarchLanding,含伏兵挂点/驻跸必停/辅路入口)、辅路抉择(selectBranch)、
// 待决策落格定义(pendingLandDef)、地产决策命令(buyProperty/upgradeProperty/
// endDecision)、落格结算(resolveLanding;resolveSpecial/resolveProperty/
// enterDecisionPhase 域内自洽不留壳)与都城补给(capitalSupplyOf;applyResupply
// 域内自洽不留壳)。
// 域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;GameEngine 侧保留同名公共
// 方法薄委托(外部 importer 无感),src/core/authority.ts「回合状态机」区段。
// 跨域往返统一经壳上薄委托(与既有票一致):机遇 g.maybeApplyEncounter、宝物城
// g.resolveTreasureCity、辅路格 g.resolveBranchCell、escrow 清算 g.payOrLiquidate、
// 锦囊抽牌 g.drawJinnang、招贤 g.tryRecruitHero;唯一例外是开拦检窗直调
// reaction-window.openReactionWindow(已导出自由函数,#318 预留的私有壳委托随本域
// 迁出而删);reaction-window 续走则经壳上 g.marchTraverse/g.settleMarchLanding 回调。
import type { GameEngine } from "./authority";
import { computeChoices } from "./choices";
import { buy, upgrade, supplyFor } from "./economy";
import { findHolding } from "./player";
import { jinnangCardOf } from "./jinnang";
import { openReactionWindow } from "./reaction-window";
import { formatMoney } from "./money";
import { emitGameEvent } from "./game-events";
import { SIGN_FACES, WARRANTS_PER_PASS, BUY_WARRANT_COST } from "./constants";
import type { Player } from "./model";
import type { PropertyDef } from "./economy";
import type { TileDef } from "./board";

// ── 择路/落格结果类型(#326 types.ts 解散,ADR-0019 类型随域走)──
/** 路线抉择:大路(主环)/ 辅路(辅路逐格行进)。 */
export type RouteKind = "Main" | "Branch";

/** 落格结果。 */
export type LandOutcomeKind =
  | "Noop"
  | "PropertyAvailable"
  | "OwnProperty"
  | "TreasureTrade"
  | "TaxPaid";

export interface LandOutcome {
  kind: LandOutcomeKind;
  property?: PropertyDef;
  owner?: Player;
  amount?: number; // 珍宝成交价/税额
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

/** 抽签 → 移动(主路或辅路逐格)→ 经过自己都城必停(补给+结束回合);否则落格结算。
 *  辅路逐格:computePath 按 onBranch 沿 cells 推进,落辅路格触发 resolveBranchCell;
 *  onBranch={step:-1} = 入口待入辅路(上回合选「入辅路」,本回合掷骰起沿辅路格推进)。
 *  主路途经遍历(#281):每格途经棋子派发;他人城主城池可被半路杀出拦检,窗挂起时
 *  本调用返回,respondReaction 应答后续走/落格。 */
export function rollAndMove(g: GameEngine): void {
  if (!g.assertPhase("Roll", "RollAndMove")) return;
  const mover = g.activePlayer;
  const wasOnBranch = mover.onBranch != null; // 行军前是否在辅路(含 step=-1 待入态):BranchExited 派发判定
  g.dispatchMoment("BeforeMarch", { subject: g.activeIndex }); // 时机·BeforeMarch:掷骰前(行军加成挂点,如周瑜 moveBonus)
  g.dispatchMoment("BeforeRoll", { subject: g.activeIndex }); // 时机·BeforeRoll:掷骰前、BeforeMarch 之后(骰子机制系技能挂点,与 BeforeMarch 的语义区分见 timing.ts)
  const roll = g.dice.roll();
  g.lastRoll = roll;
  g.dispatchMoment("DieRolled", { subject: g.activeIndex, die: roll.die }); // 时机·DieRolled:骰面已定(张星彩 gainIfFace 等)
  const moveBonus = g.takeMarchBonus(); // 取走 BeforeMarch 时机累计的行军加成
  const drumBonus = g.heroDiceBonus; // 取走擂鼓加成(#188 档 3):发动与掷骰同回合
  g.heroDiceBonus = 0;
  const steps = roll.die + moveBonus + drumBonus;
  const path = g.board.computePath(mover.position, steps, mover.capitalIndex, mover.onBranch);
  const fromPos = mover.position;
  g.lastMove = path;
  const destName =
    path.landBranchStep != null && g.board.branch
      ? `辅路第${path.landBranchStep + 1}格`
      : g.board.at(path.landIndex).name;
  g.logEvent(
    "roll",
    mover.guohao,
    `${mover.guohao} 抽签 ${SIGN_FACES[roll.die - 1]}${moveBonus + drumBonus ? `(+${moveBonus + drumBonus})` : ""} → ${destName}`,
    `roll player=${mover.id} die=${roll.die} steps=${steps} bonus=${moveBonus + drumBonus} from=#${fromPos} land=#${path.landIndex} branchStep=${path.landBranchStep ?? -1} passedCapital=${path.passedCapital} wps=${path.waypoints.length}`,
  );

  // 辅路逐格落点先于主路遍历分流:辅路格非城池,无反应窗挂点、无途经城池
  if (path.landBranchStep != null && g.board.branch) {
    mover.onBranch = { step: path.landBranchStep };
    g.dispatchMoment("AfterMarch", { subject: g.activeIndex }); // 时机·AfterMarch:移动完成(落辅路格)、辅路格结算前
    g.turnPhase = "Land";
    const cell = g.board.branch.cells[path.landBranchStep];
    g.resolveBranchCell(mover, cell);
    return;
  }
  // 主路行军(含辅路汇入):逐格途经遍历,#281 反应窗可中途拦停
  const walked = marchTraverse(
    g,
    mover,
    path.traversed,
    path.traversed.length,
    path.landIndex,
    wasOnBranch,
    fromPos,
    steps,
  );
  if (walked !== "landed") return; // suspended=拦检窗挂起(respondReaction 续走);halted=必停已结算
  settleMarchLanding(g, mover, path.landIndex, wasOnBranch);
}

/** 主路途经遍历(#281):逐格走 remaining(原 traversed 的未走切片,不含起点含落点),
 *  每格依次:① PassedPlayer(途经非破产他人棋子,座位序);② 己都城——颁发委任状,
 *  落点不在都城则必停截断(放弃剩余步数,补给+结束回合);③ 他人城主城池(城主存活)
 *  ——派发 MarchPassedCity,城主持半路杀出则开拦检窗(挂停返回 "suspended",
 *  respondReaction 续走),拦停成功即止、后续城不再问。
 *  返回:"suspended"=拦检窗挂起、"halted"=必停都城已结算(调用方直接返回)、
 *  "landed"=走完无停,由调用方 settleMarchLanding 落格。 */
export function marchTraverse(
  g: GameEngine,
  mover: Player,
  remaining: number[],
  totalLen: number,
  landIndex: number,
  wasOnBranch: boolean,
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
      g.logEvent(
        "supply",
        mover.guohao,
        `${mover.guohao} 巡幸都城,获 ${WARRANTS_PER_PASS} 委任状`,
        `warrantGrant player=${mover.id} +${WARRANTS_PER_PASS} warrants=${mover.warrants}`,
      );
      if (landIndex !== mover.capitalIndex) {
        const walkedCount = totalLen - remaining.length;
        const branchPrefix =
          mover.onBranch != null && g.board.branch
            ? g.board.branch.cells.length - mover.onBranch.step
            : 0;
        g.lastMove = g.board.computePath(
          fromPos,
          branchPrefix + walkedCount + 1,
          mover.capitalIndex,
          mover.onBranch,
        );
        mover.onBranch = null; // 辅路汇入主路后路过都城:必停已在主路,清辅路态
        mover.position = mover.capitalIndex;
        if (wasOnBranch)
          g.dispatchMoment("BranchExited", {
            subject: moverSeat,
            tileIndex: mover.position,
          }); // 时机·BranchExited:辅路推进汇入主路(汇入后必停都城的截断落点)
        g.dispatchMoment("AfterMarch", { subject: moverSeat }); // 时机·AfterMarch:移动完成(必停都城)、驻跸补给结算前
        g.dispatchMoment("CapitalHalt", {
          subject: moverSeat,
          tileIndex: mover.capitalIndex,
        }); // 时机·CapitalHalt:必停都城(AfterMarch 后、驻跸补给结算处)
        const supply = applyResupply(g, mover, "halt");
        g.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
        g.turnPhase = "Land";
        g.endTurn();
        return "halted"; // 必停已完整结算:调用方不得再走落格收尾
      }
    }
    // ③ 他人城主城池(城主存活):MarchPassedCity 挂点 → 半路杀出拦检窗
    const tile = g.board.at(tIdx);
    if (tile.type === "Property" && tile.propertyId != null) {
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
          const branchPrefix =
            mover.onBranch != null && g.board.branch
              ? g.board.branch.cells.length - mover.onBranch.step
              : 0;
          openReactionWindow(
            g,
            { kind: "march", cardId: ambushId, userSeat: moverSeat, ownerSeat },
            {
              kind: "march",
              moverSeat,
              tileIndex: tIdx,
              stepsToTile: branchPrefix + walkedCount + 1,
              totalTiles: totalLen,
              resumeTiles: remaining.slice(1),
              landIndex,
              fromPos,
              steps,
              wasOnBranch,
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

/** 主路落格收尾(走完遍历无拦停):清辅路态、落位、BranchExited/AfterMarch、
 *  辅路入口抉择或落格结算(机遇/城池)。 */
export function settleMarchLanding(
  g: GameEngine,
  mover: Player,
  landIndex: number,
  wasOnBranch: boolean,
): void {
  mover.onBranch = null; // 已在主路(清掉原 onBranch)
  mover.position = landIndex;
  emitGameEvent(g, g.players.indexOf(mover), { kind: "marchArrived", tileIndex: landIndex }); // 事件流(#375):行军落格
  if (wasOnBranch)
    g.dispatchMoment("BranchExited", {
      subject: g.players.indexOf(mover),
      tileIndex: landIndex,
    }); // 时机·BranchExited:辅路推进汇入主路(落点回主路)
  g.dispatchMoment("AfterMarch", { subject: g.players.indexOf(mover) }); // 时机·AfterMarch:移动完成(主路落位)、落格结算(辅路入口抉择/resolveLanding)前
  // 落在辅路起点(且未在辅路)→ 弹入口抉择
  if (g.board.getBranchStart(landIndex)) {
    g.turnPhase = "AwaitingBranch";
    g.logEvent(
      "branch",
      mover.guohao,
      `${mover.guohao} 至辅路要隘「${g.board.at(landIndex).name}」:走大路 or 入辅路`,
      `awaitingBranch player=${mover.id} tile=#${landIndex}`,
    );
    return; // 等 selectBranch
  }
  g.turnPhase = "Land";
  // 机遇(#123):早于城池结算;天命格是固定声望泉不参与 roll;清算/破产则中断落格结算
  // (必停都城/辅路格不触发:必停是驻跸补给特化流,辅路即将整体移除)。
  // 抉择机遇(#124)返回 deciding:机遇占用本落格——含 ≤1 可用选项自动执行已收尾的场合,
  // 机遇早于城池结算:即时机遇 settled → 继续本落格结算;抉择机遇 deciding → 待解,
  // 解完在 settleEncounterChoice 内继续落格结算(#120 决策 2);清算/破产已中断;
  // 耗竭 exhausted(#132):体力归 0 → 耗竭相位/自动惩罚占用本落格——人倒下了不买地。
  const enc = g.maybeApplyEncounter(mover, landIndex);
  if (enc === "deciding" || enc === "liquidating" || enc === "bankrupt" || enc === "exhausted")
    return;
  resolveLanding(g);
}

/** 辅路入口抉择:"Main"=走大路(起点 tile 按普通城落格,可购买等);
 *  "Branch"=入辅路——本回合结束(棋子留在主路入口格,置「待入辅路」onBranch={step:-1}),
 *  下回合掷骰起沿辅路格推进(掷几点走几格,溢出从辅路终点汇入主路,见 computePath)。
 *  复用 AwaitingBranch 阶段 + selectBranch(改语义,不新加 phase)。 */
export function selectBranch(g: GameEngine, kind: RouteKind): void {
  if (!g.assertPhase("AwaitingBranch", "SelectBranch")) return;
  const p = g.activePlayer;
  const tile = g.board.at(p.position);
  g.logEvent(
    "branch",
    p.guohao,
    `${p.guohao} 于「${tile.name}」取${kind === "Branch" ? "道辅路(下回合掷骰进发)" : "大路"}`,
    `selectBranch player=${p.id} kind=${kind} at=#${p.position} cash=${p.cash}`,
  );
  if (kind === "Branch" && g.board.branch) {
    // 入辅路 = 本回合结束:置「待入辅路」,不结算任何格;下回合 rollAndMove 沿辅路推进
    p.onBranch = { step: -1 };
    g.dispatchMoment("BranchEntered", { subject: g.activeIndex, tileIndex: p.position }); // 时机·BranchEntered:入辅路(置待入辅路态后)
    g.turnPhase = "Land";
    g.endTurn();
    return;
  }
  // 走大路:起点 tile 按普通落格处理(可购买/升级/交涉等)
  g.turnPhase = "Land";
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
    g.endTurn();
    return;
  }
  const r = buy(buyer, def);
  g.lastTransaction = r;
  if (r.status === "Ok") {
    buyer.warrants -= BUY_WARRANT_COST; // 消耗委任状
    g.pushFloater(buyer, -def.purchasePrice, buyer.position, "expense");
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
  g.endTurn();
}

/** 按兵不动(决策命令):放弃购地/扩军,回合收尾。 */
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

/** 落格结算:按落格类型分流——己都城(补给+招贤)/ 卧龙岗(招贤)/ 宝物城(拼点探宝,
 *  treasure-flow)/ 特殊格(天命/锦囊/税关/商市)/ 城池(购地/扩军/珍宝交涉)。 */
export function resolveLanding(g: GameEngine): void {
  const mover = g.activePlayer;
  // 落点恰为自己都城:补给 + 招贤纳士
  if (mover.capitalIndex === mover.position) {
    const supply = applyResupply(g, mover);
    g.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
    g.turnPhase = "Land";
    g.tryRecruitHero(mover); // 招贤纳士:三选一(或无货→直接 endTurn)
    return;
  }
  const tile = g.board.at(mover.position);
  // 卧龙岗:招贤纳士(不可进驻)
  if (tile.type === "Wolong") {
    g.lastLandOutcome = { kind: "Noop" };
    g.turnPhase = "Land";
    g.tryRecruitHero(mover);
    return;
  }
  // 宝物城:掷双骰判定获取珍宝
  if (tile.type === "TreasureCity") {
    g.resolveTreasureCity(mover, tile);
    return;
  }
  if (tile.type !== "Property") {
    resolveSpecial(g, mover, tile);
    return;
  }
  resolveProperty(g, mover, tile);
}

/** 特殊格结算:天命(Fate)/ 锦囊(Chance)/ 税关(Tax)/ 商市(Stock),余者 Noop。 */
function resolveSpecial(g: GameEngine, mover: Player, tile: TileDef): void {
  // 锦囊(Chance)/天命(Fate):随机抽事件,温和 ±100~250
  // 天命(Fate):声望泉(#121)——落格固定 +20 声望,取代原随机坏事表(吸收进机遇目录)。
  if (tile.type === "Fate") {
    g.addReputation(g.players.indexOf(mover), 20);
    g.pushFloaterText(mover, "天命眷顾,声望 +20", tile.index);
    g.lastLandOutcome = { kind: "Noop" };
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 落 ${tile.name}:天命眷顾,声望 +20`,
      `fate player=${mover.id} reputation=${mover.reputation}`,
      0,
    );
    g.endTurn();
    return;
  }
  // 锦囊格(#147,旧机会格语义复活):落格必抽一张锦囊(T1 的 drawJinnang;
  // 牌库空落空语义同起手)。与机遇格区分:必得 vs 概率。
  if (tile.type === "Chance") {
    g.lastLandOutcome = { kind: "Noop" };
    g.turnPhase = "Land";
    g.pushFloaterText(mover, `${tile.name}:抽一张锦囊`, tile.index);
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 落 ${tile.name}:抽一张锦囊`,
      `jinnangTile player=${mover.id} tile=#${tile.index}`,
    );
    g.drawJinnang(g.players.indexOf(mover), 1);
    g.endTurn();
    return;
  }
  // 税关(Tax):固定缴税 200 两
  if (tile.type === "Tax") {
    const r = g.payOrLiquidate(mover, null, 200);
    if (r === "liquidating") return;
    const bankrupt = r === "bankrupt";
    g.pushFloater(mover, -200, tile.index, "expense");
    emitGameEvent(g, g.players.indexOf(mover), { kind: "cashChanged", delta: -200, reason: "tax" }); // 事件流(#375):金钱变更(浮字同口径 -200 平记)
    g.dispatchMoment("CashLost", { subject: g.players.indexOf(mover), amount: 200 }); // 时机·CashLost:被动失银(税)
    g.lastLandOutcome = { kind: "TaxPaid", amount: 200, causedBankruptcy: bankrupt };
    g.logEvent(
      "tax",
      mover.guohao,
      `${mover.guohao} 落 ${tile.name} 缴税 ${formatMoney(200)}${bankrupt ? " → 破产" : ""}`,
      `tax player=${mover.id} tile=#${tile.index} cash=${mover.cash}`,
      -200,
    );
    g.endTurn();
    return;
  }
  // 商市(Stock):随机行情波动 ±100~200(简化版;完整买/卖/持股系统留后续)
  if (tile.type === "Stock") {
    const gain = g.dice.nextFloat() < 0.5;
    const amt = 100 + Math.floor(g.dice.nextFloat() * 100);
    const delta = gain ? amt : -amt;
    let bankrupt = false;
    if (delta >= 0) mover.cash += delta;
    else {
      const r = g.payOrLiquidate(mover, null, amt);
      if (r === "liquidating") return;
      bankrupt = r === "bankrupt";
    }
    g.pushFloater(mover, delta, tile.index, gain ? "income" : "expense");
    emitGameEvent(g, g.players.indexOf(mover), {
      kind: "cashChanged",
      delta: gain ? delta : -amt,
      reason: "stock",
    }); // 事件流(#375):金钱变更(浮字同口径)
    if (!gain) g.dispatchMoment("CashLost", { subject: g.players.indexOf(mover), amount: amt }); // 时机·CashLost:被动失银(商市行情下跌)
    g.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
    g.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 落 ${tile.name}(商市):${gain ? "行情看涨" : "行情看跌"} ${gain ? "+" : "−"}${formatMoney(amt)}${bankrupt ? " → 破产" : ""}`,
      `stock player=${mover.id} delta=${delta} cash=${mover.cash}`,
      delta,
    );
    g.endTurn();
    return;
  }
  g.lastLandOutcome = { kind: "Noop" };
  g.endTurn();
}

/** 城池落格结算:无主 → 可购决策;己城 → 可扩军决策;他人城 → 珍宝交涉(城主有宝)
 *  或无事发生。 */
function resolveProperty(g: GameEngine, mover: Player, tile: TileDef): void {
  const def = g.catalog.get(tile.propertyId);
  if (!def) {
    g.lastLandOutcome = { kind: "Noop" };
    g.endTurn();
    return;
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
    // 城主无珍宝:无事发生
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
 *  除默认行为(skip)外无可用选项 → 直接自动执行默认行为(战报 + 浮字 + endTurn),
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
    // 购地不可行(银两/委任状不足):默认行为=不取(浮字文案口径见 ADR-0013 决议 2)
    const noWarrant = p.warrants < BUY_WARRANT_COST;
    g.logEvent(
      "buy",
      p.guohao,
      `${p.guohao} 至 ${tile.name},${noWarrant ? "无委任状" : "银两不足"},不可购`,
      `skipAvailable player=${p.id} prop=${def.id} price=${def.purchasePrice} cash=${p.cash} warrants=${p.warrants}`,
    );
    g.pushFloaterText(p, noWarrant ? "无委任状,不可购" : "银两不足,未能购城", p.position);
  } else if (def != null) {
    // 扩军不可行(城已满级):默认行为=按兵不动
    g.logEvent(
      "upgrade",
      p.guohao,
      `${p.guohao} 至己城 ${tile.name},城已满级,按兵不动`,
      `skipMaxed player=${p.id} prop=${def.id} cash=${p.cash}`,
    );
    g.pushFloaterText(p, "城已满级,按兵不动", p.position);
  } else {
    // 无待决策地产:默认行为=按兵不动(与 endDecision 同款战报)
    g.logEvent("system", p.guohao, `${p.guohao} 按兵不动`, `skip player=${p.id}`);
  }
  g.endTurn();
  return false;
}

/** 都城补给量(供 bot/UI 复用,集中 tile→def→holding→supplyFor 查找链)。
 *  返回 { supply, level }:supply=补给金额,level=都城当前等级。
 *  一并返回 level 是为让 applyResupply 写日志时免再做一次 board.at+findHolding(原重复查找)。 */
export function capitalSupplyOf(g: GameEngine, player: Player): { supply: number; level: number } {
  const tile = g.board.at(player.capitalIndex);
  const def = g.catalog.get(tile.propertyId);
  const h = findHolding(player, def?.id ?? "");
  return { supply: supplyFor(def?.resupplyPerLevel, h?.level), level: h?.level ?? 0 };
}

/** 都城补给 = ResupplyPerLevel × (Level+1);结算(+现金/浮动/战报),查找走 capitalSupplyOf(单次)。
 *  cause="halt"(经过必停)战报写「军至都城 X,驻跸补给(+N)」;"land"(落点恰为都城)维持原补给文案。 */
function applyResupply(g: GameEngine, mover: Player, cause: "land" | "halt" = "land"): number {
  const { supply, level } = capitalSupplyOf(g, mover);
  if (supply > 0) {
    mover.cash += supply;
    g.pushFloater(mover, supply, mover.capitalIndex, "supply");
    emitGameEvent(g, g.players.indexOf(mover), {
      kind: "cashChanged",
      delta: supply,
      reason: "supply",
    }); // 事件流(#375):金钱变更
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
      `${mover.guohao} 都城补给 +${formatMoney(supply)}(Lv.${level})`,
      `supply player=${mover.id} capital=#${mover.capitalIndex} level=${level} amount=${supply} cash=${mover.cash}`,
      supply,
    );
  }
  return supply;
}
