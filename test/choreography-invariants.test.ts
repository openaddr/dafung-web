// 编排不变量锁定(#117 收编批次):JS 侧编排时长唯一收口 fx/timings.ts(生产常量经 sc
// 包裹,无 localStorage 键时逐位等于字面量),CSS 侧时长唯一源 core/theme.ts Motion
// (经 gen:theme 产出 tokens.css)。本测试钉死常量「之间」的编排关系,防止调参或后续
// 收编时悄悄破坏演出语义:
//   横幅 — FX.bannerMs 必须大于 CSS 演出全长 Motion.dur.banner(余量为正,播完有余再清),
//          FX.bannerHoldMs 必须小于 FX.bannerMs(停留窗是编排窗的子区间);
//   骰子 — DICE.holdMs + DICE.fadeOutMs ≥ 300(timings.ts X5 注释原文:任何掷骰结束后
//          都有 ≥300ms 可读结果);
//   行军/bot — 段时长夹取区间必须有序、bot 回合节奏必须真实等待;
//   倍率地板 — TIME_SCALE_FLOOR_MS ≥ 100(headless+软渲的可观察下限不被悄悄调低)。
// 数值本身的逐位锁定在 test/e2e-time-scale.test.ts(生产恒等快照),本文件只管关系。
import { describe, it, expect } from "bun:test";
import { BOT, DICE, FX, MARCH, TIME_SCALE_FLOOR_MS } from "../src/app/fx/timings";
import { Motion } from "../src/core/theme";

describe("编排不变量(fx/timings.ts 收口与 core/theme.ts Motion 的关系)", () => {
  it("横幅余量为正:FX.bannerMs > Motion.dur.banner(CSS 演出播完有余再清)", () => {
    expect(FX.bannerMs).toBeGreaterThan(Motion.dur.banner);
  });

  it("横幅停留窗是编排窗的子区间:FX.bannerHoldMs < FX.bannerMs", () => {
    expect(FX.bannerHoldMs).toBeLessThan(FX.bannerMs);
  });

  it("骰子可读结果:DICE.holdMs + DICE.fadeOutMs >= 300(X5:任何掷骰结束后有 ≥300ms 可读结果)", () => {
    expect(DICE.holdMs + DICE.fadeOutMs).toBeGreaterThanOrEqual(300);
  });

  it("行军段时长夹取区间有序:MARCH.minSegMs < MARCH.maxSegMs", () => {
    expect(MARCH.minSegMs).toBeLessThan(MARCH.maxSegMs);
  });

  it("bot 回合节奏真实等待:BOT.stepDelayMs > 0", () => {
    expect(BOT.stepDelayMs).toBeGreaterThan(0);
  });

  it("倍率地板不被悄悄调低:TIME_SCALE_FLOOR_MS >= 100", () => {
    expect(TIME_SCALE_FLOOR_MS).toBeGreaterThanOrEqual(100);
  });
});
