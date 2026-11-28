import { CMD_BRIEF } from "@dafung/core/engine/game-events";
import type { GameDiagnosticCapture } from "./game-diagnostic-record";
import type {
  GameDiagnosticTimelineDump,
  GameDiagnosticTimelineEvent,
  GameDiagnosticTimelineState,
} from "./game-diagnostic-timeline";

type Time = (at: number) => number;
type SceneField = [key: string, value: string];
type TimelineEvent = GameDiagnosticTimelineEvent;

const CONNECTION = {
  idle: "未建连",
  connecting: "建连中",
  calibrating: "校准中",
  open: "已连接",
  closed: "已断开",
  gaveUp: "重连停止",
  failed: "连接失败",
};
const CONTROL = { hidden: "隐藏", locked: "锁定", available: "可用" };
const AUDIO_END = {
  natural: "播完",
  beatFade: "按节拍渐出",
  replaced: "被替换",
  cancelled: "中止",
  muted: "静音",
  background: "切后台",
  failed: "播放失败",
};
const COMMAND_RESULT = {
  accepted: "已受理",
  warning: "警告",
  unprocessed: "未处理",
  rejected: "被拒绝",
};
const COMMAND = { ...CMD_BRIEF, pickCapital: "选都", setAutoPilot: "托管" };
const JANK_NEAR_MS = 1500;

function sceneValue(value: string, limit: number): string {
  return value.length > limit ? "过长已省略" : value;
}

function seat(index: number): string {
  return index < 0 ? "无" : String(index);
}

function turnFields(turn: GameDiagnosticTimelineState["turn"]): SceneField[] {
  return [
    ["轮/回合", `${turn.round}/${turn.turnNumber}`],
    ["相位", `${turn.phase}/${turn.phase === "Setup" ? turn.setupPhase : turn.turnPhase}`],
    ["行动座", seat(turn.activeIndex)],
    ["决策座", seat(turn.decisionOwner)],
  ];
}

function decisionFields(
  decision: Pick<
    GameDiagnosticCapture["client"],
    "pendingLand" | "choices" | "capitalChoices" | "reaction"
  >,
): string[] {
  const { pendingLand, choices, capitalChoices, reaction } = decision;
  const fields: string[] = [];
  if (pendingLand !== null) fields.push(`落格 ${pendingLand.kind}/${pendingLand.propertyId}`);
  if (capitalChoices !== null) fields.push(`选都 ${capitalChoices.join("/")}`);
  if (choices.length > 0) {
    const shown = choices.slice(0, 4).map(({ id, available }) => (available ? id : `${id}（锁）`));
    if (choices.length > shown.length) shown.push(`余${choices.length - shown.length}项省略`);
    const labels = shown.join("/");
    fields.push(labels.length > 260 ? `选项 ${choices.length} 项，明细过长已省略` : labels);
  }
  if (reaction !== null) {
    const { kind, asked, answered, muted, canDecline, playable } = reaction;
    const state = !asked ? "旁观" : answered ? "已应答" : "待应答";
    fields.push(
      `反应窗 ${kind}/${state}${muted ? "/静默" : ""}${canDecline ? "/可放弃" : ""}${playable.length ? `/${playable.join("/")}` : ""}`,
    );
  }
  return fields;
}

function interactionFields(interaction: GameDiagnosticTimelineState["interaction"]): SceneField[] {
  return [
    ["本座", seat(interaction.seat)],
    ["操作", interaction.interactive ? "可" : "锁"],
    ["本座演出", interaction.selfPresenting ? "有" : "无"],
    ["待回执", interaction.pending ? "是" : "否"],
    ["演出忙", interaction.fxBusy ? "是" : "否"],
    ["托管", interaction.autopilotOn ? "开" : "关"],
  ];
}

function describeConnection(connection: GameDiagnosticTimelineState["connection"]): string {
  if (connection === null) return "单机";
  const { roomId, status, failure } = connection;
  return `${CONNECTION[status]} ${sceneValue(roomId, 100)}${failure === null ? "" : ` ${sceneValue(failure, 280)}`}`;
}

function sceneFields(state: GameDiagnosticTimelineState, time: Time): SceneField[] {
  const { turn, decision, interaction, connection, controls } = state;
  const pending = decisionFields(decision);
  const { pendingDebt, treasureVisitor, pendingJinnang, pendingSkill, skillChoice } = decision;
  if (pendingDebt !== null) pending.push(`清偿 ${pendingDebt.amount}`);
  if (treasureVisitor !== null)
    pending.push(`交涉 ${treasureVisitor.propertyId}/座${treasureVisitor.ownerIdx}`);
  if (pendingJinnang !== null) {
    pending.push(
      `锦囊 ${pendingJinnang.cardId}/${pendingJinnang.stage}/${pendingJinnang.picked.join("/")}`,
    );
  }
  if (pendingSkill !== null) pending.push(`出技 ${pendingSkill.heroId}/${pendingSkill.skillId}`);
  if (skillChoice !== null) pending.push(`待决技能 ${skillChoice.heroId}/${skillChoice.skillId}`);
  if (decision.reactionSeq !== null) pending.push(`反应序位 #${decision.reactionSeq}`);
  if (decision.reactionDeadlineAt !== null)
    pending.push(`反应锁定时刻 ${time(decision.reactionDeadlineAt)}`);

  return [
    ...turnFields(turn),
    ["待操作", pending.length > 0 ? pending.join("、") : "无挂起选项"],
    ["连接", describeConnection(connection)],
    ...interactionFields(interaction),
    ["选都入口", CONTROL[controls.capital]],
    ["锦囊入口", CONTROL[controls.jinnang]],
    ["反应入口", CONTROL[controls.reaction]],
    ["技能入口", CONTROL[controls.skillChoice]],
    ["抉择卷轴", CONTROL[controls.decisionScroll]],
    ["目标", controls.target === null ? "无" : controls.target === "seat" ? "席位" : "城池"],
    ["查阅中", controls.peeking ? "是" : "否"],
    ["演出准备", controls.preparing ? "是" : "否"],
  ];
}

function describeScene(fields: SceneField[]): string {
  return fields.map(([key, value]) => `${key} ${sceneValue(value, 400)}`).join(" · ");
}

export function formatCapturedScene({ client, connection }: GameDiagnosticCapture): string {
  const pending = decisionFields(client);
  return `末次现场 ${describeScene([
    ...turnFields(client),
    ["待操作", pending.length > 0 ? pending.join("、") : "无挂起选项"],
    ["连接", describeConnection(connection)],
    ...interactionFields(client),
  ])}`;
}

function authorityRange({
  offset,
  count,
}: Extract<TimelineEvent, { kind: "authorityLog" }>): string {
  return count === 0 ? `从 #${offset} 起 0 条` : `#${offset}–${offset + count - 1}`;
}

function formatEvent(event: Exclude<TimelineEvent, { kind: "state" }>): string {
  switch (event.kind) {
    case "command": {
      const command = `命令 #${event.id} ${COMMAND[event.command]}`;
      if (event.stage === "sent") return `${command} 已发送`;
      if (event.stage === "blocked") return `${command} 本机拦截 ${event.reason}`;
      const authority = "logOffset" in event ? ` 日志 #${event.logOffset}` : "";
      const reason = "reason" in event ? ` ${event.reason}` : "";
      return `${command} ${COMMAND_RESULT[event.outcome]}${authority}${reason}`;
    }
    case "authorityLog":
      return `收到${event.source === "snapshot" ? "权威快照" : "权威日志尾段"} ${authorityRange(event)}`;
    case "audio":
      return `音效 #${event.instanceId} ${event.sound} ${event.stage === "start" ? "开始" : `结束（${AUDIO_END[event.reason]}）`}`;
    case "error":
      return `错误 ${event.message}`;
  }
}

function operationIn(events: readonly TimelineEvent[]) {
  const sent = new Map<number, number>();
  let latest: { start: number; receipt: number; logOffset: number | null } | null = null;
  for (const [index, event] of events.entries()) {
    if (event.kind !== "command") continue;
    if (event.stage === "sent") sent.set(event.id, index);
    if (event.stage === "result") {
      const start = sent.get(event.id);
      if (start !== undefined && (latest === null || start > latest.start)) {
        latest = {
          start,
          receipt: index,
          logOffset: "logOffset" in event ? event.logOffset : null,
        };
      }
    }
  }
  if (latest === null) return null;

  const { start, receipt, logOffset } = latest;
  const authority =
    logOffset === null
      ? -1
      : events.findIndex(
          (event, index) =>
            index > start &&
            event.kind === "authorityLog" &&
            event.offset <= logOffset &&
            logOffset < event.offset + event.count,
        );
  const anchors = authority === -1 ? [start, receipt] : [start, receipt, authority];
  // 回执和收包可以严格配对。相位、入口和演出只取到下一次本机操作之间的现场。
  const nextAttempt = events.findIndex(
    (event, index) => index > start && event.kind === "command" && event.stage !== "result",
  );
  const boundary = nextAttempt === -1 ? events.length : nextAttempt;
  const receiptAt = events[receipt].at;
  const authorityAt = authority === -1 ? receiptAt : events[authority].at;
  const steps: { index: number; priority: number; distance: number }[] = [];
  for (let index = start + 1; index < boundary; index++) {
    const event = events[index];
    if (event.kind === "command" || event.kind === "authorityLog") continue;
    const decisionChanged =
      event.kind === "state" &&
      (event.changes.turn !== undefined ||
        event.changes.decision !== undefined ||
        event.changes.controls !== undefined);
    steps.push({
      index,
      priority: decisionChanged ? 0 : 1,
      distance: Math.min(Math.abs(event.at - receiptAt), Math.abs(event.at - authorityAt)),
    });
  }
  steps.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  return { anchors, steps: steps.map(({ index }) => index) };
}

export function prepareDiagnosticTimeline(
  dump: GameDiagnosticTimelineDump,
  time: Time,
  worstAt: number | null,
) {
  const { events, baseline, authorityAnchorBeforeStart } = dump;
  const before: SceneField[][] = [];
  let state = baseline.state;
  let fields = sceneFields(state, time);
  const eventLines = events.map((event) => {
    before.push(fields);
    const at = time(event.at);
    if (event.kind !== "state") return `${at} ${formatEvent(event)}`;
    state = { ...state, ...event.changes };
    const next = sceneFields(state, time);
    const changed = next.flatMap(([key, value], index) =>
      value === fields[index][1] ? [] : [`${key}=${value}`],
    );
    fields = next;
    return `${at} 变化 ${changed.length ? changed.join(" · ") : "其他现场字段见保存文件"}`;
  });

  const indices = events.map((_, index) => index);
  const operation = operationIn(events);
  const nearJank =
    worstAt === null
      ? []
      : indices
          .filter((index) => Math.abs(events[index].at - worstAt) <= JANK_NEAR_MS)
          .sort((a, b) => Math.abs(events[a].at - worstAt) - Math.abs(events[b].at - worstAt))
          .slice(0, 10);
  const recent = indices.slice(-12).reverse();
  const errors = indices
    .filter((index) => {
      const event = events[index];
      return (
        event.kind === "error" ||
        (event.kind === "audio" && event.stage === "end" && event.reason === "failed") ||
        (event.kind === "command" &&
          (event.stage === "blocked" || (event.stage === "result" && event.outcome !== "accepted")))
      );
    })
    .slice(-5)
    .reverse();

  function render(included: ReadonlySet<number>) {
    const selected = [...included].sort((a, b) => a - b);
    const lines: string[] = [];
    if (authorityAnchorBeforeStart !== null) {
      lines.push(
        `开采前权威锚 ${time(authorityAnchorBeforeStart.at)} 日志 ${authorityRange(authorityAnchorBeforeStart)}`,
      );
    }
    if (selected.length === 0) {
      lines.push(`现场 ${time(baseline.at)} ${describeScene(sceneFields(baseline.state, time))}`);
    }
    let prior = -2;
    let excerpts = 0;
    for (const index of selected) {
      if (index !== prior + 1) {
        excerpts++;
        lines.push(`现场 ${time(events[index].at)} ${describeScene(before[index])}`);
      }
      lines.push(eventLines[index]);
      prior = index;
    }
    const shown =
      selected.length === 0
        ? "节选 0 事件"
        : `节选 ${time(events[selected[0]].at)}–${time(events[selected[selected.length - 1]].at)}，${excerpts} 段 ${selected.length} 事件`;
    const coverage = `时间线 ${time(dump.startedAt)}–${time(dump.capturedAt)} ms · 可重建自 ${time(baseline.at)} · ${shown}，省略 ${events.length - selected.length} · 归档省略 ${dump.omitted}`;
    return { coverage, lines };
  }

  return { render, operation, nearJank, recent, errors };
}
