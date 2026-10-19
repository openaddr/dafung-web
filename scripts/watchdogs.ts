// 四组同构看门狗——从 room.ts 拆出并收敛为一个通用工厂(模块治理 10/11 #327)。
//   #118 决策停摆 stall:真人座位停在决策点超时 → 看门狗代开托管(ADR-0028)
//   #188 自动起摇 autoRoll:Roll 相位超时 → 服务器代发 rollAndMove(行军自动化)
//   #281/#284 反应窗 reactionWait:开窗超时 → 代发「不用」(ADR-0017)
//   #380 掉线保留窗 retention:对局中断线座位保留窗口到期 → 看门狗代开托管(ADR-0028)
// 代开托管 = 拨唯一「托管」开关(autoPilot.add,by:"watchdog",只开不关;重连不清,
// 本人点「收回」拿回控制)。原三份手写 clear/arm/fire 同构三件套收敛为 createWatchdog
// 工厂:返回 {clear, arm, disarm} 实例,三组各自配置「武装窗口(tag+delayMs)」与
// 「到点动作」;行为(超时时长/触发动作/清理时机)与拆分前逐一对齐,由 room.test.ts
// 与同种子对拍兜底。registry 经 WatchdogHost 注入房间侧操作;本模块零 WS/HTTP/fs 依赖。
import type { GameCommand } from "../src/core/authority";
// 节拍单源(#399):AUTO_ROLL_DELAY_MS 全局唯一定义处 = src/core/timings.ts(单机/联机同表)。
import { AUTO_ROLL_DELAY_MS } from "../src/core/timings";
import type { RoomClock, RoomEvent, RoomSession } from "./room";
import { decisionSeatOf, reactionQueriedSeats } from "./bot-driver";
import { seatControlled } from "./seat-projection";

type UpdateFn = (room: RoomSession) => void;

/** 看门狗宿主:registry 注入的房间侧操作(与 bot-driver 的 DriveBotsHost 同由
 *  registry 内一个 ops 对象满足;watchdogs 不反向 import registry)。 */
export interface WatchdogHost {
  /** 房间会话仍存活:rooms.get(roomId) === r(fire 重校验用)。 */
  isCurrentRoom(r: RoomSession): boolean;
  /** 观测事件(可观测性基建,ADR-0007)。 */
  observe(r: RoomSession, event: RoomEvent): void;
  /** 房间生命周期行写进对局日志(ADR-0014),写完触发日志落盘钩子。 */
  logRoom(r: RoomSession, brief: string, detail: string): void;
  persist(r: RoomSession): void;
  applyCommand(roomId: string, cmd: GameCommand, onUpdate?: UpdateFn): Promise<void>;
  driveBots(r: RoomSession, onUpdate?: UpdateFn): Promise<void>;
  /** #118 决策停摆超时(ms);0 = 关闭(缺省关,测试友好)。 */
  readonly decisionTimeoutMs: number;
  /** #380 掉线座位保留窗口(ms);0 = 关闭(缺省关,单机/测试;服务器默认 10 分钟)。 */
  readonly retentionWindowMs: number;
  /** 定时原语(#399 Worker 时钟注入点):武装/撤表全经它,服务器=全局、单机=Worker。 */
  readonly clock: RoomClock;
}

/** 单组看门狗实例:clear=整房撤表(链重开/解散时);arm=按座位武装;disarm=按座位
 *  撤单表(#380 重连等座位级事件)。fire 由工厂内部调度,不对外。 */
export interface Watchdog {
  clear(roomId: string): void;
  arm(r: RoomSession, seat: number, onUpdate?: UpdateFn): void;
  disarm(roomId: string, seat: number): void;
}

export interface Watchdogs {
  stall: Watchdog; // #118 决策停摆
  autoRoll: Watchdog; // #188 自动起摇
  reactionWait: Watchdog; // #281/#284 反应窗
  retention: Watchdog; // #380 掉线座位保留窗
}

/** 单组配置:window 算本轮武装窗口——undefined=当前无职责(不武装);tag 相同=
 *  同窗已武装(不重置,deadline 一次算死);tag 变=撤旧起新。fire=到点动作:
 *  工厂已删本火表项,守卫不满足自行静默退出(触发动作归各组,工厂不代劳)。 */
interface WatchdogSpec {
  window(r: RoomSession, seat: number): { tag: number; delayMs: number } | undefined;
  fire(r: RoomSession, seat: number, onUpdate?: UpdateFn): Promise<void> | void;
}

/** 通用工厂:roomId → (座位 → {timer, seq}) 表 + clear/arm/disarm/fire 四件套。
 *  arm:同 tag 跳过(不重置倒计时),tag 变撤旧起新;unref 不拖延进程退出。
 *  disarm:按座位撤单表(#380 重连撤保留窗;不触碰同房其他座位的计时)。
 *  fire:先核对本火仍属当前表项(seq 不同=已被重武装,本火过期,不动新表),删本火
 *  表项(房间表空则整行撤)后交 spec.fire 重校验+动作——清理时机与拆分前逐一相同。
 *  定时全经注入时钟(#399):服务器=全局 setTimeout,单机=Worker 时钟(失焦照跑)。 */
function createWatchdog(spec: WatchdogSpec, clock: RoomClock): Watchdog {
  const table = new Map<string, Map<number, { timer: unknown; seq: number }>>();
  const clear = (roomId: string): void => {
    const slots = table.get(roomId);
    if (!slots) return;
    for (const w of slots.values()) clock.clearTimeout(w.timer);
    table.delete(roomId);
  };
  const disarm = (roomId: string, seat: number): void => {
    const slots = table.get(roomId);
    const w = slots?.get(seat);
    if (!w) return;
    clock.clearTimeout(w.timer);
    slots!.delete(seat);
    if (slots!.size === 0) table.delete(roomId);
  };
  const fire = async (
    r: RoomSession,
    seat: number,
    armedTag: number,
    onUpdate?: UpdateFn,
  ): Promise<void> => {
    const slots = table.get(r.roomId);
    const cur = slots?.get(seat);
    if (cur == null || cur.seq !== armedTag) return; // 表项已换窗:本火过期,不动新表(#284)
    slots!.delete(seat);
    if (slots!.size === 0) table.delete(r.roomId);
    await spec.fire(r, seat, onUpdate);
  };
  const arm = (r: RoomSession, seat: number, onUpdate?: UpdateFn): void => {
    const win = spec.window(r, seat);
    if (win == null) return;
    let slots = table.get(r.roomId);
    const old = slots?.get(seat);
    if (old) {
      if (old.seq === win.tag) return; // 同窗已武装:到期时刻一次算死,不重置(#284)
      clock.clearTimeout(old.timer); // 换窗(行军续走下一城等):撤旧起新
    }
    const timer = clock.setTimeout(() => void fire(r, seat, win.tag, onUpdate), win.delayMs);
    (timer as { unref?: () => void }).unref?.(); // 宿主进程 courtesy(Worker 时钟句柄无 unref)
    (slots ??= new Map()).set(seat, { timer, seq: win.tag });
    table.set(r.roomId, slots);
  };
  return { clear, arm, disarm };
}

/** stall/autoRoll 的武装序号:每次武装递增 → 永不与旧表项同 tag(每次必重算,
 *  同拆分前「同房间旧计时器先撤」的语义)。 */
let armSeq = 0;

/** 四组看门狗(registry 构造时创建一次,随注册表生命周期)。 */
export function createWatchdogs(host: WatchdogHost): Watchdogs {
  // 看门狗代开托管(stall/retention 两道 fire 共用,ADR-0028):拨唯一「托管」开关 +
  // autopilot(by:"watchdog")观测行 + 对局日志行(brief 同形状机读 detail)+ persist,
  // 再由调用方续推 driveBots 解冻。开关只开不关;出处只进日志,行为与自助托管无分叉。
  const watchdogOpenAutoPilot = async (
    r: RoomSession,
    seat: number,
    brief: string,
    onUpdate?: UpdateFn,
  ): Promise<void> => {
    r.autoPilot.add(seat);
    host.observe(r, { ev: "autopilot", seat, on: true, by: "watchdog" });
    host.logRoom(r, brief, JSON.stringify({ type: "autopilot", seat, on: true, by: "watchdog" }));
    host.persist(r);
    onUpdate?.(r); // 先广播托管(客户端「托管中」徽章置位;托管座位 isBot 不变,等待条走真人措辞)
    await host.driveBots(r, onUpdate); // 若该座位正轮到,解冻续推
  };
  return {
    // ──────────────────── 决策停摆看门狗(#118)────────────────────
    // 武装:decisionTimeoutMs 后若仍停在同一未被托管的真人座位 → 看门狗代开托管
    // (ADR-0028)。同房间旧计时器先撤(决策点换了,重算)。driveBots 出口仅在
    // decisionTimeoutMs>0 时武装(0=关闭,历史行为)。
    stall: createWatchdog(
      {
        window: () => ({ tag: ++armSeq, delayMs: host.decisionTimeoutMs }),
        /** 超时触发:重校验(房间还在/对局未终/仍停在该座位/该座位仍未被托管)后
         *  代开托管并续推连锁。重连不清托管,原玩家点「收回」拿回控制(ADR-0028)。 */
        fire: async (r, seat, onUpdate) => {
          const e = r.engine;
          if (!host.isCurrentRoom(r) || !e || e.isOver) return;
          const owner = decisionSeatOf(e);
          if (owner !== seat || seatControlled(r, seat)) return;
          await watchdogOpenAutoPilot(
            r,
            seat,
            `座位 ${seat}(${e.players[seat].guohao}) 决策停摆超 ${Math.round(host.decisionTimeoutMs / 1000)} 秒,自动托管`,
            onUpdate,
          );
        },
      },
      host.clock,
    ),
    // ──────────────────── 行军自动化(#188 第 1 步)────────────────────
    // 武装:AUTO_ROLL_DELAY_MS 后若仍停在同一未被托管的真人座位的 Roll 相位 → 服务器代发
    // rollAndMove(走 applyCommand 公共命令路径:submitCommand 记 cmd 行 + persist + 广播,
    // 与玩家手点同源)。离线冻结的座位同样代发——Roll 无决策内容,不因离线卡住行军;
    // 真正的抉择仍归本人(超时才由 #118 看门狗代开托管)。同房间旧计时器先撤(决策点换了,
    // 重算)。
    autoRoll: createWatchdog(
      {
        window: () => ({ tag: ++armSeq, delayMs: AUTO_ROLL_DELAY_MS }),
        /** 到点触发:重校验(房间还在/对局未终/仍停在该座位的 Roll/该座位仍未被托管——
         *  托管后 Roll 归 botAct 驱动,不重复代发)后经 applyCommand 起摇。 */
        fire: async (r, seat, onUpdate) => {
          const e = r.engine;
          if (!host.isCurrentRoom(r) || !e || e.isOver || e.phase !== "Playing") return;
          if (e.turnPhase !== "Roll" || decisionSeatOf(e) !== seat || seatControlled(r, seat))
            return;
          host.observe(r, { ev: "auto-roll", seat });
          await host.applyCommand(r.roomId, { type: "rollAndMove" }, onUpdate);
        },
      },
      host.clock,
    ),
    // ──────────────────── 反应窗超时兜底(#281,ADR-0017)────────────────────
    // 可能多座位同时被询问(AOE),按房间持座位表各配一表;#284 起 seq 判据管重武装
    // (arm)——链重开不再整体撤表,deadline 一次算死;clear(链重开不走,唯一调用点
    // 是解散清理)按房间整表撤。
    reactionWait: createWatchdog(
      {
        /** 武装(#284 seq 判据):REACTION_WINDOW_MS(或 env 覆盖值)后若该座位仍是本窗
         *  待应答的非服务器驱动人类座位 → 服务器代发 respondReaction{use:false}(走
         *  applyCommand 公共命令路径,与玩家手点同源;ADR-0017:超时兜底=权威侧代发普通
         *  命令,重放天然复现)。同窗(PendingReaction.seq 未变)且已武装 → 跳过不重武装:
         *  deadline 开窗一次算死,链重开/他人命令不重置他人倒计时(FreeKill request.lua
         *  「timestamp+timeout 随包下发、同窗不重置」同语义);seq 变了才撤旧起新。
         *  离线冻结座位同样武装——断线者超时即「不用」,不冻结对局(ADR-0017 后果节)。 */
        window: (r) => {
          const e = r.engine;
          if (e?.pendingReaction == null) return undefined;
          const pr = e.pendingReaction;
          return {
            tag: pr.seq,
            delayMs: pr.view.windowMs, // 已由引擎开窗时解析(override 在 EngineConfig 单点),此处不二次推导(#284 评审)
          };
        },
        /** 到点触发(工厂已核对本火表项):重校验(房间还在/对局未终/仍在
         *  AwaitingReaction/该座位仍被询问且未应答/仍非服务器驱动)后代发「不用」。
         *  任何一条不满足=窗已被应答或代驾已接手,静默退出。 */
        fire: async (r, seat, onUpdate) => {
          const e = r.engine;
          if (!host.isCurrentRoom(r) || !e || e.isOver || e.phase !== "Playing") return;
          if (e.turnPhase !== "AwaitingReaction" || e.pendingReaction == null) return;
          const pr = e.pendingReaction;
          if (!reactionQueriedSeats(pr.view).includes(seat)) return;
          if (pr.answers.some((a) => a.seat === seat)) return;
          if (seatControlled(r, seat)) return; // 代驾接手:循环头已立即代发,不重复
          host.observe(r, { ev: "reaction-decline", seat });
          await host.applyCommand(
            r.roomId,
            { type: "respondReaction", seat, use: false },
            onUpdate,
          );
        },
      },
      host.clock,
    ),
    // ──────────────────── 掉线座位保留窗(#380,ADR-0002/0005)────────────────────
    // 武装:markSeatOffline(对局中 WS 断开)时按座位挂保留窗——retentionWindowMs 内
    // 持 token 重连即归座(attachSeat 撤本座表项);窗口到期未归 → 看门狗代开托管
    // (ADR-0028):写 autoPilot 集 + autopilot(by:"watchdog")观测行 + 对局日志行,
    // driveBots 解冻续推;重连不清托管,原玩家点「收回」拿回控制(token 不因保留窗
    // 到期失效,ADR-0005,口径见 docs/explanation/联机架构.md §6)。窗口期内该座位
    // 回合到来维持冻结停摆不变(ADR-0002 默认冻结;若另配 #118 看门狗,它按自身窗口
    // 独立兜底,两窗互不代替)。大厅(engine=null)/已终局/已被服务器驱动(托管/原生
    // bot)的座位不武装(判定归 window,markSeatOffline 无需预筛)。retentionWindowMs=0
    // (缺省)不武装。
    retention: createWatchdog(
      {
        window: (r, seat) => {
          if (host.retentionWindowMs <= 0) return undefined;
          const e = r.engine;
          if (!e || e.isOver) return undefined;
          if (r.seats[seat].kind !== "human" || seatControlled(r, seat)) return undefined;
          return { tag: ++armSeq, delayMs: host.retentionWindowMs };
        },
        /** 到点触发:重校验(房间还在/对局未终/仍为人类座位/仍未被托管——窗口内已
         *  托管则不动)后代开托管并续推连锁。 */
        fire: async (r, seat, onUpdate) => {
          const e = r.engine;
          if (!host.isCurrentRoom(r) || !e || e.isOver) return;
          if (r.seats[seat].kind !== "human" || seatControlled(r, seat)) return;
          await watchdogOpenAutoPilot(
            r,
            seat,
            `座位 ${seat}(${e.players[seat].guohao}) 断线保留窗(${Math.round(host.retentionWindowMs / 1000)} 秒)到期,自动托管`,
            onUpdate,
          );
        },
      },
      host.clock,
    ),
  };
}
