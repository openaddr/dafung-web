// 事件批 → 表现事件 提取器(#385,ADR-0020 折叠切换③):演出因果的单一消费通路。
// 引擎每次状态转移产出类型化 GameEvent 批(词汇表 src/core/game-events.ts);本模块把
// 一批事件直译为 PresentationEvent[](kind+seat+reason+领域字段 → 骰子/行军/浮字/出牌线/
// 印章/音效/城池宣告/横幅),单机(engine.gameEvents)与联机(netStore lastEvents)共用
// 同一函数——diff 启发式随本模块落地退役(lastJinnangPlay 留痕旁路已随 #412 移除)。
//
// 坐标口径:提取期将事件指定的棋盘格或玩家当前位置换算为逻辑坐标;行军/印章/落格
// 脉冲的播放几何同样在提取拍算死(不变量①提取即定格,
// ADR-0029/#608:tokenMoved 全烤 keyframes、印章与落格脉冲自带坐标),播放期零读
// 可变引擎态。行军路径(#385):marchArrived/capitalHalt 事件
// 自带 MovePath 摘要,marchEvent 按事件内路径播——合并批(联机单 tick 多转移)多段
// 行军各播各段,不再依赖引擎 lastMove 单槽;反应窗续走的余段用转移前位置(prePositions)
// 截短——与单机 remainingMarchPath 同一公式;对不上的路径不播动画、不做 diff 重建。
import type { GameEngine } from "@dafung/core/engine/authority";
import type { GameEvent, GameEventBody } from "@dafung/core/engine/game-events";
import type { MovePath } from "@dafung/core/engine/board";
import { tileIndexOfProperty } from "@dafung/core/engine/board";
import type { CityDamageImpact, CityRewardReceipt } from "@dafung/core/engine/city-damage";
import { INITIAL_CITY_LEVEL } from "@dafung/core/engine/constants";
import type { Player } from "@dafung/core/engine/model";
import { findHolding } from "@dafung/core/engine/player";
import { jinnangCardOf } from "@dafung/core/engine/jinnang";
import { skillById } from "@dafung/core/engine/skills";
import { SKILL_BOOK_ID_PREFIX } from "@dafung/core/engine/treasures";
import {
  activeSkillDefOf,
  eventSeat,
  eventSeatPlayer,
  heroDefOf,
  type AnnounceCursor,
  type FxPresentedKind,
} from "@dafung/core/engine/event-tiers";
import { tokenSlotOffset } from "@app/components/board/tokenSlots";
import { stageCapitalRecruitment } from "./capital-supply-audio";
import { openMarchBatch } from "./useMarch";
import { remainingMarchPath } from "./orchestrator";
import type { SoundEvent } from "./sound-clips";
import type {
  CapitalRecruitmentCue,
  CashArrivalCue,
  CashPresentationEvent,
  CityDamageSound,
  DuelSide,
  FxSink,
  MarchSegmentFrames,
  PresentationEvent,
  PropertyChangedEvent,
  SealSound,
} from "./presentation";

/** 跨批宣布游标(形状单源 core/event-tiers AnnounceCursor,#430 票项 3):最近一次锦囊
 *  宣布(识破线指回被拆计的使用者/目标用——jinnangVoided 不带被拆方座位,ReactionAnswered
 *  亦无指向;反应窗「宣布批 → 应答批」跨批因果由此衔接)。
 *  生命周期 = 引擎实例(一局一实例):WeakMap 键控注册表让换局/换图天然拿到全新游标,
 *  无需任何手工 reset 配对(reset 忘调类 bug 结构性消失);旧模块级 let 与
 *  resetEventExtractCursors 的手工配对已退役,游标在提取链内显式对象传递。 */
interface ExtractCursors {
  lastAnnounce: AnnounceCursor | null;
  /** 归账音按末尾一拨持城收益的轮次跨批续接。 */
  cityIncome: { round: number; cue: CashArrivalCue } | null;
  cityRewards: Map<string, CashArrivalCue>;
  /** 已抵达的入账按这一张牌去重，演出作废时仍保留它的身份。 */
  fireWallReward: { castSeq: number; cue: CashArrivalCue } | null;
}

const cursorsByEngine = new WeakMap<GameEngine, ExtractCursors>();

function cursorsOf(engine: GameEngine): ExtractCursors {
  let cursors = cursorsByEngine.get(engine);
  if (cursors == null) {
    cursors = {
      lastAnnounce: null,
      cityIncome: null,
      cityRewards: new Map(),
      fireWallReward: null,
    };
    cursorsByEngine.set(engine, cursors);
  }
  return cursors;
}

export function discardCityRewardCues(engine: GameEngine): void {
  const cursors = cursorsByEngine.get(engine);
  if (cursors === undefined) return;
  cursors.cityRewards.clear();
}

export function cityIncomeCueFor(engine: GameEngine, round: number): CashArrivalCue | undefined {
  const income = cursorsByEngine.get(engine)?.cityIncome;
  return income?.round === round ? income.cue : undefined;
}

const CITY_DAMAGE_SOUND: Record<CityDamageImpact, CityDamageSound> = {
  hit: "cityHit",
  capitalBreached: "cityBreach",
  demolished: "cityBreach",
  conquest: "cityConquest",
};

// ─────────────────────── 取数辅助(契约违反当场炸出,零兜底) ───────────────────────
// 行动者座位校验单源 core/event-tiers(eventSeat);名将和主动技目录回查同用 heroDefOf 与 activeSkillDefOf。
function guohaoOf(engine: GameEngine, seat: number): string {
  return engine.players[seat].guohao;
}

/** 玩家锚点(逻辑坐标):当前格。 */
function playerAnchor(engine: GameEngine, seat: number): { x: number; y: number; atTile: number } {
  const p = engine.players[seat];
  const board = engine.board;
  const pos = board.positionOf(p.position);
  return { x: pos.x, y: pos.y, atTile: p.position };
}

/** propertyId → 棋盘格(单源 core/board tileIndexOfProperty,城不在棋盘=数据 bug 炸出)。 */
function tileOfProperty(engine: GameEngine, propertyId: string): number {
  return tileIndexOfProperty(engine.board, propertyId);
}

/** 拼点线演出件(C10 收口):jinnangPlayed 的「施计者→目标」单段线——识破拆计
 *  (jinnangVoided)与半路杀出(reactionAnswered)两 case 曾逐字双抄。 */
function jinnangLine(
  engine: GameEngine,
  seat: number,
  target: number,
  cardId: string,
): PresentationEvent {
  const from = engine.board.positionOf(engine.players[seat].position);
  const to = engine.board.positionOf(engine.players[target].position);
  return {
    kind: "jinnangPlayed",
    playerId: engine.players[seat].id,
    cardId,
    lines: [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }],
  };
}

/** 城池宣告事件(ADR-0015):归属色/等级按提取时刻引擎态解析(建城/购地=Lv1 新归属、
 *  扩军=新等级、变卖回无主=无归属;引擎态即权威,不需要事件另带)。 */
function propertyChangedEvent(
  engine: GameEngine,
  propertyId: string,
  dims: { levelChanged: boolean; ownerChanged: boolean },
): PropertyChangedEvent {
  const tileIndex = tileOfProperty(engine, propertyId);
  let ownerColorIndex: number | null = null;
  let level: number | null = null;
  for (const p of engine.players) {
    const h = findHolding(p, propertyId);
    if (h != null) {
      ownerColorIndex = p.colorIndex;
      level = h.level;
      break;
    }
  }
  return {
    kind: "propertyChanged",
    tileIndex,
    level,
    ownerColorIndex,
    ...dims,
  };
}

// 名将/主动技目录回查单源 core/event-tiers(heroDefOf/activeSkillDefOf);旧本地
// heroNameOf 的 `?? heroId` 兜底随单源化退役——名将查无是数据 bug,炸出不静默。
function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
}

/** 浮字事件(文案类,锚玩家位置)。 */
function textFloater(
  engine: GameEngine,
  seat: number,
  text: string,
  sound?: SoundEvent,
): Extract<PresentationEvent, { kind: "textFloat" }> {
  return {
    kind: "textFloat",
    playerId: engine.players[seat].id,
    text,
    ...(sound !== undefined && { sound }),
    ...playerAnchor(engine, seat),
  };
}

/** 浮字事件(文案类,锚指定格——拦检失败等锚事发现场的文案,不锚玩家自身)。 */
function textFloaterAtTile(engine: GameEngine, seat: number, text: string, tileIndex: number) {
  const pos = engine.board.positionOf(tileIndex);
  return {
    kind: "textFloat" as const,
    playerId: engine.players[seat].id,
    text,
    x: pos.x,
    y: pos.y,
    atTile: tileIndex,
  };
}

/** propertyId → 城名(数据 bug 当场炸出,零兜底)。 */
function tileNameOfProperty(engine: GameEngine, propertyId: string): string {
  return engine.board.at(tileOfProperty(engine, propertyId)).name;
}

/** 金钱浮字与音效共用金额来源。都城补给附铜钱雨。 */
function cashFloater(
  engine: GameEngine,
  seat: number,
  delta: number,
  supply: boolean,
  sound?: CashPresentationEvent["sound"],
): CashPresentationEvent {
  return {
    kind: supply ? "supplyRain" : "cashDelta",
    playerId: engine.players[seat].id,
    amount: delta,
    ...playerAnchor(engine, seat),
    ...(sound === undefined ? {} : { sound }),
  };
}

function cashChangeSound(
  ev: Extract<GameEvent, { kind: "cashChanged" }>,
  cursors: ExtractCursors,
): CashPresentationEvent["sound"] {
  // 横征的收款方是一笔汇总，没有单个 counterpartSeat。连环计的国库款另行归账。
  const transfer = ev.counterpartSeat !== undefined || ev.reason === "levyAll";
  if (ev.delta === 0) return undefined;
  if (ev.delta < 0) return transfer ? undefined : "pay";
  if (ev.cityReward !== undefined)
    return ev.cityReward.fireWall === undefined
      ? cityRewardCue(ev.cityReward, cursors)
      : fireWallRewardCue(cursors, ev.cityReward.fireWall.castSeq);
  if (ev.reason !== "city-income") return { event: transfer ? "cashTransfer" : "coin" };
  // 轮末可挂起等待技能抉择，后续分发批沿用同一轮的结算声音。
  if (cursors.cityIncome?.round !== ev.round) {
    cursors.cityIncome = { round: ev.round, cue: { event: "coin" } };
  }
  return cursors.cityIncome.cue;
}

function capitalRecruitmentCue(
  events: readonly GameEvent[],
  supply: GameEvent,
  gameId: string,
  playerId: string,
): CapitalRecruitmentCue | undefined {
  const recruits = events.some(
    (ev) =>
      ev.kind === "landingResolved" &&
      ev.outcome.kind === "OwnProperty" &&
      ev.turnPhase === "AwaitingHeroPick" &&
      ev.seat === supply.seat &&
      ev.turn === supply.turn,
  );
  return recruits ? { gameId, turn: supply.turn, playerId } : undefined;
}

function fireWallRewardCue(cursors: ExtractCursors, castSeq: number): CashArrivalCue {
  if (cursors.fireWallReward?.castSeq !== castSeq)
    cursors.fireWallReward = { castSeq, cue: { event: "coin" } };
  return cursors.fireWallReward.cue;
}

function cityRewardCue(reward: CityRewardReceipt, cursors: ExtractCursors): CashArrivalCue {
  let cue = cursors.cityRewards.get(reward.propertyId);
  if (cue === undefined) {
    cue = { event: "coin" };
    cursors.cityRewards.set(reward.propertyId, cue);
  }
  return cue;
}

function treasureGainKey(event: GameEvent, seat: number | null, treasureId: string): string {
  return `${event.round}/${event.turn}/${seat}/${treasureId}`;
}

/** 窃取和交割都先派得宝。合并批可能出现同书重复入册，只给转移前最近一次得宝定声。 */
function treasureTransferSounds(events: readonly GameEvent[]) {
  const latestGains = new Map<string, GameEvent>();
  const sounds = new Map<GameEvent, "treasureStolen" | null>();
  for (const event of events) {
    if (event.kind === "treasureGained") {
      latestGains.set(treasureGainKey(event, event.seat, event.treasureId), event);
      continue;
    }
    if (event.kind !== "treasureStolen" && event.kind !== "treasureTraded") continue;
    const seat = event.kind === "treasureStolen" ? event.seat : event.buyerSeat;
    const key = treasureGainKey(event, seat, event.treasureId);
    const gain = latestGains.get(key);
    if (gain !== undefined) {
      sounds.set(gain, event.kind === "treasureStolen" ? "treasureStolen" : null);
      latestGains.delete(key);
    }
  }
  return sounds;
}

/** 都城停全屏宣告事件(S7 #513):国号/座色/都城名按提取时刻引擎态解析。 */
function haltBannerEvent(engine: GameEngine, seat: number, tileIndex: number): PresentationEvent {
  const p = engine.players[seat];
  return {
    kind: "haltBanner",
    playerId: p.id,
    guohao: p.guohao,
    colorIndex: p.colorIndex,
    cityName: engine.board.at(tileIndex).name,
  };
}

/** 印章事件(印章坐标全坐标化,#608 不变量①):格中心在提取期换算进事件,sink
 *  零引擎读取;tileIndex 仅留语义。tone 缺省=朱砂(字面量省略,联合形状不掺 undefined)。 */
function sealEvent(
  engine: GameEngine,
  tileIndex: number,
  char: string,
  tone?: "gold",
  sound?: SealSound,
): PresentationEvent {
  const pos = engine.board.positionOf(tileIndex);
  return {
    kind: "sealStamped",
    tileIndex,
    x: pos.x,
    y: pos.y,
    char,
    ...(tone === undefined ? {} : { tone }),
    ...(sound === undefined ? {} : { sound }),
  };
}

// ─────────────────────── 行军路径解析 ───────────────────────
/** 提取拍烤制行军逐帧坐标(不变量①提取即定格,ADR-0029/#608):整条行走序列在此
 *  算死——每段「起点中心 → 终点」的坐标数组(#928/ADR-0044 驿道恒直线,无途经点)
 *  + 驿道流光折线,播放器纯哑渲染、零读引擎。槽位偏移按批终占用算,公式与 TokenLayer
 *  声明式分组同源(tokenSlots 单源)。只烤几何不烤时长——段时长由 useMarch 按
 *  timings.MARCH 现算(保 scStage 缩放)。isLast 以批终落位为准(批内近似,ADR-0029
 *  §1 绊线:同座位批内多段位移机制化时须重审)——中间段不止槽,相邻段起终点严丝合缝。 */
function bakeMarchKeyframes(
  engine: GameEngine,
  player: Player,
  remainder: MovePath,
): MarchSegmentFrames[] {
  const board = engine.board;
  const slot = tokenSlotOffset(engine.players, player);
  const segments: MarchSegmentFrames[] = [];
  let prev = remainder.from;
  for (const tile of remainder.traversed) {
    const isLast = tile === player.position;
    const center = board.positionOf(tile);
    const end = isLast ? { x: center.x + slot.x, y: center.y + slot.y } : center;
    segments.push({
      points: [board.positionOf(prev), end],
      flow: [board.positionOf(prev), center],
    });
    prev = tile;
    if (isLast) break;
  }
  return segments;
}

/** marchArrived/capitalHalt → tokenMoved(路径取自事件自带 MovePath,#385 不再依赖
 *  引擎 lastMove 单槽——合并批多段行军各播各段;几何在提取拍烤成 keyframes,
 *  ADR-0029 不变量①):
 *  - 主路落点与事件落点对不上:不播动画(棋子由快照终态落位,不做位置 diff 重建);
 *  - 转移前位置(prePosition)已是事件落点:无余段不播;在路径中段=反应窗挂起后续走:
 *    截短为余段(不拽回起点重走,与单机 remainingMarchPath 同公式);pre=路径起点=整段照走;
 *  - pre 不在路径上:无法安全播(陈旧路径),不播。 */
function marchEvent(
  engine: GameEngine,
  seat: number,
  ev: { tileIndex: number; path: MovePath },
  prePosition: number | null,
): PresentationEvent | null {
  const player = engine.players[seat];
  const path = ev.path;
  if (path.landIndex !== ev.tileIndex) return null; // 对不上:不播动画,不重建 diff
  // 落点比较用事件自带字段(#597 Q3 零成本修正:旧实现取批终 player.position)
  if (prePosition == null || prePosition === ev.tileIndex) return null;
  const onPath = path.from === prePosition || path.traversed.includes(prePosition);
  if (!onPath) return null;
  const remainder = remainingMarchPath(path, prePosition, ev.tileIndex);
  if (remainder == null) return null; // 挂起点即落点:无余段可播
  return {
    kind: "tokenMoved",
    playerId: player.id,
    keyframes: bakeMarchKeyframes(engine, player, remainder),
  };
}

/** 行军落位表现(落格 marchArrived / 驻跸 capitalHalt 共用):行军动画 +
 *  驻跸印章与文案。驻跸两态(途经必停 / 恰落己都城)按规则都结算驻跸补给,凡
 *  落点=己都城即盖「驻」章出文案(恰落态无 capitalHalt 事件,由落点字段直读);
 *  补给铜钱雨由随后的 cashChanged(reason="supply") 事件自产,压轴。
 *  announce(S7):插在行军与驻章之间的全屏宣告(都城停横幅),present 串行 await
 *  时序=行军 → 宣告 → 驻章。 */
function arrivalPresentation(
  engine: GameEngine,
  seat: number,
  ev: { tileIndex: number; path: MovePath },
  prePosition: number | null,
  halted: boolean,
  passedCityDraws: readonly PresentationEvent[],
  announce?: PresentationEvent,
): PresentationEvent[] {
  const out: PresentationEvent[] = [];
  const march = marchEvent(engine, seat, ev, prePosition);
  if (march) out.push(march);
  out.push(...passedCityDraws);
  if (announce) out.push(announce);
  // 恰落己都城与路过必停共用驻章。门闩随驻跸条带，补给声随实际回体或银两抵达。
  if (halted || ev.tileIndex === engine.players[seat].capitalIndex) {
    out.push(sealEvent(engine, ev.tileIndex, "驻", undefined, null));
    out.push(textFloater(engine, seat, "驻跸补给"));
  }
  return out;
}

/** 识破线目标座位:jinnangVoided 带份(shareSeat)指份;不带份按牌域查宣布游标——
 *  连环计/self 指被拆计使用者,one 指原定目标(=宣布时 targetSeats 首位)。游标由
 *  提取链显式传递(生命周期=引擎实例,见文件头)。 */
function voidLineTarget(
  ev: Extract<GameEvent, { kind: "jinnangVoided" }>,
  cursors: ExtractCursors,
): number | null {
  if (ev.shareSeat != null) return ev.shareSeat;
  const announce = cursors.lastAnnounce;
  if (announce == null || announce.cardId !== ev.cardId) return null;
  const domain = jinnangCardOf(ev.cardId).targetDomain;
  if (domain === "one") return announce.targetSeats[0] ?? null;
  return announce.userSeat; // two-others(全计作废)与 self(落空)都指使用者
}

/** 耗竭宣告使用归零一击的来源、降级和失城清单，城名按棋盘查得。 */
function exhaustionTextOf(
  engine: GameEngine,
  ev: Extract<GameEvent, { kind: "exhaustionResolved" }>,
): string {
  const source = ev.sourceSeat === null ? "无" : guohaoOf(engine, ev.sourceSeat);
  const cities = [
    ...ev.downgradedPropertyIds.map((id) => `「${tileNameOfProperty(engine, id)}」降 1 级`),
    ...ev.lostPropertyIds.map((id) => `「${tileNameOfProperty(engine, id)}」失守`),
  ];
  const damage = cities.length > 0 ? `，外敌乘虚而入，${cities.join("、")}` : "";
  return `体力耗竭（伤害来源：${source}）${damage}，卧床休整两回合`;
}

/** 只让当前出牌或主动技的即时结果接声。合并下行的下一动作不抢本动作的宣布。 */
function hasImmediateResolution(
  events: readonly GameEvent[],
  announceIndex: number,
  selfSeat: number | null,
): boolean {
  for (let i = announceIndex + 1; i < events.length; i++) {
    const ev = events[i];
    switch (ev.kind) {
      case "jinnangAnnounced":
        // 识破链属于当前结算。开窗后若同批已有结果，公布判词声就够。
        if (jinnangCardOf(ev.cardId).effect.kind !== "counter") return false;
        break;
      case "heroSkillActivated":
      case "jinnangPhaseResumed":
      case "diceRolled":
      case "turnEnded":
      case "turnStarted":
        return false;
      case "jinnangVoided":
        if (jinnangCardOf(ev.cardId).effect.kind !== "counter") return true;
        break;
      case "jinnangRestored":
      case "duelResolved":
      case "propertyDamaged":
      case "heroRecruited":
      case "treasureGained":
      case "treasureStolen":
        return true;
      case "cashChanged":
      case "staminaChanged":
        if (ev.delta !== 0) return true;
        break;
      case "peekApplied":
        // 窥方听翻页承接同拍公开宣布；他座仍可听到宣布。
        if (ev.viewerSeat === selfSeat) return true;
        break;
    }
  }
  return false;
}

// ─────────────────────── 主提取 ───────────────────────
/** 合并批里最后一个实际开始的回合。 */
export function lastTurnStartIndex(events: readonly GameEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "turnStarted") return i;
  return -1;
}

/**
 * 事件批 → 表现事件(单机/联机共用;数组顺序=播放顺序)。
 * @param engine       推进后的引擎(单机=本地权威;联机=快照 hydrate 后的只读引擎),
 *                     提供坐标解析/lastMove 路径/座位表
 * @param events       本转移(或合并 tick)的事件批(词汇表 core/game-events.ts)
 * @param prePositions 转移前各座位棋子位置(行军余段截短基准;null=未知;缺省=全未知)
 * @param selfSeat     当前客户端座位；无本座时只提取公开表现
 */
export function extractBatchEvents(
  engine: GameEngine,
  events: readonly GameEvent[],
  prePositions?: ReadonlyArray<number | null>,
  selfSeat: number | null = null,
): PresentationEvent[] {
  // 批内预处理:横幅只在最后一个 turnStarted 弹(联机合并 tick 多回合链接时只报终态,
  // 与旧快照级横幅去重同观感;单机批恒 ≤1 个 turnStarted,不受影响)。
  const lastTurnStartIdx = lastTurnStartIndex(events);
  const events_: PresentationEvent[] = [];
  const passedCityDraws: PresentationEvent[] = [];
  const drawSound = { kind: "sound", event: "jinnangDraw" } as const;
  let arrivalDrawCovered = false;
  const finishMarchDraws = () => {
    const draws = passedCityDraws.splice(0);
    arrivalDrawCovered = draws.includes(drawSound);
    return draws;
  };
  const foldedBooks = new Set<string>();
  const transferSounds = treasureTransferSounds(events);
  const deliveries = events.filter((ev) => ev.kind === "treasureTraded");
  const isDeliveryTurn = (ev: GameEvent, seat: number) =>
    deliveries.some(
      (deal) => deal.buyerSeat === seat && deal.turn === ev.turn && deal.round === ev.round,
    );
  const pre = (seat: number): number | null => prePositions?.[seat] ?? null;
  const cursors = cursorsOf(engine); // 跨批游标(生命周期=引擎实例,显式对象传递)

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    switch (ev.kind) {
      case "gameStarted":
        events_.push({ kind: "sound", event: "gameStart" });
        break;
      case "diceRolled": {
        // 掷骰签单节拍(#927,统一原则):不再区分 bot/人类速度档,点数直译。
        events_.push({ kind: "diceRolled", die: ev.die });
        break;
      }
      case "marchArrived": {
        const seat = eventSeat(engine, ev);
        events_.push(
          ...arrivalPresentation(engine, seat, ev, pre(seat), false, finishMarchDraws()),
        );
        break;
      }
      case "capitalHalt": {
        // 驻跸必停:引擎此态不发 marchArrived,行军动画由本事件的落点+路径字段直读
        // (#385:截断到都城的路径随事件走);都城停全屏宣告(S7)插行军与驻章之间,
        // 补给铜钱雨由随后 cashChanged(reason="supply") 压轴。
        const seat = eventSeat(engine, ev);
        events_.push(
          ...arrivalPresentation(
            engine,
            seat,
            ev,
            pre(seat),
            true,
            finishMarchDraws(),
            haltBannerEvent(engine, seat, ev.tileIndex),
          ),
        );
        break;
      }
      case "capitalSelected": {
        // 选都建城:「筑」章 + 建城宣告(易主维度;联机旧 diff 同款表现,单机由此补齐)
        eventSeat(engine, ev); // 建城者座位契约校验(章/宣告锚格,不锚人)
        events_.push(sealEvent(engine, ev.tileIndex, "筑", undefined, "stamp"));
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: false, ownerChanged: true }),
        );
        break;
      }
      case "propertyBought": {
        // 购地把印章和铜钱入囊合在钤定拍，价款浮字沿用原位。
        const seat = eventSeat(engine, ev);
        events_.push(
          sealEvent(engine, tileOfProperty(engine, ev.propertyId), "据", undefined, "buy"),
        );
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: false, ownerChanged: true }),
        );
        events_.push(cashFloater(engine, seat, -ev.price, false));
        break;
      }
      case "propertyUpgraded": {
        events_.push({
          ...propertyChangedEvent(engine, ev.propertyId, {
            levelChanged: true,
            ownerChanged: false,
          }),
          sound: "upgrade",
        });
        break;
      }
      case "propertyDamaged": {
        cursors.cityRewards.delete(ev.propertyId);
        if (ev.origin === "normal") {
          if (ev.impact === "demolished") {
            events_.push({
              kind: "propertyChanged",
              tileIndex: tileOfProperty(engine, ev.propertyId),
              level: ev.level,
              ownerColorIndex: engine.players[eventSeat(engine, ev)].colorIndex,
              levelChanged: true,
              ownerChanged: false,
              sound: null,
            });
          }
          break; // 外敌乘虚的城声交给耗竭结算。
        }
        if (ev.origin === "fireWall" || ev.impact === "conquest") break;
        if (ev.origin === "burning" && ev.impact === "hit") break;
        events_.push({ kind: "cityDamageSound", event: CITY_DAMAGE_SOUND[ev.impact] });
        break;
      }
      case "fireWallImpact": {
        events_.push({
          kind: "cityDamageSound",
          event: CITY_DAMAGE_SOUND[ev.impact],
          fireWallCue: fireWallRewardCue(cursors, ev.castSeq),
        });
        break;
      }
      case "propertyRejected": {
        if (ev.reason === "maxed") {
          events_.push(textFloater(engine, eventSeat(engine, ev), "城已满级,按兵不动"));
        }
        break;
      }
      case "cashChanged": {
        const fireWall = ev.cityReward?.fireWall;
        const waiting = fireWall?.stage === "awaitingImpact";
        const cash = cashFloater(
          engine,
          eventSeat(engine, ev),
          ev.delta,
          ev.reason === "supply",
          waiting ? undefined : cashChangeSound(ev, cursors),
        );
        if (cash.kind === "supplyRain" && typeof cash.sound === "object") {
          const capitalRecruitment = capitalRecruitmentCue(
            events,
            ev,
            engine.gameId,
            cash.playerId,
          );
          if (capitalRecruitment !== undefined) cash.sound = { ...cash.sound, capitalRecruitment };
        }
        if (waiting) cash.beforeFireWallImpact = fireWallRewardCue(cursors, fireWall.castSeq);
        events_.push(cash);
        break;
      }
      case "treasureGained": {
        const seat = eventSeat(engine, ev);
        const folded = foldedBooks.delete(treasureGainKey(ev, seat, ev.treasureId));
        const transfer = transferSounds.get(ev);
        let sound: SealSound = null;
        if (transfer !== undefined) {
          sound = transfer;
        } else if (!folded) {
          sound = ev.treasureId.startsWith(SKILL_BOOK_ID_PREFIX) ? "bookSetDown" : "treasure";
        }
        events_.push(sealEvent(engine, engine.players[seat].position, "得", "gold", sound));
        break;
      }
      case "treasureTraded": {
        // 买家与卖家各显示金额，卖家的铜钱负责这一笔交接声。
        events_.push(cashFloater(engine, ev.buyerSeat, -ev.price, false));
        events_.push(
          cashFloater(engine, ev.sellerSeat, ev.price, false, { event: "cashTransfer" }),
        );
        break;
      }
      case "treasureStolen": {
        // 窃宝宣告(#385,窃玉偷香):文案浮字锚窃方位置
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            `窃得「${engine.players[ev.victimSeat].guohao}」的「${ev.treasureName}」`,
          ),
        );
        break;
      }
      case "assetLiquidated": {
        // 逐件显示变卖所得及城池易主，集中在整批清偿时发声。
        const seat = eventSeat(engine, ev);
        events_.push(cashFloater(engine, seat, ev.amount, false));
        if (ev.asset.kind === "property")
          events_.push(
            propertyChangedEvent(engine, ev.asset.id, { levelChanged: false, ownerChanged: true }),
          );
        break;
      }
      case "bankruptcySettled": {
        const seat = eventSeat(engine, ev);
        if (!isDeliveryTurn(ev, seat)) events_.push({ kind: "sound", event: "ledgerClose" });
        break;
      }
      case "propertyBurningTicked": {
        events_.push({
          kind: "cityBurned",
          tileIndex: tileOfProperty(engine, ev.propertyId),
          marks: ev.marks,
        });
        break;
      }
      case "assetTransferred": {
        eventSeat(engine, ev);
        if (ev.conquest === undefined) {
          events_.push(
            propertyChangedEvent(engine, ev.propertyId, {
              levelChanged: false,
              ownerChanged: true,
            }),
          );
        } else {
          // 攻陷以该次易主为准。同批后续效果仍可能改变城主。
          const owner =
            ev.toSeat === null
              ? null
              : eventSeatPlayer(engine, ev.toSeat, "assetTransferred.toSeat");
          events_.push({
            kind: "propertyChanged",
            tileIndex: tileOfProperty(engine, ev.propertyId),
            level: owner === null ? null : INITIAL_CITY_LEVEL,
            ownerColorIndex: owner === null ? null : owner.colorIndex,
            levelChanged: false,
            ownerChanged: true,
            sound: ev.conquest === "fireWall" || ev.conquest === "normal" ? null : "cityConquest",
          });
        }
        break;
      }
      case "heroRecruited": {
        events_.push(
          textFloater(
            engine,
            eventSeat(engine, ev),
            `${heroDefOf(ev.heroId).name} 来投`,
            "heroRecruited",
          ),
        );
        break;
      }
      case "playerBankrupt": {
        // 破产仪式(S7 #513):倒旗→墨渍→撒币三拍由 sink 串行编排(三音随拍发起),
        // 提取期只锚现场(破产者落点=墨渍/撒币坐标)。
        const seat = eventSeat(engine, ev);
        const anchor = playerAnchor(engine, seat);
        events_.push({
          kind: "bankruptCeremony",
          playerId: engine.players[seat].id,
          x: anchor.x,
          y: anchor.y,
        });
        break;
      }
      case "jinnangAnnounced": {
        // 出牌(#281 P2-E):线指方向、字报其名——先各目标出线,再文案浮字。
        // 记宣布游标(跨批,生命周期=引擎实例):识破线指回本计的使用者/目标。
        const seat = eventSeat(engine, ev);
        cursors.lastAnnounce = {
          userSeat: seat,
          cardId: ev.cardId,
          targetSeats: [...ev.targetSeats],
        };
        // 线端随根牌域(#1389):one-city=受击城 tileIndex(棋盘界校验,线锚城格,
        // 同 jinnangVoided 城份先例);其余域=座位(座位契约校验单源 core/event-tiers)。
        const card = jinnangCardOf(ev.cardId);
        const announceDomain = card.targetDomain;
        const previous = events[i - 1];
        const counterAlreadyVoided =
          card.effect.kind === "counter" &&
          previous?.kind === "jinnangVoided" &&
          previous.cardId === ev.cardId &&
          previous.seat === seat;
        const sound =
          counterAlreadyVoided || hasImmediateResolution(events, i, selfSeat)
            ? undefined
            : "jinnangAnnounce";
        const from = engine.board.positionOf(engine.players[seat].position);
        const lines =
          announceDomain === "one-city"
            ? ev.targetSeats.map((t) => {
                if (!Number.isInteger(t) || t < 0 || t >= engine.board.count)
                  throw new Error(`jinnangAnnounced:城份格越界(${t})——产出侧 bug`);
                const to = engine.board.positionOf(t);
                return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
              })
            : ev.targetSeats
                .filter((s) => s !== seat)
                .map((s) => {
                  const to = engine.board.positionOf(engine.players[s].position);
                  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
                });
        if (lines.length > 0) {
          events_.push({
            kind: "jinnangPlayed",
            playerId: engine.players[seat].id,
            cardId: ev.cardId,
            lines,
            ...(sound !== undefined && { sound }),
          });
        }
        // 文案浮字与线独立(自身域无指向也报牌名,与旧 msg 浮字通道同观感)
        events_.push(
          textFloater(
            engine,
            seat,
            `${guohaoOf(engine, seat)} 使用锦囊【${ev.cardId}】`,
            lines.length === 0 ? sound : undefined,
          ),
        );
        break;
      }
      case "heroSkillActivated": {
        // 技能施展演出(#850 升档):施法者 token 金圈一拍(fx-svg-pulse 通道,坐标
        // 提取拍烤定,锚施法者当下所在格——landPulse 通道现仅本单一生产者,旧
        // 「行军落事件格定音」生产者已随功能格五型退役,#826/#828)+ 文案浮字升档
        // (cast 档:1.0× brush 字 + 玩家色细描边,色提取烤定;文案与旧口径同串)。
        // 城目标域(#1388 T2)追加「施术者 → 目标城格」指向线(出牌墨线同语系,
        // skillPointed 表现事件;席位域/none 域技无指向不出线)。
        const seat = eventSeat(engine, ev);
        const anchor = playerAnchor(engine, seat);
        events_.push({ kind: "landPulse", tileIndex: anchor.atTile, x: anchor.x, y: anchor.y });
        if (ev.skillKind === "fireBlast") {
          const to = engine.board.positionOf(ev.targetTileIndex);
          events_.push({
            kind: "skillPointed",
            playerId: engine.players[seat].id,
            lines: [{ x1: anchor.x, y1: anchor.y, x2: to.x, y2: to.y }],
          });
        }
        events_.push({
          kind: "textFloat",
          playerId: engine.players[seat].id,
          text: `${guohaoOf(engine, seat)} 施展【${activeSkillDefOf(ev.skillId).name}】`,
          skill: { kind: "cast", colorIndex: engine.players[seat].colorIndex },
          ...(ev.skillKind !== "relief" &&
            !hasImmediateResolution(events, i, selfSeat) && { sound: "jinnangAnnounce" }),
          ...anchor,
        });
        break;
      }
      case "skillFired": {
        // 被动技击发小签(#850):token 侧技名小签浮现(同 floater 通道渲染档 tag,
        // 不新造层;技名查技表单源,文案不带国号——小签是「技」的宣告,不是「谁」的);
        // 冷却账属 fold 面,本处只产演出。批内若随行掷骰/拼点 overlay,浮字按既有
        // overlay 互斥补发窗延后(orchestrator 同步件判据),小签不在幕下白播。
        const seat = eventSeat(engine, ev);
        events_.push({
          kind: "textFloat",
          playerId: engine.players[seat].id,
          text: skillById(ev.skillId).name,
          skill: { kind: "tag" },
          ...playerAnchor(engine, seat),
        });
        break;
      }
      case "skillLearned": {
        // 用书学技(#1146):习得文案浮字锚习得者位置(与来投/施展同通路;技名查技表
        // 单源,书名/消耗随事件不另演——书出册是 fold 面的账,珍宝角标自然回落)。
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            `${guohaoOf(engine, seat)} 习得【${skillById(ev.skillId).name}】`,
            "skillLearned",
          ),
        );
        break;
      }
      case "heroDismissed": {
        const seat = eventSeat(engine, ev);
        // 遣散后各册保留得印，书册声集中在遣散浮字。
        for (const skillId of ev.skillIds) {
          foldedBooks.add(treasureGainKey(ev, seat, `${SKILL_BOOK_ID_PREFIX}${skillId}`));
        }
        events_.push(
          textFloater(engine, seat, `遣散「${heroDefOf(ev.heroId).name}」,回招贤池`, "bookSetDown"),
        );
        break;
      }
      case "jinnangVoided": {
        // 识破生效(#281):线端=应答者 → 被保份/被拆计方(可解析时),字报结果。
        // shareSeat 语义随根牌域(#1389):one-city=受击城 tileIndex(棋盘界校验,
        // 线锚城格,文案报城名);其余域=座位(座位契约校验单源 core/event-tiers,
        // #431 移交顺带项:越界座位=产出侧 bug,当场炸出,不静默写 undefined)。
        const seat = eventSeat(engine, ev);
        const voidedCard = jinnangCardOf(ev.cardId);
        if (voidedCard.effect.kind !== "counter")
          events_.push({ kind: "sound", event: "jinnangCountered" });
        const voidedDomain = voidedCard.targetDomain;
        if (ev.shareSeat != null && voidedDomain === "one-city") {
          const t = ev.shareSeat;
          if (!Number.isInteger(t) || t < 0 || t >= engine.board.count)
            throw new Error(`jinnangVoided:城份格越界(${t})——产出侧 bug`);
          const from = engine.board.positionOf(engine.players[seat].position);
          const to = engine.board.positionOf(t);
          events_.push({
            kind: "jinnangPlayed",
            playerId: engine.players[seat].id,
            cardId: ev.cardId,
            lines: [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }],
          });
          events_.push(
            textFloater(
              engine,
              seat,
              `${guohaoOf(engine, seat)} 识破,「${engine.board.at(t).name}」免于【${ev.cardId}】`,
            ),
          );
          break;
        }
        if (ev.shareSeat != null) eventSeatPlayer(engine, ev.shareSeat, "jinnangVoided.shareSeat");
        const target = voidLineTarget(ev, cursors);
        if (target != null && target !== seat) {
          events_.push(jinnangLine(engine, seat, target, ev.cardId));
        }
        const text =
          ev.shareSeat != null
            ? `${guohaoOf(engine, seat)} 识破,${guohaoOf(engine, ev.shareSeat)} 免于【${ev.cardId}】`
            : voidedDomain === "two-others"
              ? `${guohaoOf(engine, seat)} 识破!【${ev.cardId}】作废`
              : `${guohaoOf(engine, seat)} 识破!【${ev.cardId}】落空`;
        events_.push(textFloater(engine, seat, text));
        break;
      }
      case "jinnangRestored":
        events_.push({ kind: "sound", event: "jinnangRestored" });
        break;
      case "jinnangInflicted": {
        // 中招宣告(#385,缓兵之计):文案浮字锚中招者位置;实际跳过另有 turnSkipped
        eventSeat(engine, ev);
        events_.push(textFloater(engine, ev.targetSeat, `中【${ev.cardId}】,下回合无法行动`));
        break;
      }
      case "peekApplied": {
        // 窥探弹层(#575,军情密探即时窥探):viewer-only 演出——座位契约校验后按事件
        // 直译(手牌内容随事件走,redactEvents 已逐座位裁、非 viewer 恒空,ADR-0016);
        // 目标国号与所因牌 id 提取期解析进事件(弹层副题/题名用,#1067),无净表现档
        //(hand 空)也照发,弹层组件按 viewerSeat===本座自门(他座客户端零渲染)。
        const viewerSeat = eventSeat(engine, ev);
        eventSeatPlayer(engine, ev.targetSeat, "peekApplied.targetSeat");
        events_.push({
          kind: "peekRevealed",
          viewerSeat,
          targetSeat: ev.targetSeat,
          cardId: ev.cardId,
          guohao: guohaoOf(engine, ev.targetSeat),
          hand: [...ev.hand],
        });
        break;
      }
      case "reactionOpened": {
        if (ev.view.kind === "march") events_.push(...passedCityDraws.splice(0));
        events_.push({ kind: "reactionOpened" });
        break;
      }
      case "reactionAnswered": {
        // 拦检出牌(半路杀出,use=true):线=城主 → 行人(本批随后的 marchArrived 即行人落格)。
        if (ev.use && ev.cardId != null) {
          const seat = eventSeat(engine, ev);
          const mover = events
            .slice(i + 1)
            .find(
              (e): e is Extract<GameEvent, { kind: "marchArrived" }> => e.kind === "marchArrived",
            );
          if (mover && mover.seat != null && mover.seat !== seat) {
            events_.push(jinnangLine(engine, seat, mover.seat, ev.cardId));
          }
        }
        break;
      }
      case "reactionFailed": {
        // 拦检失败宣告(ADR-0030 单通道):拼点骰面信息全在签面(duelResolved 直译),
        // 此处只余文案浮字(不带点数括注——点数不落第二处),照旧锚拦检城(事发现场)。
        const seat = eventSeat(engine, ev);
        events_.push(textFloaterAtTile(engine, seat, "拦检失败", ev.tileIndex));
        break;
      }
      case "duelResolved": {
        // 点数、胜者来自权威事件；呈现时签面按座位号依序落定。
        if (ev.sides.length < 2) throw new Error("事件消费:duelResolved 至少需要两席");
        if (ev.winnerSeat !== null && !ev.sides.some(({ seat }) => seat === ev.winnerSeat))
          throw new Error(`事件消费:duelResolved.winnerSeat=${ev.winnerSeat} 不在拼点座位中`);
        const sides: DuelSide[] = [...ev.sides]
          .sort((a, b) => a.seat - b.seat)
          .map(({ seat, roll }) => {
            const p = eventSeatPlayer(engine, seat, "duelResolved.sides.seat");
            return {
              seat,
              playerId: p.id,
              guohao: p.guohao,
              colorIndex: p.colorIndex,
              roll,
            };
          });
        events_.push({
          kind: "duelSigns",
          sides,
          winnerSeat: ev.winnerSeat,
          ...(ev.seat === null ? { forVictory: true } : {}),
        });
        break;
      }
      case "staminaChanged": {
        const seat = eventSeat(engine, ev);
        // #568 病 A:零实际差=无变化无演出(满体力时不浮「体力 +0」;
        // 发射点不设守卫——事件语义=宣告实际差,含 0,守卫单点在表现层折算处)。
        // reason=rest=休整期满回满,文案点明出处;其余=delta 宣告。
        if (ev.delta === 0) break;
        const cashCoversSupply =
          ev.reason === "supply" &&
          events.some(
            (cash) =>
              cash.kind === "cashChanged" &&
              cash.reason === "supply" &&
              cash.delta > 0 &&
              cash.seat === seat &&
              cash.round === ev.round &&
              cash.turn === ev.turn,
          );
        const sound =
          ev.depletes || cashCoversSupply
            ? undefined
            : ev.delta < 0
              ? "staminaHit"
              : "staminaRecover";
        const recovery = textFloater(
          engine,
          seat,
          ev.reason === "rest"
            ? `休整完毕,体力回满 ${signed(ev.delta)}`
            : `体力 ${signed(ev.delta)}`,
          sound,
        );
        if (ev.reason === "supply" && sound === "staminaRecover") {
          const cue = capitalRecruitmentCue(events, ev, engine.gameId, recovery.playerId);
          if (cue !== undefined) recovery.capitalRecruitment = cue;
        }
        events_.push(recovery);
        break;
      }
      case "exhaustionResolved": {
        const seat = eventSeat(engine, ev);
        const { x, y } = playerAnchor(engine, seat);
        events_.push({
          kind: "staminaExhausted",
          x,
          y,
          text: exhaustionTextOf(engine, ev),
          citySound: ev.strongestImpact === null ? null : CITY_DAMAGE_SOUND[ev.strongestImpact],
        });
        break;
      }
      case "jinnangDrawn": {
        const seat = eventSeat(engine, ev);
        const ownDraw = seat === selfSeat;
        const text = `获锦囊一封${ev.count > 1 ? ` ×${ev.count}` : ""}`;
        if (ev.reason === "turnStart") {
          if (ownDraw) events_.push(drawSound);
          events_.push(textFloater(engine, seat, text));
        } else if (ev.reason === "cityPassed") {
          // 经过事件早于本段落位，等本段行军播放完成或开拦检窗时再显示。
          if (ownDraw && !passedCityDraws.includes(drawSound)) passedCityDraws.push(drawSound);
          passedCityDraws.push(textFloaterAtTile(engine, seat, text, ev.tileIndex));
        } else {
          // 到达己城的摸牌仍属于本段，若前面的经过已经入声，只补这一城的浮字。
          if (ownDraw && !arrivalDrawCovered) events_.push(drawSound);
          events_.push(textFloaterAtTile(engine, seat, text, ev.tileIndex));
        }
        break;
      }
      case "jinnangReshuffled": {
        // 洗回宣告走 fx 面(引擎不推浮字):单机/联机各端同见,文案与战报同口径
        const seat = eventSeat(engine, ev);
        events_.push(textFloater(engine, seat, `弃牌堆 ${ev.count} 张洗回牌库`));
        break;
      }
      case "jinnangExhausted": {
        // 牌库弃堆双空落空宣告(#588):文案浮字锚抽牌者——自引擎浮字死通道迁 fx 面,
        // 单机/联机同见,rules 06「锦囊已空」玩家可见口径由此成立
        events_.push(textFloater(engine, eventSeat(engine, ev), "锦囊已空"));
        break;
      }
      case "turnSkipped": {
        events_.push(textFloater(engine, eventSeat(engine, ev), "被跳过一回合"));
        break;
      }
      case "turnStarted": {
        if (i === lastTurnStartIdx) {
          const seat = eventSeat(engine, ev);
          const p = engine.players[seat];
          // #762:round 提取拍烤定(槽泵合并判别的元数据,播放期零读引擎)
          events_.push({
            kind: "turnBanner",
            guohao: p.guohao,
            colorIndex: p.colorIndex,
            round: engine.round,
          });
        }
        break;
      }
      // ── 无表现档(default 守卫,档位单源 core/event-tiers)──
      // 走到这里的已登记 kind 必须是 fx=silent 档(回合/胜负生命周期、treasureSold、
      // 其余事件由状态折叠消费
      // 与卷轴/反应窗 UI 的输入,不产演出)——presented 档漏 case = 下面赋值编译期红
      //(FxPresentedKind 派生集,#430 防遗漏机器)。线上未知 kind 不在联合内,运行时
      // 落此跳过:ADR-0020 既定口径,非吞错。
      default: {
        const silentKind: Exclude<GameEventBody["kind"], FxPresentedKind> = ev.kind;
        void silentKind;
        break;
      }
    }
  }

  events_.push(...passedCityDraws);
  return events_;
}

/** 行军锚定(present 前、sync 渲染前调用):把 tokenMoved 烤好的 keyframes 直传
 *  sink 锚定 marchBegin(不变量①:逐帧坐标随表现事件走,锚定=取首帧,播放期
 *  零引擎读取;合并批多段行军各持各的序列)。开批语义(#609 单写者):每轮调用
 *  = 一个锚定批——批内同 id 重复锚定 = 同会话追加段(段队列);此前在途的同 id
 *  会话 = 跨批顶替对象;判据 = 批到达序(ADR-0029 §2)。 */
export function anchorMarches(events: PresentationEvent[], sink: FxSink): void {
  openMarchBatch();
  for (const ev of events) {
    if (ev.kind === "tokenMoved") sink.marchBegin(ev.playerId, ev.keyframes);
    if (ev.kind === "textFloat" && ev.capitalRecruitment !== undefined) {
      stageCapitalRecruitment(ev.capitalRecruitment);
    }
    if (ev.kind === "supplyRain" && typeof ev.sound === "object" && ev.sound.capitalRecruitment) {
      stageCapitalRecruitment(ev.sound.capitalRecruitment);
    }
  }
}
