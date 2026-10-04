// 动画/音效编排器(ADR-0006 预留的"共享动画编排器",Wave1 改造为事件驱动):
//   提取器(event-extract.ts,#385 起事件批直译)→ PresentationEvent[] → present()(how to play)→ FxSink。
// 时序对照旧 src/render/state.ts 的 doRoll/afterLand/onTurnAdvanced 链:
//   rollAndMove:  diceRolled → tokenMoved → 浮字
//   buy(成功):   sealStamped("据") + buy 音 → 城池宣告(ADR-0015)→ 浮字
//   upgrade(成功):upgrade 音 → 城池宣告(ADR-0015)→ 浮字
//   选路/招贤/交涉/清算:语义音效(treasure/bankrupt) → 浮字
//   回合推进:    turnBanner(下家国号)
// 事件数组顺序即播放顺序,present 串行 await。
// 本文件自 #385 起只保留「播放器 + 骰子动画 + 行军余段截短 + 重置」:#385 前的单机
// 提取器(extractStepEvents 读 lastRoll/lastMove/drainFloaters/drainPropertyChanges/
// drainJinnangPlays)与联机横幅游标(turnBannerEvent/maybeShowTurnBanner)已由
// event-extract.ts 的事件批直译取代——演出因果单源 = 引擎事件批(ADR-0020)。
import type { MovePath } from "@core/board";
import { formatMoney } from "@core/money";
import { getAudio } from "./audio";
import { diceApi } from "./DiceOverlay";
import { setDiceFast, showFallbackDiceSign } from "./ThreeDice";
import { useFxStore } from "./fxStore";
import { animateMove, beginMarch } from "./useMarch";
import { delay, FX } from "./timings";
import type { FxSink, PresentationEvent } from "./presentation";
import { resetEventExtractCursors } from "./event-extract";

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
      case "textFloat":
        sink.spawnTextFloater(ev.x, ev.y, ev.text);
        break;
      case "sealStamped":
        sink.stampSeal(ev.tileIndex, ev.char);
        break;
      case "turnBanner":
        // C3:横幅占用编排时长——showBanner 本身异步置 store 即返回(音画由 CSS 动画
        // 自走),此处显式等峰值停留段(FX.bannerHoldMs),下一演出(骰子)不再与横幅
        // 入场重叠。不改 FxSink.showBanner 返回 Promise:生产实现(sinks.ts)返回
        // void,签名收紧会在 fx/ 之外产生编译错误。
        sink.showBanner(ev.guohao, ev.colorIndex);
        await delay(FX.bannerHoldMs);
        break;
      case "sound":
        sink.playSound(ev.event);
        break;
      case "jinnangPlayed":
        // 出牌指示线(#281 P2-E):同步下发(无编排时长),三段动画 CSS 自走;
        // 每目标一段,数量恒小(锦囊目标域至多全体)。
        for (const l of ev.lines) sink.spawnJinnangLine(l.x1, l.y1, l.x2, l.y2);
        break;
      case "propertyChanged":
        // 城池宣告(ADR-0015):经 sink 下发 nonce 驱动 Tile 重播宣告动画。
        // 同步下发(无编排时长)——与相邻事件的相对序由 store 写入序保证。
        sink.announceTileChange(ev);
        break;
    }
  }
}

// ─────────────────────── 骰子动画 ───────────────────────
/** 掷骰表现:3D 物理骰优先;WebGL 不可用 → 全屏文字签面(X5:弹入→停留→渐隐,
 *  替代旧「黑屏干等 650ms」),签面现身时落骰声(时序对齐 3D 路径)。
 *  生产 sink 的 rollDice 落点(sinks.ts),单机/联机共用。 */
export async function animateDice(die: number): Promise<void> {
  const audio = getAudio();
  audio.play("diceRoll");
  if (diceApi.available) {
    await diceApi.roll(die);
    audio.play("diceLand");
    return;
  }
  await showFallbackDiceSign(die, () => audio.play("diceLand"));
}

/** 反应窗续结算的余段行军路径(#281 拦停/续走):拦检窗挂起时视觉棋子停在
 *  挂起点(途经城前一格),续结算(拦停/放行)后引擎 lastMove 自原起点重算——直接
 *  播会把棋子拽回起点重走全程。本函数把 lastMove 截短为「挂起点 → 落点」余段,
 *  event-extract.marchEvent 据此产出余段 tokenMoved(锚定注入走 applyPresentationMove,
 *  表现侧写 lastMove 的唯一合法入口),复用既有 beginMarch/animateMove 通道平滑补走。
 *  fromPos 不在路径上且非起点 = 状态 bug,抛错;无余段(挂起点即落点)返回 null。 */
export function remainingMarchPath(
  path: MovePath,
  fromPos: number,
  landIndex: number,
): MovePath | null {
  const i = path.traversed.indexOf(fromPos); // -1 = 棋子仍在起点(traversed 不含起点)
  if (i < 0 && path.from !== fromPos)
    throw new Error(`remainingMarchPath:挂起点 #${fromPos} 不在重算路径上(状态机 bug)`);
  if (i >= 0 && i >= path.traversed.length - 1) return null; // 挂起点即落点:无余段
  const rest = path.traversed.slice(i + 1);
  const stop = rest.indexOf(landIndex); // 链式窗(下一城再挂起)时截到本次落点为止
  const traversed = stop >= 0 ? rest.slice(0, stop + 1) : rest;
  if (traversed.length === 0) return null;
  return {
    from: fromPos,
    traversed,
    landIndex,
    passedCapital: false,
    capitalIndex: -1,
    waypoints: [],
    landBranchStep: null,
    branchWaypoints: [],
  };
}

/** 重置编排态(重开局时调用):跨批游标(事件提取)与表现 store 一并清。 */
export function resetFxOrchestration(): void {
  resetEventExtractCursors();
  useFxStore.getState().resetFx();
}

export { beginMarch, animateMove };

/** 金额格式化(FxLayer 共用口径:+/− 前缀)。 */
export function formatFloater(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}
