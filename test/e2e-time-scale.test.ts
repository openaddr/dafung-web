// e2e 时间倍率(票 #114)双契约:
//   工厂缝 — makeScaler 的倍率乘算/地板托底/非法回退语义;
//   生产恒等 — 无 localStorage 键(含 bun test 环境)时全部导出常量与字面量逐位相等,
//   防止未来有人把生产常量误包进缩放路径(地板会把 80ms 级短拍托到 100ms)。
import { describe, it, expect } from "bun:test";
import { Motion } from "../src/core/theme";
import {
  BOT,
  DICE,
  FX,
  MARCH,
  TIME_SCALE_FLOOR_MS,
  makeScaler,
} from "../src/app/fx/timings";

describe("makeScaler(测试倍率缩放工厂)", () => {
  it("倍率 0.25:大件按比例缩,小件被地板托住", () => {
    const sc = makeScaler(0.25);
    expect(sc(1900)).toBe(475);
    expect(sc(1500)).toBe(375);
    expect(sc(460)).toBe(115);
    expect(sc(80)).toBe(TIME_SCALE_FLOOR_MS);
    expect(sc(250)).toBe(TIME_SCALE_FLOOR_MS);
    expect(sc(300)).toBe(TIME_SCALE_FLOOR_MS); // 75 → 托底 100
  });

  it("倍率 0.1:地板成为主要约束", () => {
    const sc = makeScaler(0.1);
    expect(sc(1900)).toBe(190);
    expect(sc(1000)).toBe(TIME_SCALE_FLOOR_MS);
    expect(sc(100)).toBe(TIME_SCALE_FLOOR_MS);
  });

  it("结果经四舍五入取整", () => {
    expect(makeScaler(0.35)(901)).toBe(315); // 315.35 → 315
  });

  it("非法倍率(0/负数/NaN)回退为 1 的语义(仍带地板)", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(makeScaler(bad)(1900)).toBe(1900);
      expect(makeScaler(bad)(80)).toBe(TIME_SCALE_FLOOR_MS);
    }
  });

  it("地板常量为 100ms(headless+软渲下 expect 轮询的可观察下限)", () => {
    expect(TIME_SCALE_FLOOR_MS).toBe(100);
  });
});

describe("生产恒等快照(无倍率键时导出常量逐位等于字面量)", () => {
  it("BOT / MARCH", () => {
    expect(BOT.stepDelayMs).toBe(750);
    expect(MARCH.minSegMs).toBe(80);
    expect(MARCH.maxSegMs).toBe(460);
    expect(MARCH.speed).toBe(720);
    expect(MARCH.segSlackMs).toBe(0);
  });

  it("FX", () => {
    expect(FX.floaterMs).toBe(Motion.dur.fx);
    expect(FX.coinMs).toBe(1500);
    expect(FX.bannerMs).toBe(1900);
    expect(FX.bannerHoldMs).toBe(1000);
    expect(FX.sealMs).toBe(900);
    expect(FX.roadFlowMs).toBe(700);
  });

  it("DICE", () => {
    expect(DICE.minRollMs).toBe(500);
    expect(DICE.hardCapMs).toBe(1500);
    expect(DICE.holdMs).toBe(Motion.dur.reveal);
    expect(DICE.botMinRollMs).toBe(Motion.dur.med);
    expect(DICE.botHardCapMs).toBe(900);
    expect(DICE.botHoldMs).toBe(Motion.dur.slow);
    expect(DICE.fallbackHoldMs).toBe(650);
    expect(DICE.fadeOutMs).toBe(Motion.dur.med);
  });
});
