// 幽灵帧规则单测(#107 批次 6 C6):useGhostChild 的「身份变化是否生成幽灵帧」判定
// 已提为纯函数 shouldGhost,此处只测纯规则。React 组件的挂载/210ms 定时/让位出列
// 属渲染时序,bun test 无 DOM 不能直渲,不在本文件覆盖范围——由 e2e
// react-scrolls / react-online / 速战档兜住。
import { describe, it, expect } from "bun:test";
import { shouldGhost } from "../src/app/screens/game/scroll/useGhostChild";

// 协议里 sig 只是子节点身份(组件函数引用),用两个稳定函数引用模拟「同型/异型」;
// 不 import 真卷轴组件——那会连带 css/音频等浏览器侧副作用,单测不需要。
const SigA = function ScrollA() {
  return null;
};
const SigB = function ScrollB() {
  return null;
};

describe("shouldGhost(幽灵帧生成纯规则)", () => {
  it("非空 → 清空:生成幽灵帧(唯一生成路径)", () => {
    expect(shouldGhost(SigA, null)).toBe(true);
  });

  it("非空 → 非空(同型):不生成——同型是重渲染,无退场可言", () => {
    expect(shouldGhost(SigA, SigA)).toBe(false);
  });

  it("非空 → 非空(异型):不生成,仅清空退出才演——A→B 并存幽灵会吞真实点击(#90 e2e 事故)", () => {
    expect(shouldGhost(SigA, SigB)).toBe(false);
  });

  it("skip = true:不生成——全屏覆盖类(胜利屏)的退场帧会多压 210ms", () => {
    expect(shouldGhost(SigA, null, { skip: true })).toBe(false);
  });

  it("空 → X:不生成——没有可退场的上一帧", () => {
    expect(shouldGhost(null, SigB)).toBe(false);
  });

  it("空 → 空:不生成(首帧/空转)", () => {
    expect(shouldGhost(null, null)).toBe(false);
  });

  it("skip 只压制生成,不改变其余路径的既有 false 结果", () => {
    expect(shouldGhost(SigA, SigB, { skip: true })).toBe(false);
    expect(shouldGhost(SigA, SigA, { skip: true })).toBe(false);
    expect(shouldGhost(null, SigB, { skip: true })).toBe(false);
  });

  it("opts 缺省/空对象视同不跳过", () => {
    expect(shouldGhost(SigA, null, {})).toBe(true);
    expect(shouldGhost(SigA, null, { skip: false })).toBe(true);
    expect(shouldGhost(SigA, null, { skip: undefined })).toBe(true);
  });
});
