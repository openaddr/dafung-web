// 动画/音效编排器(ADR-0006 预留的"共享动画编排器",Wave1 改造为事件驱动):
//   提取器(event-extract.ts,#385 起事件批直译)→ PresentationEvent[] → present()(how to play)→ FxSink。
// 时序对照旧 src/render/state.ts 的 doRoll/afterLand/onTurnAdvanced 链:
//   rollAndMove:  diceRolled → tokenMoved → 浮字
//   buy(成功):   sealStamped("据") + buy 音 → 城池宣告(ADR-0015)→ 浮字
//   upgrade(成功):upgrade 音 → 城池宣告(ADR-0015)→ 浮字
//   选路/招贤/交涉/清算:语义音效(treasure/bankrupt) → 浮字
//   回合推进:    turnBanner(下家国号)
// 事件数组顺序即播放顺序,present 串行 await。
// 本文件自 #385 起只保留「播放器 + 骰子动画 + 行军余段截短 + 重置」。旧单机提取器
// (extractStepEvents——曾读 lastRoll/lastMove/引擎浮字队列 drainFloaters/
// drainPropertyChanges/drainJinnangPlays)与联机横幅游标(turnBannerEvent/
// maybeShowTurnBanner)均已被 event-extract.ts 的事件批直译取代——演出因果单源 =
// 引擎事件批(ADR-0020)。引擎浮字通道(drainFloaters/pushFloater 族)#588 清点定谳:
// 产线零消费,浮字宣告一律走事件 presented 档 + event-extract 派生。
import type { MovePath } from "@core/board";
import { formatMoney } from "@core/money";
import { getAudio } from "./audio";
import { diceApi, finishDiceOverlay, setDiceFast } from "./DiceOverlay";
import { finishDuelSigns } from "./DuelSignsOverlay";
import { useFxStore } from "./fxStore";
import { abandonMarch, animateMove, beginMarch } from "./useMarch";
import { delay, FX, scStage } from "./timings";
import type { FxSink, PresentationEvent } from "./presentation";

// ─────────────────────── 终局封场(D2 全层化)───────────────────────
// D2 的生命周期规则(对局结束 = 表现层使命终结)从骰子 overlay 升格到整个表现层:
// 胜利屏挂载即 finishPresentation(),present 在事件边界发现已封场即收队,剩余表现
// 事件整体不播(在途的那个事件自然播完,不产生半截特效状态)。背景 bug:玩家出局后
// 剩余整局被房间编排 0ms 同步跑完、事件批经合并拍毫秒级下行,客户端实速串行的演出
// 队列积压数分钟,骰子(z-45)一张接一张压在胜利屏(z-40)上摇到排空——D2 原先只
// 清在场一张,管不住队里后续的。收队时把批内未开播 tokenMoved 的行军接管一并收回
// (abandonMarch):anchorMarches 在 play() 拍就已预塞 marching,不收回则棋子被
// TokenLayer 冻结在起点挂行军金边直到整页 reload;同 id 恰有在途动画时,会话令牌
// 即删(#609 per-id 会话),在途循环下个段边界自终止。
// 收队 return 而非 throw:SnapshotEffects 的 catch 是给真异常留的,封场收队是生命
// 周期规则,响 error 日志反而掩真错。
let sealed = false;

// ② 出牌线横幅错位(#849 棒2)的在途定时器账本:setTimeout 句柄只用于换局清场
// (resetFxOrchestration 统一 clearTimeout);fire 拍 sealed 守卫 = D2 生命周期规则
// (错位窗内胜利屏挂载封场,线随表现层收队不补发),非兜底。
const delayedLineTimers = new Set<ReturnType<typeof setTimeout>>();

/** 终局封场:胜利屏挂载时调用(VictoryScreen);封场后一切 present 立即收队。 */
export function finishPresentation(): void {
  sealed = true;
  finishDiceOverlay();
  finishDuelSigns();
}

// ─────────────────────── 播放器 ───────────────────────
/** 播放一组表现事件:串行 await,顺序 = 数组顺序。所有外设经 FxSink 驱动
 *  (生产 = createEngineSink 单例组装;测试 = createMemorySink 录制)。
 *  金钱飞行归账(#764)在此合帧:进账(cashDelta/supplyRain 且 amount>0)先记入
 *  待飞账本,紧邻的连续进账并一枚,遇第一个非进账事件(同步印章也算)或批尾才
 *  cashFly 冲账——同席位合并成「一枚总差额」防粒子雨,来源锚点取最后一笔现场;
 *  被任何演出隔开(骰子/行军/签面等占时长的,或印章等同步件)即分帧各飞。出账
 *  (amount<0)不飞(反向可后置,#764 票面只硬性要求进账方向)。 */
export async function present(events: PresentationEvent[], sink: FxSink): Promise<void> {
  const flyPend = new Map<string, { amount: number; x: number; y: number }>();
  // ③ overlay 互斥补发账本(#849 棒2):同步件(jline/cashFly/floater)是即发即忘的
  // 短命演出,同批内随后开场全屏签面 overlay(掷骰/拼点)时,其残余寿命整个画在
  // z-45 幕下不可见——暂存于此,overlay 收场按入队序补发。批内仍将开场 overlay 时
  // (overlayAheadFrom)才入账,补发拍 = 最后一场 overlay 收场(中途场不冲账,防
  // 补发件落进下一场的幕下);批尾账本恒空:入账前提是批内确有 overlay 事件,而
  // overlay case 收场即冲账——封场(sealed)提前收队时账本随队一并弃,同 flyPend。
  const deferred: (() => void)[] = [];
  const flushDeferred = () => {
    for (const fn of deferred) fn();
    deferred.length = 0;
  };
  /** 批内位次 i 之后是否还有全屏 overlay 事件(同步件延后判据;播放期零引擎读取,
   *  前视的是已提取的表现事件数组,ADR-0029 不变量①同域)。 */
  const overlayAheadFrom = (i: number) =>
    events.slice(i + 1).some((e) => e.kind === "diceRolled" || e.kind === "duelSigns");
  const flushFlies = (defer: boolean) => {
    if (flyPend.size === 0) return;
    for (const [playerId, f] of flyPend) {
      const fly = () => sink.cashFly({ playerId, ...f });
      if (defer) deferred.push(fly);
      else fly();
    }
    flyPend.clear();
  };
  for (const [i, ev] of events.entries()) {
    if (sealed) {
      for (const rest of events.slice(i)) {
        if (rest.kind === "tokenMoved") abandonMarch(rest.playerId);
      }
      return; // 终局封场收队:待飞账本/补发账本一并弃(对局已结束,无演出可言)
    }
    // ③ 本事件的同步件是否延后:overlay 事件本身也按真计——紧随其开幕的冲账飞行
    // 会整段画在幕下,一并延后到收场。
    const deferSync = ev.kind === "diceRolled" || ev.kind === "duelSigns" || overlayAheadFrom(i);
    if (ev.kind !== "cashDelta" && ev.kind !== "supplyRain") flushFlies(deferSync);
    switch (ev.kind) {
      case "diceRolled":
        // C1:bot 掷骰半速——速度开关在掷前设置(roll 内即消费复位);
        // 不走 FxSink 参数是因生产 sink(sinks.ts)不透传附加参数。
        setDiceFast(ev.fast === true);
        // ③ overlay 挂摘置位:roll() 的 Promise 在 overlay 移除后才 resolve,
        // 置位窗恰 = 签面在场的挂→摘全程(fxStore.overlayActive)。
        useFxStore.getState().setOverlayActive(true);
        await sink.rollDice(ev.die);
        useFxStore.getState().setOverlayActive(false);
        if (!overlayAheadFrom(i)) flushDeferred(); // 批内还有下一场 overlay 则续延
        break;
      case "tokenMoved":
        // 不变量①哑渲染:逐帧坐标提取拍已烤进事件,present 只透传(零引擎读取)。
        await sink.marchToken(ev.playerId, ev.keyframes);
        break;
      case "cashDelta": {
        // 金额浮字不带铜钱雨(coins 档随税关退役清退 #828,雨唯一通路=supplyRain);
        // ③ 批内仍将开场 overlay 时浮字延后到收场补发(现画在幕下不可见),飞行账本照常累积。
        const spawn = () => sink.spawnFloater(ev.x, ev.y, ev.amount, false);
        if (deferSync) deferred.push(spawn);
        else spawn();
        if (ev.amount > 0) {
          const pend = flyPend.get(ev.playerId);
          flyPend.set(ev.playerId, {
            amount: (pend?.amount ?? 0) + ev.amount,
            x: ev.x, // 来源锚点取该席位最后一笔进账的(合并枚从最后现场起飞)
            y: ev.y,
          });
        }
        break;
      }
      case "supplyRain": {
        const spawn = () => sink.spawnFloater(ev.x, ev.y, ev.amount, true);
        if (deferSync) deferred.push(spawn);
        else spawn();
        if (ev.amount > 0) {
          const pend = flyPend.get(ev.playerId);
          flyPend.set(ev.playerId, {
            amount: (pend?.amount ?? 0) + ev.amount,
            x: ev.x,
            y: ev.y,
          });
        }
        break;
      }
      case "textFloat": {
        // skill=#850 技能演出档(cast=施展升档/tag=被动小签),与普通文案浮字同通路
        // 同步件(deferSync 判据共享:overlay 在场/将开场时一并延后补发)。
        const spawn = () => sink.spawnTextFloater(ev.x, ev.y, ev.text, ev.skill);
        if (deferSync) deferred.push(spawn);
        else spawn();
        break;
      }
      case "sealStamped":
        sink.stampSeal(ev.x, ev.y, ev.char, ev.tone);
        break;
      case "landPulse":
        // 落格定音(S7):金圈一拍,同步下发 CSS 自走(坐标提取烤好)。
        sink.landPulse(ev.x, ev.y);
        break;
      case "duelSigns":
        // 拼点签面(#637,ADR-0030):全屏多签演出整场,await 到收口——串行编排
        // 保证签面收场后棋盘后效(止步/续走/银两浮字)才登场。
        // ③ 挂摘置位同 diceRolled(play() 在 overlay 移除后才 resolve)+ 收场补发。
        useFxStore.getState().setOverlayActive(true);
        await sink.showDuelSigns(ev);
        useFxStore.getState().setOverlayActive(false);
        if (!overlayAheadFrom(i)) flushDeferred();
        break;
      case "haltBanner":
        // 都城停条带(#732 降格,原 S7 全屏宣告):号角同拍,等条带读过峰值段再接驻章
        // (同 turnBanner 的 C3 口径;生产 sink 返回 void,不收签名;占用窗按条带级
        // 校准 = haltHoldMs)。
        sink.showHaltBanner(ev);
        await delay(FX.haltHoldMs);
        break;
      case "bankruptCeremony":
        // 破产仪式(S7):三拍串行编排(倒旗→墨渍→撒币,三音随拍),await 到收口。
        await sink.bankruptCeremony(ev);
        break;
      case "turnBanner":
        // C3:横幅占用编排时长——showBanner 置 store 即返回(音画由 CSS 动画自走),
        // 全幅播出时此处显式等峰值停留段(FX.bannerHoldMs),下一演出(骰子)不再与
        // 横幅入场重叠。#762:槽泵判 bot→bot 同轮连续折叠为胶囊更新(false)——无横幅
        // 可读即无停留窗,bot 链节奏不被拖满;不改 FxSink.showBanner 为 Promise:
        // 生产实现(sinks.ts)同步判定,签名收 boolean 即可。
        if (sink.showBanner(ev.guohao, ev.colorIndex, { isBot: ev.isBot, round: ev.round })) {
          await delay(FX.bannerHoldMs);
        }
        break;
      case "sound":
        sink.playSound(ev.event);
        break;
      case "jinnangPlayed": {
        // 出牌指示线(#281 P2-E):每目标一段,数量恒小(锦囊目标域至多全体)。
        // 下发时序两判据(#849 棒2,互斥按优先级):
        //   ③ 批内仍将开场全屏 overlay → 收场补发(deferred 账本,拦检线先例:
        //      reactionAnswered 线与 duelResolved 同批,现画在签面幕下不可见);
        //   ② 同批随后开反应窗(识破窗挂点:reactionOpen 音随批)→ 错位到反应横幅
        //      亮相后 ~250ms 再落线——横幅入场即横向铺开吞线,亮相落定后再落线,
        //      线在横幅外露段+锚点才读得出「谁打了谁」;只错位线,浮字/开窗音照常。
        //   两判据皆否 → 即发即忘(原制)。
        const dispatchLines = () => {
          for (const l of ev.lines) sink.spawnJinnangLine(l.x1, l.y1, l.x2, l.y2);
        };
        if (deferSync) {
          deferred.push(dispatchLines);
        } else if (
          events.slice(i + 1).some((e) => e.kind === "sound" && e.event === "reactionOpen")
        ) {
          const t = setTimeout(() => {
            delayedLineTimers.delete(t);
            if (sealed) return; // D2 封场:错位窗内胜利屏挂载,线随表现层收队
            dispatchLines();
          }, scStage(250));
          delayedLineTimers.add(t);
        } else {
          dispatchLines();
        }
        break;
      }
      case "peekRevealed":
        // 窥探弹层(#575):viewer-only 演出同步下发(fxStore 开关态,关闭即清),
        // 不占编排时长——游戏在弹层后照常推进;非 viewer 座位由弹层组件按
        // viewerSeat===本座自门(零渲染)。
        sink.revealPeek(ev);
        break;
      case "propertyChanged":
        // 城池宣告(ADR-0015):经 sink 下发 nonce 驱动 Tile 重播宣告动画。
        // 同步下发(无编排时长)——与相邻事件的相对序由 store 写入序保证。
        sink.announceTileChange(ev);
        break;
    }
  }
  flushFlies(false); // 批尾冲账:纯进账批(无后继演出可隔)的合并枚在此起飞(批内已无 overlay,不延)
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
  for (const t of delayedLineTimers) clearTimeout(t); // ② 错位在途定时器随局清
  delayedLineTimers.clear();
  useFxStore.getState().resetFx();
}

export { beginMarch, animateMove };

/** 金额格式化(FxLayer 共用口径:+/− 前缀)。 */
export function formatFloater(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`;
}
