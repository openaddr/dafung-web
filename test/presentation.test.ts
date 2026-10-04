// 事件批直译单测(#385,ADR-0020 折叠切换③):extractBatchEvents 把引擎事件批
// (core/game-events.ts 词汇)直译为表现事件;提取与播放分离——播放器 present 经
// memorySink 断言顺序(不测 DOM/音频细节,生产 sink 由 e2e react-solo/online 覆盖)。
// ADR-0015 城池宣告同管道可断言;映射缺口(无事件可表达的演出)在用例里钉 contract,
// 主线补事件后此处应随行改写。
import { describe, it, expect, beforeEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { ENCOUNTERS } from "@core/encounters";
import { beginGameEventBatch, type GameEvent } from "@core/game-events";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { extractBatchEvents } from "../src/app/fx/event-extract";
import { present, resetFxOrchestration } from "../src/app/fx/orchestrator";
import { createMemorySink } from "../src/app/fx/sinks";
import { useFxStore } from "../src/app/fx/fxStore";
import type { PresentationEvent } from "../src/app/fx/presentation";
import { testEngine } from "@core/testing";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[], targetNetWorth = 8000): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(人类选第一个空城,bot 自动;照 game.test.ts 的构造方式)。 */
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
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 发牌时已入相位的话放行
}

/** 事件批直译的调用形态:推进前捕获锚定基准,run() 推进后直译引擎当前批。 */
function stepEvents(e: GameEngine, run: () => void): PresentationEvent[] {
  const pre = e.players.map((p) => p.position as number | null);
  run();
  return extractBatchEvents(e, e.gameEvents, pre);
}

function kinds(events: PresentationEvent[]): string[] {
  return events.map((ev) => ev.kind);
}

beforeEach(() => {
  resetFxOrchestration(); // 跨批游标(锦囊宣布)与表现 store 归零
});

// ─────────────── 事件批直译:引擎真实转移批 ───────────────
describe("事件批直译 extractBatchEvents(引擎真实转移)", () => {
  it("rollAndMove:掷骰事件带头(die=引擎 lastRoll),行军紧随;事件顺序=骰子→行军→浮字", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const events = stepEvents(e, () => e.submitCommand({ type: "rollAndMove" }));
    const die = e.presentation.lastRoll!.die;
    expect(events[0]).toEqual({ kind: "diceRolled", die, fast: false });
    if (e.presentation.lastMove) {
      expect(events[1].kind).toBe("tokenMoved");
      if (events[1].kind === "tokenMoved") {
        expect(events[1].path.from).toBe(e.presentation.lastMove.from);
        expect(events[1].path.landIndex).toBe(e.presentation.lastMove.landIndex);
      }
    }
    const ks = kinds(events);
    if (ks.includes("tokenMoved")) {
      expect(ks.indexOf("diceRolled")).toBeLessThan(ks.indexOf("tokenMoved"));
    }
    expect(ks.indexOf("diceRolled")).toBe(0);
  });

  it("必停都城:capitalHalt 事件自带行军(引擎此态不发 marchArrived),lastMove 截断到都城", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const p = e.activePlayer;
    testEngine(e).placeActive((p.capitalIndex - 2 + e.board.count) % e.board.count); // 距都城 2 步:die>=3 必停
    const events = stepEvents(e, () => e.submitCommand({ type: "rollAndMove" }));
    expect(events[0].kind).toBe("diceRolled");
    if (e.presentation.lastRoll!.die >= 3) {
      expect(p.position).toBe(p.capitalIndex);
      const march = events.find((ev) => ev.kind === "tokenMoved");
      expect(march).toBeDefined();
      if (march?.kind === "tokenMoved") {
        expect(march.path.landIndex).toBe(p.capitalIndex);
        expect(march.path.traversed[march.path.traversed.length - 1]).toBe(p.capitalIndex);
      }
      // 驻跸三件套顺序:行军 → 驻章 → 文案 → 补给铜钱雨(先盖章再铜钱雨)
      const ks = kinds(events);
      expect(ks).toContain("supplyRain");
      expect(ks.indexOf("tokenMoved")).toBeLessThan(ks.indexOf("sealStamped"));
      expect(ks.indexOf("sealStamped")).toBeLessThan(ks.indexOf("textFloat"));
      expect(ks.indexOf("textFloat")).toBeLessThan(ks.indexOf("supplyRain"));
    }
  });

  it("恰落己都城:无 capitalHalt 事件,驻跸章/文案由落点=己都城直读", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const p = e.activePlayer;
    testEngine(e).placeActive((p.capitalIndex - 1 + e.board.count) % e.board.count); // 恰需 1 步落都城
    const events = stepEvents(e, () => e.submitCommand({ type: "rollAndMove" }));
    if (e.presentation.lastRoll!.die !== 1) return; // 未恰落(落点结算路径不同):不作断言
    expect(p.position).toBe(p.capitalIndex);
    const seal = events.find((ev) => ev.kind === "sealStamped");
    expect(seal).toBeDefined();
    if (seal?.kind === "sealStamped") {
      expect(seal.char).toBe("驻");
      expect(seal.tileIndex).toBe(p.capitalIndex);
    }
    const text = events.find((ev) => ev.kind === "textFloat");
    expect(text).toBeDefined();
    if (text?.kind === "textFloat") expect(text.text).toBe("驻跸补给");
  });

  it("买城成功(ADR-0015):据章 → buy 音 → 宣告(易主维度)→ 价款浮字", () => {
    const e = makeEngine(7, undefined, 999999); // 大目标:防 endTurn 提前终局干扰常规路径
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 99999;
    const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null)!;
    testEngine(e).landActiveAt(tile.index); // 无主可购格 → AwaitingDecision(PropertyAvailable)
    if (e.turnPhase !== "AwaitingDecision") return; // 地图数据不符(理论不可达)才空转
    const def = e.catalog.get(tile.propertyId!)!;
    const events = stepEvents(e, () => e.submitCommand({ type: "buyProperty" }));
    const ks = kinds(events);
    expect(ks).toContain("sealStamped");
    expect(ks).toContain("propertyChanged");
    const seal = events.find((ev) => ev.kind === "sealStamped");
    if (seal?.kind === "sealStamped") {
      expect(seal.char).toBe("据");
      expect(seal.tileIndex).toBe(tile.index);
    }
    const pcIdx = ks.indexOf("propertyChanged");
    const pc = events[pcIdx];
    if (pc.kind === "propertyChanged") {
      expect(pc.tileIndex).toBe(tile.index);
      expect(pc.level).toBe(0); // 购入为 Lv.0:易主维度,等级不变
      expect(pc.levelChanged).toBe(false);
      expect(pc.ownerChanged).toBe(true);
      expect(pc.ownerColorIndex).toBe(0);
    }
    // 相对序:据章 → buy 音 → 宣告(音效在前、宣告紧随)→ 价款浮字
    expect(ks.indexOf("sealStamped")).toBeLessThan(ks.indexOf("sound"));
    expect(pcIdx).toBeGreaterThan(ks.indexOf("sound"));
    const priceFloater = events.find(
      (ev) =>
        (ev.kind === "cashDelta" || ev.kind === "supplyRain") && ev.amount === -def.purchasePrice,
    );
    expect(priceFloater).toBeDefined();
    expect(pcIdx).toBeLessThan(ks.indexOf("cashDelta"));
    // 铜钱声每批至多一次,且只缀在正收入浮字前(购地纯支出:无铜钱声)
    expect(ks.filter((k) => k === "sound").length).toBe(1);
  });

  it("决策被拒(委任状不足):无据章/buy 音/宣告(零兜底:无成交事件不播出)", () => {
    const e = makeEngine(7, undefined, 999999);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 99999; // 现金充足,决策照常给出
    p.warrants = 0; // 委任状不足 → buyProperty 被拒(NoWarrant)
    const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null)!;
    testEngine(e).landActiveAt(tile.index);
    if (e.turnPhase !== "AwaitingDecision") return; // 引擎未给决策(理论不可达)才空转
    const events = stepEvents(e, () => e.submitCommand({ type: "buyProperty" }));
    const ks = kinds(events);
    expect(ks).not.toContain("sealStamped");
    expect(ks).not.toContain("propertyChanged");
    expect(events.some((ev) => ev.kind === "sound" && ev.event === "buy")).toBe(false);
  });

  it("扩军成功(ADR-0015):upgrade 音在前、宣告紧随(等级维度)", () => {
    const e = makeEngine(7, undefined, 999999);
    finishSetup(e);
    const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null)!;
    const propId = tile.propertyId;
    if (propId == null) return;
    e.activePlayer.properties.push({
      propertyId: propId,
      group: "g",
      purchasePrice: 100,
      level: 1,
      maxLevel: 3,
    });
    testEngine(e).landActiveAt(tile.index); // 己城可扩 → AwaitingDecision(OwnProperty)
    if (e.turnPhase !== "AwaitingDecision") return;
    const events = stepEvents(e, () => e.submitCommand({ type: "upgradeProperty" }));
    const ks = kinds(events);
    const si = events.findIndex((ev) => ev.kind === "sound" && ev.event === "upgrade");
    expect(si).toBeGreaterThanOrEqual(0);
    const pi = ks.indexOf("propertyChanged");
    expect(pi).toBeGreaterThan(si); // 音效在前、宣告紧随(ADR-0015 排序约定)
    const pc = events[pi];
    if (pc.kind === "propertyChanged") {
      expect(pc.tileIndex).toBe(tile.index);
      expect(pc.level).toBe(2); // Lv1 → Lv2
      expect(pc.levelChanged).toBe(true);
      expect(pc.ownerChanged).toBe(false);
      expect(pc.ownerColorIndex).toBe(0);
    }
    expect(ks).not.toContain("sealStamped"); // 扩军不盖章(「据」章是买城的)
  });

  it("破产清算:变卖批出所得浮字;确认批 assetTransferred → 逐城易主宣告(#385 缺口闭合)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const capTile = e.board.at(p.capitalIndex);
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" });
    testEngine(e).payOrLiquidate(p, null, 500); // 窄口触达私有清算入口
    if (e.turnPhase !== "AwaitingBankruptcySettle") return; // 未入清算相位(理论不可达)才空转
    const sellEvents = stepEvents(e, () =>
      e.submitCommand({ type: "sellTreasureBankruptcy", treasureId: "t1" }),
    );
    // 变卖批:assetLiquidated(treasure) → 所得浮字(正收入,铜钱声缀首)
    expect(sellEvents.some((ev) => ev.kind === "sound" && ev.event === "coin")).toBe(true);
    expect(kinds(sellEvents)).toContain("cashDelta");
    const settleEvents = stepEvents(e, () => e.submitCommand({ type: "confirmBankruptcySettle" }));
    expect(p.isBankrupt).toBe(true);
    // 破产批:清算资产逐城易主(#385)→ 易主宣告(都城回无主,归属色=null);
    // playerBankrupt → bankrupt 音;末位独存即终局,gameOver → victory 压轴。
    const pc = settleEvents.find((ev) => ev.kind === "propertyChanged");
    expect(pc).toBeDefined();
    if (pc?.kind === "propertyChanged") {
      expect(pc.tileIndex).toBe(capTile.index);
      expect(pc.ownerChanged).toBe(true);
      expect(pc.ownerColorIndex).toBeNull(); // 无债主:回无主
      expect(pc.levelChanged).toBe(false);
    }
    expect(settleEvents.some((ev) => ev.kind === "sound" && ev.event === "bankrupt")).toBe(true);
    expect(settleEvents[settleEvents.length - 1]).toEqual({ kind: "sound", event: "victory" });
  });

  it("浮字事件携带提取期解析的逻辑坐标(锚玩家位置)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const events = stepEvents(e, () => e.submitCommand({ type: "rollAndMove" }));
    for (const ev of events) {
      if (ev.kind === "cashDelta" || ev.kind === "supplyRain") {
        expect(Number.isFinite(ev.x)).toBe(true);
        expect(Number.isFinite(ev.y)).toBe(true);
        expect(typeof ev.playerId).toBe("string");
      }
    }
  });

  it("购地被拒(#385 缺口闭合):自动不取产 propertyRejected → 文案浮字「银两不足,未能购城」", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    p.cash = def.purchasePrice - 1;
    p.warrants = 3;
    const pre = e.players.map((pl) => pl.position as number | null);
    beginGameEventBatch(e);
    testEngine(e).landActiveAt(tile.index); // 窄口:摆位 + Land + 私有落格结算
    const events = extractBatchEvents(e, e.gameEvents, pre);
    const text = events.find((ev) => ev.kind === "textFloat");
    expect(text).toBeDefined();
    if (text?.kind === "textFloat") {
      expect(text.text).toBe("银两不足,未能购城");
      expect(text.playerId).toBe(p.id);
    }
  });

  it("购地被拒(委任状不足,#385):文案浮字「无委任状,不可购」", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null)!;
    p.cash = 99999;
    p.warrants = 0;
    const pre = e.players.map((pl) => pl.position as number | null);
    beginGameEventBatch(e);
    testEngine(e).landActiveAt(tile.index);
    const events = extractBatchEvents(e, e.gameEvents, pre);
    const text = events.find((ev) => ev.kind === "textFloat");
    expect(text).toBeDefined();
    if (text?.kind === "textFloat") expect(text.text).toBe("无委任状,不可购");
  });

  it("辅路落位行军(#385 缺口闭合):marchArrived 带辅路路径 → tokenMoved 沿辅路坐标序列", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const branchStart = MAP.board.tiles.findIndex((tile) => tile.name === "许昌"); // 辅路起点
    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(e.board.branch).not.toBeNull();
    testEngine(e).placeActive(branchStart);
    p.onBranch = { step: -1 }; // 待入辅路:本回合掷骰沿辅路推进
    const events = stepEvents(e, () => e.submitCommand({ type: "rollAndMove" }));
    const march = events.find((ev) => ev.kind === "tokenMoved");
    expect(march).toBeDefined(); // 辅路落位必有行军动画(旧行为:无事件不播)
    if (march?.kind === "tokenMoved") {
      if (march.path.landBranchStep == null) return; // 骰步溢出汇入主路:另案口径
      expect(march.path.branchWaypoints.length).toBeGreaterThan(0);
      expect(march.path.branchWaypoints[0]).toEqual(e.board.branch!.cells[0].position);
    }
    expect(kinds(events)).not.toContain("sealStamped"); // 辅路格不参与驻跸章
  });
});

// ─────────────── 事件批直译:合成批的映射表 ───────────────
/** 合成事件批直译(不跑引擎转移,纯映射表钉死):座位取 0/1,坐标按引擎现算。 */
function synth(e: GameEngine, events: GameEvent[]): PresentationEvent[] {
  return extractBatchEvents(
    e,
    events,
    e.players.map((p) => p.position as number | null),
  );
}

describe("事件→动效映射表(合成批)", () => {
  const E = () => makeEngine(7);

  it("cashChanged:负向=金额浮字;正向=浮字且批内先缀一声铜钱;supply=铜钱雨", () => {
    const e = E();
    const out = synth(e, [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -200, reason: "tax" },
      { kind: "cashChanged", seat: 1, round: 1, turn: 1, delta: 300, reason: "supply" },
    ]);
    const pos0 = e.board.positionOf(e.players[0].position);
    const pos1 = e.board.positionOf(e.players[1].position);
    expect(out).toEqual([
      { kind: "sound", event: "coin" }, // 首个正收入浮字前缀一声
      {
        kind: "cashDelta",
        playerId: e.players[0].id,
        amount: -200,
        x: pos0.x,
        y: pos0.y,
        atTile: e.players[0].position,
      },
      {
        kind: "supplyRain",
        playerId: e.players[1].id,
        amount: 300,
        x: pos1.x,
        y: pos1.y,
        atTile: e.players[1].position,
      },
    ]);
  });

  it("treasureGained/traded/bankrupt/gameOver:语义音效直通", () => {
    const e = E();
    expect(
      synth(e, [{ kind: "treasureGained", seat: 0, round: 1, turn: 1, treasureId: "t1" }]),
    ).toEqual([{ kind: "sound", event: "treasure" }]);
    // 交割两清:铜钱声 → 买家付款浮字 → 卖家收款浮字(正收入缀声排在批内首个浮字前)
    expect(
      synth(e, [
        {
          kind: "treasureTraded",
          seat: 0,
          round: 1,
          turn: 1,
          buyerSeat: 0,
          sellerSeat: 1,
          treasureId: "t",
          price: 120,
        },
      ]).map((ev) =>
        ev.kind === "cashDelta" ? ev.amount : ev.kind === "sound" ? "coin" : ev.kind,
      ),
    ).toEqual(["coin", -120, 120]);
    expect(
      synth(e, [{ kind: "playerBankrupt", seat: 1, round: 1, turn: 1, creditorSeat: null }]),
    ).toEqual([{ kind: "sound", event: "bankrupt" }]);
    expect(
      synth(e, [{ kind: "gameOver", seat: 0, round: 1, turn: 1, reason: "TargetNetWorth" }]),
    ).toEqual([{ kind: "sound", event: "victory" }]);
  });

  it("capitalSelected:筑章 + 建城宣告(易主维度);assetLiquidated(property):浮字 + 回无主宣告", () => {
    const e = E();
    const cap = e.players[0].capitalIndex;
    const capProp = e.board.at(cap).propertyId!;
    // 直译按提取时刻引擎态解析归属:先落持有(建城后玩家 0 持有都城)
    e.players[0].properties.push({
      propertyId: capProp,
      group: "g",
      purchasePrice: 100,
      level: 0,
      maxLevel: 3,
    });
    const out = synth(e, [
      {
        kind: "capitalSelected",
        seat: 0,
        round: 0,
        turn: 0,
        tileIndex: cap,
        propertyId: capProp,
        cost: 100,
      },
    ]);
    expect(out[0]).toEqual({ kind: "sealStamped", tileIndex: cap, char: "筑" });
    if (out[1].kind === "propertyChanged") {
      expect(out[1].ownerChanged).toBe(true);
      expect(out[1].levelChanged).toBe(false);
      expect(out[1].ownerColorIndex).toBe(0);
    } else {
      throw new Error("capitalSelected 应产建城宣告");
    }
    // 变卖:持有离手(回无主),直译按无归属解析;正收入浮字先缀一声铜钱
    e.players[0].properties = [];
    const out2 = synth(e, [
      {
        kind: "assetLiquidated",
        seat: 0,
        round: 1,
        turn: 1,
        asset: { kind: "property", id: capProp },
        amount: 200,
      },
    ]);
    expect(out2.map((ev) => ev.kind)).toEqual(["sound", "cashDelta", "propertyChanged"]);
    if (out2[2].kind === "propertyChanged") {
      expect(out2[2].ownerColorIndex).toBeNull(); // 变卖给银行=回无主
      expect(out2[2].ownerChanged).toBe(true);
    } else {
      throw new Error("变卖城池应产回无主宣告");
    }
  });

  it("turnStarted:横幅取座位国号/色;合并批多 turnStarted 只弹最后一面", () => {
    const e = E();
    const one = synth(e, [{ kind: "turnStarted", seat: 1, round: 1, turn: 2 }]);
    expect(one).toEqual([
      { kind: "turnBanner", guohao: e.players[1].guohao, colorIndex: e.players[1].colorIndex },
    ]);
    const merged = synth(e, [
      { kind: "turnStarted", seat: 0, round: 1, turn: 2 },
      { kind: "turnStarted", seat: 1, round: 1, turn: 3 },
    ]);
    expect(merged).toEqual([
      { kind: "turnBanner", guohao: e.players[1].guohao, colorIndex: e.players[1].colorIndex },
    ]);
  });

  it("stamina/reputation/jinnangDrawn/turnSkipped/heroRecruited:文案浮字按事件字段直读", () => {
    const e = E();
    const out = synth(e, [
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: -40, reason: "encounter" },
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 100, reason: "exhaustion" },
      { kind: "reputationChanged", seat: 0, round: 1, turn: 1, delta: 20, reason: "fate" },
      { kind: "jinnangDrawn", seat: 0, round: 1, turn: 1, count: 1, reason: "jinnangTile" },
      { kind: "turnSkipped", seat: 1, round: 1, turn: 1 },
      { kind: "heroRecruited", seat: 0, round: 1, turn: 1, heroId: "zhouyu" },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "体力 −40",
      "体力耗竭,跳过一回合",
      "天命眷顾,声望 +20",
      "抽一张锦囊",
      "被跳过一回合",
      "周瑜 来投",
    ]);
  });

  it("座位契约校验:座位型事件缺有效座位当场炸出(零兜底)", () => {
    const e = E();
    expect(() =>
      synth(e, [{ kind: "cashChanged", seat: null, round: 1, turn: 1, delta: -1, reason: "tax" }]),
    ).toThrow();
  });
});

// ─────────────── 事件→动效映射表(#385 缺口闭合)───────────────
describe("事件→动效映射表(#385 缺口闭合)", () => {
  const E = () => makeEngine(7);

  it("propertyRejected:三种 reason → 引擎同口径文案浮字(缺口 1)", () => {
    const e = E();
    const out = synth(e, [
      {
        kind: "propertyRejected",
        seat: 0,
        round: 1,
        turn: 1,
        propertyId: "x",
        reason: "no-warrant",
      },
      {
        kind: "propertyRejected",
        seat: 0,
        round: 1,
        turn: 1,
        propertyId: "x",
        reason: "insufficient-cash",
      },
      { kind: "propertyRejected", seat: 0, round: 1, turn: 1, propertyId: "x", reason: "maxed" },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "无委任状,不可购",
      "银两不足,未能购城",
      "城已满级,按兵不动",
    ]);
  });

  it("assetTransferred:逐城易主宣告(缺口 2)——承让方持有时归属色随提取时刻态,回无主=null", () => {
    const e = E();
    const tile = e.board.tiles.find(
      (t) => t.propertyId != null && t.index !== e.players[0].capitalIndex,
    )!;
    const propId = tile.propertyId!;
    // 承让方已持有(提取时刻态):宣告归属色=承让方
    e.players[1].properties.push({
      propertyId: propId,
      group: "g",
      purchasePrice: 100,
      level: 1,
      maxLevel: 3,
    });
    const taken = synth(e, [
      { kind: "assetTransferred", seat: 0, round: 1, turn: 1, propertyId: propId, toSeat: 1 },
    ]);
    expect(taken.map((ev) => ev.kind)).toEqual(["propertyChanged"]);
    if (taken[0].kind === "propertyChanged") {
      expect(taken[0].tileIndex).toBe(tile.index);
      expect(taken[0].ownerColorIndex).toBe(1);
      expect(taken[0].ownerChanged).toBe(true);
      expect(taken[0].levelChanged).toBe(false);
    }
    // 回无主(持有离手后提取):归属色=null
    e.players[1].properties = [];
    const released = synth(e, [
      { kind: "assetTransferred", seat: 0, round: 1, turn: 1, propertyId: propId, toSeat: null },
    ]);
    if (released[0].kind === "propertyChanged") expect(released[0].ownerColorIndex).toBeNull();
    else throw new Error("assetTransferred 应产易主宣告");
  });

  it("reactionFailed:拦检失败文案浮字锚拦检城,掷点参数拼装(缺口 5)", () => {
    const e = E();
    const out = synth(e, [
      {
        kind: "reactionFailed",
        seat: 1,
        round: 1,
        turn: 1,
        windowKind: "march",
        tileIndex: 5,
        aRoll: 2,
        bRoll: 5,
      },
    ]);
    expect(out).toEqual([
      {
        kind: "textFloat",
        playerId: e.players[1].id,
        text: "拦检失败(掷 2 对 5)",
        x: e.board.positionOf(5).x,
        y: e.board.positionOf(5).y,
        atTile: 5,
      },
    ]);
  });

  it("jinnangInflicted / treasureStolen / encounterChoice:文案浮字按事件字段直读(缺口 5/6)", () => {
    const e = E();
    const def = ENCOUNTERS.find((c) => c.choices != null && c.choices.length >= 2)!;
    const out = synth(e, [
      { kind: "jinnangInflicted", seat: 0, round: 1, turn: 1, cardId: "缓兵之计", targetSeat: 1 },
      {
        kind: "treasureStolen",
        seat: 0,
        round: 1,
        turn: 1,
        victimSeat: 1,
        treasureId: "seal-1",
        treasureName: "传国玉玺",
      },
      { kind: "encounterChoice", seat: 0, round: 1, turn: 1, encounterId: def.id, choiceIndex: 0 },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "中【缓兵之计】,下回合无法行动",
      "窃得「蜀」的「传国玉玺」",
      def.choices![0].text,
    ]);
  });

  it("encounterChoice 静态目录案:事件不带成品文案,查表缺失当场炸出(缺口 6 零兜底)", () => {
    const e = E();
    expect(() =>
      synth(e, [
        {
          kind: "encounterChoice",
          seat: 0,
          round: 1,
          turn: 1,
          encounterId: "不存在",
          choiceIndex: 0,
        },
      ]),
    ).toThrow();
  });

  it("耗竭处置(缺口 6):批内前置 exhaustionChoice → staminaChanged 文案带处置明细,恒一条", () => {
    const e = E();
    const tile = e.board.tiles.find((t) => t.propertyId != null)!;
    const propId = tile.propertyId!;
    const name = e.board.at(tile.index).name;
    const downgrade = synth(e, [
      {
        kind: "exhaustionChoice",
        seat: 0,
        round: 1,
        turn: 1,
        propertyId: propId,
        exhaustionKind: "downgrade",
      },
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 100, reason: "exhaustion" },
    ]);
    expect(downgrade.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      `体力耗竭:「${name}」降 1 级,倒地不起(跳过一回合)`,
    ]);
    const lose = synth(e, [
      {
        kind: "exhaustionChoice",
        seat: 1,
        round: 1,
        turn: 1,
        propertyId: propId,
        exhaustionKind: "lose",
      },
      { kind: "staminaChanged", seat: 1, round: 1, turn: 1, delta: 100, reason: "exhaustion" },
    ]);
    expect(lose.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      `体力耗竭:「${name}」失去城池,倒地不起(跳过一回合)`,
    ]);
    // 孤立 staminaChanged(无可处置自动路径):维持缺省口径(既有合成批用例同款)
    const lone = synth(e, [
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 100, reason: "exhaustion" },
    ]);
    expect(lone.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "体力耗竭,跳过一回合",
    ]);
  });

  it("cashChanged(reason=skill):被动技得银按既有金额浮字口径播出(缺口 5)", () => {
    const e = E();
    const out = synth(e, [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: 50, reason: "skill" },
    ]);
    expect(out.map((ev) => ev.kind)).toEqual(["sound", "cashDelta"]); // 正收入缀铜钱声
  });

  it("合并批多段行军(缺口 3):各 marchArrived 自带路径,两段各播各段", () => {
    const e = E();
    const from0 = e.players[0].position;
    const from1 = e.players[1].position;
    const path0 = e.board.computePath(from0, 2, e.players[0].capitalIndex, null);
    const path1 = e.board.computePath(from1, 3, e.players[1].capitalIndex, null);
    testEngine(e).place(0, path0.landIndex); // 快照终态:两段行军均已落位
    testEngine(e).place(1, path1.landIndex);
    const out = extractBatchEvents(
      e,
      [
        {
          kind: "marchArrived",
          seat: 0,
          round: 1,
          turn: 1,
          tileIndex: path0.landIndex,
          path: path0,
        },
        {
          kind: "marchArrived",
          seat: 1,
          round: 1,
          turn: 1,
          tileIndex: path1.landIndex,
          path: path1,
        },
      ],
      [from0, from1], // 转移前位置=各自路径起点
    );
    const marches = out.filter(
      (ev): ev is Extract<PresentationEvent, { kind: "tokenMoved" }> => ev.kind === "tokenMoved",
    );
    expect(marches).toHaveLength(2); // 旧行为:非末段依赖 lastMove 单槽,只有末段能播
    expect(marches[0].path.landIndex).toBe(path0.landIndex);
    expect(marches[1].path.landIndex).toBe(path1.landIndex);
  });

  it("反应窗余段截短逻辑保持:事件内路径 + 挂起点前置位置 → 余段 tokenMoved", () => {
    const e = E();
    const mover = e.players[0];
    const from = mover.position;
    const path = e.board.computePath(from, 4, mover.capitalIndex, null);
    const ambushTile = path.traversed[1]; // 挂起点:途经第 2 格
    testEngine(e).place(0, path.landIndex); // 快照终态:已落格
    const out = extractBatchEvents(
      e,
      [{ kind: "marchArrived", seat: 0, round: 1, turn: 1, tileIndex: path.landIndex, path }],
      [ambushTile].concat(e.players.slice(1).map(() => 0)), // 转移前位置=挂起点(拦检止步处)
    );
    const march = out.find(
      (ev): ev is Extract<PresentationEvent, { kind: "tokenMoved" }> => ev.kind === "tokenMoved",
    );
    expect(march).toBeDefined();
    if (march != null) {
      expect(march.path.from).toBe(ambushTile); // 不拽回起点:自挂起点续走
      expect(march.path.traversed).toEqual(path.traversed.slice(2));
    }
  });
});

// ─────────────── 出牌指示线(事件批口径)───────────────
/** 军师幕出牌步骤(横征暴敛=A面全体域):提取事件含 jinnangPlayed(jinnangAnnounced 直译)。 */
function extractLevyStep(seed = 7): { e: GameEngine; events: PresentationEvent[] } {
  const e = makeEngine(seed);
  finishSetup(e);
  e.drawJinnang(0, 0); // 活跃玩家摸一张(目录首张=连环计,会被下面覆盖)
  e.activePlayer.jinnangHand = ["横征暴敛"];
  e.activePlayer.jinnangHandCount = 1;
  e.turnPhase = "AwaitingJinnang";
  for (const other of e.players) {
    if (other === e.activePlayer) continue;
    other.jinnangHand = []; // 清他座反应牌:不开窗,直接结算(#281 口径)
    other.jinnangHandCount = 0;
  }
  const events = stepEvents(e, () => e.submitCommand({ type: "useJinnang", cardId: "横征暴敛" }));
  return { e, events };
}

describe("出牌指示线(#281/P2-E,事件批直译)", () => {
  it("全体域出牌:每名其他存活者一段线,端点=使用者/目标棋盘坐标;线先于文案浮字", () => {
    const { e, events } = extractLevyStep();
    const plays = events.filter((ev) => ev.kind === "jinnangPlayed");
    expect(plays.length).toBe(1);
    const play = plays[0];
    if (play.kind !== "jinnangPlayed") return; // 判别联合收窄
    const others = e.players.filter((p) => p !== e.players[0]);
    expect(play.lines.length).toBe(others.length);
    const from = e.board.positionOf(e.players[0].position);
    expect(play.lines[0]).toEqual({
      x1: from.x,
      y1: from.y,
      x2: e.board.positionOf(others[0].position).x,
      y2: e.board.positionOf(others[0].position).y,
    });
    const lineIdx = events.indexOf(play);
    const textIdx = events.findIndex((ev) => ev.kind === "textFloat");
    expect(textIdx).toBeGreaterThan(lineIdx); // 线指方向、字报其名
    if (events[textIdx]?.kind === "textFloat") {
      expect(events[textIdx].text).toContain("使用锦囊【横征暴敛】");
    }
  });

  it("无指向牌不出线:自身域(求贤令)无 jinnangAnnounced 线段", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.jinnangHand = ["求贤令"];
    e.activePlayer.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    for (const other of e.players) {
      if (other === e.activePlayer) continue;
      other.jinnangHand = [];
      other.jinnangHandCount = 0;
    }
    const events = stepEvents(e, () => e.submitCommand({ type: "useJinnang", cardId: "求贤令" }));
    expect(events.some((ev) => ev.kind === "jinnangPlayed")).toBe(false);
  });

  it("识破(AOE 拆份):jinnangVoided(shareSeat) 直译线=应答者→被保份,字报免于", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const events = synth(e, [
      { kind: "jinnangVoided", seat: 1, round: 1, turn: 1, cardId: "横征暴敛", shareSeat: 0 },
    ]);
    const play = events.find((ev) => ev.kind === "jinnangPlayed");
    expect(play).toBeDefined();
    if (play?.kind === "jinnangPlayed") {
      const from = e.board.positionOf(e.players[1].position);
      const to = e.board.positionOf(e.players[0].position);
      expect(play.lines[0]).toEqual({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
    const text = events.find((ev) => ev.kind === "textFloat");
    if (text?.kind === "textFloat") expect(text.text).toContain("免于【横征暴敛】");
  });

  it("识破(连环计全计作废):跨批宣布游标衔接——线指回被拆计使用者", () => {
    const e = makeEngine(7);
    finishSetup(e);
    // 批 1:使用者(座 0)宣布连环计(指向座 1)
    synth(e, [
      { kind: "jinnangAnnounced", seat: 0, round: 1, turn: 1, cardId: "连环计", targetSeats: [1] },
    ]);
    // 批 2:座 1 应答识破 → jinnangVoided(无 shareSeat)
    const out = synth(e, [{ kind: "jinnangVoided", seat: 1, round: 1, turn: 1, cardId: "连环计" }]);
    const play = out.find((ev) => ev.kind === "jinnangPlayed");
    expect(play).toBeDefined();
    if (play?.kind === "jinnangPlayed") {
      const from = e.board.positionOf(e.players[1].position);
      const to = e.board.positionOf(e.players[0].position);
      expect(play.lines[0]).toEqual({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
  });

  it("present 播放:jinnangPlayed 每段线一次 spawnJinnangLine(memorySink 逐段录制)", async () => {
    const { events } = extractLevyStep();
    const play = events.find((ev) => ev.kind === "jinnangPlayed");
    if (play == null || play.kind !== "jinnangPlayed") throw new Error("前置场景未产出指示线事件");
    const sink = createMemorySink();
    await present(events, sink);
    const lines = sink.calls.filter((c) => c.op === "jinnangLine");
    expect(lines.length).toBe(play.lines.length);
  });
});

// ─────────────── 播放器 present + memorySink(顺序=事件数组顺序)───────────────
describe("播放器 present + memorySink(顺序=事件数组顺序)", () => {
  it("串行播放:骰子 → 行军 → 浮字 → 横幅,顺序与事件数组一致", async () => {
    const sink = createMemorySink();
    await present(
      [
        { kind: "diceRolled", die: 5 },
        {
          kind: "tokenMoved",
          playerId: "p1",
          path: {
            from: 0,
            traversed: [1],
            landIndex: 1,
            passedCapital: false,
            capitalIndex: -1,
            waypoints: [],
            landBranchStep: null,
            branchWaypoints: [],
          },
        },
        { kind: "cashDelta", playerId: "p1", amount: -120, x: 10, y: 20, atTile: 1 },
        { kind: "turnBanner", guohao: "蜀", colorIndex: 1 },
      ],
      sink,
    );
    expect(sink.calls.map((c) => c.op)).toEqual(["dice", "march", "floater", "banner"]);
    expect(sink.calls[0]).toEqual({ op: "dice", die: 5 });
    expect(sink.calls[1]).toEqual({
      op: "march",
      playerId: "p1",
      path: {
        from: 0,
        traversed: [1],
        landIndex: 1,
        passedCapital: false,
        capitalIndex: -1,
        waypoints: [],
        landBranchStep: null,
        branchWaypoints: [],
      },
    });
    expect(sink.calls[2]).toEqual({ op: "floater", x: 10, y: 20, amount: -120, coins: false });
    expect(sink.calls[3]).toEqual({ op: "banner", guohao: "蜀", colorIndex: 1 });
  });

  it("supplyRain → coins=true;sound 事件直通", async () => {
    const sink = createMemorySink();
    await present(
      [
        { kind: "supplyRain", playerId: "p2", amount: 300, x: 1, y: 2, atTile: null },
        { kind: "sound", event: "treasure" },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      { op: "floater", x: 1, y: 2, amount: 300, coins: true },
      { op: "sound", event: "treasure" },
    ]);
  });

  it("textFloat → spawnTextFloater(无金额文案小字,ADR-0013)", async () => {
    const sink = createMemorySink();
    await present(
      [{ kind: "textFloat", playerId: "p1", text: "城已满级,按兵不动", x: 5, y: 6, atTile: null }],
      sink,
    );
    expect(sink.calls).toEqual([{ op: "textFloater", x: 5, y: 6, text: "城已满级,按兵不动" }]);
  });

  it("propertyChanged → announceTile(ADR-0015 城池宣告经 sink 直通)", async () => {
    const sink = createMemorySink();
    await present(
      [
        { kind: "sound", event: "upgrade" },
        {
          kind: "propertyChanged",
          tileIndex: 9,
          level: 2,
          ownerColorIndex: 1,
          levelChanged: true,
          ownerChanged: false,
        },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      { op: "sound", event: "upgrade" },
      {
        op: "announceTile",
        tileIndex: 9,
        level: 2,
        ownerColorIndex: 1,
        levelChanged: true,
        ownerChanged: false,
      },
    ]);
  });

  it("空事件数组:no-op", async () => {
    const sink = createMemorySink();
    await present([], sink);
    expect(sink.calls).toEqual([]);
  });
});

// ─────────────── 联机消费游标(SnapshotEffects × netStore lastEvents)───────────────
import { SnapshotEffects } from "../src/app/net/snapshot-effects";
import { useNetStore } from "../src/app/store/netStore";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SnapshotEffects 事件批消费游标(#385 联机通路)", () => {
  /** 计数 sink:只统计浮字落店(fxStore),不触音频/DOM。 */
  function floaterCount(): number {
    return useFxStore.getState().floaters.length;
  }

  it("一条 events 消息只消费一次:seq 游标去重,新 seq 才再播", async () => {
    useFxStore.getState().resetFx();
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    const batch: GameEvent[] = [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -5, reason: "tax" },
    ];
    useNetStore.getState().pushEventBatch(batch);
    fx.play(e.players.map((p) => p.position));
    await tick();
    expect(floaterCount()).toBe(1);
    fx.play(e.players.map((p) => p.position)); // 同一批重复通知:游标未动,不重播
    await tick();
    expect(floaterCount()).toBe(1);
    useNetStore.getState().pushEventBatch(batch); // 新批( seq+1):照播
    fx.play(e.players.map((p) => p.position));
    await tick();
    expect(floaterCount()).toBe(2);
  });

  it("dropStalledBatch:断线边界废弃在途暂存批,重连后不补播旧演出", async () => {
    useFxStore.getState().resetFx();
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    useNetStore
      .getState()
      .pushEventBatch([
        { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -5, reason: "tax" },
      ]);
    fx.dropStalledBatch(); // 断线:当前到达序标记已消费
    fx.play(e.players.map((p) => p.position));
    await tick();
    expect(floaterCount()).toBe(0);
  });
});

// ─────────────── fxStore 城池宣告记录(ADR-0015:nonce 单调,两维独立)───────────────
describe("fxStore 城池宣告记录(ADR-0015:nonce 单调,两维独立)", () => {
  it("扩军只推进 level 维,易主只推进 owner 维并携带新归属;他城互不干扰;resetFx 清空", () => {
    useFxStore.getState().resetFx();
    expect(useFxStore.getState().announces.get(5)).toBeUndefined();
    useFxStore.getState().announceTileChange(5, true, false, 0);
    expect(useFxStore.getState().announces.get(5)).toEqual({
      level: 1,
      owner: 0,
      ownerColorIndex: null,
    });
    useFxStore.getState().announceTileChange(5, false, true, 2); // 易主给玩家 2
    expect(useFxStore.getState().announces.get(5)).toEqual({
      level: 1,
      owner: 1,
      ownerColorIndex: 2,
    });
    useFxStore.getState().announceTileChange(5, false, true, null); // 回无主
    expect(useFxStore.getState().announces.get(5)).toEqual({
      level: 1,
      owner: 2,
      ownerColorIndex: null,
    });
    useFxStore.getState().announceTileChange(6, true, false, 1); // 他城宣告不串扰
    expect(useFxStore.getState().announces.get(5)).toEqual({
      level: 1,
      owner: 2,
      ownerColorIndex: null,
    });
    useFxStore.getState().resetFx();
    expect(useFxStore.getState().announces.get(5)).toBeUndefined();
  });
});

// ─────────────── remainingMarchPath(反应窗余段行军截短,#281 拦停/续走)───────────────
import { remainingMarchPath } from "../src/app/fx/orchestrator";
import type { MovePath } from "@core/board";

describe("remainingMarchPath(反应窗余段行军截短,#281 拦停/续走)", () => {
  const fullPath: MovePath = {
    from: 3,
    traversed: [4, 5, 6, 7],
    landIndex: 7,
    passedCapital: false,
    capitalIndex: -1,
    waypoints: [],
    landBranchStep: null,
    branchWaypoints: [],
  };

  it("拦停(挂起点=途格 #5):余段只含挂起点之后到落点(#7)", () => {
    const short = remainingMarchPath(fullPath, 5, 7);
    expect(short).toEqual({
      from: 5,
      traversed: [6, 7],
      landIndex: 7,
      passedCapital: false,
      capitalIndex: -1,
      waypoints: [],
      landBranchStep: null,
      branchWaypoints: [],
    });
  });

  it("挂起点=起点(from 格,traversed 不含起点):余段=全途格", () => {
    const short = remainingMarchPath(fullPath, 3, 7);
    expect(short?.traversed).toEqual([4, 5, 6, 7]);
    expect(short?.from).toBe(3);
  });

  it("链式窗(本次落点=途格 #6):截到本次落点为止", () => {
    const short = remainingMarchPath(fullPath, 4, 6);
    expect(short?.traversed).toEqual([5, 6]);
    expect(short?.landIndex).toBe(6);
  });

  it("无余段(挂起点即落点)返回 null;挂起点不在路径上=状态 bug 抛错", () => {
    expect(remainingMarchPath(fullPath, 7, 7)).toBeNull();
    expect(() => remainingMarchPath(fullPath, 99, 7)).toThrow();
  });
});
