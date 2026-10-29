// 种子哨兵(2026-10-29 retro):动 setup 骰流的改动(AI 选都评分/发牌/draft 类)会让
// 全部离线核算种子整体作废——断相在 e2e 侧极不透明(卷轴不升/横幅不出/驱动超时),
// 本哨兵把它转化为一声响亮单测失败。只守 solo 形状(联机 3 座族的 419/837 仍会独立
// 漂移,同因同查)。先红 = 按 docs/how-to/开发与测试.md「种子哨兵与重钓配方」节重钓,
// 勿逐 spec 排查;e2e 受影响面 = soloAtBuyAsk / startBuyScroll / startShort(seed 50)。
// 座位名与国号预设进骰流(国号池洗牌),与被测 spec 逐字对齐,勿「规范化」。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(huanyouData);

function soloEngine(seed: number): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "你", isBot: false, guohao: "魏" },
      { name: "黔", isBot: true },
      { name: "荆", isBot: true },
      { name: "宋", isBot: true },
    ],
    targetNetWorth: 30000,
  });
}

describe("种子哨兵(solo 形状 setup 签名,seed 50)", () => {
  it("定都江州/起手唯反应识破诡计/首摇三落凉州购地卷轴(soloAtBuyAsk·startBuyScroll·startShort 同款)", () => {
    const e = soloEngine(50);
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
    expect(e.players[0].capitalIndex).toBe(16); // 江州
    expect(e.players[0].jinnangHand).toEqual(["识破诡计"]); // 唯反应 → 出牌阶段自动放行
    let guard2 = 0;
    while (e.turnPhase === "AwaitingJinnang" && guard2++ < 5) e.resolveJinnang(null);
    expect(e.turnPhase).toBe("Roll");
    e.rollAndMove();
    expect(e.presentation.lastRoll?.die).toBe(3); // 首摇三
    expect(e.players[0].position).toBe(19); // 凉州(无主城)
    expect(e.turnPhase).toBe("AwaitingDecision"); // 购地卷轴停靠点
  });
});
