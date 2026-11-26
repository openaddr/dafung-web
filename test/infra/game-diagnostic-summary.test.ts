import { expect, test } from "bun:test";
import type { ArchivedGame, GameDiagnosticCapture } from "@app/game-diagnostic-record";
import { formatGameDiagnosticSummary } from "@app/game-diagnostic-summary";
import type {
  GameDiagnosticTimelineEvent,
  GameDiagnosticTimelineState,
} from "@app/game-diagnostic-timeline";

const timeOrigin = 1_800_000_000_000;
const ctx = { marching: 0, floaters: 0, seals: 0, cashFlies: 0, jinnangLines: 0, pulses: 0 };
const scene: GameDiagnosticTimelineState = {
  turn: {
    phase: "Playing",
    setupPhase: "Done",
    turnPhase: "AwaitingJinnang",
    round: 2,
    turnNumber: 7,
    activeIndex: 1,
    decisionOwner: 1,
  },
  decision: {
    pendingLand: null,
    choices: [{ id: "连环计", available: true }],
    capitalChoices: null,
    reaction: null,
    pendingDebt: null,
    treasureVisitor: null,
    pendingJinnang: null,
    pendingSkill: null,
    skillChoice: null,
    reactionSeq: null,
    reactionDeadlineAt: null,
  },
  interaction: {
    seat: 1,
    interactive: true,
    selfPresenting: false,
    pending: false,
    fxBusy: false,
    autopilotOn: false,
  },
  controls: {
    capital: "hidden",
    jinnang: "available",
    reaction: "hidden",
    skillChoice: "hidden",
    decisionScroll: "hidden",
    target: null,
    peeking: false,
    preparing: false,
  },
  connection: { roomId: "DIAG", status: "open", failure: null },
};

function archivedGame(capture: GameDiagnosticCapture): ArchivedGame {
  return {
    appVersion: capture.appVersion,
    archiveFailures: [],
    capture,
    gameId: "selected-game",
    lastPlayedAt: capture.capturedAt,
    log: null,
    logCount: 0,
    mapId: "guanzhong",
    mode: "online",
  };
}

function captureOf(
  details: Pick<GameDiagnosticCapture, "perf" | "timeline">,
): GameDiagnosticCapture {
  return {
    appVersion: "2026.11.92",
    capturedAt: timeOrigin + 221_000,
    device: { ua: "Android WebView", dpr: 2, viewport: { w: 844, h: 390 } },
    client: {
      ...scene.turn,
      ...scene.interaction,
      pendingLand: null,
      choices: scene.decision.choices,
      capitalChoices: null,
      reaction: null,
      lastLandOutcomeKind: null,
      lastLandOutcomeProperty: null,
    },
    connection: scene.connection,
    errors: [],
    ...details,
  };
}

test("长局摘要保留完整操作、近期错误和最重卡顿两侧的证据，按重建现场节选", () => {
  const at = 10_000;
  const latestAt = 220_000;
  const worst = { t: at + 500, deltaMs: 1800.2, ctx: { ...ctx, marching: 1 } };
  const events: GameDiagnosticTimelineEvent[] = [
    {
      kind: "state",
      at: 3_000,
      changes: { turn: { ...scene.turn, round: 3, turnNumber: 12, activeIndex: 0 } },
    },
    { kind: "audio", stage: "start", instanceId: 20, sound: "marchStart", at },
    {
      kind: "state",
      at: at + 200,
      changes: { controls: { ...scene.controls, jinnang: "hidden" } },
    },
    {
      kind: "audio",
      stage: "end",
      instanceId: 20,
      sound: "marchStart",
      reason: "background",
      at: at + 500,
    },
    ...Array.from({ length: 280 }, (_, index) => ({
      kind: "authorityLog" as const,
      source: "tail" as const,
      at: 20_000 + 100 * index,
      offset: index + 3,
      count: 1,
    })),
    {
      kind: "command",
      stage: "sent",
      id: 77,
      command: "useJinnang",
      at: latestAt,
    },
    {
      kind: "state",
      at: latestAt + 30,
      changes: { connection: { roomId: "DIAG", status: "calibrating", failure: null } },
    },
    {
      kind: "command",
      stage: "result",
      id: 77,
      command: "useJinnang",
      outcome: "rejected",
      reason: "本座的决策窗已关闭",
      at: latestAt + 60,
    },
    {
      kind: "state",
      at: latestAt + 61,
      changes: {
        controls: { ...scene.controls, jinnang: "hidden", decisionScroll: "available" },
      },
    },
    { kind: "error", at: latestAt + 65, message: "提交后未出现操作入口" },
    ...Array.from({ length: 115 }, (_, index) => {
      const on = index % 2 === 0;
      return {
        kind: "state" as const,
        at: latestAt + 70 + index,
        changes: {
          turn: { ...scene.turn, turnNumber: index + 13, decisionOwner: on ? 0 : 1 },
          interaction: {
            ...scene.interaction,
            interactive: !on,
            selfPresenting: on,
            pending: on,
            autopilotOn: on,
          },
        },
      };
    }),
    { kind: "command", stage: "sent", id: 78, command: "rollAndMove", at: latestAt + 200 },
  ];
  const game = archivedGame(
    captureOf({
      timeline: {
        timeOrigin,
        startedAt: 1000,
        capturedAt: 221_000,
        baseline: { at: 2000, state: scene },
        authorityAnchorBeforeStart: {
          kind: "authorityLog",
          at: 980,
          source: "snapshot",
          offset: 0,
          count: 3,
        },
        events,
        omitted: 7,
      },
      perf: {
        startedAt: 1000,
        stoppedAt: 221_000,
        timeOrigin,
        loafSupported: false,
        longTaskSupported: true,
        initialVisibility: "visible",
        visibility: [
          { type: "hidden", t: at + 510 },
          { type: "visible", t: at + 800 },
          { type: "first-frame", t: at + 820, waitMs: 20 },
        ],
        omitted: { jank: 1, windows: 8, slowFrames: 0, visibility: 0 },
        worstJank: worst,
        jank: [{ t: latestAt + 50, deltaMs: 71, ctx }],
        slowFrames: [],
        windows: [
          {
            t0: 6000,
            t1: at + 510,
            frames: 88,
            omittedFrames: 0,
            p50: 17,
            p95: 17.8,
            max: worst.deltaMs,
            longTasks: 0,
            longTaskMs: 0,
            loafCount: 0,
            loafScriptMs: 0,
            loafStyleLayoutMs: 0,
            ctx,
          },
        ],
      },
    }),
  );
  const log = Array.from({ length: 75 }, (_, index) => ({
    ts: timeOrigin + index,
    round: 3,
    turn: 12,
    player: null,
    category: "system" as const,
    detail: "",
    brief: `玩法条目 ${index} ${"长安军情".repeat(60)} 整行结束`,
  }));
  game.log = { capturedAt: timeOrigin + 220_000, lines: log };
  game.logCount = log.length;

  const summary = formatGameDiagnosticSummary(game);
  const lines = summary.split("\n");
  expect(summary.length).toBeLessThanOrEqual(8000);
  expect(summary).toMatch(/开采前权威锚[^\n]*#0–2/u);
  expect(summary).toMatch(/归档省略 7/u);
  expect(summary).toMatch(/9000 音效 #20 marchStart 开始/u);
  expect(summary).toMatch(/9200 变化 锦囊入口=隐藏/u);
  expect(summary).toMatch(/9500 音效 #20 marchStart 结束（切后台）/u);
  const openingScenes = lines.filter((line) => line.startsWith("现场 "));
  expect(openingScenes[0]).toMatch(
    /3\/12[^\n]*行动座 0[^\n]*待操作[^\n]*连环计[^\n]*已连接[^\n]*锦囊入口 可用/u,
  );
  expect(openingScenes[1]).toMatch(/已连接[^\n]*锦囊入口 隐藏/u);
  const autopilotStates = lines.filter((line) => /变化 [^\n]*托管=/u.test(line));
  expect(autopilotStates.length).toBeLessThan(30);
  expect(summary).toMatch(/219000 命令 #77 用锦囊 已发送/u);
  expect(summary).toMatch(/219060 命令 #77 用锦囊 被拒绝[^\n]*本座的决策窗已关闭/u);
  expect(summary).toMatch(/219061 变化 抉择卷轴=可用/u);
  expect(summary).toContain("提交后未出现操作入口");
  expect(summary).toMatch(/9500 1800\.2 [^\n]*最重/u);
  expect(summary).toMatch(/9820 首帧 20/u);
  expect(summary).toMatch(/5000 9510 88\/0 17 17\.8 1800\.2 0\/0 -/u);
  expect(summary).toContain("LoAF 未支持");
  const logRows = lines.filter((line) => line.includes("玩法条目"));
  expect(logRows.length).toBeGreaterThan(0);
  expect(logRows.every((line) => line.endsWith("整行结束"))).toBe(true);
  expect(logRows.at(-1)).toContain("玩法条目 74");
  expect(summary).toMatch(/对局日志[^\n]*省略 [1-9][0-9]* 条/u);
});

function summarizeTimeline(events: GameDiagnosticTimelineEvent[]): string {
  return formatGameDiagnosticSummary(
    archivedGame(
      captureOf({
        perf: null,
        timeline: {
          timeOrigin,
          startedAt: 1000,
          capturedAt: 5000,
          baseline: { at: 1000, state: scene },
          authorityAnchorBeforeStart: null,
          events,
          omitted: 0,
        },
      }),
    ),
  );
}

test.each([[false], [true]])("最近的完整操作链保留回执后的权威收包与入口变化", (lateReceipt) => {
  const events: GameDiagnosticTimelineEvent[] = [
    { kind: "command", stage: "sent", id: 70, command: "upgradeProperty", at: 2000 },
    { kind: "command", stage: "sent", id: 71, command: "useJinnang", at: 2050 },
    {
      kind: "command",
      stage: "result",
      id: 71,
      command: "useJinnang",
      outcome: "accepted",
      logOffset: 106,
      at: 2100,
    },
    { kind: "authorityLog", source: "tail", at: 2120, offset: 105, count: 1 },
    { kind: "authorityLog", source: "tail", at: 2150, offset: 106, count: 3 },
    {
      kind: "state",
      at: 2190,
      changes: {
        turn: { ...scene.turn, turnPhase: "AwaitingDecision" },
        controls: { ...scene.controls, decisionScroll: "available" },
      },
    },
    { kind: "command", stage: "sent", id: 72, command: "endDecision", at: 2300 },
    ...(lateReceipt
      ? [
          {
            kind: "command",
            stage: "result",
            id: 70,
            command: "upgradeProperty",
            outcome: "accepted",
            logOffset: 102,
            at: 2330,
          } as const,
        ]
      : []),
    {
      kind: "state",
      at: 2350,
      changes: { controls: { ...scene.controls, decisionScroll: "available", target: "city" } },
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      kind: "authorityLog" as const,
      source: "tail" as const,
      at: 2400 + index * 100,
      offset: 109 + index,
      count: 1,
    })),
  ];
  const summary = summarizeTimeline(events);

  expect(summary).toContain("命令 #71 用锦囊 已发送");
  expect(summary).toContain("命令 #71 用锦囊 已受理 日志 #106");
  expect(summary).toContain("收到权威日志尾段 #106–108");
  expect(summary).toContain("1190 变化 相位=Playing/AwaitingDecision · 抉择卷轴=可用");
  expect(summary).not.toContain("收到权威日志尾段 #105–105");
  expect(summary).not.toContain("命令 #70");
  expect(summary).not.toContain("命令 #72");
  expect(summary).not.toContain("目标=城池");
});

test("连续收到权威日志后仍优先保留播放失败和命令拒绝", () => {
  const summary = summarizeTimeline([
    { kind: "audio", stage: "end", reason: "failed", sound: "marchStart", instanceId: 8, at: 1100 },
    {
      kind: "command",
      stage: "result",
      id: 87,
      command: "buyProperty",
      outcome: "rejected",
      reason: "该座位尚未轮到操作",
      at: 1210,
    },
    ...Array.from({ length: 13 }, (_, index) => ({
      kind: "authorityLog" as const,
      source: "tail" as const,
      at: 1220 + index * 33,
      offset: 253 + index,
      count: 1,
    })),
  ]);

  expect(summary).toContain("音效 #8 marchStart 结束（播放失败）");
  expect(summary).toContain("命令 #87 购地 被拒绝 该座位尚未轮到操作");
});

test("旧帧窗标明滚动口径和缺失能力，只称留存的最大卡顿", () => {
  const summary = formatGameDiagnosticSummary(
    archivedGame(
      captureOf({
        perf: {
          startedAt: 5_000,
          stoppedAt: 9_000,
          loafSupported: false,
          windows: [
            {
              t0: 5_100,
              frames: 91,
              p50: 16.7,
              p95: 19,
              max: 93,
              longTasks: 0,
              longTaskMs: 0,
              loafCount: 0,
              loafScriptMs: 0,
              loafStyleLayoutMs: 0,
              ctx,
            },
          ],
          jank: [{ t: 8_900, deltaMs: 93, ctx }],
          slowFrames: [],
        },
      }),
    ),
  );

  expect(summary).toContain("客户端时间线未采样");
  expect(summary).toMatch(/帧窗口径 历史滚动[^\n]*止点未记/u);
  expect(summary).toMatch(/长任务 能力未记录[^\n]*LoAF 未支持/u);
  expect(summary).toMatch(/^~100 \? 91\/\? 16\.7 19 93 \? - 0$/mu);
  expect(summary).toContain("3900 93 0 留存最重");
  expect(summary).toMatch(/前后台 · 未采样/u);
});

test("极长现场明细和日志整项省略，仍交代待操作及连接状态", () => {
  const oversized = "超长内容".repeat(3_000);
  const capture = captureOf({
    perf: null,
    timeline: {
      timeOrigin,
      startedAt: 0,
      capturedAt: 100,
      baseline: {
        at: 0,
        state: {
          ...scene,
          decision: {
            ...scene.decision,
            choices: Array.from({ length: 80 }, () => ({ id: oversized, available: true })),
          },
          connection: { roomId: "DIAG", status: "failed", failure: oversized },
        },
      },
      authorityAnchorBeforeStart: null,
      events: [],
      omitted: 0,
    },
  });
  capture.device.ua = oversized;
  const game = archivedGame(capture);
  const row = {
    ts: timeOrigin,
    round: 2,
    turn: 7,
    player: null,
    category: "system" as const,
    detail: "",
  };
  game.log = {
    capturedAt: timeOrigin,
    lines: [
      { ...row, brief: "保留整行" },
      { ...row, brief: oversized },
    ],
  };
  game.logCount = 2;

  const summary = formatGameDiagnosticSummary(game);
  expect(summary.length).toBeLessThanOrEqual(8000);
  expect(summary).not.toContain("超长内容");
  expect(summary).toContain("待操作 选项 80 项，明细过长已省略");
  expect(summary).toContain("连接 连接失败 DIAG 过长已省略");
  expect(summary).toMatch(/对局日志 #0–0[^\n]*省略 1 条/u);
  expect(summary).toMatch(/^#0 2\/7 保留整行$/mu);
});
