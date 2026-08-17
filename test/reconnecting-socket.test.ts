// Wave2-B 单测:ReconnectingSocket(从 OnlineController 拆出的 WS 连接+退避重连 module)。
// 用假 WebSocket + 假 timer + 常量随机源做确定性断言——退避序列原本只能靠 e2e 碰运气覆盖。
// 语义基准 = 拆分前的 OnlineController.connect/scheduleReconnect:1s 起步 ×2、封顶 30s、
// ±30% 抖动(0.7 + random×0.6)。注入 random=0.5 ⇒ 抖动系数恰为 1.0,退避延迟=backoff
// 本身,便于断言 1,2,4…秒的确定性序列。
import { describe, it, expect } from "bun:test";
import { ReconnectingSocket, type WebSocketLike } from "../src/app/net/reconnecting-socket";

/** 假 WebSocket:记录构造 URL 与 send 载荷,可手动触发 open/close/error 事件。 */
class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING,与真实 WebSocket 一致
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* 真实 close 的 onclose 由测试用 emitClose 显式模拟(含主动关闭路径) */
  }
  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emitClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

/** 假 timer:捕获延迟而非真等待,runNext 按 FIFO 执行到期回调并返回其延迟。 */
class FakeTimer {
  seq: number[] = [];
  private nextId = 1;
  private queue: { id: number; fn: () => void; delay: number }[] = [];
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ id, fn, delay: ms });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((t) => t.id !== handle);
  }
  get pending(): number {
    return this.queue.length;
  }
  runNext(): number {
    const t = this.queue.shift();
    if (!t) throw new Error("no timer pending");
    t.fn();
    return t.delay;
  }
}

/** 造一个注入全假依赖的 socket(random=0.5 ⇒ 抖动系数 0.7+0.5×0.6=1.0,延迟=backoff)。 */
function makeSocket(url = "ws://x/ws?room=R&seat=0&token=T") {
  FakeWebSocket.instances = [];
  const timer = new FakeTimer();
  const sock = new ReconnectingSocket({ url, socketFactory: (u) => new FakeWebSocket(u), timer, random: () => 0.5 });
  return { sock, timer };
}

describe("ReconnectingSocket", () => {
  it("正常收发:open 前不可发,open 后 send 透传、onmessage 回调收到原始字符串", () => {
    const { sock } = makeSocket();
    const got: string[] = [];
    sock.onMessage((d) => got.push(d));
    sock.connect();
    const ws = FakeWebSocket.instances[0]!;
    expect(sock.isOpen).toBe(false); // CONNECTING 不可发(守卫提示归协议桥)
    ws.emitOpen();
    expect(sock.isOpen).toBe(true);
    sock.send('{"a":1}'); // send 是哑管道:open 判定与提示归协议桥(与原实现一致)
    expect(ws.sent).toEqual(['{"a":1}']);
    ws.emitMessage('{"type":"lobby"}');
    expect(got).toEqual(['{"type":"lobby"}']);
  });

  it("状态回调:onopen → open,断线 onclose → closed;连上后退避计数清零", () => {
    const { sock, timer } = makeSocket();
    const statuses: string[] = [];
    sock.onStatus((s) => statuses.push(s));
    sock.connect();
    FakeWebSocket.instances[0]!.emitOpen();
    FakeWebSocket.instances[0]!.emitClose();
    expect(statuses).toEqual(["open", "closed"]);
    expect(timer.runNext()).toBe(1000); // 第一次退避 1s(清零后重新起)
    FakeWebSocket.instances[1]!.emitOpen(); // 重连成功 → 计数清零
    FakeWebSocket.instances[1]!.emitClose();
    expect(timer.runNext()).toBe(1000); // 又从 1s 起步
  });

  it("断线后指数退避序列:1s, 2s, 4s, 8s…(每轮 close→runNext 重连)", () => {
    const { sock, timer } = makeSocket();
    sock.connect();
    const expected = [1000, 2000, 4000];
    for (const ms of expected) {
      FakeWebSocket.instances.at(-1)!.emitClose();
      expect(timer.runNext()).toBe(ms); // 抖动系数=1 ⇒ 延迟恰为 backoff
    }
    expect(FakeWebSocket.instances).toHaveLength(1 + expected.length);
  });

  it("退避封顶 30s(第 6 次起不再翻倍)", () => {
    const { sock, timer } = makeSocket();
    sock.connect();
    const seq = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const ms of seq) {
      FakeWebSocket.instances.at(-1)!.emitClose();
      expect(timer.runNext()).toBe(ms);
    }
  });

  it("10 次重连耗尽 → 广播 gaveUp,不再建新 socket", () => {
    const { sock, timer } = makeSocket();
    const statuses: string[] = [];
    sock.onStatus((s) => statuses.push(s));
    sock.connect();
    for (let i = 0; i < 10; i++) {
      FakeWebSocket.instances.at(-1)!.emitClose();
      timer.runNext(); // 10 次退避重连:1,2,4,8,16,30,30,30,30,30
    }
    expect(FakeWebSocket.instances).toHaveLength(11);
    FakeWebSocket.instances.at(-1)!.emitClose(); // 第 11 次断线:attempt=10 ⇒ 放弃
    expect(timer.pending).toBe(0);
    expect(statuses.at(-1)).toBe("gaveUp");
    expect(FakeWebSocket.instances).toHaveLength(11); // 没有第 12 个 socket
  });

  it("close() 后不再重连:onclose 不广播 closed、不排定时器,且清掉在途退避", () => {
    const { sock, timer } = makeSocket();
    const statuses: string[] = [];
    sock.onStatus((s) => statuses.push(s));
    sock.connect();
    FakeWebSocket.instances[0]!.emitOpen();
    FakeWebSocket.instances[0]!.emitClose(); // 断线,1s 后会重连
    expect(timer.pending).toBe(1);
    sock.close(); // 主动销毁:清在途退避定时器
    expect(timer.pending).toBe(0);
    FakeWebSocket.instances[0]!.emitClose(); // 主动关闭路径的 onclose
    expect(timer.pending).toBe(0);
    expect(statuses).toEqual(["open", "closed"]); // 只有一次断线广播;close 后的 onclose 不再广播、不重连
    sock.connect(); // close 后再 connect 是 no-op
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("onError 透传原始 onerror(重连期间的 error 不打扰逻辑,提示判定归协议桥)", () => {
    const { sock } = makeSocket();
    let errors = 0;
    sock.onError(() => errors++);
    sock.connect();
    FakeWebSocket.instances[0]!.onerror?.();
    expect(errors).toBe(1);
  });

  it("onMessage/onStatus/onError 返回退订函数", () => {
    const { sock } = makeSocket();
    const got: string[] = [];
    const off = sock.onMessage((d) => got.push(d));
    sock.connect();
    FakeWebSocket.instances[0]!.emitMessage("x");
    off();
    FakeWebSocket.instances[0]!.emitMessage("y");
    expect(got).toEqual(["x"]);
  });
});
