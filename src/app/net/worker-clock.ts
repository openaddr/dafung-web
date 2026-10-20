// Worker 时钟(#399 单机统一 C):进程内房间编排的节拍不随页面可见性漂移。
// 浏览器对后台标签页的主线程定时器层层节流(≥1s 粒度 → 长期后台深度节流至分钟级),
// 看门狗(#188 自动起摇/#281 反应窗/#118 停摆)与托管步进挂在主线程即被卡死——
// 联机的节拍住在常驻前台的服务器,单机「服务器住在本进程」后同构的最后一环就是
// 把定时原语搬进 Web Worker:Worker 事件循环不受页面节流,到点 postMessage 唤醒
// 主线程(消息事件不被节流),失焦照跑。注入通道:RoomRegistryOptions.clock
// (scripts/room.ts RoomClock);服务器/测试缺省走宿主全局定时器,零行为变化。
//
// 暂停闸(#421 调试观测面):pause() 后到点的回调挂起不执行,resume() 按到点序补放
// (冻结期被 clearTimeout 的回调丢弃)。仅经 window.__dafung.clockPause/clockResume
// 调试面触达——产品路径从不暂停,不暂停时投递路径只多一次布尔判断,行为零变化。
// 用途:e2e 把对局钉在任意停靠态做「种植→点击→断言」手术,根除与自动推进的竞速;
// 冻结后断言仍失败 = 真 bug,上报而不是加更长的睡(零兜底)。
import type { RoomClock } from "../../../scripts/room";

/** 带生命周期与暂停闸的房间时钟:RoomClock + dispose(控制器销毁时停 Worker,
 *  泄漏=bug)+ pause/resume(调试冻结面,#421)+ onFatal(时钟挂死通道,#642 出口③)。 */
export interface WorkerClock extends RoomClock {
  dispose(): void;
  /** 冻结:此后到点的回调挂起(定时本身照走,只扣下投递)。可重入(幂等)。 */
  pause(): void;
  /** 解冻:按到点序补放挂起回调;此后到点照常投递。未暂停时调用=无操作。 */
  resume(): void;
  /** 当前是否冻结(调试面自省用)。 */
  readonly paused: boolean;
  /** 时钟挂死通道(#642 出口③):worker 崩溃(onerror)或 worker 内部异常(fatal
   *  postMessage)= 定时节拍永久不可靠(挂起的 setTimeout 回调永不投递,驱动链/看门狗
   *  全部卡死)。监听方(LocalController)据此对所在房间 abortGame 响亮终局。 */
  onFatal(listener: (message: string) => void): void;
}

/** Worker 内脚本:按 id 定时,到点回发 id;clear 按 id 撤表;任何内部异常转 fatal
 *  回发(#642 出口③触发源:时钟坏=对局停摆,必须响亮,不许静默)。零依赖纯字符串
 *  (blob URL 装载,bun 与浏览器通用,单测可直跑真实 Worker——契约测试经 WORKER_SOURCE)。
 *  export 仅为测试钉契约(abort-exits.test.ts 直跑本源验证 fatal 回发),生产零消费。 */
export const WORKER_SOURCE =
  `let t=new Map();self.onmessage=(e)=>{const d=e.data;` +
  `try{` +
  `if(d.act==="set"){const h=setTimeout(()=>{t.delete(d.id);self.postMessage(d.id)},d.ms);t.set(d.id,h)}` +
  `else{const h=t.get(d.id);if(h!=null)clearTimeout(h);t.delete(d.id)}` +
  `}catch(err){self.postMessage({act:"fatal",message:String((err&&err.message)||err)})}};`;

/** 最近创建且未销毁的 Worker 时钟(单机进程内至多一条存活对局;销毁即让位)。
 *  window.__dafung 冻结面(#421)经 latestWorkerClock() 寻址——调试面不摸
 *  LocalController 私有字段,时钟自己登记。 */
let latest: WorkerClock | null = null;

export function latestWorkerClock(): WorkerClock | null {
  return latest;
}

/** 构造 Worker 时钟:主侧持有「id → 回调」表,worker 只做定时与回发。
 *  worker 异常显式报错(零兜底:时钟坏了=对局停摆,必须响亮,不许静默)——除 console
 *  外经 onFatal 通道上报(#642 出口③),LocalController 据此对所在房间 abortGame。 */
export function createWorkerClock(): WorkerClock {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  let paused = false;
  const held: number[] = []; // 冻结期到点挂起的回调 id(到点序,resume 补放)
  let fatalListener: ((message: string) => void) | null = null;
  const fatal = (message: string): void => {
    console.error("[worker-clock] 时钟挂死,定时节拍已不可靠:", message);
    fatalListener?.(message);
  };
  worker.onmessage = (ev: MessageEvent<number | { act: "fatal"; message: string }>) => {
    if (typeof ev.data !== "number") {
      fatal(ev.data.message); // worker 内部异常自报(fatal postMessage,出口③)
      return;
    }
    const cb = callbacks.get(ev.data);
    if (cb == null) return; // 已在主侧清除:迟到回发丢弃(clear 竞态的正常路径)
    if (paused) {
      held.push(ev.data); // 冻结闸:到点不投递,挂起等 resume
      return;
    }
    callbacks.delete(ev.data);
    cb();
  };
  worker.onerror = (ev: ErrorEvent) => {
    // #642 出口③:worker 崩溃 = 定时节拍永久不可靠(在途回调永不投递)——上报致命通道
    fatal(ev.message || "worker onerror(无错误消息)");
  };
  const clock: WorkerClock = {
    setTimeout(cb: () => void, ms: number): unknown {
      const id = ++nextId;
      callbacks.set(id, cb);
      worker.postMessage({ act: "set", id, ms });
      return id;
    },
    clearTimeout(handle: unknown): void {
      const id = handle as number;
      callbacks.delete(id); // 冻结期挂起中的同 id 一并失效(resume 补放时查表丢弃)
      worker.postMessage({ act: "clear", id });
    },
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
      while (held.length > 0) {
        const id = held.shift()!;
        const cb = callbacks.get(id);
        if (cb == null) continue; // 冻结期被 clear:丢弃
        callbacks.delete(id);
        cb();
      }
    },
    get paused(): boolean {
      return paused;
    },
    onFatal(listener: (message: string) => void): void {
      fatalListener = listener;
    },
    dispose(): void {
      worker.terminate();
      URL.revokeObjectURL(url);
      if (latest === clock) latest = null;
    },
  };
  latest = clock;
  return clock;
}
