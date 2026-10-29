// 弹窗可拖动(#674):两壳各一条链,同款四断言——
//   拖离题名 ~150px → 弹窗位移 + 遮罩减淡 rgba(30,23,12,0.15);
//   拖回中心 ±24px 吸附带内松手 → 吸附回正(包围盒复位)+ 遮罩复原 rgba(30,23,12,0.42)。
// 用例 1 = 底件系(名下城池清单,CityLedgerModal/PileShell);用例 2 = 横幅系(城池
// 详情横幅,TileDetailScroll/BannerShell)。遮罩断言走 getComputedStyle(toHaveCSS
// 同一通路);选择器一律 testids 单源,叠层把手用容器作用域区分(见 testids 注)。
import { test, expect, type Page } from "./fixtures";
import type { Locator } from "@playwright/test";
import { quickStart, actIfCan, freezeClock, unfreezeClock } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS as T } from "../src/app/screens/game/scroll/testids";

/** 遮罩墨纱两档(断言面字面量;与 hook 文件 OVERLAY_TINT* 单源同值)。 */
const TINT_BASE = "rgba(30, 23, 12, 0.42)";
const TINT_DIM = "rgba(30, 23, 12, 0.15)";

/** 等元素上的 CSS 动画走完(入场动画写 transform/translate,包围盒须等它落定再量)。 */
async function waitAnimationsSettled(locator: Locator): Promise<void> {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** 把手当前包围盒(随弹窗位移,每段拖拽前重取)。scope=弹层容器:叠层卷轴
 *  (决策 scroll 同挂 modal-drag-handle,#751 集成实锤——全局 querySelector 取到
 *  DOM 序在前的卷轴把手,拖在不透明弹层后面白动)必须容器作用域区分,testids 注钦定口径。 */
async function handleBox(page: Page, scope?: Locator) {
  const handle = scope
    ? scope.getByTestId(TESTIDS.modalDragHandle)
    : page.getByTestId(TESTIDS.modalDragHandle);
  return handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** 把手中心的 pointer 拖拽:按下 → 分步位移(过 10px 阈值)→ 松手。 */
async function dragHandle(page: Page, dx: number, dy: number, scope?: Locator): Promise<void> {
  const box = await handleBox(page, scope);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
}

test("底件系弹窗题名拖动:拖离减淡、拖回吸附复原(#674)", async ({ page }) => {
  await quickStart(page);
  // 清掉开局链遗留的决策卷轴(有遮罩会吞徽章点击),语义同 react-city-ledger
  for (let i = 0; i < 10 && (await actIfCan(page)); i++);
  await freezeClock(page);
  try {
    await page.getByTestId(TESTIDS.seatAttr(0, "city")).click();
    const modal = page.getByTestId(TESTIDS.cityLedger);
    await expect(modal).toBeVisible();
    await waitAnimationsSettled(modal);
    const overlay = page.locator('[data-slot="dialog-overlay"]');
    await expect(overlay).toHaveCSS("background-color", TINT_BASE);

    // 拖离(右 150 / 下 60):位置随动 + 遮罩减淡
    const before = (await modal.boundingBox())!;
    await dragHandle(page, 150, 60, modal);
    const after = (await modal.boundingBox())!;
    expect(Math.abs(after.x - before.x - 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y - 60)).toBeLessThanOrEqual(2);
    await expect(overlay).toHaveCSS("background-color", TINT_DIM);

    // 拖回(过冲 5px,落点偏移 -5/-5 在 ±24px 吸附带内)松手:吸附回正 + 遮罩复原
    await dragHandle(page, -155, -65, modal);
    await expect(overlay).toHaveCSS("background-color", TINT_BASE);
    const snapped = (await modal.boundingBox())!;
    expect(Math.abs(snapped.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(snapped.y - before.y)).toBeLessThanOrEqual(1);

    // 把手豁免不殃及关闭:X 钮照常可点(把手行内 button 起点不启动拖)
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(modal).toBeHidden();
  } finally {
    await unfreezeClock(page);
  }
});

test("横幅系弹窗题名拖动:拖离减淡、拖回吸附复原(#674)", async ({ page }) => {
  await quickStart(page);
  // 开城池详情横幅(react-scrolls 同款:清卷轴 → toPass 重试点地产城)
  const propTile = await page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    return e.board.tiles.findIndex((t: { propertyId?: string }) => t.propertyId);
  });
  await actIfCan(page);
  await expect(async () => {
    await page.locator(`[data-tile="${propTile}"]`).click();
    await expect(page.getByTestId(T.tileDetailScroll)).toBeVisible();
  }).toPass({ timeout: 15_000 });
  const shell = page.getByTestId(T.tileDetailScroll);
  await waitAnimationsSettled(shell);
  await freezeClock(page);
  try {
    const overlay = page.locator(".banner-overlay:not(.banner-overlay-out)");
    await expect(overlay).toHaveCSS("background-color", TINT_BASE);

    // 拖离(左 150 / 上 40):位置随动 + 遮罩减淡
    const before = (await shell.boundingBox())!;
    await dragHandle(page, -150, -40, shell);
    const after = (await shell.boundingBox())!;
    expect(Math.abs(after.x - before.x + 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y + 40)).toBeLessThanOrEqual(2);
    await expect(overlay).toHaveCSS("background-color", TINT_DIM);

    // 拖回(过冲 6px,落点偏移 6/0 在吸附带内)松手:吸附回正 + 遮罩复原
    await dragHandle(page, 156, 40, shell);
    await expect(overlay).toHaveCSS("background-color", TINT_BASE);
    const snapped = (await shell.boundingBox())!;
    expect(Math.abs(snapped.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(snapped.y - before.y)).toBeLessThanOrEqual(1);

    // 拖拽与 210ms 幽灵退场协议无涉:拖拽后 X 关闭照常收场
    await shell.getByTestId(T.scrollClose).click();
    await expect(shell).toBeHidden();
  } finally {
    await unfreezeClock(page);
  }
});
