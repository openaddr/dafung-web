// 落后即校准(#610,ADR-0029 不变量③)双契约:
//   判据分类 — LagCalibrator 纯决策缝:混合尺(主尺=未消费批数,辅尺=批龄)输入,
//   三档(steady/catchup/snap)输出;单次超线只升追帧、连续 N 批超线才升吸附、
//   回落到线即回 1(colyseus drift 分类同构:#600)。
//   吸附语义 — SnapshotEffects 出队点判档:吸附档整块跳过未播 present(骰子/浮字/
//   行军不播)+ abandonAllMarches 清会话(棋子由声明式终态落位);边界
//   (dropStalledBatch/resetEventFace)给未开播块打作废标记,出队检查即弃。
// 判据主尺 = 机器时间(到达序游标差),测试里全同步入队即可构造积压,无墙钟依赖。
// 观测缝与既有 SnapshotEffects 用例同款:生产 sink 落店(浮字读 fxStore,会话读
// marching 投影),不注入替身。
import { describe, it, expect, beforeEach } from "bun:test";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import type { GameEvent } from "@core/game-events";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { testEngine } from "@core/testing";
import { LAG, setCatchupScale } from "../src/app/fx/timings";
import { catchupCounters, LagCalibrator } from "../src/app/fx/catchup";
import { SnapshotEffects } from "../src/app/net/snapshot-effects";
import { useFxStore } from "../src/app/fx/fxStore";
import { useNetStore } from "../src/app/store/netStore";
import { resetFxOrchestration } from "../src/app/fx/orchestrator";

const MAP = loadMap(huanyouData);

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 8000,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(照 presentation.test.ts 的构造方式)。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  });
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ─────────────── 判据分类:LagCalibrator(混合尺,分类非布尔)───────────────
describe("落后校准判据 LagCalibrator(#610,ADR-0029 ③)", () => {
  /** 主尺超线的标准输入(批龄清零,隔离辅尺)。 */
  const gapLaggy = (): { gapBatches: number; waitMs: number } => ({
    gapBatches: LAG.gapBatches,
    waitMs: 0,
  });

  beforeEach(() => {
    setCatchupScale(1); // 运行时乘数全局态,跨用例复位
  });

  it("双尺在线:steady 且倍率回 1(回落到线即回 1)", () => {
    const c = new LagCalibrator();
    const d = c.observe({
      gapBatches: LAG.gapBatches - 1,
      waitMs: LAG.ageMs - 1,
    });
    expect(d.tier).toBe("steady");
    expect(d.runtimeScale).toBe(1);
  });

  it("主尺单次超线 → 只升追帧档,倍率从 scaleMin 起步", () => {
    const c = new LagCalibrator();
    const d = c.observe(gapLaggy());
    expect(d.tier).toBe("catchup");
    expect(d.runtimeScale).toBe(LAG.scaleMin);
  });

  it("辅尺单超(批龄)同样升追帧:主尺盲区(单批超长)由辅尺兜住(#600)", () => {
    const c = new LagCalibrator();
    const d = c.observe({ gapBatches: 1, waitMs: LAG.ageMs });
    expect(d.tier).toBe("catchup");
    expect(d.runtimeScale).toBe(LAG.scaleMin);
  });

  it("积压越深倍率越高:每深一批 +scaleStep,到 scaleMax 顶格", () => {
    const c = new LagCalibrator();
    const stepsToMax = Math.ceil((LAG.scaleMax - LAG.scaleMin) / LAG.scaleStep);
    expect(c.observe(gapLaggy()).runtimeScale).toBe(LAG.scaleMin);
    for (let i = 1; i <= stepsToMax; i++) {
      const d = c.observe({ gapBatches: LAG.gapBatches + i, waitMs: 0 });
      expect(d.runtimeScale).toBe(Math.min(LAG.scaleMax, LAG.scaleMin + i * LAG.scaleStep));
    }
    // 顶格后不再涨(追帧倍率上限即两档分界,ADR-0029 ③)
    expect(c.observe({ gapBatches: LAG.gapBatches + 100, waitMs: 0 }).runtimeScale).toBe(
      LAG.scaleMax,
    );
  });

  it("连续 N 批超线才升吸附;吸附后观察窗重开(下一批从 1 重新计数)", () => {
    const c = new LagCalibrator();
    for (let i = 1; i < LAG.consecutiveForSnap; i++) {
      expect(c.observe(gapLaggy()).tier).toBe("catchup");
    }
    expect(c.observe(gapLaggy()).tier).toBe("snap"); // 第 N 次:吸附
    expect(c.observe(gapLaggy()).tier).toBe("catchup"); // 窗口已重开
  });

  it("回落复位:一次 steady 即清连超计数,后续重新攒 N 次才吸附", () => {
    const c = new LagCalibrator();
    for (let i = 1; i < LAG.consecutiveForSnap; i++) c.observe(gapLaggy());
    expect(c.observe({ gapBatches: 0, waitMs: 0 }).tier).toBe("steady"); // 回落
    for (let i = 1; i < LAG.consecutiveForSnap; i++) {
      expect(c.observe(gapLaggy()).tier).toBe("catchup"); // 重新计数,不立即吸附
    }
    expect(c.observe(gapLaggy()).tier).toBe("snap");
  });

  it("reset 清判据态:积压连超中途 reset,下一批不立即吸附", () => {
    const c = new LagCalibrator();
    for (let i = 0; i < LAG.consecutiveForSnap - 1; i++) c.observe(gapLaggy());
    c.reset();
    expect(c.observe(gapLaggy()).tier).toBe("catchup");
  });

  it("调试桥计数:超线/追帧/吸附分类计数与末次判据依据留痕", () => {
    const c = new LagCalibrator();
    const before = { ...catchupCounters };
    c.observe({ gapBatches: 0, waitMs: 0 }); // steady:只更新末次依据
    expect(catchupCounters.laggyBatches).toBe(before.laggyBatches);
    c.observe(gapLaggy()); // 追帧 1 次
    expect(catchupCounters.laggyBatches).toBe(before.laggyBatches + 1);
    expect(catchupCounters.catchupBatches).toBe(before.catchupBatches + 1);
    expect(catchupCounters.lastGapBatches).toBe(LAG.gapBatches);
    for (let i = 1; i < LAG.consecutiveForSnap; i++) c.observe(gapLaggy()); // 攒到吸附
    expect(catchupCounters.snapBatches).toBe(before.snapBatches + 1);
    expect(catchupCounters.lastRuntimeScale).toBeGreaterThan(1);
  });
});

// ─────────────── 吸附与边界:SnapshotEffects 出队点判档 ───────────────
/** 有表现的最小批:marchArrived(烤行军,锚定先行)+ 负浮字(delta 作断言指纹)。
 *  快照终态语义 = place(seat)(hydrate 后引擎态,与联机通路一致)。 */
function presentableBatch(
  e: GameEngine,
  seat: number,
  delta: number,
  withMarch: boolean,
): { events: GameEvent[]; pre: number[] } {
  const pre = e.players.map((p) => p.position);
  const events: GameEvent[] = [];
  if (withMarch) {
    const path = e.board.computePath(e.players[seat].position, 2, e.players[seat].capitalIndex);
    testEngine(e).place(seat, path.landIndex);
    events.push({ kind: "marchArrived", seat, round: 1, turn: 1, tileIndex: path.landIndex, path });
  }
  events.push({ kind: "cashChanged", seat, round: 1, turn: 1, delta, reason: "encounter" });
  return { events, pre };
}

/** 同步入队 K 批并 play(全部积压在 fxQueue 上,微任务才出队)——主尺 = 到达序
 *  游标差,机器时间,零墙钟依赖即可构造任意深度的积压。 */
function enqueueBatches(
  fx: SnapshotEffects,
  batches: Array<{ events: GameEvent[]; pre: number[] }>,
) {
  for (const b of batches) {
    useNetStore.getState().pushEventBatch(b.events);
    fx.play(b.pre);
  }
}

/** 等队列排空(pendingChunks 归零 = 全部块已出队并处置)。 */
async function drain(fx: SnapshotEffects) {
  let guard = 0;
  while (fx.playing && guard++ < 100) await tick();
  await tick();
}

describe("SnapshotEffects 落后即校准:吸附重档(#610,ADR-0029 ③)", () => {
  beforeEach(() => {
    resetFxOrchestration();
    useFxStore.getState().resetFx();
    useNetStore.getState().resetEventFace();
    setCatchupScale(1);
  });

  it("连续 N 批超线 → 第 N 块整块跳过(浮字不播、行军会话作废),其余块演出照播", async () => {
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    // K = N+2:块 1..N 连续超线(第 N 块吸附),N+1/N+2 落回线下(浮字照播);
    // 行军只挂 1/2/N 三块:吸附块的锚定会话必须被收回(不收回 = 棋子冻结起点挂金边)
    const K = LAG.consecutiveForSnap + 2;
    const snapDelta = -LAG.consecutiveForSnap;
    const countersBefore = { ...catchupCounters };
    enqueueBatches(
      fx,
      Array.from({ length: K }, (_, i) =>
        presentableBatch(e, (i + 1) % 2, -(i + 1), [1, 2, LAG.consecutiveForSnap].includes(i + 1)),
      ),
    );
    expect(useFxStore.getState().marching.size).toBeGreaterThan(0); // 锚定先行(play 拍)
    await drain(fx);
    // 吸附块:浮字未播(骰子/横幅同此通路,整块跳过);会话已作废
    const amounts = useFxStore.getState().floaters.map((f) => f.amount);
    expect(amounts).not.toContain(snapDelta);
    expect(useFxStore.getState().marching.size).toBe(0);
    // 追帧块(1..N−1)与回线后的块(N+1..K)演出仍在(加速播 ≠ 不播)
    expect(amounts).toEqual(
      Array.from({ length: K }, (_, i) => -(i + 1)).filter((d) => d !== snapDelta),
    );
    // 诊断桥计数随判定推进(端到端:出队点判档真发生)
    expect(catchupCounters.snapBatches).toBe(countersBefore.snapBatches + 1);
    expect(catchupCounters.catchupBatches).toBe(
      countersBefore.catchupBatches + LAG.consecutiveForSnap - 1,
    );
  });

  it("浅积压不升档:单批演出全量照播(判据不误触发)", async () => {
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    const countersBefore = { ...catchupCounters };
    enqueueBatches(fx, [presentableBatch(e, 0, -1, true)]); // 单批:gap=1 在线下
    await drain(fx);
    expect(useFxStore.getState().floaters.map((f) => f.amount)).toEqual([-1]);
    expect(useFxStore.getState().marching.size).toBe(0); // 正常收尾(播完即收,非作废)
    expect(catchupCounters.snapBatches).toBe(countersBefore.snapBatches);
    expect(catchupCounters.laggyBatches).toBe(countersBefore.laggyBatches);
  });

  it("边界清待播队列:dropStalledBatch 作废未开播块(出队即弃),新批照常消费", async () => {
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    enqueueBatches(fx, [presentableBatch(e, 0, -1, true), presentableBatch(e, 1, -2, false)]);
    fx.dropStalledBatch(); // 断线边界:同步打作废标记(先于任何出队微任务)
    await drain(fx);
    expect(useFxStore.getState().floaters).toEqual([]); // 两块都未开播,整队作废
    enqueueBatches(fx, [presentableBatch(e, 0, -3, false)]); // 游标已对齐:新批正常消费
    await drain(fx);
    expect(useFxStore.getState().floaters.map((f) => f.amount)).toEqual([-3]);
  });

  it("resetEventFace 同款作废:事件面归零后新批(seq 撞号也不误判)照常消费", async () => {
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    enqueueBatches(fx, [presentableBatch(e, 0, -1, false)]);
    fx.resetEventFace(); // 重连边界:netStore 归零 + 本器游标归零 + 待播块作废
    await drain(fx);
    expect(useFxStore.getState().floaters).toEqual([]);
    enqueueBatches(fx, [presentableBatch(e, 1, -2, false)]); // seq 从 1 重新计:不得被去重误跳
    await drain(fx);
    expect(useFxStore.getState().floaters.map((f) => f.amount)).toEqual([-2]);
  });
});
