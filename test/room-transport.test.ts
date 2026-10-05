// Room 传输面单测(#397 单机统一 A):房间编排经传输抽象下行——connectSeat 鉴权/
// 首连摘要、transportBroadcast 合并节奏、事件批先行/整房摘要随后的单拍下行次序。
// InMemory 持久化注入(同 room.test.ts 口径),零 fs / 零 WS。
import { describe, it, expect } from "bun:test";
import { RoomRegistry, RoomError, type SeatEndpoint } from "../scripts/room";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import { MAP } from "../scripts/engine-helpers";

class InMemoryPersistence implements RoomPersistence {
  private readonly m = new Map<string, RoomRecord>();
  save(rec: RoomRecord): void {
    this.m.set(rec.roomId, rec);
  }
  load(roomId: string): RoomRecord | null {
    return this.m.get(roomId) ?? null;
  }
  remove(roomId: string): void {
    this.m.delete(roomId);
  }
  exists(roomId: string): boolean {
    return this.m.has(roomId);
  }
  listIds(): string[] {
    return [...this.m.keys()];
  }
}

/** 记录型端点:收到的消息逐条入列,可手动断开(open 翻 false 模拟端点失效)。 */
class RecordingEndpoint implements SeatEndpoint {
  readonly sent: string[] = [];
  private isOpen = true;
  constructor(readonly seat: number) {}
  get open(): boolean {
    return this.isOpen;
  }
  send(data: string): void {
    if (!this.isOpen) throw new Error("RecordingEndpoint 已断开");
    this.sent.push(data);
  }
  drop(): void {
    this.isOpen = false;
  }
  /** 按类型取消息(消息契约:type 判别)。 */
  byType(type: string): unknown[] {
    return this.sent.map((d) => JSON.parse(d) as { type?: string }).filter((m) => m.type === type);
  }
}

/** 建房 + 选图 + 开局(2 座:seat0 human、seat1 bot),返回 registry 与凭证。 */
function makeStartedRoom(seed = 42) {
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set([1]),
    hostConfig: { seed },
  });
  const roomId = created.room.roomId;
  reg.setMap(roomId, "sanguo", created.token, new Set(["sanguo"]));
  return { reg, roomId, token: created.token };
}

describe("RoomRegistry 传输面(#397)", () => {
  it("connectSeat:鉴权失败 401;成功即收首连整房摘要(god-view snapshot 形状)", () => {
    const { reg, roomId, token } = makeStartedRoom();
    expect(() => reg.connectSeat(roomId, 0, "bad-token", new RecordingEndpoint(0))).toThrow(
      RoomError,
    );
    const ep = new RecordingEndpoint(0);
    reg.connectSeat(roomId, 0, token, ep);
    expect(ep.sent.length).toBe(1);
    const msg = JSON.parse(ep.sent[0]) as { type: string; roomId: string; started: boolean };
    expect(msg.type).toBe("lobby"); // 未开局房间:首连摘要退化为 lobbyView(与 server.ts open 同形)
    expect(msg.roomId).toBe(roomId);
  });

  it("单拍下行次序:事件批消息先行(因果在前)、整房摘要随后;引用未换新的重复通知不重收", async () => {
    const { reg, roomId, token } = makeStartedRoom();
    const ep = new RecordingEndpoint(0);
    reg.connectSeat(roomId, 0, token, ep);
    ep.sent.length = 0; // 清掉首连摘要,只看对局下行
    await reg.startGame(
      roomId,
      token,
      () => reg.transportBroadcast(roomId),
      () => MAP,
    );
    // flush 是 setTimeout(0) 合并拍:开局链(startGame 内 driveBots 全 bot 驱动)合为一拍
    await new Promise((r) => setTimeout(r, 10));
    const types = ep.sent.map((d) => (JSON.parse(d) as { type: string }).type);
    // 至少一拍;每拍内 events 在 snapshot 前
    expect(types.length).toBeGreaterThanOrEqual(2);
    expect(types[0]).toBe("events");
    expect(types[1]).toBe("snapshot");
    const snap = ep.byType("snapshot")[0] as { started: boolean; seats: unknown[] };
    expect(snap.started).toBe(true);
    expect(snap.seats.length).toBe(2);
  });

  it("合并节奏:同一 tick 内多次 onUpdate 只排一拍 flush(setTimeout(0))", async () => {
    const { reg, roomId, token } = makeStartedRoom();
    const ep = new RecordingEndpoint(0);
    reg.connectSeat(roomId, 0, token, ep);
    ep.sent.length = 0;
    // 未开局房间反复广播:无引擎批、无转移,不产生事件消息,也不重排定时器
    reg.transportBroadcast(roomId);
    reg.transportBroadcast(roomId);
    await new Promise((r) => setTimeout(r, 10));
    expect(ep.byType("events").length).toBe(0);
  });

  it("端点断开后不再下发;dismissRoom 清传输面残表(在途定时器一并撤)", async () => {
    const { reg, roomId, token } = makeStartedRoom();
    const ep = new RecordingEndpoint(0);
    reg.connectSeat(roomId, 0, token, ep);
    ep.drop();
    await reg.startGame(
      roomId,
      token,
      () => reg.transportBroadcast(roomId),
      () => MAP,
    );
    const before = ep.sent.length;
    await new Promise((r) => setTimeout(r, 10));
    expect(ep.sent.length).toBe(before); // 断开端点零下发(open 门控)
    reg.disconnectSeat(roomId, 0);
    reg.dismissRoom(roomId, token); // 残表清理路径不抛即达(断言面:房间可解散)
    expect(reg.get(roomId)).toBeUndefined();
  });
});
