// 动画/音效编排器(ADR-0006 预留的"共享动画编排器",Wave1 改造为事件驱动):
//   提取器(what happened)→ PresentationEvent[] → present()(how to play)→ FxSink。
// 时序对照旧 src/render/state.ts 的 doRoll/afterLand/onTurnAdvanced 链:
//   rollAndMove:  diceRolled → [若非驻跸] tokenMoved → 浮字
//   halt/continue:tokenMoved(补走) → 浮字
//   buy(成功):   sealStamped("据") + buy 音 → 浮字
//   upgrade(成功):upgrade 音 → 浮字
//   选路/招贤/交涉/清算:语义音效(treasure/bankrupt) → 浮字
//   回合推进:    turnBanner(下家国号)
// 事件数组顺序即播放顺序,present 串行 await——语义与旧 playStepEffects 内联链一致。
// 浮字坐标锚定:engine floaters 的 atTile / 辅路格 / 玩家位置(优先级同旧 spawnFloaters),
// 在提取期(提取器内)解析成逻辑坐标存进事件。
import type { GameEngine } from "@core/game";
import type { Player } from "@core/types";
import type { TurnPhase } from "@core/types";
import { formatMoney } from "@core/money";
import { playerColor, rgba } from "@core/theme";
import { getAudio } from "./audio";
import { diceApi } from "./DiceOverlay";
import { setDiceFast } from "./ThreeDice";
import { useFxStore } from "./fxStore";
import { animateMove, beginMarch } from "./useMarch";
import { delay, FX } from "./timings";
import type { FxSink, PresentationEvent } from "./presentation";

// ─────────────────────── 播放器 ───────────────────────
/** 播放一组表现事件:串行 await,顺序 = 数组顺序。所有外设经 FxSink 驱动
 *  (生产 = createEngineSink 单例组装;测试 = createMemorySink 录制)。 */
export async function present(events: PresentationEvent[], sink: FxSink): Promise<void> {
  for (const ev of events) {
    switch (ev.kind) {
      case "diceRolled":
        // C1:bot 掷骰半速——速度开关在掷前设置(roll 内即消费复位);
        // 不走 FxSink 参数是因生产 sink(sinks.ts)不透传附加参数。
        setDiceFast(ev.fast === true);
        await sink.rollDice(ev.die);
        break;
      case "tokenMoved":
        await sink.marchToken(ev.playerId);
        break;
      case "cashDelta":
        sink.spawnFloater(ev.x, ev.y, ev.amount, false);
        break;
      case "supplyRain":
        sink.spawnFloater(ev.x, ev.y, ev.amount, true);
        break;
      case "sealStamped":
        sink.stampSeal(ev.tileIndex, ev.char);
        break;
      case "turnBanner":
        // C3:横幅占用编排时长——showBanner 本身异步置 store 即返回(音画由 CSS 动画
        // 自走),此处显式等峰值停留段(FX.bannerHoldMs),下一演出(骰子)不再与横幅
        // 入场重叠。不改 FxSink.showBanner 返回 Promise:生产实现(sinks.ts)返回
        // void,签名收紧会在 fx/ 之外产生编译错误。单机横幅走命令式
        // maybeShowTurnBanner(人类掷骰前无 present 路径横幅),首掷不受此延迟影响。
        sink.showBanner(ev.guohao, ev.colorIndex);
        await delay(FX.bannerHoldMs);
        break;
      case "sound":
        sink.playSound(ev.event);
        break;
    }
  }
}

// ─────────────────────── 单机提取器 ───────────────────────
/** 掷骰表现:3D 物理骰优先;WebGL 不可用 → 停顿模拟 + 落骰声(签面文字由 HandPanel 展示)。
 *  生产 sink 的 rollDice 落点(sinks.ts),单机/联机共用。 */
export async function animateDice(die: number): Promise<void> {
  const audio = getAudio();
  audio.play("diceRoll");
  if (diceApi.available) {
    await diceApi.roll(die);
    audio.play("diceLand");
    return;
  }
  // fallback:旧版在此切换 7 次 #dice-face 文字;React 版签面在侧栏,直接等一段掷骰时长
  await delay(650);
  audio.play("diceLand");
}

/** 引擎浮字 → cashDelta/supplyRain 事件(消费 presentation.drainFloaters 的破坏性读:
 *  一次取尽后在本地数组上判定/遍历,与旧「先判 hasIncome 再 drain」等价)。
 *  锚定优先级照搬旧 spawnFloaters:atTile 格 → 辅路格(玩家在辅路上时,否则起点
 *  tile 会与棋子分离)→ 玩家位置。必须在提取期解析:依赖提取时刻的玩家状态。 */
function floaterEvents(engine: GameEngine): PresentationEvent[] {
  const fs = engine.presentation.drainFloaters();
  const events: PresentationEvent[] = [];
  // 铜钱声口径(旧 spawnFloaters:"有正收入就叮一声,每步一次"),按旧实现排在首个浮字之前
  if (fs.some((f) => f.amount > 0)) events.push({ kind: "sound", event: "coin" });
  for (const f of fs) {
    const player = engine.players[f.playerIndex];
    if (!player) continue;
    const board = engine.board;
    const atPos = f.atTile != null ? board.positionOf(f.atTile) : null;
    const onBranchPos =
      player.onBranch != null && board.branch
        ? board.branch.cells[player.onBranch.step]?.position ?? null
        : null;
    const tokenPos = board.positionOf(player.position);
    const anchor = {
      x: onBranchPos?.x ?? atPos?.x ?? tokenPos.x,
      y: onBranchPos?.y ?? atPos?.y ?? tokenPos.y,
      atTile: f.atTile ?? null,
    };
    if (f.kind === "supply") {
      events.push({ kind: "supplyRain", playerId: player.id, amount: f.amount, ...anchor });
    } else {
      events.push({ kind: "cashDelta", playerId: player.id, amount: f.amount, ...anchor });
    }
  }
  return events;
}

/**
 * 单机提取器:把「一次引擎推进」(人类命令与 bot 步骤共用)提取为表现事件。
 * 与旧 playStepEffects 逐分支对齐(prevPhase 决定该步语义),仅产出数据不播任何东西。
 * @param engine    推进后的引擎(经 presentation 视图读 lastRoll/lastMove/lastTransaction/drainFloaters)
 * @param prevPhase 推进前的 turnPhase(决定该步的语义:Roll/驻跸/选路/决策/…)
 * @param moverId   推进前的活跃玩家(行军棋子;命令后引擎可能已推进回合)
 * @param prePlayer 推进前的活跃玩家对象(破产清算后读 isBankrupt 播破产音)
 * @param cmdType   触发命令类型(人类路径传 cmd.type;交涉跳过传 "resolveTreasureOwner_skip")
 */
export function extractStepEvents(
  engine: GameEngine,
  prevPhase: TurnPhase,
  moverId: string,
  prePlayer?: Player,
  cmdType?: string,
): PresentationEvent[] {
  const events: PresentationEvent[] = [];
  // 表现态统一经 presentation 视图读(Wave3 候选4:引擎字段已私有)
  const view = engine.presentation;

  if (prevPhase === "Roll") {
    const die = view.lastRoll?.die;
    // C1:推进前活跃玩家是 bot → 掷骰事件带 fast(播放侧走半速节奏)
    if (die) events.push({ kind: "diceRolled", die, fast: prePlayer?.isBot === true });
    // 驻跸抉择:令牌未动,行军等 halt/continue 命令后再补(对照旧 doRoll 分支)
    if (engine.turnPhase !== "AwaitingCapitalHalt" && view.lastMove) {
      events.push({ kind: "tokenMoved", playerId: moverId, path: view.lastMove });
    }
    events.push(...floaterEvents(engine));
    return events;
  }

  if (prevPhase === "AwaitingCapitalHalt") {
    if (view.lastMove) {
      events.push({ kind: "tokenMoved", playerId: moverId, path: view.lastMove }); // 补走余下路程
    }
    events.push(...floaterEvents(engine));
    return events;
  }

  if (prevPhase === "AwaitingDecision") {
    // 以引擎 lastTransaction 判成败;买/扩军的表现差异由命令类型区分(控制器传入)
    if (view.lastTransaction?.status === "Ok") {
      if (cmdType === "upgradeProperty") {
        events.push({ kind: "sound", event: "upgrade" });
      } else {
        // 默认按买城:印章"据" + buy 音(与旧 onDecision("buy") 一致)
        events.push({ kind: "sealStamped", tileIndex: engine.activePlayer.position, char: "据" });
        events.push({ kind: "sound", event: "buy" });
      }
    }
    events.push(...floaterEvents(engine));
    return events;
  }

  if (prevPhase === "AwaitingTreasureOwner") {
    // 公道/坐地 → 访客得宝音;跳过(skip 命令)无声——旧 onTreasureOwner 的口径
    if (cmdType !== "resolveTreasureOwner_skip") {
      events.push({ kind: "sound", event: "treasure" });
    }
    events.push(...floaterEvents(engine));
    return events;
  }

  if (prevPhase === "AwaitingBankruptcySettle") {
    events.push(...floaterEvents(engine));
    // 变卖仍不足 → 破产(prePlayer 在 settleDebt 中被置 isBankrupt)
    if (prePlayer?.isBankrupt) events.push({ kind: "sound", event: "bankrupt" });
    return events;
  }

  // 其余(AwaitingBranch/AwaitingHeroPick/…):浮字即可
  events.push(...floaterEvents(engine));
  return events;
}

/** 回合横幅:国号大字飞入(玩家色),配 whoosh。 */
export function showTurnBanner(player: Pick<Player, "guohao" | "colorIndex">): void {
  getAudio().play("banner");
  useFxStore.getState().showBanner(player.guohao, rgba(playerColor(player.colorIndex)));
}

/** 记住上次横幅的活跃座位:activeIndex 变化才重弹(同一回合多个子决策不重复打扰)。 */
let lastBannerIndex = -1;

/** 回合推进检测(事件版,联机提取器用):对局中且活跃座位变化 → 产出 turnBanner
 *  事件并更新去重游标。单机因横幅与 bot 接棒的时序耦合(先 bot 链后横幅)仍走
 *  命令式 maybeShowTurnBanner,两者共用同一去重游标与落点。 */
export function turnBannerEvent(engine: GameEngine): PresentationEvent | null {
  if (engine.phase !== "Playing") return null;
  if (engine.activeIndex === lastBannerIndex) return null;
  lastBannerIndex = engine.activeIndex;
  const p = engine.activePlayer;
  return { kind: "turnBanner", guohao: p.guohao, colorIndex: p.colorIndex };
}

/** 回合推进检测(命令式,单机控制器用):每次引擎推进后调用。 */
export function maybeShowTurnBanner(engine: GameEngine): void {
  if (engine.phase !== "Playing") return;
  if (engine.activeIndex === lastBannerIndex) return;
  lastBannerIndex = engine.activeIndex;
  showTurnBanner(engine.activePlayer);
}

/** 重置横幅去重(重开局时调用,防止同座位开局横幅被吞)。 */
export function resetFxOrchestration(): void {
  lastBannerIndex = -1;
  useFxStore.getState().resetFx();
}

export { beginMarch, animateMove };

/** 金额格式化(FxLayer 共用口径:+/− 前缀)。 */
export function formatFloater(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}
