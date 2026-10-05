// 折叠投影器(#386 两族起步,#387 全覆盖,ADR-0020 决策 1 折叠切换⑤):服务端事件批
// → 本地引擎副本字段的纯函数投影。联机端引擎是「只读副本」(快照水合而来),本模块把
// 事件批直接折进副本的可见状态字段——这是应用层投影,不是引擎行为:不往 src/core 加任何
// 方法,副本仍保持只读语义(外部不 submitCommand,红线 3 的「走公共方法」约束的是引擎
// 权威态变更,副本投影属协议消费面)。
//
// ── 折叠范围(#387 全覆盖;字段面以 #384 覆盖判定表「事件覆盖 + 事件+校准(双覆盖)」
//    为准,逐族对账见本票汇报)──
//   回合/胜负族   gameStarted → phase=Playing + activeIndex/roundAnchor(=首动者);
//                 turnStarted → activeIndex + turnPhase=Roll + 回合开账(usedTags 清零/
//                 peeks 到期/窗口与落格决策载荷清场);roundStarted/roundEnded → roundAnchor
//                 (=轮次锚点主体);gameOver → isOver/winner/winReason/phase/turnPhase。
//                 round/turnNumber 逐事件摸事件首部(turnStarted 特殊:引擎派发后才
//                 turnNumber+1,故 +1;开局首回合同批有 gameStarted 先行,取首部本值)
//   掷骰/行军族   diceRolled → lastRoll + heroDiceBonus 消费清零;capitalHalt → position/
//                 onBranch=null/lastMove/turnPhase=Land(补给金额相邻回填);marchArrived →
//                 主路:position/onBranch=null/lastMove/落格推演(turnPhase + pendingLand +
//                 lastLandOutcome + treasureVisitor 到来)/辅路要隘 → AwaitingBranch;
//                 辅路格:onBranch 置步(汇入推进语义)/中伏格 skipTurns=1(标记侧相邻)
//   城池族        capitalSelected → takenCapitalIndices/capitalIndex/position/地产 Lv0 入册
//                 (Setup 期现金不入折叠,#386 注记保持);propertyBought → 现金-价/
//                 委任状-常量/地产入册;propertyUpgraded → 持有等级对齐 newLevel(副本无
//                 持有则按事件补册,赐城缺口级联见下);propertyRejected → 无状态转移
//                 (声明性;自动按兵不动由同批 turnStarted 收场);exhaustionChoice →
//                 降级 -1 级/失城回无主(处置对象随事件点名,可精确折);assetTransferred →
//                 破产逐城易主(承让方入册/无债主回无主)
//   金钱族        cashChanged → 现金逐条累加(delta 带符号)+ 落格表现态相邻回填
//                 (reason=supply 回填补给金额;tax/stock 置 TaxPaid/Noop + 批内破产标记)
//   珍宝族        treasureGained → 得宝入册(流水号实例 id 按静态表回溯定义);
//                 treasureSold → 卖家出册(银两不在此折:交割价随 treasureTraded、变卖所得
//                 随 assetLiquidated,防双计);treasureTraded → escrow 清/visitor 收口/
//                 买家-价 卖家+价;treasureStolen → 不折(窃玉偷香转移 = 校准兜底五项之二)
//   名将族        heroRecruited → 麾下入册 + 招贤池占位;skillFired/heroSkillActivated →
//                 冷却记账(heroLastFired,键=skillId);主动技按 HEROES 参数落账:
//                 warDrum → heroDiceBonus、patronage → 委任状+1(目标得银随同批
//                 cashChanged·skill 折)、relief → 现金-费(目标体力随 staminaChanged 折)、
//                 demolish → 不折(随机降级目标不可知 = 校准兜底五项之一)
//   锦囊族        jinnangDrawn → 手牌数+count/牌库数-count(内容=暗牌与牌序不折,
//                 ADR-0016);jinnangAnnounced → 出牌扣账(手牌数-1/弃堆+1/标签占名额)+
//                 窥探入册(军情密探);jinnangVoided → 识破牌扣账
//                 (反应牌 id 出自同批应答,按座位配对;shareSeat 不参与折叠);
//                 reactionOpened → pendingReaction
//                 置窗(view/seq 派生,windowMs 单源常量表);reactionAnswered → 应答入账
//                 + 应答齐闭窗;行军窗闭窗即拦检牌扣账(引擎胜负两路均在结算点扣账,与
//                 应答同批);reactionFailed → 无状态转移(声明性)
//   声望/体力族   reputationChanged → 声望 += 夹紧后实际增减 + 献计里程碑穿越重算;
//                 staminaChanged → 体力 += 夹紧后实际增减;reason=exhaustion 相邻 →
//                 skipTurns+1(耗竭善后标记侧)
//   破产族        playerBankrupt → isBankrupt/capitalIndex=-1/名将释放回池/锦囊清手入弃堆
//                 (现金清零/债主收款/珍宝转债主 = 破产清算强制全量节点,不折);
//                 assetLiquidated → 现金+amount + 变卖物出册
//   跳过族        turnSkipped → skipTurns-1(消费侧);jinnangInflicted → 目标 skipTurns+1
//                 (缓兵之计标记侧)
//   机遇族        encounterTriggered → lastLandOutcome=Noop + 抉择型置 AwaitingEncounter;
//                 encounterChoice → 无状态转移(声明性;效果经现金/声望/体力/得宝/招贤折)
//   纯派生字段    netWorth(=cash)/choices/decisionOwner/currentTileIsBranchStart/
//                 lastLandOutcomeKind/lastLandOutcomeProperty/logCount/
//                 currentSetupPlayerIndex/branchStartTile/branchEndTile/
//                 reaction(=pendingReaction.view)不折自得
//
// ── 校准兜底项(#384 判定表对账:折叠器不碰,由快照水合纠正,ADR-0020 决策 3)──
//   ①城池降级精确等级:火烧连营/火攻随机降级目标与结果不在任何事件(demolish 结算无事件)
//   ②窃玉偷香珍宝转移:treasureStolen 只宣告不转移(双方珍宝列表校准)
//   ③军师窗目标段子状态:pendingJinnang/pendingSkill 无专属事件
//   ④辅路入口置位:onBranch={step:-1}(selectBranch 入辅路)无专属事件
//   ⑤Setup 期字段:draftOrder/draftRolls/currentDraftIndex/offeredCapitals/usedGuohao/
//     setupPhase,开局校准点覆盖
//   另有判定表「校准点」档全项(gameId/targetNetWorth/牌序/rngState/log/pendingDebt 等):
//     开局/破产清算/洗牌类强制全量节点覆盖,折叠器不碰。
//
// ── 已知无事件转移的级联口径(移除类折叠查无目标 = 略过,非吞错)──
//   判定表之外存在无事件的转移:机遇「天赐城池」入册、巡幸都城委任状+2(仅 log 行)、
//   行军窗拦停成功时的拦检牌扣账(本器折于闭窗应答点,批序等效)。它们使副本在批窗口内
//   与引擎分歧,后续「移除类」折叠(出册/降级)可能查无目标——这是已接受缺口的级联,
//   略过待下一帧水合纠正;「新增类」折叠恒精确落账。词汇表在生长(game-events.ts),
//   未登记进折叠范围的 kind 一律忽略——这是折叠范围的定义,不是吞错。
//
// ── 零兜底 ──
//   折叠族事件产出恒带具体座位(见 game-events.ts 各产出点,行动者=座位主),seat=null
//   = 产出契约违反,当场炸出不静默跳过;事件引用的静态数据(名将/锦囊/机遇/地产目录)
//   查无 = 数据 bug,当场炸出;事件序违反(识破无同批窗、应答无窗)当场炸出;delta/数量
//   等字段缺失由类型系统在编译期兜住(线上形状以 core GameEvent 为准)。
import type { GameEngine } from "@core/authority";
import type { Player, PropertyHolding } from "@core/model";
import type { GameEvent } from "@core/game-events";
import type { PropertyDef } from "@core/economy";
import type {
  PendingReaction,
  ReactionAnswer,
  ReactionPayload,
  ReactionView,
} from "@core/reaction-window";
import { jinnangCardOf, JINNANG_CARDS } from "@core/jinnang";
import { HEROES, type ActiveSkillDef } from "@core/heroes";
import { TREASURES, type TreasureDef } from "@core/treasures";
import { REP_MILESTONES } from "@core/reputation";
import { ENCOUNTERS } from "@core/encounters";
import { BUY_WARRANT_COST, REACTION_WINDOW_MS } from "@core/constants";

/** 声望献计里程碑(#147):值域与穿越口径同 core reputation.ts(向上穿越、仅首次)。 */
// 常量单源在 core/reputation.ts(REP_MILESTONES),勿在本文件重定义。

/** 拦检反应牌(#281):行军窗唯一可打反应牌——按效果域查静态目录,不硬抄牌名字符串。 */
const AMBUSH_CARD = (() => {
  const card = JINNANG_CARDS.find((c) => c.effect.kind === "ambush");
  if (card == null) throw new Error("折叠投影:静态目录无拦检反应牌(数据 bug)");
  return card;
})();

/** 静态名将目录回查:事件 heroId 查无 = 数据 bug,当场炸出。 */
function heroDefOf(heroId: string) {
  const hero = HEROES.find((h) => h.id === heroId);
  if (hero == null) throw new Error(`折叠投影:名将 ${heroId} 不在 HEROES 表(数据 bug)`);
  return hero;
}

/** 主动技静态回查(HEROES.active;skillId 同时是冷却键)。查无 = 数据 bug,炸出。 */
function activeSkillOfId(skillId: string): ActiveSkillDef {
  const skill = HEROES.flatMap((h) => (h.active ? [h.active] : [])).find((s) => s.id === skillId);
  if (skill == null) throw new Error(`折叠投影:主动技 ${skillId} 不在 HEROES 表(数据 bug)`);
  return skill;
}

/** 主动技参数必存校验:HEROES 声明的技参数在折叠落账时缺失 = 数据 bug,当场炸出。 */
function requireSkillParam(skill: ActiveSkillDef, key: string): number {
  const v = skill.params?.[key];
  if (v === undefined) throw new Error(`折叠投影:主动技 ${skill.id} 缺参数 ${key}(数据 bug)`);
  return v;
}

/** 珍宝实例 id 回溯静态定义:牌堆实例 id = `${静态id}-${流水号}`(createTreasureDeck),
 *  事件只带实例 id,名称/等级按静态表回溯(实例其余字段一致)。查无 = 数据 bug,炸出。 */
function treasureDefOf(instanceId: string): TreasureDef {
  const cut = instanceId.lastIndexOf("-");
  const base = cut > 0 ? instanceId.slice(0, cut) : instanceId;
  const def = TREASURES.find((t) => t.id === base);
  if (def == null) throw new Error(`折叠投影:珍宝实例 ${instanceId} 回溯不到静态定义(数据 bug)`);
  return { ...def, id: instanceId };
}

/** 城池定义回查:事件 propertyId 查无 = 数据 bug,当场炸出。 */
function propertyDefOf(engine: GameEngine, propertyId: string): PropertyDef {
  const def = engine.catalog.get(propertyId);
  if (def == null) throw new Error(`折叠投影:城 ${propertyId} 不在 catalog(数据 bug)`);
  return def;
}

/** 折叠目标玩家解析:折叠族事件都是座位主行为,无主座位(seat=null)= 契约违反,炸出;
 *  返回副本内玩家对象(seat 语义 = players 下标,indexOf 恒等)。 */
function foldTarget(engine: GameEngine, ev: GameEvent): Player {
  if (ev.seat == null) throw new Error(`折叠投影:${ev.kind} 无主座位(事件产出契约违反)`);
  return engine.players[ev.seat];
}

/** 事件座位号(契约校验后的 number 面):越界座位 = 契约违反,炸出(不静默写 undefined)。 */
function seatNo(engine: GameEngine, p: Player): number {
  const seat = engine.players.indexOf(p);
  if (seat < 0) throw new Error("折叠投影:玩家不在副本座位表(契约违反)");
  return seat;
}

/** 目标座位解析:事件携带的目标座位越界 = 契约违反,炸出。 */
function seatPlayer(engine: GameEngine, seat: number, label: string): Player {
  const p = engine.players[seat];
  if (p == null) throw new Error(`折叠投影:${label} 目标座位越界 seat=${seat}(契约违反)`);
  return p;
}

/** 副本侧城主查找:按 propertyId 扫全座位(与引擎 findOwner 同式,读副本态)。 */
function holdingOwnerOf(engine: GameEngine, propertyId: string): Player | null {
  return engine.players.find((p) => p.properties.some((h) => h.propertyId === propertyId)) ?? null;
}

/** 反应窗被询问座位集(与引擎 reactionQueriedOf 同式:view 单源)。 */
function queriedOf(view: ReactionView): number[] {
  return view.kind === "jinnang" ? view.queriedBySeat : [view.ownerSeat];
}

/** 出牌扣账(consumeJinnangCard/consumeReactionCard 的副本侧镜像):离手(暗牌,查无即略)
 *  + 手牌数 -1 + 入弃堆。手牌内容是暗牌:数组为水合赠品(god-view),以数组为准删、以
 *  事件为准记账——redact 接通后数组恒空,数量账仍自洽(ADR-0016)。 */
function consumeCard(engine: GameEngine, p: Player, cardId: string): void {
  const idx = p.jinnangHand.indexOf(cardId);
  if (idx >= 0) p.jinnangHand.splice(idx, 1);
  p.jinnangHandCount -= 1;
  engine.jinnangDiscard.push(cardId);
}

/** 批上下文:批内跨事件相邻推演所需的临时锚点(纯函数局部态,不落引擎)。 */
interface FoldCtx {
  /** 开局批旗标:gameStarted 与开局首个 turnStarted 同批(finishSetup),此时 turnNumber
   *  取事件首部本值(引擎开局即置 1,非「派发后 +1」路径)。 */
  sawGameStart: boolean;
  /** 批内已破产座位:落格表现态 causedBankruptcy 相邻判定(税关/商市)。 */
  bankruptSeats: Set<number>;
  /** 批内锦囊宣布锚点(后写覆盖):reactionOpened 的 targetSeats 同源回溯(宣布与开窗
   *  同一结算)。 */
  lastAnnounce: { cardId: string; userSeat: number; targetSeats: number[] } | null;
  /** 批内刚闭窗的反应窗(应答齐即结算):jinnangVoided 的识破牌 id 出自应答
   *  (jinnangVoided.cardId=被拆的宣布牌,非识破者打出的反应牌)。 */
  closedWindow: { view: ReactionView; answers: ReactionAnswer[] } | null;
  /** 闭窗内已消费的应答(AOE 多张识破逐份对账用,对象身份去重)。 */
  consumedAnswers: Set<ReactionAnswer>;
}

/** 主路落格推演(settleMarchLanding → resolveLanding 的事件面镜像):相位 + 待决策落格 +
 *  落格表现态 + 珍宝交涉到来(判定表 treasureVisitor「到来=marchArrived 相邻」半边)。 */
function foldMainLanding(engine: GameEngine, mover: Player, tileIndex: number): void {
  engine.pendingLand = null;
  const tile = engine.board.at(tileIndex);
  // 辅路入口要隘先于一切落格结算(引擎首检):等 selectBranch 抉择;「入辅路置位」
  //(onBranch={step:-1})无专属事件 = 校准兜底五项之四
  if (engine.board.getBranchStart(tileIndex)) {
    engine.turnPhase = "AwaitingBranch";
    engine.lastLandOutcome = null;
    return;
  }
  // 己都城:补给(金额由相邻 cashChanged·supply 回填)+ 招贤(候选 = 招贤校准档)
  if (mover.capitalIndex === tileIndex) {
    engine.turnPhase = "Land";
    engine.lastLandOutcome = { kind: "OwnProperty" };
    return;
  }
  if (tile.type !== "Property" || tile.propertyId == null) {
    // 卧龙岗/宝物城/特殊格:引擎先置 Noop 再各自结算(税/商市金额由相邻 cashChanged 回填)
    engine.turnPhase = "Land";
    engine.lastLandOutcome = { kind: "Noop" };
    return;
  }
  const def = propertyDefOf(engine, tile.propertyId);
  const owner = holdingOwnerOf(engine, tile.propertyId);
  if (owner == null) {
    // 无主城:银两+委任状足额 → 决策相位挂起;不足 → 引擎自动按兵不动收场(同批
    // turnStarted 覆盖相位;propertyRejected 为声明性事件,无状态转移)
    engine.lastLandOutcome = { kind: "PropertyAvailable", property: def };
    if (mover.cash >= def.purchasePrice && mover.warrants >= BUY_WARRANT_COST) {
      engine.pendingLand = { kind: "PropertyAvailable", propertyId: tile.propertyId };
      engine.turnPhase = "AwaitingDecision";
    } else {
      engine.turnPhase = "Land";
    }
    return;
  }
  if (owner === mover) {
    // 己城:未满级 → 决策相位挂起;满级 → 引擎自动按兵不动收场
    const holding = mover.properties.find((h) => h.propertyId === tile.propertyId);
    if (holding == null)
      throw new Error(`折叠投影:己城落格 ${tile.propertyId} 无持有(副本状态不一致)`);
    engine.lastLandOutcome = { kind: "OwnProperty", property: def, owner: mover };
    if (holding.level < def.maxLevel) {
      engine.pendingLand = { kind: "OwnProperty", propertyId: tile.propertyId };
      engine.turnPhase = "AwaitingDecision";
    } else {
      engine.turnPhase = "Land";
    }
    return;
  }
  // 他人城:城主有珍宝 → 交涉到来(treasureVisitor 到来半边);无珍宝 → 无事发生
  if (owner.treasures.length > 0) {
    engine.treasureVisitor = { def, ownerIdx: seatNo(engine, owner) };
    engine.turnPhase = "AwaitingTreasureOwner";
    engine.lastLandOutcome = { kind: "TreasureTrade", property: def, owner };
  } else {
    engine.turnPhase = "Land";
    engine.lastLandOutcome = { kind: "Noop" };
  }
}

/** 事件批折叠(#387 全覆盖):按批内顺序逐条投影进引擎副本(顺序即服务端结算序,后写
 *  覆盖先写)。调用方(controllers/online.ts)负责批粒度的重渲:一次事件批一次
 *  syncFromEngine,不逐事件;批消费后随后的快照水合会无条件覆盖全部字段(对账纠偏,
 *  ADR-0020 决策 3——全覆盖后折叠与校准是冗余双保险)。 */
export function foldEventBatch(engine: GameEngine, events: readonly GameEvent[]): void {
  const ctx: FoldCtx = {
    sawGameStart: false,
    bankruptSeats: new Set<number>(),
    lastAnnounce: null,
    closedWindow: null,
    consumedAnswers: new Set<ReactionAnswer>(),
  };
  for (const ev of events) {
    // 事件首部摸照(判定表「turnNumber/round 事件覆盖」):round 逐事件对齐(单调,后写
    // 覆盖先写);turnNumber 在 turnStarted 处 +1(引擎派发 TurnStart 后才自增),开局
    // 首回合除外(同批 gameStarted 先行,引擎开局即置 1)。
    engine.round = ev.round;
    engine.turnNumber = ev.turn + (ev.kind === "turnStarted" && !ctx.sawGameStart ? 1 : 0);
    switch (ev.kind) {
      // ── 回合/胜负族 ──
      case "gameStarted": {
        const firstMover = foldTarget(engine, ev); // subject=首动者
        engine.phase = "Playing";
        engine.turnPhase = "Roll";
        engine.activeIndex = seatNo(engine, firstMover);
        engine.roundAnchor = seatNo(engine, firstMover);
        ctx.sawGameStart = true;
        break;
      }
      case "turnStarted": {
        const active = foldTarget(engine, ev); // subject=新活跃玩家
        engine.activeIndex = seatNo(engine, active);
        engine.turnPhase = "Roll"; // endTurn 收尾置 Roll;锦囊卷轴挂起(AwaitingJinnang)不可知,水合纠正
        engine.pendingLand = null; // endTurn 回合收口清场
        engine.lastLandOutcome = null;
        engine.treasureVisitor = null; // 交涉窗口必在本回合内收口(成交/不交易/破产清算三路)
        engine.pendingReaction = null; // endTurn 不留悬窗
        engine.jinnangUsedTags = []; // 锦囊回合开账:标签名额清零
        engine.jinnangPeeks = engine.jinnangPeeks.filter((pk) => pk.viewer !== ev.seat); // 窥探至 viewer 下回合开始到期
        break;
      }
      case "turnEnded":
        // 交涉窗口收口(判定表 treasureVisitor「收口=turnEnded」):endTurn 入口前窗口
        // 必已 resolution(引擎三路均先清 visitor 再收回合)
        engine.treasureVisitor = null;
        break;
      case "roundStarted":
      case "roundEnded": {
        // 轮次锚点 = RoundStart/RoundEnd 主体(引擎以 roundAnchor 为座位主体派发)
        const anchor = foldTarget(engine, ev);
        engine.roundAnchor = seatNo(engine, anchor);
        break;
      }
      case "gameOver": {
        const winner = foldTarget(engine, ev); // subject=胜者
        engine.isOver = true;
        engine.winner = winner;
        engine.winReason = ev.reason;
        engine.phase = "GameOver";
        engine.turnPhase = "GameOver";
        break;
      }
      case "setupCompleted":
        break; // Setup 期字段 = 校准兜底五项之五,不折
      // ── 掷骰/行军族 ──
      case "diceRolled":
        engine.lastRoll = { die: ev.die };
        engine.heroDiceBonus = 0; // 擂鼓加成本回合掷骰时点消费(引擎 DieRolled 派发后取走)
        break;
      case "marchArrived": {
        const mover = foldTarget(engine, ev);
        if (ev.path.landBranchStep != null && engine.board.branch) {
          // 辅路落位:position 不变(主路锚点占位),onBranch 置步(汇入推进语义,非五项
          // 之「辅路入口置位」);中伏格 = 标记侧相邻
          mover.onBranch = { step: ev.path.landBranchStep };
          engine.lastMove = ev.path;
          engine.turnPhase = "Land";
          engine.pendingLand = null;
          engine.lastLandOutcome = { kind: "Noop" }; // resolveBranchCell 三路皆先置 Noop
          const cell = engine.board.branch.cells[ev.path.landBranchStep];
          if (cell.kind === "penalty") mover.skipTurns = 1; // 中伏,下回合跳过(标记侧)
          break;
        }
        mover.onBranch = null; // 主路落位:汇入/已在主路,清辅路态
        mover.position = ev.tileIndex;
        engine.lastMove = ev.path;
        foldMainLanding(engine, mover, ev.tileIndex);
        break;
      }
      case "capitalHalt": {
        const mover = foldTarget(engine, ev);
        mover.position = ev.tileIndex;
        mover.onBranch = null; // 必停已在主路(引擎截断落位处清辅路态)
        engine.lastMove = ev.path;
        engine.turnPhase = "Land";
        engine.pendingLand = null;
        engine.lastLandOutcome = { kind: "OwnProperty" }; // 补给金额由相邻 cashChanged·supply 回填
        break;
      }
      // ── 城池族 ──
      case "capitalSelected": {
        const p = foldTarget(engine, ev);
        const def = propertyDefOf(engine, ev.propertyId);
        engine.takenCapitalIndices.add(ev.tileIndex);
        p.capitalIndex = ev.tileIndex;
        p.position = ev.tileIndex;
        p.properties.push({
          propertyId: def.id,
          group: def.group,
          purchasePrice: def.purchasePrice,
          level: 0,
          maxLevel: def.maxLevel,
        });
        // 建城扣费只有 cost 无 cashChanged:Setup 期现金不入折叠(#386 注记保持),开局校准覆盖
        break;
      }
      case "propertyBought": {
        const buyer = foldTarget(engine, ev);
        const def = propertyDefOf(engine, ev.propertyId);
        buyer.cash -= ev.price; // 主动支出随领域事件(判定表 cash 行)
        buyer.warrants -= BUY_WARRANT_COST; // 进驻新城耗委任状(常量单源 core/constants)
        buyer.properties.push({
          propertyId: def.id,
          group: def.group,
          purchasePrice: def.purchasePrice,
          level: 0,
          maxLevel: def.maxLevel,
        });
        break;
      }
      case "propertyUpgraded": {
        const owner = foldTarget(engine, ev); // subject=城主(扩军/公道买卖成交两挂点)
        const def = propertyDefOf(engine, ev.propertyId);
        const holding = owner.properties.find((h) => h.propertyId === ev.propertyId);
        if (holding != null) {
          holding.level = ev.newLevel;
        } else {
          // 副本无持有仍入册(机遇「天赐城池」无事件获城的缺口级联,见文件头):按事件面
          // 补册(等级=事件声明的变更后等级),其余漂移由水合纠正
          owner.properties.push({
            propertyId: def.id,
            group: def.group,
            purchasePrice: def.purchasePrice,
            level: ev.newLevel,
            maxLevel: def.maxLevel,
          });
        }
        break;
      }
      case "propertyRejected":
        break; // 无状态转移(ADR-0013 自动按兵不动的宣告;相位由同批 turnStarted 收场)
      case "exhaustionChoice": {
        const p = foldTarget(engine, ev);
        if (ev.exhaustionKind === "downgrade") {
          const holding = p.properties.find((h) => h.propertyId === ev.propertyId);
          if (holding != null) holding.level -= 1; // 查无 = 赐城缺口级联,略过待水合(文件头)
        } else {
          p.properties = p.properties.filter((h) => h.propertyId !== ev.propertyId); // 失城回无主
        }
        // skipTurns+1 由相邻 staminaChanged(reason=exhaustion)落(耗竭善后标记侧)
        break;
      }
      case "assetTransferred": {
        const bankrupt = foldTarget(engine, ev); // 破产者
        const idx = bankrupt.properties.findIndex((h) => h.propertyId === ev.propertyId);
        let moved: PropertyHolding | null = null;
        if (idx >= 0) moved = bankrupt.properties.splice(idx, 1)[0]!; // 查无 = 赐城缺口级联
        if (ev.toSeat != null) {
          const creditor = seatPlayer(engine, ev.toSeat, "assetTransferred.toSeat");
          if (moved != null) {
            creditor.properties.push(moved); // 等级/组别随册转移(降级漂移由校准节点纠正)
          } else {
            const def = propertyDefOf(engine, ev.propertyId);
            creditor.properties.push({
              propertyId: def.id,
              group: def.group,
              purchasePrice: def.purchasePrice,
              level: 0, // 副本无持有时的等级漂移,水合纠正
              maxLevel: def.maxLevel,
            });
          }
        } // toSeat=null:回无主/销毁,出册即完成
        break;
      }
      // ── 珍宝族 ──
      case "treasureGained":
        foldTarget(engine, ev).treasures.push(treasureDefOf(ev.treasureId)); // 拼点得宝/交割收货
        break;
      case "treasureSold": {
        const seller = foldTarget(engine, ev);
        const idx = seller.treasures.findIndex((t) => t.id === ev.treasureId);
        if (idx >= 0) seller.treasures.splice(idx, 1); // 查无 = 窃玉缺口级联(文件头)
        // 银两不走本事件:交割价随 treasureTraded 折(卖家+价),破产变卖所得随
        // assetLiquidated 折——此处只做出册,防双计
        break;
      }
      case "treasureTraded": {
        engine.escrowTreasure = null; // 交割完成托管清(托管置位无事件 = 校准半边)
        engine.treasureVisitor = null; // 交涉收口
        seatPlayer(engine, ev.buyerSeat, "treasureTraded.buyerSeat").cash -= ev.price;
        seatPlayer(engine, ev.sellerSeat, "treasureTraded.sellerSeat").cash += ev.price;
        break;
      }
      case "treasureStolen":
        break; // 窃玉偷香转移 = 校准兜底五项之二(票面已接受口径),只宣告不折
      // ── 金钱族 ──
      case "cashChanged": {
        const p = foldTarget(engine, ev);
        p.cash += ev.delta; // 被动结算逐条累加(delta 带符号;主动支出随领域事件折)
        // 落格表现态相邻回填(引擎结算序:落格置态 → 经济动账 → 回填金额/破产标记):
        const outcome = engine.lastLandOutcome;
        if (ev.reason === "supply" && outcome?.kind === "OwnProperty" && outcome.resupply == null)
          outcome.resupply = ev.delta; // 都城补给金额(驻跸/落都城两路)
        if (ev.reason === "tax")
          engine.lastLandOutcome = {
            kind: "TaxPaid",
            amount: -ev.delta,
            causedBankruptcy: ctx.bankruptSeats.has(seatNo(engine, p)),
          };
        if (ev.reason === "stock")
          engine.lastLandOutcome = {
            kind: "Noop",
            causedBankruptcy: ctx.bankruptSeats.has(seatNo(engine, p)),
          };
        break;
      }
      // ── 名将族 ──
      case "heroRecruited": {
        const p = foldTarget(engine, ev);
        p.heroes.push(heroDefOf(ev.heroId));
        engine.recruitedHeroIds.add(ev.heroId); // 招贤池占位(offeredHeroes 候选 = 招贤校准档)
        break;
      }
      case "skillFired":
        foldTarget(engine, ev).heroLastFired[ev.skillId] = ev.round; // 冷却记账(键=skill.id)
        break;
      case "heroSkillActivated": {
        const user = foldTarget(engine, ev);
        user.heroLastFired[ev.skillId] = ev.round; // 主动技独立冷却,同键记账
        const skill = activeSkillOfId(ev.skillId);
        switch (skill.kind) {
          case "warDrum":
            engine.heroDiceBonus = requireSkillParam(skill, "bonus");
            break;
          case "patronage":
            user.warrants += 1; // 目标得银随 grantSkillCash 的 cashChanged(reason=skill)折
            break;
          case "relief":
            user.cash -= requireSkillParam(skill, "cost"); // 目标体力随 staminaChanged(heroRelief)折
            break;
          case "demolish":
            break; // 随机降级目标与结果不可知 = 校准兜底五项之一,不折
        }
        break;
      }
      // ── 锦囊族 ──
      case "jinnangDrawn": {
        const p = foldTarget(engine, ev);
        p.jinnangHandCount += ev.count; // 内容=暗牌不折(ADR-0016);牌序=校准档
        engine.jinnangDeckCount -= ev.count;
        break;
      }
      case "jinnangAnnounced": {
        const user = foldTarget(engine, ev);
        const userSeat = seatNo(engine, user);
        const card = jinnangCardOf(ev.cardId);
        consumeCard(engine, user, ev.cardId); // 出牌即扣账:离手+手牌数-1+弃堆
        engine.jinnangUsedTags.push(...card.tags); // 标签名额占用(生产点先扣账后宣告,批序等效)
        if (card.effect.kind === "peek") {
          if (ev.targetSeats.length !== 1)
            throw new Error("折叠投影:军情密探宣布无唯一目标(事件产出契约违反)");
          engine.jinnangPeeks.push({ viewer: userSeat, target: ev.targetSeats[0] }); // 效果落账入册(窥探至 viewer 下回合)
        }
        ctx.lastAnnounce = { cardId: ev.cardId, userSeat, targetSeats: [...ev.targetSeats] };
        break;
      }
      case "jinnangVoided": {
        const responder = foldTarget(engine, ev); // 识破者
        // 扣账锚定:被消耗的是识破者打出的反应牌(id 出自应答),jinnangVoided.cardId=
        // 被拆的宣布牌(已随宣布扣账)。份对账:shareSeat 明传按份配对(AOE),缺席取
        // 座位序第一张未消费的生效应答(单份/连环计全作废)。
        const closed = ctx.closedWindow;
        if (closed == null || closed.view.kind !== "jinnang" || closed.view.cardId !== ev.cardId)
          throw new Error(`折叠投影:${ev.cardId} 识破无同批反应窗可回溯(事件序契约违反)`);
        const responderSeat = seatNo(engine, responder);
        // 应答配对按座位(jinnangVoided 主体=该份的识破者;每座位至多应答一次,座位即键;
        // shareSeat 不随 reactionAnswered 过网,份信息由座位序+逐份 void 事件承载)
        const play = closed.answers
          .filter((a) => a.use && !ctx.consumedAnswers.has(a))
          .sort((a, b) => a.seat - b.seat) // 引擎按座位序结算,同序取张
          .find((a) => a.seat === responderSeat);
        if (play == null || play.cardId == null)
          throw new Error(`折叠投影:${ev.cardId} 识破无对应生效应答(事件序契约违反)`);
        ctx.consumedAnswers.add(play);
        consumeCard(engine, responder, play.cardId); // 识破牌扣账(被顶替张原样退回,无事件不折)
        break;
      }
      case "reactionOpened": {
        const user = foldTarget(engine, ev); // userSeat=窗公告的使用者/行人
        const userSeat = seatNo(engine, user);
        const windowMs =
          engine.reactionWindowMsOverride > 0
            ? engine.reactionWindowMsOverride
            : REACTION_WINDOW_MS[
                ev.windowKind === "jinnang" ? "JinnangAnnounced" : "MarchPassedCity"
              ];
        let view: ReactionView;
        let payload: ReactionPayload;
        if (ev.windowKind === "jinnang") {
          // targetSeats 出自同批宣布(宣布与开窗同一结算 settleJinnangPlay)
          const announce = ctx.lastAnnounce;
          if (announce == null || announce.cardId !== ev.cardId)
            throw new Error(`折叠投影:${ev.cardId} 开窗无同批宣布可回溯(事件序契约违反)`);
          const domain = jinnangCardOf(ev.cardId).targetDomain;
          view = {
            kind: "jinnang",
            cardId: ev.cardId,
            userSeat,
            targetSeats: [...announce.targetSeats],
            queriedBySeat: [...ev.queriedSeats],
            windowMs,
          };
          payload = {
            kind: "jinnang",
            userSeat,
            cardId: ev.cardId,
            targets: domain === "one" || domain === "two-others" ? [...announce.targetSeats] : [],
          };
        } else {
          if (ev.queriedSeats.length !== 1)
            throw new Error("折叠投影:行军窗被询问集非单座城主(事件产出契约违反)");
          view = {
            kind: "march",
            cardId: ev.cardId,
            userSeat,
            ownerSeat: ev.queriedSeats[0]!,
            windowMs,
          };
          // 词汇缺口(回报主线):reactionOpened 不携续走载荷(在途态无事件登记),副本侧
          // payload 仅类型完备占位、零消费面(UI 读 view/answers/seq;payload 唯一消费方 =
          // 权威侧 room.ts 超时判据)。若副本侧将来需要该载荷,先补词汇再折。
          payload = {
            kind: "march",
            moverSeat: userSeat,
            tileIndex: -1,
            stepsToTile: 0,
            totalTiles: 0,
            resumeTiles: [],
            landIndex: -1,
            fromPos: -1,
            steps: 0,
            wasOnBranch: false,
          };
        }
        engine.jinnangSeq += 1; // 窗实例号(nextJinnangSeq 同式)
        const pr: PendingReaction = { seq: engine.jinnangSeq, view, answers: [], payload };
        engine.pendingReaction = pr;
        engine.turnPhase = "AwaitingReaction";
        break;
      }
      case "reactionAnswered": {
        const pr = engine.pendingReaction;
        if (pr == null) throw new Error("折叠投影:reactionAnswered 无挂起反应窗(事件序契约违反)");
        if (ev.seat == null) throw new Error("折叠投影:reactionAnswered 无主座位(契约违反)");
        pr.answers.push({
          seat: ev.seat,
          use: ev.use,
          ...(ev.cardId != null ? { cardId: ev.cardId } : {}),
        });
        if (pr.answers.length >= queriedOf(pr.view).length) {
          // 应答齐即闭窗续结算(引擎先离场再结算;相位由同批后续事件/水合覆盖)
          ctx.closedWindow = { view: pr.view, answers: [...pr.answers] };
          engine.pendingReaction = null;
          if (pr.view.kind === "march") {
            // 行军窗结算恒消耗拦检牌(胜负两路 consumeReactionCard 皆先于拼点),折于
            // 闭窗应答点(批序与引擎结算点等效)
            const ambush = pr.answers.find((a) => a.use);
            if (ambush != null)
              consumeCard(engine, seatPlayer(engine, ambush.seat, "行军窗应答"), AMBUSH_CARD.id);
          }
        }
        break;
      }
      case "reactionFailed":
        break; // 无状态转移(声明性;拦检失败扣账已折于闭窗应答点,拼点参数仅文案)
      // ── 声望/体力族 ──
      case "reputationChanged": {
        const p = foldTarget(engine, ev);
        const before = p.reputation;
        const after = before + ev.delta; // delta=夹紧后实际增减,直加不二次夹紧
        p.reputation = after;
        for (const m of REP_MILESTONES) {
          // 献计里程碑穿越重算(进手随同批 jinnangDrawn·repMilestone 折)
          if (before < m && after >= m && !p.repMilestones.includes(m)) p.repMilestones.push(m);
        }
        break;
      }
      case "staminaChanged": {
        const p = foldTarget(engine, ev);
        p.stamina += ev.delta; // delta=夹紧后实际增减,直加不二次夹紧
        if (ev.reason === "exhaustion") p.skipTurns += 1; // 耗竭善后标记侧相邻(判定表口径)
        break;
      }
      // ── 跳过族 ──
      case "turnSkipped":
        foldTarget(engine, ev).skipTurns -= 1; // 消费侧(endTurn 跳过环扣 1)
        break;
      case "jinnangInflicted":
        seatPlayer(engine, ev.targetSeat, "jinnangInflicted.targetSeat").skipTurns += 1; // 缓兵之计标记侧
        break;
      // ── 机遇族 ──
      case "encounterTriggered": {
        foldTarget(engine, ev); // 机遇主体=行动者,座位契约校验
        const def = ENCOUNTERS.find((c) => c.id === ev.encounterId);
        if (def == null)
          throw new Error(`折叠投影:机遇 ${ev.encounterId} 不在 ENCOUNTERS 表(数据 bug)`);
        if (def.choices != null) {
          // 抉择机遇入相(引擎 enterEncounterPhase):置 Noop + 挂起相位;≤1 可用的自动
          // 执行由同批 encounterChoice/turnStarted 覆盖。即时机遇不碰落格表现态——引擎
          // 即时结算后仍由落格结算置态(与 marchArrived 推演值一致)
          engine.lastLandOutcome = { kind: "Noop" };
          engine.turnPhase = "AwaitingEncounter";
        }
        break;
      }
      case "encounterChoice":
        // 选项结算点:settleEncounterChoice 效果落账后继续本落格结算(settled 路)——
        // 相位先回 Land,落格推演重跑归同批后续事件/水合(选项效果 liquidating/exhausted
        // 路的挂起相位无专属事件 = 校准档)
        engine.turnPhase = "Land";
        break;
      // ── 破产族 ──
      case "playerBankrupt": {
        const p = foldTarget(engine, ev);
        ctx.bankruptSeats.add(seatNo(engine, p));
        p.isBankrupt = true;
        p.capitalIndex = -1; // 善后清都城(资产已随 assetTransferred 逐城折)
        for (const h of p.heroes) engine.recruitedHeroIds.delete(h.id); // 名将释放回招贤池
        p.heroes = [];
        if (p.jinnangHand.length > 0) {
          engine.jinnangDiscard.push(...p.jinnangHand); // 锦囊清手入弃堆(#198)
          p.jinnangHand = [];
        }
        p.jinnangHandCount = 0;
        // 现金清零/债主收款/珍宝转债主 = 破产清算强制全量节点(ADR-0020 决策 3),不折
        break;
      }
      case "assetLiquidated": {
        const p = foldTarget(engine, ev);
        p.cash += ev.amount; // 变卖所得随事件折(无 cashChanged,判定表 cash 行)
        if (ev.asset.kind === "treasure") {
          const idx = p.treasures.findIndex((t) => t.id === ev.asset.id);
          if (idx >= 0) p.treasures.splice(idx, 1); // 查无 = 窃玉缺口级联(文件头)
        } else if (ev.asset.kind === "property") {
          const idx = p.properties.findIndex((h) => h.propertyId === ev.asset.id);
          if (idx >= 0) p.properties.splice(idx, 1); // 查无 = 赐城缺口级联(文件头)
        } else {
          const idx = p.heroes.findIndex((h) => h.id === ev.asset.id);
          if (idx < 0) throw new Error(`折叠投影:遣散名将 ${ev.asset.id} 不在副本麾下(契约违反)`);
          p.heroes.splice(idx, 1);
          engine.recruitedHeroIds.delete(ev.asset.id); // 释放回招贤池(引擎 cashHeroBankruptcy)
        }
        break;
      }
      // ── 未登记进折叠范围的族:忽略(范围定义,非吞错;校准档清单见文件头)──
      default:
        break;
    }
  }
}
