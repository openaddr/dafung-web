import { expect, it, spyOn } from "bun:test";
import {
  GameDiagnosticTimeline,
  type GameDiagnosticTimelineState,
} from "@app/game-diagnostic-timeline";

it("时间线淘汰整条记录后保留重建起点，迟到的接收证据按实际时间入列", () => {
  using clock = spyOn(performance, "now").mockReturnValue(100);
  const scene: GameDiagnosticTimelineState = {
    turn: {
      phase: "Playing",
      setupPhase: "Done",
      turnPhase: "Roll",
      round: 1,
      turnNumber: 2,
      activeIndex: 0,
      decisionOwner: 0,
    },
    decision: {
      capitalChoices: null,
      choices: [],
      reaction: null,
      reactionSeq: null,
      reactionDeadlineAt: null,
      pendingLand: null,
      pendingDebt: null,
      treasureVisitor: null,
      pendingJinnang: null,
      pendingSkill: null,
      skillChoice: null,
    },
    interaction: {
      seat: 0,
      interactive: true,
      selfPresenting: false,
      pending: false,
      fxBusy: false,
      autopilotOn: false,
    },
    connection: null,
    controls: {
      capital: "hidden",
      jinnang: "hidden",
      reaction: "hidden",
      skillChoice: "hidden",
      decisionScroll: "hidden",
      target: null,
      peeking: false,
      preparing: false,
    },
  };
  const timeline = new GameDiagnosticTimeline(scene);
  clock.mockReturnValue(110);
  timeline.observe({ turn: { ...scene.turn, turnPhase: "AwaitingDecision" } });
  timeline.record({ kind: "authorityLog", source: "tail", offset: 1, count: 1, at: 108 });
  for (let index = 0; index < 512; index++) {
    timeline.record({ kind: "error", at: 120 + index, message: `错误 ${index}` });
  }
  timeline.record({ kind: "authorityLog", source: "tail", offset: 2, count: 1, at: 124.5 });
  timeline.record({ kind: "authorityLog", source: "tail", offset: 3, count: 1, at: 118 });
  clock.mockReturnValue(700);

  const dump = timeline.collect();
  expect(dump).toMatchObject({
    startedAt: 100,
    capturedAt: 700,
    baseline: { at: 120, state: { turn: { turnPhase: "AwaitingDecision" } } },
    omitted: 4,
  });
  expect(dump.events).toHaveLength(512);
  expect(dump.events.slice(0, 6).map(({ at }) => at)).toEqual([121, 122, 123, 124, 124.5, 125]);
  expect(dump.events.at(-1)?.at).toBe(631);
});
