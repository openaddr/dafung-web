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
  const cfg: EngineConfig = { seats: BOT_SEATS, targetNetWorth: 6000 };
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

describe("快照契约:本地直跑 vs 恢复续跑(单机↔联机同轨)", () => {
  it("每步恢复 round-trip 后快照逐字段一致(联机每帧走的就是这条路)", () => {
    const a = makeEngine(7);
    finishSetup(a);
    let steps = 0;
    let guard = 0;
    while (!a.isOver && guard++ < 500) {
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
  });

  it("中点恢复后独立续跑到终局,终态与直跑完全一致", () => {
    // 路径 A:一台引擎直跑到底
    const a = makeEngine(13);
    finishSetup(a);
    let n = 0;
    let guard = 0;
    while (!a.isOver && guard++ < 500) {
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
    expect(JSON.stringify(fb.log)).toBe(JSON.stringify(fa.log));
  });
});
