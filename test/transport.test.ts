// 传输原语单测(#397 单机统一 A):MemorySocket(内存双工)与 WsSeatTransport
// (真 WebSocket 承载)同接口同消息契约——同一脚本化场景在两个实现上产生同一
// 可观测序列(收发序/断线语义对齐,验收标准)。
import { describe, it, expect } from "bun:test";
import {
  createMemorySocketPair,
  WsSeatTransport,
  type SeatTransport,
} from "../src/app/net/transport";
import { ReconnectingSocket, type WebSocketLike } from "../src/app/net/reconnecting-socket";

/** 假 WebSocket:记录 send 载荷,可手动触发 open/message/close(同 reconnecting-socket.test 口径)。 */
class FakeWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* onclose 由 emitClose 显式模拟 */
  }
  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emitClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  emitMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

describe("MemorySocket(内存双工,#397)", () => {
  it("收发序:双向各自保序,载荷字符串原样透传(JSON 契约)", () => {
    const { client, host } = createMemorySocketPair(0);
    const clientSeen: string[] = [];
    const hostSeen: string[] = [];
    client.onMessage((d) => clientSeen.push(d));
    host.onClientMessage((d) => hostSeen.push(d));

    // 交错发送:上行下行各自保序,互不串扰
    client.send('{"a":1}');
    host.send('{"b":2}');
    client.send('{"a":2}');
    host.send('{"b":1}');
    expect(hostSeen).toEqual(['{"a":1}', '{"a":2}']);
    expect(clientSeen).toEqual(['{"b":2}', '{"b":1}']);
    // 载荷是 JSON 字符串:消费方可直接 parse(同消息契约的字面证据)
    expect(JSON.parse(hostSeen[0])).toEqual({ a: 1 });
  });

  it("座位归属与在线语义:创建即入座即在线,open 恒真直到 close", () => {
    const { client, host } = createMemorySocketPair(3);
    expect(client.seat).toBe(3);
    expect(host.seat).toBe(3);
    expect(client.open).toBe(true);
    expect(host.open).toBe(true);
  });

  it("断线语义:客户端 close → 对端收 onClose 恰一次,两端 open 翻 false,再 send 抛错", () => {
    const { client, host } = createMemorySocketPair(0);
    let hostClosed = 0;
    host.onClientClose(() => hostClosed++);
    client.close();
    expect(hostClosed).toBe(1);
    expect(client.open).toBe(false);
    expect(host.open).toBe(false);
    expect(() => client.send("x")).toThrow(/客户端端点已关闭/);
    expect(() => host.send("x")).toThrow(/宿主端点已关闭/);
    // 幂等:二次 close 不再触发回调
    client.close();
    expect(hostClosed).toBe(1);
  });

  it("断线语义:宿主 close → 客户端收 onClose,对称同构", () => {
    const { client, host } = createMemorySocketPair(0);
    let clientClosed = 0;
    client.onClose(() => clientClosed++);
    host.close();
    expect(clientClosed).toBe(1);
    expect(client.open).toBe(false);
    expect(host.open).toBe(false);
    expect(() => host.send("x")).toThrow(/宿主端点已关闭/);
  });
});

describe("WsSeatTransport(真 WebSocket 承载,#397)", () => {
  function makeWs() {
    let ws: FakeWebSocket | null = null;
    const sock = new ReconnectingSocket({
      url: "ws://x/ws?room=R&seat=0&token=T",
      socketFactory: (u) => {
        ws = new FakeWebSocket(u);
        return ws;
      },
      timer: {
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      random: () => 0.5,
    });
    const t = new WsSeatTransport(0, sock);
    sock.connect();
    return { sock, t, ws: ws as unknown as FakeWebSocket };
  }

  it("收发序:open 后 send 透传,下行 onMessage 原样到达,座位归属成立", () => {
    const { t, ws } = makeWs();
    expect(t.seat).toBe(0);
    expect(t.open).toBe(false); // CONNECTING 中不可发(与原生 WS 同)
    expect(() => t.send("x")).toThrow(/未就绪/);
    ws.emitOpen();
    expect(t.open).toBe(true);
    const got: string[] = [];
    t.onMessage((d) => got.push(d));
    t.send('{"a":1}');
    expect(ws.sent).toEqual(['{"a":1}']);
    ws.emitMessage('{"b":2}');
    expect(got).toEqual(['{"b":2}']);
  });

  it("断线语义:对端 close → onClose 触发、open 翻 false、再 send 抛错", () => {
    const { t, ws } = makeWs();
    ws.emitOpen();
    let closed = 0;
    t.onClose(() => closed++);
    ws.emitClose();
    expect(closed).toBe(1);
    expect(t.open).toBe(false);
    expect(() => t.send("x")).toThrow(/未就绪/);
  });

  it("主动 close:closedByUs 后对端再推 close 不重复触发 onClose", () => {
    const { t, ws } = makeWs();
    ws.emitOpen();
    let closed = 0;
    t.onClose(() => closed++);
    t.close();
    ws.emitClose(); // 主动关闭后的 close 事件:ReconnectingSocket 内部吞掉
    expect(closed).toBe(0);
  });
});

describe("两实现对齐(#397 验收:收发序/断线语义与 WS 一致)", () => {
  /** 同一脚本跑两种实现,断言客户端可见序列一致:
   *  上行两条、下行两条交错,随后对端断开。 */
  function scenario(
    client: SeatTransport,
    deliverDownlink: (data: string) => void,
    dropFromHost: () => void,
  ) {
    const clientSeen: string[] = [];
    let closed = 0;
    client.onMessage((d) => clientSeen.push(d));
    client.onClose(() => closed++);
    client.send('{"type":"cmd"}');
    deliverDownlink('{"type":"events"}');
    client.send('{"type":"pickCapital"}');
    deliverDownlink('{"type":"snapshot"}');
    dropFromHost();
    return { clientSeen, closed, openAfter: client.open };
  }

  it("Memory 与 WS 的可观测序列一致", () => {
    // Memory:宿主端下行 + 断开
    const mem = createMemorySocketPair(0);
    const memResult = scenario(
      mem.client,
      (d) => mem.host.send(d),
      () => mem.host.close(),
    );
    // WS:宿主侧以 FakeWebSocket 模拟(emitMessage=下行、emitClose=断开)
    let ws: FakeWebSocket | null = null;
    const sock = new ReconnectingSocket({
      url: "ws://x/ws",
      socketFactory: (u) => {
        ws = new FakeWebSocket(u);
        return ws;
      },
      timer: {
        setTimeout: (fn) => setTimeout(fn, 0),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      random: () => 0.5,
    });
    sock.connect();
    (ws as unknown as FakeWebSocket).emitOpen();
    const wsResult = scenario(
      new WsSeatTransport(0, sock),
      (d) => (ws as unknown as FakeWebSocket).emitMessage(d),
      () => (ws as unknown as FakeWebSocket).emitClose(),
    );
    expect(memResult).toEqual(wsResult);
    expect(memResult.clientSeen).toEqual(['{"type":"events"}', '{"type":"snapshot"}']);
    expect(memResult.closed).toBe(1);
    expect(memResult.openAfter).toBe(false);
  });
});
