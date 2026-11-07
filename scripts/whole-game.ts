// 无头整局驱动器(#1161):bun 侧直接驱动权威引擎跑完整局,逐回合产出状态摘要。
// 「游戏对不对」的验证从浏览器层下沉 core 层的通路:本模块零 DOM 零时钟,驱动循环
// 同步泵进(节奏/演出是 app 层的事);不另起任何随机源——确定性由种子骰流单源保证。
// 行为单源:bot 座位走 botAct 裸调(#580,同 sim-batch/联机 bot-driver 口径);
// 学自 vera20k src/bin/parity-digest.rs:固定种子+固定地图是对比有意义的前提——
// 本驱动器的一切输出都以 (map, seed, seats) 全给定为准,缺一当场抛(零兜底)。
// 摘要生产在引擎之外(vera20k ParityDigestSink 条款:sink 归驱动器所有,启用测量
// 不得扰动被测的跑法)——引擎对摘要一事全然不知。
import type { GameEngine, SeatConfig } from "../src/core/authority";
import type { EncounterSwitch } from "../src/core/encounters";
import { ENCOUNTER_PRODUCT_DEFAULTS } from "../src/core/encounters";
import { GAME_EVENT_KINDS, type GameEvent } from "../src/core/game-events";
import type { LoadedMap } from "../src/core/board-loader";
import { BOT_ATTENDED_PHASES, botAct } from "../src/core/bot";
import { netWorth } from "../src/core/networth";
import { autoSetup, createEngine, type GameConfig } from "./engine-helpers";
import { fingerprint } from "./seat-projection";
import { turnDigestOf, type TurnDigest } from "./state-digest";

/** 无僵死窗(任务口径「连续 N 回合无事件」):连续 N 个回合边界事件批全空 = 僵死,
 *  当场炸。实测正常局每回合都有事件(掷骰/移动/结算必有产出),20 只是护栏不是常态。 */
const IDLE_TURN_LIMIT = 20;

/** 驱动钩子。onHumanDecision = 人类座 choice-index 回放接口位(票一预留,完整重放
 *  随协议票落地):决策归属人类座(含反应窗人类被询问)时被调,实现方可代打
 *  (如 botAct(e))或按录得的 choice-index 重放命令;引擎批界纪律适用——命令须走
 *  submitCommand/respondReaction 批界入口,直调裸方法会把旧批事件混进本步。全 bot
 *  语料不传 = 遇人类决策/反应窗当场炸(配置错误,不静默代打)。 */
export interface DriveHooks {
  /** 每个 botAct 步后回调(批界 #375:入参即本步事件批 e.gameEvents)。 */
  onStep?(events: GameEvent[]): void;
  /** 回合边界摘要(含终局/触上限收尾摘要)。 */
  onDigest?(digest: TurnDigest): void;
  /** 人类座决策缝(见上)。 */
  onHumanDecision?(e: GameEngine): void;
}

/** 链式战报哈希的续跑种子:快照续跑端传截断点摘要的 {logHash, logCount}。 */
export interface LogChainState {
  hash: string;
  count: number;
}

export interface DriveOptions {
  /** 报错语境(如 `seed 3000 @ zhongyuan`)。 */
  label: string;
  /** 回合上限(单玩家回合数;触顶 = 未终局,正常返回不作错误——上限是测量口径,
   *  是否算平衡发现由消费方判读,口径同 sim-batch)。 */
  turnCap: number;
  hooks?: DriveHooks;
  logChain?: LogChainState;
  /** 截断驱动:产出 N 笔边界摘要即停(快照往返门的截断跑用;不产收尾摘要)。 */
  stopAfterDigests?: number;
}

export interface DriveResult {
  /** 逐回合摘要序列(边界序,末笔 = 收尾摘要)。 */
  digests: TurnDigest[];
  finished: boolean;
  rounds: number;
}

const KIND_SET: ReadonlySet<string> = new Set(GAME_EVENT_KINDS);

/** 当前决策点归属座位(与 scripts/bot-driver.ts decisionSeatOf 同式;不 import——
 *  bot-driver 背着 room/server 依赖,驱动器零网络依赖,两处注释互指)。 */
export function decisionSeatOf(e: GameEngine): number {
  return e.phase === "Setup" ? e.currentSetupPlayerIndex : e.decisionOwner;
}

/** 反应窗被询问座位集(与 scripts/bot-driver.ts reactionQueriedSeats / app 层
 *  src/app/controllers/reaction.ts 三层同式,注释互指;驱动器零传输依赖,本地复算)。 */
export function reactionQueriedSeats(e: GameEngine): number[] {
  const v = e.pendingReaction?.view;
  if (v == null) return [];
  return v.kind === "jinnang" ? [...v.queriedBySeat] : [v.ownerSeat];
}

/** 逐座不变量巡检(廉价,每回合边界跑):现金/身价必须是有限整数(NaN/泄漏当场炸;
 *  变卖自救中的过渡负现金合法,不硬断言非负——口径见 ADR-0052)。 */
function assertEconomySane(e: GameEngine, label: string): void {
  for (const p of e.players) {
    if (!Number.isInteger(p.cash) || !Number.isFinite(p.cash))
      throw new Error(`${label}:座位 ${p.id} 现金非法(${String(p.cash)})——数值泄漏`);
    const nw = netWorth(p);
    if (!Number.isFinite(nw)) throw new Error(`${label}:座位 ${p.id} 身价非有限(${String(nw)})`);
  }
}

/** 事件词表合法不变量:批内出现词表外 kind = 数据损坏,当场炸。 */
function assertVocabulary(events: GameEvent[], label: string): void {
  for (const ev of events) {
    if (!KIND_SET.has(ev.kind))
      throw new Error(`${label}:事件词表外 kind「${String(ev.kind)}」——词表漏登记或数据损坏`);
  }
}

/** 驱动一局到终局或回合上限。守卫(发现即炸,零兜底):不可驱动相位 / 决策点无归属 /
 *  步进无进展 / 事件词表外 / 数值泄漏 / 连续 N 回合无事件。摘要序列逐位确定:
 *  同 (map, seed, seats, encounter) 恒同输出——确定性两跑门(test/headless-whole-game)
 *  逐票守着。 */
export function driveToEnd(e: GameEngine, opts: DriveOptions): DriveResult {
  if (e.phase !== "Playing")
    throw new Error(
      `${opts.label}:驱动器只接 Playing 相位引擎(收到 ${e.phase})——选都先经 autoSetup`,
    );
  const digests: TurnDigest[] = [];
  let logChain: LogChainState = opts.logChain ?? { hash: "", count: 0 };
  let prevTurn = e.turnNumber;
  let turnEvents: GameEvent[] = [];
  let idleTurns = 0;

  const emitDigest = (): TurnDigest => {
    const d = turnDigestOf(e, turnEvents, logChain);
    digests.push(d);
    opts.hooks?.onDigest?.(d);
    logChain = { hash: d.logHash, count: d.logCount };
    turnEvents = [];
    return d;
  };

  while (!e.isOver) {
    if (e.turnNumber >= opts.turnCap) break; // 触上限:未终局,收尾摘要后返回
    const before = fingerprint(e);
    if (e.turnPhase === "AwaitingReaction") {
      // 反应窗(#281):bot 座位已由引擎开窗即席代答(ADR-0017),窗还挂着 = 有人类座
      // 待应答。人类缝接窗(实现须走 submitCommand/respondReaction 批界入口解窗);
      // 无缝或被询问全为 bot(引擎该代答而未代答 = 状态机 bug)都当场炸,零兜底。
      const queried = reactionQueriedSeats(e);
      const humanSeats = queried.filter((s) => e.players[s]?.isBot === false);
      if (humanSeats.length === 0)
        throw new Error(
          `${opts.label}:停在反应窗且被询问全为 bot 座位——开窗应已即席代答,状态机 bug`,
        );
      if (!opts.hooks?.onHumanDecision)
        throw new Error(
          `${opts.label}:反应窗停等人类座 [${humanSeats.join(",")}] 且未传 onHumanDecision——全 bot 语料别带人类座`,
        );
      opts.hooks.onHumanDecision(e);
    } else {
      if (!BOT_ATTENDED_PHASES.has(e.turnPhase))
        throw new Error(`${opts.label}:停在场不可驱动相位 ${e.turnPhase}——状态机 bug`);
      const seat = decisionSeatOf(e);
      if (seat < 0) throw new Error(`${opts.label}:决策点无归属(收尾瞬态泄漏进循环)——状态机 bug`);
      if (e.players[seat].isBot) {
        botAct(e);
      } else if (opts.hooks?.onHumanDecision) {
        opts.hooks.onHumanDecision(e); // 人类座缝:代打或按 choice-index 重放
      } else {
        throw new Error(
          `${opts.label}:决策点归属人类座 ${seat} 且未传 onHumanDecision——全 bot 语料别带人类座`,
        );
      }
    }
    if (!e.isOver && fingerprint(e) === before)
      throw new Error(`${opts.label}:驱动步无进展(指纹不变)——状态机 bug`);
    const events = e.gameEvents;
    assertVocabulary(events, opts.label);
    turnEvents.push(...events);
    opts.hooks?.onStep?.(events);
    if (e.isOver) break; // 终局:收尾摘要由循环外补
    if (e.turnNumber !== prevTurn) {
      // 回合边界:先查僵死(连续 N 回合无事件)再取摘要
      if (turnEvents.length === 0) {
        idleTurns += 1;
        if (idleTurns >= IDLE_TURN_LIMIT)
          throw new Error(`${opts.label}:连续 ${idleTurns} 回合无事件——疑似僵死,先查驱动与状态机`);
      } else {
        idleTurns = 0;
      }
      emitDigest();
      assertEconomySane(e, opts.label);
      prevTurn = e.turnNumber;
      if (opts.stopAfterDigests != null && digests.length >= opts.stopAfterDigests)
        return { digests, finished: false, rounds: e.round };
    }
  }
  // 收尾摘要(终局或触上限):把最后一个未满回合的事件批折入
  emitDigest();
  return { digests, finished: e.isOver, rounds: e.round };
}

/** 整局运行便利入口:构造(产品口径:机遇默认开,ADR-0035)→ autoSetup → driveToEnd。
 *  地图/种子/座位全必配(vera20k 前提条款:同图同种是对比有意义的前提,缺一不跑)。 */
export interface WholeGameOptions {
  map: LoadedMap;
  /** 地图 id(随局头落对局日志;内置图传清单 id,夹具图传自定义串)。 */
  mapId: string;
  seed: number;
  seats: SeatConfig[];
  encounter?: EncounterSwitch;
  turnCap?: number;
  hooks?: DriveHooks;
  /** 截断驱动(快照往返门用;语义见 DriveOptions)。 */
  stopAfterDigests?: number;
}

/** 整局构造参数(单源:runWholeGame 与快照往返门的重建端共用,保证同 config 重建)。 */
export function wholeGameConfig(opts: WholeGameOptions): GameConfig {
  return {
    seats: opts.seats,
    targetNetWorth: opts.map.targetNetWorth,
    startingCash: opts.map.startingCash,
    // 起手珍宝随地图(单源 public/maps;硬编码 0 会造成无头跑 0 件、产品跑 2 件的静默第二配置,#1201 连带笔误正)
    startingTreasures: opts.map.startingTreasures,
    seed: opts.seed,
    mapId: opts.mapId,
    encounter: opts.encounter ?? ENCOUNTER_PRODUCT_DEFAULTS,
  };
}

export function runWholeGame(opts: WholeGameOptions): DriveResult & { engine: GameEngine } {
  const engine = createEngine(wholeGameConfig(opts), true, opts.map);
  autoSetup(engine);
  const result = driveToEnd(engine, {
    label: `seed ${opts.seed} @ ${opts.mapId}`,
    turnCap: opts.turnCap ?? 3000,
    hooks: opts.hooks,
    stopAfterDigests: opts.stopAfterDigests,
  });
  return { ...result, engine };
}
