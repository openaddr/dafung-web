import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { netWorth } from "@core/networth";
import { HEROES } from "@core/heroes";
import { botAct } from "@core/bot";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[], target = 30000) {
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
      expect(p.cash).toBe(10000 - def.buildCost); // 经济 v2 起手 10000
      expect(p.position).toBe(p.capitalIndex);
    }
  });

  it("支持 8 人开局(#29):每人都有都城、颜色与国号", () => {
    const seats = Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}`, isBot: true }));
    const e = makeEngine(11, seats);
    finishSetup(e);
    expect(e.players).toHaveLength(8);
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
    expect(new Set(e.players.map((p) => p.colorIndex)).size).toBe(8);
    expect(new Set(e.players.map((p) => p.guohao)).size).toBe(8);
  });

  it("9 座位被拒绝(上限 8)", () => {
    const seats = Array.from({ length: 9 }, (_, i) => ({ name: `P${i + 1}`, isBot: true }));
    expect(() => makeEngine(11, seats)).toThrow("2–8");
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
    if (e.turnPhase === "AwaitingBranch") e.selectBranch("Branch");
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
    expect(e.presentation.lastRoll).not.toBeNull();
    expect(e.presentation.lastMove).not.toBeNull(); // 掷骰后已移动(落 TreasureCity 会同步探宝 endTurn 回 Roll,属正常)
  });

  it("endTurn 不清空 lastRoll/lastMove(doRoll 动画依赖;防回归)", () => {
    // rollAndMove 落己城/结算时会内部 endTurn;doRoll 的 animateDice/animateMove 在其后读,
    // 故 endTurn 绝不能清空 lastRoll/lastMove(曾因此死锁,见 e2e human.spec:69)。
    const e = makeEngine(1);
    finishSetup(e);
    e.rollAndMove();
    autoResolve(e);
    expect(e.presentation.lastRoll).not.toBeNull();
    expect(e.presentation.lastMove).not.toBeNull();
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

describe("经过都城必停(无驻跸/继续抉择)", () => {
  it("路过自己都城(落点非都城):无论剩几步都停在都城,补给+巡幸委任,回合结束", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    // 放到都城前一格:任意掷骰(die>=1)必经都城;die=1 恰落都城,其余必停
    p.position = (p.capitalIndex - 1 + e.board.count) % e.board.count;
    const cash0 = p.cash;
    const w0 = p.warrants;
    const nextIdx = e.players.findIndex((x) => x !== p);
    e.rollAndMove();
    const die = e.presentation.lastRoll!.die;
    expect(p.position).toBe(p.capitalIndex); // 停在都城(必停或恰落,都不前进)
    expect(p.onBranch).toBeNull();
    expect(p.warrants).toBe(w0 + 2); // 巡幸都城 +2 委任(两种情形都发)
    expect(p.cash).toBe(cash0 + e.capitalSupplyOf(p).supply); // 驻跸/落都城补给
    if (die > 1) {
      // 必停路径:回合直接结束(无任何等待相位),战报「军至都城…驻跸补给」
      expect(e.turnPhase).toBe("Roll");
      expect(e.activeIndex).toBe(nextIdx);
      expect(e.log.some((ev) => ev.category === "halt" && ev.brief.includes("军至都城"))).toBe(true);
      expect(e.log.some((ev) => ev.detail.includes("awaitingHalt"))).toBe(false);
      // lastMove 截断到都城:行军动画止步都城,不展示被放弃的剩余步数
      const mv = e.presentation.lastMove!;
      expect(mv.landIndex).toBe(p.capitalIndex);
      expect(mv.traversed[mv.traversed.length - 1]).toBe(p.capitalIndex);
    } else {
      // 落点恰是都城:行为不变(补给 + 招贤纳士三选一,回合未直接结束)
      expect(e.turnPhase as string).toBe("AwaitingHeroPick");
    }
  });

  it("落点恰是都城:行为不变(补给 + 招贤纳士三选一)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const p = e.activePlayer;
    // 直接落格到都城(绕开掷骰的确定性):resolveLanding 走「恰落都城」分支
    p.position = p.capitalIndex;
    e.turnPhase = "Land";
    (e as unknown as { resolveLanding: () => void }).resolveLanding();
    const supply = e.capitalSupplyOf(p).supply;
    expect(p.cash).toBeGreaterThanOrEqual(supply); // 已补给
    expect(e.turnPhase as string).toBe("AwaitingHeroPick"); // 触发招贤(必停分支不触发)
    expect(e.log.some((ev) => ev.category === "supply" && ev.brief.includes("都城补给"))).toBe(true);
    expect(e.log.some((ev) => ev.category === "halt")).toBe(false);
  });

  it("bot 适配:经过都城时 rollAndMove 直接结算必停,bot 驱动序列无中间卡点", () => {
    const e = makeEngine(5, [
      { name: "A", isBot: true, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
    ]);
    finishSetup(e);
    const p = e.activePlayer;
    p.position = (p.capitalIndex - 1 + e.board.count) % e.board.count;
    botAct(e); // Roll → rollAndMove:必停(或恰落都城)在引擎内直接结算
    expect(p.position).toBe(p.capitalIndex);
    // 无 AwaitingCapitalHalt 可停:botAct 持续驱动必然推进(不再依赖 halt/continue 抉择)
    const t0 = e.turnNumber;
    let guard = 0;
    while (!e.isOver && guard++ < 30) botAct(e);
    expect(e.turnNumber).toBeGreaterThan(t0); // 驱动序列持续推进,无卡死
  });
});

describe("分岔辅路(入口抉择 = 待入,下回合掷骰推进)", () => {
  const BRANCH_START = MAP.tiles.findIndex((t) => t.name === "许昌"); // 辅路起点
  const BRANCH_END = MAP.tiles.findIndex((t) => t.name === "襄阳"); // 辅路终点

  /** 把当前活跃玩家放到辅路起点并设 AwaitingBranch(模拟落格到起点)。 */
  function landOnBranchStart(e: GameEngine) {
    const p = e.activePlayer;
    p.position = BRANCH_START;
    p.onBranch = null;
    e.turnPhase = "AwaitingBranch" as any;
  }

  it("入口抉择 selectBranch(Branch):置待入状态 step=-1,本回合结束且不结算任何格", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const cash0 = p.cash;
    landOnBranchStart(e);
    e.selectBranch("Branch");
    expect(p.onBranch).toEqual({ step: -1 }); // 待入辅路
    expect(p.position).toBe(BRANCH_START); // 棋子仍在主路入口格
    expect(e.turnPhase).toBe("Roll"); // 本回合已结束(endTurn 推进到下家)
    expect(e.activePlayer).not.toBe(p);
    expect(p.cash).toBe(cash0); // 未结算任何辅路格效果
    // 战报:最后一条 branch 记录就是「取道辅路」,其后无探宝/锦囊/中伏结算
    const branchLogs = e.log.filter((ev) => ev.category === "branch");
    expect(branchLogs[branchLogs.length - 1]?.brief).toContain("取道辅路");
    // 入口不再重复弹:待入状态下 currentTileIsBranchStart 为假
    e.activeIndex = e.players.indexOf(p);
    expect(e.currentTileIsBranchStart()).toBe(false);
  });

  it("入口抉择 selectBranch(Main):按普通城落格(许昌可购买)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    landOnBranchStart(e);
    e.selectBranch("Main");
    expect(p.onBranch).toBeNull();
    expect(p.position).toBe(BRANCH_START);
    // 许昌是无主城 → AwaitingDecision(可购买)
    expect(e.turnPhase as string).toBe("AwaitingDecision");
  });

  it("下回合掷骰推进:掷 die=k 落辅路第 k 格(0 基 k-1)并触发该格效果", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    landOnBranchStart(e);
    e.selectBranch("Branch");
    // 拨回该玩家(selectBranch 已 endTurn),模拟其下回合
    e.activeIndex = e.players.indexOf(p);
    e.rollAndMove();
    const die = e.presentation.lastRoll!.die;
    const N = e.board.branch!.cells.length;
    if (die <= N) {
      expect(p.onBranch).toEqual({ step: die - 1 }); // 掷几点走几格:第 die 格
      expect(p.position).toBe(BRANCH_START); // 主路位置仍是入口占位
      expect(e.log.some((ev) => ev.category === "roll" && ev.detail.includes(`branchStep=${die - 1}`))).toBe(true);
      // 落格触发该格效果(treasure=探宝 / event=锦囊 / penalty=中伏跳回合)
      const kind = e.board.branch!.cells[die - 1].kind;
      if (kind === "treasure") expect(e.log.some((ev) => ev.brief.includes("辅路探宝"))).toBe(true);
      else if (kind === "event") expect(e.log.some((ev) => ev.brief.includes("辅路锦囊"))).toBe(true);
      else expect(p.skipTurns).toBe(1);
    } else {
      // die > N:溢出汇入主路(掷满辅路格后从终点继续走剩余步数)
      expect(p.onBranch).toBeNull();
      expect(p.position).not.toBe(BRANCH_START);
    }
  });

  it("快照恢复:待入状态 step=-1 序列化/恢复一致,恢复后掷骰仍沿辅路推进", () => {
    const e1 = makeEngine(9);
    finishSetup(e1);
    const p1 = e1.activePlayer;
    const idxP = e1.players.indexOf(p1);
    landOnBranchStart(e1);
    e1.selectBranch("Branch");
    expect(e1.snapshot().players[idxP].onBranch).toEqual({ step: -1 });
    // 恢复到同构新引擎(联机/持久化路径),拨回待入玩家
    const e2 = makeEngine(2); // 种子无所谓:恢复会覆盖 rngState
    e2.restoreFromSnapshot(e1.snapshot());
    expect(e2.players[idxP].onBranch).toEqual({ step: -1 });
    e1.activeIndex = idxP;
    e2.activeIndex = idxP;
    // 两引擎同走一步(掷同一颗骰),快照仍逐字段一致;待入状态被掷骰消化
    e1.rollAndMove();
    e2.rollAndMove();
    expect(JSON.stringify(e2.snapshot())).toBe(JSON.stringify(e1.snapshot()));
    const ob = e1.players[idxP].onBranch;
    expect(ob == null || ob.step >= 0).toBe(true);
  });

  it("penalty 格触发 skipTurns:踩中第 4 格(中伏)→ 下回合被跳过", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    // 直接置入辅路第 4 格(penalty)并调用 resolveBranchCell
    p.onBranch = { step: 4 };
    p.position = BRANCH_START;
    e.turnPhase = "Land" as any;
    (e as any).resolveBranchCell(p, e.board.branch!.cells[4]);
    expect(p.skipTurns).toBe(1);
    // 战报含"中伏"
    expect(e.log.some((ev) => ev.category === "branch" && ev.brief.includes("中伏"))).toBe(true);
  });

  it("辅路终点汇入:从 step0 走完所有格 → 清 onBranch,落 endNode(主路)", () => {
    const board = MAP.board;
    const N = board.branch!.cells.length;
    const path = board.computePath(BRANCH_START, N, -1, { step: 0 });
    expect(path.landBranchStep).toBeNull();
    expect(path.landIndex).toBe(BRANCH_END);
  });

  it("bot 辅路入口抉择保留:AwaitingBranch 下 botAct 二选一均推进(辅路=待入+回合结束)", () => {
    const e = makeEngine(5, [
      { name: "A", isBot: true, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
    ]);
    finishSetup(e);
    const p = e.activePlayer;
    p.position = BRANCH_START;
    p.onBranch = null;
    e.turnPhase = "AwaitingBranch";
    botAct(e);
    const tp: string = e.turnPhase;
    const ob = p.onBranch as { step: number } | null; // 经显式联合重置窄化(赋值 null 的窄化不随 botAct 失效)
    expect(tp).not.toBe("AwaitingBranch"); // 抉择已消化
    if (ob != null) {
      // 选了辅路:待入状态 + 本回合结束
      expect(ob.step).toBe(-1);
      expect(tp).toBe("Roll");
      expect(e.activePlayer).not.toBe(p);
    }
    // 选了大路:入口按普通城落格(许昌无主 → 可购买决策)
    else expect(tp).toBe("AwaitingDecision");
  });
});


describe("decisionOwner(决策归属统一查询)", () => {
  it("常规相位 = activeIndex(Roll/Land/AwaitingDecision)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.turnPhase = "Roll";
    expect(e.decisionOwner).toBe(e.activeIndex);
    e.turnPhase = "AwaitingDecision";
    expect(e.decisionOwner).toBe(e.activeIndex);
  });

  it("AwaitingTreasureOwner = 城主座位(≠ 访客)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const owner = e.players.find((p) => p !== mover)!;
    const ownerIdx = e.players.indexOf(owner);
    const def = e.catalog.get("prop-changan")!;
    e.treasureVisitor = { def, ownerIdx };
    e.turnPhase = "AwaitingTreasureOwner";
    expect(e.decisionOwner).toBe(ownerIdx);
    expect(e.decisionOwner).not.toBe(e.activeIndex);
  });

  it("AwaitingTreasureOwner 且 treasureVisitor 缺失 → 兜底 activeIndex(不崩)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.treasureVisitor = null;
    e.turnPhase = "AwaitingTreasureOwner";
    expect(e.decisionOwner).toBe(e.activeIndex);
  });
});

describe("地产规则(等级 Lv0-3 共 4 级 / 购入即 Lv0 / 无过路费升级费)", () => {
  it("购买:获 holding Lv0", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.type === "Property" && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    mover.position = tile.index;
    mover.warrants = 1;
    e.turnPhase = "Land";
    (e as unknown as { resolveLanding: () => void }).resolveLanding();
    expect(e.turnPhase as string).toBe("AwaitingDecision");
    e.buyProperty();
    expect(mover.properties.find((x) => x.propertyId === def.id)!.level).toBe(0);
  });

  it("到达他人城池:不升级(无珍宝 → 无事发生,双方现金不变)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.type === "Property" && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    const owner = e.players.find((p) => p !== mover)!;
    owner.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    mover.position = tile.index;
    const cash0 = mover.cash;
    e.turnPhase = "Land";
    (e as unknown as { resolveLanding: () => void }).resolveLanding();
    // 城主无珍宝 → 无事发生;等级不变(升级只挂在公道买卖成交上)
    expect(owner.properties.find((x) => x.propertyId === def.id)!.level).toBe(0);
    expect(mover.cash).toBe(cash0);
    expect(e.turnPhase as string).toBe("Roll"); // endTurn 已推进
  });

  it("公道买卖成交:城池 +1 级;坐地起价/不交易不升级", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.type === "Property" && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    const owner = e.players.find((p) => p !== mover)!;
    owner.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    const holding = () => owner.properties.find((x) => x.propertyId === def.id)!;
    /** 手工置 AwaitingTreasureOwner(endTurn 会推进 activeIndex,每步拨回访客)。 */
    const armTrade = (treasureId: string) => {
      e.activeIndex = e.players.indexOf(mover);
      e.treasureVisitor = { def, ownerIdx: e.players.indexOf(owner) };
      e.turnPhase = "AwaitingTreasureOwner";
      owner.treasures.push({ id: treasureId, name: "测试珍宝", level: 1, count: 1, desc: "" });
    };

    // fair:成交 → Lv0→1,访客得宝
    armTrade("t-fair");
    e.resolveTreasureOwner({ type: "fair", treasureId: "t-fair" });
    expect(holding().level).toBe(1);
    expect(mover.treasures).toHaveLength(1);

    // premium:不升级
    armTrade("t-premium");
    e.resolveTreasureOwner({ type: "premium", treasureId: "t-premium" });
    expect(holding().level).toBe(1);

    // skip:不升级
    armTrade("t-skip");
    e.resolveTreasureOwner({ type: "skip" });
    expect(holding().level).toBe(1);
  });

  it("自己到达己城:扩军免费(现金不变)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const me = e.activePlayer;
    const capDef = e.catalog.get(e.board.at(me.capitalIndex).propertyId)!;
    const tile = e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capDef.id && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    me.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    me.position = tile.index;
    e.turnPhase = "Land";
    (e as unknown as { resolveLanding: () => void }).resolveLanding();
    expect(e.turnPhase as string).toBe("AwaitingDecision");
    const cash0 = me.cash;
    e.upgradeProperty();
    expect(me.properties.find((x) => x.propertyId === def.id)!.level).toBe(1);
    expect(me.cash).toBe(cash0); // 升级免费
  });
});
