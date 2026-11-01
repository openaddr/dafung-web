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
// 回调(天然稀疏);上下文 5s 一拍读 store(零 DOM 查询);缓冲全有界;时间戳一律
// performance.now 相对值(墙钟只在导出拍取一次)。
// 单写者:GameScreen 挂载/卸载各调一次 start/stop;重复 start 是接线 bug,当场炸(零兜底)。
// 导出口在主页(ADR-0047 修订:用户测试常不打完就退出,入口不绑对局屏)——停采定格
// 收编 lastDump 跨屏存活,导出包=「最近一局」帧诊 + IndexedDB 全部历史对局日志。
import { useFxStore } from "./fx/fxStore";

export interface FrameWindow {
  /** 窗起点(performance.now 相对 ms,导出拍补墙钟锚)。 */
  t0: number;
  /** 完整帧数(帧距样本数)。 */
  frames: number;
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

export interface PerfCtx {
  marching: number;
  floaters: number;
  seals: number;
  cashFlies: number;
  jinnangLines: number;
  pulses: number;
}

/** 卡顿事件:帧距超阈的一帧,现场快照当场冻结。 */
export interface JankEvent {
  t: number;
  deltaMs: number;
  ctx: PerfCtx;
}

/** LoAF 慢帧个体(最差 50 条,导出后逐帧看拆分)。 */
export interface SlowFrame {
  t: number;
  durMs: number;
  scriptMs: number;
  styleLayoutMs: number;
}

export interface FrameDiagDump {
  startedAt: number;
  stoppedAt: number | null;
  /** LoAF 能力位(WebView 版本画像;false 时 loaf* 字段恒 0,判读别误读成「无慢帧」)。 */
  loafSupported: boolean;
  windows: FrameWindow[];
  jank: JankEvent[];
  slowFrames: SlowFrame[];
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
/** 卡顿判定阈:帧距 >50ms(60fps 一帧 16.7ms,3 倍即体感一顿)。 */
const JANK_MS = 50;

interface DiagSession {
  startedAt: number;
  rafId: number;
  timer: ReturnType<typeof setInterval> | null;
  deltas: number[];
  windows: FrameWindow[];
  jank: JankEvent[];
  slowFrames: SlowFrame[];
  loafSupported: boolean;
  obs: PerformanceObserver[];
  curLoaf: { count: number; scriptMs: number; styleLayoutMs: number };
  curLongTasks: { n: number; ms: number };
}

let session: DiagSession | null = null;
/** 最近一局的定格采样:停采(退出对局)时收编——导出入口在主页(ADR-0047 修订:
 *  用户测试常不打完就退出),帧诊必须跨出对局屏存活;开新局被下一局停采自然顶替
 *  (只留最近一局,有界)。 */
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

/** 开采:GameScreen 挂载调用。重复开采 = 接线 bug,当场炸(零兜底)。 */
export function startFrameDiag(): void {
  if (session != null) throw new Error("frameDiag:重复开采(挂载接线 bug)");
  const obs: PerformanceObserver[] = [];
  const s: DiagSession = {
    startedAt: performance.now(),
    rafId: 0,
    timer: null,
    deltas: [],
    windows: [],
    jank: [],
    slowFrames: [],
    loafSupported: false,
    obs,
    curLoaf: { count: 0, scriptMs: 0, styleLayoutMs: 0 },
    curLongTasks: { n: 0, ms: 0 },
  };
  session = s;

  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    s.deltas.push(delta);
    if (s.deltas.length > RAW_CAP) s.deltas.shift();
    if (delta > JANK_MS) {
      s.jank.push({ t: now, deltaMs: +delta.toFixed(1), ctx: snapCtx() });
      if (s.jank.length > JANK_CAP) s.jank.shift();
    }
    s.rafId = requestAnimationFrame(loop);
  };
  s.rafId = requestAnimationFrame(loop);

  // LoAF:慢帧自带拆分;WebView 不支持(旧版)如实记能力位,不装假观察器
  if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
    s.loafSupported = true;
    const o = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const split = splitLoaf(
          e as {
            duration: number;
            renderStart?: number;
            styleAndRenderStart?: number;
            scripts?: { duration: number }[];
          },
        );
        s.curLoaf.count++;
        s.curLoaf.scriptMs += split.scriptMs;
        s.curLoaf.styleLayoutMs += split.styleLayoutMs;
        s.slowFrames.push({
          t: e.startTime,
          durMs: split.durMs,
          scriptMs: split.scriptMs,
          styleLayoutMs: split.styleLayoutMs,
        });
      }
      while (s.slowFrames.length > SLOW_CAP) {
        // 淘汰最短的一条,保最差 50(慢帧池按 dur 升序挤尾部)
        let minI = 0;
        for (let i = 1; i < s.slowFrames.length; i++)
          if (s.slowFrames[i].durMs < s.slowFrames[minI].durMs) minI = i;
        s.slowFrames.splice(minI, 1);
      }
    });
    o.observe({ type: "long-animation-frame", buffered: false });
    obs.push(o);
  }
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    const o = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        s.curLongTasks.n++;
        s.curLongTasks.ms += e.duration;
      }
    });
    o.observe({ type: "longtask", buffered: false });
    obs.push(o);
  }

  s.timer = setInterval(() => {
    const win: FrameWindow = {
      t0: performance.now() - WINDOW_MS,
      ...summarizeDeltas(s.deltas),
      longTasks: s.curLongTasks.n,
      longTaskMs: +s.curLongTasks.ms.toFixed(1),
      loafCount: s.curLoaf.count,
      loafScriptMs: +s.curLoaf.scriptMs.toFixed(1),
      loafStyleLayoutMs: +s.curLoaf.styleLayoutMs.toFixed(1),
      ctx: snapCtx(),
    };
    s.windows.push(win);
    if (s.windows.length > WINDOWS_CAP) s.windows.shift();
    s.curLoaf = { count: 0, scriptMs: 0, styleLayoutMs: 0 };
    s.curLongTasks = { n: 0, ms: 0 };
  }, WINDOW_MS);
}

/** 停采:GameScreen 卸载调用——采样定格收编进 lastDump(主页导出入口消费,ADR-0047 修订)。 */
export function stopFrameDiag(): void {
  const s = session;
  if (s == null) return;
  cancelAnimationFrame(s.rafId);
  if (s.timer != null) clearInterval(s.timer);
  for (const o of s.obs) o.disconnect();
  session = null;
  lastDump = {
    startedAt: s.startedAt,
    stoppedAt: performance.now(),
    loafSupported: s.loafSupported,
    windows: [...s.windows],
    jank: [...s.jank],
    slowFrames: [...s.slowFrames],
  };
}

/** 导出快照:局中=当前局实时缓冲;退出对局后=最近一局定格(lastDump,跨屏存活)。
 *  从未玩过(冷启动主页)= null,诊断包如实缺 perf 段。 */
export function collectFrameDiag(): FrameDiagDump | null {
  const s = session;
  if (s != null) {
    return {
      startedAt: s.startedAt,
      stoppedAt: null,
      loafSupported: s.loafSupported,
      windows: [...s.windows],
      jank: [...s.jank],
      slowFrames: [...s.slowFrames],
    };
  }
  return lastDump;
}
