// #699 棋盘手势纯数学:锚点缩放 / 捏合帧 / 拖拽阈值 / 唯一 clamp。
// 分工:e2e(react-board-gesture.spec.ts,headless CDP 触摸)守端到端接线与中心
// 捏合;非中点锚的精确不动点、阈值边界与缩放夹界上下限在此以纯函数钉死——
// pinch 的 AC 验证通路 = 本单测(数学)+ e2e(接线),两半合一。
import { describe, it, expect } from "bun:test";
import {
  clampViewBox,
  zoomAt,
  pinchFrame,
  beyondDragThreshold,
  DRAG_THRESHOLD_PX,
  type ViewBox,
} from "../src/app/components/board/usePanZoom";

const RECT = { left: 100, top: 50, width: 800, height: 500 };
const FIT: ViewBox = { x: 0, y: 0, w: 1000, h: 600 };

describe("zoomAt(锚点缩放;wheel/pinch/zoomBy 三通路同源)", () => {
  it("锚点下的世界点缩放前后不动(不动点性质)", () => {
    const v: ViewBox = { x: -120, y: 40, w: 900, h: 540 };
    const ax = 0.3,
      ay = 0.75;
    const before = { x: v.x + ax * v.w, y: v.y + ay * v.h };
    const next = zoomAt(v, ax, ay, 0.6);
    expect(next.x + ax * next.w).toBeCloseTo(before.x, 9);
    expect(next.y + ay * next.h).toBeCloseTo(before.y, 9);
  });

  it("中心锚 = 视口中心不动(zoomBy 口径;letterboxing 不影响中心点)", () => {
    const v: ViewBox = { x: 10, y: -30, w: 800, h: 500 };
    const next = zoomAt(v, 0.5, 0.5, 1.25);
    expect(next.x + next.w / 2).toBeCloseTo(v.x + v.w / 2, 9);
    expect(next.y + next.h / 2).toBeCloseTo(v.y + v.h / 2, 9);
  });

  it("factor<1 放大(w 变小),factor>1 缩小(w 变大)", () => {
    const v: ViewBox = { x: 0, y: 0, w: 800, h: 480 };
    expect(zoomAt(v, 0.5, 0.5, 0.8).w).toBeLessThan(v.w);
    expect(zoomAt(v, 0.5, 0.5, 1.25).w).toBeGreaterThan(v.w);
  });
});

describe("pinchFrame(捏合帧:距离比 + 中点锚)", () => {
  it("factor = 上一帧距/本帧距:两指张开(距离拉大)= 放大", () => {
    const f = pinchFrame(100, { x: 300, y: 250 }, { x: 500, y: 250 }, RECT);
    expect(f.factor).toBe(0.5); // 张开 → factor<1 → viewBox 变小 = 放大(与 wheel 同向)
    expect(f.dist).toBe(200);
  });

  it("锚点 = 两指中点的归一化坐标", () => {
    const f = pinchFrame(100, { x: 180, y: 150 }, { x: 340, y: 250 }, RECT);
    expect(f.ax).toBeCloseTo((260 - 100) / 800, 12);
    expect(f.ay).toBeCloseTo((200 - 50) / 500, 12);
  });
});

describe("beyondDragThreshold(#699 拍板:位移超过 8px 判拖拽)", () => {
  it("阈值常量 = 8px", () => {
    expect(DRAG_THRESHOLD_PX).toBe(8);
  });

  it("位移恰 8px 不判拖拽(短触=普通点击),超过才判", () => {
    expect(beyondDragThreshold(0, 0, 8, 0)).toBe(false);
    expect(beyondDragThreshold(0, 0, 5, 5)).toBe(false); // hypot ≈ 7.07
    expect(beyondDragThreshold(0, 0, 6, 6)).toBe(true); // hypot ≈ 8.49
    expect(beyondDragThreshold(100, 200, 92, 200)).toBe(false); // 任意按下点
  });
});

describe("clampViewBox(唯一 clamp;缩放界与滚轮/按钮同源)", () => {
  it("放大下限 = fit.w/MAX_ZOOM(8×),pinch 不可能突破", () => {
    const next = clampViewBox(zoomAt(FIT, 0.5, 0.5, 0.001), FIT);
    expect(next.w).toBeCloseTo(FIT.w / 8, 9);
    expect(next.h).toBeCloseTo(FIT.h / 8, 9);
  });

  it("缩小上限 = fit(1× 总览)", () => {
    const next = clampViewBox(zoomAt(FIT, 0.5, 0.5, 40), FIT);
    expect(next.w).toBe(FIT.w);
    expect(next.h).toBe(FIT.h);
  });
});
