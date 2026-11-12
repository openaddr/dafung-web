// 「你可」待决的联机对跑(#1377 AC8,ADR-0062 层③):RoomRegistry 房间编排(与
// room-transport/room.test 同一既有装配,零 WS 零 fs,InMemory 持久化)+ 双真人端点
// (RecordingEndpoint)——上行=applyCommandFromSeat 座位鉴权命令面(#454),下行=
// assembleDownlinkShot 单拍装配(redact 必经,与生产同一传输语义)。
// 断言面:①挂窗拍经传输面下行(事件批先行);②非决策座位提交应答=403 房间编排拒绝;
// ③决策座位应答经协议面上行落引擎(发动落账:目标被跳、标记归零);④对端在下一校准拍
// (AwaitingJinnang 窗)收到的整房摘要携带决议后状态(pendingSkillChoices 键缺席、
// marks 键缺席、turnSkipped 已在事件批)——「反应窗选择经协议面传导到对端」的闭环。
// 布景判词:新技不可达(名将池本票不动),曹丕/标记经 planter 种植件直授(挂窗拍用
// setStamina 损失过阈+引擎 endTurn 停窗,同 armReaction 的「布景=被测环前拍」口径);
// 被测环=应答命令的上行传导与对端下行收敛,全程真命令通路。
import { describe, it, expect } from "bun:test";
import { RoomRegistry } from "../../scripts/room";
import type { SeatEndpoint } from "../../scripts/room";
import type { RoomPersistence } from "../../scripts/room-persistence";
import type { RoomRecord } from "../../scripts/room-record";
import { MAP } from "../../scripts/engine-helpers";
import { armHero, setStamina } from "../../src/core/planter";

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
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, bc);
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

    // ── 布景(被测环前拍,armReaction 同口径):曹丕放逐直授 → 损失过阈 → endTurn 停窗 ──
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30); // 70 损失 ≥60:挂待决
    e.endTurn(); // 回合收口入口挂窗(AwaitingSkillChoice)
    expect(e.turnPhase).toBe("AwaitingSkillChoice");
    ep0.clear();
    ep1.clear();
    reg.transportBroadcast(roomId); // 挂窗拍下行(事件批先行;校准窗不含本相位)
    await flushTick();
    expect(ep1.byType("events").length).toBeGreaterThanOrEqual(1); // 对端收到挂窗拍事件批

    // ── 上行鉴权面(#454):非决策座位替答=403 房间编排拒绝 ──
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
    // 引擎侧:发动落账 + 收口重入(目标=下家,skipTurns 即被跳回合环消费 1→0)
    expect(e.pendingSkillChoices).toHaveLength(0);
    expect(e.players[1].skipTurns).toBe(0);
    expect(e.turnPhase).not.toBe("AwaitingSkillChoice");

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
    // turnSkipped 已在对端事件批(目标被跳的折算可见证据)
    const events = ep1.byType("events").flatMap((m) => m.events as { kind: string }[]);
    expect(events.some((ev) => ev.kind === "turnSkipped")).toBe(true);
  });
});
