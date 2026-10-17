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
import { diceApi, finishDiceOverlay, setDiceFast } from "./DiceOverlay";
import { useFxStore } from "./fxStore";
import { abandonMarch, animateMove, beginMarch } from "./useMarch";
import { delay, FX } from "./timings";
import type { FxSink, PresentationEvent } from "./presentation";

// ─────────────────────── 终局封场(D2 全层化)───────────────────────
// D2 的生命周期规则(对局结束 = 表现层使命终结)从骰子 overlay 升格到整个表现层:
// 胜利屏挂载即 finishPresentation(),present 在事件边界发现已封场即收队,剩余表现
// 事件整体不播(在途的那个事件自然播完,不产生半截特效状态)。背景 bug:玩家出局后
// 剩余整局被房间编排 0ms 同步跑完、事件批经合并拍毫秒级下行,客户端实速串行的演出
// 队列积压数分钟,骰子(z-45)一张接一张压在胜利屏(z-40)上摇到排空——D2 原先只
// 清在场一张,管不住队里后续的。收队时把批内未开播 tokenMoved 的行军接管一并收回
// (abandonMarch):anchorMarches 在 play() 拍就已预塞 marching,不收回则棋子被
// TokenLayer 冻结在起点挂行军金边直到整页 reload;同 id 恰有在途动画时,移出
// marching 即 C5 取消令牌(useMarch 订阅器),在途循环下个段边界自终止。
// 收队 return 而非 throw:SnapshotEffects 的 catch 是给真异常留的,封场收队是生命
// 周期规则,响 error 日志反而掩真错。
let sealed = false;

/** 终局封场:胜利屏挂载时调用(VictoryScreen);封场后一切 present 立即收队。 */
export function finishPresentation(): void {
  sealed = true;
  finishDiceOverlay();
}

// ─────────────────────── 播放器 ───────────────────────
/** 播放一组表现事件:串行 await,顺序 = 数组顺序。所有外设经 FxSink 驱动
 *  (生产 = createEngineSink 单例组装;测试 = createMemorySink 录制)。 */
export async function present(events: PresentationEvent[], sink: FxSink): Promise<void> {
  for (const [i, ev] of events.entries()) {
    if (sealed) {
      for (const rest of events.slice(i)) {
        if (rest.kind === "tokenMoved") abandonMarch(rest.playerId);
      }
      return;
    }
    switch (ev.kind) {
      case "diceRolled":
        // C1:bot 掷骰半速——速度开关在掷前设置(roll 内即消费复位);
        // 不走 FxSink 参数是因生产 sink(sinks.ts)不透传附加参数。
        setDiceFast(ev.fast === true);
        await sink.rollDice(ev.die);
        break;
      case "tokenMoved":
        await sink.marchToken(ev.playerId, ev.path);
        break;
      case "cashDelta":
        // 铜钱雨扩容(S7):纳税付银带 coins 档,随雨落币
        sink.spawnFloater(ev.x, ev.y, ev.amount, ev.coins === true);
        break;
      case "supplyRain":
        sink.spawnFloater(ev.x, ev.y, ev.amount, true);
        break;
      case "textFloat":
        sink.spawnTextFloater(ev.x, ev.y, ev.text);
        break;
      case "sealStamped":
        sink.stampSeal(ev.tileIndex, ev.char, ev.tone);
        break;
      case "landPulse":
        // 落格定音(S7):金圈一拍,同步下发 CSS 自走。
        sink.landPulse(ev.tileIndex);
        break;
      case "duelStamps":
        // 拼点双印(S7):音画错拍由 sink 编排(同步下发),不占编排时长。
        sink.stampDuel(ev);
        break;
      case "haltBanner":
        // 都城停全屏宣告(S7):号角+震屏同拍,等横幅读过峰值段再接驻章
        // (同 turnBanner 的 C3 口径;生产 sink 返回 void,不收签名)。
        sink.showHaltBanner(ev);
        await delay(FX.haltHoldMs);
        break;
      case "bankruptCeremony":
        // 破产仪式(S7):三拍串行编排(倒旗→墨渍→撒币,三音随拍),await 到收口。
        await sink.bankruptCeremony(ev);
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
/** 掷骰表现:全屏签面(diceApi → DiceOverlay:摇签→落定→停留→渐隐),单机/联机共用。
 *  起手沙锤在此(落骰声已挪到签面落定拍,DiceOverlay 内音画同拍)。
 *  生产 sink 的 rollDice 落点(sinks.ts)。 */
export async function animateDice(die: number): Promise<void> {
  getAudio().play("diceRoll");
  await diceApi.roll(die);
}

/** 反应窗续结算的余段行军路径(#281 拦停/续走):拦检窗挂起时视觉棋子停在
 *  挂起点(途经城前一格),续结算(拦停/放行)后事件内路径自原起点重算——直接
 *  播会把棋子拽回起点重走全程。本函数把事件路径截短为「挂起点 → 落点」余段,
 *  event-extract.marchEvent 据此产出余段 tokenMoved(路径随表现事件直传 sink,
 *  #385 起不再注入引擎 lastMove),复用既有 beginMarch/animateMove 通道平滑补走。
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
  };
}

/** 重置编排态(重开局时调用):表现 store 一并清,终局封场一并解封(生产 = 整页
 *  reload 天然新态;单测 beforeEach 靠此隔离,防封场态跨文件泄漏——bun test 单进程
 *  顺序跑,模块态跨文件存活,而 local-room.test.ts 无 beforeEach reset)。
 *  事件提取的跨批宣布游标生命周期 = 引擎实例(#430:WeakMap 键控,换局换实例即新
 *  游标),无手工 reset 配对可忘。 */
export function resetFxOrchestration(): void {
  sealed = false;
  useFxStore.getState().resetFx();
}

export { beginMarch, animateMove };

/** 金额格式化(FxLayer 共用口径:+/− 前缀)。 */
export function formatFloater(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}
