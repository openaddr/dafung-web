// 帧诊(帧率诊断,ADR-0047):对局屏挂载即采的极轻性能采样器——真机取证通道,
// 桌面探针(4x CPU 节流)测不到真机体感,本件把「哪类演出卡、卡在哪一层」随诊断包带出来。
// 采样三路:
//   ① rAF 帧距——主线程产帧节奏;合成器/栅格欠债时 Blink 背压会让帧距整体右移
//      (第三波实测:主线程全闲而帧距掉),故帧距分布是「体感流畅度」的一级证据;
//   ② longtask + LoAF(long-animation-frame,Chromium 123+):每个 ≥50ms 慢帧自带
//      script 与 style/layout 耗时拆分——LoAF 有数据即可归因主线程侧(script=演出/
//      React,style/layout=回流);WebView 太老不支持时 capability 如实记 false,
//      「无 LoAF 数据」≠「无卡顿」;
//   ③ 演出上下文——每窗快照 fxStore 计数(行军会话/浮字/印章/铜钱飞行/指示线/金圈),
//      卡顿事件与窗口按上下文聚簇,直接回答「卡的是哪种演出」。
// 纪律(防「为测卡顿引入卡顿」):每帧成本 = 1 次数组 push;LoAF/longtask 只对慢帧
// 回调(天然稀疏);每个前台窗口和卡顿快照读 store(零 DOM 查询);缓冲全有界。
// 时间戳与客户端事件共用 performance.now 相对值，导出附 performance.timeOrigin。
// 对局诊断持有同一局的采样句柄。lastDump 供开发探针读取最近停采会话。
import { useFxStore } from "./fx/fxStore";

interface FrameWindow {
  /** 单位为 performance.now 相对毫秒。新版记录实际起止，历史归档只有估算起点。 */
  t0: number;
  t1?: number;
  /** 用于计算分位数的完整帧距样本数。 */
  frames: number;
  /** 超出容量而未参与分位计算的帧距数。 */
  omittedFrames?: number;
  /** 帧距分位(ms):p50/p95/max。 */
  p50: number;
  p95: number;
  max: number;
  /** longtask 次数与总耗时(ms)。 */
  longTasks: number;
  longTaskMs: number;
  /** LoAF 慢帧数与耗时拆分(ms,累计;loafSupported=false 时恒 0)。 */
  loafCount: number;
  loafScriptMs: number;
  loafStyleLayoutMs: number;
  /** 演出上下文快照(fxStore 计数)。 */
  ctx: PerfCtx;
}

interface PerfCtx {
  marching: number;
  floaters: number;
  seals: number;
  cashFlies: number;
  jinnangLines: number;
  pulses: number;
}

/** 卡顿事件:帧距超阈的一帧,现场快照当场冻结。 */
interface JankEvent {
  t: number;
  deltaMs: number;
  ctx: PerfCtx;
}

/** LoAF 慢帧个体(最差 50 条,导出后逐帧看拆分)。 */
interface SlowFrame {
  t: number;
  durMs: number;
  scriptMs: number;
  styleLayoutMs: number;
}

type FrameVisibilityEvent =
  | { type: DocumentVisibilityState; t: number }
  | { type: "first-frame"; t: number; waitMs: number };

interface FrameDiagOmissions {
  windows: number;
  jank: number;
  slowFrames: number;
  visibility: number;
}

export interface FrameDiagDump {
  startedAt: number;
  stoppedAt: number | null;
  /** LoAF 能力位(WebView 版本画像;false 时 loaf* 字段恒 0,判读别误读成「无慢帧」)。 */
  loafSupported: boolean;
  windows: FrameWindow[];
  jank: JankEvent[];
  slowFrames: SlowFrame[];
  /** 下列字段仅新版采集提供。历史归档缺失表示未记录。 */
  timeOrigin?: number;
  longTaskSupported?: boolean;
  initialVisibility?: DocumentVisibilityState;
  visibility?: FrameVisibilityEvent[];
  worstJank?: JankEvent | null;
  /** 各明细数组未留存的条数。另存的 worstJank 也可能从 jank 数组淘汰。 */
  omitted?: FrameDiagOmissions;
}

/** 帧距直方窗摘要(纯函数,单测锚点):分位 = 升序截取。 */
export function summarizeDeltas(deltas: number[]): {
  frames: number;
  p50: number;
  p95: number;
  max: number;
} {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    frames: sorted.length,
    p50: +pick(0.5).toFixed(1),
    p95: +pick(0.95).toFixed(1),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
  };
}

/** LoAF 单条拆分(纯函数):script = 各 script 段之和;style/layout = 样式渲染起点差。 */
export function splitLoaf(entry: {
  duration: number;
  renderStart?: number;
  styleAndRenderStart?: number;
  scripts?: { duration: number }[];
}): { durMs: number; scriptMs: number; styleLayoutMs: number } {
  const scriptMs = (entry.scripts ?? []).reduce((a, s) => a + s.duration, 0);
  const styleLayoutMs =
    entry.renderStart != null && entry.styleAndRenderStart != null
      ? Math.max(0, entry.renderStart - entry.styleAndRenderStart)
      : 0;
  return {
    durMs: entry.duration,
    scriptMs: +scriptMs.toFixed(1),
    styleLayoutMs: +styleLayoutMs.toFixed(1),
  };
}

const WINDOW_MS = 5000;
const RAW_CAP = 2000;
const WINDOWS_CAP = 60;
const JANK_CAP = 500;
const SLOW_CAP = 50;
const VISIBILITY_CAP = 120;
/** 卡顿判定阈:帧距 >50ms(60fps 一帧 16.7ms,3 倍即体感一顿)。 */
const JANK_MS = 50;

interface DiagSession {
  startedAt: number;
  timeOrigin: number;
  foregroundSince: number | null;
  initialVisibility: DocumentVisibilityState;
  visibility: FrameVisibilityEvent[];
  windowStart: number;
  rafId: number | null;
  timer: ReturnType<typeof setInterval> | null;
  deltas: number[];
  omittedFrames: number;
  omittedMax: number;
  windows: FrameWindow[];
  jank: JankEvent[];
  worstJank: JankEvent | null;
  slowFrames: SlowFrame[];
  omitted: FrameDiagOmissions;
  loafSupported: boolean;
  longTaskSupported: boolean;
  obs: { observer: PerformanceObserver; record(entries: PerformanceEntryList): void }[];
  curLoaf: { count: number; scriptMs: number; styleLayoutMs: number };
  curLongTasks: { n: number; ms: number };
}

let session: DiagSession | null = null;
let lastDump: FrameDiagDump | null = null;

function snapCtx(): PerfCtx {
  const s = useFxStore.getState();
  return {
    marching: s.marching.size,
    floaters: s.floaters.length,
    seals: s.seals.length,
    cashFlies: s.cashFlies.length,
    jinnangLines: s.jinnangLines.length,
    pulses: s.pulses.length,
  };
}

function summarizeWindow(s: DiagSession, t1: number): FrameWindow {
  const stats = summarizeDeltas(s.deltas);
  return {
    t0: s.windowStart,
    t1,
    ...stats,
    omittedFrames: s.omittedFrames,
    max: Math.max(stats.max, +s.omittedMax.toFixed(1)),
    longTasks: s.curLongTasks.n,
    longTaskMs: +s.curLongTasks.ms.toFixed(1),
    loafCount: s.curLoaf.count,
    loafScriptMs: +s.curLoaf.scriptMs.toFixed(1),
    loafStyleLayoutMs: +s.curLoaf.styleLayoutMs.toFixed(1),
    ctx: snapCtx(),
  };
}

function appendRecent<T>(entries: T[], entry: T, cap: number): number {
  entries.push(entry);
  if (entries.length <= cap) return 0;
  entries.shift();
  return 1;
}

function sealWindow(s: DiagSession, t1: number): void {
  flushObservers(s);
  s.omitted.windows += appendRecent(s.windows, summarizeWindow(s, t1), WINDOWS_CAP);
  s.windowStart = t1;
  s.deltas.length = 0;
  s.omittedFrames = 0;
  s.omittedMax = 0;
  s.curLoaf = { count: 0, scriptMs: 0, styleLayoutMs: 0 };
  s.curLongTasks = { n: 0, ms: 0 };
}

function observeForeground(
  s: DiagSession,
  type: string,
  recordEntry: (entry: PerformanceEntry) => void,
): void {
  const record = (entries: PerformanceEntryList): void => {
    const { foregroundSince, windowStart } = s;
    if (foregroundSince === null) return;
    for (const entry of entries) {
      // WebView 可以在恢复以后才送达后台观测。按记录的实际时间判断前台归属。
      if (entry.startTime >= foregroundSince && entry.startTime + entry.duration >= windowStart) {
        recordEntry(entry);
      }
    }
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type, buffered: false });
  s.obs.push({ observer, record });
}

function flushObservers(s: DiagSession): void {
  for (const { observer, record } of s.obs) record(observer.takeRecords());
}

function recordVisibility(s: DiagSession, event: FrameVisibilityEvent): void {
  s.omitted.visibility += appendRecent(s.visibility, event, VISIBILITY_CAP);
}

/** GameScreen 挂载时开启会话，采集和停采均归本次句柄。 */
export function startFrameDiag(): { collect(): FrameDiagDump; stop(): FrameDiagDump } {
  if (session != null) throw new Error("frameDiag:重复开采(挂载接线 bug)");
  const startedAt = performance.now();
  const entryTypes = globalThis.PerformanceObserver?.supportedEntryTypes;
  const s: DiagSession = {
    startedAt,
    timeOrigin: performance.timeOrigin,
    foregroundSince: null,
    initialVisibility: document.visibilityState,
    visibility: [],
    windowStart: startedAt,
    rafId: null,
    timer: null,
    deltas: [],
    omittedFrames: 0,
    omittedMax: 0,
    windows: [],
    jank: [],
    worstJank: null,
    slowFrames: [],
    omitted: { windows: 0, jank: 0, slowFrames: 0, visibility: 0 },
    loafSupported: entryTypes?.includes("long-animation-frame") === true,
    longTaskSupported: entryTypes?.includes("longtask") === true,
    obs: [],
    curLoaf: { count: 0, scriptMs: 0, styleLayoutMs: 0 },
    curLongTasks: { n: 0, ms: 0 },
  };
  session = s;

  let last: number | null = null;
  let resumedAt: number | null = null;
  let worstDelta = JANK_MS;
  const loop = () => {
    const now = performance.now();
    if (last !== null) {
      const delta = now - last;
      if (s.deltas.length < RAW_CAP) {
        s.deltas.push(delta);
      } else {
        const index = s.omittedFrames % RAW_CAP;
        s.omittedMax = Math.max(s.omittedMax, s.deltas[index]);
        s.deltas[index] = delta;
        s.omittedFrames++;
      }
      if (delta > JANK_MS) {
        const event = { t: now, deltaMs: +delta.toFixed(1), ctx: snapCtx() };
        s.omitted.jank += appendRecent(s.jank, event, JANK_CAP);
        if (delta > worstDelta) {
          worstDelta = delta;
          s.worstJank = event;
        }
      }
    } else if (resumedAt !== null) {
      recordVisibility(s, { type: "first-frame", t: now, waitMs: now - resumedAt });
      resumedAt = null;
    }
    last = now;
    s.rafId = requestAnimationFrame(loop);
  };
  const beginForeground = (now: number) => {
    s.foregroundSince = now;
    s.windowStart = now;
    s.rafId = requestAnimationFrame(loop);
    s.timer = setInterval(() => sealWindow(s, performance.now()), WINDOW_MS);
  };
  const pauseSampling = () => {
    if (s.rafId !== null) cancelAnimationFrame(s.rafId);
    if (s.timer !== null) clearInterval(s.timer);
    s.rafId = null;
    s.timer = null;
  };
  const onVisibility = () => {
    const state = document.visibilityState;
    const visible = state === "visible";
    if (visible === (s.foregroundSince !== null)) return;
    const now = performance.now();
    recordVisibility(s, { type: state, t: now });
    if (visible) {
      resumedAt = now;
      beginForeground(now);
    } else {
      sealWindow(s, now);
      pauseSampling();
      s.foregroundSince = null;
      last = null;
      resumedAt = null;
    }
  };

  if (s.loafSupported) {
    observeForeground(s, "long-animation-frame", (entry) => {
      const split = splitLoaf(entry);
      s.curLoaf.count++;
      s.curLoaf.scriptMs += split.scriptMs;
      s.curLoaf.styleLayoutMs += split.styleLayoutMs;
      s.slowFrames.push({ t: entry.startTime, ...split });
      if (s.slowFrames.length > SLOW_CAP) {
        // 淘汰最短的一条，保留最慢的 50 条。
        let minI = 0;
        for (let i = 1; i < s.slowFrames.length; i++)
          if (s.slowFrames[i].durMs < s.slowFrames[minI].durMs) minI = i;
        s.slowFrames.splice(minI, 1);
        s.omitted.slowFrames++;
      }
    });
  }
  if (s.longTaskSupported) {
    observeForeground(s, "longtask", (entry) => {
      s.curLongTasks.n++;
      s.curLongTasks.ms += entry.duration;
    });
  }

  if (s.initialVisibility === "visible") beginForeground(startedAt);
  document.addEventListener("visibilitychange", onVisibility);

  let stopped: FrameDiagDump | null = null;
  return {
    collect: () => stopped ?? dumpSession(s, performance.now(), null),
    stop: () => {
      if (stopped !== null) return stopped;
      const now = performance.now();
      document.removeEventListener("visibilitychange", onVisibility);
      pauseSampling();
      stopped = dumpSession(s, now, now);
      for (const { observer } of s.obs) observer.disconnect();
      session = null;
      lastDump = stopped;
      return stopped;
    },
  };
}

function dumpSession(s: DiagSession, now: number, stoppedAt: number | null): FrameDiagDump {
  flushObservers(s);
  const windows = [...s.windows];
  const omitted = { ...s.omitted };
  if (s.deltas.length > 0 || s.curLoaf.count > 0 || s.curLongTasks.n > 0) {
    omitted.windows += appendRecent(windows, summarizeWindow(s, now), WINDOWS_CAP);
  }
  return {
    startedAt: s.startedAt,
    stoppedAt,
    loafSupported: s.loafSupported,
    longTaskSupported: s.longTaskSupported,
    timeOrigin: s.timeOrigin,
    initialVisibility: s.initialVisibility,
    visibility: [...s.visibility],
    omitted,
    windows,
    jank: [...s.jank],
    worstJank: s.worstJank,
    slowFrames: [...s.slowFrames],
  };
}

/** 开发探针读取活动缓冲或最近停采会话。 */
export function collectFrameDiag(): FrameDiagDump | null {
  return session === null ? lastDump : dumpSession(session, performance.now(), null);
}
