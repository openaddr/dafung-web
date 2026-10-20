// bot/托管驱动(#580 代打行为单源;ADR-0028 接管即自动托管)——从 room.ts 拆出(模块治理 10/11 #327)。
// 连续驱动服务器控制的决策点:bot 座位走 botAct,托管代驾(含看门狗代开)同一裸调入口(bot 同款),
// 冻结真人座位不驱动。registry 经 DriveBotsHost 注入 observe/persist/applyCommand 与
// 看门狗组;本模块零 WS/fs。
import { botAct, botReactionDecision, BOT_ATTENDED_PHASES } from "../src/core/bot";
import type { GameEngine } from "../src/core/authority";
import type { GameCommand } from "../src/core/authority";
import type { ReactionView } from "../src/core/reaction-window";
// 节拍单源(#399):AUTOPILOT_STEP_MS 全局唯一定义处 = src/core/timings.ts(单机/联机同表)。
import { AUTOPILOT_STEP_MS } from "../src/core/timings";
import type { RoomClock, RoomBotStopReason, RoomEvent, RoomSession } from "./room";
import { fingerprint, seatControlled } from "./seat-projection";
import type { Watchdogs } from "./watchdogs";

type UpdateFn = (room: RoomSession) => void;

// botAct 能驱动的相位正典 = src/core/bot.ts 的 BOT_ATTENDED_PHASES(契约见该常量:
// 除 AwaitingReaction 外各相位 botAct 直驱,AwaitingReaction 由循环头特判停等
// 人类待应答座位,不走 botAct)

/** 当前决策点座位步进延迟(#399 步进经注入时钟):托管 2s/步(替人玩,节奏像人),
 *  非托管座位为 0。 */
function stepDelayMs(r: RoomSession, seat: number): number {
  return r.autoPilot.has(seat) ? AUTOPILOT_STEP_MS : 0;
}

/** 当前决策点归属座位:Setup·PickCapital=当前选都位,Playing=decisionOwner(珍宝
 *  交涉=城主)。-1 = 无归属(Setup 收尾瞬态),不可驱动。 */
export function decisionSeatOf(e: GameEngine): number {
  return e.phase === "Setup" ? e.currentSetupPlayerIndex : e.decisionOwner;
}

/** 反应窗被询问座位集(#281):与引擎 reactionQueriedOf 同一公式的传输层镜像——
 *  jinnang 窗=持识破者全集,march 窗=[城主]。多座位可同时被询问(AOE),故不适用
 *  单一 decisionOwner 语义。app 层单源在 src/app/controllers/reaction.ts,三层注释互指。 */
export function reactionQueriedSeats(view: ReactionView): number[] {
  return view.kind === "jinnang" ? view.queriedBySeat : [view.ownerSeat];
}

/** 驱动宿主:registry 注入的房间侧操作(bot-driver 不反向 import registry;
 *  与 watchdogs 的 WatchdogHost 同由 registry 内一个 ops 对象满足)。 */
export interface DriveBotsHost {
  observe(r: RoomSession, event: RoomEvent): void;
  persist(r: RoomSession): void;
  applyCommand(roomId: string, cmd: GameCommand, onUpdate?: UpdateFn): Promise<void>;
  /** #118 决策停摆超时(ms);0 = 关闭。 */
  readonly decisionTimeoutMs: number;
  /** #642 驱动链停摆作废窗口(ms);0 = 关闭。联机随 decisionTimeoutMs 同窗,单机
   *  LocalController 显式传 STALL_ABORT_MS(core/timings 单源)。 */
  readonly stallAbortMs: number;
  /** #642 响亮终局房间入口:引擎 abortGame + persist + 常规下行广播(三出口共用)。 */
  abortGame(r: RoomSession, reason: string, onUpdate?: UpdateFn): void;
  /** 三组看门狗(链首 clear / 链尾按停点重武装)。 */
  readonly watchdogs: Watchdogs;
  /** 定时原语(#399 Worker 时钟注入点):托管步进与 guard 续链全经它,
   *  服务器=全局 setTimeout、单机=Worker 时钟(失焦照跑)。 */
  readonly clock: RoomClock;
}

/** 进行中的驱动链(重入守卫:托管 await 期间,新命令/新触发不再开第二条链,
 *  由挂起中的循环继续接管——它每步重查状态,天然覆盖后续进展)。
 *  原 registry 实例字段,随拆平移为模块级:RoomSession 每房间唯一对象,WeakSet
 *  按对象区分,跨注册表不串(会话对象从不跨 registry 驱动)。 */
const driving = new WeakSet<RoomSession>();

/** 连续驱动服务器控制的决策点,直到轮到人类(在线或冻结)/ 游戏结束 / 无进展。
 *  Setup·PickCapital 期决策点=当前选都座位(currentSetupPlayerIndex,真人等 WS
 *  pickCapital);Playing 期=decisionOwner。关键:冻结的人类座位不被驱动
 *  (seatControlled=false)→ 游戏等其重连或保留窗看门狗代开托管(ADR-0028)。
 *  托管每步间 2s(单节拍,#580),经注入时钟异步步进(步间让出宏任务);
 *  每步 persist + onUpdate:客户端能逐步看到动作。
 *  调用方纪律(#529 死锁教训):setAutoPilot 等入口只调度本函数即返回(fire-and-forget),
 *  不得 await 整条链——托管链以 2s/步自续,await 它 = 该命令挂满整条链(生产)/
 *  与 ManualClock 泵法互等死锁(测试)。
 *  #642 死亡出口在本函数闭合两处:链内抛错(出口①,catch → abortGame)与 no-progress
 *  断链(出口②,武装 stallAbort 看门狗);时钟挂死(出口③)在 worker-clock/LocalController
 *  侧闭合——三出口同归 engine.abortGame 响亮终局。 */
export async function driveBots(
  host: DriveBotsHost,
  r: RoomSession,
  onUpdate?: UpdateFn,
): Promise<void> {
  const e = r.engine;
  if (!e) return;
  host.watchdogs.stall.clear(r.roomId); // 新链开跑即撤看门狗:服务器在驱动,无停摆可言(出口重评估)
  host.watchdogs.autoRoll.clear(r.roomId); // #188:同撤自动起摇(链尾按停点重武装)
  // #284:反应窗计时器不再随链撤——链重开会重置他人倒计时(本票修的 bug)。改由
  // reactionWait.arm 按 PendingReaction.seq 判据管重武装:同窗跳过(deadline 一次
  // 算死),换窗才撤旧起新;已收窗的残表项由到点重校验静默退场。
  if (driving.has(r)) return; // 已有链在跑:它会把新进展接走
  driving.add(r);
  try {
    let guard = 0;
    let reason: RoomBotStopReason = "guard";
    // 出口①(#642 响亮终局):链内任何同步抛错(botAct/开局步进/反应窗代发的引擎命令)
    // = 驱动链死亡,finally 删 driving 后无人再拉链(#640 实锤:无声软锁)。链层捕获 →
    // 响亮终局(「显式向用户报错」豁免:异常摘要必须进 abort reason 与对局日志,不许
    // 静默吞),链终止;driving 清理沿用 finally。
    try {
      while (e.phase !== "GameOver" && guard++ < 500) {
        // 反应窗(#281,ADR-0017):bot 座位引擎开窗时已即席代答,这里只等人类座位——
        // 托管/接管代驾按 botReactionDecision 策略答案立即代发(与 bot 同款口径,#580;
        // 在线/离线真人在链尾按座位武装超时定时器,归零代发 respondReaction{use:false})。
        // 决策方天然多属主,decisionOwner/botAct 都不适用,故先于通用路径特判。
        if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
          const pr = e.pendingReaction;
          const queried = pr ? reactionQueriedSeats(pr.view) : [];
          for (const seat of queried) {
            if (pr!.answers.some((a) => a.seat === seat)) continue; // 已应答
            if (!seatControlled(r, seat)) continue; // 代驾座位才立即代发
            const d = botReactionDecision(e, seat);
            await host.applyCommand(
              r.roomId,
              // 协议零新增:应答命令本就携带牌 id/自保份座位可选位,策略答案原样透传(#580)
              {
                type: "respondReaction",
                seat,
                use: d.use,
                cardId: d.cardId,
                shareSeat: d.shareSeat,
              },
              onUpdate,
            );
          }
          // 代发可能收窗续结算(march 续走下一城又开窗也在此链内),重读现场再定去留
          const now = e.pendingReaction;
          const stillWaiting =
            e.turnPhase === "AwaitingReaction" && now != null
              ? reactionQueriedSeats(now.view).filter(
                  (s) => !now.answers.some((a) => a.seat === s) && !seatControlled(r, s),
                )
              : [];
          if (stillWaiting.length > 0) {
            reason = "human-turn"; // 等待真人应答:出口为待应答座位武装 per-seat 定时器
            break;
          }
          continue; // 窗已收/无待应答:回循环头按新相位续推
        }
        // Setup 期(bot/接管/托管代选 aiSetupStepFor)与 Playing 期(botAct)统一到
        // 同一步进骨架:决策点归属与可驱动相位不同,observe/persist/直播/进展检查共用。
        const setup = e.phase === "Setup";
        const owner = decisionSeatOf(e);
        const phaseOk = setup
          ? e.setupPhase === "PickCapital" && owner >= 0
          : BOT_ATTENDED_PHASES.has(e.turnPhase);
        if (!phaseOk) {
          reason = "not-input-phase";
          break;
        }
        if (!seatControlled(r, owner)) {
          reason = "human-turn";
          break;
        }
        const delay = stepDelayMs(r, owner);
        const before = fingerprint(e);
        if (setup) e.aiSetupStepFor(owner);
        else botAct(e); // bot/托管/接管同款裸调(#580 行为单源)
        host.observe(r, {
          ev: "bot-step",
          seat: owner,
          turnPhase: e.turnPhase,
          active: e.activeIndex,
        });
        host.persist(r);
        onUpdate?.(r); // 每步直播
        if (e.isOver) {
          reason = "game-over";
          break;
        }
        if (fingerprint(e) === before) {
          reason = "no-progress";
          break;
        }
        if (delay > 0) await new Promise<void>((res) => host.clock.setTimeout(() => res(), delay));
      }
    } catch (err) {
      // 出口①点火:异常摘要送进 abort reason(引擎终局行随对局日志落账)+ 常规下行
      // 广播,然后链终止(本 catch 即上报通路,非静默;上报自身再炸照常往外抛,零兜底)。
      const summary = err instanceof Error ? err.message : String(err);
      host.abortGame(r, `驱动链异常:${summary}`, onUpdate);
      return;
    }
    if (e.phase === "GameOver") reason = "game-over";
    host.observe(r, {
      ev: "bot-stop",
      reason,
      phase: e.phase,
      turnPhase: e.turnPhase,
      active: e.activeIndex,
    });
    // 步数上限(guard)只防单链失控,不是游戏终界:全 bot/全员托管的长对局会自然超过 500 步。
    // 若未终局且仍轮到服务器驱动的座位 → 休整后自动续链(否则对局会永久卡死——
    // 有人类交互时每次命令都会重开新链,全托管场景没有任何重触发者)。
    const guardOwner = decisionSeatOf(e);
    if (
      reason === "guard" &&
      e.phase !== "GameOver" &&
      guardOwner >= 0 &&
      seatControlled(r, guardOwner)
    ) {
      host.clock.setTimeout(
        () => {
          void driveBots(host, r, onUpdate);
        },
        stepDelayMs(r, guardOwner),
      );
    }
    // 出口②(#642):no-progress 断链且决策座位属服务器驱动(bot/托管)= 链死无人再拉,
    // 武装停摆作废看门狗(窗口=stallAbortMs:联机随 decisionTimeoutMs,单机 STALL_ABORT_MS),
    // 到点 abortGame 响亮终局(见 watchdogs.stallAbort)。0=关;人类可决策的断链不在此列
    //(链只在座位被驱动后才可能 no-progress,守卫式照写防御归属漂移:不可驱动即维持
    // 现状等玩家)。human-turn 既有 stall 武装一行不动(票面红线)。
    if (
      reason === "no-progress" &&
      host.stallAbortMs > 0 &&
      guardOwner >= 0 &&
      seatControlled(r, guardOwner)
    )
      host.watchdogs.stallAbort.arm(r, guardOwner, onUpdate);
    // #118/#188/#281 出口评估:链停在未接管的真人座位——
    // 反应窗(#281):为每个待应答人类座位武装 per-seat 超时定时器(托管/接管座位
    // 已在循环头立即代发,不在待应答集);
    // Roll 相位(无决策内容)武装自动起摇(1s 后代发 rollAndMove);
    // 其余决策相位(等待真人抉择)= 该端拖节奏,武装 #118 看门狗超时接管。
    // not-input-phase/game-over/guard 续链:服务器仍在掌控,不武装。
    if (reason === "human-turn" && guardOwner >= 0) {
      if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
        const pr = e.pendingReaction;
        if (pr != null)
          for (const seat of reactionQueriedSeats(pr.view))
            if (!pr.answers.some((a) => a.seat === seat) && !seatControlled(r, seat))
              host.watchdogs.reactionWait.arm(r, seat, onUpdate);
      } else if (e.phase === "Playing" && e.turnPhase === "Roll")
        host.watchdogs.autoRoll.arm(r, guardOwner, onUpdate);
      else if (host.decisionTimeoutMs > 0) host.watchdogs.stall.arm(r, guardOwner, onUpdate);
    }
  } finally {
    driving.delete(r);
  }
}
