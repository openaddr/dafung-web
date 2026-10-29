// 单机演出自洽回归(#730,ADR-0034):普通对局(托管自走的完整节奏)不得进追帧/吸附档,
// 人类决策点不得压着未播旧批——「bot 瞬间结算无移动」「按钮出来了我还在看别人走棋」
// 两症状的合成钉子。病根是产出端无配速(bot 0ms 连锁)+判据水位低于正常局;本用例锁
// 「BOT_STEP_MS 配速 + 再定标判据」的稳态:校准器整局零触发。
// 无 DOM 运行时:五个演出叶子(audio/DiceOverlay/DuelSignsOverlay/desk/useMarch)换成
// 时长忠实 mock(同一常量表、同一公式),其余全真链路(LocalController → SnapshotEffects
// → LagCalibrator),mock 缺席即动态失真,chunkErrors 守卫拦之。
// 墙钟预算:40s 实速(配速回归坏掉时追帧 ~5s 内即触发,RED 足够快)。
import { describe, expect, it, mock } from "bun:test";
import { delay, DICE, DUEL, MARCH } from "../src/app/fx/timings";
import { BOT_STEP_MS } from "../src/core/timings";
import type { MarchSegmentFrames } from "../src/app/fx/presentation";

// ── 时长忠实 mock(播放时长对齐生产 sink;DOM 触点全部 stub)──
let diceFast = false;
const diceTotalMs = (fast: boolean): number =>
  fast
    ? DICE.botShakeMs + DICE.botHoldMs + DICE.fadeOutMs
    : DICE.shakeMs + DICE.holdMs + DICE.fadeOutMs;
const duelTotalMs = (): number =>
  DUEL.curtainMs + DUEL.shakeMs + DUEL.clackGapMs + DUEL.verdictMs + DUEL.holdMs + DUEL.fadeOutMs;
const segDuration = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(MARCH.maxSegMs, Math.max(MARCH.minSegMs, (dist / MARCH.speed) * 1000));
};

mock.module("../src/app/fx/audio", () => ({
  getAudio: () => ({ play: () => {} }),
  setAudio: () => {},
  HybridAudioPlayer: class {},
  AUDIO_FILES: {},
  FILE_TRIM: {},
}));
mock.module("../src/app/fx/DiceOverlay", () => ({
  setDiceFast: (f: boolean) => {
    diceFast = f;
  },
  finishDiceOverlay: () => {},
  diceApi: {
    roll: async () => {
      await delay(diceTotalMs(diceFast));
    },
  },
  DiceOverlay: () => null,
}));
mock.module("../src/app/fx/DuelSignsOverlay", () => ({
  finishDuelSigns: () => {},
  duelSignsApi: {
    play: async () => {
      await delay(duelTotalMs());
    },
  },
  DuelSignsOverlay: () => null,
}));
mock.module("../src/app/fx/desk", () => ({
  shakeDesk: () => {},
  fallTokenFlag: () => {},
}));
mock.module("../src/app/fx/useMarch", () => {
  return {
    marchPos: new Map<string, { x: number; y: number }>(),
    isMarching: () => false,
    openMarchBatch: () => {},
    beginMarch: () => {},
    abandonMarch: () => {},
    abandonAllMarches: () => {},
    animateMove: async (_moverId: string, keyframes: readonly MarchSegmentFrames[]) => {
      // 时长忠实:逐段 delay(与真实现同一公式、同一常量表、同一追帧倍率)
      for (const seg of keyframes)
        for (let i = 1; i < seg.points.length; i++)
          await delay(segDuration(seg.points[i - 1]!, seg.points[i]!));
    },
  };
});

// ── mock 落定后再引真链路 ──
const { MAP } = await import("../scripts/engine-helpers");
const { LocalController } = await import("../src/app/controllers/local");
const { useNetStore } = await import("../src/app/store/netStore");
const { catchupCounters } = await import("../src/app/fx/catchup");

const SAMPLE_MS = 200;
const RUN_MS = 40_000;

describe("单机演出自洽稳态(#730,ADR-0034)", () => {
  it("配速普通局:追帧/吸附零触发,人类决策点不压未播旧批", async () => {
    const calibLog: string[] = [];
    const chunkErrors: string[] = [];
    const origDebug = console.debug;
    const origError = console.error;
    console.debug = (...args: unknown[]) => {
      calibLog.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      // 只认表现链路异常;logArchive 的 indexedDB 缺席是无头环境预期噪声
      if (line.includes("表现播放异常")) chunkErrors.push(line);
    };

    const samples: Array<{
      t: number;
      turn: number;
      owner: number;
      phase: string;
      seq: number;
      busy: boolean;
      gap: number;
      wait: number;
      scale: number;
    }> = [];
    const arrivals: Array<{ t: number; seq: number; events: number }> = [];
    const beforeCounters = { ...catchupCounters }; // 计数器跨用例累积:本局只认增量

    const c = new LocalController(MAP, {
      seats: [
        { name: "诸侯1", isBot: false, guohao: "魏" },
        { name: "诸侯2", isBot: true },
        { name: "诸侯3", isBot: true },
      ],
      seed: 1,
      mapId: "huanyou",
      botStepMs: BOT_STEP_MS, // 显式钉配速开启(不依赖解析链缺省)
    });
    let lastSeq = 0;
    try {
      // 配速下选都按 bot→human 逐拍滚:等轮到人类(本地座位)再落子
      for (let i = 0; i < 120 && c.engine.currentSetupPlayerIndex !== c.seat; i++) await delay(100);
      c.setupPickCapital(c.engine.offeredCapitals[0]!);
      for (let i = 0; i < 120 && c.engine.phase !== "Playing"; i++) await delay(100);
      expect(c.engine.phase).toBe("Playing");
      c.setAutoPilot(true);
      for (let i = 0; i < 50 && !c.autoPilotOn; i++) await delay(100);

      const t0 = Date.now();
      while (Date.now() - t0 < RUN_MS) {
        await delay(SAMPLE_MS);
        const net = useNetStore.getState();
        if (net.eventBatchSeq !== lastSeq) {
          arrivals.push({
            t: Date.now() - t0,
            seq: net.eventBatchSeq,
            events: net.lastEvents?.length ?? 0,
          });
          lastSeq = net.eventBatchSeq;
        }
        const e = c.engine;
        samples.push({
          t: Date.now() - t0,
          turn: e.turnNumber,
          owner: e.decisionOwner,
          phase: e.phase,
          seq: net.eventBatchSeq,
          busy: c.fxBusy,
          gap: catchupCounters.lastGapBatches,
          wait: Math.round(catchupCounters.lastWaitMs),
          scale: catchupCounters.lastRuntimeScale,
        });
      }
    } finally {
      console.debug = origDebug;
      console.error = origError;
      c.destroy();
    }

    // ── 报告 ──
    const bursts: number[][] = [];
    for (const a of arrivals) {
      const last = bursts[bursts.length - 1];
      if (last && a.t - (arrivals.find((x) => x.seq === last[last.length - 1])?.t ?? 0) < 500)
        last.push(a.seq);
      else bursts.push([a.seq]);
    }
    // 计数器是模块级跨用例累积量:取本局增量差分(全量套跑时先前文件已抬基数)
    const snapCount = catchupCounters.snapBatches - beforeCounters.snapBatches;
    const catchupCount = catchupCounters.catchupBatches - beforeCounters.catchupBatches;
    console.log(
      `[fxlag] 到达流:${arrivals.length} 条消息 / ${bursts.length} 个簇;` +
        `判档:追帧 ${catchupCount} 次,吸附 ${snapCount} 次;` +
        `末拍 gap=${catchupCounters.lastGapBatches} wait=${catchupCounters.lastWaitMs}ms scale=${catchupCounters.lastRuntimeScale}`,
    );
    console.log(
      `[fxlag] 消息簇大小分布:${bursts.map((b) => b.length).join(",")}` +
        `(簇=间隔<500ms);每消息事件数:${arrivals.map((a) => a.events).join(",")}`,
    );
    console.log(`[fxlag] 校准器日志 ${calibLog.length} 条:`);
    for (const line of calibLog) console.log(`  ${line}`);
    // 过时演出判据:gap≥2 = 最新批之外还有整批未播(按钮出现时播的是别人的旧演出);
    // gap=1 = 仅最新批在播(自己回合的开场横幅/骰子),是健康尾流不算
    const humanBusyWhileBehind = samples.filter(
      (s) => s.phase === "Playing" && s.owner === 0 && s.busy && s.gap >= 2,
    );
    console.log(
      `[fxlag] 人类决策点采样 ${samples.filter((s) => s.owner === 0 && s.phase === "Playing").length} 次,` +
        `其中播着旧批(gap≥2)且忙 ${humanBusyWhileBehind.length} 次`,
    );

    expect(chunkErrors).toEqual([]); // 动态失真守卫:sink 链路不允许异常
    expect(catchupCount).toBe(0); // 稳态①:校准器整局零触发(配速坏掉 ~5s 内转红)
    expect(snapCount).toBe(0); // 稳态②:不得吸附(= bot 瞬间结算)
    expect(humanBusyWhileBehind.length).toBe(0); // 稳态③:决策点不得压未播旧批
  }, 120_000);
});
