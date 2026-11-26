import type { FrameDiagDump } from "./frameDiag";

type Time = (at: number) => number;
type Jank = FrameDiagDump["jank"][number];
type PerfCtx = Jank["ctx"];

export interface FrameRow {
  at: number;
  end?: number;
  line: string;
}

export function roundDiagnosticMs(value: number): number {
  return +value.toFixed(1);
}

export function heaviestDiagnosticJank(perf: FrameDiagDump): Jank | null {
  if (perf.worstJank !== undefined) return perf.worstJank;
  // 旧归档只保留卡顿明细，没有全局最大值。
  return perf.jank.reduce<Jank | null>(
    (worst, event) => (worst === null || event.deltaMs > worst.deltaMs ? event : worst),
    null,
  );
}

function context({ marching, floaters, seals, cashFlies, jinnangLines, pulses }: PerfCtx): string {
  const values = [marching, floaters, seals, cashFlies, jinnangLines, pulses];
  return values.every((value) => value === 0) ? "0" : values.join("/");
}

function capability(supported: boolean | undefined): string {
  if (supported === undefined) return "能力未记录";
  return supported ? "支持" : "未支持";
}

function renderWindow(
  window: FrameDiagDump["windows"][number],
  time: Time,
  perf: FrameDiagDump,
): FrameRow {
  const { t0, t1, frames, omittedFrames, p50, p95, max, longTasks, longTaskMs } = window;
  const long =
    perf.longTaskSupported === false
      ? "-"
      : perf.longTaskSupported === undefined && longTasks === 0
        ? "?"
        : `${longTasks}/${roundDiagnosticMs(longTaskMs)}`;
  const loaf = perf.loafSupported
    ? `${window.loafCount}/${roundDiagnosticMs(window.loafScriptMs)}/${roundDiagnosticMs(window.loafStyleLayoutMs)}`
    : "-";
  const start = `${t1 === undefined ? "~" : ""}${time(t0)}`;
  const end = t1 === undefined ? "?" : time(t1);
  const samples = `${frames}/${omittedFrames === undefined ? "?" : omittedFrames}`;
  const distribution = frames === 0 ? "? ? ?" : `${p50} ${p95} ${max}`;
  return {
    at: t0,
    end: t1,
    line: `${start} ${end} ${samples} ${distribution} ${long} ${loaf} ${context(window.ctx)}`,
  };
}

interface FrameTable {
  name: string;
  columns: string;
  rows: FrameRow[];
  empty: string;
  omitted: number | undefined;
}

function renderTable(table: FrameTable, selected: Set<FrameRow>): string[] {
  const shown = table.rows.filter((row) => selected.has(row)).sort((a, b) => a.at - b.at);
  const omitted = table.omitted === undefined ? "归档省略数未记录" : `归档省略 ${table.omitted}`;
  const selection =
    table.rows.length > 0
      ? `节选 ${shown.length}，省略 ${table.rows.length - shown.length}`
      : table.empty;
  return [
    `${table.name} · ${selection} · ${omitted}`,
    ...(shown.length === 0 ? [] : [table.columns, ...shown.map(({ line }) => line)]),
  ];
}

function distance(row: FrameRow, at: number): number {
  return Math.max(row.at - at, at - (row.end === undefined ? row.at : row.end), 0);
}

export function prepareDiagnosticFrames(
  perf: FrameDiagDump,
  time: Time,
  heaviest: Jank | null,
  hasTimeline: boolean,
) {
  const {
    startedAt,
    stoppedAt,
    loafSupported,
    longTaskSupported,
    initialVisibility,
    visibility,
    omitted,
  } = perf;
  const windows = perf.windows.map((window) => renderWindow(window, time, perf));
  const legacyWindows =
    perf.windows.some(({ t1 }) => t1 === undefined) ||
    (perf.windows.length === 0 && perf.timeOrigin === undefined);
  const jankEvents = [...perf.jank];
  let heaviestIndex = -1;
  if (heaviest !== null) {
    heaviestIndex = jankEvents.findIndex(
      ({ t, deltaMs }) => t === heaviest.t && deltaMs === heaviest.deltaMs,
    );
    if (heaviestIndex < 0) {
      heaviestIndex = jankEvents.length;
      jankEvents.push(heaviest);
    }
  }
  const jank = jankEvents.map((event, index) => ({
    at: event.t,
    line: `${time(event.t)} ${roundDiagnosticMs(event.deltaMs)} ${context(event.ctx)} ${index === heaviestIndex ? (perf.worstJank === undefined ? "留存最重" : "本局最重") : "·"}`,
  }));
  const slow = perf.slowFrames.map((entry) => ({
    at: entry.t,
    line: `${time(entry.t)} ${roundDiagnosticMs(entry.durMs)} ${roundDiagnosticMs(entry.scriptMs)} ${roundDiagnosticMs(entry.styleLayoutMs)}`,
  }));
  const visibilityRows =
    visibility === undefined
      ? []
      : visibility.map((entry) => ({
          at: entry.t,
          line:
            entry.type === "first-frame"
              ? `${time(entry.t)} 首帧 ${roundDiagnosticMs(entry.waitMs)}`
              : `${time(entry.t)} ${entry.type === "visible" ? "回前台" : "转后台"} ·`,
        }));
  const frameIntervals = perf.windows.some((window) => window.frames > 0) || jank.length > 0;
  const tables: FrameTable[] = [
    {
      name: "前台帧窗",
      columns: "起 止 帧距数/淘汰 p50 p95 最大 长任务数/耗时 LoAF数/脚本/样式布局 演出",
      rows: windows,
      empty: "未采样到窗口",
      omitted: omitted?.windows,
    },
    {
      name: "卡顿（原始帧距>50 ms）",
      columns: "时刻 帧距 演出 标记",
      rows: jank,
      empty: frameIntervals ? "观测 0 条" : "未采样到帧距",
      omitted: omitted?.jank,
    },
    {
      name: "LoAF 慢帧",
      columns: "时刻 耗时 脚本 样式布局",
      rows: slow,
      empty: !loafSupported ? "未支持" : windows.length === 0 ? "未采样到窗口" : "观测 0 条",
      omitted: omitted?.slowFrames,
    },
    {
      name: "前后台",
      columns: "时刻 切换/首帧 首帧等待",
      rows: visibilityRows,
      empty: visibility === undefined ? "未采样" : "观测 0 条",
      omitted: omitted?.visibility,
    },
  ];
  const rows = tables.flatMap((table) => table.rows);
  const worst = heaviestIndex < 0 ? null : jank[heaviestIndex];
  const nearJank =
    heaviest === null
      ? []
      : tables.flatMap(({ rows }) =>
          rows
            .filter((row) => row !== worst && distance(row, heaviest.t) <= 1500)
            .sort((a, b) => distance(a, heaviest.t) - distance(b, heaviest.t))
            .slice(0, 3),
        );
  const recent = [
    ...visibilityRows.slice(hasTimeline ? -6 : -10).reverse(),
    ...windows.slice(hasTimeline ? -14 : -27).reverse(),
    ...jank.slice(hasTimeline ? -10 : -30).reverse(),
    ...slow.slice(hasTimeline ? -6 : -8).reverse(),
  ];

  function render(selected: Set<FrameRow>) {
    const until = stoppedAt === null ? "未停采" : `止于 ${time(stoppedAt)}`;
    let selection = "节选 0 行";
    if (selected.size > 0) {
      const shown = [...selected];
      const from = Math.min(...shown.map(({ at }) => at));
      const to = Math.max(...shown.map(({ at, end }) => (end === undefined ? at : end)));
      selection = `节选 ${time(from)}–${time(to)}，${selected.size} 行`;
    }
    const coverage = `帧诊 ${time(startedAt)} 起，${until} · ${selection}，省略 ${rows.length - selected.size}`;
    const windowBasis = legacyWindows
      ? "帧窗口径 历史滚动（~为估算起点，最近最多 2000 帧距，止点未记，可能重叠）"
      : "帧窗口径 前台非重叠窗（实际起止，帧距按结束时刻入窗）";
    const visibilityStart =
      initialVisibility === undefined
        ? "未记录"
        : initialVisibility === "visible"
          ? "前台"
          : "后台";
    const recovered = heaviestIndex === perf.jank.length ? " · 最重卡顿另有留存" : "";
    return {
      coverage,
      lines: [
        windowBasis,
        `帧诊单位 ms · 长任务 ${capability(longTaskSupported)} · LoAF ${capability(loafSupported)} · 初始${visibilityStart}${recovered}`,
        "演出 行军/浮字/印章/飞钱/锦囊线/光圈，0=全零 · -=不支持 · ?=无样本或未记录",
        ...tables.flatMap((table) => renderTable(table, selected)),
      ],
    };
  }

  return { render, worst, nearJank, recent };
}
