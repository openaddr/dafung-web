// #699 棋盘触控手势:双指捏合缩放 + 单指拖拽平移(8px 阈值判拖,拖拽全程不触发落格)。
// 触摸通路:CDP Input.dispatchTouchEvents——Chromium 输入管线据此合成 PointerEvent,
// 与真机 touch→pointer 同路(svg 的 touchAction:none 已禁浏览器原生手势接管)。
// 分工:捏合的锚点/阈值/夹界数学在 test/pan-zoom.test.ts(纯函数);本 spec 守
// 端到端接线——手势驱动 viewBox、click 抑制、浮层区事件不穿透。
// 滚轮缩放/空白处鼠标拖拽的既有通路由 react-board.spec.ts 守,此处不重复。
import { test, expect, type Page } from "./fixtures";
import { quickStart } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

type TouchPhase = "touchStart" | "touchMove" | "touchEnd";

/** CDP 触摸驱动:points 为全量活跃触点(CSS 像素,同 boundingBox 坐标系)。 */
async function touchDriver(page: Page) {
  const client = await page.context().newCDPSession(page);
  return (type: TouchPhase, points: { x: number; y: number }[]) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 0.5 })),
    });
}

/** 读当前 viewBox(x/y/w/h 数值数组;#board 无 viewBox = 断言前提崩,当场炸出)。 */
async function readVb(page: Page): Promise<number[]> {
  const raw = await page.locator("#board").getAttribute("viewBox");
  if (raw == null) throw new Error("#board 无 viewBox 属性");
  return raw.split(/\s+/).map(Number);
}

test("单指拖拽(城池起手 >8px):平移生效且不触发落格点击", async ({ page }) => {
  test.slow(); // 操作时序余量(同 react-board 口径)
  await quickStart(page);
  const svg = page.locator("#board");
  const vb0 = (await readVb(page)).join(" ");
  // 城池起手:#699 前该场景既不平移(早期返回)还会在收尾误触落格点击
  const tile = (await svg.locator(".bv-tile").first().boundingBox())!;
  const cx = tile.x + tile.width / 2;
  const cy = tile.y + tile.height / 2;
  const touch = await touchDriver(page);
  await touch("touchStart", [{ x: cx, y: cy }]);
  await touch("touchMove", [{ x: cx - 40, y: cy - 30 }]); // 跨过 8px 阈值,进入拖拽
  await touch("touchMove", [{ x: cx - 90, y: cy - 60 }]);
  await touch("touchEnd", []);
  await expect.poll(async () => (await readVb(page)).join(" "), { timeout: 5_000 }).not.toBe(vb0);
  // 拖拽全程不触发落格点击:城池详情卷轴不得弹出(点击正路有没有坏,由下一例守)
  await expect(page.getByTestId(SCROLL_TESTIDS.tileDetailScroll)).not.toBeVisible();
});

test("短触城池(位移 <8px 松开)= 普通点击,详情卷轴照常弹出", async ({ page }) => {
  test.slow();
  await quickStart(page);
  const tile = (await page.locator("#board .bv-tile").first().boundingBox())!;
  const touch = await touchDriver(page);
  // 零位移点触:不上跨阈值,click 正路放行(行为零变化)
  await touch("touchStart", [{ x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }]);
  await touch("touchEnd", []);
  await expect(page.getByTestId(SCROLL_TESTIDS.tileDetailScroll)).toBeVisible();
});

test("双指捏合:中点锚缩放,张开放大/闭合缩小,极端张开夹到 8× 下限", async ({ page }) => {
  test.slow();
  await quickStart(page);
  const box = (await page.locator("#board").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const [x0, y0, w0, h0] = await readVb(page);
  const half = (d: number) => [
    { x: cx - d, y: cy },
    { x: cx + d, y: cy },
  ];
  const touch = await touchDriver(page);
  // 张开(中心 = svg 中心,两指中点即锚点):viewBox 收缩 = 放大
  // 三段跨度配平:0.2 × 2.5 × 0.2 = 0.1 < 1/8,保证末段足以撞上 8× clamp 下限
  await touch("touchStart", half(40));
  for (const d of [80, 120, 160, 200]) await touch("touchMove", half(d));
  await touch("touchEnd", []);
  await expect.poll(async () => (await readVb(page))[2], { timeout: 5_000 }).toBeLessThan(w0);
  const [x1, y1, w1, h1] = await readVb(page);
  // 中点锚(机制级):viewBox 中心漂移 <1% 视口宽。精确不动点在单测钉死
  // (zoomAt/pinchFrame);e2e 的增量式捏合两指 move 各自成帧,帧间中点由
  // 「A 新位+B 旧位」合成、天然微晃(真机同样如此,感知无碍)——锚错到角落/
  // 单指时漂移与缩放跨度同量级(数百倍于此容差),1% 足以分辨。
  expect(Math.abs(x1 + w1 / 2 - (x0 + w0 / 2))).toBeLessThan(w0 * 0.01);
  expect(Math.abs(y1 + h1 / 2 - (y0 + h0 / 2))).toBeLessThan(w0 * 0.01);
  // 闭合 = 缩小:viewBox 回涨(双方向;±200 → ±80,因子 2.5)
  const close = await touchDriver(page);
  await close("touchStart", half(200));
  for (const d of [160, 120, 80]) await close("touchMove", half(d));
  await close("touchEnd", []);
  await expect.poll(async () => (await readVb(page))[2], { timeout: 5_000 }).toBeGreaterThan(w1);
  // 极端张开:clamp 到 8× 下限(与滚轮/按钮同源 clampViewBox,MAX_ZOOM=8,无第二套界)
  const wide = await touchDriver(page);
  await wide("touchStart", half(80));
  for (const d of [160, 240, 320, 400]) await wide("touchMove", half(d));
  await wide("touchEnd", []);
  await expect.poll(async () => (await readVb(page))[2], { timeout: 5_000 }).toBeCloseTo(w0 / 8, 4);
});

test("手牌区起拖不触发棋盘手势(浮层事件不穿透)", async ({ page }) => {
  test.slow();
  await quickStart(page);
  const vb0 = (await readVb(page)).join(" ");
  // #700:仪表条退役,浮层穿透锚点换底缘手牌区(同为压在棋盘上的常驻浮层)
  const bar = (await page.getByTestId(TESTIDS.handZone).boundingBox())!;
  const bx = bar.x + bar.width / 2;
  const by = bar.y + bar.height / 2;
  const touch = await touchDriver(page);
  await touch("touchStart", [{ x: bx, y: by }]);
  await touch("touchMove", [{ x: bx - 80, y: by - 20 }]);
  await touch("touchEnd", []);
  // 负向断言:留一拍渲染余量后读数,viewBox 必须原样
  await page.waitForTimeout(400);
  expect((await readVb(page)).join(" ")).toBe(vb0);
});
