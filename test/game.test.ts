import { describe, it, expect } from "vitest";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { netWorth } from "@core/networth";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[], target = 8000) {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: target,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(人类选第一个空城,bot 自动)。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const taken = new Set(e.snapshot().takenCapitalIndices);
      const tile = e.board.tiles.find((t) => !taken.has(t.index))!;
      e.pickCapital(idx, tile.index);
    }
  }
}

describe("开局三段式", () => {
  it("doDraftRoll 产出无平局的定序", () => {
    const e = makeEngine(42);
    e.doDraftRoll();
    expect(e.setupPhase).toBe("PickCapital");
    const rolls = e.snapshot().draftRolls;
    expect(new Set(rolls).size).toBe(rolls.length);
  });

  it("选都完成进入 Playing,每位玩家都有都城", () => {
    const e = makeEngine(1);
    finishSetup(e);
    expect(e.phase).toBe("Playing");
    expect(e.turnPhase).toBe("Roll");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  });

  it("选都扣建城费,玩家站在自己都城", () => {
    const e = makeEngine(1);
    finishSetup(e);
    for (const p of e.players) {
      const def = e.catalog.get(e.board.at(p.capitalIndex).propertyId)!;
      expect(p.cash).toBe(2500 - def.buildCost);
      expect(p.position).toBe(p.capitalIndex);
    }
  });

  it("AI 自动选都(全 bot 局也能完成 setup)", () => {
    const e = makeEngine(3, [
      { name: "A", isBot: true },
      { name: "B", isBot: true },
    ]);
    finishSetup(e);
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  });
});

/** 驱动当前玩家完成回合(默认抉择),直到进入下一玩家 Roll 或 GameOver。 */
function autoResolve(e: GameEngine) {
  let guard = 0;
  while (e.turnPhase !== "Roll" && e.turnPhase !== "GameOver" && guard++ < 20) {
    if (e.turnPhase === "AwaitingCapitalHalt") e.continueMove();
    else if (e.turnPhase === "AwaitingBranch") e.selectBranch("Main");
    else if (e.turnPhase === "AwaitingDecision") e.endDecision();
    else break;
  }
}

describe("回合与胜负", () => {
  it("掷骰移动后离开 Roll 阶段", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.rollAndMove();
    expect(e.lastRoll).not.toBeNull();
    expect(e.turnPhase).not.toBe("Roll");
  });

  it("目标身价达标触发胜利", () => {
    // 极低目标:选都后身价远超,第一次 endTurn 即胜
    const e = makeEngine(1, undefined, 100);
    finishSetup(e);
    expect(netWorth(e.activePlayer)).toBeGreaterThan(100);
    e.rollAndMove(); // 落格
    autoResolve(e); // 完成默认抉择 → endTurn → 胜负检测
    expect(e.isOver).toBe(true);
    expect(e.winner).not.toBeNull();
    expect(e.winReason).toBe("TargetNetWorth");
  });

  it("未达标则切换到下一位玩家", () => {
    const e = makeEngine(2, undefined, 100000); // 高目标,不会达标
    finishSetup(e);
    const first = e.activePlayer.id;
    e.rollAndMove();
    autoResolve(e);
    // 落格 endTurn 后应切换玩家(除非破产,这里不会)
    if (!e.isOver) {
      expect(e.activePlayer.id).not.toBe(first);
      expect(e.turnPhase).toBe("Roll");
    }
  });

  it("非决策阶段调用决策操作被安全忽略", () => {
    const e = makeEngine(1);
    finishSetup(e);
    // Roll 阶段调 buyProperty,应忽略不崩
    expect(() => e.buyProperty()).not.toThrow();
    expect(e.turnPhase).toBe("Roll");
  });

  it("snapshot 暴露完整可观测状态", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const s = e.snapshot();
    expect(s.phase).toBe("Playing");
    expect(s.players.length).toBe(2);
    expect(s.players[0]).toHaveProperty("cash");
    expect(s.players[0]).toHaveProperty("netWorth");
    expect(s.players[0]).toHaveProperty("position");
    expect(s.activeIndex).toBeGreaterThanOrEqual(0);
  });
});
