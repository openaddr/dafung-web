// 折叠投影器单测(#386,ADR-0020 折叠切换④):事件批 → 本地引擎副本两族字段的
// 投影契约——cashChanged 逐条累加、marchArrived/capitalHalt 位置落定、未知 kind 忽略
// (折叠范围定义)、无主座位炸出(零兜底);以及快照对账:折叠漂移被水合无条件校正
//(快照=校准锚)。折叠的联机接线(消息到达→折叠→sync)归 e2e/react-online.spec.ts
// 的双端一致断言覆盖。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import type { MovePath } from "@core/board";
import type { GameEvent, GameEventBody } from "@core/game-events";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { foldEventBatch } from "@app/net/event-fold";

const MAP = loadMap(sanguoData);

function makeEngine(): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: false, guohao: "魏" },
    { name: "B", isBot: false, guohao: "蜀" },
  ];
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), cfg);
}

/** 事件首部三件套(折叠只认 kind/seat + 族字段,轮/回锚定本测试不涉)。 */
function ev<B extends GameEventBody>(seat: number | null, body: B): GameEvent {
  return { ...body, seat, round: 1, turn: 1 };
}

/** 最小 MovePath 形状(折叠器只读 tileIndex,路径字段随类型契约补齐)。 */
function path(landIndex: number): MovePath {
  return {
    from: 0,
    traversed: [],
    landIndex,
    passedCapital: false,
    capitalIndex: -1,
    waypoints: [],
    landBranchStep: null,
    branchWaypoints: [],
  };
}

describe("折叠投影器 foldEventBatch(#386)", () => {
  it("cashChanged 批内逐条累加(delta 带符号,跨座位各自结算)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    const cash1 = e.players[1].cash;

    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 500, reason: "supply" }),
      ev(1, { kind: "cashChanged", delta: -200, reason: "tax" }),
      ev(0, { kind: "cashChanged", delta: -100, reason: "encounter" }),
    ]);

    expect(e.players[0].cash).toBe(cash0 + 400);
    expect(e.players[1].cash).toBe(cash1 - 200);
  });

  it("marchArrived/capitalHalt 落定位置(批内后写覆盖先写)", () => {
    const e = makeEngine();
    e.players[0].position = 2;
    e.players[1].position = 3;

    foldEventBatch(e, [
      ev(0, { kind: "marchArrived", tileIndex: 7, path: path(7) }),
      ev(1, { kind: "capitalHalt", tileIndex: 5, path: path(5) }),
      ev(0, { kind: "marchArrived", tileIndex: 9, path: path(9) }),
    ]);

    expect(e.players[0].position).toBe(9);
    expect(e.players[1].position).toBe(5);
  });

  it("混合批按结算序折叠:驻跸落位后补给入账(位置与现金交错)", () => {
    const e = makeEngine();
    e.players[0].position = 2;
    const cash0 = e.players[0].cash;

    // 真实批序:capitalHalt(位置=都城)→ cashChanged(reason=supply,驻跸补给)
    foldEventBatch(e, [
      ev(0, { kind: "diceRolled", die: 4 }),
      ev(0, { kind: "capitalHalt", tileIndex: 6, path: path(6) }),
      ev(0, { kind: "cashChanged", delta: 300, reason: "supply" }),
    ]);

    expect(e.players[0].position).toBe(6);
    expect(e.players[0].cash).toBe(cash0 + 300);
  });

  it("未知 kind 忽略:词汇表生长不炸、两字段不动(范围定义非吞错)", () => {
    const e = makeEngine();
    e.players[0].position = 4;
    const cash0 = e.players[0].cash;

    // diceRolled = 已登记词汇但不在折叠范围;futureKind = 词汇表将来扩展的透传形状
    // (线上形状以 core GameEvent 为准,futureKind 用测试专用逃逸口模拟新词汇先行到达)
    const future = {
      kind: "futureKind",
      someField: 1,
      seat: 0,
      round: 1,
      turn: 1,
    } as unknown as GameEvent;
    foldEventBatch(e, [
      ev(0, { kind: "diceRolled", die: 3 }),
      future,
      ev(1, { kind: "reputationChanged", delta: 10, reason: "encounter" }),
    ]);

    expect(e.players[0].position).toBe(4);
    expect(e.players[0].cash).toBe(cash0);
    expect(e.players[1].cash).toBe(makeEngine().players[1].cash);
  });

  it("无主座位(seat=null)的折叠族事件当场炸(产出契约违反,零兜底)", () => {
    const e = makeEngine();
    expect(() =>
      foldEventBatch(e, [ev(null, { kind: "cashChanged", delta: 100, reason: "supply" })]),
    ).toThrow(/无主座位/);
    expect(() =>
      foldEventBatch(e, [ev(null, { kind: "marchArrived", tileIndex: 3, path: path(3) })]),
    ).toThrow(/无主座位/);
  });
});

describe("折叠对账:快照=校准锚(#386,ADR-0020 决策 3)", () => {
  it("折叠漂移后,快照水合无条件以快照值校正现金与位置", () => {
    const e = makeEngine();
    const snap = e.snapshot();
    const snapCash = snap.players.map((p) => p.cash);
    const snapPos = snap.players.map((p) => p.position);

    // 人为制造折叠漂移(错账:多加现金、位置走错格)
    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 777, reason: "drift" }),
      ev(0, { kind: "marchArrived", tileIndex: 11, path: path(11) }),
      ev(1, { kind: "cashChanged", delta: -55, reason: "drift" }),
      ev(1, { kind: "capitalHalt", tileIndex: 8, path: path(8) }),
    ]);
    expect(e.players[0].cash).toBe(snapCash[0] + 777);
    expect(e.players[1].position).toBe(8);

    // 快照到达:水合覆盖全量字段,漂移当场纠正(快照=校准锚)
    e.restoreFromSnapshot(snap);
    expect(e.players.map((p) => p.cash)).toEqual(snapCash);
    expect(e.players.map((p) => p.position)).toEqual(snapPos);
  });
});
