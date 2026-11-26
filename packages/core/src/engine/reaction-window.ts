// 反应窗域(#281,ADR-0017):锦囊识破窗 + 行军拦检窗的开窗/应答/结算。
// ADR-0019 委托式拆分:域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;
// GameEngine 侧保留公共方法 respondReaction 与域外挂点(openReactionWindow/
// resolveDuel)的同名薄委托,packages/core/src/engine/authority.ts 反应窗区段。
import type { GameEngine } from "./authority";
import { tileAtIndex } from "./board";
import { botReactionDecision } from "./bot";
import { jinnangCardOf, type JinnangEffect } from "./jinnang";
import { emitGameEvent } from "./game-events";
import { REACTION_WINDOW_MS } from "./constants";
import { heroDieFaces } from "./skills"; // 拼点骰面数单源(#1390):持英姿者七面

// ── 反应窗类型(#281,ADR-0017;#326 types.ts 解散,ADR-0019 类型随域走)────────
/** 一份反应对象，城格号与座位号各有自己的编号空间。 */
export interface ReactionTarget {
  kind: "city" | "seat";
  id: number;
}

/** 锦囊宣布反应窗的公开载荷:挂起点公告(哪个结算点、牌、使用者、目标)+ 被询问集。
 *  可见性登记(ADR-0016 投影白名单;redact 改造归传输层下一道缝,字段形状已按两档可投影设计):
 *  - public:cardId/userSeat/targets/counter —— 出牌本就公开事件,全员可见;
 *  - per-seat private:queriedBySeat —— god-view 为被询问座位全集;联机 redact 时
 *    **身份匿名、数量保留**(自己座位保留,他人一律置换 -1 匿名占位,投影单口
 *    packages/core/src/room/seat-projection.ts redactReactionView):「谁被询问」不外泄,数量必须
 *    保留——折叠器闭窗算术读 length,压成 ≤1 会在首条应答误闭窗(#461)。 */
export interface JinnangReactionView {
  kind: "jinnang";
  /** 被公告的锦囊 id(识破的对象)。 */
  cardId: string;
  /** 锦囊使用者座位。 */
  userSeat: number;
  /** 受击城格或受影响座位。须选份时 ids 同时是本窗的合法候选。 */
  targets: { kind: ReactionTarget["kind"]; ids: number[]; requiresSelection: boolean };
  /** 反识破链环的根计与当前识破的作用。争夺对象随 targets 公告。 */
  counter?: { rootCardId: string; rootUserSeat: number; protects: boolean };
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
  /** 行人途经的拦检城格。 */
  tileIndex: number;
  /** 开窗时长(毫秒,#284):同 JinnangReactionView.windowMs。 */
  windowMs: number;
}

/** 反应窗公告载荷(快照 reaction 字段的类型;两窗判别联合)。 */
export type ReactionView = JinnangReactionView | MarchReactionView;

/** 分布式 Omit(联合类型逐成员剔除;工具类型)。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 反应窗公告载荷的开窗前形状(#284):windowMs 不由各挂点构造时散抄常量表,
 *  引擎开新窗(openReactionWindow)时按窗种类查 REACTION_WINDOW_MS 统一写入。 */
export type ReactionViewSeed = DistributiveOmit<ReactionView, "windowMs" | "counter">;

/** 反应窗应答记录(#281):use=false 也占座(每被询问座位至多应答一次);
 *  use=true 携打出牌 id，按份根窗另携被保护的城格或座位。 */
export interface ReactionAnswer {
  seat: number;
  use: boolean;
  cardId?: string;
  target?: ReactionTarget;
}

/** 收窗时实际扣除的反应锦囊。未生效且原样退回的应答不在此列。 */
export interface ReactionCardSpend {
  seat: number;
  cardId: string;
}

type ReactionPlay = ReactionCardSpend & { target?: ReactionTarget };
type ChosenShare = ReactionCardSpend & { target: ReactionTarget };

/** 反应窗续结算载荷:挂起点被挂起时,应答齐后按此续跑(全部序列化友好纯数据)。 */
export type ReactionPayload =
  | {
      /** 锦囊宣布被挂起:出牌已扣账,应答齐后无有效识破则照常执行。 */
      kind: "jinnang";
      userSeat: number;
      cardId: string;
      /** executeJinnang 的目标参数(one/two-others=被指定座位;one-city=#1389 中心城
       *  tileIndex;self/all-others=[])。 */
      targets: number[];
    }
  | {
      /** 反识破链环(#571,ADR-0060):被公告的是一张识破诡计,站住则其否定生效。 */
      kind: "counter";
      /** 识破使用者(本环公告者)。 */
      userSeat: number;
      /** 本环打出的反应牌 id(目录唯一 counter=「识破诡计」)。 */
      cardId: string;
      /** 链根:被拆的原锦囊上下文(链终续根结算)。 */
      root: {
        userSeat: number;
        cardId: string;
        targets: number[];
        /** 前序份已由反识破恢复，随根计执行一并宣告。 */
        restoredShare?: true;
      };
      /** 按份或单目标计的既定对象。多目标整计沿用根计的目标。 */
      target?: ReactionTarget;
      /** 已定案的豁免份集(兄弟链累积;根结算并入 exempt)。 */
      negated: number[];
      /** 本环站住时根锦囊的待遇:true=该份被保住(整计域=作废生效);false=本环已被反(份照常受击/整计恢复)。 */
      protects: boolean;
      /** 待续兄弟链环(各份座位序第一张,牌已随根窗收窗扣账;本链收口后逐环宣布)。 */
      upcoming: ChosenShare[];
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
 *  单点清单);超时由权威侧提交普通 respondReaction 命令（ADR-0017）。
 *  结算中段停相位先例:AwaitingTreasureOwner(落他人城→城主三选)。 */
export interface PendingReaction {
  /** 窗实例号(#284):引擎每次开新窗 +1 的单调序号,跨整局递增,随快照序列化。
   *  房间编排按窗号登记截止时刻，客户端在窗号变化时重开计时。 */
  seq: number;
  /** 挂起点公告(快照 reaction 派生字段直接透出此结构)。 */
  view: ReactionView;
  /** 应答记录(use 与不用都占座;isBot 座位在开窗时即席代答,ADR-0017「bot 持牌即时代答」)。 */
  answers: ReactionAnswer[];
  /** 续结算载荷。 */
  payload: ReactionPayload;
}

// ──────────────────────────── 反应窗(#281,ADR-0017)────────────────────────────

/** 窗种 → 本窗可打的反应牌 effect kind(#1067 声明式映射,单源):识破窗恒 counter、
 *  行军窗恒 ambush。引擎校验(respondReaction expect)、被询问集筛选(settleJinnangPlay/
 *  announceCounterLink/marchTraverse)与 UI 镜像(GameScreen reactPlayable)同读此表,
 *  「识破窗恒 counter/行军窗恒 ambush」的字面量三元全数退役。 */
export const REACTION_EXPECT: Record<ReactionView["kind"], JinnangEffect["kind"]> = {
  jinnang: "counter",
  march: "ambush",
};

// 结算中段停相位先例:AwaitingTreasureOwner(落他人城→城主三选)。挂起点存 pendingReaction
// (公告+应答+续结算载荷,全序列化)→ AwaitingReaction → 应答齐 → 续结算。被询问的
// isBot 座位在开窗同一调用内即席代答(botReactionDecision，按确定性策略应答);
// 人类座位(含托管/看门狗代驾)等 respondReaction 命令——权威侧超时代发的也是这条普通
// 命令。一个反应窗内，被询问座位各应答一次。

/** 单调流水号取号(#284):反应窗实例号写入 PendingReaction.seq，由快照保留上一次编号。 */
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
    g.reactionWindowMsOverride > 0 ? g.reactionWindowMsOverride : REACTION_WINDOW_MS[viewSeed.kind];
  const view: ReactionView = { ...viewSeed, windowMs };
  if (view.kind === "jinnang" && payload.kind === "counter") {
    view.counter = {
      rootCardId: payload.root.cardId,
      rootUserSeat: payload.root.userSeat,
      protects: payload.protects,
    };
  }
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
  emitGameEvent(g, view.userSeat, { kind: "reactionOpened", seq: pr.seq, view });
  autoAnswerBots(g, pr);
  if (g.pendingReaction === pr) g.turnPhase = "AwaitingReaction";
}

/** 反应窗被询问座位集(view 单源:jinnang=queriedBySeat 持识破者全集;march=[城主])。
 *  同式镜像:packages/core/src/room/bot-driver.ts reactionQueriedSeats(传输层,#331 自 room.ts 挪入)、
 *  src/app/controllers/reaction.ts(app 层单源,react-local/online/Banner 消费)——三层注释互指。 */
function reactionQueriedOf(view: ReactionView): number[] {
  return view.kind === "jinnang" ? view.queriedBySeat : [view.ownerSeat];
}

function reactionAllAnswered(pr: PendingReaction): boolean {
  return pr.answers.length >= reactionQueriedOf(pr.view).length;
}

/** bot 即席代答(ADR-0017 §3「bot 持牌即时代答不等满」):被询问的 isBot 座位按策略
 *  即席应答。人类座位(含托管/看门狗代驾)也不在此代答——代驾应答由权威侧驱动链按
 *  同一决策(botReactionDecision,#580 行为单源)代发;超时兜底命令由传输层代发。 */
function autoAnswerBots(g: GameEngine, pr: PendingReaction): void {
  for (const seat of reactionQueriedOf(pr.view)) {
    if (!g.players[seat].isBot) continue;
    const answer = { seat, ...botReactionDecision(g, seat) };
    const error = reactionAnswerError(g, pr, answer);
    if (error !== null) throw new Error(error);
    appendReactionAnswer(g, pr, answer);
  }
}

/** 按座位序定生效牌：整计或单份取首张，按份根窗给每份留首张。 */
function selectedReactionPlays(pr: PendingReaction): ReactionPlay[] {
  const perShare = pr.view.kind === "jinnang" && pr.view.targets.requiresSelection;
  const used = pr.answers.filter((a) => a.use).sort((a, b) => a.seat - b.seat);
  const claimed = new Set<number>();
  const selected = perShare
    ? used.filter(({ target }) => {
        if (target == null) throw new Error("识破窗结算：按份应答缺对象");
        if (claimed.has(target.id)) return false;
        claimed.add(target.id);
        return true;
      })
    : used.slice(0, 1);
  return selected.map(({ seat, cardId, target }) => {
    if (cardId == null) throw new Error("反应窗结算:用牌应答缺 cardId");
    return { seat, cardId, target };
  });
}

/** 应答入账(校验后的唯一写口):占座 + 战报。 */
function appendReactionAnswer(g: GameEngine, pr: PendingReaction, a: ReactionAnswer): void {
  const target = a.target === undefined ? undefined : { kind: a.target.kind, id: a.target.id };
  pr.answers.push({ ...a, target });
  const p = g.players[a.seat];
  const plays = reactionAllAnswered(pr) ? selectedReactionPlays(pr) : null;
  emitGameEvent(g, a.seat, {
    kind: "reactionAnswered",
    use: a.use,
    cardId: a.cardId,
    ...(plays != null ? { spentCards: plays.map(({ seat, cardId }) => ({ seat, cardId })) } : {}),
  });
  g.logEvent(
    "system",
    p.guohao,
    a.use ? `${p.guohao} 反应:打出【${a.cardId}】` : `${p.guohao} 反应:不用`,
    `reactionRespond seat=${p.id} use=${a.use ? 1 : 0} card=${a.cardId ?? "-"} share=${target?.id ?? "-"}`,
  );
  if (plays != null) {
    g.pendingReaction = null; // 续结算可在同一转移中开下一窗。
    for (const play of plays) consumeReactionCard(g, play.seat, play.cardId);
    resolveReactionWindow(g, pr, plays);
  }
}

/** 反应窗应答(#281 公共入口,UI/bot 驱动器/联机/超时代发同走):校验「仅被询问座位、
 *  仅一次、持牌与份合法」后入账;应答齐即续结算。非法应答记警告并返回拒绝原因,不占应答名额。 */
export function respondReaction(
  g: GameEngine,
  seat: number,
  use: boolean,
  cardId?: string,
  target?: ReactionTarget,
): string | void {
  if (!g.assertPhase("AwaitingReaction", "respondReaction")) return "当前没有可应答的反应窗";
  const pr = g.pendingReaction;
  if (pr == null) throw new Error("respondReaction:AwaitingReaction 相位无挂起反应窗(状态机 bug)");
  const answer = { seat, use, cardId, target };
  const error = reactionAnswerError(g, pr, answer);
  if (error !== null) {
    g.warn(error);
    return error;
  }
  appendReactionAnswer(g, pr, answer);
}

function reactionAnswerError(
  g: GameEngine,
  pr: PendingReaction,
  { seat, use, cardId, target }: ReactionAnswer,
): string | null {
  if (!reactionQueriedOf(pr.view).includes(seat))
    return `respondReaction:座位 ${seat} 非本窗被询问者`;
  if (pr.answers.some((a) => a.seat === seat)) return `respondReaction:座位 ${seat} 已应答过本窗`;
  if (use) {
    if (cardId == null || !g.players[seat].jinnangHand.includes(cardId))
      return `respondReaction:座位 ${seat} 手中无牌 ${cardId ?? "-"}`;
    if (jinnangCardOf(cardId).effect.kind !== REACTION_EXPECT[pr.view.kind])
      return `respondReaction:【${cardId}】非本窗可打的反应牌`;
    if (pr.view.kind === "jinnang" && pr.view.targets.requiresSelection) {
      const { kind, ids } = pr.view.targets;
      return target?.kind === kind && ids.includes(target.id)
        ? null
        : `respondReaction:识破【${pr.view.cardId}】须指定合法的${kind === "city" ? "城格" : "座位"}`;
    }
  }
  return target === undefined ? null : "respondReaction:本次应答无需选择对象";
}

/** 反应窗续结算(pr 已离场 pendingReaction):按窗种类分派。识破窗按载荷分支:根窗
 *  (payload.jinnang)=锦囊宣布的拆招,链环窗(payload.counter,#571 ADR-0060)=反识破,
 *  链环经相位窗逐环开问、开窗即返回不加深(「效果内禁同步再派发时机」红线约束的是
 *  effect 帧,窗结算走命令帧,不破);拦检结算(拼点/止步落格)不再询问——续走途经的
 *  「下一座城」是新挂点,不属窗内结算。 */
function resolveReactionWindow(g: GameEngine, pr: PendingReaction, plays: ReactionPlay[]): void {
  if (pr.view.kind === "jinnang") settleCounterWindow(g, pr, plays);
  else settleAmbushWindow(g, pr, plays[0]);
}

/** 识破窗结算分发:根窗与反识破链环窗共用相位(AwaitingReaction),按载荷种类分流。 */
function settleCounterWindow(g: GameEngine, pr: PendingReaction, plays: ReactionPlay[]): void {
  if (pr.view.kind !== "jinnang") throw new Error("识破窗结算:载荷与公告不符(状态机 bug)"); // 零兜底
  if (pr.payload.kind === "jinnang") settleRootCounterWindow(g, pr, plays);
  else if (pr.payload.kind === "counter") settleChainCounterWindow(g, pr, plays);
  else throw new Error("识破窗结算:march 载荷挂 jinnang 窗(状态机 bug)"); // 零兜底
}

/** 宣布座位按城主或直接受影响的座位确定。城份均为有主受击城。 */
export function reactionTargetSeat(g: GameEngine, { kind, id }: ReactionTarget): number {
  if (kind === "seat") return id;
  const propertyId = tileAtIndex(g.board, id).propertyId;
  if (propertyId == null) throw new Error(`反应窗城格 ${id} 无城`);
  const owner = g.findOwner(propertyId);
  if (owner == null) throw new Error(`反应窗城份 ${propertyId} 无主`);
  return g.players.indexOf(owner);
}

/** 反识破链环宣布(#571,ADR-0060):牌已随应答收窗扣账,此处只公开宣布——走
 *  JinnangAnnounced 时机(公开事件+出牌线,与根锦囊同口),持识破者(本环打出者除外,
 *  含链根使用者救计)开下一环询问窗;无人可反不开窗,本环立即站住(#281「不开窗直接
 *  结算」同口径)。protects=本环站住时争夺份的待遇:根窗首环恒 true(保住);链环窗
 *  逐环翻转(反识破站住=上一环作废=该份恢复受击)。
 *  时机 ctx.targetSeats 语义=受影响座位(与根宣布同口径):城指向域(#1389)争夺份=城,
 *  映射为城主座位;席位域照旧=份座位本身。 */
function announceCounterLink(
  g: GameEngine,
  seat: number,
  cardId: string,
  target: ReactionTarget | undefined,
  root: Extract<ReactionPayload, { kind: "counter" }>["root"],
  negated: number[],
  upcoming: Extract<ReactionPayload, { kind: "counter" }>["upcoming"],
  protects: boolean,
): void {
  const responder = g.players[seat];
  const shareAudit =
    target === undefined
      ? ""
      : ` share=${target.kind === "city" ? `tile#${target.id}` : g.players[target.id].id}`;
  // 打出宣告走 JinnangAnnounced 时机产事件(fx 面出牌线+文案浮字,#719 死写删除)
  g.logEvent(
    "system",
    responder.guohao,
    `${responder.guohao} 打出【${cardId}】,欲拆 ${g.players[root.userSeat].guohao} 的【${root.cardId}】`,
    `reactionCounterAnnounce by=${responder.id} root=${root.cardId}${shareAudit}`,
  );
  g.dispatchMoment("JinnangAnnounced", {
    subject: seat,
    cardId,
    targetSeats: target === undefined ? [] : [reactionTargetSeat(g, target)],
  }); // 时机·JinnangAnnounced:识破宣布(链环与根同口,事件流公开)
  const payload: ReactionPayload = {
    kind: "counter",
    userSeat: seat,
    cardId,
    root: { ...root, targets: [...root.targets] },
    negated: [...negated],
    protects,
    upcoming: upcoming.map((u) => ({ ...u })),
    ...(target === undefined ? {} : { target }),
  };
  const queried = g
    .alivePlayers()
    .map((p) => g.players.indexOf(p))
    .filter(
      (s) =>
        s !== seat &&
        g.players[s].jinnangHand.some(
          (id) => jinnangCardOf(id).effect.kind === REACTION_EXPECT.jinnang,
        ),
    );
  if (queried.length === 0) {
    settleCounterStands(g, payload);
    return;
  }
  const view: ReactionViewSeed = {
    kind: "jinnang",
    cardId,
    userSeat: seat,
    targets: {
      kind: target === undefined ? "seat" : target.kind,
      ids: target === undefined ? [...root.targets] : [target.id],
      requiresSelection: false,
    },
    queriedBySeat: queried,
  };
  openReactionWindow(g, view, payload); // bot 全代答时窗在开窗调用内即席结算
}

/** 识破根窗结算(#281 结算面 + #571 链化):座位序逐张生效,每份/整计的座位序第一张从
 *  「直接生效」改为宣布进反识破链;同窗同份其余原样退回手牌不消耗;无有效识破则照常
 *  执行被公告锦囊。链环牌随本窗收窗即扣账(应答=打出;兄弟环先扣防双耗,被反也不回手)。 */
function settleRootCounterWindow(g: GameEngine, pr: PendingReaction, plays: ReactionPlay[]): void {
  const payload = pr.payload;
  if (payload.kind !== "jinnang") throw new Error("识破根窗结算:载荷不符(状态机 bug)"); // 零兜底
  const user = g.players[payload.userSeat];
  const def = jinnangCardOf(payload.cardId);
  const [first, ...upcoming] = plays;
  if (first == null) {
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
    case "two-others":
      // 连环计的缺角由链终裁决：站住即全计作废，被反即恢复。
      announceCounterLink(g, first.seat, first.cardId, undefined, root, [], [], true);
      returnSupersededCounters(g, pr, plays, def.id);
      return;
    case "all-others":
    case "one-city": {
      // 每份座位序第一张进各自的反识破链，同份其余退回。
      returnSupersededCounters(g, pr, plays, def.id);
      const shares = upcoming.map(({ seat, cardId, target }) => {
        if (target === undefined) throw new Error("识破窗结算：待续的反识破链缺争夺对象");
        return { seat, cardId, target };
      });
      announceCounterLink(g, first.seat, first.cardId, first.target, root, [], shares, true);
      return;
    }
    case "one":
    case "self": {
      // 单份计(self 的份=使用者自身):座位序第一张进链,整计落空在链终裁决;其余退回
      const id = def.targetDomain === "self" ? payload.userSeat : payload.targets[0];
      announceCounterLink(g, first.seat, first.cardId, { kind: "seat", id }, root, [], [], true);
      returnSupersededCounters(g, pr, plays, def.id);
      return;
    }
    case "reaction":
      // 根窗不挂反应牌:反应牌不经出牌阶段/出牌通道,链环窗走 payload.counter(状态机 bug)
      throw new Error(`识破根窗挂起了反应牌【${def.id}】(状态机 bug)`);
  }
}

/** 反识破链环窗结算(#571,ADR-0060):座位序第一张反识破生效=本环识破作废(已扣账
 *  不回手,事件落账),进下一环;同窗其余退回;无有效反识破则本环站住,链终裁定
 *  根锦囊待遇。 */
function settleChainCounterWindow(g: GameEngine, pr: PendingReaction, plays: ReactionPlay[]): void {
  const payload = pr.payload;
  if (payload.kind !== "counter") throw new Error("反识破链环结算:载荷不符(状态机 bug)"); // 零兜底
  const [first] = plays;
  if (first == null) {
    settleCounterStands(g, payload);
    return;
  }
  returnSupersededCounters(g, pr, plays, payload.cardId);
  const rescuer = g.players[first.seat];
  const announcer = g.players[payload.userSeat];
  // 反识破生效宣告走 jinnangVoided 事件(fx 面文案浮字,#719 死写删除)
  g.logEvent(
    "system",
    rescuer.guohao,
    `${rescuer.guohao} 反识破,${announcer.guohao} 的【${payload.cardId}】作废`,
    `reactionCounterVoid card=${payload.cardId} by=${rescuer.id} on=${announcer.id}`,
  );
  emitGameEvent(g, first.seat, {
    kind: "jinnangVoided",
    cardId: payload.cardId,
    result: { kind: "counter", userSeat: payload.userSeat },
  }); // 本环拆除的是识破，根计的争夺份随下一环公告。
  announceCounterLink(
    g,
    first.seat,
    first.cardId,
    payload.target,
    payload.root,
    payload.negated,
    payload.upcoming,
    !payload.protects, // 站住待遇逐环翻转:反识破站住=上一环作废=该份恢复受击
  );
}

/** 反识破链环站住(#571,ADR-0060):站住识破的否定生效——整计域(连环计/单份计)
 *  protects=true 时整计落空或该份入豁免集。兄弟链未清则续开下一环，
 *  恢复判词随根计实际执行发出。 */
function settleCounterStands(
  g: GameEngine,
  payload: Extract<ReactionPayload, { kind: "counter" }>,
): void {
  const root = payload.root;
  const rootDef = jinnangCardOf(root.cardId);
  const responderSeat = payload.userSeat;
  const responder = g.players[responderSeat];
  const perShare = rootDef.targetDomain === "all-others" || rootDef.targetDomain === "one-city";
  const target = payload.target;
  if (!perShare && payload.protects) {
    // 整计域:识破站住=作废(连环计缺角)/落空(单份计),终局(宣告走 jinnangVoided 事件,fx 面文案浮字)
    const verdict = rootDef.targetDomain === "two-others" ? "voided" : "failed";
    const detail =
      verdict === "voided"
        ? `reactionCounter card=${rootDef.id} by=${responder.id} voided=all`
        : `reactionCounter card=${rootDef.id} by=${responder.id} share=${g.players[target!.id].id}`;
    g.logEvent(
      "system",
      responder.guohao,
      `${responder.guohao} 识破【${rootDef.id}】,此计${verdict === "voided" ? "作废" : "落空"}`,
      detail,
    );
    emitGameEvent(g, responderSeat, {
      kind: "jinnangVoided",
      cardId: rootDef.id,
      result: { kind: "whole", userSeat: root.userSeat, verdict },
    });
    g.settleJinnangExit();
    return;
  }
  const negated = [...payload.negated];
  if (payload.protects) {
    if (target === undefined) throw new Error("识破窗结算：按份识破缺争夺对象");
    const isCityShare = target.kind === "city";
    const shareLabel = isCityShare
      ? `「${tileAtIndex(g.board, target.id).name}」`
      : `${g.players[target.id].guohao} `;
    const shareAudit = isCityShare ? `tile#${target.id}` : g.players[target.id].id;
    g.logEvent(
      "system",
      responder.guohao,
      `${responder.guohao} 识破【${rootDef.id}】,${shareLabel}${isCityShare ? "这一城免烧" : "那一份失效"}`,
      `reactionCounter card=${rootDef.id} by=${responder.id} share=${shareAudit}`,
    );
    emitGameEvent(g, responderSeat, {
      kind: "jinnangVoided",
      cardId: rootDef.id,
      result: { kind: "share", target },
    });
    negated.push(target.id);
  }
  const restored = !payload.protects || root.restoredShare === true;
  if (payload.upcoming.length > 0) {
    const next = payload.upcoming[0]!;
    announceCounterLink(
      g,
      next.seat,
      next.cardId,
      next.target,
      restored ? { ...root, restoredShare: true } : root,
      negated,
      payload.upcoming.slice(1),
      true,
    );
    return;
  }
  if (restored) emitGameEvent(g, root.userSeat, { kind: "jinnangRestored", cardId: rootDef.id });
  g.executeJinnang(
    g.players[root.userSeat],
    root.userSeat,
    rootDef,
    root.targets,
    perShare ? new Set(negated) : undefined,
  );
  g.settleJinnangExit();
}

/** 同窗被顶替的识破原样退回不消耗(#281):牌从未离手,只留战报痕。 */
function returnSupersededCounters(
  g: GameEngine,
  pr: PendingReaction,
  selected: readonly ReactionPlay[],
  cardId: string,
): void {
  const superseded = pr.answers
    .filter((a) => a.use && !selected.some((play) => play.seat === a.seat))
    .sort((a, b) => a.seat - b.seat);
  for (const play of superseded) {
    const p = g.players[play.seat];
    g.logEvent(
      "system",
      p.guohao,
      `${p.guohao} 的【${cardId}】无用武之地,原样收回`,
      `reactionCounterReturn seat=${p.id} card=${cardId}`,
    );
  }
}

/** 结算已生效的反应牌，扣除手牌并放入弃牌堆。 */
function consumeReactionCard(g: GameEngine, seat: number, cardId: string): void {
  const p = g.players[seat];
  p.jinnangHand.splice(p.jinnangHand.indexOf(cardId), 1);
  p.jinnangHandCount = p.jinnangHand.length;
  g.jinnangDiscard.push(cardId);
}

/** 拦检窗结算:城主用牌 → 与行人拼点(公共结算,与连环计共用);胜=行人止步拦检城、
 *  照常落格结算(可能被交涉);平/负=牌白耗,行人续走。拦检结算内不再询问;续走
 *  途经的下一城是新挂点,不属窗内结算(深呼吸约束,#281)。 */
function settleAmbushWindow(g: GameEngine, pr: PendingReaction, play?: ReactionPlay): void {
  if (pr.view.kind !== "march" || pr.payload.kind !== "march")
    throw new Error("拦检窗结算:载荷与公告不符(状态机 bug)"); // 零兜底
  const payload = pr.payload;
  if (play == null) {
    resumeMarch(g, payload); // 不用/超时代发:续走
    return;
  }
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
    // 拦停成功:行人止步拦检城(宣告=拼点签面胜者+止步落格 marchArrived,文字浮字不另发,#719)
    g.logEvent(
      "system",
      owner.guohao,
      `${owner.guohao} 拦检成功,${mover.guohao} 止步于此城`,
      `reactionAmbushStop owner=${owner.id} mover=${mover.id} tile=#${payload.tileIndex}`,
    );
    settleAmbushStop(g, payload);
    return;
  }
  // 平/负:拦检失败,牌白耗(已扣),行人照常续走(宣告走 reactionFailed 事件,fx 面锚事发现场浮字)
  emitGameEvent(g, play.seat, {
    kind: "reactionFailed",
    windowKind: "march",
    tileIndex: payload.tileIndex,
    aRoll: duel.aRoll,
    bRoll: duel.bRoll,
  }); // 事件流(#385):拦检失败宣告(浮字不带点数括注——点数只在拼点签面,ADR-0030)
  g.logEvent(
    "system",
    owner.guohao,
    `${owner.guohao} 拦检失败(平局/落败),【半路杀出】白耗`,
    `reactionAmbushFail owner=${owner.id} mover=${mover.id} winner=${duel.winnerSeat == null ? "tie" : g.players[duel.winnerSeat].id}`,
  );
  resumeMarch(g, payload);
}

/** 拦停落格:行人止步拦检城、照常结算该城(可能进入珍宝交涉)。lastMove 截断到
 *  拦检城(行军动画只走此)。 */
function settleAmbushStop(
  g: GameEngine,
  payload: Extract<ReactionPayload, { kind: "march" }>,
): void {
  const mover = g.players[payload.moverSeat];
  g.lastMove = g.board.computePath(payload.fromPos, payload.stepsToTile, mover.capitalIndex);
  g.settleMarchLanding(mover, payload.tileIndex);
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

/** 每轮拼点结算。各席按自身骰面掷一次，公开全部点数；终局拼点由系统发起。 */
export function resolveDuelRound(
  g: GameEngine,
  seats: readonly number[],
  initiator: number | null,
) {
  const sides = seats.map((seat) => ({ seat, roll: g.dice.rollDie(heroDieFaces(g, seat)) }));
  const highestRoll = Math.max(...sides.map(({ roll }) => roll));
  const leadingSeats = sides.filter(({ roll }) => roll === highestRoll).map(({ seat }) => seat);
  const winnerSeat = leadingSeats.length === 1 ? leadingSeats[0] : null;
  emitGameEvent(g, initiator, { kind: "duelResolved", sides, winnerSeat });
  return { sides, leadingSeats, winnerSeat };
}

/** 连环计与拦检各拼一轮，按各自规则消费点数和平局；拼点不派行军掷骰时机。 */
export function resolveDuel(
  g: GameEngine,
  aSeat: number,
  bSeat: number,
): { aRoll: number; bRoll: number; winnerSeat: number | null } {
  const { sides, winnerSeat } = resolveDuelRound(g, [aSeat, bSeat], aSeat);
  return { aRoll: sides[0].roll, bRoll: sides[1].roll, winnerSeat };
}
