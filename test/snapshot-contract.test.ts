// 快照契约单测(单机↔联机一致性保障):
// 联机客户端的唯一工作方式就是「restoreFromSnapshot 重 hydrate 后继续」——
// 本测试把这条路在单机里跑满:同一 seed 的两台引擎,一台本地直跑(单机路径),
// 另一台每步都从对方的 snapshot 恢复出来再独立续跑(联机路径),
// 断言任意步、以及终局,两者的完整快照逐字段一致。
// 序列化丢字段 / RNG 状态不同步 / 恢复后行为分叉,都会在此第一时间炸出。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import { SNAPSHOT_FIELDS, type GameSnapshot } from "@core/snapshot";
import { testEngine } from "@core/testing";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

/** 全 bot 座位:驱动完全确定(种子固定),无需人类命令注入。 */
const BOT_SEATS: SeatConfig[] = [
  { name: "A", isBot: true, guohao: "魏" },
  { name: "B", isBot: true, guohao: "蜀" },
  { name: "C", isBot: true, guohao: "吴" },
];

function makeEngine(seed: number): GameEngine {
  const cfg: EngineConfig = { seats: BOT_SEATS, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(bot 自动)。 */
function finishSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) e.aiSetupStep();
}

/** 驱动一歩对局(botAct);引擎内部过渡相位返回 false 表示本步无输入可驱动。 */
function stepPlaying(e: GameEngine): boolean {
  if (e.phase !== "Playing" || e.isOver) return false;
  botAct(e);
  return true;
}

/** 日志可比视图:剔除非确定字段——ts=墙钟时间;局头行的 gameId/startedAt=引擎实例标识
 *  (ADR-0014 起 LogEvent 携带 ts,header 行内嵌 gameId/startedAt;两台独立构造的引擎
 *  这些值必然不同,序列化保真断言应剔除后比较)。 */
function comparableLog(log: GameEngine["log"]) {
  return log.map(({ ts, ...rest }) => ({
    ...rest,
    detail: rest.detail
      .replace(/"gameId":"[^"]*"/g, '"gameId":""')
      .replace(/"startedAt":\d+/g, '"startedAt":0'),
  }));
}

/** 驱动当前玩家落定一座无主可购城,进入 AwaitingDecision(决策上下文在快照里的测试态)。 */
function armBuyDecision(e: GameEngine): { tilePropertyId: string } {
  const t = testEngine(e);
  const tile = e.board.tiles.find(
    (x) =>
      x.type === "Property" &&
      x.propertyId != null &&
      e.findOwner(x.propertyId) == null &&
      !e.board.getBranchStart(x.index),
  )!;
  const tilePropertyId = tile.propertyId!; // 谓词已保证非空
  e.activePlayer.cash = 99999; // 买得起 + 起手 3 委任状 → 购地/不取两真选,必进决策相位
  t.landActiveAt(tile.index);
  expect(e.turnPhase).toBe("AwaitingDecision");
  expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: tilePropertyId });
  return { tilePropertyId };
}

describe("快照契约:本地直跑 vs 恢复续跑(单机↔联机同轨)", () => {
  // 超时放宽到 30s:每步「新引擎+restore+双份全量快照 stringify」成本随步数平方增长,
  // 锦囊发牌(#122)使骰流偏移、本 seed 对局步数变长——契约语义不变,只给足墙钟。
  it("每步恢复 round-trip 后快照逐字段一致(联机每帧走的就是这条路)", () => {
    const a = makeEngine(7);
    finishSetup(a);
    let steps = 0;
    let guard = 0;
    while (!a.isOver && guard++ < 5000) { // 经济 v2 目标 30000:终局步数远超旧 500 上限
      if (stepPlaying(a)) {
        steps++;
        // 联机路径:全新引擎 + restoreFromSnapshot(与 online.ts hydrate 同款)
        const mirror = makeEngine(7); // 种子无关紧要:恢复会覆盖 rngState
        mirror.restoreFromSnapshot(a.snapshot());
        expect(JSON.stringify(mirror.snapshot())).toBe(JSON.stringify(a.snapshot()));
      }
    }
    expect(a.isOver).toBe(true);
    expect(steps).toBeGreaterThan(20); // 确保真的跑了对局,而非空转即结束
  }, 30_000);

  it("序列化单点清单:serializeGame 产出键集 = SNAPSHOT_FIELDS 清单键集(双向)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const produced = Object.keys(e.snapshot()).sort();
    const manifest = SNAPSHOT_FIELDS.map((f) => f.key).sort();
    // 产出 → 清单:每个序列化键都登记在册(防「加了字段忘了清单」)
    // 清单 → 产出:清单中每个键都真实出现在产出里(防「清单记了字段忘了产出」)
    expect(produced).toEqual(manifest);
  });

  it("决策上下文 round-trip:pendingLand 单点重建,镜像端可继续购地(旧序列化缺口回归)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const { tilePropertyId } = armBuyDecision(e);
    // 联机路径:恢复到同构新引擎,决策上下文由 pendingLand 自身字段单点重建
    const mirror = makeEngine(1); // 种子无关紧要:恢复会覆盖 rngState
    mirror.restoreFromSnapshot(e.snapshot());
    expect(JSON.stringify(mirror.snapshot())).toBe(JSON.stringify(e.snapshot()));
    expect(mirror.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: tilePropertyId });
    expect(mirror.turnPhase).toBe("AwaitingDecision");
    // 恢复后决策命令可续:镜像端直接购地成功(决策不再依赖表现态 lastLandOutcome)
    mirror.buyProperty();
    expect(
      mirror.activePlayer.properties.some((h) => h.propertyId === tilePropertyId),
    ).toBe(true);
  });

  it("零兜底:快照 pendingLand 指向 catalog 之外的城 → restore 显式抛错(不静默丢决策)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    armBuyDecision(e);
    const broken: GameSnapshot = {
      ...e.snapshot(),
      pendingLand: { kind: "PropertyAvailable", propertyId: "prop-not-in-catalog" },
    };
    const mirror = makeEngine(1);
    expect(() => mirror.restoreFromSnapshot(broken)).toThrow("pendingLand");
  });

  it("中点恢复后独立续跑到终局,终态与直跑完全一致", () => {
    // 路径 A:一台引擎直跑到底
    const a = makeEngine(13);
    finishSetup(a);
    let n = 0;
    let guard = 0;
    while (!a.isOver && guard++ < 5000) { // 经济 v2 目标 30000:终局步数远超旧 500 上限
      if (stepPlaying(a)) n++;
    }
    expect(a.isOver).toBe(true);

    // 路径 B:跑到中点,从快照恢复出一台新引擎,由它独立跑完剩下的路
    const b1 = makeEngine(13);
    finishSetup(b1);
    let half = 0;
    guard = 0;
    while (half < Math.floor(n / 2) && guard++ < 500) {
      if (stepPlaying(b1)) half++;
    }
    const b2 = makeEngine(13);
    b2.restoreFromSnapshot(b1.snapshot());
    guard = 0;
    while (!b2.isOver && guard++ < 500) {
      stepPlaying(b2);
    }
    expect(b2.isOver).toBe(true);

    // 终局快照(剔除与玩法无关的瞬时字段——若快照里有)必须逐字段一致
    const fa = a.snapshot();
    const fb = b2.snapshot();
    expect(fb.phase).toBe(fa.phase);
    expect(fb.isOver).toBe(fa.isOver);
    expect(fb.winReason).toBe(fa.winReason);
    expect(JSON.stringify(fb.players)).toBe(JSON.stringify(fa.players));
    expect(fb.turnNumber).toBe(fa.turnNumber);
    // 日志:ts/局头实例标识(gameId/startedAt)非确定,剔后逐字段一致
    expect(JSON.stringify(comparableLog(fb.log))).toBe(JSON.stringify(comparableLog(fa.log)));
  });
});
