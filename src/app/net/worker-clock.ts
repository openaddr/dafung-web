// Worker 时钟(#399 单机统一 C):进程内房间编排的节拍不随页面可见性漂移。
// 浏览器对后台标签页的主线程定时器层层节流(≥1s 粒度 → 长期后台深度节流至分钟级),
// 看门狗(#188 自动起摇/#281 反应窗/#118 停摆)与慢速托管步进挂在主线程即被卡死——
// 联机的节拍住在常驻前台的服务器,单机「服务器住在本进程」后同构的最后一环就是
// 把定时原语搬进 Web Worker:Worker 事件循环不受页面节流,到点 postMessage 唤醒
// 主线程(消息事件不被节流),失焦照跑。注入通道:RoomRegistryOptions.clock
// (scripts/room.ts RoomClock);服务器/测试缺省走宿主全局定时器,零行为变化。
import type { RoomClock } from "../../../scripts/room";

/** 带生命周期的房间时钟:RoomClock + dispose(控制器销毁时停 Worker,泄漏=bug)。 */
export interface WorkerClock extends RoomClock {
  dispose(): void;
}

/** Worker 内脚本:按 id 定时,到点回发 id;clear 按 id 撤表。零依赖纯字符串
 *  (blob URL 装载,bun 与浏览器通用,单测可直跑真实 Worker)。 */
const WORKER_SOURCE =
  `let t=new Map();self.onmessage=(e)=>{const d=e.data;` +
  `if(d.act==="set"){const h=setTimeout(()=>{t.delete(d.id);self.postMessage(d.id)},d.ms);t.set(d.id,h)}` +
  `else{const h=t.get(d.id);if(h!=null)clearTimeout(h);t.delete(d.id)}};`;

/** 构造 Worker 时钟:主侧持有「id → 回调」表,worker 只做定时与回发。
 *  worker 异常显式报错(零兜底:时钟坏了=对局停摆,必须响亮,不许静默)。 */
export function createWorkerClock(): WorkerClock {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  worker.onmessage = (ev: MessageEvent<number>) => {
    const cb = callbacks.get(ev.data);
    if (cb == null) return; // 已在主侧清除:迟到回发丢弃(clear 竞态的正常路径)
    callbacks.delete(ev.data);
    cb();
  };
  worker.onerror = (ev: ErrorEvent) => {
    console.error("[worker-clock] worker 异常,定时节拍已不可靠:", ev.message);
  };
  return {
    setTimeout(cb: () => void, ms: number): unknown {
      const id = ++nextId;
      callbacks.set(id, cb);
      worker.postMessage({ act: "set", id, ms });
      return id;
    },
    clearTimeout(handle: unknown): void {
      const id = handle as number;
      callbacks.delete(id);
      worker.postMessage({ act: "clear", id });
    },
    dispose(): void {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
