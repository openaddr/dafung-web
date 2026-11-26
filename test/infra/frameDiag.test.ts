// 帧诊（ADR-0047）。直接推进平台时钟与帧回调，验证取用的诊断证据。
import { describe, it, expect } from "bun:test";
import { startFrameDiag, summarizeDeltas, splitLoaf } from "@app/frameDiag";
import { useFxStore } from "@app/fx/fxStore";

describe("frameDiag 窗口摘要", () => {
  it("分位:升序截取,p95 取 95% 位样本,p50 取中位样本", () => {
    const deltas = [16, 17, 18, 19, 100]; // 升序,5 帧
    const s = summarizeDeltas(deltas);
    expect(s.frames).toBe(5);
    expect(s.p50).toBe(18); // floor(5*0.5)=2 → 第 3 个
    expect(s.p95).toBe(100); // floor(5*0.95)=4 → 第 5 个
    expect(s.max).toBe(100);
    expect(summarizeDeltas([16.66, 16.7, 16.68]).p50).toBeCloseTo(16.68, 1);
  });

  it("空窗:全零不炸(停采瞬间清窗的边界)", () => {
    const s = summarizeDeltas([]);
    expect(s.frames).toBe(0);
    expect(s.p50).toBe(0);
    expect(s.max).toBe(0);
  });
});

describe("frameDiag LoAF 拆分", () => {
  it("script 段求和 + style/layout = renderStart 与样式起点的差", () => {
    const r = splitLoaf({
      duration: 120,
      renderStart: 90,
      styleAndRenderStart: 60,
      scripts: [{ duration: 40 }, { duration: 25.5 }],
    });
    expect(r.durMs).toBe(120);
    expect(r.scriptMs).toBeCloseTo(65.5, 1);
    expect(r.styleLayoutMs).toBeCloseTo(30, 1);
  });

  it("字段缺失(老 WebView 形态):拆分落 0 不负值", () => {
    const r = splitLoaf({ duration: 80 });
    expect(r.scriptMs).toBe(0);
    expect(r.styleLayoutMs).toBe(0);
    const neg = splitLoaf({ duration: 10, renderStart: 5, styleAndRenderStart: 9 });
    expect(neg.styleLayoutMs).toBe(0); // 起点倒挂夹到 0
  });
});

type Observation = Pick<PerformanceEntry, "startTime" | "duration">;

interface FrameHost {
  diag: ReturnType<typeof startFrameDiag>;
  frame(at: number): void;
  tick(at: number): void;
  advance(at: number): void;
  visibility(at: number, state: DocumentVisibilityState): void;
  observe(type: string, entry: Observation, defer?: boolean): void;
}

function withFrameHost(run: (host: FrameHost) => void, entryTypes: string[] = []): void {
  let now = 100;
  let frame: FrameRequestCallback | null = null;
  let tick: (() => void) | null = null;
  const observers = new Map<string, TestObserver>();
  class TestObserver {
    static supportedEntryTypes = entryTypes;
    entries: Observation[] = [];

    constructor(private readonly notify: (list: { getEntries(): Observation[] }) => void) {}

    observe({ type }: { type: string }) {
      observers.set(type, this);
    }

    takeRecords() {
      return this.entries.splice(0);
    }

    deliver() {
      this.notify({ getEntries: () => this.takeRecords() });
    }

    disconnect() {
      this.entries.length = 0;
    }
  }

  const replacements = {
    document: Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    }),
    performance: { timeOrigin: 1760000000000, now: () => now },
    PerformanceObserver: TestObserver,
    requestAnimationFrame(callback: FrameRequestCallback) {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame() {
      frame = null;
    },
    setInterval(callback: () => void) {
      tick = callback;
      return 1;
    },
    clearInterval() {
      tick = null;
    },
  };
  const originals = Object.entries(replacements).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    return { key, descriptor };
  });
  let diag: ReturnType<typeof startFrameDiag> | undefined;
  try {
    diag = startFrameDiag();
    run({
      diag,
      frame(at) {
        now = at;
        if (frame === null) throw new Error("没有待执行的帧回调");
        const callback = frame;
        frame = null;
        callback(at);
      },
      tick(at) {
        now = at;
        tick?.();
      },
      advance(at) {
        now = at;
      },
      visibility(at, state) {
        now = at;
        replacements.document.visibilityState = state;
        replacements.document.dispatchEvent(new Event("visibilitychange"));
      },
      observe(type, entry, defer = false) {
        const observer = observers.get(type);
        if (observer === undefined) throw new Error(`没有观测 ${type}`);
        observer.entries.push(entry);
        if (!defer) observer.deliver();
      },
    });
  } finally {
    try {
      diag?.stop();
    } finally {
      for (const { key, descriptor } of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
        else Object.defineProperty(globalThis, key, descriptor);
      }
    }
  }
}

it("实际窗口各帧只计一次，在局取用和停采都包含有样本的末窗", () => {
  withFrameHost(({ diag, frame, tick, advance }) => {
    frame(116);
    frame(196);
    for (let at = 212; at <= 5156; at += 16) frame(at);
    tick(5160);
    frame(5172);
    frame(5188);
    advance(5190);
    const collected = diag.collect();
    expect(collected).toMatchObject({ loafSupported: false, longTaskSupported: false });
    expect(collected.windows).toMatchObject([
      { t0: 100, t1: 5160, frames: 311, p50: 16, p95: 16, max: 80 },
      { t0: 5160, t1: 5190, frames: 2, p50: 16, p95: 16, max: 16 },
    ]);
    expect(collected.jank).toMatchObject([{ t: 196, deltaMs: 80 }]);

    frame(5204);
    advance(5210);
    expect(diag.stop()).toMatchObject({
      stoppedAt: 5210,
      windows: [
        { t0: 100, t1: 5160, frames: 311, max: 80 },
        { t0: 5160, t1: 5210, frames: 3, max: 16 },
      ],
    });
    expect(collected.windows[1]).toMatchObject({ t1: 5190, frames: 2 });
  });
});

it("后台封窗，首帧等待单列，连同迟到的后台观测均从前台窗口排除", () => {
  withFrameHost(
    ({ diag, frame, tick, visibility, advance, observe }) => {
      frame(120);
      frame(140);
      advance(215);
      observe("longtask", { startTime: 155, duration: 60 }, true);
      advance(230);
      observe("long-animation-frame", { startTime: 165, duration: 65 }, true);
      visibility(240, "hidden");
      expect(diag.collect().windows).toMatchObject([
        { t0: 100, t1: 240, frames: 1, max: 20, longTasks: 1, longTaskMs: 60, loafCount: 1 },
      ]);

      advance(2000);
      observe("longtask", { startTime: 1000, duration: 100 });
      tick(7000);
      expect(diag.collect().windows).toHaveLength(1);
      visibility(8050, "visible");
      advance(8100);
      observe("long-animation-frame", { startTime: 7970, duration: 125 });
      observe("longtask", { startTime: 7980, duration: 110 });
      advance(8290);
      observe("longtask", { startTime: 8200, duration: 90 }, true);
      frame(8440);
      frame(8460);
      advance(8480);

      expect(diag.stop()).toMatchObject({
        timeOrigin: 1760000000000,
        initialVisibility: "visible",
        loafSupported: true,
        longTaskSupported: true,
        windows: [
          { t0: 100, t1: 240, frames: 1, max: 20, longTasks: 1, longTaskMs: 60, loafCount: 1 },
          { t0: 8050, t1: 8480, frames: 1, max: 20, longTasks: 1, longTaskMs: 90, loafCount: 0 },
        ],
        visibility: [
          { type: "hidden", t: 240 },
          { type: "visible", t: 8050 },
          { type: "first-frame", t: 8440, waitMs: 390 },
        ],
        jank: [],
        slowFrames: [{ t: 165, durMs: 65 }],
      });
    },
    ["longtask", "long-animation-frame"],
  );
});

it("缓冲淘汰仍能查到省略数和最重卡顿发生时的演出", () => {
  withFrameHost(
    ({ diag, frame, tick, visibility, observe }) => {
      frame(116);
      const fx = useFxStore.getState();
      fx.addMarching("帧诊测试");
      try {
        frame(316);
      } finally {
        fx.removeMarching("帧诊测试");
      }
      for (let at = 317; at <= 2316; at++) frame(at);
      expect(diag.collect().windows[0]).toMatchObject({ frames: 2000, omittedFrames: 1, max: 200 });

      let at = 2316;
      for (let i = 1; i <= 500; i++) {
        at += 60;
        frame(at);
        if (i <= 51) {
          observe("long-animation-frame", { startTime: at - 60, duration: i === 1 ? 50 : 60 });
        }
        if (i % 80 === 0) tick(at);
      }
      for (let i = 0; i < 61; i++) {
        visibility(at + 10, "hidden");
        visibility(at + 20, "visible");
        at += 20;
      }
      const dump = diag.stop();
      expect(dump).toMatchObject({
        worstJank: { t: 316, deltaMs: 200, ctx: { marching: fx.marching.size + 1 } },
        omitted: { windows: 7, jank: 1, slowFrames: 1, visibility: 2 },
      });
      expect(dump.windows).toHaveLength(60);
      expect(dump.jank).toHaveLength(500);
      expect(dump.jank[0]).toMatchObject({ t: 2376, deltaMs: 60 });
      expect(dump.slowFrames).toHaveLength(50);
      expect(dump.slowFrames.every((entry) => entry.durMs === 60)).toBe(true);
      expect(dump.visibility).toHaveLength(120);
    },
    ["long-animation-frame"],
  );
});
