// 固定种子守住关中图六人开局的选都、摸牌和首摇落格。
import { describe, it, expect } from "bun:test";
import { defaultSetupSeats } from "@app/screens/setup/setup-defaults";
import { MAP, autoSetup, createEngine } from "../../scripts/engine-helpers";

describe("六人标准局开局种子哨兵", () => {
  it("定都剑阁，首回合两张反应牌可直接掷骰，落咸阳待购", () => {
    const e = createEngine({
      seats: defaultSetupSeats("魏"),
      seed: 20645,
      targetNetWorth: MAP.targetNetWorth,
      startingCash: MAP.startingCash,
      startingTreasures: MAP.startingTreasures,
    });
    autoSetup(e);
    expect(e.phase).toBe("Playing");
    expect(e.players).toHaveLength(6);
    expect(e.activeIndex).toBe(0);
    expect(e.players[0].capitalIndex).toBe(12); // 剑阁
    expect(e.players[0].jinnangHand).toEqual(["识破诡计", "半路杀出"]);
    expect(e.turnPhase).toBe("Roll");
    e.rollAndMove();
    expect(e.presentation.lastRoll?.die).toBe(3);
    expect(e.players[0].position).toBe(15); // 咸阳
    expect(e.turnPhase).toBe("AwaitingDecision");
  });
});
