// 「你可」待决的房间协议覆盖:RoomRegistry + RecordingEndpoint + 内存持久化,不建 WS。
// 上行经 applyCommandFromSeat 鉴权,下行经 assembleDownlinkShot 装配并裁剪私密信息。
// 验证挂窗下行、非属主拒绝、属主应答落账及对端摘要/事件批收敛。
// planter 只构造曹丕与标记前态,挂窗与应答均走公共命令(ADR-0065)。
import { submitCapitalForSetup } from "./room-capitals";
import { describe, it, expect } from "bun:test";
import { RoomRegistry } from "@dafung/core/room/room";
import type { SeatEndpoint } from "@dafung/core/room/room";
import type { RoomPersistence } from "@dafung/core/room/room-persistence";
import type { RoomRecord } from "@dafung/core/room/room-record";
import { MAP } from "../../scripts/engine-helpers";
import { armHero, armPhase, setStamina } from "@dafung/core/engine/planter";

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

/** 记录型端点(同 room-transport):收到的消息逐条入列,按类型检索。 */
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
  byType(type: string): Record<string, unknown>[] {
    return this.sent
      .map((d) => JSON.parse(d) as Record<string, unknown>)
      .filter((m) => m.type === type);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

const broadcastOf = (reg: RoomRegistry, roomId: string) => () => reg.transportBroadcast(roomId);

/** 双真人房:建房(host=座位 0)+ 入座(座位 1)+ 选图 + 开局 + 双端选都进 Playing。
 *  返回 registry、房号、双端点(已清首连摘要)。 */
async function makeStartedRoom(seed = 42) {
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed },
    guohao: "魏",
  });
  const { roomId, token } = { roomId: created.room.roomId, token: created.token };
  const joined = reg.joinSeat(roomId, "蜀");
  reg.setMap(roomId, "guanzhong", token, new Set(["guanzhong"]));
  const ep0 = new RecordingEndpoint(0);
  const ep1 = new RecordingEndpoint(1);
  reg.connectSeat(roomId, 0, token, ep0);
  reg.connectSeat(roomId, 1, joined.token, ep1);
  const bc = broadcastOf(reg, roomId);
  ep0.clear();
  ep1.clear();
  await reg.startGame(roomId, token, bc, () => MAP);
  // 双真人各按候选落子(轮到谁谁落,经房间编排面 pickCapital)
  let guard = 0;
  while (reg.get(roomId)?.engine?.phase === "Setup" && guard++ < 10) {
    const e = reg.get(roomId)!.engine!;
    await submitCapitalForSetup(reg, roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, bc);
  }
  expect(reg.get(roomId)?.engine?.phase).toBe("Playing");
  return { reg, roomId, hostToken: token, ep0, ep1, bc };
}

/** 等传输面 flush(setTimeout(0) 合并拍)落地。 */
const flushTick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe("「你可」待决联机对跑(#1377 AC8):房间编排 + 双真人端点", () => {
  it("挂窗经传输面下行;非决策座位 403;应答经命令面上行落引擎,对端校准拍收敛到决议后状态", async () => {
    const { reg, roomId, ep0, ep1, bc } = await makeStartedRoom(42);
    const e = reg.get(roomId)!.engine!;

    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 70 损失 ≥60:挂待决
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    ep0.clear();
    ep1.clear();
    reg.transportBroadcast(roomId); // 挂窗拍下行(事件批先行;校准窗不含本相位)
    await flushTick();
    expect(ep1.byType("events").length).toBeGreaterThanOrEqual(1); // 对端收到挂窗拍事件批

    // ── 上行鉴权面:非决策座位替答=403 房间编排拒绝 ──
    await expect(
      reg.applyCommandFromSeat(roomId, 1, { type: "respondSkillChoice", seat: 1, use: false }, bc),
    ).rejects.toThrow("未轮到该座位决策");

    // ── 被测环:决策座位应答经协议面上行落引擎(发动:罚座位 1)──
    ep1.clear();
    await reg.applyCommandFromSeat(
      roomId,
      0,
      { type: "respondSkillChoice", seat: 0, use: true, targetSeat: 1 },
      bc,
    );
    // 发动落账后回到出牌阶段，下一回合才会消费这笔跳过。
    expect(e.pendingSkillChoices).toHaveLength(0);
    expect(e.players[1].skipTurns).toBe(1);
    expect(e.turnPhase).toBe("AwaitingJinnang");

    // ── 下行收敛面:对端在校准拍收到的摘要携带决议后状态 ──
    await flushTick();
    await flushTick();
    const shots = ep1.byType("snapshot");
    expect(shots.length).toBeGreaterThanOrEqual(1); // 校准拍(AwaitingJinnang 窗)整房摘要随行
    const last = shots[shots.length - 1]!;
    const players = last.players as {
      heroes: { heroId: string; marks?: unknown }[];
      skipTurns: number;
    }[];
    const caopiRow = players[0].heroes.find((h) => h.heroId === "caopi");
    expect(caopiRow).toBeTruthy();
    expect(caopiRow!.marks).toBeUndefined(); // 发动归零后空容器不产键(空态=规范缺省)
    expect(last.pendingSkillChoices).toBeUndefined(); // 待决已清:键缺席
    expect(last.turnPhase).not.toBe("AwaitingSkillChoice"); // 窗已收,相位续走
    const events = ep1.byType("events").flatMap((m) => m.events as { kind: string }[]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "skillChoiceAnswered", targetSeat: 1, skipTurns: 1 }),
    );
  });
});
