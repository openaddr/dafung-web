// 接缝T3 发送侧归一(#1242):单机内存 flush 的快照校准门控 + 副本↔权威回归钉。
// 守住什么:
//   ① 门控钉(registry 传输面端点计数,room-transport 家族编排级测法):首连摘要恒发;
//      开局拍(Setup 相位 + gameStarted 校准 kind 双触发)快照照发、批内 events 先行;
//      Playing 普通推进拍零快照下行(批内含 fold+calibration 档 turnStarted 也不发——
//      决策窗前后沿不夹,#529 闭沿限流语义同联机)——「每拍恒发全量快照」退役的正面钉。
//   ② 显式通路保护钉:门控判否的现场 flushTransportNow 仍恒发快照。#1241 force 种植
//      收口/onFatal 终局拍的生命线——种植不产事件批,玩家副本唯一知悉通道=快照水合,
//      门控误伤此通路 = T2 接缝复捅穿。
//   ③ 回归钉(本票主钉):LocalController 真实通路自对弈到终局,副本(#1241 水合副本,
//      事件批折叠+校准快照水合)与权威引擎各取状态过 scripts/state-digest 规范化哈希
//      逐位一致——接缝被重捅穿或折叠漏覆盖必挂。
// 形制注记:终局自对弈 = 座位表 4 座(1 真人 + 3 bot)且真人座开局即托管(setAutoPilot,
// ADR-0028 bot 代打)——createRoom 硬约束 host(Seat 0)必须是真人,纯 bot 座位表在此
// 通路不可构造;托管 + 即时时钟注入(LocalController clockOverride 测试缝)下整局由
// 服务器驱动座位自走,与「全 bot 自对弈」驱动语义等价。步进节拍全走即时钟(botStepMs=0
// + 托管 2s/步经时钟即时投递),整局墙钟秒级。
// 摘要排除面(记名记理由,vera20k elevation 条款同构;scripts/state-digest HASH_EXCLUDED
// 的 gameId/log/logCount 三项承袭,其余为折叠面「刻意不折、由校准快照覆盖」的漂移窗
// ——event-fold 头注「校准兜底项/校准点档全项」清单,ADR-0020 决策 1/3 的设计内分歧,
// 非接缝破口;钉面 = 折叠契约承诺收敛的字段):
//   rngState      副本不掷骰——折叠只落结果,骰游标随校准快照走
//   jinnangDeck / treasureDeck   暗牌牌序不折(ADR-0016;数量面 jinnangDeckCount 已折)
//   offeredHeroes 招贤预掷候选随决策窗校准下行,非终局面
//   pendingDebt   校准点档全项(折叠器不碰清单)
//   pendingJinnang / pendingSkill 校准兜底③(出牌段无专属事件)
//   pendingEncounterHalt / pendingCityEvent  无专属事件的待续跑旗标(同校准兜底档)
//   events        批界瞬时态(当前转移批)非累积状态,副本侧为快照水合残迹
//   targetNetWorth 实例配置非水合态(快照 write 面 no-op;占位壳以地图缺省构造)
//   players[].jinnangHand  锦囊暗牌内容不折(数量 jinnangHandCount 已折)
import { describe, it, expect } from "bun:test";
import { RoomRegistry, type RoomClock, type SeatEndpoint } from "../scripts/room";
import type { RoomPersistence } from "../scripts/room-persistence";
import type { RoomRecord } from "../scripts/room-record";
import { MAP } from "../scripts/engine-helpers";
import { hashCanonical } from "../scripts/state-digest";
import { SNAPSHOT_FIELDS } from "../src/core/snapshot";
import type { GameEngine } from "../src/core/authority";
import type { WorkerClock } from "../src/app/net/worker-clock";
import { LocalController } from "../src/app/controllers/local";
import { getAuthorityEngine } from "../src/app/controllers/registry";

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

/** 记录型端点(room-transport 同款):收到的消息逐条入列。 */
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
  byType(type: string): unknown[] {
    return this.sent.map((d) => JSON.parse(d) as { type?: string }).filter((m) => m.type === type);
  }
}

/** 手动时钟(room.test 同款):定时全挂表,测试不泵即永不触发——看门狗零干扰,
 *  门控钉只吃同步段(开局/选都 botStepMs=0 不经时钟)与真实 setTimeout(0) 合并拍。 */
class ManualClock implements RoomClock {
  private readonly pending = new Map<unknown, () => void>();
  setTimeout(cb: () => void, _ms: number): unknown {
    const id = {} as unknown;
    this.pending.set(id, cb);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle);
  }
}

/** 即时时钟(回归钉注入缝,WorkerClock 测试缝同 abort-exits FakeWorkerClock 形制):
 *  一切定时零延迟投递(真 setTimeout(0) 宏任务)——托管 2s/步与看门狗窗口全部即时,
 *  整局自走压缩到秒级墙钟;节拍不影响种子决定论(对局内容只由骰序决定)。 */
class InstantClock implements WorkerClock {
  setTimeout(cb: () => void, _ms: number): unknown {
    return setTimeout(cb, 0);
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as number);
  }
  pause(): void {}
  resume(): void {}
  get paused(): boolean {
    return false;
  }
  dispose(): void {}
  onFatal(_listener: (message: string) => void): void {}
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询等待谓词成立(真实定时器驱动的编排链,快照非同步可达;march-stop 同款)。 */
async function waitFor(desc: string, probe: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (probe()) return;
    await sleep(20);
  }
  throw new Error(`${desc}:等待超时(${timeoutMs}ms)`);
}

/** 建房 + 入座 + 选图(2 座全真人;未开局,connectSeat 首连摘要前置)。全真人房
 *  意在确定性:无 bot 驱动链,拍边界只由真实 setTimeout(0) 合并——每命令恰一拍,
 *  端点逐帧计数可精确断言(有 bot 时链步进与合并拍的交错随宿主调度漂移,计数钉
 *  会概率性挂,按不可靠用例零容忍纪律直接回避)。 */
function makeRoom(seed = 42) {
  const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, {
    clock: new ManualClock(),
  });
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed },
  });
  const guestToken = reg.joinSeat(created.room.roomId).token;
  reg.setMap(created.room.roomId, "guanzhong", created.token, new Set(["guanzhong"]));
  return { reg, roomId: created.room.roomId, token: created.token, guestToken };
}

/** state-digest 规范化终局状态(排除面见文件头注);哈希经 hashCanonical 单点。 */
function digestState(e: GameEngine): string {
  const state: Record<string, unknown> = {};
  for (const f of SNAPSHOT_FIELDS) {
    if (DIGEST_EXCLUDED.has(f.key)) continue;
    state[f.key] = f.read(e);
  }
  state.players = (state.players as Record<string, unknown>[]).map((p) => {
    const { jinnangHand: _hand, ...rest } = p;
    return rest;
  });
  return hashCanonical(state);
}

const DIGEST_EXCLUDED: ReadonlySet<string> = new Set([
  "gameId",
  "log",
  "logCount",
  "rngState",
  "jinnangDeck",
  "treasureDeck",
  "offeredHeroes",
  "pendingDebt",
  "pendingJinnang",
  "pendingSkill",
  "pendingEncounterHalt",
  "pendingCityEvent",
  "events",
  "targetNetWorth",
]);

describe("单机 flush 快照校准门控(#1242)", () => {
  it("门控钉:首连摘要恒发;Setup 相位/校准 kind 拍照发;Playing 普通拍零快照", async () => {
    const { reg, roomId, token } = makeRoom();
    const ep = new RecordingEndpoint(0);
    const broadcast = () => reg.transportBroadcast(roomId);
    const typeOf = (i: number): string => (JSON.parse(ep.sent[i]!) as { type: string }).type;
    // 首连整房摘要恒发(未开局退化 lobbyView,与 server.ts open 同形;room-transport 同款)
    reg.connectSeat(roomId, 0, token, ep);
    expect(ep.sent.length).toBe(1);
    expect(typeOf(0)).toBe("lobby");
    ep.sent.length = 0;

    // 拍1(开局):draft 段批为空,停 Setup 相位(校准窗全程强制全量)→ 纯摘要拍。
    await reg.startGame(roomId, token, broadcast, () => MAP);
    await sleep(20); // flush 是 setTimeout(0) 合并拍
    expect(ep.sent.length).toBe(1);
    expect(typeOf(0)).toBe("snapshot");

    // 拍2(Setup 期推进):首位选都落子,相位仍在 Setup → 照发;批内次序不变。
    const e = reg.get(roomId)!.engine!;
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    expect(e.phase).toBe("Setup");
    await sleep(20);
    expect(ep.sent.length).toBe(3);
    expect(typeOf(1)).toBe("events");
    expect(typeOf(2)).toBe("snapshot");

    // 拍3(开局收口):末位落子触发 finishSetup,批含 gameStarted ∈ 校准 kind → 照发。
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    expect(e.phase).toBe("Playing");
    await sleep(20);
    expect(ep.sent.length).toBe(5);
    expect(typeOf(3)).toBe("events");
    expect(typeOf(4)).toBe("snapshot");

    // 拍4/拍5(Playing 普通推进):行军落格(掷骰/行军/落格事件族)与决策放行——校准
    // kind 缺席、决策窗前后沿不夹,批内 fold+calibration 档事件也不带快照(#529 同联机
    // 闭沿限流)。rollAndMove 走 applyCommand 公共命令路径(#188 代摇同源,与玩家手点同路)。
    await reg.applyCommand(roomId, { type: "rollAndMove" }, broadcast);
    expect(e.turnPhase).toBe("AwaitingDecision");
    await sleep(20);
    expect(ep.sent.length).toBe(6);
    expect(typeOf(5)).toBe("events");
    await reg.applyCommand(roomId, { type: "endDecision" }, broadcast);
    await sleep(20);
    expect(ep.sent.length).toBe(7);
    expect(typeOf(6)).toBe("events");
    expect(ep.byType("snapshot").length).toBe(3); // 恒发退役:快照只在前三拍
  }, 20_000);

  it("显式通路保护钉:门控判否的现场 flushTransportNow 仍恒发快照(#1241 通路不随门控)", async () => {
    const { reg, roomId, token } = makeRoom();
    const ep = new RecordingEndpoint(0);
    const broadcast = () => reg.transportBroadcast(roomId);
    reg.connectSeat(roomId, 0, token, ep);
    ep.sent.length = 0;
    await reg.startGame(roomId, token, broadcast, () => MAP);
    await sleep(20);
    const e = reg.get(roomId)!.engine!;
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    await sleep(20);
    // 推进到 Playing 普通拍(门控判否现场,前一例同款):末帧 = 无快照的 events。
    await reg.applyCommand(roomId, { type: "rollAndMove" }, broadcast);
    expect(e.turnPhase).toBe("AwaitingDecision");
    await sleep(20);
    expect((JSON.parse(ep.sent[ep.sent.length - 1]!) as { type: string }).type).toBe("events");
    const before = ep.sent.length;

    // 种植收口现场:无在途转移、门控判否,显式通路仍当拍下发整房快照(纯摘要拍)。
    reg.flushTransportNow(roomId);
    expect(ep.sent.length).toBe(before + 1);
    expect((JSON.parse(ep.sent[before]!) as { type: string }).type).toBe("snapshot");
  }, 20_000);

  it("回归钉:真实通路自对弈到终局,副本与权威状态摘要逐位一致", async () => {
    const c = new LocalController(
      MAP,
      {
        seats: [
          { name: "诸侯1", isBot: false, guohao: "魏" },
          { name: "诸侯2", isBot: true },
          { name: "诸侯3", isBot: true },
          { name: "诸侯4", isBot: true },
        ],
        seed: 42,
        mapId: "guanzhong",
        targetNetWorth: 16_000, // 压低达标线,整局回到 60s 预算内收敛(room.test 同款)
        botStepMs: 0, // 单测预算按 0ms bot 连锁书写(#730)
        encounter: { enabled: false },
      },
      new InstantClock(),
    );
    try {
      // 构造同步段停人类选都(#1241 建连摘要已水合副本);落子后 bot 接棒进 Playing。
      c.setupPickCapital(c.engine.offeredCapitals[0]!);
      await waitFor("进 Playing", () => c.engine.phase === "Playing", 15_000);
      // 真人座开局即托管(ADR-0028 bot 代打)= 本通路内的「全 bot 自对弈」(形制注记)。
      c.setAutoPilot(true);
      await waitFor("终局胜者", () => c.engine.isOver && c.engine.winner != null, 80_000);
      await sleep(100); // 排空在途合并拍(末批下行/折叠落账)
      const authority = getAuthorityEngine();
      expect(authority.isOver).toBe(true);
      const authorityWinner: string | undefined = authority.winner?.id;
      expect(c.engine.winner?.id, "副本所见胜者与权威一致").toBe(authorityWinner);
      // 主钉:水合副本(折叠+校准水合)与权威引擎终局状态逐位一致——接缝重捅穿
      // (快照/批通路断)或折叠漏覆盖(契约字段漂移)必挂。
      expect(digestState(c.engine)).toBe(digestState(authority));
    } finally {
      // 孤儿表现队列边界收口(#730 regime 守卫防跨文件中毒):InstantClock 下整局
      // 200+ 批的演出积压远超真实动画吞吐,裸 destroy 只直呼 store 归零事件面(fx
      // 入队游标不同步)→ 遗留待播块逐个算出负 gap、LagCalibrator 判据异常经
      // console.error 外泄,bun test 单进程共享 netStore,恰同进程的后续用例(如
      // solo-presentation-regime 的 chunkErrors 守卫)当场中毒。重连边界先收口:
      // 作废未播块+游标对齐+判据态复位,destroy 的直呼 store 归零自此无差。fx 为
      // 基类 protected,测试缝经受控投射取公共边界方法(SnapshotEffects.resetEventFace)。
      (c as unknown as { fx: { resetEventFace(): void } }).fx.resetEventFace();
      c.destroy();
    }
  }, 100_000);

  it("门控钉·元数据旁路:非校准拍房间行变化补发 lobby(③ 同联机,托管回读通路)", async () => {
    const { reg, roomId, token } = makeRoom();
    const ep = new RecordingEndpoint(0);
    const broadcast = () => reg.transportBroadcast(roomId);
    reg.connectSeat(roomId, 0, token, ep);
    ep.sent.length = 0;
    await reg.startGame(roomId, token, broadcast, () => MAP);
    await sleep(20);
    const e = reg.get(roomId)!.engine!;
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!, broadcast);
    await sleep(20);
    expect(e.phase).toBe("Playing");
    const before = ep.sent.length;

    // 非校准拍(Roll 窗不在 CALIBRATION_WINDOWS)上托管开关:批空、无校准判据 →
    // 快照不发(恒发退役);房间行(autoPilot)指纹变化 → 补发 lobby 形元数据,
    // seat-meta 携带托管标记——local.ts roomSeats 托管回读的唯一即时通路。
    await reg.setAutoPilot(roomId, 0, true, broadcast);
    await sleep(20);
    const newMsgs = ep.sent
      .slice(before)
      .map((d) => JSON.parse(d) as { type: string; seats?: { autoPilot?: boolean }[] });
    expect(
      newMsgs.some((m) => m.type === "snapshot"),
      "非校准拍零快照",
    ).toBe(false);
    const lobby = newMsgs.find((m) => m.type === "lobby");
    expect(lobby, "房间行变化补发 lobby 元数据").toBeTruthy();
    expect(lobby!.seats![0]!.autoPilot, "托管标记随 lobby 下行(回读源)").toBe(true);

    // 指纹稳定:房间行不再变化的普通推进拍零补发(指纹比较,非每拍重发)
    const afterLobby = ep.sent.length;
    await reg.applyCommand(roomId, { type: "rollAndMove" }, broadcast);
    expect(e.turnPhase).toBe("AwaitingDecision");
    await sleep(20);
    const tail = ep.sent.slice(afterLobby).map((d) => JSON.parse(d) as { type: string });
    expect(
      tail.some((m) => m.type === "lobby"),
      "指纹未变的推进拍零补发",
    ).toBe(false);
    expect(
      tail.some((m) => m.type === "snapshot"),
      "推进拍仍零快照",
    ).toBe(false);
  }, 20_000);
});
