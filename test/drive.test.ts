// 驱动仲裁器单测(Wave 2-A):busy 布尔收口后的正确性契约——
// 互斥(并发 requestDrive 串行执行)、FIFO(释放后队首继续)、
// 防重入(同 kind 排队去重)、isDriving 状态、release 幂等。
// 每个用例新建独立仲裁器(实例态,与 local.ts 的 per-controller 用法一致)。
import { describe, it, expect } from "bun:test";
import { createDriveArbiter, type DriveKind } from "../src/app/controllers/drive";

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("DriveArbiter(驱动仲裁器)", () => {
  it("空闲时同步占用:requestDrive 返回前 isDriving 已为真(旧 busy 同步置位语义)", () => {
    const d = createDriveArbiter();
    const p = d.requestDrive("human");
    // 不 await:锁占用必须发生在调用返回前,否则 interactive 检查与锁之间存在间隙。
    expect(d.isDriving()).toBe(true);
    expect(d.activeKind()).toBe("human");
    void p.then((s) => s.release());
  });

  it("互斥:并发 requestDrive 串行执行,任意时刻至多一个会话活跃", async () => {
    const d = createDriveArbiter();
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const kinds: DriveKind[] = ["enter", "human", "autopilot"];
    await Promise.all(
      kinds.map(async (k) => {
        const s = await d.requestDrive(k);
        running++;
        maxRunning = Math.max(maxRunning, running);
        events.push(`start:${k}`);
        await tick();
        events.push(`end:${k}`);
        running--;
        s.release();
      }),
    );
    expect(maxRunning).toBe(1);
    expect(d.isDriving()).toBe(false);
    // 各任务内部 start→end 不交错
    for (const k of kinds) {
      expect(events.indexOf(`start:${k}`)).toBeLessThan(events.indexOf(`end:${k}`));
    }
  });

  it("FIFO:释放后队首立即继续,顺序=请求顺序", async () => {
    const d = createDriveArbiter();
    const order: string[] = [];
    const run = async (k: DriveKind) => {
      const s = await d.requestDrive(k);
      order.push(k);
      await tick();
      s.release();
    };
    const ps = [run("enter"), run("human"), run("autopilot")];
    await tick(); // 让三者都完成入队
    expect(order).toEqual(["enter"]); // 首位活跃,其余排队
    await Promise.all(ps);
    expect(order).toEqual(["enter", "human", "autopilot"]);
    expect(d.isDriving()).toBe(false);
    expect(d.activeKind()).toBeNull();
  });

  it("防重入:同 kind 已在队列时复用同一 Promise(去重,不产生第二个排队者)", async () => {
    const d = createDriveArbiter();
    const s1 = await d.requestDrive("human");
    const p2 = d.requestDrive("human"); // 排队
    const p3 = d.requestDrive("human"); // 去重:应复用 p2
    expect(p2).toBe(p3);
    s1.release();
    const [s2, s3] = await Promise.all([p2, p3]);
    expect(s2).toBe(s3); // 同一会话句柄
    expect(d.activeKind()).toBe("human");
    s2.release();
    expect(d.isDriving()).toBe(false);
  });

  it("不同 kind 不去重:各自排队,依次获得会话", async () => {
    const d = createDriveArbiter();
    const s1 = await d.requestDrive("human");
    const pA = d.requestDrive("autopilot");
    const pB = d.requestDrive("enter");
    expect(pA).not.toBe(pB);
    s1.release();
    const sA = await pA;
    expect(d.activeKind()).toBe("autopilot");
    sA.release();
    const sB = await pB;
    expect(d.activeKind()).toBe("enter");
    sB.release();
    expect(d.isDriving()).toBe(false);
  });

  it("release 幂等:重复/迟到释放不误杀后续会话", async () => {
    const d = createDriveArbiter();
    const s1 = await d.requestDrive("human");
    s1.release();
    s1.release(); // 幂等
    expect(d.isDriving()).toBe(false);
    const p2 = d.requestDrive("autopilot");
    const s2 = await p2;
    expect(d.activeKind()).toBe("autopilot");
    s1.release(); // 迟到的旧句柄:不得影响 s2
    expect(d.activeKind()).toBe("autopilot");
    s2.release();
    expect(d.isDriving()).toBe(false);
  });
});
