// 反应窗域(#281,ADR-0017):锦囊识破窗 + 行军拦检窗的开窗/应答/结算。
// ADR-0019 委托式拆分:域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;
// GameEngine 侧保留公共方法 respondReaction 与域外挂点(openReactionWindow/
// resolveDuel)的同名薄委托,src/core/authority.ts 反应窗区段。
import type { GameEngine } from "./authority";
import { botReactionDecision } from "./bot";
import { jinnangCardOf } from "./jinnang";
import { emitGameEvent } from "./game-events";
import { REACTION_WINDOW_MS } from "./constants";

// ── 反应窗类型(#281,ADR-0017;#326 types.ts 解散,ADR-0019 类型随域走)────────
/** 锦囊宣布反应窗的公开载荷:挂起点公告(哪个结算点、牌、使用者、目标)+ 被询问集。
 *  可见性登记(ADR-0016 投影白名单;redact 改造归传输层下一道缝,字段形状已按两档可投影设计):
 *  - public:cardId/userSeat/targetSeats —— 出牌本就公开事件,全员可见;
 *  - per-seat private:queriedBySeat —— god-view 为被询问座位全集;联机 redact 时
 *    **身份匿名、数量保留**(自己座位保留,他人一律置换 -1 匿名占位,投影单口
 *    scripts/seat-projection.ts redactReactionView):「谁被询问」不外泄,数量必须
 *    保留——折叠器闭窗算术读 length,压成 ≤1 会在首条应答误闭窗(#461)。 */
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
      /** 反识破链环(#571,ADR-0027):被公告的是一张识破诡计,站住则其否定生效。 */
      kind: "counter";
      /** 识破使用者(本环公告者)。 */
      userSeat: number;
      /** 本环打出的反应牌 id(目录唯一 counter=「识破诡计」)。 */
      cardId: string;
      /** 链根:被拆的原锦囊上下文(链终续根结算)。 */
      root: { userSeat: number; cardId: string; targets: number[] };
      /** 本环争夺的份(all-others 根=具体座位;one/self=其唯一份;连环计=整计,省略)。 */
      shareSeat?: number;
      /** 已定案的豁免份集(兄弟链累积;根结算并入 exempt)。 */
      negated: number[];
      /** 本环站住时根锦囊的待遇:true=该份被保住(整计域=作废生效);false=本环已被反(份照常受击/整计恢复)。 */
      protects: boolean;
      /** 待续兄弟链环(AOE 各份座位序第一张,牌已随 W1 收窗扣账;本链收口后逐环宣布)。 */
      upcoming: { seat: number; cardId: string; shareSeat?: number }[];
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

/** 单调流水号取号(#284):反应窗实例号(挂起点写 PendingReaction.seq)。cmd 流派生
 *  状态,重放重算天然复现;快照恢复按快照内最大 seq 推回(authority.restoreFromSnapshot)。 */
function nextJinnangSeq(g: GameEngine): number {
  return ++g.jinnangSeq;
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
      ? payload.kind === "counter"
        ? `${user.guohao} 打出【${view.cardId}】(反识破),反应窗开启`
        : `${user.guohao} 使用锦囊【${view.cardId}】,反应窗开启`
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
      if (pr.payload.kind === "jinnang") {
        // 份校验(根窗):AOE 必带且须在受影响名单内;连环计可省略(任意一张识破即全计作废),
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
      } else {
        // 份校验(反识破链环,#571):争夺份由载荷携带,应答不带份;带错份拒绝。
        if (pr.payload.kind !== "counter")
          throw new Error("respondReaction:jinnang 窗挂 march 载荷(状态机 bug)"); // 零兜底
        if (shareSeat != null && shareSeat !== pr.payload.shareSeat) {
          g.warn(`respondReaction:反识破应答份 ${shareSeat} 与争夺份不符`);
          return;
        }
      }
    }
  }
  appendReactionAnswer(g, pr, { seat, use, cardId, shareSeat });
  if (reactionAllAnswered(pr)) {
    g.pendingReaction = null; // 先离场再续结算:续体可开新窗(march 续走的下一城)
    resolveReactionWindow(g, pr);
  }
}

/** 反应窗续结算(pr 已离场 pendingReaction):按窗种类分派。识破窗按载荷分支:根窗
 *  (payload.jinnang)=锦囊宣布的拆招,链环窗(payload.counter,#571 ADR-0027)=反识破,
 *  链环经相位窗逐环开问、开窗即返回不加深(「效果内禁同步再派发时机」红线约束的是
 *  effect 帧,窗结算走命令帧,不破);拦检结算(拼点/止步落格)不再询问——续走途经的
 *  「下一座城」是新挂点,不属窗内结算。 */
function resolveReactionWindow(g: GameEngine, pr: PendingReaction): void {
  if (pr.view.kind === "jinnang") settleCounterWindow(g, pr);
  else settleAmbushWindow(g, pr);
}

/** 识破窗结算分发:根窗与反识破链环窗共用相位(AwaitingReaction),按载荷种类分流。 */
function settleCounterWindow(g: GameEngine, pr: PendingReaction): void {
  if (pr.view.kind !== "jinnang") throw new Error("识破窗结算:载荷与公告不符(状态机 bug)"); // 零兜底
  if (pr.payload.kind === "jinnang") settleRootCounterWindow(g, pr);
  else if (pr.payload.kind === "counter") settleChainCounterWindow(g, pr);
  else throw new Error("识破窗结算:march 载荷挂 jinnang 窗(状态机 bug)"); // 零兜底
}

/** 反识破链环宣布(#571,ADR-0027):牌已随应答收窗扣账,此处只公开宣布——走
 *  JinnangAnnounced 时机(公开事件+出牌线,与根锦囊同口),持识破者(本环打出者除外,
 *  含链根使用者救计)开下一环询问窗;无人可反不开窗,本环立即站住(#281「不开窗直接
 *  结算」同口径)。protects=本环站住时争夺份的待遇:根窗首环恒 true(保住);链环窗
 *  逐环翻转(反识破站住=上一环作废=该份恢复受击)。 */
function announceCounterLink(
  g: GameEngine,
  seat: number,
  cardId: string,
  share: number | undefined,
  root: Extract<ReactionPayload, { kind: "counter" }>["root"],
  negated: number[],
  upcoming: Extract<ReactionPayload, { kind: "counter" }>["upcoming"],
  protects: boolean,
): void {
  const responder = g.players[seat];
  g.pushFloaterText(responder, `${responder.guohao} 打出【${cardId}】`, responder.position);
  g.logEvent(
    "system",
    responder.guohao,
    `${responder.guohao} 打出【${cardId}】,欲拆 ${g.players[root.userSeat].guohao} 的【${root.cardId}】`,
    `reactionCounterAnnounce by=${responder.id} root=${root.cardId}${share != null ? ` share=${g.players[share].id}` : ""}`,
  );
  g.dispatchMoment("JinnangAnnounced", {
    subject: seat,
    cardId,
    targetSeats: share != null ? [share] : [],
  }); // 时机·JinnangAnnounced:识破宣布(链环与根同口,事件流公开)
  const payload: ReactionPayload = {
    kind: "counter",
    userSeat: seat,
    cardId,
    root: { ...root, targets: [...root.targets] },
    negated: [...negated],
    protects,
    upcoming: upcoming.map((u) => ({ ...u })),
    ...(share != null ? { shareSeat: share } : {}),
  };
  const queried = g
    .alivePlayers()
    .map((p) => g.players.indexOf(p))
    .filter(
      (s) =>
        s !== seat &&
        g.players[s].jinnangHand.some((id) => jinnangCardOf(id).effect.kind === "counter"),
    );
  if (queried.length === 0) {
    settleCounterStands(g, payload);
    return;
  }
  const view: ReactionViewSeed = {
    kind: "jinnang",
    cardId,
    userSeat: seat,
    targetSeats: share != null ? [share] : [],
    queriedBySeat: queried,
  };
  openReactionWindow(g, view, payload); // bot 全代答时窗在开窗调用内即席结算
}

/** 识破根窗结算(#281 结算面 + #571 链化):座位序逐张生效,每份/整计的座位序第一张从
 *  「直接生效」改为宣布进反识破链;同窗同份其余原样退回手牌不消耗;无有效识破则照常
 *  执行被公告锦囊。链环牌随本窗收窗即扣账(应答=打出;兄弟环先扣防双耗,被反也不回手)。 */
function settleRootCounterWindow(g: GameEngine, pr: PendingReaction): void {
  const payload = pr.payload;
  if (payload.kind !== "jinnang") throw new Error("识破根窗结算:载荷不符(状态机 bug)"); // 零兜底
  const user = g.players[payload.userSeat];
  const def = jinnangCardOf(payload.cardId);
  const plays = pr.answers.filter((a) => a.use).sort((a, b) => a.seat - b.seat); // 座位序确定性
  if (plays.length === 0) {
    g.executeJinnang(user, payload.userSeat, def, payload.targets);
    g.settleJinnangExit();
    return;
  }
  const root = {
    userSeat: payload.userSeat,
    cardId: payload.cardId,
    targets: [...payload.targets],
  };
  switch (def.targetDomain) {
    case "two-others": {
      // 连环计:座位序第一张进链(缺角语义链终裁决:站住=全计作废,被反=恢复),其余退回
      const first = plays[0]!;
      consumeReactionCard(g, first.seat, first.cardId!);
      announceCounterLink(g, first.seat, first.cardId!, undefined, root, [], [], true);
      returnSupersededCounters(g, plays.slice(1), def.id);
      return;
    }
    case "all-others": {
      // AOE 按份拆:每份座位序第一张进各自反识破链(兄弟链按座位序串行),同份其余退回
      const claimed = new Set<number>();
      const upcoming: Extract<ReactionPayload, { kind: "counter" }>["upcoming"] = [];
      const superseded: ReactionAnswer[] = [];
      let first: ReactionAnswer | null = null;
      for (const play of plays) {
        const share = play.shareSeat;
        if (share == null) throw new Error(`识破窗结算:${def.id} 的识破缺 shareSeat(命令校验缺口)`); // 零兜底
        if (claimed.has(share)) {
          superseded.push(play); // 该份已被座位序更小的识破占住:此张退回
          continue;
        }
        claimed.add(share);
        consumeReactionCard(g, play.seat, play.cardId!); // 收窗即扣账(兄弟环防双耗)
        if (first == null) first = play;
        else upcoming.push({ seat: play.seat, cardId: play.cardId!, shareSeat: share });
      }
      if (first == null) throw new Error("识破根窗结算:AOE 有应答但无首张(状态机 bug)"); // 零兜底
      returnSupersededCounters(g, superseded, def.id);
      announceCounterLink(g, first.seat, first.cardId!, first.shareSeat, root, [], upcoming, true);
      return;
    }
    case "one":
    case "self": {
      // 单份计(self 的份=使用者自身):座位序第一张进链,整计落空在链终裁决;其余退回
      const first = plays[0]!;
      const share = def.targetDomain === "self" ? payload.userSeat : payload.targets[0];
      consumeReactionCard(g, first.seat, first.cardId!);
      announceCounterLink(g, first.seat, first.cardId!, share, root, [], [], true);
      returnSupersededCounters(g, plays.slice(1), def.id);
      return;
    }
    case "reaction":
      // 根窗不挂反应牌:反应牌不经出牌阶段/出牌通道,链环窗走 payload.counter(状态机 bug)
      throw new Error(`识破根窗挂起了反应牌【${def.id}】(状态机 bug)`);
  }
}

/** 反识破链环窗结算(#571,ADR-0027):座位序第一张反识破生效=本环识破作废(已扣账
 *  不回手,事件+浮字落账),进下一环;同窗其余退回;无有效反识破则本环站住,链终裁定
 *  根锦囊待遇。 */
function settleChainCounterWindow(g: GameEngine, pr: PendingReaction): void {
  const payload = pr.payload;
  if (payload.kind !== "counter") throw new Error("反识破链环结算:载荷不符(状态机 bug)"); // 零兜底
  const plays = pr.answers.filter((a) => a.use).sort((a, b) => a.seat - b.seat);
  if (plays.length === 0) {
    settleCounterStands(g, payload);
    return;
  }
  const first = plays[0]!;
  returnSupersededCounters(g, plays.slice(1), payload.cardId);
  consumeReactionCard(g, first.seat, first.cardId!); // 收窗即扣账:被反识破也不回手
  const rescuer = g.players[first.seat];
  const announcer = g.players[payload.userSeat];
  g.pushFloaterText(
    announcer,
    `${rescuer.guohao} 反识破!【${payload.cardId}】作废`,
    announcer.position,
  );
  g.logEvent(
    "system",
    rescuer.guohao,
    `${rescuer.guohao} 反识破,${announcer.guohao} 的【${payload.cardId}】作废`,
    `reactionCounterVoid card=${payload.cardId} by=${rescuer.id} on=${announcer.id}`,
  );
  emitGameEvent(g, first.seat, {
    kind: "jinnangVoided",
    cardId: payload.cardId,
    ...(payload.shareSeat != null ? { shareSeat: payload.shareSeat } : {}),
  }); // 事件流:反识破生效(识破被拆,份=争夺份)
  announceCounterLink(
    g,
    first.seat,
    first.cardId!,
    payload.shareSeat,
    payload.root,
    payload.negated,
    payload.upcoming,
    !payload.protects, // 站住待遇逐环翻转:反识破站住=上一环作废=该份恢复受击
  );
}

/** 反识破链环站住(#571,ADR-0027):站住识破的否定生效——整计域(连环计/单份计)
 *  protect=true=作废/落空即终局,protect=false=计恢复照常执行;AOE 该份入豁免集
 *  (判定浮字逐份落账,protect=false 的环不落账=该份照常受击)。兄弟链未清则续开
 *  下一环(牌已随根窗收窗扣账),清空后按根域收口执行。 */
function settleCounterStands(
  g: GameEngine,
  payload: Extract<ReactionPayload, { kind: "counter" }>,
): void {
  const root = payload.root;
  const rootDef = jinnangCardOf(root.cardId);
  const responder = g.players[payload.userSeat];
  if (rootDef.targetDomain !== "all-others") {
    if (payload.protects) {
      // 整计域:识破站住=作废(连环计缺角)/落空(单份计),终局
      const verdict = rootDef.targetDomain === "two-others" ? "作废" : "落空";
      g.pushFloaterText(responder, `识破!【${rootDef.id}】${verdict}`, responder.position);
      const detail =
        rootDef.targetDomain === "two-others"
          ? `reactionCounter card=${rootDef.id} by=${responder.id} voided=all`
          : `reactionCounter card=${rootDef.id} by=${responder.id} share=${g.players[payload.shareSeat!].id}`;
      g.logEvent(
        "system",
        responder.guohao,
        `${responder.guohao} 识破【${rootDef.id}】,此计${verdict}`,
        detail,
      );
      emitGameEvent(g, payload.userSeat, { kind: "jinnangVoided", cardId: rootDef.id });
      g.settleJinnangExit();
      return;
    }
    g.executeJinnang(g.players[root.userSeat], root.userSeat, rootDef, root.targets); // 本环被反:计恢复
    g.settleJinnangExit();
    return;
  }
  // AOE:本环保下的份判定落账
  if (payload.protects && payload.shareSeat != null) {
    const shielded = g.players[payload.shareSeat];
    g.pushFloaterText(
      shielded,
      `${responder.guohao} 识破,${shielded.guohao} 免于【${rootDef.id}】`,
      shielded.position,
    );
    g.logEvent(
      "system",
      responder.guohao,
      `${responder.guohao} 识破【${rootDef.id}】,${shielded.guohao} 那一份失效`,
      `reactionCounter card=${rootDef.id} by=${responder.id} share=${shielded.id}`,
    );
    emitGameEvent(g, payload.userSeat, {
      kind: "jinnangVoided",
      cardId: rootDef.id,
      shareSeat: payload.shareSeat,
    });
  }
  const negated =
    payload.protects && payload.shareSeat != null
      ? [...payload.negated, payload.shareSeat]
      : [...payload.negated];
  if (payload.upcoming.length > 0) {
    const next = payload.upcoming[0]!;
    announceCounterLink(
      g,
      next.seat,
      next.cardId,
      next.shareSeat,
      root,
      negated,
      payload.upcoming.slice(1),
      true,
    );
    return;
  }
  g.executeJinnang(
    g.players[root.userSeat],
    root.userSeat,
    rootDef,
    root.targets,
    new Set(negated),
  );
  g.settleJinnangExit();
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
 *  出牌阶段额度(回合开始清零),反应牌多在他人回合打出,混入会污染账本。 */
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
    settleAmbushStop(g, payload);
    return;
  }
  // 平/负:拦检失败,牌白耗(已扣),行人照常续走
  g.pushFloaterText(owner, `拦检失败(掷 ${duel.aRoll} 对 ${duel.bRoll})`, payload.tileIndex);
  emitGameEvent(g, play.seat, {
    kind: "reactionFailed",
    windowKind: "march",
    tileIndex: payload.tileIndex,
    aRoll: duel.aRoll,
    bRoll: duel.bRoll,
  }); // 事件流(#385):拦检失败(文案浮字 fx 按点数参数拼装,锚拦检城)
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao} 拦检失败(平局/落败),【半路杀出】白耗`,
    `reactionAmbushFail owner=${owner.id} mover=${mover.id} winner=${duel.winnerSeat == null ? "tie" : g.players[duel.winnerSeat].id}`,
  );
  resumeMarch(g, payload);
}

/** 拦停落格:行人止步拦检城、照常落格结算(机遇/城池;可能被交涉)。lastMove 截断到
 *  拦检城(行军动画只走此)。 */
function settleAmbushStop(
  g: GameEngine,
  payload: Extract<ReactionPayload, { kind: "march" }>,
): void {
  const mover = g.players[payload.moverSeat];
  const path = g.board.computePath(payload.fromPos, payload.stepsToTile, mover.capitalIndex);
  g.lastMove = path;
  mover.position = payload.tileIndex;
  emitGameEvent(g, payload.moverSeat, {
    kind: "marchArrived",
    tileIndex: payload.tileIndex,
    path,
  }); // 事件流(#375):行军落格(拦停止步;截断路径随事件走)
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
    payload.fromPos,
    payload.steps,
  );
  if (walked !== "landed") return; // suspended=下一城又开窗(新挂点续链);halted=续走中必停已结算
  g.settleMarchLanding(mover, payload.landIndex);
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
