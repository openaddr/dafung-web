// WS 连接 + 指数退避重连(从 controllers/online.ts 拆出,ADR-0007 的客户端对偶):
// 原来 OnlineController 一类五职责(REST 大厅 / WS 连接 / 协议分发 / 表现提取 / 换图重建),
// 重连状态机与业务协议耦合在同一文件里无法单测(e2e 才能覆盖)。本 module 只管「一条会自己
// 重连的 socket」:构造/升级 URL 后的建连、onopen/onmessage/onclose 接线、退避调度、放弃计数,
// 不 import 任何 store/引擎——纯净可注入假 WebSocket 与假 timer 做确定性单测。
// 退避参数与语义逐项照搬拆分前实现:1s 起步 ×2、上限 30s、每次 ±30% 随机抖动
// (防多端同时断线同步风暴)、连上即清零、超过 10 次放弃、close 后不再重试。

/** socket 生命周期状态:onopen → open;非主动关闭的 onclose → closed(已置 disconnected);
 *  10 次重连耗尽 → gaveUp(由宿主决定如何提示,本层不做 UI)。 */
export type SocketStatus = "open" | "closed" | "gaveUp";

/** WebSocket 的最小结构(浏览器原生 WebSocket 结构兼容;测试注入假实现)。 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** 可注入 timer(测试用假 timer 驱动退避序列断言;生产走全局 setTimeout)。 */
export interface TimerLike {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReconnectingSocketOptions {
  /** 完整 WS URL(含 query:room/seat/token)——升级换协议与拼参归调用方(lobby-api)。 */
  url: string;
  /** socket 工厂(默认 new WebSocket;测试注入假实现断言建连次数)。 */
  socketFactory?: (url: string) => WebSocketLike;
  timer?: TimerLike;
  /** 抖动随机源(测试注入常量使退避序列确定)。 */
  random?: () => number;
  /** 退避参数(默认照搬拆分前常量;暴露成选项仅为测试可断言,生产不覆写)。 */
  baseMs?: number;
  maxMs?: number;
  maxAttempts?: number;
}

const OPEN = 1; // WebSocket.OPEN(避免为读一个常量引入 DOM 类型依赖)

export class ReconnectingSocket {
  private readonly url: string;
  private readonly socketFactory: (url: string) => WebSocketLike;
  private readonly timer: TimerLike;
  private readonly random: () => number;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly maxAttempts: number;

  private ws: WebSocketLike | null = null;
  private reconnectTimer: unknown = null;
  private reconnectAttempts = 0;
  private closedByUs = false;

  private readonly messageCbs = new Set<(data: string) => void>();
  private readonly statusCbs = new Set<(status: SocketStatus) => void>();
  private readonly errorCbs = new Set<() => void>();

  constructor(opts: ReconnectingSocketOptions) {
    this.url = opts.url;
    // 默认工厂直连浏览器 WebSocket(原生事件签名与 Like 兼容,构造端断言收窄)
    this.socketFactory = opts.socketFactory ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
    this.timer = opts.timer ?? { setTimeout, clearTimeout };
    this.random = opts.random ?? Math.random;
    this.baseMs = opts.baseMs ?? 1000;
    this.maxMs = opts.maxMs ?? 30000;
    this.maxAttempts = opts.maxAttempts ?? 10;
  }

  /** 主动建连(入座成功后由协议桥调用);重复调用与 close 后调用均为 no-op。 */
  connect(): void {
    if (this.closedByUs || this.ws) return;
    this.spawn();
  }

  private spawn(): void {
    const ws = this.socketFactory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0; // 连上即清零,下次断线从 base 重新起退避
      this.statusCbs.forEach((cb) => cb("open"));
    };
    ws.onmessage = (ev) => {
      const data = String(ev.data);
      this.messageCbs.forEach((cb) => cb(data));
    };
    ws.onclose = () => {
      if (this.closedByUs) return; // 主动关闭:不广播状态、不重连
      this.ws = null;
      this.statusCbs.forEach((cb) => cb("closed"));
      this.scheduleReconnect();
    };
    ws.onerror = () => this.errorCbs.forEach((cb) => cb());
  }

  /** 当前是否可发送(对应原 `ws && ws.readyState === WebSocket.OPEN` 守卫)。 */
  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === OPEN;
  }

  send(msg: string): void {
    this.ws?.send(msg);
  }

  /** 订阅消息(收到的是原始字符串,JSON 解析归协议桥——保持本层与协议无关)。 */
  onMessage(cb: (data: string) => void): () => void {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }

  onStatus(cb: (status: SocketStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  /** 原始 onerror 透传(重连尝试期间的 error 不打扰;仅正常在线时闪提示——判定归协议桥)。 */
  onError(cb: () => void): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  /** 指数退避重连调度(参数语义照搬:base×2^n 封顶 max,×(0.7+rand×0.6) 抖动)。 */
  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxAttempts) {
      this.statusCbs.forEach((cb) => cb("gaveUp"));
      return;
    }
    const backoff = Math.min(this.baseMs * 2 ** this.reconnectAttempts, this.maxMs);
    const delayMs = backoff * (0.7 + this.random() * 0.6); // ±30% 抖动
    this.reconnectAttempts++;
    this.reconnectTimer = this.timer.setTimeout(() => {
      this.reconnectTimer = null;
      this.spawn();
    }, delayMs);
  }

  /** 主动关闭:先置位再 close(onclose 看到 closedByUs 直接返回,不触发重连),并清退避定时器。 */
  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer != null) {
      this.timer.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
