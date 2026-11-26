import { gameArchiveFailureText, type ArchivedGame } from "./game-diagnostic-record";
import {
  heaviestDiagnosticJank,
  prepareDiagnosticFrames,
  roundDiagnosticMs,
  type FrameRow,
} from "./game-diagnostic-summary-frames";
import { formatCapturedScene, prepareDiagnosticTimeline } from "./game-diagnostic-summary-timeline";

const MAX_SUMMARY_CHARS = 8_000;
const MAX_LOG_LINES = 50;
const PRIORITY_OPERATION_STEPS = 2;
const OPERATION_EXCERPT_STEPS = 12;

function headerValue(value: string | null): string {
  if (value === null) return "未记录";
  if (value.length > 512) return "过长已省略，见保存文件";
  return value;
}

function excerptLogs(log: ArchivedGame["log"], fits: () => boolean) {
  const excerpt: { offset: number; line: string }[] = [];
  const lines = () => excerpt.map(({ line }) => line);
  if (log === null) return { coverage: () => "对局日志未记录", lines, fill: () => {} };
  const total = log.lines.length;
  const coverage = () => {
    if (total === 0) return "对局日志 0 条";
    const range =
      excerpt.length === 0
        ? "节选 0 条"
        : `#${excerpt[0].offset}–${excerpt[excerpt.length - 1].offset}（从 0 起、轮/回合）`;
    return `对局日志 ${range} · 省略 ${total - excerpt.length} 条`;
  };
  const fill = () => {
    for (let index = total - 1; index >= Math.max(0, total - MAX_LOG_LINES); index--) {
      const { round, turn, brief } = log.lines[index];
      excerpt.unshift({ offset: index, line: `#${index} ${round}/${turn} ${brief}` });
      if (!fits()) excerpt.shift();
    }
  };
  return { coverage, lines, fill };
}

function describeClock(label: string, zero: number, origin: number | undefined): string {
  return `${label}时基 单调毫秒 · 0 对应 performance.now ${roundDiagnosticMs(zero)} · timeOrigin ${origin === undefined ? "未记录" : origin}`;
}

function joinLines(lines: string[]): string {
  return lines.map((line) => line.replace(/[\r\n\u2028\u2029]+/gu, " ")).join("\n");
}

export function formatGameDiagnosticSummary(game: ArchivedGame): string {
  const { appVersion, capture, gameId, log, mapId, mode } = game;
  const heading = [
    `对局诊断摘要 · 版本 ${headerValue(appVersion)} · 局 ID ${headerValue(gameId)} · ${mode === "solo" ? "单机" : "联机"} · 地图 ${headerValue(mapId)}`,
  ];
  const dump = capture?.timeline;
  const perf = capture?.perf ?? null;
  const matchingClock = dump !== undefined && perf !== null && perf.timeOrigin === dump.timeOrigin;
  const frameZero =
    perf === null ? 0 : matchingClock ? Math.min(dump.startedAt, perf.startedAt) : perf.startedAt;
  const timelineZero = dump === undefined ? 0 : matchingClock ? frameZero : dump.startedAt;
  const worst = perf === null ? null : heaviestDiagnosticJank(perf);
  const timeline =
    dump === undefined
      ? null
      : prepareDiagnosticTimeline(
          dump,
          (at) => roundDiagnosticMs(at - timelineZero),
          matchingClock && worst !== null ? worst.t : null,
        );
  const frames =
    perf === null
      ? null
      : prepareDiagnosticFrames(
          perf,
          (at) => roundDiagnosticMs(at - frameZero),
          worst,
          timeline !== null,
        );

  if (capture === null) {
    heading.push("设备未记录 · 客户端现场未采样");
  } else {
    const { dpr, ua, viewport } = capture.device;
    heading.push(`设备 ${viewport.w}×${viewport.h} DPR ${dpr} ${headerValue(ua)}`);
  }
  if (matchingClock) {
    heading.push(describeClock("时间线与帧诊共用", frameZero, dump.timeOrigin));
  } else {
    if (dump !== undefined) heading.push(describeClock("时间线", timelineZero, dump.timeOrigin));
    if (perf !== null) heading.push(describeClock("帧诊", frameZero, perf.timeOrigin));
    if (dump !== undefined && perf !== null) heading.push("时间线与帧诊使用独立时基，无法对齐");
  }

  const eventRows = new Set<number>();
  const frameRows = new Set<FrameRow>();
  const errorRows = new Set<string>();
  const timelineErrors = new Set(
    dump?.events.flatMap((event) => (event.kind === "error" ? [event.message] : [])),
  );
  const errors = [
    ...game.archiveFailures.map(gameArchiveFailureText),
    ...(capture?.errors ?? [])
      .filter(({ message }) => !timelineErrors.has(message))
      .reverse()
      .map(({ at, message }) => `错误 ${new Date(at).toISOString()} ${message}`),
  ];
  const capturedScene = capture === null || timeline !== null ? [] : [formatCapturedScene(capture)];
  const logs = excerptLogs(log, () => fits());

  function render(): string {
    const events = timeline?.render(eventRows);
    const sampledFrames = frames?.render(frameRows);
    return joinLines([
      ...heading,
      events === undefined ? "客户端时间线未采样" : events.coverage,
      sampledFrames === undefined ? "帧诊未采样" : sampledFrames.coverage,
      logs.coverage(),
      ...(errors.length === 0
        ? []
        : [
            `其它近期错误 · 节选 ${errorRows.size}，省略 ${errors.length - errorRows.size}`,
            ...errorRows,
          ]),
      ...(events === undefined ? capturedScene : events.lines),
      ...(sampledFrames === undefined ? [] : sampledFrames.lines),
      ...logs.lines(),
    ]);
  }
  function fits(): boolean {
    return render().length <= MAX_SUMMARY_CHARS;
  }
  function include<T>(selected: Set<T>, entries: Iterable<T>): boolean {
    const added = [...entries].filter((entry) => !selected.has(entry));
    if (added.length === 0) return true;
    for (const entry of added) selected.add(entry);
    if (fits()) return true;
    for (const entry of added) selected.delete(entry);
    return false;
  }
  function includeRows<T>(selected: Set<T>, entries: Iterable<T>): void {
    for (const entry of entries) include(selected, [entry]);
  }

  const operation = timeline?.operation;
  if (operation != null) {
    const { anchors } = operation;
    if (!include(eventRows, anchors)) include(eventRows, anchors.slice(0, 2));
  }
  if (frames?.worst != null) include(frameRows, [frames.worst]);
  if (timeline !== null) includeRows(eventRows, timeline.errors);
  includeRows(errorRows, errors.slice(0, 5));
  if (operation != null) includeRows(eventRows, operation.steps.slice(0, PRIORITY_OPERATION_STEPS));
  if (frames !== null) includeRows(frameRows, frames.nearJank);
  if (timeline !== null) {
    if (!include(eventRows, timeline.nearJank)) includeRows(eventRows, timeline.nearJank);
    if (operation != null) {
      includeRows(
        eventRows,
        operation.steps.slice(PRIORITY_OPERATION_STEPS, OPERATION_EXCERPT_STEPS),
      );
    }
    includeRows(eventRows, timeline.recent);
  }
  if (frames !== null) includeRows(frameRows, frames.recent);
  logs.fill();
  return render();
}
