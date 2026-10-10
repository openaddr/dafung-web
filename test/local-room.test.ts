// 单机通路单测(#398 单机统一 B):LocalController = 进程内房间编排(scripts/room.ts
// RoomRegistry)+ MemorySocket 内存双工。断言面:
//   ① 构造即经房间编排就位(startGame 同步段建引擎 + bot 选都驱动到人类);
//   ② 命令真的走内存双工上行(setupPickCapital → room.pickCapital 生效),
//      下行拍(events 先行)驱动 netStore 暂存通道与 store 快照;
//   ③ 托管上行经房间 driveBots 代打推进对局;
//   ④ 单机不启用联机读口(netStore 房间字段恒空,useCapitalPick/ConnectionBanner
//      的 solo 分支由空 roomId 门控);
//   ⑤ 销毁即进程内解散(在途看门狗随房清撤,对局不再自行推进)。
// 演出链(DOM/音频)在 bun 内缺席:生产 sink 的 DOM 触点全在 present 异步段,
// 由 SnapshotEffects 捕获报错;IndexedDB 缺席由 gameLogArchive 队列捕获报错——
// 状态断言不受影响(慢机/负载下真定时器用例吃 CPU,故显式放宽单测预算)。
import { describe, it, expect } from "bun:test";
import { MAP } from "../scripts/engine-helpers";
import { LocalController } from "../src/app/controllers/local";
import { useGameStore } from "../src/app/store/gameStore";
import { useNetStore } from "../src/app/store/netStore";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** seed 7:人类先手(react-helpers 离线核算同源),构造返回即停在人类选都三选一。 */
function makeController(): LocalController {
  return new LocalController(MAP, {
    seats: [
      { name: "诸侯1", isBot: false, guohao: "魏" },
      { name: "诸侯2", isBot: true },
      { name: "诸侯3", isBot: true },
    ],
    seed: 7,
    mapId: "sanguo",
  });
}

describe("单机通路(#398):进程内房间编排 + 内存双工", () => {
  it("开局:构造即经房间编排就位(引擎在 Setup 等人类选都,bot 选都已被房间驱动)", () => {
    const c = makeController();
    try {
      const e = c.engine;
      expect(e.phase).toBe("Setup");
      expect(e.setupPhase).toBe("PickCapital");
      expect(e.currentSetupPlayerIndex).toBe(0); // 人类先手:构造同步段 bot 无都可选
      expect(e.offeredCapitals.length).toBe(3);
      expect(useGameStore.getState().snapshot?.phase).toBe("Setup");
      expect(c.viewSeat).toBe(0);
      expect(c.interactive).toBe(false); // Setup 非决策交互态(选都走 setupPickCapital)
    } finally {
      c.destroy();
    }
  }, 20_000);

  it("选都走内存双工:上行进 room.pickCapital,下行拍推进到 Playing 并驱动事件通道", async () => {
    const c = makeController();
    try {
      const tile = c.engine.offeredCapitals[0]!;
      c.setupPickCapital(tile);
      // 内存双工命令同步生效(无网络时延),下行拍经 setTimeout(0) 合并——等一拍
      await sleep(100);
      expect(c.engine.phase).toBe("Playing");
      expect(useGameStore.getState().snapshot?.phase).toBe("Playing");
      expect(useNetStore.getState().eventBatchSeq).toBeGreaterThan(0); // events 通道已驱动
      expect(c.interactive).toBe(true); // 轮到人类(seed 7 首回合),无在途命令
    } finally {
      c.destroy();
    }
  }, 20_000);

  it("托管走内存双工:setAutoPilot 上行,房间 driveBots 代打推进对局", async () => {
    const c = makeController();
    try {
      c.setupPickCapital(c.engine.offeredCapitals[0]!);
      await sleep(100);
      expect(c.autoPilotOn).toBe(false);
      c.setAutoPilot(true, "fast");
      await sleep(100);
      expect(c.autoPilotOn).toBe(true);
      // 代打推进:setAutoPilot 即接 driveBots(座位受控,无看门狗等待),轮次前进
      const turn0 = c.engine.turnNumber;
      let advanced = false;
      for (let i = 0; i < 100 && !advanced; i++) {
        await sleep(100);
        advanced = c.engine.turnNumber > turn0 || c.engine.isOver;
      }
      expect(advanced).toBe(true);
    } finally {
      c.destroy();
    }
  }, 30_000);

  it("单机不启用联机读口:netStore 房间字段恒空(大厅/断线横幅/联机选都分支不被激活)", async () => {
    const c = makeController();
    try {
      c.setupPickCapital(c.engine.offeredCapitals[0]!);
      await sleep(100);
      const net = useNetStore.getState();
      expect(net.roomId).toBe("");
      expect(net.connection).toBe("idle");
      expect(net.mySeat).toBe(-1);
    } finally {
      c.destroy();
    }
  }, 20_000);

  it("销毁:进程内房间解散,在途看门狗随房清撤(销毁后对局不再自行推进)", async () => {
    const c = makeController();
    c.setupPickCapital(c.engine.offeredCapitals[0]!);
    await sleep(100);
    expect(c.engine.phase).toBe("Playing");
    c.destroy();
    // 人类 Roll 等待态的 #188 自动起摇看门狗已随 dismissRoom 撤表:对局停摆即正确
    const turn = c.engine.turnNumber;
    await sleep(1500); // 大于 AUTO_ROLL_DELAY_MS(1s):若看门狗未被清,此处必推进
    expect(c.engine.turnNumber).toBe(turn);
    expect(useNetStore.getState().eventBatchSeq).toBe(0); // 事件面已归零(destroy)
  }, 20_000);
});
