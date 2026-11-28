import { expect, it } from "bun:test";
import type { GameCommand } from "@dafung/core/engine/authority";
import { armPhase, giveJinnang } from "@dafung/core/engine/planter";
import { reactionChoicesForSeat } from "@dafung/core/protocol/reaction-choices";
import { SeatInteraction } from "@dafung/core/protocol/seat-interaction";
import type { SeatDecision } from "@dafung/core/protocol/wire";
import { redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { autoSetup, createEngine, MAP } from "../scripts/engine-helpers";

function playingEngine() {
  const engine = createEngine({
    seats: ["蜀", "吴", "魏"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    seed: 67,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: 0,
  });
  autoSetup(engine);
  return engine;
}

it("无界面座位的草选只在发起的决策点有效，重连恢复已提交步骤", () => {
  const engine = playingEngine();
  giveJinnang(engine, 0, ["连环计", "火烧连营", "连环计"]);
  armPhase(engine, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  const delivered: { command: GameCommand; point: string }[] = [];
  const seat = new SeatInteraction((command, point) => {
    if (command.type === "pickCapital") throw new Error("本例预期出牌命令");
    delivered.push({ command, point });
    engine.submitCommand(command);
  });
  const frame = (decisionPoint: string) => ({
    snapshot: redactSnapshotForSeat(engine.snapshot(), 0),
    seat: 0,
    interactive: true,
    autopilotOn: false,
    decisionPoint,
    decisionOptions: {
      kind: "playJinnang",
      choices: engine.choicesFor(),
      pendingJinnang: engine.pendingJinnang,
      pendingSkill: engine.pendingSkill,
    } satisfies SeatDecision["decisionOptions"],
  });
  seat.publish(frame("选牌"));
  seat.act({ type: "selectCard", handIndex: 2 });
  expect(delivered).toEqual([]);
  seat.act({ type: "confirm" });
  expect(delivered).toEqual([
    {
      command: { type: "useJinnang", cardId: "连环计", handIndex: 2 },
      point: "选牌",
    },
  ]);

  seat.publish(frame("第一次选首位"));
  seat.act({ type: "toggleTarget", id: 1 });
  const next = frame("重新选首位");
  seat.publish(next);
  expect(seat.view.jinnang?.targets?.selected).toEqual([]);
  expect(seat.act({ type: "toggleTarget", id: 1 }, "第一次选首位")).toMatchObject({
    status: "unavailable",
    reason: "决策点已失效",
  });
  expect(seat.view.jinnang?.canConfirm).toBe(false);
  seat.act({ type: "toggleTarget", id: 2 });
  expect(seat.act({ type: "toggleTarget", id: 0 })).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("不能指定自己"),
  });
  expect(seat.view.jinnang?.targets?.selected).toEqual([2]);
  seat.act({ type: "confirm" });

  const second = frame("选择第二位");
  seat.publish(second);
  seat.act({ type: "toggleTarget", id: 1 });
  seat.publish(second, { reconnect: true });
  expect(JSON.parse(JSON.stringify(seat.view)).jinnang).toMatchObject({
    stage: "two-b",
    selectedHandIndex: 2,
    canBack: true,
    canConfirm: false,
    targets: { selected: [], firstSeat: { id: 2, label: "魏" } },
  });
  expect(delivered).toHaveLength(2);
  seat.act({ type: "cancel" });
  expect(delivered.at(-1)).toEqual({
    command: { type: "useJinnang", cardId: "连环计", handIndex: 2, cancel: true },
    point: "选择第二位",
  });
  expect(engine.players[0].jinnangHand).toEqual(["连环计", "火烧连营", "连环计"]);
});

it("无界面被询问座位只能用公告份额识破，其他座位不能代答", () => {
  const engine = playingEngine();
  giveJinnang(engine, 0, ["横征暴敛"]);
  giveJinnang(engine, 1, ["识破诡计"]);
  giveJinnang(engine, 2, []);
  armPhase(engine, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  engine.submitCommand({ type: "useJinnang", cardId: "横征暴敛", handIndex: 0 });
  const submitted: GameCommand[] = [];
  const seat = new SeatInteraction((command) => {
    if (command.type === "pickCapital") throw new Error("本例预期反应应答");
    submitted.push(command);
    engine.submitCommand(command);
  });
  const observe = (index: number, point: string | null) =>
    seat.publish({
      snapshot: redactSnapshotForSeat(engine.snapshot(), index),
      seat: index,
      interactive: true,
      autopilotOn: false,
      decisionPoint: point,
      decisionOptions: point === null ? undefined : reactionChoicesForSeat(engine, index),
      reactionDeadlineAt: 4150,
    });
  observe(2, null);
  expect(seat.view.reaction).toMatchObject({ asked: false, playable: [], canRespond: false });
  expect(seat.act({ type: "pass" }).status).toBe("unavailable");
  observe(1, "开窗");
  expect(seat.view.reaction).toMatchObject({
    asked: true,
    answered: false,
    canRespond: true,
    deadlineAt: 4150,
    playable: [{ cardId: "识破诡计", handIndex: 0 }],
    shares: { domain: "seat", candidates: [{ id: 1 }, { id: 2 }] },
  });
  expect(seat.act({ type: "selectCard", handIndex: 0 }).status).toBe("draft");
  expect(seat.act({ type: "confirm" }).status).toBe("unavailable");
  expect(submitted).toHaveLength(0);
  expect(seat.act({ type: "toggleTarget", id: 2 }).status).toBe("draft");
  expect(seat.act({ type: "confirm" }).status).toBe("submitted");
  expect(submitted).toEqual([
    {
      type: "respondReaction",
      seat: 1,
      use: true,
      cardId: "识破诡计",
      handIndex: 0,
      target: { kind: "seat", id: 2 },
    },
  ]);
});
