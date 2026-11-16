// 折叠投影器(#386 两族起步,#387 全覆盖,ADR-0020 决策 1 折叠切换⑤):服务端事件批
// → 本地引擎副本字段的纯函数投影。联机端引擎是「只读副本」(快照水合而来),本模块把
// 事件批直接折进副本的可见状态字段——这是应用层投影,不是引擎行为:不往 src/core 加任何
// 方法,副本仍保持只读语义(外部不 submitCommand,红线 3 的「走公共方法」约束的是引擎
// 权威态变更,副本投影属协议消费面)。
//
// ── 折叠范围(#387 全覆盖;字段面以 #384 覆盖判定表「事件覆盖 + 事件+校准(双覆盖)」
//    为准,逐族对账见本票汇报;per-kind 消费档位(精确折/折+校准/声明性/校准兜底)的
//    机器可查判定数据单源 core/event-tiers.ts EVENT_TIERS,#430——本文件头保留字段级
//    折叠明细,档位决策以表为准,两处失同步时改表)──
//   回合/胜负族   gameStarted → phase=Playing + activeIndex/roundAnchor(=首动者);
//                 turnStarted → activeIndex + turnPhase=Roll + 回合开账(usedTags 清零/
//                 窗口与落格决策载荷清场);roundStarted/roundEnded → roundAnchor
//                 (=轮次锚点主体);gameOver → isOver/winner/winReason/phase/turnPhase。
//                 round/turnNumber 逐事件摸事件首部(turnStarted 特殊:引擎派发后才
//                 turnNumber+1,故 +1;开局首回合同批有 gameStarted 先行,取首部本值)
//   掷骰/行军族   diceRolled → lastRoll + heroDiceBonus 消费清零;capitalHalt → position/
//                 lastMove/turnPhase=Land(补给金额相邻回填);marchArrived → position/
//                 lastMove/turnPhase=Land;landingResolved → 最终相位/pendingLand/
//                 lastLandOutcome/treasureVisitor 与固定事件续接载荷
//   城池族        capitalSelected → takenCapitalIndices/capitalIndex/position/地产 Lv0 入册
//                 (Setup 期现金不入折叠,#386 注记保持);propertyBought → 现金-价/
//                 地产入册;propertyUpgraded → 持有等级对齐 newLevel(副本无
//                 持有则按事件补册,历史赐城缺口级联已随 propertyGranted 闭合,见下);
//                 propertyRejected → 无状态转移
//                 (声明性;自动按兵不动由同批 turnStarted 收场);propertyGranted →
//                 机遇赐城得城者 Lv.0 入册(#719,原级联缺口闭合);exhaustionResolved →
//                 降级清单逐城 -1 级(0 级封底)+ skipTurns 按显式 restTurns 累加;
//                 assetTransferred → 破产逐城易主(承让方入册/无债主回无主)
//   金钱族        cashChanged → 现金逐条累加(delta 带符号)+ 落格表现态相邻回填
//                 (reason=supply 回填补给金额;商市行情只动账,决策等待 landingResolved)
//   珍宝族        treasureGained → 得宝入册(流水号实例 id 按静态表回溯定义);
//                 treasureSold → 卖家出册(银两不在此折:交割价随 treasureTraded、变卖所得
//                 随 assetLiquidated,防双计);treasureTraded → escrow 清/visitor 收口/
//                 买家-价 卖家+价;treasureStolen → 不折(窃玉偷香转移 = 校准兜底五项之二)
//   名将族        heroRecruited → 麾下入槽(skillIds=本次授技,建槽不重掷)+ 招贤池占位;
//                 heroDismissed → 整槽出麾下(冷却随槽俱弃)+ 招贤池划名(#1147);
//                 skillFired/heroSkillActivated → 冷却记账(heroId 定槽,槽内 lastFired,
//                 键=skillId,#785 实例化);主动技按技表(skills.ts)参数落账:
//                 warDrum → heroDiceBonus、relief → 现金-费(目标体力随 staminaChanged 折)、
//                 fireBlast → 不折(火攻城损等级/防御值不在事件面 = 校准兜底,#1388)
//   锦囊族        jinnangDrawn → 手牌数+count/牌库数-count(内容=暗牌与牌序不折,
//                 ADR-0016);jinnangReshuffled → 牌库数+count/弃堆清零(洗后牌序不折);
//                 jinnangAnnounced → 出牌扣账(手牌数-1/弃堆+1/标签占名额);
//                 peekApplied → 零折(窥探即时一次性 #575,无任何客户端状态);
//                 (反应锦囊 id 出自同批应答,按座位配对;shareSeat 不参与折叠);
//                 reactionOpened → pendingReaction
//                 置窗(权威公告);reactionAnswered → 应答、收窗与实际费用入账
//                 + 应答齐闭窗;行军窗闭窗即拦检牌扣账(引擎胜负两路均在结算点扣账,与
//                 应答同批);reactionFailed → 无状态转移(声明性);
//                 duelResolved → 无状态转移(声明性 #636/ADR-0030:拼点结算宣告,胜负
//                 后果由调用点既有事件折——拦停=marchArrived、银两=cashChanged·duel)
//   声望/体力族   reputationChanged → 声望 += 实际增减(无界直加,#1090);
//                 staminaChanged → 体力 += 夹紧后实际增减;reason=exhaustion 相邻 →
//                 skipTurns+1(耗竭善后标记侧)
//   破产族        playerBankrupt → isBankrupt/capitalIndex=-1/名将释放回池/锦囊清手入弃堆
//                 (现金清零/债主收款/珍宝转债主 = 破产清算强制全量节点,不折);
//                 assetLiquidated → 现金+amount + 变卖城池出册(珍宝由 treasureSold 出册)
//                 bankruptcySettled → 清债/交涉 + 双方现金置为技能结算后的最终余额
//   跳过族        turnSkipped → skipTurns-1(消费侧);jinnangInflicted → 目标 skipTurns+1
//                 (缓兵之计标记侧)
//   机遇族        encounterTriggered → lastLandOutcome=Noop + 抉择型置 AwaitingEncounter +
//                 即时路 def.setsFlags 折章(#1153 静态目录派生);encounterChoice →
//                 相位回 Land + 按 id+choiceIndex 回查 option.setsFlags 折章(#1153;
//                 效果本体经现金/声望/体力/得宝/招贤折)
//   纯派生字段    netWorth(=cash)/choices/decisionOwner/
//                 lastLandOutcomeKind/lastLandOutcomeProperty/logCount/
//                 currentSetupPlayerIndex/
//                 reaction(=pendingReaction.view)不折自得
//
// ── 校准兜底项(#384 判定表对账:折叠器不碰,由快照水合纠正,ADR-0020 决策 3)──
//   ①城池降级精确等级:火烧连营随机降级与火攻城损等级/防御值不在任何事件(结算无专属事件,#1388)
//   ②窃玉偷香珍宝转移:treasureStolen 只宣告不转移(双方珍宝列表校准)
//   ③出牌阶段目标段草稿无专属事件，随摘要水合；公开宣布时清除 pendingJinnang。
//   ⑤Setup 期字段:draftOrder/draftRolls/currentDraftIndex/offeredCapitals/usedGuohao/
//     setupPhase,开局校准点覆盖
//   对账机器(#431):本校准清单的发射侧触发登记单源 scripts/seat-projection——
//   CALIBRATION_WINDOWS/CALIBRATION_EVENT_KINDS(类型化 ReadonlySet,phase/kind 改名=
//   编译红)+ CALIBRATION_COVERAGE(档位表 calibration-only kind 逐个点名覆盖触发,
//   漏点名=编译红)。本清单与校准触发是同一决策的两侧,档位判定单源 core/event-tiers,
//   两处失同步时以档位表+对账机器为准。
//   另有判定表「校准点」档全项(gameId/targetNetWorth/牌序/rngState/log/pendingDebt 等):
//     开局/破产清算/洗牌类强制全量节点覆盖,折叠器不碰。
//
// ── 已知无事件转移的级联口径(移除类折叠查无目标 = 略过,非吞错)──
//   判定表之外存在无事件的转移:
//   行军窗拦停成功时的拦检牌扣账(本器折于闭窗应答点,批序等效)。「机遇天赐城池入册」
//   已随 propertyGranted(#719)迁入词汇表闭合。剩余无事件转移使副本在批窗口内
//   与引擎分歧,后续「移除类」折叠(出册/降级)可能查无目标——这是已接受缺口的级联,
//   略过待下一帧水合纠正;「新增类」折叠恒精确落账。per-kind 档位与漂移窗见 EVENT_TIERS
//   (core/event-tiers.ts):词汇表内 kind 的 default 归属由档位表穷尽守卫(FoldHandledKind),
//   线上未知 kind 一律忽略——这是折叠范围的定义,不是吞错。
//
// ── 零兜底 ──
//   折叠族事件产出恒带具体座位(见 game-events.ts 各产出点,行动者=座位主),seat=null
//   = 产出契约违反,当场炸出不静默跳过;事件引用的静态数据(名将/锦囊/机遇/地产目录)
//   查无 = 数据 bug,当场炸出;事件序违反(应答无窗)当场炸出;delta/数量
//   等字段缺失由类型系统在编译期兜住(线上形状以 core GameEvent 为准)。
import type { GameEngine } from "@core/authority";
import type { Player, PropertyHolding } from "@core/model";
import type { GameEvent, GameEventBody } from "@core/game-events";
import { fullDefenseOf, resetToFull } from "@core/defense";
import type { PropertyDef } from "@core/economy";
import type { ReactionPayload, ReactionView } from "@core/reaction-window";
import type { ActiveSkillDef } from "@core/skills";
import { jinnangCardOf } from "@core/jinnang";
import { grantEncounterFlags, isOncePerGameEncounter, markOnceEncounter } from "@core/encounters";
import {
  TREASURES,
  isSkillBook,
  makeSkillBook,
  SKILL_BOOK_ID_PREFIX,
  type TreasureDef,
} from "@core/treasures";
import {
  activeSkillDefOf,
  encounterDefOfId,
  eventSeat,
  eventSeatPlayer,
  heroDefOf,
  type FoldHandledKind,
} from "@core/event-tiers";
import { heroSlotOf } from "@core/roster";

/** 主动技参数必存校验:HEROES 声明的技参数在折叠落账时缺失 = 数据 bug,当场炸出。 */
function requireSkillParam(skill: ActiveSkillDef, key: string): number {
  const v = skill.params?.[key];
  if (v === undefined) throw new Error(`折叠投影:主动技 ${skill.id} 缺参数 ${key}(数据 bug)`);
  return v;
}

/** 珍宝实例 id 回溯静态定义:牌堆实例 id = `${静态id}-${流水号}`(createTreasureDeck),
 *  事件只带实例 id,名称/等级按静态表回溯(实例其余字段一致)。技能书(#1146)不在
 *  静态表——`skillbook-<skillId>` 前缀路由印书单源 makeSkillBook 现组(禁逐技静态造表)。
 *  查无 = 数据 bug,炸出。 */
function treasureDefOf(instanceId: string): TreasureDef {
  if (instanceId.startsWith(SKILL_BOOK_ID_PREFIX))
    return makeSkillBook(instanceId.slice(SKILL_BOOK_ID_PREFIX.length));
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
 *  座位校验单源 core/event-tiers(eventSeat),返回副本内玩家对象(seat 语义 = players
 *  下标,indexOf 恒等)。 */
function foldTarget(engine: GameEngine, ev: GameEvent): Player {
  return engine.players[eventSeat(engine, ev)];
}

/** 事件座位号(契约校验后的 number 面):越界座位 = 契约违反,炸出(不静默写 undefined)。 */
function seatNo(engine: GameEngine, p: Player): number {
  const seat = engine.players.indexOf(p);
  if (seat < 0) throw new Error("折叠投影:玩家不在副本座位表(契约违反)");
  return seat;
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
}

/** 事件批折叠(#387 全覆盖):按批内顺序逐条投影进引擎副本(顺序即服务端结算序,后写
 *  覆盖先写)。调用方(controllers/online.ts)负责批粒度的重渲:一次事件批一次
 *  syncFromEngine,不逐事件;批消费后随后的快照水合会无条件覆盖全部字段(对账纠偏,
 *  ADR-0020 决策 3——全覆盖后折叠与校准是冗余双保险)。 */
export function foldEventBatch(engine: GameEngine, events: readonly GameEvent[]): void {
  const ctx: FoldCtx = {
    sawGameStart: false,
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
        engine.turnPhase = "Roll"; // endTurn 收尾置 Roll;出牌阶段挂起(AwaitingJinnang)不可知,水合纠正
        engine.pendingLand = null; // endTurn 回合收口清场
        engine.lastLandOutcome = null;
        engine.treasureVisitor = null; // 交涉窗口必在本回合内收口(成交/不交易/破产清算三路)
        engine.pendingReaction = null; // endTurn 不留悬窗
        engine.jinnangUsedTags = []; // 锦囊回合开账:标签名额清零
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
        engine.isOver = true;
        engine.winReason = ev.reason;
        engine.phase = "GameOver";
        engine.turnPhase = "GameOver";
        // #642 异常终局(reason="aborted"):无胜者——subject 是派发主体(activeIndex)
        // 而非胜者,显式分支置 null,不当胜者折叠(与引擎 abortGame 同态;终局 UI 呈现
        // 归 #642 第二棒)。正常终局 subject=胜者,照旧按座位折叠。
        engine.winner = ev.reason === "aborted" ? null : foldTarget(engine, ev);
        break;
      }
      // ── 掷骰/行军族 ──
      case "diceRolled":
        engine.lastRoll = { die: ev.die };
        engine.heroDiceBonus = 0; // 擂鼓加成本回合掷骰时点消费(引擎 DieRolled 派发后取走)
        break;
      case "marchArrived": {
        const mover = foldTarget(engine, ev);
        mover.position = ev.tileIndex;
        engine.lastMove = ev.path;
        engine.turnPhase = "Land";
        break;
      }
      case "landingResolved": {
        foldTarget(engine, ev); // 最终落格事实仍须由有效行动者宣告。
        engine.turnPhase = ev.turnPhase;
        engine.pendingLand = ev.pendingLand;
        engine.pendingCityEvent = ev.pendingCityEvent;
        engine.pendingEncounter = null;
        engine.pendingEncounterHalt = false;
        if (ev.turnPhase !== "AwaitingHeroPick") engine.offeredHeroes = [];
        engine.treasureVisitor =
          ev.treasureVisitor == null
            ? null
            : {
                def: propertyDefOf(engine, ev.treasureVisitor.propertyId),
                ownerIdx: ev.treasureVisitor.ownerIdx,
              };
        engine.lastLandOutcome = {
          kind: ev.outcome.kind,
          ...(ev.outcome.propertyId == null
            ? {}
            : { property: propertyDefOf(engine, ev.outcome.propertyId) }),
          ...(ev.outcome.ownerSeat == null
            ? {}
            : {
                owner: eventSeatPlayer(
                  engine,
                  ev.outcome.ownerSeat,
                  "landingResolved.outcome.ownerSeat",
                ),
              }),
          ...(ev.outcome.amount == null ? {} : { amount: ev.outcome.amount }),
          ...(ev.outcome.resupply == null ? {} : { resupply: ev.outcome.resupply }),
          ...(ev.outcome.causedBankruptcy == null
            ? {}
            : { causedBankruptcy: ev.outcome.causedBankruptcy }),
        };
        break;
      }
      case "capitalHalt": {
        const mover = foldTarget(engine, ev);
        mover.position = ev.tileIndex;
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
          level: 0,
          maxLevel: def.maxLevel,
          defense: fullDefenseOf(0), // 建都=持有起点,防御满值(#1386;与引擎 setup-flow 同口径)
        });
        // 建城扣费只有 cost 无 cashChanged:Setup 期现金不入折叠(#386 注记保持),开局校准覆盖
        break;
      }
      case "propertyBought": {
        const buyer = foldTarget(engine, ev);
        const def = propertyDefOf(engine, ev.propertyId);
        buyer.cash -= ev.price; // 主动支出随领域事件(判定表 cash 行)
        buyer.properties.push({
          propertyId: def.id,
          group: def.group,
          level: 0,
          maxLevel: def.maxLevel,
          defense: fullDefenseOf(0), // 购入即易主,防御满值(#1386;与引擎 economy.buy 同口径)
        });
        break;
      }
      case "propertyGranted": {
        // 机遇赐城(#719,传檄而定):得城者 Lv.0 入册——此前是「已知无事件转移的级联
        // 口径」之一,本事件闭合(赐城后的移除类折叠不再查无目标)
        const grantee = foldTarget(engine, ev);
        const def = propertyDefOf(engine, ev.propertyId);
        grantee.properties.push({
          propertyId: def.id,
          group: def.group,
          level: 0,
          maxLevel: def.maxLevel,
          defense: fullDefenseOf(0), // 赐城=易主入册,防御满值(#1386;与引擎 encounter-flow 同口径)
        });
        break;
      }
      case "propertyUpgraded": {
        const owner = foldTarget(engine, ev); // subject=城主(扩军/公道买卖成交两挂点)
        const def = propertyDefOf(engine, ev.propertyId);
        const holding = owner.properties.find((h) => h.propertyId === ev.propertyId);
        if (holding != null) {
          holding.level = ev.newLevel;
          resetToFull(holding); // 等级一变防御即重置满值(#1386;与引擎升级两挂点同口径)
        } else {
          // 副本无持有仍入册(机遇「天赐城池」无事件获城的缺口级联,见文件头):按事件面
          // 补册(等级=事件声明的变更后等级),其余漂移由水合纠正
          owner.properties.push({
            propertyId: def.id,
            group: def.group,
            level: ev.newLevel,
            maxLevel: def.maxLevel,
            defense: fullDefenseOf(ev.newLevel), // 补册按满值(#1386),漂移由水合纠正
          });
        }
        break;
      }
      case "exhaustionResolved": {
        const p = foldTarget(engine, ev);
        for (const propertyId of ev.downgradedPropertyIds) {
          const holding = p.properties.find((h) => h.propertyId === propertyId);
          // 降级不重置防御(#1386):外敌乘虚直接降级不走防御值,与引擎 exhaustIfDepleted 同口径
          if (holding != null) holding.level -= 1; // 查无 = 赐城缺口级联,略过待水合(文件头)
        }
        p.skipTurns += ev.restTurns; // 休整回合数随事件显式走(不做相邻推断)
        break;
      }
      case "assetTransferred": {
        const bankrupt = foldTarget(engine, ev); // 破产者
        const idx = bankrupt.properties.findIndex((h) => h.propertyId === ev.propertyId);
        let moved: PropertyHolding | null = null;
        if (idx >= 0) moved = bankrupt.properties.splice(idx, 1)[0]!; // 查无 = 赐城缺口级联
        if (ev.toSeat != null) {
          const creditor = eventSeatPlayer(engine, ev.toSeat, "assetTransferred.toSeat");
          if (moved != null) {
            resetToFull(moved); // 转移=易主,防御重置满值(#1386;与引擎 settleDebt 同口径)
            creditor.properties.push(moved); // 等级/组别随册转移(降级漂移由校准节点纠正)
          } else {
            const def = propertyDefOf(engine, ev.propertyId);
            creditor.properties.push({
              propertyId: def.id,
              group: def.group,
              level: 0, // 副本无持有时的等级漂移,水合纠正
              maxLevel: def.maxLevel,
              defense: fullDefenseOf(0),
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
        const escrow = engine.escrowTreasure;
        // 托管实物在挂债时已经出册;交割的售宝事件不能再消费卖家的同标识余册。
        const soldFromEscrow =
          escrow !== null && escrow.sellerIdx === ev.seat && escrow.treasure.id === ev.treasureId;
        if (!soldFromEscrow) {
          const idx = seller.treasures.findIndex((t) => t.id === ev.treasureId);
          if (idx >= 0) seller.treasures.splice(idx, 1); // 查无 = 窃玉缺口级联(文件头)
        }
        // 银两不走本事件:交割价随 treasureTraded 折(卖家+价),破产变卖所得随
        // assetLiquidated 折——此处只做出册,防双计
        break;
      }
      case "treasureTraded": {
        engine.escrowTreasure = null; // 交割完成托管清(托管置位无事件 = 校准半边)
        engine.treasureVisitor = null; // 交涉收口
        eventSeatPlayer(engine, ev.buyerSeat, "treasureTraded.buyerSeat").cash -= ev.price;
        eventSeatPlayer(engine, ev.sellerSeat, "treasureTraded.sellerSeat").cash += ev.price;
        break;
      }
      // ── 金钱族 ──
      case "cashChanged": {
        const p = foldTarget(engine, ev);
        const next = p.cash + ev.delta;
        if (next < 0)
          throw new Error(
            `折叠投影:cashChanged ${ev.delta} 使座位 ${seatNo(engine, p)} 现金穿零(副本漂移,契约违反)`,
          );
        p.cash = next; // 清算挂起不产整额扣款,实际破产扫账由强制全量节点同步。
        // 落格表现态相邻回填(引擎结算序:落格置态 → 经济动账 → 回填金额/破产标记):
        const outcome = engine.lastLandOutcome;
        if (ev.reason === "supply" && outcome?.kind === "OwnProperty" && outcome.resupply == null)
          outcome.resupply = ev.delta; // 都城补给金额(驻跸/落都城两路)
        break;
      }
      // ── 名将族 ──
      case "heroRecruited": {
        const p = foldTarget(engine, ev);
        // skillIds=本次授技(权威态随事件下行,折叠建槽不重掷,#785);marks 恒置空表
        // (槽位标记感知构造的折叠第四路,与快照恢复同口径——同形断言 #1377 评审修复)
        p.heroes.push({ heroId: ev.heroId, skillIds: [...ev.skillIds], lastFired: {}, marks: {} });
        engine.recruitedHeroIds.add(ev.heroId); // 招贤池占位(offeredHeroes 候选 = 招贤校准档)
        break;
      }
      case "skillFired":
        // 冷却记账入槽(heroId 定槽;键=skillId,各槽各账,#785 实例化)
        heroSlotOf(foldTarget(engine, ev), ev.heroId).lastFired[ev.skillId] = ev.round;
        break;
      case "heroDismissed": {
        // 遣散(#1147):整槽出麾下(冷却随槽俱弃)+招贤池划名(再招=重掷);查无=
        // 事件序契约违反,炸出(零兜底)。已学技折书随同批 treasureGained 逐册折,
        // 本事件只出麾下与招贤池两账。
        const p = foldTarget(engine, ev);
        const idx = p.heroes.findIndex((s) => s.heroId === ev.heroId);
        if (idx < 0) throw new Error(`折叠投影:遣散名将 ${ev.heroId} 不在副本麾下(契约违反)`);
        p.heroes.splice(idx, 1);
        engine.recruitedHeroIds.delete(ev.heroId);
        break;
      }
      case "skillLearned": {
        // 用书学技(#1146):槽内池序入技(与引擎 learnSkillInSlot 同构,槽序恒池序)+
        // 消耗的技能书珍宝位出册。书是明置公开物(珍宝列表不裁,ADR-0016),查无/种别
        // 不符=事件序契约违反,炸出(零兜底)。
        const learner = foldTarget(engine, ev);
        const slot = heroSlotOf(learner, ev.heroId);
        const pool = heroDefOf(ev.heroId).skillPool;
        slot.skillIds = pool.filter((id) => id === ev.skillId || slot.skillIds.includes(id));
        const idx = learner.treasures.findIndex((t) => t.id === ev.treasureId);
        if (idx < 0)
          throw new Error(
            `折叠投影:skillLearned 消耗书 ${ev.treasureId} 不在珍宝位(事件序契约违反)`,
          );
        const consumed = learner.treasures[idx]!;
        if (!isSkillBook(consumed) || consumed.skillId !== ev.skillId)
          throw new Error(
            `折叠投影:skillLearned 消耗物 ${ev.treasureId} 与事件技 ${ev.skillId} 不符(契约违反)`,
          );
        learner.treasures.splice(idx, 1);
        break;
      }
      case "heroSkillActivated": {
        const user = foldTarget(engine, ev);
        heroSlotOf(user, ev.heroId).lastFired[ev.skillId] = ev.round; // 主动技冷却入槽,同键记账
        const skill = activeSkillDefOf(ev.skillId);
        switch (skill.kind) {
          case "warDrum":
            engine.heroDiceBonus = requireSkillParam(skill, "bonus");
            break;
          case "relief":
            user.cash -= requireSkillParam(skill, "cost"); // 目标体力随 staminaChanged(heroRelief)折
            break;
          case "fireBlast":
            break; // 火攻城损等级/防御值不在事件面(#1388)= 校准兜底,随快照对齐
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
      case "jinnangReshuffled": {
        // 弃牌堆骰序洗回牌库:牌库数+count、弃堆清零(count=洗回前弃堆全量,精确折);
        // 洗后牌序=暗牌不折(ADR-0016),中途洗牌随批全量校准(CALIBRATION_EVENT_KINDS)
        engine.jinnangDeckCount += ev.count;
        engine.jinnangDiscard = [];
        break;
      }
      case "jinnangAnnounced": {
        const user = foldTarget(engine, ev);
        const card = jinnangCardOf(ev.cardId);
        if (card.targetDomain === "reaction") break; // 反应锦囊在收窗事件中已扣账。
        engine.pendingJinnang = null;
        consumeCard(engine, user, ev.cardId);
        engine.jinnangUsedTags.push(...card.tags);
        break;
      }
      case "reactionOpened": {
        foldTarget(engine, ev);
        const { seq, view } = ev;
        // 副本无权续结算，保留既有挂起载荷占位；公开状态一律读权威 view。
        const payload: ReactionPayload =
          view.kind === "jinnang"
            ? { kind: "jinnang", userSeat: view.userSeat, cardId: view.cardId, targets: [] }
            : {
                kind: "march",
                moverSeat: view.userSeat,
                tileIndex: view.tileIndex,
                stepsToTile: 0,
                totalTiles: 0,
                resumeTiles: [],
                landIndex: -1,
                fromPos: -1,
                steps: 0,
              };
        engine.jinnangSeq = seq;
        engine.pendingReaction = { seq, view, answers: [], payload };
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
          if (ev.spentCards == null)
            throw new Error("折叠投影:最终反应应答缺扣账清单(事件产出契约违反)");
          engine.pendingReaction = null;
          for (const { seat, cardId } of ev.spentCards) {
            consumeCard(engine, eventSeatPlayer(engine, seat, "反应牌扣账"), cardId);
          }
          // 锦囊收窗继续行军；尚有可用暗牌时，出牌阶段随既有决策窗校准恢复。
          // 下一反应环与行军落格分别由同批开窗和落格事件覆盖。
          if (pr.view.kind === "jinnang") engine.turnPhase = "Roll";
        }
        break;
      }
      // ── 声望/体力族 ──
      case "reputationChanged": {
        const p = foldTarget(engine, ev);
        p.reputation += ev.delta; // delta=实际增减(声望无界直加)
        break;
      }
      case "staminaChanged": {
        const p = foldTarget(engine, ev);
        p.stamina += ev.delta; // delta=夹紧后实际增减,直加不二次夹紧(休整期满回满=reason:rest,纯体力账)
        break;
      }
      // ── 跳过族 ──
      case "turnSkipped":
        foldTarget(engine, ev).skipTurns -= 1; // 消费侧(endTurn 跳过环扣 1)
        break;
      case "jinnangInflicted":
        eventSeatPlayer(engine, ev.targetSeat, "jinnangInflicted.targetSeat").skipTurns += 1; // 缓兵之计标记侧
        break;
      // ── 机遇族 ──
      case "encounterTriggered": {
        const mover = foldTarget(engine, ev); // 机遇主体=行动者,座位契约校验
        const def = encounterDefOfId(ev.encounterId); // 目录回查单源 core/event-tiers
        // 奇遇已遇集(#1154):一局一遇按玩家,与引擎 maybeApplyEncounter 写点同位——
        // 判定/落账单源 encounters.ts(isOncePerGameEncounter/markOnceEncounter),
        // 事件本体零改动(#1126 拍板②)
        if (isOncePerGameEncounter(ev.encounterId)) markOnceEncounter(mover, ev.encounterId);
        if (def.choices != null) {
          // 抉择机遇入相(引擎 enterEncounterPhase):置 Noop + 挂起相位;≤1 可用的自动
          // 执行由同批 encounterChoice/turnStarted 覆盖。即时机遇不碰落格表现态——引擎
          // 即时结算后由 landingResolved 宣告落格结果
          engine.lastLandOutcome = { kind: "Noop" };
          engine.turnPhase = "AwaitingEncounter";
        } else {
          // 即时路折章(#1153):def.setsFlags 与引擎 settleEncounter 写点同位(#1126
          // 拍板② 静态目录派生,事件本体零改动)
          grantEncounterFlags(mover, def.setsFlags);
        }
        break;
      }
      case "encounterChoice": {
        // 选项结算点:settleEncounterChoice 效果落账后继续本落格结算(settled 路)——
        // 相位先回 Land,最终落格结果归同批后续 landingResolved(选项效果 liquidating/exhausted
        // 路的挂起相位无专属事件 = 校准档)
        engine.turnPhase = "Land";
        // 抉择路折章(#1153):按 id+choiceIndex 回查目录取 option.setsFlags——章与文案
        // 同为静态目录数据,事件不带成品(#385 同源纪律,#1126 拍板②);下标越界/选项
        // 缺失 = 产出侧契约违反,当场炸出
        const def = encounterDefOfId(ev.encounterId);
        const option = def.choices?.[ev.choiceIndex];
        if (option == null)
          throw new Error(
            `折叠投影:机遇 ${ev.encounterId} 选项 ${ev.choiceIndex} 不在目录(契约违反)`,
          );
        grantEncounterFlags(foldTarget(engine, ev), option.setsFlags);
        break;
      }
      // ── 破产族 ──
      case "playerBankrupt": {
        const p = foldTarget(engine, ev);
        p.isBankrupt = true;
        p.capitalIndex = -1; // 善后清都城(资产已随 assetTransferred 逐城折)
        for (const slot of p.heroes) engine.recruitedHeroIds.delete(slot.heroId); // 整槽释放回招贤池
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
        // 同一笔售宝已有 treasureSold 出册,此处再删会多消费同标识技能书。
        if (ev.asset.kind === "property") {
          const idx = p.properties.findIndex((h) => h.propertyId === ev.asset.id);
          if (idx >= 0) p.properties.splice(idx, 1); // 查无 = 缺口级联略过(文件头;赐城缺口已随 propertyGranted 闭合)
        }
        break;
      }
      case "bankruptcySettled": {
        foldTarget(engine, ev).cash = ev.cashAfter;
        if (ev.creditor !== null)
          eventSeatPlayer(engine, ev.creditor.seat, "bankruptcySettled.creditor.seat").cash =
            ev.creditor.cashAfter;
        engine.pendingDebt = null;
        engine.treasureVisitor = null;
        break;
      }
      // ── 折叠面零操作档(default 守卫,档位单源 core/event-tiers)──
      // 走到这里的已登记 kind 必须是 declarative(声明性无转移)/ calibration-only
      //(校准兜底不折)档——must-fold / fold+calibration 漏 case = 下面赋值编译期红
      //(FoldHandledKind 派生集,#430 防遗漏机器)。线上未知 kind 不在联合内,运行时
      // 落此忽略:ADR-0020 既定口径,折叠范围的定义,非吞错。
      default: {
        const silentKind: Exclude<GameEventBody["kind"], FoldHandledKind> = ev.kind;
        void silentKind;
        break;
      }
    }
  }
}
