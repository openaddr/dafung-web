// 反应窗域(#281,ADR-0017):锦囊识破窗 + 行军拦检窗的开窗/应答/结算。
// ADR-0019 委托式拆分:域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;
// GameEngine 侧保留公共方法 respondReaction 与域外挂点(openReactionWindow/
// traceJinnangPlay/resolveDuel)的同名薄委托,src/core/authority.ts 反应窗区段。
import type { GameEngine } from "./authority";
import { botReactionDecision } from "./bot";
import { jinnangCardOf } from "./jinnang";
import { emitGameEvent } from "./game-events";
import { REACTION_WINDOW_MS } from "./constants";

// ── 反应窗类型(#281,ADR-0017;#326 types.ts 解散,ADR-0019 类型随域走)────────
/** 锦囊宣布反应窗的公开载荷:挂起点公告(哪个结算点、牌、使用者、目标)+ 被询问集。
 *  可见性登记(ADR-0016 投影白名单;redact 改造归传输层下一道缝,字段形状已按两档可投影设计):
 *  - public:cardId/userSeat/targetSeats —— 出牌本就公开事件,全员可见;
 *  - per-seat private:queriedBySeat —— god-view 为被询问座位全集;联机 redact 时每座位
 *    只投影「自己是否被询问」(在列→[自己座位],不在列→[]),他人询问态不外泄。 */
export interface JinnangReactionView {
  kind: "jinnang";
  /** 被公告的锦囊 id(识破的对象)。 */
  cardId: string;
  /** 锦囊使用者座位。 */
  userSeat: number;
  /** 目标座位集:self=[使用者]、one/two-others=被指定座位、all-others=受影响全员
   *  (=可被拆的份清单,UI 据此渲染「保护哪份」)。 */
  targetSeats: number[];
  /** [per-seat private] 被询问座位集(持识破诡计者,使用者除外;god-view 全集,投影见类型头注释)。 */
  queriedBySeat: number[];
  /** 开窗时长(毫秒,#284):引擎开窗时查 `constants.ts` `REACTION_WINDOW_MS` 写入,
   *  随 view 走——客户端横幅/倒计时投影读此字段,不再各自引常量表(单源收口;
   *  联机权威侧可经服务器 env 覆盖,两端同长自动成立)。 */
  windowMs: number;
}

/** 行军拦检反应窗的公开载荷:march 窗无私有档——被询问者=城主,城主归属可由棋盘推导,
 *  全字段 public。 */
export interface MarchReactionView {
  kind: "march";
  /** 本窗唯一可打的反应牌,恒「半路杀出」。 */
  cardId: string;
  /** 行军者(行人)座位。 */
  userSeat: number;
  /** 城主座位(=被询问者/拦检者)。 */
  ownerSeat: number;
  /** 开窗时长(毫秒,#284):同 JinnangReactionView.windowMs。 */
  windowMs: number;
}

/** 反应窗公告载荷(快照 reaction 字段的类型;两窗判别联合)。 */
export type ReactionView = JinnangReactionView | MarchReactionView;

/** 分布式 Omit(联合类型逐成员剔除;工具类型)。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 反应窗公告载荷的开窗前形状(#284):windowMs 不由各挂点构造时散抄常量表,
 *  引擎开新窗(openReactionWindow)时按窗种类查 REACTION_WINDOW_MS 统一写入。 */
export type ReactionViewSeed = DistributiveOmit<ReactionView, "windowMs">;

/** 反应窗应答记录(#281):use=false 也占座(每被询问座位至多应答一次);
 *  use=true 携打出牌 id,识破 AOE 另携被保护份座位。 */
export interface ReactionAnswer {
  seat: number;
  use: boolean;
  cardId?: string;
  shareSeat?: number;
}

/** 反应窗续结算载荷:挂起点被挂起时,应答齐后按此续跑(全部序列化友好纯数据)。 */
export type ReactionPayload =
  | {
      /** 锦囊宣布被挂起:出牌已扣账,应答齐后无有效识破则照常执行。 */
      kind: "jinnang";
      userSeat: number;
      cardId: string;
      /** executeJinnang 的目标参数(one/two-others=被指定座位;self/all-others=[])。 */
      targets: number[];
    }
  | {
      /** 行军途经城池被挂起:拦停成功则止步该城照常落格,否则续走余下途经格。 */
      kind: "march";
      moverSeat: number;
      /** 拦检城 tile(当前窗)。 */
      tileIndex: number;
      /** 行军起点至拦检城的总步数(拦停时 lastMove 截断重算用)。 */
      stepsToTile: number;
      /** 原途经格总数(续走截断重算的 walkedCount 基准)。 */
      totalTiles: number;
      /** 当前格之后的待遍历主路格(含原落点;拦停成功即弃)。 */
      resumeTiles: number[];
      /** 原落点(拦检失败/不用时照常落此)。 */
      landIndex: number;
      /** 行军起点(拦停/续走重算 lastMove 用)。 */
      fromPos: number;
      /** 原掷骰总步数(同上)。 */
      steps: number;
      /** 行军前是否在辅路(含待入态;BranchExited 派发判定)。 */
      wasOnBranch: boolean;
    };

/** 反应窗挂起态(#281):公告 + 应答记录 + 续结算载荷。全部随快照序列化(SNAPSHOT_FIELDS
 *  单点清单);重放=普通 respondReaction 命令流(超时兜底=权威侧代发同款命令,ADR-0017)。
 *  结算中段停相位先例:AwaitingTreasureOwner(落他人城→城主三选)。 */
export interface PendingReaction {
  /** 窗实例号(#284):引擎每次开新窗 +1 的单调序号,跨整局递增,随快照序列化。
   *  消费方:传输层(联机 room.ts armReactionWait)按 seq 判据武装超时定时器——同一
   *  窗只武装一次、到期时刻一次算死,链重开不重置他人倒计时(FreeKill request.lua
   *  「timestamp+timeout 随包下发、同窗不重置」同语义);客户端横幅/倒计时以 seq 变化
   *  重起弧。重放按命令流重算天然复现(cmd 流派生状态)。 */
  seq: number;
  /** 挂起点公告(快照 reaction 派生字段直接透出此结构)。 */
  view: ReactionView;
  /** 应答记录(use 与不用都占座;isBot 座位在开窗时即席代答,ADR-0017「bot 持牌即时代答」)。 */
  answers: ReactionAnswer[];
  /** 续结算载荷。 */
  payload: ReactionPayload;
}

// ──────────────────────────── 反应窗(#281,ADR-0017)────────────────────────────
// 结算中段停相位先例:AwaitingTreasureOwner(落他人城→城主三选)。挂起点存 pendingReaction
// (公告+应答+续结算载荷,全序列化)→ AwaitingReaction → 应答齐 → 续结算。被询问的
// isBot 座位在开窗同一调用内即席代答(botReactionDecision,纯策略不掷骰,重放确定性);
// 人类座位(含托管/看门狗代驾)等 respondReaction 命令——权威侧超时代发的也是这条普通
// 命令,重放天然复现。每次结算只问一轮:每被询问座位至多应答一次。

/** 单调流水号取号(#284):反应窗与出牌留痕共用同一计数器(独立亦可在语义上等效,
 *  共用省一份状态;消费方只做「变了没有」的 diff/判据,不依赖两通道号段关系)。 */
function nextJinnangSeq(g: GameEngine): number {
  return ++g.jinnangSeq;
}

/** 出牌留痕双通道写入(#281/#284):瞬态 jinnangPlays 供单机表现提取器破坏性读
 *  (本地编排,presentation.drainJinnangPlays);可序列化 lastJinnangPlay 供联机
 *  快照 diff(客户端 SnapshotEffects 提取,传输层无独立事件通道)。两通道同点写入,
 *  消费口径注释互指。同批多条留痕(如 AOE 多人识破循环)聚进同一 plays(批界=封批)。 */
export function traceJinnangPlay(
  g: GameEngine,
  userSeat: number,
  targetSeats: number[],
  cardId: string,
): void {
  g.jinnangPlays.push({ userSeat, targetSeats, cardId });
  if (g.jinnangPlayBatch == null)
    g.lastJinnangPlay = g.jinnangPlayBatch = { seq: nextJinnangSeq(g), plays: [] };
  g.jinnangPlayBatch.plays.push({ userSeat, targetSeats, cardId });
}

/** 开反应窗(挂点共用):置挂起态 → bot 即席代答 → 应答齐则同调用内续结算(bot 全代答时
 *  相位不外显),否则进 AwaitingReaction 等人类应答。 */
export function openReactionWindow(
  g: GameEngine,
  viewSeed: ReactionViewSeed,
  payload: ReactionPayload,
): void {
  // windowMs 随 view 走(#284 单源):开窗时长在此一处写入——EngineConfig 覆盖值
  // (联机 env E2E_REACTION_MS)优先,缺省按窗种类查 core 配置表。客户端横幅/倒计时
  // 投影与联机权威侧定时器同读快照值(两端同长自动成立),构造点不散抄常量表。
  const windowMs =
    g.reactionWindowMsOverride > 0
      ? g.reactionWindowMsOverride
      : REACTION_WINDOW_MS[viewSeed.kind === "jinnang" ? "JinnangAnnounced" : "MarchPassedCity"];
  const view: ReactionView =
    viewSeed.kind === "jinnang" ? { ...viewSeed, windowMs } : { ...viewSeed, windowMs };
  const pr: PendingReaction = { seq: nextJinnangSeq(g), view, answers: [], payload };
  g.pendingReaction = pr; // 先入引擎态:bot 即席决策与快照投影都读引擎公开字段
  const user = g.players[view.userSeat];
  const queriedTxt = reactionQueriedOf(view)
    .map((s) => g.players[s].id)
    .join("+");
  const brief =
    view.kind === "jinnang"
      ? `${user.guohao} 使用锦囊【${view.cardId}】,反应窗开启`
      : `${user.guohao} 行军途经 ${g.players[view.ownerSeat].guohao} 的城池,可【${view.cardId}】拦检`;
  g.logEvent(
    "system",
    user.guohao,
    brief,
    `reactionWindow kind=${view.kind} card=${view.cardId} user=${user.id} queried=${queriedTxt}`,
  );
  emitGameEvent(g, view.userSeat, {
    kind: "reactionOpened",
    windowKind: view.kind,
    cardId: view.cardId,
    queriedSeats: reactionQueriedOf(view),
  }); // 事件流(#375):反应窗开启(queriedSeats god-view 明传,ADR-0020)
  autoAnswerBots(g, pr);
  if (reactionAllAnswered(pr)) {
    g.pendingReaction = null; // bot 全代答:同调用内续结算,相位不外显
    resolveReactionWindow(g, pr);
    return;
  }
  g.turnPhase = "AwaitingReaction";
}

/** 反应窗被询问座位集(view 单源:jinnang=queriedBySeat 持识破者全集;march=[城主])。
 *  同式镜像:scripts/bot-driver.ts reactionQueriedSeats(传输层,#331 自 room.ts 挪入)、
 *  src/app/controllers/reaction.ts(app 层单源,react-local/online/Banner 消费)——三层注释互指。 */
function reactionQueriedOf(view: ReactionView): number[] {
  return view.kind === "jinnang" ? view.queriedBySeat : [view.ownerSeat];
}

function reactionAllAnswered(pr: PendingReaction): boolean {
  return pr.answers.length >= reactionQueriedOf(pr.view).length;
}

/** bot 即席代答(ADR-0017 §3「bot 持牌即时代答不等满」):被询问的 isBot 座位按策略
 *  即席应答。人类座位(含托管/看门狗代驾)不代答——代驾永不主动出反应牌,超时一律
 *  不用,兜底命令由权威侧传输层代发(#148/#229 口径)。 */
function autoAnswerBots(g: GameEngine, pr: PendingReaction): void {
  for (const seat of reactionQueriedOf(pr.view)) {
    if (!g.players[seat].isBot) continue;
    if (pr.answers.some((a) => a.seat === seat)) continue;
    const d = botReactionDecision(g, seat);
    appendReactionAnswer(g, pr, {
      seat,
      use: d.use,
      cardId: d.cardId,
      shareSeat: d.shareSeat,
    });
  }
}

/** 应答入账(校验后的唯一写口):占座 + 战报。 */
function appendReactionAnswer(g: GameEngine, pr: PendingReaction, a: ReactionAnswer): void {
  pr.answers.push(a);
  const p = g.players[a.seat];
  emitGameEvent(g, a.seat, { kind: "reactionAnswered", use: a.use, cardId: a.cardId }); // 事件流(#375):反应窗应答(bot 即席代答同走)
  g.logEvent(
    "system",
    p.guohao,
    a.use ? `${p.guohao} 反应:打出【${a.cardId}】` : `${p.guohao} 反应:不用`,
    `reactionRespond seat=${p.id} use=${a.use ? 1 : 0} card=${a.cardId ?? "-"} share=${a.shareSeat ?? "-"}`,
  );
}

/** 反应窗应答(#281 公共入口,UI/bot 驱动器/联机/超时代发同走):校验「仅被询问座位、
 *  仅一次、持牌与份合法」后入账;应答齐即续结算。非法命令警告拒绝,不占应答名额。 */
export function respondReaction(
  g: GameEngine,
  seat: number,
  use: boolean,
  cardId?: string,
  shareSeat?: number,
): void {
  if (!g.assertPhase("AwaitingReaction", "respondReaction")) return;
  const pr = g.pendingReaction;
  if (pr == null) throw new Error("respondReaction:AwaitingReaction 相位无挂起反应窗(状态机 bug)");
  const queried = reactionQueriedOf(pr.view);
  if (!queried.includes(seat)) {
    g.warn(`respondReaction:座位 ${seat} 非本窗被询问者`);
    return;
  }
  if (pr.answers.some((a) => a.seat === seat)) {
    g.warn(`respondReaction:座位 ${seat} 已应答过本窗`);
    return;
  }
  if (use) {
    if (cardId == null || !g.players[seat].jinnangHand.includes(cardId)) {
      g.warn(`respondReaction:座位 ${seat} 手中无牌 ${cardId ?? "-"}`);
      return;
    }
    const expect = pr.view.kind === "jinnang" ? "counter" : "ambush";
    if (jinnangCardOf(cardId).effect.kind !== expect) {
      g.warn(`respondReaction:【${cardId}】非本窗可打的反应牌`);
      return;
    }
    if (pr.view.kind === "jinnang") {
      // 份校验:AOE 必带且须在受影响名单内;连环计可省略(任意一张识破即全计作废),
      // 带了须合法;self/one 份额唯一,shareSeat 不参与语义。
      const domain = jinnangCardOf(pr.view.cardId).targetDomain;
      if (
        domain === "all-others" &&
        (shareSeat == null || !pr.view.targetSeats.includes(shareSeat))
      ) {
        g.warn(`respondReaction:识破【${pr.view.cardId}】须指定被保护份`);
        return;
      }
      if (
        domain === "two-others" &&
        shareSeat != null &&
        !pr.view.targetSeats.includes(shareSeat)
      ) {
        g.warn(`respondReaction:shareSeat ${shareSeat} 非【${pr.view.cardId}】的目标`);
        return;
      }
    }
  }
  appendReactionAnswer(g, pr, { seat, use, cardId, shareSeat });
  if (reactionAllAnswered(pr)) {
    g.pendingReaction = null; // 先离场再续结算:续体可开新窗(march 续走的下一城)
    resolveReactionWindow(g, pr);
  }
}

/** 反应窗续结算(pr 已离场 pendingReaction):按窗种类分派。深呼吸约束(#281):
 *  识破结算直接续执行原锦囊,不再开新反应窗(识破不可被识破);拦检结算(拼点/止步
 *  落格)不再询问——续走途经的「下一座城」是新挂点,不属窗内结算。 */
function resolveReactionWindow(g: GameEngine, pr: PendingReaction): void {
  if (pr.view.kind === "jinnang") settleCounterWindow(g, pr);
  else settleAmbushWindow(g, pr);
}

/** 识破窗结算:座位序逐张生效(AOE 各拆各份;同份/连环计多张识破按座位序第一张生效,
 *  其余原样退回手牌不消耗);无有效识破则照常执行被公告锦囊。 */
function settleCounterWindow(g: GameEngine, pr: PendingReaction): void {
  if (pr.view.kind !== "jinnang" || pr.payload.kind !== "jinnang")
    throw new Error("识破窗结算:载荷与公告不符(状态机 bug)"); // 零兜底
  const payload = pr.payload;
  const user = g.players[payload.userSeat];
  const def = jinnangCardOf(payload.cardId);
  const plays = pr.answers.filter((a) => a.use).sort((a, b) => a.seat - b.seat); // 座位序确定性
  if (plays.length === 0) {
    g.executeJinnang(user, payload.userSeat, def, payload.targets);
    g.settleJinnangExit();
    return;
  }
  switch (def.targetDomain) {
    case "two-others": {
      // 连环计:任意一张识破即全计作废(缺角,与平局作废同逻辑);座位序第一张生效,
      // 其余识破原样退回手牌不消耗
      const first = plays[0];
      consumeReactionCard(g, first.seat, first.cardId!);
      const responder = g.players[first.seat];
      g.pushFloaterText(responder, `识破!【${def.id}】作废`, responder.position);
      g.logEvent(
        "system",
        responder.guohao,
        `${responder.guohao} 识破【${def.id}】,此计作废`,
        `reactionCounter card=${def.id} by=${responder.id} voided=all`,
      );
      traceJinnangPlay(g, first.seat, [payload.userSeat], first.cardId!);
      emitGameEvent(g, first.seat, { kind: "jinnangVoided", cardId: def.id }); // 事件流(#375):识破生效(连环计全计作废)
      returnSupersededCounters(g, plays.slice(1), def.id);
      g.settleJinnangExit();
      return;
    }
    case "all-others": {
      // AOE 按份拆:每份(每个被指定者)只免其中一份;多持牌者各拆各份,同份多张按
      // 座位序第一张生效,其余退回(每份计只问一轮,不重复询问)
      const negated = new Set<number>();
      const consumed = new Set<ReactionAnswer>();
      for (const play of plays) {
        const share = play.shareSeat;
        if (share == null) throw new Error(`识破窗结算:${def.id} 的识破缺 shareSeat(命令校验缺口)`); // 零兜底
        if (negated.has(share)) continue; // 该份已被座位序更小的识破保下:此张退回
        consumeReactionCard(g, play.seat, play.cardId!);
        negated.add(share);
        consumed.add(play);
        const responder = g.players[play.seat];
        const shielded = g.players[share];
        g.pushFloaterText(
          shielded,
          `${responder.guohao} 识破,${shielded.guohao} 免于【${def.id}】`,
          shielded.position,
        );
        g.logEvent(
          "system",
          responder.guohao,
          `${responder.guohao} 识破【${def.id}】,${shielded.guohao} 那一份失效`,
          `reactionCounter card=${def.id} by=${responder.id} share=${shielded.id}`,
        );
        traceJinnangPlay(g, play.seat, [share], play.cardId!);
        emitGameEvent(g, play.seat, { kind: "jinnangVoided", cardId: def.id, shareSeat: share }); // 事件流(#375):识破生效(该份失效)
      }
      returnSupersededCounters(
        g,
        plays.filter((p) => !consumed.has(p)),
        def.id,
      );
      g.executeJinnang(user, payload.userSeat, def, payload.targets, negated);
      g.settleJinnangExit();
      return;
    }
    case "one":
    case "self": {
      // 单份计(self 的份=使用者自身):座位序第一张识破生效,此计对那份失效=整计落空;
      // 其余退回
      const first = plays[0];
      consumeReactionCard(g, first.seat, first.cardId!);
      const share = def.targetDomain === "self" ? payload.userSeat : payload.targets[0];
      const responder = g.players[first.seat];
      g.pushFloaterText(responder, `识破!【${def.id}】落空`, responder.position);
      g.logEvent(
        "system",
        responder.guohao,
        `${responder.guohao} 识破【${def.id}】,此计落空`,
        `reactionCounter card=${def.id} by=${responder.id} share=${g.players[share].id}`,
      );
      traceJinnangPlay(g, first.seat, [share], first.cardId!);
      emitGameEvent(g, first.seat, { kind: "jinnangVoided", cardId: def.id }); // 事件流(#375):识破生效(此计落空)
      returnSupersededCounters(g, plays.slice(1), def.id);
      g.settleJinnangExit();
      return;
    }
    case "reaction":
      // 反应牌不可被识破(#281 红线):反应牌永不经 announce 通道,挂不起识破窗
      throw new Error(`识破窗挂起了反应牌【${def.id}】(状态机 bug)`);
  }
}

/** 同窗被顶替的识破原样退回不消耗(#281):牌从未离手,只留战报痕。 */
function returnSupersededCounters(g: GameEngine, plays: ReactionAnswer[], cardId: string): void {
  for (const play of plays) {
    const p = g.players[play.seat];
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 的【${cardId}】无用武之地,原样收回`,
      `reactionCounterReturn seat=${p.id} card=${cardId}`,
    );
  }
}

/** 反应牌扣账(#281):离手入弃堆。不入 jinnangUsedTags 名额——名额账本是活跃玩家的
 *  军师幕额度(回合开始清零),反应牌多在他人回合打出,混入会污染账本。 */
function consumeReactionCard(g: GameEngine, seat: number, cardId: string): void {
  const p = g.players[seat];
  p.jinnangHand.splice(p.jinnangHand.indexOf(cardId), 1);
  p.jinnangHandCount = p.jinnangHand.length;
  g.jinnangDiscard.push(cardId);
}

/** 拦检窗结算:城主用牌 → 与行人拼点(公共结算,与连环计共用);胜=行人止步拦检城、
 *  照常落格结算(可能被交涉);平/负=牌白耗,行人续走。拦检结算内不再询问;续走
 *  途经的下一城是新挂点,不属窗内结算(深呼吸约束,#281)。 */
function settleAmbushWindow(g: GameEngine, pr: PendingReaction): void {
  if (pr.view.kind !== "march" || pr.payload.kind !== "march")
    throw new Error("拦检窗结算:载荷与公告不符(状态机 bug)"); // 零兜底
  const payload = pr.payload;
  const play = pr.answers.find((a) => a.use);
  if (!play) {
    resumeMarch(g, payload); // 不用/超时代发:续走
    return;
  }
  consumeReactionCard(g, play.seat, play.cardId!);
  const duel = resolveDuel(g, play.seat, payload.moverSeat);
  const owner = g.players[play.seat];
  const mover = g.players[payload.moverSeat];
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao} 【半路杀出】拦检:${owner.guohao} 掷 ${duel.aRoll} 点,${mover.guohao} 掷 ${duel.bRoll} 点`,
    `reactionAmbush owner=${owner.id} mover=${mover.id} a=${duel.aRoll} b=${duel.bRoll}`,
  );
  if (duel.winnerSeat === play.seat) {
    // 拦停成功:行人止步拦检城
    g.pushFloaterText(mover, `被 ${owner.guohao} 拦停于途中`, payload.tileIndex);
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 拦检成功,${mover.guohao} 止步于此城`,
      `reactionAmbushStop owner=${owner.id} mover=${mover.id} tile=#${payload.tileIndex}`,
    );
    traceJinnangPlay(g, play.seat, [payload.moverSeat], play.cardId!);
    settleAmbushStop(g, payload);
    return;
  }
  // 平/负:拦检失败,牌白耗(已扣),行人照常续走
  g.pushFloaterText(owner, `拦检失败(掷 ${duel.aRoll} 对 ${duel.bRoll})`, payload.tileIndex);
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao} 拦检失败(平局/落败),【半路杀出】白耗`,
    `reactionAmbushFail owner=${owner.id} mover=${mover.id} winner=${duel.winnerSeat == null ? "tie" : g.players[duel.winnerSeat].id}`,
  );
  resumeMarch(g, payload);
}

/** 拦停落格:行人止步拦检城、照常落格结算(机遇/城池;可能被交涉)。lastMove 截断到
 *  拦检城(行军动画只走此);不弹辅路入口抉择(非自愿止步,不经岔路抉择)。 */
function settleAmbushStop(
  g: GameEngine,
  payload: Extract<ReactionPayload, { kind: "march" }>,
): void {
  const mover = g.players[payload.moverSeat];
  g.lastMove = g.board.computePath(
    payload.fromPos,
    payload.stepsToTile,
    mover.capitalIndex,
    mover.onBranch,
  );
  mover.onBranch = null;
  mover.position = payload.tileIndex;
  emitGameEvent(g, payload.moverSeat, {
    kind: "marchArrived",
    tileIndex: payload.tileIndex,
  }); // 事件流(#375):行军落格(拦停止步)
  if (payload.wasOnBranch)
    g.dispatchMoment("BranchExited", {
      subject: payload.moverSeat,
      tileIndex: payload.tileIndex,
    }); // 时机·BranchExited:辅路行军被拦停汇入主路(止步点)
  g.dispatchMoment("AfterMarch", { subject: payload.moverSeat }); // 时机·AfterMarch:移动完成(拦停止步)、落格结算前
  g.turnPhase = "Land";
  const enc = g.maybeApplyEncounter(mover, payload.tileIndex);
  if (enc === "deciding" || enc === "liquidating" || enc === "bankrupt" || enc === "exhausted")
    return;
  g.resolveLanding();
}

/** 拦检未拦住:行人自拦检城之后续走余下途经格(逐格,可再遇新挂点),走完照常落格。 */
function resumeMarch(g: GameEngine, payload: Extract<ReactionPayload, { kind: "march" }>): void {
  const mover = g.players[payload.moverSeat];
  const walked = g.marchTraverse(
    mover,
    payload.resumeTiles,
    payload.totalTiles,
    payload.landIndex,
    payload.wasOnBranch,
    payload.fromPos,
    payload.steps,
  );
  if (walked !== "landed") return; // suspended=下一城又开窗(新挂点续链);halted=续走中必停已结算
  g.settleMarchLanding(mover, payload.landIndex, payload.wasOnBranch);
}

/** 拼点公共结算(#281 自连环计提出):双方各掷 1d6,点数高者胜,平局 winnerSeat=null。
 *  连环计(二虎竞食)与半路杀出拦检共用;掷点战报与银两/拦停等后效由调用方落账。 */
export function resolveDuel(
  g: GameEngine,
  aSeat: number,
  bSeat: number,
): { aRoll: number; bRoll: number; winnerSeat: number | null } {
  const aRoll = g.dice.rollDie();
  const bRoll = g.dice.rollDie();
  return { aRoll, bRoll, winnerSeat: aRoll === bRoll ? null : aRoll > bRoll ? aSeat : bSeat };
}
