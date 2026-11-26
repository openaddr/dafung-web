// 作废面板由终局相位驱动挂载，作废事件提取时保持静默。
import { describe, it, expect } from "bun:test";
import { GameEngine, type EngineConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";
import { extractBatchEvents } from "../../apps/client/src/app/fx/event-extract";
import type { PresentationEvent } from "../../apps/client/src/app/fx/presentation";

const MAP = loadMap(guanzhongData);

function makeEngine(): GameEngine {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 8000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(1), cfg);
}

/** 驱动选都到完成(人类选第一个空城;照 presentation.test.ts 的构造方式)。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

describe("异常终局演出(#642 abortGame → fx 提取器)", () => {
  it("gameOver(reason=aborted) 不播胜利音", () => {
    const e = makeEngine();
    finishSetup(e);
    e.abortGame("测试作废:驱动链死亡出口");
    const out: PresentationEvent[] = extractBatchEvents(e, e.gameEvents);
    expect(out.some((ev) => ev.kind === "sound" && ev.event === "victory")).toBe(false);
  });
});
