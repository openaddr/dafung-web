// React 迁移 · 阶段 7 验证门:决策卷轴全量行为测试(招贤/珍宝/破产/胜利/城池详情)。
// 相位无法靠自然游玩稳定撞出,经 window.__dafung 调试钩子强制(仅测试用,见 registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build。
// #362:交涉选宝/破产变卖走选宝弹层(装裱卡点选=金描边上浮,二段式成交),语义断言
// 以命令流(ADR-0014 cmd 行)与引擎结算为准,零放宽。
import { test, expect, type Page } from "./fixtures";
import { quickStart, force, snap, engineState, actIfCan } from "./react-helpers";
import { fmtMoney } from "./react-helpers";
import { guidePriceOf } from "../src/core/treasures";

test("招贤卷轴:三选一,选后关闭并清空候选", async ({ page }) => {
  await quickStart(page);
  // #188:行军自动化后 quickStart 停靠点不再保证轮到人类——强制场景一律先钉活跃座位
  // 到人类(0),否则 interactive=false(决策方是 bot)卷轴恒不弹。
  await force(page, `e.phase = "Playing"; e.activeIndex = 0; e.tryRecruitHero(e.activePlayer);`);
  const scroll = page.getByTestId("scroll-hero-pick");
  await expect(scroll).toBeVisible();
  await expect(scroll.getByRole("button")).toHaveCount(3); // 无「不取」:引擎相位不接受 endDecision
  await scroll.getByRole("button").nth(1).click();
  await expect(scroll).toBeHidden();
  // 选中的名将入手(战报或手牌区可见名字);快照候选清空
  // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
  const snap = await page.evaluate(() => (window as any).__dafung.snapshot());
  expect(snap.offeredHeroes).toHaveLength(0);
});

/** 交涉现场种植(城主=人类座位 0,访客=bot 座位 1):给城主塞珍宝 + 一座被访的城。
 *  #188:先钉人类座位为决策方(AwaitingTreasureOwner 的 decisionOwner=城主,天然成立)。
 *  #413:被访城必须无人持有——定都本身会产出 level 0 的 holding(setup-flow),若撞上
 *  「offeredCapitals[0] 恰是盘面第一座地产城」的种子,直写 push 会造出同 propertyId 的
 *  重复 holding,结算的 findHolding 升的是首件(都城 0→1),断言读到的也是首件(恒 1),
 *  「+1 级」永不成立。findOwner 单源引擎查询。 */
async function plantTrade(page: Page): Promise<void> {
  await quickStart(page);
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 1;
    const owner = e.players[0];
    owner.treasures.push({ id: "jade_seal", name: "传国玉玺", level: 3, desc: "天命所归" });
    const tile = e.board.tiles.find((t) => t.propertyId && !e.findOwner(t.propertyId));
    owner.properties.push({
      propertyId: tile.propertyId,
      level: 1,
      maxLevel: 3,
      group: tile.group ?? "a",
    });
    e.treasureVisitor = { def: e.catalog.get(tile.propertyId), ownerIdx: 0 };
    // 访客(买家)垫足现金:防 payOrLiquidate 走清算自救支线劫持交涉结算断言
    e.players[1].cash = Math.max(e.players[1].cash, 5000);
    e.turnPhase = "AwaitingTreasureOwner";
  `,
  );
}

test("珍宝交涉:模式选定弹选宝层,返回回模式步", async ({ page }) => {
  await plantTrade(page);
  const scroll = page.getByTestId("scroll-treasure");
  await expect(scroll).toBeVisible();
  await page.getByTestId("scroll-treasure-mode-premium").click();
  const pick = page.getByTestId("scroll-treasure-pick");
  await expect(pick).toBeVisible();
  await expect(pick).toContainText("坐地起价"); // 标题随口径
  const item = page.getByTestId("scroll-treasure-item-jade_seal");
  await expect(item).toBeVisible();
  // 返回:关层回模式选择步(本地状态回退,不发命令)
  await page.getByTestId("scroll-treasure-back").click();
  await expect(pick).toBeHidden();
  await expect(page.getByTestId("scroll-treasure-mode-premium")).toBeVisible();
});

test("珍宝交涉:点选金描边 + 二段式成交,treasureId 命令与结算零放宽", async ({ page }) => {
  await plantTrade(page);
  const scroll = page.getByTestId("scroll-treasure");
  await expect(scroll).toBeVisible();
  await page.getByTestId("scroll-treasure-mode-fair").click();
  const pick = page.getByTestId("scroll-treasure-pick");
  await expect(pick).toBeVisible();
  const item = page.getByTestId("scroll-treasure-item-jade_seal");
  await expect(item).toBeVisible();
  // 价签:未选=指导价;指导价单源 core/treasures(不写第二事实源)
  await expect(item).toContainText(`指导价 ${fmtMoney(guidePriceOf(3))}`);
  const confirm = page.getByTestId("scroll-treasure-confirm");
  await expect(confirm).toBeDisabled(); // 未预选不可成交
  // 被访城 pid(成交后 treasureVisitor 清空,须在提交前取;引擎侧形 = { def, ownerIdx })
  const pid = await engineState(page, "e.treasureVisitor.def.id");
  // 点选=金描边上浮:aria-pressed 翻真 + 价签转「成交 · 至 N 两」
  await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item).toContainText(`成交 · 至 ${fmtMoney(guidePriceOf(3))}`);
  // 二段式:第一段=预选态点亮确认,不提交(层不关、相位不动、零命令)
  await confirm.click();
  await expect(confirm).toHaveText("确认成交");
  await expect(pick).toBeVisible();
  expect((await snap(page)).turnPhase).toBe("AwaitingTreasureOwner");
  // 第二段=确认提交
  await confirm.click();
  // 结算留痕断言(#413):交涉成交后对局自走续跑,且 bot 链零步延(stepDelayMs=0)——
  // 成交拍与后续合法效果(bot 火烧连营随机降城、下一棒交涉扣款)会挤进同一段同步任务,
  // 负载下任何「拍后读活状态」都能错过结算瞬态(89/91 轮换实证:活状态逐条 poll 读回
  // +100/+350/+1 级被打回)。改断结算自身的追加留痕(ADR-0014 对局日志,结算路径内
  // 同步写入,不可回改):cmd 原样入账 + 公道成交升 Lv.2 + 指导价成交未走清算 + 托管
  // 交割买家付清——「城主入账指导价/珍宝离手入买家/城池 +1 级」三语义逐条对应留痕,
  // 断言不弱反强(观察从可变活状态移到不可变审计线)。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as any).__dafung.snapshot();
          const line = (cat: string, key: string) =>
            s.log.find(
              (l: { category: string; detail: string }) =>
                l.category === cat && l.detail.includes(key),
            );
          const cmd = line("cmd", "resolveTreasureOwner");
          return {
            cmd: cmd ? JSON.parse(cmd.detail) : null,
            upgrade: line("upgrade", "fairUpgrade")?.detail ?? null,
            trade: line("trade", "treasureFair")?.detail ?? null,
            deliver: line("trade", "escrowDeliver")?.detail ?? null,
          };
        }),
      { timeout: 30_000, message: "珍宝交涉结算留痕:cmd/fairUpgrade/treasureFair/escrowDeliver" },
    )
    .toEqual({
      cmd: { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "jade_seal" } },
      upgrade: `fairUpgrade prop=${pid} owner=p0 visitor=p1 level=2`,
      trade: `treasureFair owner=p0 visitor=p1 treasure=jade_seal level=3 price=${guidePriceOf(3)} bankrupt=false`,
      deliver: `escrowDeliver buyer=p1 seller=p0 treasure=jade_seal price=${guidePriceOf(3)}`,
    });
  // 层随结算收口(DOM 契约):结算留痕已被上方钉住,层收跟拍不再吃自走竞速
  await expect(pick).toBeHidden({ timeout: 30_000 });
});

test("破产清算卷轴:债务进度/选宝弹层(二段式变卖)/语义结算", async ({ page }) => {
  await quickStart(page);
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 0;
    const me = e.activePlayer;
    me.treasures.push({ id: "jade_seal", name: "传国玉玺", level: 3, desc: "x" });
    me.treasures.push({ id: "hat", name: "草帽", level: 1, desc: "x" });
    me.heroes.push({ id: "zhouyu", name: "周瑜", title: "火烧赤壁", desc: "x" });
    const tile = e.board.tiles.find((t) => t.propertyId && e.board.tiles.indexOf(t) !== me.capitalIndex);
    me.properties.push({ propertyId: tile.propertyId, level: 1, group: "a" });
    e.pendingDebt = { amount: 99999, creditor: null };
    e.turnPhase = "AwaitingBankruptcySettle";
  `,
  );
  const scroll = page.getByTestId("scroll-bankruptcy");
  await expect(scroll).toBeVisible();
  // 进度行:已凑/债务/尚欠三数同窗(#362 已凑金额口径)
  await expect(page.getByTestId("scroll-bankruptcy-debt")).toBeVisible();
  await expect(page.getByTestId("scroll-bankruptcy-progress")).toContainText("已凑");
  // 卷轴内入口开选宝弹层
  await page.getByTestId("scroll-bankruptcy-sell-treasure-open").click();
  const pick = page.getByTestId("scroll-bankruptcy-treasure-pick");
  await expect(pick).toBeVisible();
  await expect(pick).toContainText("变卖自救"); // 标题语义保留
  await expect(page.getByTestId("scroll-bankruptcy-pick-progress")).toContainText("已凑");
  const item = page.getByTestId("scroll-bankruptcy-sell-treasure-jade_seal");
  await expect(item).toBeVisible();
  await expect(item).toContainText(`至 ${fmtMoney(guidePriceOf(3))}`); // 指导价口径
  // 二段式:点选 → 确认武装 → 提交
  await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  const confirm = page.getByTestId("scroll-bankruptcy-sell-treasure-confirm");
  await confirm.click();
  await expect(confirm).toHaveText("确认变卖");
  const cashBefore = (await snap(page)).players[0].cash;
  await confirm.click();
  await expect(pick).toBeHidden();
  // 语义断言零放宽:变卖入账 = 指导价(与引擎同一函数),现金实涨
  await expect
    .poll(async () => (await snap(page)).players[0].cash, {
      timeout: 15_000,
      message: "变卖珍宝入账指导价",
    })
    .toBe(cashBefore + guidePriceOf(3));
  // 售出即收层;重开清单随快照刷新(已卖件消失,余件仍在)
  await page.getByTestId("scroll-bankruptcy-sell-treasure-open").click();
  await expect(page.getByTestId("scroll-bankruptcy-treasure-pick")).toBeVisible();
  await expect(page.getByTestId("scroll-bankruptcy-sell-treasure-jade_seal")).toHaveCount(0);
  await expect(page.getByTestId("scroll-bankruptcy-sell-treasure-hat")).toBeVisible();
});

test("胜利屏:GameOver 全屏覆盖 + 重开", async ({ page }) => {
  await quickStart(page);
  await force(
    page,
    `
    e.isOver = true;
    e.winner = e.players[0];
    e.phase = "GameOver";
  `,
  );
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
  // 重试点击(#217:无 seed 对局下,人类起手锦囊卷轴开着或 bot 回合 fx 在途时点击会被吞,~40% 竞速挂)。
  // 先清人类卷轴,再 toPass 重试「点击→卷轴可见」整块,直到逮住交互空闲窗
  // (轮询收紧 #294:单次尝试秒级,30s→15s 仍有十余次重试余量)。
  await actIfCan(page);
  await expect(async () => {
    await page.locator(`[data-tile="${propTile}"]`).click();
    await expect(page.getByTestId("scroll-tile-detail")).toBeVisible();
  }).toPass({ timeout: 15_000 });
});
