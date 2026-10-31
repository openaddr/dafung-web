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
import { isCityType } from "@core/board";
import { beginGameEventBatch, type GameEvent } from "@core/game-events";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { anchorMarches, extractBatchEvents } from "../src/app/fx/event-extract";
import { finishPresentation, present, resetFxOrchestration } from "../src/app/fx/orchestrator";
import { createEngineSink, createMemorySink } from "../src/app/fx/sinks";
import { abandonMarch, animateMove, marchPos } from "../src/app/fx/useMarch";
import { useFxStore } from "../src/app/fx/fxStore";
import {
  isBlowout,
  type MarchSegmentFrames,
  type PresentationEvent,
} from "../src/app/fx/presentation";
import { testEngine, armHero } from "@core/testing";
import { HEROES } from "@core/heroes";

const MAP = loadMap(huanyouData);

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
        // 不变量①提取即定格(#608):首帧=路径起点中心,段数=实走格数
        const kf = events[1].keyframes;
        expect(kf.length).toBe(e.presentation.lastMove.traversed.length);
        expect(kf[0].points[0]).toEqual(e.board.positionOf(e.presentation.lastMove.from));
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
        // lastMove 截断到都城:末段流光终点=都城中心(几何提取拍烤死)
        const kf = march.keyframes;
        expect(kf[kf.length - 1].flow[kf[kf.length - 1].flow.length - 1]).toEqual(
          e.board.positionOf(p.capitalIndex),
        );
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
    // 铜钱声每批至多一次,且只缀在正收入浮字前(购地纯支出:无铜钱声);
    // 价款浮字的交易提示已由 buy 音承担,pay 被压制防双声(2026-10 音效审计)
    expect(ks.filter((k) => k === "sound").length).toBe(1);
    expect(events.some((ev) => ev.kind === "sound" && ev.event === "pay")).toBe(false);
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
    expect(settleEvents.some((ev) => ev.kind === "sound" && ev.event === "bankrupt")).toBe(false);
    // S7 破产仪式(#513):playerBankrupt → bankruptCeremony(倒旗/墨渍/撒币三拍由
    // sink 编排,三音随拍发起);末位独存即终局,gameOver → victory 压轴。
    const ceremony = settleEvents.find((ev) => ev.kind === "bankruptCeremony");
    expect(ceremony).toBeDefined();
    if (ceremony?.kind === "bankruptCeremony") {
      expect(ceremony.playerId).toBe(p.id);
      const pos = e.board.positionOf(p.position);
      expect(ceremony.x).toBe(pos.x);
      expect(ceremony.y).toBe(pos.y);
    }
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

  it("cashChanged:负向=金额浮字;正向=浮字且批内先缀一声铜钱;supply=铜钱雨;纳税随雨落币(S7)", () => {
    const e = E();
    const out = synth(e, [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -200, reason: "tax" },
      { kind: "cashChanged", seat: 1, round: 1, turn: 1, delta: 300, reason: "supply" },
    ]);
    const pos0 = e.board.positionOf(e.players[0].position);
    const pos1 = e.board.positionOf(e.players[1].position);
    expect(out).toEqual([
      { kind: "sound", event: "coin" }, // 首个正收入浮字前缀一声
      { kind: "sound", event: "pay" }, // 负向浮字对位缀一声付出(收叮付闷)
      {
        kind: "cashDelta",
        playerId: e.players[0].id,
        amount: -200,
        coins: true, // S7 铜钱雨扩容:纳税付银随雨落币(#513)
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

  it("cashChanged 纯负向批:pay 前缀、无铜钱声(收叮付闷,反馈对位);非税负向不带 coins", () => {
    const e = E();
    const out = synth(e, [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -200, reason: "tax" },
    ]);
    expect(out[0]).toEqual({ kind: "sound", event: "pay" });
    expect(out.some((ev) => ev.kind === "sound" && ev.event === "coin")).toBe(false);
    const plain = synth(e, [
      { kind: "cashChanged", seat: 0, round: 1, turn: 1, delta: -50, reason: "encounter" },
    ]);
    const floater = plain.find((ev) => ev.kind === "cashDelta");
    expect(floater).toMatchObject({ amount: -50, coins: false });
  });

  it("treasureGained:漆金「得」印钤宝物城 + treasure 音(S7 探宝拼点得半);traded/bankrupt/gameOver 直通", () => {
    const e = E();
    const gain = synth(e, [
      { kind: "treasureGained", seat: 0, round: 1, turn: 1, treasureId: "t1" },
    ]);
    const gainPos = e.board.positionOf(e.players[0].position);
    expect(gain[0]).toEqual({
      kind: "sealStamped",
      tileIndex: e.players[0].position,
      x: gainPos.x,
      y: gainPos.y,
      char: "得",
      tone: "gold",
    });
    expect(gain[1]).toEqual({ kind: "sound", event: "treasure" });
    // 交割两清:铜钱声 → 付出闷响(买家付款对位)→ 买家付款浮字 → 卖家收款浮字(缀声排在批内首个浮字前)
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
        ev.kind === "cashDelta" ? ev.amount : ev.kind === "sound" ? ev.event : ev.kind,
      ),
    ).toEqual(["coin", "pay", -120, 120]);
    // 破产(S7):仪式事件(三拍 sink 编排,extract 侧不再直出 bankrupt 音)
    expect(
      synth(e, [{ kind: "playerBankrupt", seat: 1, round: 1, turn: 1, creditorSeat: null }]),
    ).toEqual([
      {
        kind: "bankruptCeremony",
        playerId: e.players[1].id,
        x: e.board.positionOf(e.players[1].position).x,
        y: e.board.positionOf(e.players[1].position).y,
      },
    ]);
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
    const capPos = e.board.positionOf(cap);
    expect(out[0]).toEqual({
      kind: "sealStamped",
      tileIndex: cap,
      x: capPos.x,
      y: capPos.y,
      char: "筑",
    });
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
      {
        kind: "turnBanner",
        guohao: e.players[1].guohao,
        colorIndex: e.players[1].colorIndex,
        isBot: e.players[1].isBot,
        round: e.round,
      },
    ]);
    const merged = synth(e, [
      { kind: "turnStarted", seat: 0, round: 1, turn: 2 },
      { kind: "turnStarted", seat: 1, round: 1, turn: 3 },
    ]);
    expect(merged).toEqual([
      {
        kind: "turnBanner",
        guohao: e.players[1].guohao,
        colorIndex: e.players[1].colorIndex,
        isBot: e.players[1].isBot,
        round: e.round,
      },
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
      {
        kind: "heroRecruited",
        seat: 0,
        round: 1,
        turn: 1,
        heroId: "zhouyu",
        skillIds: ["jixing", "huogong", "leigu"],
      },
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

  it("staminaChanged 零实际差不产浮字(#568 病 A:无变化无演出;exhaustion 状态宣告不受此限)", () => {
    const e = E();
    const out = synth(e, [
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 0, reason: "skill" },
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 0, reason: "heroRelief" },
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 0, reason: "encounter" },
      { kind: "staminaChanged", seat: 0, round: 1, turn: 1, delta: 100, reason: "exhaustion" },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "体力耗竭,跳过一回合",
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

  it("jinnangExhausted:双空落空宣告 → 「锦囊已空」文案浮字(#588 迁 fx 面)", () => {
    const e = E();
    const out = synth(e, [{ kind: "jinnangExhausted", seat: 0, round: 1, turn: 1 }]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual(["锦囊已空"]);
  });

  it("propertyGranted:机遇赐城 → 城池易主宣告(#719 迁 fx 面,与购地/破产易主同通路)", () => {
    const e = E();
    const tile = e.board.tiles.find(
      (t) => t.propertyId != null && t.index !== e.players[0].capitalIndex,
    )!;
    // 得城者已入册(提取时刻态):宣告归属色=得城者
    e.players[0].properties.push({
      propertyId: tile.propertyId!,
      group: "g",
      level: 0,
      maxLevel: 3,
    });
    const out = synth(e, [
      { kind: "propertyGranted", seat: 0, round: 1, turn: 1, propertyId: tile.propertyId! },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "propertyChanged",
      tileIndex: tile.index,
      level: 0,
      ownerColorIndex: e.players[0].colorIndex,
      levelChanged: false,
      ownerChanged: true,
    });
  });

  it("repMilestoneCrossed:声望献计里程碑 → 「民心所向,名将献计」文案浮字(#719 迁 fx 面)", () => {
    const e = E();
    const out = synth(e, [
      { kind: "repMilestoneCrossed", seat: 0, round: 1, turn: 1, milestone: 30 },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual([
      "民心所向(声望 30),名将献计",
    ]);
  });

  it("inquiryAutoExecuted:问询自动执行 → 选项文案浮字,label 随事件走(#719 迁 fx 面)", () => {
    const e = E();
    const out = synth(e, [
      {
        kind: "inquiryAutoExecuted",
        seat: 0,
        round: 1,
        turn: 1,
        inquiryId: "xinyi",
        optionId: "swap",
        label: "弃旧换新",
      },
    ]);
    expect(out.map((ev) => (ev.kind === "textFloat" ? ev.text : ev.kind))).toEqual(["弃旧换新"]);
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

  it("reactionFailed:文案浮字「拦检失败」锚拦检城,不带点数括注(点数只落拼点签面,ADR-0030)", () => {
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
      {
        kind: "reactionFailed",
        seat: 1,
        round: 1,
        turn: 1,
        windowKind: "march",
        tileIndex: 5,
        aRoll: 3,
        bRoll: 3,
      },
    ]);
    const pos = e.board.positionOf(5);
    // 平/负同文案:骰面信息全在拼点签面(duelResolved 直译),浮字不落第二处
    expect(out[0]).toEqual({
      kind: "textFloat",
      playerId: e.players[1].id,
      text: "拦检失败",
      x: pos.x,
      y: pos.y,
      atTile: 5,
    });
    expect(out[1]).toEqual({
      kind: "textFloat",
      playerId: e.players[1].id,
      text: "拦检失败",
      x: pos.x,
      y: pos.y,
      atTile: 5,
    });
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

  it("落格定音(S7 #513):事件/机遇格落点 landPulse 一拍;城池格不拍(据章即定音)", () => {
    const e = E();
    const special = e.board.tiles.find((t) => !isCityType(t.type))!;
    const city = e.board.tiles.find((t) => isCityType(t.type))!;
    const path = e.board.computePath(e.players[0].position, 1, e.players[0].capitalIndex);
    testEngine(e).place(0, special.index); // 快照终态:已落特殊格
    const atSpecial = extractBatchEvents(
      e,
      [{ kind: "marchArrived", seat: 0, round: 1, turn: 1, tileIndex: special.index, path }],
      [e.players[0].position],
    );
    expect(atSpecial.some((ev) => ev.kind === "landPulse")).toBe(true);
    // 城池格:落格不拍(购地据章/宣告承担定音)
    testEngine(e).place(0, city.index);
    const atCity = extractBatchEvents(
      e,
      [
        {
          kind: "marchArrived",
          seat: 0,
          round: 1,
          turn: 1,
          tileIndex: city.index,
          path: e.board.computePath(e.players[0].position, 1, e.players[0].capitalIndex),
        },
      ],
      [e.players[0].position],
    );
    expect(atCity.some((ev) => ev.kind === "landPulse")).toBe(false);
  });

  it("都城停全屏宣告(S7 #513):capitalHalt → haltBanner(国号/座色/都城名提取期解析)", () => {
    const e = E();
    const p = e.players[0];
    const path = e.board.computePath(p.position, 1, p.capitalIndex);
    const out = extractBatchEvents(
      e,
      [
        {
          kind: "capitalHalt",
          seat: 0,
          round: 1,
          turn: 1,
          tileIndex: p.capitalIndex,
          path,
        },
      ],
      [p.position], // pre=当前位置:marchEvent 判无余段(行军段不播),宣告/驻章照出
    );
    expect(out).toContainEqual({
      kind: "haltBanner",
      playerId: p.id,
      guohao: p.guohao,
      colorIndex: p.colorIndex,
      cityName: e.board.at(p.capitalIndex).name,
    });
    // 驻章与文案照旧(宣告插行军与驻章之间,此处无余段行军即缺席)
    expect(out.some((ev) => ev.kind === "sealStamped" && ev.char === "驻")).toBe(true);
    expect(out.some((ev) => ev.kind === "textFloat" && ev.text === "驻跸补给")).toBe(true);
    expect(out.some((ev) => ev.kind === "landPulse")).toBe(false); // 驻跸不加定音拍
  });

  it("合并批多段行军(缺口 3):各 marchArrived 自带路径,两段各播各段", () => {
    const e = E();
    const from0 = e.players[0].position;
    const from1 = e.players[1].position;
    const path0 = e.board.computePath(from0, 2, e.players[0].capitalIndex);
    const path1 = e.board.computePath(from1, 3, e.players[1].capitalIndex);
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
    // 各段各播:末段流光终点=各自落格中心(几何提取拍烤死,#608 不变量①)
    expect(marches[0].keyframes[marches[0].keyframes.length - 1].flow.at(-1)).toEqual(
      e.board.positionOf(path0.landIndex),
    );
    expect(marches[1].keyframes[marches[1].keyframes.length - 1].flow.at(-1)).toEqual(
      e.board.positionOf(path1.landIndex),
    );
  });

  it("反应窗余段截短逻辑保持:事件内路径 + 挂起点前置位置 → 余段 tokenMoved", () => {
    const e = E();
    const mover = e.players[0];
    const from = mover.position;
    const path = e.board.computePath(from, 4, mover.capitalIndex);
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
      // 不拽回起点:首帧=挂起点中心续走;段数=余段格数(路径截短,#281)
      expect(march.keyframes[0].points[0]).toEqual(e.board.positionOf(ambushTile));
      expect(march.keyframes.length).toBe(path.traversed.slice(2).length);
    }
  });
});

// ─────────────── 拼点签面直译(#637,ADR-0030)───────────────
describe("拼点签面直译(#637,ADR-0030:duelResolved → duelSigns)", () => {
  const E = () => makeEngine(7);

  it("胜负局:sides=双方座位元数据(国号/座色/掷点,按座位号升序),winnerSeat 随事件走;场景无关(拦检/连环计同式)", () => {
    const e = E();
    const out = synth(e, [
      {
        kind: "duelResolved",
        seat: 0,
        round: 1,
        turn: 1,
        aSeat: 0,
        bSeat: 1,
        aRoll: 6,
        bRoll: 1,
        winnerSeat: 0,
      },
    ]);
    expect(out).toEqual([
      {
        kind: "duelSigns",
        sides: [
          { seat: 0, playerId: e.players[0].id, guohao: "魏", colorIndex: 0, roll: 6 },
          { seat: 1, playerId: e.players[1].id, guohao: "蜀", colorIndex: 1, roll: 1 },
        ],
        winnerSeat: 0,
      },
    ]);
  });

  it("平局:winnerSeat=null 原样透传;sides 按座位升序重排(#639:aSeat=resolveDuel 首参不保证座位号小,错拍落定序=座位升序)", () => {
    const e = E();
    const out = synth(e, [
      {
        kind: "duelResolved",
        seat: 1,
        round: 1,
        turn: 1,
        aSeat: 1,
        bSeat: 0,
        aRoll: 3,
        bRoll: 3,
        winnerSeat: null,
      },
    ]);
    expect(out).toHaveLength(1);
    if (out[0].kind !== "duelSigns") throw new Error("duelResolved 应直译 duelSigns");
    expect(out[0].winnerSeat).toBeNull();
    // aSeat=1 > bSeat=0:sides 重排为 [0,1](升序),掷点仍各随其主
    expect(out[0].sides.map((s) => s.seat)).toEqual([0, 1]);
    expect(out[0].sides.map((s) => s.roll)).toEqual([3, 3]);
  });

  it("大胜负升序重排后掷点各随其主:aSeat=2/bSeat=1(aSeat 座位号更大)重排后 roll 不串位", () => {
    const e = makeEngine(7, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    const out = synth(e, [
      {
        kind: "duelResolved",
        seat: 2,
        round: 1,
        turn: 1,
        aSeat: 2,
        bSeat: 1,
        aRoll: 6,
        bRoll: 1,
        winnerSeat: 2,
      },
    ]);
    if (out[0].kind !== "duelSigns") throw new Error("duelResolved 应直译 duelSigns");
    expect(out[0].sides.map((s) => [s.seat, s.roll] as const)).toEqual([
      [1, 1],
      [2, 6],
    ]);
    expect(out[0].winnerSeat).toBe(2);
  });

  it("契约违反当场炸出(零兜底):winnerSeat 不在拼点双方/座位越界", () => {
    const e = E();
    expect(() =>
      synth(e, [
        {
          kind: "duelResolved",
          seat: 0,
          round: 1,
          turn: 1,
          aSeat: 0,
          bSeat: 1,
          aRoll: 6,
          bRoll: 2,
          winnerSeat: 2,
        },
      ]),
    ).toThrow();
    expect(() =>
      synth(e, [
        {
          kind: "duelResolved",
          seat: 0,
          round: 1,
          turn: 1,
          aSeat: 0,
          bSeat: 9,
          aRoll: 6,
          bRoll: 2,
          winnerSeat: 0,
        },
      ]),
    ).toThrow();
  });
});

// ─────────────── 大胜负震屏判定(#639 评审必修:行为断言取代时长表近恒真档)───────────────
describe("isBlowout(拼点大胜负震屏判定:|a−b| ≥ DUEL.blowoutMargin,判词拍消费)", () => {
  it("点差 3(恰等 margin)=震屏;方向无关", () => {
    expect(isBlowout(6, 3)).toBe(true);
    expect(isBlowout(3, 6)).toBe(true);
  });

  it("点差 2(不足 margin)=不震", () => {
    expect(isBlowout(5, 3)).toBe(false);
    expect(isBlowout(3, 5)).toBe(false);
  });
});

// ─────────────── 出牌指示线(事件批口径)───────────────
/** 出牌阶段出牌步骤(横征暴敛=A面全体域):提取事件含 jinnangPlayed(jinnangAnnounced 直译)。 */
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

// ─────────────── 跨批宣布游标生命周期(#430 票项 3)───────────────
describe("跨批宣布游标生命周期(#430 票项 3)", () => {
  it("同引擎跨批衔接:宣布批与识破批分离时,识破线仍指回被拆计使用者", () => {
    const e = makeEngine(7);
    finishSetup(e);
    synth(e, [
      { kind: "jinnangAnnounced", seat: 0, round: 1, turn: 1, cardId: "连环计", targetSeats: [1] },
    ]);
    const out = synth(e, [{ kind: "jinnangVoided", seat: 1, round: 1, turn: 2, cardId: "连环计" }]);
    expect(out.some((ev) => ev.kind === "jinnangPlayed")).toBe(true); // 游标跨批存活
  });

  it("换引擎即新游标:旧局宣布不泄入新局(手工 reset 配对退役后,reset 忘调类 bug 结构性消失)", () => {
    const ea = makeEngine(7);
    finishSetup(ea);
    synth(ea, [
      { kind: "jinnangAnnounced", seat: 0, round: 1, turn: 1, cardId: "连环计", targetSeats: [1] },
    ]);
    const eb = makeEngine(9); // 新一局 = 新引擎实例,游标必须全新
    finishSetup(eb);
    const out = synth(eb, [
      { kind: "jinnangVoided", seat: 1, round: 1, turn: 1, cardId: "连环计" },
    ]);
    expect(out.some((ev) => ev.kind === "jinnangPlayed")).toBe(false); // 旧局游标不得越局
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
          keyframes: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 7, y: 8 },
              ],
              flow: [{ x: 0, y: 0 }],
            },
          ],
        },
        { kind: "cashDelta", playerId: "p1", amount: -120, x: 10, y: 20, atTile: 1 },
        { kind: "turnBanner", guohao: "蜀", colorIndex: 1, isBot: false, round: 1 },
      ],
      sink,
    );
    expect(sink.calls.map((c) => c.op)).toEqual(["dice", "march", "floater", "banner"]);
    expect(sink.calls[0]).toEqual({ op: "dice", die: 5 });
    expect(sink.calls[1]).toEqual({
      op: "march",
      playerId: "p1",
      keyframes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 7, y: 8 },
          ],
          flow: [{ x: 0, y: 0 }],
        },
      ],
    });
    expect(sink.calls[2]).toEqual({ op: "floater", x: 10, y: 20, amount: -120, coins: false });
    expect(sink.calls[3]).toEqual({
      op: "banner",
      guohao: "蜀",
      colorIndex: 1,
      isBot: false,
      round: 1,
    });
  });

  it("supplyRain → coins=true;进账起飞一枚归账铜钱;sound 事件直通", async () => {
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
      // 飞行归账(#764):进账一枚铜钱,在下一个非进账事件(sound)前冲账起飞
      { op: "cashFly", playerId: "p2", amount: 300, x: 1, y: 2 },
      { op: "sound", event: "treasure" },
    ]);
  });

  it("金钱飞行合帧(#764):连续进账并一枚总差额;他事件隔开即分飞;出账不飞", async () => {
    const sink = createMemorySink();
    await present(
      [
        // 连续进账(合并批常态):成交 +300 与补给 +200 紧邻并一枚,出账 −100 不进账本
        { kind: "cashDelta", playerId: "p1", amount: 300, x: 1, y: 1, atTile: 0 },
        { kind: "supplyRain", playerId: "p1", amount: 200, x: 3, y: 4, atTile: 1 },
        { kind: "cashDelta", playerId: "p1", amount: -100, x: 5, y: 6, atTile: 2 },
      ],
      sink,
    );
    expect(sink.calls.filter((c) => c.op === "cashFly")).toEqual([
      // 批尾冲账:一枚总差额 500,来源锚点=最后一笔进账现场(3,4)
      { op: "cashFly", playerId: "p1", amount: 500, x: 3, y: 4 },
    ]);

    // 任何非进账事件(同步印章也算)隔开即分飞:前账在印章前冲账起飞,不吞后账
    const sink2 = createMemorySink();
    await present(
      [
        { kind: "cashDelta", playerId: "p1", amount: 300, x: 1, y: 1, atTile: 0 },
        { kind: "sealStamped", tileIndex: 0, x: 1, y: 1, char: "得" },
        { kind: "supplyRain", playerId: "p1", amount: 200, x: 3, y: 4, atTile: 1 },
      ],
      sink2,
    );
    expect(sink2.calls.filter((c) => c.op === "cashFly")).toEqual([
      { op: "cashFly", playerId: "p1", amount: 300, x: 1, y: 1 },
      { op: "cashFly", playerId: "p1", amount: 200, x: 3, y: 4 },
    ]);

    // 隔了占编排时长的演出(骰子)同理分帧各飞
    const sink3 = createMemorySink();
    await present(
      [
        { kind: "cashDelta", playerId: "p1", amount: 300, x: 1, y: 1, atTile: 0 },
        { kind: "diceRolled", die: 4 },
        { kind: "cashDelta", playerId: "p1", amount: 200, x: 3, y: 4, atTile: 1 },
      ],
      sink3,
    );
    expect(sink3.calls.filter((c) => c.op === "cashFly")).toEqual([
      { op: "cashFly", playerId: "p1", amount: 300, x: 1, y: 1 },
      { op: "cashFly", playerId: "p1", amount: 200, x: 3, y: 4 },
    ]);
  });

  it("S7 演出直通 sink:landPulse/haltBanner/bankruptCeremony(memorySink 录制)", async () => {
    const sink = createMemorySink();
    await present(
      [
        { kind: "landPulse", tileIndex: 3, x: 30, y: 40 },
        { kind: "haltBanner", playerId: "p1", guohao: "魏", colorIndex: 0, cityName: "洛阳" },
        { kind: "bankruptCeremony", playerId: "p1", x: 3, y: 4 },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      { op: "landPulse", x: 30, y: 40 },
      { op: "haltBanner", guohao: "魏", colorIndex: 0, cityName: "洛阳" },
      { op: "bankruptCeremony", playerId: "p1", x: 3, y: 4 },
    ]);
  });

  it("拼点签面直通 sink(#637):duelSigns 整场 await 后才播下一事件(串行=签面收场后棋盘后效才登场)", async () => {
    const sink = createMemorySink();
    await present(
      [
        {
          kind: "duelSigns",
          sides: [
            { seat: 0, playerId: "p0", guohao: "魏", colorIndex: 0, roll: 6 },
            { seat: 1, playerId: "p1", guohao: "蜀", colorIndex: 1, roll: 1 },
          ],
          winnerSeat: 0,
        },
        { kind: "cashDelta", playerId: "p1", amount: -120, x: 1, y: 2, atTile: null },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      {
        op: "duelSigns",
        sides: [
          { seat: 0, playerId: "p0", guohao: "魏", colorIndex: 0, roll: 6 },
          { seat: 1, playerId: "p1", guohao: "蜀", colorIndex: 1, roll: 1 },
        ],
        winnerSeat: 0,
      },
      { op: "floater", x: 1, y: 2, amount: -120, coins: false },
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

  // ── overlay 互斥与横幅错位(#849 棒2):同步件(jline/floater/cashFly)的下发时序 ──
  it("overlay 互斥(#849 棒2):拦检线与拼点签面同批时,线延后到签面收场补发", async () => {
    const sink = createMemorySink();
    // 拦检真形:reactionAnswered 线(jinnangPlayed)与 duelResolved(duelSigns)同批,
    // 线原制即发即忘被 z-45 签面幕整个盖住——补发拍=签面收场后。
    await present(
      [
        {
          kind: "jinnangPlayed",
          playerId: "p0",
          cardId: "半路杀出",
          lines: [{ x1: 1, y1: 2, x2: 3, y2: 4 }],
        },
        {
          kind: "duelSigns",
          sides: [
            { seat: 0, playerId: "p0", guohao: "魏", colorIndex: 0, roll: 6 },
            { seat: 1, playerId: "p1", guohao: "蜀", colorIndex: 1, roll: 1 },
          ],
          winnerSeat: 0,
        },
      ],
      sink,
    );
    const ops = sink.calls.map((c) => c.op);
    expect(ops).toContain("jinnangLine");
    expect(ops.indexOf("jinnangLine")).toBeGreaterThan(ops.indexOf("duelSigns"));
  });

  it("overlay 互斥(#849 棒2):浮字后随掷骰签面时,浮字延后到收场补发", async () => {
    const sink = createMemorySink();
    await present(
      [
        { kind: "textFloat", playerId: "p1", text: "中【缓兵之计】", x: 5, y: 6, atTile: null },
        { kind: "diceRolled", die: 4 },
      ],
      sink,
    );
    expect(sink.calls.map((c) => c.op)).toEqual(["dice", "textFloater"]);
  });

  it("横幅错位(#849 棒2):cast 批内随 reactionOpen 的指示线不在即拍落线,错位窗后补发", async () => {
    const sink = createMemorySink();
    // cast 批真形:宣布线(浮字略)+ reactionOpen 音(识破窗挂点)——线错位到横幅
    // 亮相后 ~250ms,横幅入场铺开段不再吞线。
    await present(
      [
        {
          kind: "jinnangPlayed",
          playerId: "p1",
          cardId: "火烧连营",
          lines: [{ x1: 0, y1: 0, x2: 8, y2: 8 }],
        },
        { kind: "sound", event: "reactionOpen" },
      ],
      sink,
    );
    expect(sink.calls.some((c) => c.op === "jinnangLine")).toBe(false); // 不即发
    await new Promise((r) => setTimeout(r, 450)); // 错位窗 scStage(250) + 余量
    expect(sink.calls.filter((c) => c.op === "jinnangLine").length).toBe(1); // 错位窗后补发
  });
});

// ─────────────── 终局封场(present 事件边界收队,orchestrator.finishPresentation)───────────────
describe("终局封场 finishPresentation(present 事件边界收队)", () => {
  /** 合成 tokenMoved 的最小 keyframes(memory sink 不渲染,形状合法即可)。 */
  const kfOf = (n: number): MarchSegmentFrames[] => [
    {
      points: [
        { x: n, y: 0 },
        { x: n, y: 1 },
      ],
      flow: [{ x: n, y: 0 }],
    },
  ];

  it("播中封场:在途事件播完即收队——剩余事件不播、未开播行军接管被收回,正常 resolve 不 reject", async () => {
    useFxStore.getState().resetFx();
    const sink = createMemorySink();
    // anchorMarches(play() 拍)会把批内全部 tokenMoved 预塞行军接管——memorySink
    // 的 marchBegin 只录制不接管,这里手工模拟锚定后的接管集。
    useFxStore.getState().addMarching("p1");
    useFxStore.getState().addMarching("p2");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sinkGate = {
      ...sink,
      async marchToken(playerId: string, keyframes: readonly MarchSegmentFrames[]) {
        if (playerId === "p1") await gate; // 挂起 p1:封场恰好钉在两段行军之间
        sink.calls.push({ op: "march", playerId, keyframes: [...keyframes] });
      },
    };
    const events: PresentationEvent[] = [
      { kind: "diceRolled", die: 3 },
      { kind: "tokenMoved", playerId: "p1", keyframes: kfOf(2) },
      { kind: "tokenMoved", playerId: "p2", keyframes: kfOf(5) },
      { kind: "turnBanner", guohao: "蜀", colorIndex: 1, isBot: false, round: 1 },
    ];
    const done = present(events, sinkGate);
    await tick(); // 骰子已播,p1 行军挂起中
    finishPresentation();
    release();
    await done; // 生命周期规则收队必须正常 resolve——throw 会被 SnapshotEffects 记成表现异常
    expect(sink.calls.map((c) => c.op)).toEqual(["dice", "march"]); // p2 行军与横幅未播
    expect(useFxStore.getState().marching.has("p2")).toBe(false); // 不收回则棋子冻结在起点挂金边
    resetFxOrchestration(); // 解封复原:封场态不得泄漏给后续用例/文件(bun test 单进程顺序跑)
  });

  it("封场后新批:整批不播,批内行军接管一并收回", async () => {
    useFxStore.getState().resetFx();
    const sink = createMemorySink();
    useFxStore.getState().addMarching("p9"); // 同上,模拟 play() 拍的锚定
    finishPresentation();
    await present(
      [
        { kind: "tokenMoved", playerId: "p9", keyframes: kfOf(3) },
        { kind: "cashDelta", playerId: "p9", amount: 5, x: 0, y: 0, atTile: 3 },
      ],
      sink,
    );
    expect(sink.calls).toEqual([]);
    expect(useFxStore.getState().marching.has("p9")).toBe(false);
    resetFxOrchestration();
  });

  it("resetFxOrchestration 解封:封场后 reset,后续 present 照常全量播", async () => {
    finishPresentation();
    resetFxOrchestration();
    const sink = createMemorySink();
    await present([{ kind: "sound", event: "treasure" }], sink);
    expect(sink.calls).toEqual([{ op: "sound", event: "treasure" }]);
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

// ─────────────── 行军单写者:per-id 会话与顶替/段队列(#609,ADR-0029 不变量②)───────────────
/** 行军会话用例的最小 keyframes:单段两帧(起点→终点),几何合法即可。 */
function marchFrames(...pts: Array<{ x: number; y: number }>): MarchSegmentFrames[] {
  return [{ points: pts, flow: [pts[0]] }];
}
const moved = (playerId: string, keyframes: MarchSegmentFrames[]): PresentationEvent => ({
  kind: "tokenMoved",
  playerId,
  keyframes,
});

describe("行军单写者:per-id 会话与顶替/段队列(#609,ADR-0029 不变量②)", () => {
  /** 真实会话簿记通路:anchorMarches + 生产 sink(bun 单测无 DOM,只触状态面)。 */
  const anchor = (events: PresentationEvent[]) => anchorMarches(events, createEngineSink());

  it("同批同 id 双预塞=段队列追加:锚点保持第一段首帧,不覆写(双预塞错接起点 bug 修复)", () => {
    anchor([
      moved("p1", marchFrames({ x: 1, y: 1 }, { x: 2, y: 2 })),
      moved("p1", marchFrames({ x: 2, y: 2 }, { x: 3, y: 3 })),
    ]);
    expect(marchPos.get("p1")).toEqual({ x: 1, y: 1 }); // 旧实现覆写成第二段起点
    expect(useFxStore.getState().marching.has("p1")).toBe(true);
  });

  it("跨批顶替:新批锚=新会话首帧直切;旧批 animateMove 段边界自终止,不收新主之尾", async () => {
    const stale = marchFrames({ x: 0, y: 0 }, { x: 5, y: 0 });
    anchor([moved("p1", stale)]); // 批 1:锚定(队列中,未播)
    anchor([moved("p1", marchFrames({ x: 9, y: 9 }, { x: 10, y: 9 }))]); // 批 2:顶替
    expect(marchPos.get("p1")).toEqual({ x: 9, y: 9 });
    await animateMove("p1", stale); // 旧批演出迟到:必须无主自终止,不得触碰新主接管
    expect(marchPos.get("p1")).toEqual({ x: 9, y: 9 });
    expect(useFxStore.getState().marching.has("p1")).toBe(true);
  });

  it("段队列收尾:同批两段逐段播——非末段保持接管,末段才会话收尾", async () => {
    const first = marchFrames({ x: 1, y: 1 }, { x: 2, y: 2 });
    const second = marchFrames({ x: 2, y: 2 }, { x: 3, y: 3 });
    anchor([moved("p1", first), moved("p1", second)]);
    await animateMove("p1", first);
    expect(useFxStore.getState().marching.has("p1")).toBe(true); // 非末段:会话仍在
    await animateMove("p1", second);
    expect(useFxStore.getState().marching.has("p1")).toBe(false); // 末段收尾
    expect(marchPos.has("p1")).toBe(false);
  });

  it("abandonMarch per-id:只作废目标会话,他 id 在途会话不殃及", async () => {
    const kb = marchFrames({ x: 0, y: 5 }, { x: 1, y: 5 });
    anchor([moved("pA", marchFrames({ x: 0, y: 0 }, { x: 1, y: 0 })), moved("pB", kb)]);
    abandonMarch("pA");
    expect(marchPos.has("pA")).toBe(false);
    expect(useFxStore.getState().marching.has("pA")).toBe(false);
    expect(marchPos.get("pB")).toEqual({ x: 0, y: 5 }); // B 会话健在
    await animateMove("pB", kb); // B 仍按会话主人正常收尾(旧全局代际会误杀 → 红)
    expect(useFxStore.getState().marching.has("pB")).toBe(false);
  });

  it("重连边界清会话:dropStalledBatch/resetEventFace 作废全部在途行军接管", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const fx = new SnapshotEffects(() => e);
    anchor([
      moved("pX", marchFrames({ x: 0, y: 0 }, { x: 1, y: 0 })),
      moved("pY", marchFrames({ x: 0, y: 2 }, { x: 1, y: 2 })),
    ]);
    fx.dropStalledBatch(); // 断线边界
    expect(marchPos.size).toBe(0);
    expect(useFxStore.getState().marching.size).toBe(0);
    anchor([moved("pX", marchFrames({ x: 4, y: 4 }, { x: 5, y: 4 }))]);
    fx.resetEventFace(); // 重连成功边界
    expect(marchPos.size).toBe(0);
    expect(useFxStore.getState().marching.size).toBe(0);
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

// ─────────────── 技能演出直译(#850:UI二轮19)───────────────
describe("技能演出补课(#850):施展金圈+升档浮字/被动技名小签", () => {
  it("heroSkillActivated:施法者 token 金圈一拍(landPulse 通道,锚当下格)在前 + 施展浮字升档(cast 档,玩家色提取烤定)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const seat = e.players.indexOf(user);
    armHero(
      e,
      user,
      HEROES.find((h) => h.id === "zhangxingcai")!,
    );
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e); // 开新批:直译只吃本转移(vocab 测试同款批界)
    const out = stepEvents(e, () => e.resolveHeroSkill("zhangxingcai", "leigu"));
    expect(out.map((ev) => ev.kind)).toEqual(["landPulse", "textFloat"]);
    const pulse = out[0]!;
    if (pulse.kind !== "landPulse") throw new Error("金圈事件缺位");
    expect(pulse.tileIndex).toBe(user.position); // 锚施法者当下所在格(提取拍烤定)
    const float = out[1]!;
    if (float.kind !== "textFloat") throw new Error("施展浮字缺位");
    expect(float.text).toBe(`${user.guohao} 施展【擂鼓】`); // 文案与旧口径同串
    expect(float.skill).toEqual({ kind: "cast", colorIndex: user.colorIndex });
    expect(float.atTile).toBe(user.position);
    expect(seat).toBeGreaterThanOrEqual(0); // 座位契约由 eventSeat 自守,此处防哑批
  });

  it("skillFired:token 侧技名小签(tag 档)先行——疾行随 rollAndMove 批产出,提取序=小签→骰子(播放侧 overlay 互斥延后归 orchestrator,提取不摆)", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const mover = e.activePlayer;
    armHero(
      e,
      mover,
      HEROES.find((h) => h.id === "zhouyu")!,
    ); // 疾行(BeforeMarch·moveBonus+1)
    // 摆位到不拦检、落无主地产城的合法路径(game-events-vocab 同款预言,批面保持小)
    const die = createDice(e.dice.getRngState()).roll().die;
    const steps = die + 1;
    const target = MAP.board.tiles.find((tile) => {
      if (tile.propertyId == null) return false;
      const path = MAP.board.computePath(tile.index, steps, mover.capitalIndex);
      if (path.passedCapital) return false;
      const land = MAP.board.at(path.landIndex);
      return (
        land.type === "Property" && land.propertyId != null && e.findOwner(land.propertyId) == null
      );
    });
    expect(target).toBeDefined();
    const seat = e.players.indexOf(mover);
    const t = testEngine(e);
    t.place(seat, target!.index);
    beginGameEventBatch(e); // 开新批:直译只吃本转移(vocab 测试同款批界)
    const out = stepEvents(e, () => e.rollAndMove());
    expect(out.slice(0, 2).map((ev) => ev.kind)).toEqual(["textFloat", "diceRolled"]);
    const tag = out[0]!;
    if (tag.kind !== "textFloat") throw new Error("小签缺位");
    expect(tag.text).toBe("疾行"); // 小签=技名宣告,不带国号
    expect(tag.skill).toEqual({ kind: "tag" });
    // 浮字锚=提取时刻玩家位置(文件头坐标口径):提取在推进后跑,锚终落位
    expect(tag.atTile).toBe(mover.position);
  });

  it("present 直译:skill 浮字档随 sink 原样下传(cast/tag),memorySink 录制带档位、普通文案不带键", async () => {
    const sink = createMemorySink();
    await present(
      [
        {
          kind: "textFloat",
          playerId: "p0",
          text: "魏 施展【擂鼓】",
          x: 5,
          y: 6,
          atTile: null,
          skill: { kind: "cast", colorIndex: 2 },
        },
        {
          kind: "textFloat",
          playerId: "p0",
          text: "疾行",
          x: 5,
          y: 6,
          atTile: null,
          skill: { kind: "tag" },
        },
      ],
      sink,
    );
    expect(sink.calls).toEqual([
      {
        op: "textFloater",
        x: 5,
        y: 6,
        text: "魏 施展【擂鼓】",
        skill: { kind: "cast", colorIndex: 2 },
      },
      { op: "textFloater", x: 5, y: 6, text: "疾行", skill: { kind: "tag" } },
    ]);
  });
});
