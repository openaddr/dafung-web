// 首帧事件批折叠时序门(#423 项2):开局 flush 服务端先发 events 后发校准快照
// (server.ts flushRoom「因果在前、状态在后」),而大厅期 clientView 对未开局房间退化为
// lobby(无 players 字段)——客户端占位壳(缺省 2 座/构造图)在整个大厅阶段得不到
// 座位数与目录校准。3+ 座房开局时 bot 立即代选,首个 events 消息(capitalSelected)
// 先于首帧快照到达:对壳折叠 = seat 越界写 undefined 玩家(TypeError,页面 PAGEERROR),
// 他图房则是目录查无当场炸。本文件钉死时序门:水合前(enteredGame=false)的下行批
// 不折叠、不即刻播演出——批照常暂存,同 flush 的校准快照承载状态,表现消费游标随
// 快照帧推进(直译基于水合后引擎,座位/坐标可用)。全程注入消息,零网络零浏览器。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap, type LoadedMap, type MapData } from "@core/board-loader";
import type { GameSnapshot } from "@core/snapshot";
import type { GameEvent } from "@core/game-events";
import { OnlineController } from "@app/controllers/online";
import sanguoData from "../public/maps/sanguo.json" with { type: "json" };

const SANGUO: { map: LoadedMap; data: MapData } = {
  map: loadMap(sanguoData),
  data: sanguoData as unknown as MapData,
};

/** 私有面访问缝(测试专用;onMessage/enteredGame 均 @app 内聚私有)。 */
interface TestAccess {
  onMessage(msg: unknown): void;
  enteredGame: boolean;
}

/** 三座房开局期事件批:bot(座位 2)先行代选都城长安——开局 flush 首个 events 消息
 *  的形状(服务器 doDraftRoll 后 driveBots 立即代选,capitalSelected 是开局首事件)。 */
function firstBatchCapitalSelected(): GameEvent[] {
  return [
    {
      kind: "capitalSelected",
      seat: 2,
      round: 0,
      turn: 0,
      tileIndex: 0,
      propertyId: "prop-changan",
      cost: 2000,
    },
  ];
}

/** 三座房校准快照(复刻 startGame+driveBots:座位 2 自动 bot 先选,与服务器同构)。
 *  返回消息与 bot 定都格——落格随种子走,期望值从引擎快照派生,不硬编码地图知识。 */
function sanguoRoomSnapshot(): { msg: Record<string, unknown>; botCapitalIndex: number } {
  const engine = new GameEngine(SANGUO.map.board, SANGUO.map.catalog, createDice(430), {
    seats: [
      { name: "座 1", isBot: false },
      { name: "座 2", isBot: false },
      { name: "座 3", isBot: true },
    ],
    seed: 430,
    mapId: "sanguo",
  });
  engine.doDraftRoll();
  for (let i = 0; i < 3 && engine.currentSetupPlayerIndex === 2; i++) {
    engine.aiSetupStepFor(2); // 服务器代选:只驱动 bot 座位,轮到真人即停(与 driveBots 同口径)
  }
  const snap = engine.snapshot() as GameSnapshot;
  return {
    msg: {
      type: "snapshot",
      roomId: "TEST",
      seatCount: 3,
      host: 0,
      started: true,
      mapId: "sanguo",
      seats: [],
      ...snap,
    },
    botCapitalIndex: snap.players[2]!.capitalIndex,
  };
}

describe("OnlineController 首帧事件批时序门(#423 项2)", () => {
  it("水合前的 events 批不折叠进占位壳:状态由随后的校准快照承载,全程无抛", () => {
    const c = new OnlineController(SANGUO.map, "sanguo"); // 占位壳:2 座(缺省),同图隔离座位变量
    const x = c as unknown as TestAccess;
    expect(x.enteredGame).toBe(false);

    // 开局 flush 的 events 先到:3 座房的 bot 首批(capitalSelected seat=2 越界 2 座壳)
    expect(() => x.onMessage({ type: "events", events: firstBatchCapitalSelected() })).not.toThrow();
    expect(x.enteredGame).toBe(false); // 未水合,壳状态不许被批推进
    expect(c.engine.players).toHaveLength(2);
    expect(c.engine.players[2]).toBeUndefined(); // 壳还是壳:座位没被事件越界造出

    // 同 flush 的校准快照紧随:水合即状态(3 座 + bot 已定都)
    const { msg, botCapitalIndex } = sanguoRoomSnapshot();
    x.onMessage(msg);
    expect(x.enteredGame).toBe(true);
    expect(c.engine.players).toHaveLength(3);
    expect(c.engine.players[2]!.capitalIndex).toBe(botCapitalIndex); // 与引擎快照一致
  });

  it("水合后的 events 批照常折叠(门只开在水合前)", () => {
    const c = new OnlineController(SANGUO.map, "sanguo");
    const x = c as unknown as TestAccess;
    x.onMessage(sanguoRoomSnapshot().msg); // 先水合(3 座)
    expect(x.enteredGame).toBe(true);
    // 第二位真人落子:正常批照折(cash 不折、入册照常)
    expect(() =>
      x.onMessage({
        type: "events",
        events: [
          { kind: "capitalSelected", seat: 0, round: 0, turn: 0, tileIndex: 3, propertyId: "prop-luoyang", cost: 2000 },
        ],
      }),
    ).not.toThrow();
    expect(c.engine.players[0]!.capitalIndex).toBe(3);
    expect(c.engine.takenCapitalIndices.has(3)).toBe(true);
  });
});
