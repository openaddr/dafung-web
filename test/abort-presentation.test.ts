// #642 异常终局·演出面:gameOver(reason="aborted")不播胜利音——对局作废无胜者,
// 庆祝演出只属胜局;作废面板由快照 GameOver 相位驱动挂载,非事件演出(fx 提取器的
// 显式 abort 分支钉死,正常终局照播胜利音已由 presentation.test.ts 破产清算例压轴断言)。
import { describe, it, expect } from "bun:test";
import { GameEngine, type EngineConfig } from "@core/authority";
import { createDice } from "@core/dice";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { extractBatchEvents } from "../src/app/fx/event-extract";
import type { PresentationEvent } from "../src/app/fx/presentation";

const MAP = loadMap(huanyouData);

function makeEngine(): GameEngine {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 8000,
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
