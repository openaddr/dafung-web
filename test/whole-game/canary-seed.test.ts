// 种子哨兵(2026-10-29 retro):动 setup 骰流的改动(AI 选都评分/发牌/draft 类)会让
// 全部离线核算种子整体作废——断相在 e2e 侧极不透明(卷轴不升/横幅不出/驱动超时),
// 本哨兵把它转化为一声响亮单测失败。只守 solo 形状(联机 3 座族的种子仍会独立
// 漂移,同因同查)。先红 = 按 docs/how-to/开发与测试.md「种子哨兵与重钓配方」节重钓,
// 勿逐 spec 排查;e2e 受影响面 = soloAtBuyAsk / startBuyScroll / startShort(seed)。
// 座位名与国号预设进骰流(国号池洗牌),与被测 spec 逐字对齐,勿「规范化」。
// #949 换图重钓(关中图):seed 1010 签名(进程内直扫重锁,配方同前):
// draftOrder=[0,3,1,2] 人类先手;定都剑阁(12,引擎首候选=环序最小,双链同格);
// 起手唯反应「半路杀出」(不入可用集,无窗可驻)→ 自动起摇落汉中(13,无主郡城)
// 弹购地抉择卷轴。bot 都:黔=幽州(2)/荆=长沙(10)/宋=辽东(3);
// bot 起手(全唯反应):黔=窃玉偷香、荆=识破诡计、宋=火烧连营。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import guanzhongData from "../../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

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

describe("种子哨兵(solo 形状 setup 签名,seed 1010)", () => {
  it("定都剑阁/起手唯反应半路杀出/首摇一落汉中购地卷轴(soloAtBuyAsk·startBuyScroll·startShort 同款;#949 关中图重钓)", () => {
    const e = soloEngine(1010);
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
    expect(e.players[0].jinnangHand).toEqual(["半路杀出"]); // 唯反应牌:开局无窗可驻,自动起摇
    let guard2 = 0;
    while (e.turnPhase === "AwaitingJinnang" && guard2++ < 5) e.resolveJinnang(null);
    expect(e.turnPhase).toBe("Roll");
    e.rollAndMove();
    expect(e.presentation.lastRoll?.die).toBe(1); // 首摇一
    expect(e.players[0].position).toBe(13); // 汉中(无主郡城)
    expect(e.turnPhase).toBe("AwaitingDecision"); // 购地卷轴停靠点
  });
});
