// 驱动仲裁器(Wave 2-A):单机四路异步流程(人类步/托管代打/开局接棒/选都)对
// 「谁来推进引擎」的争抢,原先靠共享 busy 布尔 + apLoop 的 delay(80) 轮询锁 +
// onEnterGame 的 if(busy) 幂等拼凑。本模块把它收口为一个显式的互斥队列:
//
// - 同一时刻仅一个 drive 会话活跃;排队者按 FIFO(对照联机端 room.ts driveBots 的
//   「已有链在跑:它会把新进展接走」单飞语义,只是把"轮询发现"换成"队列唤醒",
//   消除 80ms 轮询粒度带来的时序抖动)。
// - 防重入:同一 kind 已在队列 → 直接复用该次请求的 Promise(去重)。对照现状:
//   人类步的二连点被 interactive(!busy) 拦在门外、托管靠 apLoopRunning 单飞、
//   onEnterGame 靠 if(busy) return——它们都不该产生第二个排队者,去重只是兜底。
// - isDriving() 是 busy 的查询等价物:interactive 锁(原 canAct 参数,已内联进
//   各子类 interactive getter)改读它,busy 从此成为仲裁器私有态,local.ts 不再持有
//   可被四处置位的布尔。
//
// 设计约束:requestDrive 在空闲时**同步**完成占用激活(返回前 isDriving() 已为真),
// 以保持旧代码 `this.busy = true` 同步置位的时序语义——dispatchCommand 的
// interactive 检查与锁占用之间没有任何可插入的异步间隙。

/** 驱动来源:human=人类命令步(含选都),autopilot=托管代打,enter=进入对局的接棒。 */
export type DriveKind = "human" | "autopilot" | "enter";

/** 一次驱动会话的释放句柄:持有期间独占引擎推进权。release 幂等,且只对
 *  「当前活跃会话」生效——过期句柄(已被释放后再度调用)不会误杀新会话。 */
export interface DriveSession {
  readonly kind: DriveKind;
  release(): void;
}

export interface DriveArbiter {
  /** 请求驱动权:空闲则(同步)激活并立即可用;忙则 FIFO 排队,队首会话释放后唤醒。
   *  同一 kind 已有排队请求时返回同一个 Promise(去重,两个等待者共用一个会话)。 */
  requestDrive(kind: DriveKind): Promise<DriveSession>;
  /** 是否有驱动会话活跃(busy 的新等价物,供 interactive 锁与幂等检查查询)。 */
  isDriving(): boolean;
  /** 当前活跃会话的 kind(无则 null;调试/测试断言用)。 */
  activeKind(): DriveKind | null;
}

/** 会话对象的内部实现(released 防重复释放;见 release 注释)。 */
interface DriveSessionImpl extends DriveSession {
  released: boolean;
}

/** 新建一个独立仲裁器实例(默认导出单例见 localDrive;测试各自新建互不串扰)。 */
export function createDriveArbiter(): DriveArbiter {
  let active: DriveSessionImpl | null = null;
  // FIFO 等待队列:resolve 唤醒等待者;promise 供同 kind 去重时复用。
  const queue: { kind: DriveKind; resolve: (s: DriveSession) => void; promise: Promise<DriveSession> }[] = [];
  const pending = new Map<DriveKind, Promise<DriveSession>>();

  const pump = (): void => {
    if (active || queue.length === 0) return;
    const w = queue.shift()!;
    pending.delete(w.kind);
    const session: DriveSessionImpl = {
      kind: w.kind,
      released: false,
      release() {
        // 幂等 + 仅当自己仍是活跃会话时生效:防止共享句柄/迟到 release 误释放后继会话。
        if (this.released || active !== this) return;
        this.released = true;
        active = null;
        pump(); // 立即激活队首("释放后队首继续",无轮询延迟)
      },
    };
    active = session;
    w.resolve(session);
  };

  return {
    requestDrive(kind: DriveKind): Promise<DriveSession> {
      // 防重入:同 kind 已在排队 → 复用该请求(现状语义:这些调用方本就不该产生
      // 第二个排队者,去重是结构性兜底而非行为分支)。
      const queued = pending.get(kind);
      if (queued) return queued;
      let resolve!: (s: DriveSession) => void;
      const promise = new Promise<DriveSession>((r) => {
        resolve = r;
      });
      queue.push({ kind, resolve, promise });
      pending.set(kind, promise);
      pump(); // 空闲时同步激活:调用方 await 前 isDriving() 已为真(旧 busy 同步置位语义)
      return promise;
    },
    isDriving: () => active !== null,
    activeKind: () => active?.kind ?? null,
  };
}

// 注意:不提供模块级单例——旧 busy 是 LocalController 的实例态(测试可并行构造多个
// 控制器互不串扰),仲裁器随实例创建(local.ts 的 private readonly drive)。
