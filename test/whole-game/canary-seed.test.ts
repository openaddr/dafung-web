// 固定种子守住关中图选都、起手与首回合摸牌、首摇落格的开局链。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";

const MAP = loadMap(guanzhongData);

function soloEngine(seed: number): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "你", isBot: false, guohao: "魏" },
      { name: "黔", isBot: true },
      { name: "荆", isBot: true },
      { name: "宋", isBot: true },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

describe("种子哨兵(solo 形状 setup 签名,seed 13261)", () => {
  it("定都剑阁，首回合两张反应牌可直接掷骰，落咸阳待购", () => {
    const e = soloEngine(13261);
    e.doDraftRoll();
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 60) {
      const idx = e.currentSetupPlayerIndex;
      if (idx < 0) break;
      if (e.players[idx].isBot) e.aiSetupStep();
      else {
        const cap = e.offeredCapitals[0];
        if (cap == null) break;
        e.pickCapital(idx, cap);
      }
    }
    expect(e.phase).toBe("Playing");
    expect(e.players[0].capitalIndex).toBe(12); // 剑阁(引擎首候选=环序最小,双链同格)
    expect(e.players[0].jinnangHand).toEqual(["识破诡计", "半路杀出"]);
    expect(e.turnPhase).toBe("Roll");
    e.rollAndMove();
    expect(e.presentation.lastRoll?.die).toBe(3);
    expect(e.players[0].position).toBe(15); // 咸阳
    expect(e.turnPhase).toBe("AwaitingDecision"); // 购地卷轴停靠点
  });
});
