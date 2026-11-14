// 验证生产缩放双通道的恒等、追帧压缩与非法倍率拒绝。
import { describe, it, expect } from "bun:test";
import { LAG, sc, scStage, setCatchupScale } from "../../src/app/fx/timings";

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
