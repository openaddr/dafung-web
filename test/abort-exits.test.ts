// 驱动链死亡出口闭合:响亮终局(#642,wayfinder #644「bot 对局零无声软锁」)。
// 守住什么——bot 驱动链三处死亡出口(链内抛异常 / no-progress 断链 / WorkerClock 挂死)
// 都必须以「异常终局」响亮收场(引擎 abortGame:无胜者 + gameOver 事件 reason="aborted"
// + 对局日志终局行含原因摘要),零无声停摆;附引擎语义基座:幂等、snapshot 水密往返。
// 故障注入口径:①botAct 对「相位挂着、载荷已空」失配态当场炸(#649 零兜底读点,直接
// 复用为注入点);②AwaitingExhaustion 空载荷时 botAct 静默 no-op(指纹不变=断链指纹);
// ③worker 侧假 clock 注入(LocalController 构造器测试缝),worker 脚本契约另钉。
// 矩阵交叉钉(#643 终验):故障型×座位控制权两条交叉——失配注入落在托管座(人类+托管,
// 非原生 bot)仍出口①响亮终局;断链指纹落在人类可决策座位(托管已收回)不武装任何
// 看门狗、不 abort,维持现状等玩家。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig, VictoryReason } from "@core/authority";
import type { GameEvent } from "@core/game-events";
import { createDice } from "@core/dice";
import { serializeGame, restoreGameSnapshot } from "@core/snapshot";
import { STALL_ABORT_MS } from "@core/timings";
import { RoomRegistry } from "../scripts/room";
import type { RoomClock } from "../scripts/room";
import { decisionSeatOf } from "../scripts/bot-driver";
import { seatControlled } from "../scripts/seat-projection";
import type { RoomPersistence } from "../scripts/room-persistence";
import type { RoomRecord } from "../scripts/room-record";
import { MAP } from "../scripts/engine-helpers";
import { LocalController } from "../src/app/controllers/local";
import { WORKER_SOURCE } from "../src/app/net/worker-clock";
import type { WorkerClock } from "../src/app/net/worker-clock";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";

const LOCAL_MAP = loadMap(huanyouData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];

function makeEngine(seed = 42): GameEngine {
  const cfg: EngineConfig = { seats: SEATS2, targetNetWorth: 30000 };
  return new GameEngine(LOCAL_MAP.board, LOCAL_MAP.catalog, createDice(seed), cfg);
}

/** 终局行断言:engine 最后一行日志 = 异常终局面(final,机读含 abortReason)。 */
function expectAbortedFinalRow(e: GameEngine, reasonPart: string): void {
  const row = e.log[e.log.length - 1]!;
  expect(row.category).toBe("final");
  const detail = JSON.parse(row.detail) as {
    type: string;
    winner: string | null;
    winReason: string;
    abortReason: string;
  };
  expect(detail.type).toBe("final");
  expect(detail.winner).toBeNull();
  expect(detail.winReason).toBe("aborted");
  expect(detail.abortReason).toContain(reasonPart);
}

/** 事件批中找 gameOver 事件(类型谓词收窄,reason 读口合法)。 */
function gameOverOf(e: GameEngine): { reason: VictoryReason } | undefined {
  return e.gameEvents.find(
    (x): x is Extract<GameEvent, { kind: "gameOver" }> => x.kind === "gameOver",
  );
}

// ────────────────────────── 引擎语义基座 ──────────────────────────

describe("GameEngine.abortGame(#642 响亮终局)", () => {
  it("异常终局语义:无胜者 + GameOver 相位 + 终局行 + gameOver 事件(reason=aborted)", () => {
    const e = makeEngine();
    e.abortGame("测试作废:注入摘要");
    expect(e.isOver).toBe(true);
    expect(e.winner).toBeNull();
    expect(e.winReason).toBe("aborted");
    expect(e.phase).toBe("GameOver");
    expect(e.turnPhase).toBe("GameOver");
    expectAbortedFinalRow(e, "测试作废:注入摘要");
    expect(gameOverOf(e)?.reason).toBe("aborted");
  });

  it("幂等:已终局再调用直接返回,首因不被次因覆盖、日志/事件零增长", () => {
    const e = makeEngine();
    e.abortGame("首因");
    const logLen = e.log.length;
    const evLen = e.gameEvents.length;
    expect(() => e.abortGame("次因")).not.toThrow();
    expect(e.log.length).toBe(logLen);
    expect(e.gameEvents.length).toBe(evLen);
    expectAbortedFinalRow(e, "首因");
  });

  it("snapshot 水密往返:winner=null / winReason=aborted 经 JSON 序列化重建不变形", () => {
    const e = makeEngine();
    e.abortGame("往返测试");
    const snap = serializeGame(e);
    const restored = makeEngine();
    restoreGameSnapshot(restored, JSON.parse(JSON.stringify(snap)) as typeof snap);
    expect(restored.isOver).toBe(true);
    expect(restored.winner).toBeNull();
    expect(restored.winReason).toBe("aborted");
    expect(restored.phase).toBe("GameOver");
    expect(restored.turnPhase).toBe("GameOver");
  });
});

// ────────────────────────── 房间编排三出口 ──────────────────────────

/** 手动时钟(测试注入):定时全挂表,fireAll 手动泵,零真实等待(范式同 room.test.ts)。 */
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
  fireAll(): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb();
  }
  get size(): number {
    return this.pending.size;
  }
}

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

/** 宏任务让位:嵌套 await 延续先于下一次泵送落地(范式同 room.test.ts)。 */
const macroTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 建双人房(0=host 真人,1=bot)开局到 Playing、托管 seat0,驱动链停在 ManualClock 上。
 *  返回后恰完成托管后第一步(链停在步进 await),可对引擎做失配注入再泵。 */
async function autoPilotRoom(options?: { stallAbortMs?: number }) {
  const clock = new ManualClock();
  const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, {
    clock,
    stallAbortMs: options?.stallAbortMs,
  });
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set([1]),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  reg.setMap(roomId, "huanyou", created.token, new Set(["huanyou"]));
  await reg.startGame(roomId, created.token, undefined, () => MAP);
  const e = created.room.engine!;
  expect(e.phase).toBe("Setup");
  await reg.pickCapital(roomId, 0, e.offeredCapitals[0]!); // 真人选都 → bot 接棒进 Playing,链停在真人座位
  expect(e.phase).toBe("Playing");
  await reg.setAutoPilot(roomId, 0, true); // 托管:链重开,第一步后停在时钟 await(2s 步进挂 ManualClock)
  return { reg, roomId, clock, e, token: created.token };
}

describe("驱动链死亡出口(#642 三出口故障注入)", () => {
  it("出口① 链内抛异常:botAct 炸出 → 链捕获 → abortGame 响亮终局,摘要进对局日志", async () => {
    const { reg, roomId, clock, e, token } = await autoPilotRoom();
    // 注入 #640 病灶态同款失配:相位挂着、载荷已空(botAct 读点当场炸,#649 零兜底)
    e.turnPhase = "AwaitingHeroPick";
    e.offeredHeroes = [];
    clock.fireAll(); // 泵停着的步进 await → 链下一拍 botAct → 抛
    await macroTick();
    expect(e.isOver).toBe(true);
    expect(e.winner).toBeNull();
    expect(e.winReason).toBe("aborted");
    expectAbortedFinalRow(e, "offeredHeroes");
    expect(e.log[e.log.length - 1]!.detail).toContain("驱动链异常");
    expect(gameOverOf(e)?.reason).toBe("aborted");
    reg.dismissRoom(roomId, token);
  }, 20_000);

  it("出口② no-progress 断链:bot 相位断链武装停摆看门狗,到点 abortGame(相位/座位指纹进 reason)", async () => {
    const { reg, roomId, clock, e, token } = await autoPilotRoom({ stallAbortMs: 5000 });
    // 注入断链指纹:AwaitingExhaustion 空载荷 → botAct 静默 no-op → 指纹不变 → 无人再拉链
    e.turnPhase = "AwaitingExhaustion";
    e.pendingExhaustionSeat = null;
    clock.fireAll(); // 泵一步:botAct no-op → 链以 no-progress 断链 → 武装停摆看门狗
    await macroTick();
    expect(e.isOver).toBe(false); // 断链当场不炸:等窗口到点(响亮但不即时)
    expect(clock.size).toBeGreaterThanOrEqual(1); // 看门狗已武装
    clock.fireAll(); // 窗口到点:看门狗点火 → abortGame
    await macroTick();
    expect(e.isOver).toBe(true);
    expect(e.winReason).toBe("aborted");
    expectAbortedFinalRow(e, "驱动链停摆超时");
    expect(e.log[e.log.length - 1]!.detail).toContain("AwaitingExhaustion");
    expect(e.log[e.log.length - 1]!.detail).toContain("座位 0");
    reg.dismissRoom(roomId, token);
  }, 20_000);

  it("交叉①(#643)失配态注入在托管座(人类+托管,非原生 bot):仍走出口①响亮终局", async () => {
    const { reg, roomId, clock, e, token } = await autoPilotRoom();
    const room = reg.get(roomId)!;
    // 白盒钉死爆炸点=托管座:引擎侧是人类玩家(isBot=false),仅凭托管开关被服务器驱动
    e.activeIndex = 0;
    expect(room.seats[0]!.kind).toBe("human");
    expect(room.autoPilot.has(0)).toBe(true);
    expect(e.players[0]!.isBot).toBe(false);
    expect(decisionSeatOf(e)).toBe(0);
    expect(seatControlled(room, 0)).toBe(true);
    // #649 病灶式失配(与出口①既有例同款):相位挂着、载荷已空
    e.turnPhase = "AwaitingHeroPick";
    e.offeredHeroes = [];
    clock.fireAll(); // 泵停着的步进 await → 链下一拍 botAct(托管座)→ 抛
    await macroTick();
    expect(e.isOver).toBe(true);
    expect(e.winReason).toBe("aborted");
    expectAbortedFinalRow(e, "offeredHeroes");
    expect(e.log[e.log.length - 1]!.detail).toContain("驱动链异常");
    expect(gameOverOf(e)?.reason).toBe("aborted");
    reg.dismissRoom(roomId, token);
  }, 20_000);

  it("交叉②(#643)断链指纹落在人类可决策座位:不武装 stallAbort、不 abort,维持现状等玩家", async () => {
    const { reg, roomId, clock, e, token } = await autoPilotRoom({ stallAbortMs: 5000 });
    // 人类经公开 API 收回托管(在途链持重入守卫,调度即返回;原链仍停在步进 await)
    await reg.setAutoPilot(roomId, 0, false);
    // 注入出口②同款断链指纹,与出口②既有例唯一差别:决策座位控制权已回到人类
    e.turnPhase = "AwaitingExhaustion";
    e.pendingExhaustionSeat = null;
    const room = reg.get(roomId)!;
    expect(room.autoPilot.has(0)).toBe(false);
    expect(decisionSeatOf(e)).toBe(0);
    expect(seatControlled(room, 0)).toBe(false); // 人类可决策座位:非 bot、托管已收回
    clock.fireAll(); // 泵:链头重读控制权 → 不可驱动即停,不进 botAct(断链态不归服务器管)
    await macroTick();
    expect(e.isOver).toBe(false); // 不 abort:人类座位的失配态不是服务器侧软锁
    expect(clock.size).toBe(0); // 零看门狗武装(stallAbort/stall/autoRoll 全不武装)
    clock.fireAll(); // 再泵仍无火可点:无任何定时器
    await macroTick();
    expect(e.isOver).toBe(false);
    reg.dismissRoom(roomId, token);
  }, 20_000);
});

// ────────────────────────── 出口③:WorkerClock 挂死 ──────────────────────────

/** 假 Worker 时钟(出口③注入缝):定时挂空表,只留 fatal 通道供测试点火。 */
class FakeWorkerClock implements WorkerClock {
  private fatalListener: ((message: string) => void) | null = null;
  setTimeout(): unknown {
    return {};
  }
  clearTimeout(): void {}
  pause(): void {}
  resume(): void {}
  get paused(): boolean {
    return false;
  }
  dispose(): void {}
  onFatal(listener: (message: string) => void): void {
    this.fatalListener = listener;
  }
  /** 测试点火:模拟 worker onerror / worker 内部异常上抛。 */
  crash(message: string): void {
    this.fatalListener!(message);
  }
}

describe("出口③ WorkerClock 挂死(#642)", () => {
  it("时钟 fatal → LocalController 对局作废,错误摘要进 abort reason 与对局日志", () => {
    const clock = new FakeWorkerClock();
    const c = new LocalController(
      LOCAL_MAP,
      {
        seats: [
          { name: "诸侯1", isBot: false, guohao: "魏" },
          { name: "诸侯2", isBot: true },
          { name: "诸侯3", isBot: true },
        ],
        seed: 1,
        mapId: "huanyou",
      },
      clock,
    );
    try {
      expect(c.engine.isOver).toBe(false);
      expect(STALL_ABORT_MS).toBe(30_000); // 单机停摆作废窗口常量钉值(core/timings 单源)
      clock.crash("定时器线程崩溃");
      const e = c.engine;
      expect(e.isOver).toBe(true);
      expect(e.winReason).toBe("aborted");
      expectAbortedFinalRow(e, "时钟挂死");
      expect(e.log[e.log.length - 1]!.detail).toContain("定时器线程崩溃");
    } finally {
      c.destroy();
    }
  }, 20_000);

  it("worker 脚本契约:内部异常转 fatal postMessage(出口③触发源,真 Worker 验证)", async () => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    try {
      const got = await new Promise<{ act: string; message: string }>((resolve, reject) => {
        worker.onmessage = (ev) => resolve(ev.data as { act: string; message: string });
        setTimeout(() => reject(new Error("worker 未回 fatal 消息")), 3000);
        worker.postMessage(null); // onmessage 内读 d.act 即炸 → try/catch → fatal 回发
      });
      expect(got.act).toBe("fatal");
      expect(typeof got.message).toBe("string");
      expect(got.message.length).toBeGreaterThan(0);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, 10_000);
});
