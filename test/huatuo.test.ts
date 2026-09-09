// 华佗·回血技能(#133):regenStamina 效果落账给技能持有者(ctx.owner,而非 RoundStart 的
// subject=轮次锚点)/ 池 3→4 招贤洗牌可抽 / 真实轮次驱动 cooldown 3 轮节奏(参照
// timing.test.ts 的 RoundStart 冷却先例)/ clamp 溢出作废 / 回血只加不减、不触发耗竭。
// 机遇缺省关闭(EngineConfig.encounter 缺省 triggerRate=0),真实轮次驱动无随机扣体力干扰。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import { createDice } from "@core/dice";
import { HEROES } from "@core/heroes";
import { EFFECTS } from "@core/effects";
import { testEngine } from "@core/testing";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
/** 锦囊门垫(#122/T2):回合开始可能停在锦囊卷轴相位,直调 rollAndMove 的测试先「今不用」。
 *  pass 不掷骰,骰流与断言不受扰。 */
function passJinnang<T extends { turnPhase: string; resolveJinnang(cardId: string | null): void }>(e: T): T {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}


const MAP = loadMap(sanguoData);

function makeEngine(seed = 1): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  });
}

/** 驱动选都到完成(人类选第一个空城,bot 自动)。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) e.aiSetupStep();
    else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

/** 驱动当前玩家完成回合(默认抉择),直到进入下一玩家 Roll 或 GameOver。 */
function autoResolve(e: GameEngine) {
  let guard = 0;
  while (e.turnPhase !== "Roll" && e.turnPhase !== "GameOver" && guard++ < 20) {
    if (e.turnPhase === "AwaitingBranch") e.selectBranch("Main");
    else if (e.turnPhase === "AwaitingDecision") e.endDecision();
    else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(1);
    else if (e.turnPhase === "AwaitingTreasureOwner") e.resolveTreasureOwner({ type: "skip" });
    else if (e.turnPhase === "AwaitingBankruptcySettle") e.confirmBankruptcySettle();
    else break;
  }
}

/** 打满一整轮(每位玩家各行动一次)。 */
function playFullRound(e: GameEngine) {
  for (let i = 0; i < e.players.length && !e.isOver; i++) {
    passJinnang(e).rollAndMove();
    autoResolve(e);
  }
}

const huatuo = () => HEROES.find((h) => h.id === "huatuo")!;
const SKILL_ID = "huatuo-regen-stamina";

/** 某技能的击发次数(按战报 skill 行统计)。 */
const fireCount = (e: GameEngine, skillId: string) =>
  e.log.filter((l) => l.category === "skill" && l.detail.includes(`skill=${skillId} `)).length;

describe("华佗在池(#133)", () => {
  it("HEROES 含 huatuo,技能数据齐备(时机/效果/参数/冷却/scope)", () => {
    const h = huatuo();
    expect(h).toBeDefined();
    expect(h.name).toBe("华佗");
    expect(h.skills).toHaveLength(1);
    const s = h.skills![0];
    expect(s.id).toBe(SKILL_ID);
    expect(s.when).toBe("RoundStart");
    expect(s.effect).toBe("regenStamina");
    expect(s.params).toEqual({ amount: 15 });
    expect(s.cooldown).toBe(3);
    expect(s.scope).toBe("any"); // 缺省 self 会让非锚点持有者永不触发
    expect(EFFECTS["regenStamina"]).toBeTypeOf("function"); // 效果已注册
  });

  it("招贤洗牌可抽到华佗(池 3→4,三选一)", () => {
    let seen = false;
    for (let seed = 1; seed <= 20 && !seen; seed++) {
      const e = makeEngine(seed);
      finishSetup(e);
      testEngine(e).tryRecruitHero(e.activePlayer); // 窄口触达私有招贤步骤(同 game.test.ts)
      expect(e.turnPhase).toBe("AwaitingHeroPick");
      expect(e.offeredHeroes.length).toBe(3); // 池 4 位 → 三选一
      if (e.offeredHeroes.some((h) => h.id === "huatuo")) seen = true;
    }
    expect(seen).toBe(true); // 洗牌以 3/4 概率出华佗,20 个种子必中(确定性,无随机逃逸)
  });
});

describe("华佗·regenStamina 效果(#133)", () => {
  it("持有者定位:RoundStart 主体=锚点(subject≠owner)时回的是持有者的血,主体不动", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(huatuo());
    e.addStamina(0, -40); // 100 → 60
    const s1 = e.players[1].stamina;
    e.dispatchMoment("RoundStart", { subject: 1 }); // 主体=座位 1(锚点),持有者=座位 0
    expect(e.players[0].stamina).toBe(75); // 持有者 +15
    expect(e.players[1].stamina).toBe(s1); // 主体分文未动
    expect(e.players[0].heroLastFired[SKILL_ID]).toBe(e.round); // 生效记冷却
  });

  it("真实轮次驱动 cooldown 3 轮:round 2 回、3/4 不回、5 再回", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(huatuo());
    e.addStamina(0, -40); // 60
    playFullRound(e); // round 1→2:轮首 RoundStart 首次触发
    expect(e.round).toBe(2);
    expect(e.players[0].stamina).toBe(75);
    expect(e.players[0].heroLastFired[SKILL_ID]).toBe(2);
    playFullRound(e); // 2→3:3-2=1 < 3 冷却内不触发
    expect(e.players[0].stamina).toBe(75);
    playFullRound(e); // 3→4:4-2=2 < 3 仍冷却
    expect(e.round).toBe(4);
    expect(e.players[0].stamina).toBe(75);
    playFullRound(e); // 4→5:5-2=3 ≥ 3 再触发
    expect(e.round).toBe(5);
    expect(e.players[0].stamina).toBe(90);
    expect(e.players[0].heroLastFired[SKILL_ID]).toBe(5);
    expect(fireCount(e, SKILL_ID)).toBeGreaterThanOrEqual(2); // 战报行至少两条(seat1 若同招华佗另计)
  });

  it("clamp:满 100 回血溢出作废(体力仍 100,技能已击发照记战报/冷却)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(huatuo());
    expect(e.players[0].stamina).toBe(100);
    e.dispatchMoment("RoundStart", { subject: 1 });
    expect(e.players[0].stamina).toBe(100); // +15 溢出作废
    expect(e.players[0].heroLastFired[SKILL_ID]).toBe(e.round); // 击发事实不因 clamp 吞掉
    expect(fireCount(e, SKILL_ID)).toBe(1);
  });

  it("回血只加不减,不触发耗竭", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(huatuo());
    e.addStamina(0, -100); // 归 0(耗竭线上)
    e.dispatchMoment("RoundStart", { subject: 1 });
    expect(e.players[0].stamina).toBe(15); // 0 + 15
    expect(e.exhaustIfDepleted(0)).toBe("none"); // 体力 >0:不进耗竭相位
    expect(e.players[0].skipTurns).toBe(0); // 无跳回合惩罚
  });
});
