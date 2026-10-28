// bot 步进配速接线(#730,ADR-0034):SoloRoomConfig.botStepMs → 房间编排
// driveBots 的步进延迟。观测缝 = 注入时钟收到的 setTimeout 延迟值与链停点:
//   ① 配速 > 0:bot 落子后驱动链向时钟要一个同值定时器(链在步间挂起,选都
//      不再同步跑完——构造返回时仍轮到下一位 bot);
//   ② 配速 = 0:无配速定时器,bot 选都在构造同步段跑完(既有用例预算语义)。
// 助手按文件自持(缝约定):RecordingClock 只记 setTimeout 延迟,不点火。
import { describe, expect, it } from "bun:test";
import type { WorkerClock } from "@app/net/worker-clock";
import { LocalController } from "../src/app/controllers/local";
import { MAP } from "../scripts/engine-helpers";

class RecordingClock implements WorkerClock {
  readonly delays: number[] = [];
  setTimeout(cb: () => void, ms: number): unknown {
    this.delays.push(ms);
    void cb;
    return {};
  }
  clearTimeout(): void {}
  pause(): void {}
  resume(): void {}
  get paused(): boolean {
    return false;
  }
  dispose(): void {}
  onFatal(): void {}
}

function makeController(clock: RecordingClock, botStepMs: number): LocalController {
  return new LocalController(
    MAP,
    {
      seats: [
        { name: "诸侯1", isBot: false, guohao: "魏" },
        { name: "诸侯2", isBot: true },
        { name: "诸侯3", isBot: true },
      ],
      seed: 1,
      mapId: "huanyou",
      botStepMs,
    },
    clock,
  );
}

describe("bot 步进配速接线(#730,ADR-0034)", () => {
  it("配速 >0:bot 落子后驱动链按同值延迟向时钟要步进定时器,选都不再同步跑完", () => {
    const clock = new RecordingClock();
    const c = makeController(clock, 600);
    try {
      // seed 1 选都序 = bot1 → bot2 → 人类:构造同步段 bot1 落子后链挂起在配速定时器上
      expect(clock.delays).toContain(600);
      expect(c.engine.currentSetupPlayerIndex).not.toBe(0); // 链未跑完:还没轮到人类
    } finally {
      c.destroy();
    }
  });

  it("配速 = 0:无步进定时器,bot 选都在构造同步段跑完(轮到人类)", () => {
    const clock = new RecordingClock();
    const c = makeController(clock, 0);
    try {
      expect(clock.delays).not.toContain(600);
      expect(c.engine.currentSetupPlayerIndex).toBe(0); // 两个 bot 已落子,等人类
    } finally {
      c.destroy();
    }
  });
});
