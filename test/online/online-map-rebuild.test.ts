// 换图竞速回归(#415):开局摘要可能早于取图完成。等对应地图就绪后再用它的目录恢复，
// 后续事件按照原顺序折叠。更新换图指令到达时，过期取图作废。
// 全程注入假取图(覆写 loadMapBundle 私有缝),零网络零浏览器。
import { afterEach, describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { loadMap, type LoadedMap, type MapData } from "@dafung/core/engine/board-loader";
import { OnlineController } from "@app/controllers/online";
import { beginMarch, isMarching } from "@app/fx/useMarch";
import { getControllerContext, setController } from "@app/controllers/registry";
import { setSnapPin } from "@app/fx/catchup";
import { useNetStore } from "@app/store/netStore";
import type { ServerMsg, SnapshotMsg } from "@dafung/core/protocol/wire";
import guanzhongData from "../../packages/core/maps/guanzhong.json" with { type: "json" };
import zhongyuanData from "../../packages/core/maps/zhongyuan.json" with { type: "json" };

interface Bundle {
  map: LoadedMap;
  data: MapData;
}

const GUANZHONG: Bundle = {
  map: loadMap(guanzhongData),
  data: guanzhongData as unknown as MapData,
};
const ZHONGYUAN: Bundle = {
  map: loadMap(zhongyuanData),
  data: zhongyuanData as unknown as MapData,
};

/** 私有面访问缝(测试专用;onMessage/loadMapBundle/enteredGame 均 @app 内聚私有)。 */
interface TestAccess {
  mapId: string | null;
  onMessage(msg: ServerMsg, receivedAt: number): void;
  enteredGame: boolean;
  loadMapBundle(mapId: string): Promise<Bundle>;
}

/** 手动落地的取图桩:每次取图调用挂闸门,测试按 mapId 手动放行(rebuildForMap 的
 *  await 停在这里,复现「取图后落」的竞速次序)。 */
function stubLoader(c: OnlineController): {
  gate(mapId: string, nth?: number): { resolve(b: Bundle): void };
} {
  const calls: { mapId: string; resolve: (b: Bundle) => void }[] = [];
  (c as unknown as TestAccess).loadMapBundle = (mapId: string) =>
    new Promise<Bundle>((resolve) => calls.push({ mapId, resolve }));
  return {
    gate(mapId, nth = 0) {
      const hit = calls.filter((x) => x.mapId === mapId)[nth];
      if (hit == null) throw new Error(`取图桩:mapId ${mapId} 第 ${nth} 次调用不存在`);
      return { resolve: hit.resolve };
    },
  };
}

const drain = () => new Promise<void>((r) => setTimeout(r, 0));

function lobbyMsg(mapId: string): ServerMsg {
  return { type: "lobby", roomId: "TEST", host: 0, started: false, mapId, seatCount: 3, seats: [] };
}

/** 服务器侧三座房开局快照。种子 27 让座位 2 先为电脑选定新野。 */
function zhongyuanRoom(): GameEngine {
  const seed = 27;
  const engine = new GameEngine(ZHONGYUAN.map.board, ZHONGYUAN.map.catalog, createDice(seed), {
    seats: [
      { name: "座 1", isBot: false },
      { name: "座 2", isBot: false },
      { name: "座 3", isBot: true },
    ],
    seed,
    mapId: "zhongyuan",
    targetNetWorth: ZHONGYUAN.map.targetNetWorth,
    startingCash: ZHONGYUAN.map.startingCash,
    startingTreasures: 0,
  });
  engine.beginCapitalSelection();
  for (let i = 0; i < 3 && engine.currentSetupPlayerIndex === 2; i++) {
    engine.aiSetupStepFor(2); // 服务器代选:只驱动 bot 座位,轮到真人即停(与 driveBots 同口径)
  }
  return engine;
}

function zhongyuanRoomSnapshot(engine: GameEngine): SnapshotMsg {
  return {
    type: "snapshot",
    roomId: "TEST",
    host: 0,
    started: true,
    mapId: "zhongyuan",
    seats: [],
    ...engine.snapshot(),
  };
}

describe("OnlineController.rebuildForMap · 落地竞速(#415)", () => {
  afterEach(() => {
    setController(null);
    setSnapPin(false);
    useNetStore.getState().reset();
  });

  it("开局快照先到时，等待对应地图再恢复城池并折叠后续事件", async () => {
    setSnapPin(true); // 只检查状态折叠，不留下跨测试的选都演出。
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    // 大厅选图广播 → 换图重建起步(取图 await 在途)
    x.onMessage(lobbyMsg("zhongyuan"), Date.now());
    // 开局快照含中原独有的新野，取图期间还收到下一座的选都事件。
    const authority = zhongyuanRoom();
    const snap = zhongyuanRoomSnapshot(authority);
    x.onMessage(snap, Date.now());
    const nextSeat = authority.currentSetupPlayerIndex;
    const nextCapital = authority.offeredCapitals[0]!;
    expect(authority.pickCapital(nextSeat, nextCapital).ok).toBe(true);
    x.onMessage({ type: "events", events: [...authority.gameEvents] }, Date.now());
    expect(c.sessionReady).toBe(false);
    expect(x.enteredGame).toBe(false);
    expect(c.engine.board).toBe(GUANZHONG.map.board);
    expect(c.engine.players).toHaveLength(2);

    gates.gate("zhongyuan").resolve(ZHONGYUAN);
    await drain();
    expect(c.sessionReady).toBe(true);
    expect(x.enteredGame).toBe(true);
    expect(c.engine.players).toHaveLength(3);
    expect(c.engine.phase).toBe(snap.phase);
    expect(c.engine.setupPhase).toBe(snap.setupPhase);
    expect(c.engine.currentSetupPlayerIndex).toBe(snap.currentSetupPlayerIndex);
    expect(c.engine.players.map((p) => p.capitalIndex)).toEqual(
      authority.players.map((p) => p.capitalIndex),
    );
    expect(c.engine.players[2]!.properties[0]?.propertyId).toBe("prop-xinye");
    expect(c.engine.board).toBe(ZHONGYUAN.map.board);
    expect(getControllerContext()?.catalog).toBe(ZHONGYUAN.map.catalog);
  });

  it("首条摘要自带新地图时，即使未收到大厅选图也能入局", async () => {
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    x.onMessage(zhongyuanRoomSnapshot(zhongyuanRoom()), Date.now());
    gates.gate("zhongyuan").resolve(ZHONGYUAN);
    await drain();
    expect(c.sessionReady).toBe(true);
    expect(c.engine.board).toBe(ZHONGYUAN.map.board);
  });

  it("更新换图在途:过期取图落地丢弃,不回退旧图", async () => {
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    // 大厅先后两次切 zhongyuan(同图重切:首次落地前 mapId 未动,第二次照样起步
    // rebuild,竞速语义与异图连切一致);后到的取图先落地(独立 loadMap 实例,
    // board 对象身份可区分先后)
    x.onMessage(lobbyMsg("zhongyuan"), Date.now());
    x.onMessage(lobbyMsg("zhongyuan"), Date.now());
    expect(x.mapId).toBe("guanzhong"); // 两次取图都在途,mapId 未动
    const LATEST: Bundle = {
      map: loadMap(zhongyuanData),
      data: zhongyuanData as unknown as MapData,
    };
    gates.gate("zhongyuan", 1).resolve(LATEST);
    await drain();
    expect(x.mapId).toBe("zhongyuan");
    expect(c.engine.board).toBe(LATEST.map.board);
    // 过期的首次取图后到:必须整单丢弃(不回退、不换板)
    gates.gate("zhongyuan", 0).resolve(ZHONGYUAN);
    await drain();
    expect(x.mapId).toBe("zhongyuan");
    expect(c.engine.board).toBe(LATEST.map.board);
  });

  it("开局前落地(既有语义):整换新图占位壳,等快照水合", async () => {
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    x.onMessage(lobbyMsg("zhongyuan"), Date.now());
    expect(x.enteredGame).toBe(false);
    gates.gate("zhongyuan").resolve(ZHONGYUAN);
    await drain();
    expect(x.mapId).toBe("zhongyuan");
    expect(c.engine.board).toBe(ZHONGYUAN.map.board);
    expect(c.engine.players).toHaveLength(2); // 大厅占位壳:缺省 2 座,等首帧快照重建
  });

  it("换图边界清演出会话(复审 F5,ADR-0029 §2 边界作废同族):落地拍在途行军会话统一作废", async () => {
    const c = new OnlineController(GUANZHONG.map, "guanzhong");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    x.onMessage(lobbyMsg("zhongyuan"), Date.now());
    // 伪批锚定一枚在途会话(烤的是旧板几何;无 DOM 环境 beginMarch 只走簿记)
    const kf = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        flow: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ];
    beginMarch("p-f5", kf);
    expect(isMarching("p-f5")).toBe(true);
    gates.gate("zhongyuan").resolve(ZHONGYUAN);
    await drain();
    expect(x.mapId).toBe("zhongyuan");
    // 会话已随换图边界作废:旧板行军不飞进新板(待播块同拍作废,共用 voidAllQueued)
    expect(isMarching("p-f5")).toBe(false);
  });
});
