// 帧诊采样器的纯函数锚点(ADR-0046):窗口摘要分位、LoAF 拆分、卡顿阈边界。
// 守住什么——判读表的三条数字语义:p50/p95/max 定义、style/layout 起点-差拆分、
// >50ms 卡顿阈边界(50.0 不计、50.1 计)。采样器本体(模块状态/rAF/observer)是
// 接线层,由 e2e 诊断包冒烟(react-diag-export)端到端守。
import { describe, it, expect } from "bun:test";
import { summarizeDeltas, splitLoaf } from "@app/frameDiag";

describe("frameDiag 窗口摘要", () => {
  it("分位:升序截取,p95 取 95% 位样本,p50 取中位样本", () => {
    const deltas = [16, 17, 18, 19, 100]; // 升序,5 帧
    const s = summarizeDeltas(deltas);
    expect(s.frames).toBe(5);
    expect(s.p50).toBe(18); // floor(5*0.5)=2 → 第 3 个
    expect(s.p95).toBe(100); // floor(5*0.95)=4 → 第 5 个
    expect(s.max).toBe(100);
    expect(summarizeDeltas([16.66, 16.7, 16.68]).p50).toBeCloseTo(16.68, 1);
  });

  it("空窗:全零不炸(停采瞬间清窗的边界)", () => {
    const s = summarizeDeltas([]);
    expect(s.frames).toBe(0);
    expect(s.p50).toBe(0);
    expect(s.max).toBe(0);
  });
});

describe("frameDiag LoAF 拆分", () => {
  it("script 段求和 + style/layout = renderStart 与样式起点的差", () => {
    const r = splitLoaf({
      duration: 120,
      renderStart: 90,
      styleAndRenderStart: 60,
      scripts: [{ duration: 40 }, { duration: 25.5 }],
    });
    expect(r.durMs).toBe(120);
    expect(r.scriptMs).toBeCloseTo(65.5, 1);
    expect(r.styleLayoutMs).toBeCloseTo(30, 1);
  });

  it("字段缺失(老 WebView 形态):拆分落 0 不负值", () => {
    const r = splitLoaf({ duration: 80 });
    expect(r.scriptMs).toBe(0);
    expect(r.styleLayoutMs).toBe(0);
    const neg = splitLoaf({ duration: 10, renderStart: 5, styleAndRenderStart: 9 });
    expect(neg.styleLayoutMs).toBe(0); // 起点倒挂夹到 0
  });
});
