import { test, expect } from "./fixtures";
import { quickStart, pickCapital, waitSettled } from "./react-helpers";

test("侧栏抽屉折叠:收起成窄条(竖排摘要)并可展开还原", async ({ page }) => {
  await quickStart(page);
  const panel = page.getByTestId("sidebar-panel");
  await expect(panel).toBeVisible();
  // 收起:窄条出现,竖排「X之回合」仍在,现金摘要可见
  await page.getByTestId("sidebar-toggle").click();
  const rail = page.getByTestId("sidebar-collapsed");
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("之回合");
  await expect(rail).toContainText(/锭|两/);
  await expect(page.getByTestId("hand-panel")).toBeHidden();
  // 展开:四区还原(L48:战报区已移除,珍宝·名将区接管腾位)
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("hand-panel")).toBeVisible();
  await expect(page.getByTestId("treasury-panel")).toBeVisible();
  // 注:折叠状态的 localStorage 记忆不做刷新断言——刷新即丢快照回首页(游戏态不持久),
  // 局内记忆的读写已在组件内 try/catch 覆盖,记忆正确性由代码路径保证。
});

// E6(#18)/X13(#32):8 人局矮视口,诸侯列表内滚防裁 + 自己行「你」印。
// 旧版 OthersPanel shrink-0 无内滚,1366×768 下末位诸侯与折叠钮被顶出侧栏不可达。
test.describe("8 人局矮视口", () => {
  test.use({ viewport: { width: 1280, height: 700 } });

  test("8 人局 1280×700:诸侯列表内滚、8 行全部可达、自己行挂「你」印", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-solo").click();
    await page.getByTestId("solo-setup-screen").waitFor();
    for (let i = 4; i < 8; i++) await page.getByTestId("setup-seat-count-plus").click(); // X10 stepper:4 → 8
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    // 8 人局:人类首回合前最多 7 个 bot 回合(发牌 + 每回合起手的锦囊相位 + 行军结算),
    // 30s 固定窗必爆(#191)。改「轮到我」显式条件:锦囊卷轴(点今不用)或 roll-button 可点,预算 90s。
    const mine = await page.waitForSelector(
      '[data-testid="scroll-jinnang-pass"], [data-testid="roll-button"]:not([disabled])',
      { timeout: 90_000 },
    );
    if ((await mine.getAttribute("data-testid")) === "scroll-jinnang-pass") {
      await page.getByTestId("scroll-jinnang-pass").click(); // 人类起手锦囊相位:今不用放行
    }
    await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 10_000 });
    await waitSettled(page);

    const list = page.getByTestId("others-list");
    await expect(page.getByTestId("others-panel")).toBeVisible();
    // 自查截图(不入库;滚 dynamic 前——首屏即自己行「你」印 + 末行被裁的待滚态)
    await page.screenshot({ path: "screenshots/e6-x13-8p-1280x700.png" });
    // 内滚生效:列表内容高于可视区(shrink-0 旧布局下这里会顶爆侧栏而非滚动)
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    // 验收:8 行全部可达(逐行滚入视口;ratio 0.9 容忍亚像素裁切,整行主体可见即可达)
    for (let seat = 0; seat < 8; seat++) {
      const row = page.getByTestId(`other-player-${seat}`);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 0.9 });
    }
    await expect(page.getByTestId("sidebar-toggle")).toBeInViewport();
    // TreasuryPanel min-h-24 保底:珍宝·名将区不被诸侯列表挤没
    const treasury = await page.getByTestId("treasury-panel").boundingBox();
    expect(treasury?.height ?? 0).toBeGreaterThanOrEqual(96);

    // X13:自己行(单机真人=座位 0,settled 后 viewSeat=0)有「你」印,他人行没有
    await expect(page.getByTestId("other-player-0").getByTestId("other-player-you")).toBeVisible();
    await expect(page.getByTestId("other-player-1").getByTestId("other-player-you")).toHaveCount(0);
  });
});
