import { expect, it } from "bun:test";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  pinDice,
  placePlayer,
  setBot,
  setDefense,
  setStamina,
} from "@dafung/core/engine/planter";
import guanzhong from "../packages/core/maps/guanzhong.json";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { cmdMsg, type InboundMsg } from "@dafung/core/protocol/wire";

const { board, catalog } = loadMap(guanzhong);

function makeEngine(targetNetWorth = 30000): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: [
      { name: "甲", isBot: false, guohao: "魏" },
      { name: "乙", isBot: false, guohao: "蜀" },
      { name: "丙", isBot: false, guohao: "吴" },
      { name: "丁", isBot: false, guohao: "汉" },
    ],
    targetNetWorth,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function submit(engine: GameEngine, command: GameCommand): void {
  const message: InboundMsg = JSON.parse(cmdMsg(command));
  if (message.type !== "cmd") throw new Error("缺少提交命令");
  engine.submitCommand(message.cmd);
}

function project(authority: GameEngine, seat: number) {
  const replica = makeEngine();
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(authority.snapshot(), seat))),
  );
  return {
    replica,
    apply(engine: GameEngine, command: GameCommand) {
      submit(engine, command);
      foldEventBatch(
        replica,
        JSON.parse(JSON.stringify(redactEvents(engine.snapshot().events, seat))),
      );
    },
  };
}

it("袭扰限出牌阶段，允许跨环三格的对手，拒绝射程外、休整中及己方座位", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  placePlayer(engine, 0, 0);
  placePlayer(engine, 1, board.count - 3);
  placePlayer(engine, 2, 4);
  placePlayer(engine, 3, 1);
  engine.damageStamina(3, 100, null);

  giveJinnang(engine, 0, ["袭扰", "袭扰"]);
  submit(engine, { type: "useJinnang", cardId: "袭扰" });
  expect(engine.pendingJinnang).toBeNull();
  armPhase(engine, { turnPhase: "AwaitingJinnang" });
  submit(engine, { type: "useJinnang", cardId: "袭扰" });
  expect(
    engine
      .choicesFor()
      .filter((option) => option.available && option.targetSeat != null)
      .map((option) => option.targetSeat),
  ).toEqual([1]);
  for (const target of [0, 2, 3]) {
    submit(engine, { type: "useJinnang", cardId: "袭扰", targets: [target] });
    expect(engine.players[0].jinnangHand).toEqual(["袭扰", "袭扰"]);
  }

  submit(engine, { type: "useJinnang", cardId: "袭扰", targets: [1] });
  expect(engine.players[1].stamina).toBe(90);
  expect(engine.turnPhase).toBe("AwaitingJinnang");
  submit(engine, { type: "useJinnang", cardId: "袭扰" });
  submit(engine, { type: "useJinnang", cardId: "袭扰", targets: [1] });
  expect(engine.players[1].stamina).toBe(80);
  expect(engine.turnPhase).toBe("Roll");
  expect(engine.snapshot().events.filter((event) => event.kind === "staminaChanged")).toEqual([
    expect.objectContaining({ seat: 1, delta: -10, reason: "damage" }),
  ]);
});

it("目标可以识破袭扰而保住原体力", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(engine, 0, ["袭扰"]);
  giveJinnang(engine, 1, ["识破诡计"]);

  submit(engine, { type: "useJinnang", cardId: "袭扰" });
  submit(engine, { type: "useJinnang", cardId: "袭扰", targets: [1] });
  expect(engine.turnPhase).toBe("AwaitingReaction");
  expect(engine.players[1].stamina).toBe(100);
  submit(engine, { type: "respondReaction", seat: 1, use: true, cardId: "识破诡计" });

  expect(engine.players[1].stamina).toBe(100);
  expect(engine.jinnangDiscard).toEqual(["袭扰", "识破诡计"]);
  expect(engine.snapshot().events).toContainEqual(
    expect.objectContaining({ kind: "jinnangVoided", cardId: "袭扰" }),
  );
  expect(engine.snapshot().events.some((event) => event.kind === "staminaChanged")).toBe(false);
});

it("Bot 即席让过识破后，事件批恢复权威与副本的出牌阶段", () => {
  const authority = makeEngine();
  armPhase(authority, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(authority, 0, ["军情密探", "袭扰"]);
  giveJinnang(authority, 1, ["识破诡计"]);
  setBot(authority, 1, true);
  const { replica, apply } = project(authority, 1);

  apply(authority, { type: "useJinnang", cardId: "军情密探" });
  apply(authority, { type: "useJinnang", cardId: "军情密探", targets: [1] });

  expect(authority.snapshot().events).toContainEqual(
    expect.objectContaining({ kind: "reactionAnswered", seat: 1, use: false }),
  );
  expect(
    authority.snapshot().events.filter((event) => event.kind === "jinnangPhaseResumed"),
  ).toEqual([expect.objectContaining({ turnPhase: "AwaitingJinnang" })]);
  expect(replica.turnPhase).toBe("AwaitingJinnang");
  expect(replica.players[0].jinnangHandCount).toBe(1);
});

it("袭扰归零触发放逐，重连后只结算一次城损与休整，继续出牌", () => {
  const authority = makeEngine();
  armPhase(authority, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(authority, 0, ["袭扰", "袭扰"]);
  giveJinnang(authority, 1, ["识破诡计"]);
  setStamina(authority, 1, 60);
  armHero(authority, 1, "caopi", ["fangzhu"]);
  setStamina(authority, 1, 6);
  grantProperty(authority, 1, "prop-jinyang", 2);
  setDefense(authority, 1, "prop-jinyang", 2);

  const { replica, apply } = project(authority, 1);

  apply(authority, { type: "useJinnang", cardId: "袭扰" });
  apply(authority, { type: "useJinnang", cardId: "袭扰", targets: [1] });
  apply(authority, { type: "respondReaction", seat: 1, use: false });

  expect(authority.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.decisionOwner).toBe(1);
  expect(replica.players[1]).toMatchObject({ stamina: 0, resting: false, skipTurns: 0 });
  expect(replica.players[1].properties[0].defense).toBe(2);
  expect(authority.snapshot().events.filter((event) => event.kind === "staminaChanged")).toEqual([
    expect.objectContaining({ seat: 1, delta: -6, reason: "damage" }),
  ]);

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(authority.snapshot())));
  apply(restored, { type: "respondSkillChoice", seat: 1, use: true, targetSeat: 0 });

  expect(replica.players[0]).toMatchObject({ cash: 10010, skipTurns: 1 });
  expect(replica.players[1]).toMatchObject({ stamina: 0, resting: true, skipTurns: 2 });
  expect(replica.players[1].properties[0]).toMatchObject({
    level: 1,
    defense: 40,
    damageRanking: [{ seat: 0, damage: 2 }],
  });
  expect(restored.activeIndex).toBe(0);
  expect(restored.turnPhase).toBe("AwaitingJinnang");
  expect(replica.turnPhase).toBe("AwaitingJinnang");
  expect(restored.choicesFor().find((option) => option.id === "袭扰")?.available).toBe(true);
});

it("袭扰攻陷城池的奖励计入回合收尾判胜，先完成行殇选择", () => {
  const engine = makeEngine(10200);
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(engine, 0, ["袭扰"]);
  armHero(engine, 0, "caopi", ["xingshang"]);
  setStamina(engine, 1, 6);
  grantProperty(engine, 1, "prop-youzhou", 1);
  setDefense(engine, 1, "prop-youzhou", 3);

  submit(engine, { type: "useJinnang", cardId: "袭扰" });
  submit(engine, { type: "useJinnang", cardId: "袭扰", targets: [1] });
  expect(engine.findOwner("prop-youzhou")).toBe(engine.players[0]);
  expect(engine.players[0].cash).toBe(10285);
  expect(engine.players[1]).toMatchObject({ stamina: 0, resting: true, skipTurns: 2 });
  expect(engine.phase).toBe("Playing");
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  submit(engine, { type: "respondSkillChoice", seat: 0, use: true });
  expect(engine.players[1].skipTurns).toBe(3);
  expect(engine.turnPhase).toBe("Roll");

  pinDice(engine, "march", [1]);
  submit(engine, { type: "rollAndMove" });
  submit(engine, { type: "endDecision" });
  expect(engine.winner).toBe(engine.players[0]);
});
