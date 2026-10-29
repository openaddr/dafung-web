// e2e 时间倍率(票 #114)双契约:
//   工厂缝 — makeScaler 的倍率乘算/地板托底/非法回退语义;
//   生产恒等 — 无 localStorage 键(含 bun test 环境)时全部导出常量与字面量逐位相等,
//   防止未来有人把生产常量误包进缩放路径(地板会把 80ms 级短拍托到 100ms)。
import { describe, it, expect } from "bun:test";
import { Motion } from "../src/core/theme";
import {
  AUTO_MARCH,
  DICE,
  FX,
  GHOST,
  LAG,
  MARCH,
  UI,
  TIME_SCALE_FLOOR_MS,
  makeScaler,
  sc,
  scStage,
  setCatchupScale,
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
  it("MARCH", () => {
    expect(MARCH.minSegMs).toBe(80);
    expect(MARCH.maxSegMs).toBe(460);
    expect(MARCH.speed).toBe(720);
    expect(MARCH.segSlackMs).toBe(0);
  });

  it("FX", () => {
    expect(FX.floaterMs).toBe(Motion.dur.fx);
    expect(FX.coinMs).toBe(1500);
    expect(FX.bannerMs).toBe(1400); // #762 两段式全长:--dur-banner/2(900)+--dur-slow(400)+100 余量
    expect(FX.bannerHoldMs).toBe(1000);
    expect(FX.sealMs).toBe(900);
    expect(FX.roadFlowMs).toBe(700);
  });

  it("DICE", () => {
    expect(DICE.holdMs).toBe(Motion.dur.reveal);
    expect(DICE.botHoldMs).toBe(Motion.dur.slow);
    expect(DICE.fadeOutMs).toBe(Motion.dur.med);
  });

  it("GHOST / UI(#117 收编组同样逐位恒等)", () => {
    expect(GHOST.frameMs).toBe(210);
    expect(UI.hintTtlMs).toBe(1800);
    expect(UI.statusClearMs).toBe(1500);
    expect(UI.victoryButtonMs).toBe(1800);
    expect(UI.copyFeedbackMs).toBe(1000);
  });

  it("AUTO_MARCH(#188 行军自动化:1s 起摇 + 0.8s 起签)", () => {
    expect(AUTO_MARCH.rollAtMs).toBe(1000);
    expect(AUTO_MARCH.qiqianMs).toBe(800);
  });

  it("LAG(#610 落后即校准判据,#730/ADR-0034 再定标:阈值高于配速后正常局水位;ageMs 吃 sc,批数/倍率无量纲)", () => {
    expect(LAG.gapBatches).toBe(5);
    expect(LAG.ageMs).toBe(20000);
    expect(LAG.consecutiveForSnap).toBe(6);
    expect(LAG.scaleMin).toBe(1.5);
    expect(LAG.scaleMax).toBe(3);
    expect(LAG.scaleStep).toBe(0.5);
  });
});

describe("追帧运行时速度倍率(#610:演出编排 scStage = e2e 基准 ÷ 倍率,除法活合成)", () => {
  it("倍率 1 恒等直通(生产常态,不落地板);两通道在 1 处逐位重合", () => {
    setCatchupScale(1);
    expect(sc(80)).toBe(80);
    expect(scStage(80)).toBe(80);
    expect(scStage(750)).toBe(750);
  });

  it("追帧方向 = 压缩(#570 决议正典「积压越深播得越快」):倍率升,时长单调降", () => {
    try {
      setCatchupScale(LAG.scaleMin);
      expect(scStage(600)).toBe(400); // 600÷1.5:1.5× 速播
      expect(scStage(80)).toBe(53); // 80÷1.5≈53:短拍真实压缩(追帧不落地板)
      setCatchupScale(LAG.scaleMax);
      expect(scStage(600)).toBe(200); // 600÷3:顶格 3×
      expect(scStage(80)).toBe(27);
      // 方向钉死(评审实锤旧实现乘进时长=积压时更慢,倒向防假绿):顶格时长 < 起步时长 < 原长
      expect(scStage(600)).toBeLessThan(400);
      expect(400).toBeLessThan(600);
      // 追帧不进 e2e 通道:sc 恒只随 e2e 键(倒计时弧/UI TTL/GHOST 族不受追帧牵动)
      expect(sc(600)).toBe(600);
    } finally {
      setCatchupScale(1); // 全局态复原,防跨用例泄漏
    }
  });

  it("非法倍率(非有限值/<1)当场炸(零兜底;<1 = 减速,与追帧语义相反)", () => {
    expect(() => setCatchupScale(0.5)).toThrow();
    expect(() => setCatchupScale(Number.NaN)).toThrow();
    setCatchupScale(1); // 炸后全局态不受污染
  });
});
