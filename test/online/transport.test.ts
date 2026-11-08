// 传输原语单测(#397 单机统一 A):MemorySocket(内存双工)收发序/断线语义。
// (曾并列的 WsSeatTransport 真承载段随实现删除——联机侧不经本接口,OnlineController
// 直用 ReconnectingSocket,其建连/断线语义由 reconnecting-socket.test 守。)
import { describe, it, expect } from "bun:test";
import { createMemorySocketPair } from "../../src/app/net/transport";

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
