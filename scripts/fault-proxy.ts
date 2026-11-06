// 故障注入代理(#1164 棒一):WS→WS 哑管道中继——客户端连代理的端口,代理拨真实
// 服务器 WS,逐帧转发。协议单源不动:代理不解析消息语义(wire.ts 的形状/编解码对它
// 不可见),只对「帧」这个传输单位做文章,是协议级联机 e2e 的故障面(棒二故障矩阵
// 的地基;vera20k lan-fault-proxy.rs 的 TS 对偶,借鉴点见票 #1164 汇报)。
//
// 三个旋钮(全部确定性:禁 Math.random/真随机抖动;测试可重复、断言可精确):
//   ① latencyMs     每帧固定排队延迟。帧到达后入同方向转发链,按到达序逐帧转发,
//                    转发前睡 latencyMs(顺序保持:第 N+1 帧不会越过第 N 帧);运行中
//                    改大改小对「还没轮到转发的帧」立即生效。0 = 直通(缺省)。
//   ② dropEveryN    确定性丢帧模式,单向可配(toServer/toClient 各自独立)。语义:该
//                    方向按到达序计数(1 起单调,含被丢的帧),序号 % N === 0 的帧
//                    丢弃(不转发、不入转发链);N=0/null = 不丢。计数器随连接对生
//                    存,不因旋钮中途调整而重置——同一帧序列下丢哪几帧是确定的。
//   ③ killAfterMs / killNow  硬断两侧连接。armKillAfterMs = 武装一次性定时器(N 毫秒
//                    后对当前全部连接对执行硬断;重复调用 = 改期重设;null = 拆除),
//                    killNow = 编程即时硬断。硬断 = 客户端侧与上游侧 socket 同时
//                    close(转发链在途帧作废,模拟网线拔掉,非优雅挥手)。
// 旋钮全部可运行中调整(编程接口,不只见于构造参数)——棒二故障矩阵「先建连零故障、
// 中途注入」的用法就建立在这条上。
//
// 可观测性:计数器(relayed/dropped/kills/pairs)与 notice 回调(ready/pair-open/
// dropped/killed/pair-closed)供测试断言「故障确实发生在了第几帧上」。
//
// 生命周期:多连接对并存(每条客户端连接独立拨一条上游);killNow 只杀连接对,代理
// 继续监听——断线重连场景客户端原 URL 直连即可拿到全新上游。
import type { ServerWebSocket } from "bun";

/** 帧方向:toServer = 客户端侧 → 真实服务器(上行);toClient = 反向(下行)。 */
export type FaultDirection = "toServer" | "toClient";

/** 代理观测事件(onNotice 回调;测试据此断言故障发生点,不靠猜)。 */
export type FaultProxyNotice =
  | { kind: "ready"; port: number; targetOrigin: string }
  | { kind: "pair-open"; connection: number }
  | { kind: "pair-closed"; connection: number }
  | { kind: "dropped"; direction: FaultDirection; ordinal: number; connection: number }
  | { kind: "killed"; pairs: number };

export interface FaultProxyStats {
  /** 已转发帧数(按方向)。 */
  relayed: Record<FaultDirection, number>;
  /** 已丢弃帧数(按方向;dropEveryN 的产物)。 */
  dropped: Record<FaultDirection, number>;
  /** killNow 执行次数(含 armKillAfterMs 定时到点触发)。 */
  kills: number;
  /** 曾建立的连接对总数。 */
  pairs: number;
}

/** 一条连接对(客户端 WS ↔ 上游 WS)的转发状态。 */
interface Pair {
  clientWs: ServerWebSocket<{ path: string }>;
  upstream: WebSocket;
  connection: number;
  alive: boolean;
  /** 各方向:到达计数(1 起单调,含被丢帧)+ 顺序保持的转发链。 */
  dirs: Record<FaultDirection, { ordinal: number; chain: Promise<void> }>;
}

export interface FaultProxyOptions {
  /** 代理监听端口;0 = 系统分配(port 读回实际值)。 */
  port?: number;
  /** 真实服务器 origin(如 ws://127.0.0.1:4281);上游 URL = origin + 客户端请求的
   *  path+search 原样拼接——哑管道不认识 /ws?room=&seat=&token= 的语义,只透传。 */
  targetOrigin: string;
  /** 观测回调(可选;同步调用,异常原样上抛——观测面不许静默)。 */
  onNotice?: (notice: FaultProxyNotice) => void;
}

export class FaultProxy {
  /** 旋钮①:每帧固定排队延迟(ms;0=直通)。运行中可改。 */
  private latencyMs = 0;
  /** 旋钮②:各方向「每 N 帧丢 1 帧」;0 = 不丢。运行中可改。 */
  private dropEveryN: Record<FaultDirection, number> = { toServer: 0, toClient: 0 };
  /** 旋钮③:armKillAfterMs 武装的一次性定时器句柄(null = 未武装)。 */
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly targetOrigin: string;
  private readonly onNotice: (notice: FaultProxyNotice) => void;
  private readonly pairs = new Map<ServerWebSocket<{ path: string }>, Pair>();
  private readonly stats: FaultProxyStats = {
    relayed: { toServer: 0, toClient: 0 },
    dropped: { toServer: 0, toClient: 0 },
    kills: 0,
    pairs: 0,
  };
  private connectionSeq = 0;
  private server: ReturnType<typeof Bun.serve> | null = null;

  private constructor(options: FaultProxyOptions) {
    this.targetOrigin = options.targetOrigin;
    this.onNotice = options.onNotice ?? (() => {});
  }

  /** 启动代理(Bun.serve 同步返回即监听就绪,端口已定)。 */
  static start(options: FaultProxyOptions): FaultProxy {
    const proxy = new FaultProxy(options);
    proxy.server = Bun.serve<{ path: string }>({
      port: options.port ?? 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        const url = new URL(req.url);
        // 任意路径都可升级:客户端按真实服务器的 URL 形状连(含 /ws?room=...),
        // 代理只透传 path+search,不关心协议语义。
        if (!srv.upgrade(req, { data: { path: url.pathname + url.search } })) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      },
      websocket: {
        open: (ws) => proxy.openPair(ws),
        message: (ws, message) => proxy.relayFromClient(ws, message),
        close: (ws) => proxy.closePair(ws, "client"),
      },
    });
    proxy.onNotice({ kind: "ready", port: proxy.server.port!, targetOrigin: proxy.targetOrigin });
    return proxy;
  }

  /** 代理实际监听端口(port 0 时读回系统分配值;建连 URL 用)。 */
  get port(): number {
    if (this.server == null) throw new Error("故障代理未启动:start() 后才可取端口");
    return this.server.port!; // 已监听,Bun.serve 返回后端口必已定
  }

  /** 计数器快照(测试断言「丢了几帧/转发了几帧」)。 */
  getStats(): FaultProxyStats {
    return {
      relayed: { ...this.stats.relayed },
      dropped: { ...this.stats.dropped },
      kills: this.stats.kills,
      pairs: this.stats.pairs,
    };
  }

  // ──────────────────────────── 旋钮(运行中可调)────────────────────────────
  /** 旋钮①:设置每帧固定排队延迟(ms;0=直通)。已入链的帧在轮到转发那一刻读值,
   *  故对未转发的帧立即生效;顺序保持不受影响。 */
  setLatencyMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`latencyMs 非法:${ms}(须非负有限数)`);
    this.latencyMs = ms;
  }

  /** 旋钮②:设置某方向「每 N 帧丢 1 帧」(null/0 = 关)。序号计数不重置,同帧序列
   *  下丢哪几帧确定。 */
  setDropEveryN(direction: FaultDirection, n: number | null): void {
    const v = n ?? 0;
    if (!Number.isInteger(v) || v < 0) throw new Error(`dropEveryN 非法:${n}(须非负整数)`);
    this.dropEveryN[direction] = v;
  }

  /** 旋钮③:武装/重设「N 毫秒后硬断两侧」一次性定时器(从本次调用起算;null=拆除)。 */
  armKillAfterMs(ms: number | null): void {
    if (this.killTimer != null) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (ms == null) return;
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`killAfterMs 非法:${ms}(须正有限数)`);
    this.killTimer = setTimeout(() => {
      this.killTimer = null;
      this.killNow();
    }, ms);
  }

  /** 旋钮③:编程即时硬断——当前全部连接对的两侧 socket 同时 close(转发链在途帧
   *  作废)。代理继续监听,断线重连场景原 URL 直连即得全新连接对。 */
  killNow(): void {
    if (this.killTimer != null) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    this.stats.kills += 1;
    this.onNotice({ kind: "killed", pairs: this.pairs.size });
    // 快照后逐对硬断:hardClose 会从 pairs 删表,边迭代边删不可靠,先落一份快照。
    const targets = [...this.pairs.values()];
    for (const pair of targets) this.hardClose(pair);
  }

  /** 收尾:硬断全部连接对 + 撤监听(测试 teardown;幂等)。 */
  stop(): void {
    this.killNow();
    this.server?.stop(true);
    this.server = null;
  }

  // ──────────────────────────── 转发内核 ────────────────────────────
  /** 新连接对:客户端侧 open 即拨上游(上游 URL = targetOrigin + 透传的 path+search)。 */
  private openPair(clientWs: ServerWebSocket<{ path: string }>): void {
    const upstream = new WebSocket(this.targetOrigin + clientWs.data.path);
    const pair: Pair = {
      clientWs,
      upstream,
      connection: ++this.connectionSeq,
      alive: true,
      dirs: {
        toServer: { ordinal: 0, chain: Promise.resolve() },
        toClient: { ordinal: 0, chain: Promise.resolve() },
      },
    };
    this.pairs.set(clientWs, pair);
    this.stats.pairs += 1;
    upstream.addEventListener("message", (ev) => this.forward(pair, "toClient", frameOf(ev)));
    upstream.addEventListener("close", () => this.closePair(clientWs, "upstream"));
    upstream.addEventListener("error", () => this.closePair(clientWs, "upstream"));
    this.onNotice({ kind: "pair-open", connection: pair.connection });
  }

  /** 中继一帧(客户端侧入口,Bun websocket message 处理器):按方向计数 → 判丢 → 入链。 */
  private relayFromClient(from: ServerWebSocket<{ path: string }>, frame: unknown): void {
    const pair = this.pairs.get(from);
    if (pair == null) throw new Error("故障代理收到无主帧:连接对表缺失(客户端 WS 未登记)");
    this.forward(pair, "toServer", normalizeFrame(frame));
  }

  /** 转发内核(两方向共用):序号计数 → 丢帧判定 → 入同方向转发链(串行保序)。 */
  private forward(pair: Pair, direction: FaultDirection, frame: string | Uint8Array): void {
    const st = pair.dirs[direction];
    st.ordinal += 1;
    const everyN = this.dropEveryN[direction];
    if (everyN > 0 && st.ordinal % everyN === 0) {
      this.stats.dropped[direction] += 1;
      this.onNotice({
        kind: "dropped",
        direction,
        ordinal: st.ordinal,
        connection: pair.connection,
      });
      return;
    }
    const target = direction === "toServer" ? pair.upstream : pair.clientWs;
    st.chain = st.chain.then(async () => {
      // 延迟在轮到该帧的那一刻读当前旋钮(运行中调整对未转发帧立即生效);同方向
      // 链式串行 = 第 N+1 帧恒晚于第 N 帧发出(顺序保持)。
      if (this.latencyMs > 0) await Bun.sleep(this.latencyMs);
      if (!pair.alive) return; // 硬断/对端先关:在途帧作废(硬断语义,非丢帧旋钮)
      if (target.readyState === WebSocket.OPEN) {
        target.send(frame);
        this.stats.relayed[direction] += 1;
      }
    });
  }

  /** 连接对拆除(任一侧先关/上游错误):对侧照关,状态清表。alive=false 让转发链
   *  在途帧作废。幂等(两侧同时触发只生效一次)。 */
  private closePair(
    clientWs: ServerWebSocket<{ path: string }>,
    side: "client" | "upstream",
  ): void {
    const pair = this.pairs.get(clientWs);
    if (pair == null || !pair.alive) return;
    pair.alive = false;
    this.pairs.delete(clientWs);
    if (side === "client") {
      tryCloseUpstream(pair.upstream);
    } else {
      tryCloseClient(clientWs);
    }
    this.onNotice({ kind: "pair-closed", connection: pair.connection });
  }

  /** 硬断一对连接:两侧立即 close(非优雅挥手;close 事件各自照常到达对端)。 */
  private hardClose(pair: Pair): void {
    pair.alive = false;
    this.pairs.delete(pair.clientWs);
    tryCloseClient(pair.clientWs);
    tryCloseUpstream(pair.upstream);
  }
}

// ──────────────────────────── 帧形状(哑管道只搬字节,不认语义)────────────────────────────
/** 帧形状归一:string 原样;二进制归一 Uint8Array;其余(Blob 等)炸出——本仓协议
 *  全文本 JSON,二进制通路只是哑管道的通用能力,不应出现非预期载荷形状。 */
function normalizeFrame(frame: unknown): string | Uint8Array {
  if (typeof frame === "string") return frame;
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (frame instanceof Uint8Array) return frame;
  throw new Error(`故障代理收到不可转发的帧形状:${String(frame)}`);
}

function frameOf(ev: MessageEvent): string | Uint8Array {
  return normalizeFrame(ev.data);
}

function tryCloseClient(ws: ServerWebSocket<{ path: string }>): void {
  if (ws.readyState !== WebSocket.CLOSED) ws.close();
}

function tryCloseUpstream(ws: WebSocket): void {
  if (ws.readyState !== WebSocket.CLOSED) ws.close();
}
