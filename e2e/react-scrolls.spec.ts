// React 迁移 · 阶段 7 验证门:决策卷轴全量行为测试(招贤/珍宝/破产/胜利/城池详情)。
// 相位无法靠自然游玩稳定撞出,经 window.__dafung 调试钩子强制(仅测试用,见 registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build。
import { test, expect } from "@playwright/test";
import { quickStart, force } from "./react-helpers";

test("招贤卷轴:三选一,选后关闭并清空候选", async ({ page }) => {
  await quickStart(page);
  await force(page, `e.phase = "Playing"; e.tryRecruitHero(e.activePlayer);`);
  const scroll = page.getByTestId("scroll-hero-pick");
  await expect(scroll).toBeVisible();
  await expect(scroll.getByRole("button")).toHaveCount(3); // 无「不取」:引擎相位不接受 endDecision
  await scroll.getByRole("button").nth(1).click();
  await expect(scroll).toBeHidden();
  // 选中的名士入手(战报或手牌区可见名字);快照候选清空
  // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
  const snap = await page.evaluate(() => (window as any).__dafung.snapshot());
  expect(snap.offeredHeroes).toHaveLength(0);
});

test("珍宝交涉卷轴:城主两步流(模式→选珍宝→返回)", async ({ page }) => {
  await quickStart(page);
  // 给城主(本地玩家)塞一件珍宝 + 一座被访的城,构造交涉现场
  await force(page, `
    e.phase = "Playing";
    const me = e.activePlayer;
    me.treasures.push({ id: "jade_seal", name: "传国玉玺", level: 3, desc: "天命所归" });
    const tile = e.board.tiles.find((t) => t.propertyId);
    me.properties.push({ propertyId: tile.propertyId, level: 1, group: tile.group ?? "a" });
    e.treasureVisitor = { def: e.catalog.get(tile.propertyId), ownerIdx: e.players.indexOf(me) };
    e.turnPhase = "AwaitingTreasureOwner";
  `);
  const scroll = page.getByTestId("scroll-treasure");
  await expect(scroll).toBeVisible();
  await page.getByTestId("scroll-treasure-mode-premium").click();
  await expect(page.getByTestId("scroll-treasure-item-jade_seal")).toBeVisible();
  await page.getByTestId("scroll-treasure-back").click();
  await expect(page.getByTestId("scroll-treasure-mode-premium")).toBeVisible();
});

test("破产清算卷轴:债务/变卖/确认入口齐全", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    e.phase = "Playing";
    const me = e.activePlayer;
    me.treasures.push({ id: "jade_seal", name: "传国玉玺", level: 3, desc: "x" });
    me.heroes.push({ id: "zhouyu", name: "周瑜", title: "火烧赤壁", desc: "x" });
    const tile = e.board.tiles.find((t) => t.propertyId && e.board.tiles.indexOf(t) !== me.capitalIndex);
    me.properties.push({ propertyId: tile.propertyId, level: 1, group: "a" });
    e.pendingDebt = { amount: 99999, creditor: null };
    e.turnPhase = "AwaitingBankruptcySettle";
  `);
  const scroll = page.getByTestId("scroll-bankruptcy");
  await expect(scroll).toBeVisible();
  await expect(page.getByTestId("scroll-bankruptcy-debt")).toBeVisible();
  await page.getByTestId("scroll-bankruptcy-sell-treasure-jade_seal").click();
  // 卖出后经 snapshot 刷新重弹,珍宝按钮消失
  await expect(page.getByTestId("scroll-bankruptcy-sell-treasure-jade_seal")).toBeHidden();
});

test("胜利屏:GameOver 全屏覆盖 + 重开", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    e.isOver = true;
    e.winner = e.players[0];
    e.phase = "GameOver";
  `);
  await expect(page.getByTestId("victory-screen")).toBeVisible();
  await page.getByTestId("victory-restart").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
});

test("城池详情卷轴:对局中点城弹出只读详情", async ({ page }) => {
  await quickStart(page);
  // 找一座地产城(0 号格是起点,非地产)
  const propTile = await page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    return e.board.tiles.findIndex((t: { propertyId?: string }) => t.propertyId);
  });
  await page.locator(`[data-tile="${propTile}"]`).click();
  await expect(page.getByTestId("scroll-tile-detail")).toBeVisible();
});
