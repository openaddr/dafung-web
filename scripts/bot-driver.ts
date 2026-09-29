// bot/接管/托管驱动(ADR-0002 接管;spec: autopilot)——从 room.ts 拆出(模块治理 10/11 #327,纯搬不改)。
// 连续驱动服务器控制的决策点:bot 座位走 botAct,接管/托管座位代驾,冻结真人座位不驱动。
// registry 经 DriveBotsHost 注入 observe/persist/applyCommand 与看门狗组;本模块零 WS/fs。
import { botAct } from "../src/core/bot";
import type { GameEngine } from "../src/core/game";
import type { GameCommand, ReactionView } from "../src/core/types";
import type { RoomBotStopReason, RoomEvent, RoomSession } from "./room";
import { fingerprint, seatControlled } from "./seat-projection";
import type { Watchdogs } from "./watchdogs";

type UpdateFn = (room: RoomSession) => void;

/** 慢速托管:每步决策间隔(ms)——玩家看得清 bot 在做什么。 */
export const AUTOPILOT_SLOW_MS = 2000;

// botAct 能驱动的相位(其它相位是引擎内部过渡,无需外部驱动)
const INPUT_PHASES = new Set([
  "Roll",
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingEncounter", // 抉择机遇(#124):bot 贪心策略,见 bot.ts
  "AwaitingJinnang", // 锦囊(#122/T2):bot 恒「今不用」保守推进(策略表在 T6)
  "AwaitingExhaustion", // 体力耗竭(#130):bot 随机弃城
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
  "AwaitingReaction", // 反应窗(#281):bot 座位引擎开窗即席代答;人类座位等 respondReaction
  // (driveBots 循环头特判收敛「待应答人类座位」,不走 botAct——决策方
  // 天然多属主,decisionOwner 不适用)
]);

/** 该座位当前步进延迟:托管慢速 2s,其余(bot 座位/takeover/托管快速)为 0。 */
function stepDelayMs(r: RoomSession, seat: number): number {
  return r.autoPilot.get(seat) === "slow" ? AUTOPILOT_SLOW_MS : 0;
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
  /** 三组看门狗(链首 clear / 链尾按停点重武装)。 */
  readonly watchdogs: Watchdogs;
}

/** 进行中的驱动链(重入守卫:慢速托管 await 期间,新命令/新触发不再开第二条链,
 *  由挂起中的循环继续接管——它每步重查状态,天然覆盖后续进展)。
 *  原 registry 实例字段,随拆平移为模块级:RoomSession 每房间唯一对象,WeakSet
 *  按对象区分,跨注册表不串(会话对象从不跨 registry 驱动)。 */
const driving = new WeakSet<RoomSession>();

/** 连续驱动服务器控制的决策点,直到轮到人类(在线或冻结)/ 游戏结束 / 无进展。
 *  Setup·PickCapital 期决策点=当前选都座位(currentSetupPlayerIndex,真人等 WS
 *  pickCapital);Playing 期=decisionOwner。关键:冻结的人类座位不被驱动
 *  (seatControlled=false)→ 游戏等其重连或房主接管。
 *  慢速托管座位每步间延迟 2s(异步);每步 persist + onUpdate:客户端能逐步看到动作。
 *  返回 Promise:fast 模式下任务同步完成(零延迟),语义与旧同步版一致。 */
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
    while (e.phase !== "GameOver" && guard++ < 500) {
      // 反应窗(#281,ADR-0017):bot 座位引擎开窗时已即席代答,这里只等人类座位——
      // 托管/接管(代驾)立即代发「不用」(#148/#229 口径,超时兜底也是同款普通命令);
      // 在线/离线真人在链尾按座位武装超时定时器(归零代发 respondReaction{use:false})。
      // 决策方天然多属主,decisionOwner/botAct 都不适用,故先于通用路径特判。
      if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
        const pr = e.pendingReaction;
        const queried = pr ? reactionQueriedSeats(pr.view) : [];
        for (const seat of queried) {
          if (pr!.answers.some((a) => a.seat === seat)) continue; // 已应答
          if (!seatControlled(r, seat)) continue; // 代驾座位才立即代发
          await host.applyCommand(r.roomId, { type: "respondReaction", seat, use: false }, onUpdate);
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
        : INPUT_PHASES.has(e.turnPhase);
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
      else
        botAct(e, {
          conservative: r.takeover.has(owner) && !r.autoPilot.has(owner),
          skills: e.players[owner].isBot ? "strategy" : "hold",
        }); // #118×#148:接管=保守(看门狗/房主接管不替玩家花锦囊),自助托管=按策略;#188 档 3:主动技唯真 bot 出,代驾(接管/托管)永不出
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
      if (delay > 0) await new Promise((res) => setTimeout(res, delay));
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
      setTimeout(
        () => {
          void driveBots(host, r, onUpdate);
        },
        stepDelayMs(r, guardOwner),
      );
    }
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
