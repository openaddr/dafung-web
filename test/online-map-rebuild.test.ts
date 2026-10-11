// 换图重建落地竞速回归(#415):OnlineController.rebuildForMap 的取图 await 落地时刻,
// 对局态可能已由快照水合先行推进(开局 flush 与换图广播的取图竞速)——过期落地若照旧
// 换新占位引擎,会把已水合的对局态打回 2 座空壳;房间此后静默等真人决策(无后续下行
// 纠偏),该端永远读不到真实局面——e2e react-online-secrecy 并发选都停摆的根因。
// 本文件钉死三条落地语义:①对局已水合 → 换板不换局(快照迁到新图占位壳);
// ②更新换图在途 → 过期落地丢弃;③开局前落地 → 原语义(整换占位壳)不变。
// 全程注入假取图(覆写 loadMapBundle 私有缝),零网络零浏览器。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap, type LoadedMap, type MapData } from "@core/board-loader";
import type { GameSnapshot } from "@core/snapshot";
import { OnlineController } from "@app/controllers/online";
import huanyouData from "../public/maps/huanyou.json" with { type: "json" };
import sanguoData from "../public/maps/sanguo.json" with { type: "json" };
import zhongyuanData from "../public/maps/zhongyuan.json" with { type: "json" };

interface Bundle {
  map: LoadedMap;
  data: MapData;
}

const HUANYOU: Bundle = { map: loadMap(huanyouData), data: huanyouData as unknown as MapData };
const SANGUO: Bundle = { map: loadMap(sanguoData), data: sanguoData as unknown as MapData };
const ZHONGYUAN: Bundle = {
  map: loadMap(zhongyuanData),
  data: zhongyuanData as unknown as MapData,
};

/** 私有面访问缝(测试专用;onMessage/loadMapBundle/enteredGame 均 @app 内聚私有)。 */
interface TestAccess {
  mapId: string | null;
  onMessage(msg: unknown): void;
  enteredGame: boolean;
  loadMapBundle(mapId: string): Promise<Bundle>;
}

/** 手动落地的取图桩:每次取图调用挂闸门,测试按 mapId 手动放行(rebuildForMap 的
 *  await 停在这里,复现「取图后落」的竞速次序)。 */
function stubLoader(c: OnlineController): {
  gate(mapId: string, nth?: number): { resolve(b: Bundle): void };
} {
  const calls: { mapId: string; resolve: (b: Bundle) => void }[] = [];
  (c as unknown as Record<string, unknown>)["loadMapBundle"] = (mapId: string) =>
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

function lobbyMsg(mapId: string): unknown {
  return { type: "lobby", roomId: "TEST", host: 0, started: false, mapId, seatCount: 3, seats: [] };
}

/** 快照载荷中被断言消费的字段面(其余字段透传给 onMessage,不参与断言)。 */
type RoomSnapshotPayload = Pick<
  GameSnapshot,
  "phase" | "setupPhase" | "currentSetupPlayerIndex" | "players"
> & {
  type: "snapshot";
  roomId: string;
  seatCount: number;
  host: number;
  started: boolean;
  mapId: string;
  seats: unknown[];
};

/** 服务器侧三座房开局快照(种子 430 复刻 startGame+driveBots:座位 2 自动 bot 先选)。 */
function sanguoRoomSnapshot(): RoomSnapshotPayload {
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
  const snap = engine.snapshot();
  return {
    type: "snapshot",
    roomId: "TEST",
    seatCount: 3,
    host: 0,
    started: true,
    mapId: "sanguo",
    seats: [],
    ...snap,
  } as RoomSnapshotPayload;
}

describe("OnlineController.rebuildForMap · 落地竞速(#415)", () => {
  it("对局已水合后取图才落地:换板不换局——对局态保全、棋盘换到新图", async () => {
    const c = new OnlineController(HUANYOU.map, "huanyou");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    // 大厅选图广播 → 换图重建起步(取图 await 在途)
    x.onMessage(lobbyMsg("sanguo"));
    // 开局 flush 先行:快照水合三座对局态(#415 竞速的另一半)
    const snap = sanguoRoomSnapshot();
    x.onMessage(snap);
    expect(x.enteredGame).toBe(true);
    expect(c.engine.players).toHaveLength(3);
    // 取图后落地:不许打回空壳
    gates.gate("sanguo").resolve(SANGUO);
    await drain();
    expect(x.mapId).toBe("sanguo");
    expect(c.engine.players).toHaveLength(3);
    expect(c.engine.phase).toBe(snap.phase);
    expect(c.engine.setupPhase).toBe(snap.setupPhase);
    expect(c.engine.currentSetupPlayerIndex).toBe(snap.currentSetupPlayerIndex);
    expect(c.engine.players.map((p) => p.capitalIndex)).toEqual(
      snap.players.map((p) => p.capitalIndex),
    );
    expect(c.engine.players.map((p) => p.cash)).toEqual(snap.players.map((p) => p.cash));
    // 棋盘换到新图(BoardView 与折叠器的 catalog 查询都吃新图面)
    expect(c.engine.board).toBe(SANGUO.map.board);
  });

  it("更新换图在途:过期取图落地丢弃,不回退旧图", async () => {
    const c = new OnlineController(HUANYOU.map, "huanyou");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    // 大厅先后切两图:zhongyuan(A,在途)→ sanguo(B,后到);A 的取图最后落地
    x.onMessage(lobbyMsg("zhongyuan"));
    x.onMessage(lobbyMsg("sanguo"));
    expect(x.mapId).toBe("huanyou"); // 两次取图都在途,mapId 未动
    gates.gate("sanguo").resolve(SANGUO);
    await drain();
    expect(x.mapId).toBe("sanguo");
    expect(c.engine.board).toBe(SANGUO.map.board);
    // 过期的 zhongyuan 取图后到:必须整单丢弃(不回退、不换板)
    gates.gate("zhongyuan").resolve(ZHONGYUAN);
    await drain();
    expect(x.mapId).toBe("sanguo");
    expect(c.engine.board).toBe(SANGUO.map.board);
  });

  it("开局前落地(既有语义):整换新图占位壳,等快照水合", async () => {
    const c = new OnlineController(HUANYOU.map, "huanyou");
    const gates = stubLoader(c);
    const x = c as unknown as TestAccess;
    x.onMessage(lobbyMsg("sanguo"));
    expect(x.enteredGame).toBe(false);
    gates.gate("sanguo").resolve(SANGUO);
    await drain();
    expect(x.mapId).toBe("sanguo");
    expect(c.engine.board).toBe(SANGUO.map.board);
    expect(c.engine.players).toHaveLength(2); // 大厅占位壳:缺省 2 座,等首帧快照重建
  });
});
