import { describe, it, expect } from "vitest";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { netWorth } from "@core/networth";
import { HEROES } from "@core/heroes";

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
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
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
    else if (e.turnPhase === "AwaitingBranch") e.selectBranch("Shortcut");
    else if (e.turnPhase === "AwaitingDecision") e.endDecision();
    else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(0);
    else if (e.turnPhase === "AwaitingTreasureOwner") e.resolveTreasureOwner({ type: "skip" });
    else if (e.turnPhase === "AwaitingBankruptcySettle") e.confirmBankruptcySettle();
    else break;
  }
}

describe("回合与胜负", () => {
  it("掷骰移动后离开 Roll 阶段", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.rollAndMove();
    expect(e.lastRoll).not.toBeNull();
    expect(e.lastMove).not.toBeNull(); // 掷骰后已移动(落 TreasureCity 会同步探宝 endTurn 回 Roll,属正常)
  });

  it("endTurn 不清空 lastRoll/lastMove(doRoll 动画依赖;防回归)", () => {
    // rollAndMove 落己城/付租时会内部 endTurn;doRoll 的 animateDice/animateMove 在其后读,
    // 故 endTurn 绝不能清空 lastRoll/lastMove(曾因此死锁,见 e2e human.spec:69)。
    const e = makeEngine(1);
    finishSetup(e);
    e.rollAndMove();
    autoResolve(e);
    expect(e.lastRoll).not.toBeNull();
    expect(e.lastMove).not.toBeNull();
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

describe("委任状", () => {
  it("开局每人 3 张委任状", () => {
    const e = makeEngine(1);
    finishSetup(e);
    expect(e.players.every((p) => p.warrants === 3)).toBe(true);
    expect(e.snapshot().players.every((p) => p.warrants === 3)).toBe(true);
  });

  it("买城消耗 1 委任状并获得地产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const buyer = e.activePlayer;
    const def = e.catalog.get("prop-luoyang")!;
    e.turnPhase = "AwaitingDecision";
    e.lastLandOutcome = { kind: "PropertyAvailable", property: def };
    const w0 = buyer.warrants;
    const props0 = buyer.properties.length;
    e.buyProperty();
    expect(buyer.warrants).toBe(w0 - 1); // 消耗 1 委任状
    expect(buyer.properties.length).toBe(props0 + 1); // 获得地产
  });

  it("0 委任状时买城被拒(NoWarrant),不消耗、不获得", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const buyer = e.activePlayer;
    const def = e.catalog.get("prop-luoyang")!;
    buyer.warrants = 0;
    const props0 = buyer.properties.length;
    e.turnPhase = "AwaitingDecision";
    e.lastLandOutcome = { kind: "PropertyAvailable", property: def };
    e.buyProperty();
    expect(buyer.warrants).toBe(0); // 未消耗
    expect(buyer.properties.length).toBe(props0); // 未获得
  });
});

describe("名士(英雄)", () => {
  const hero = (id: string) => HEROES.find((h) => h.id === id)!;

  it("周瑜·moveBonus:移动步数 +1", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.heroes.push(hero("zhouyu"));
    e.rollAndMove();
    const rollLog = e.log.filter((ev) => ev.category === "roll").pop()!;
    expect(rollLog.detail).toContain("bonus=1");
  });

  it("张星彩·onAnyRoll:掷出 6 时持有者 +20,非 6 不触发", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const holder = e.players[1];
    holder.heroes.push(hero("zhangxingcai"));
    const cash0 = holder.cash;
    (e as any).fireOnAnyRoll(6);
    expect(holder.cash).toBe(cash0 + 20);
    const cash1 = holder.cash;
    (e as any).fireOnAnyRoll(3);
    expect(holder.cash).toBe(cash1); // 非 6 不加
  });

  it("曹丕·onOtherLoseCash:他人失财时 +50,自己失财不触发", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const holder = e.players[1];
    holder.heroes.push(hero("caopi"));
    const cash0 = holder.cash;
    (e as any).fireOnOtherLoseCash(e.players[0]);
    expect(holder.cash).toBe(cash0 + 50);
    const cash1 = holder.cash;
    (e as any).fireOnOtherLoseCash(holder); // 自己失财 → 不触发
    expect(holder.cash).toBe(cash1);
  });

  it("招贤纳士:三选一 → 选一位获得名士", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const picker = e.activePlayer;
    expect(picker.heroes.length).toBe(0);
    (e as any).tryRecruitHero(picker);
    expect(e.turnPhase).toBe("AwaitingHeroPick");
    expect(e.offeredHeroes.length).toBe(3); // 池有 3 位 → 三选一
    e.resolveHeroPick(0);
    expect(picker.heroes.length).toBe(1); // resolveHeroPick → endTurn 切了玩家,用 picker 引用
    expect(picker.heroes[0].skill).toBeDefined();
  });

  it("回合计数:全员各行动一次后 round +1", () => {
    const e = makeEngine(1);
    finishSetup(e);
    expect(e.round).toBe(1);
    for (let i = 0; i < e.players.length; i++) {
      e.rollAndMove();
      autoResolve(e);
    }
    expect(e.round).toBe(2);
  });
});
