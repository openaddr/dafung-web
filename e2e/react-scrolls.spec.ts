// React 迁移 · 阶段 7 验证门:决策卷轴全量行为测试(招贤/珍宝/破产/胜利/城池详情)。
// 相位无法靠自然游玩稳定撞出,经 window.__dafung 调试钩子强制(仅测试用,见 registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build。
// #362:交涉选宝/破产变卖走选宝弹层(装裱卡点选=金描边上浮,二段式成交),语义断言
// 以命令流(ADR-0014 cmd 行)与引擎结算为准,零放宽。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  force,
  snap,
  engineState,
  actIfCan,
  freezeClock,
  unfreezeClock,
  waitFxIdle,
} from "./react-helpers";
import { fmtMoney } from "./react-helpers";
import { guidePriceOf, premiumPriceOf } from "../src/core/treasures";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

test(
  "招贤卷轴:三选一,预掷明牌 chips+全览池对照,点卡/技名开全览先看后选,弹框拍板收将",
  {
    tag: "@slow", // 慢池(#1026):单例实测 >30s(30.9s,#1026 标定)——快池门禁 --grep-invert @slow 跳过。
  },
  async ({ page }) => {
    await quickStart(page);
    // #987 冻结闸(#943 竞速点清偿):停靠点可能有已到点未投递的看门狗回调(bot 链
    // 步进/自动起摇),直写种植的 AwaitingHeroPick 会被迟到链步进覆盖、卷轴中途收场——
    // 先排空演出再冻结(冻结挂起时钟驱动收幕,fx 在途时冻结=waitFxIdle 死等)。
    await waitFxIdle(page);
    await freezeClock(page);
    // #188:行军自动化后 quickStart 停靠点不再保证轮到人类——强制场景一律先钉活跃座位
    // 到人类(0),否则 interactive=false(决策方是 bot)卷轴恒不弹。
    await force(page, `e.phase = "Playing"; e.activeIndex = 0; e.tryRecruitHero(e.activePlayer);`);
    const scroll = page.getByTestId(SCROLL_TESTIDS.heroPickScroll);
    await expect(scroll).toBeVisible();
    await expect(scroll.getByRole("button")).toHaveCount(3); // 无「不取」:引擎相位不接受 endDecision
    // 预掷明牌(#787):卡面 chips = 候选行预掷授技子集(≥1;tryRecruitHero 真掷,不钉具体技)
    const rows: { id: string; skillIds: string[] }[] = (await snap(page)).offeredHeroes;
    expect(rows).toHaveLength(3);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.skillIds.length).toBeGreaterThanOrEqual(1); // 至少一技
      await expect(
        scroll.getByTestId(SCROLL_TESTIDS.heroPickOption(i)).locator(TESTIDS.skillChipAny),
      ).toHaveCount(rows[i]!.skillIds.length);
    }
    // 先看后选(2026-11-01 拍板:点卡不再直选)+ 池全貌对照(#787):点候选将技名
    // chip=开技能全览弹框,弹框陈列池全技(未授者 .is-off 灰置),不触发选将(候选
    // 不清空、招贤层仍在);招贤语境弹框带「收为麾下」拍板钮。
    await scroll.getByRole("button").nth(1).locator(TESTIDS.skillChipAny).first().click();
    const glossary = page.getByTestId(TESTIDS.skillGlossary);
    await expect(glossary).toBeVisible();
    const mid = rows[1]!;
    const pool: string[] = await engineState(
      page,
      `window.__dafung.heroDefs().find((h) => h.id === ${JSON.stringify(mid.id)}).skillPool`,
    );
    for (const id of pool) {
      await expect(glossary.getByTestId(TESTIDS.skillGlossaryRow(id))).toHaveCount(1); // 池全貌逐技在列
    }
    const offCount = pool.length - mid.skillIds.length;
    await expect(glossary.locator(".skg-row.is-off")).toHaveCount(offCount); // 未授灰置
    await expect(scroll).toBeVisible();
    expect((await snap(page)).offeredHeroes).toHaveLength(3); // 看将不发命令
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(glossary).toHaveCount(0);
    // 点卡体同开详情弹框(拍板唯一入口,2026-11-01 拍板):拍板钮在场 → 「收为麾下」
    // → 钤印节拍后卷轴收场、候选清空
    await scroll.getByRole("button").nth(1).click();
    await expect(glossary).toBeVisible();
    const pick = glossary.getByTestId(TESTIDS.skillGlossaryPick);
    await expect(pick).toBeVisible();
    await pick.click();
    await expect(scroll).toBeHidden();
    // 选中的名将入手(战报或手牌区可见名字);快照候选清空
    // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
    const after = await page.evaluate(() => (window as any).__dafung.snapshot());
    expect(after.offeredHeroes).toHaveLength(0);
  },
);

/** 交涉现场种植(城主=人类座位 0,访客=bot 座位 1):给城主塞珍宝 + 一座被访的城。
 *  #188:先钉人类座位为决策方(AwaitingTreasureOwner 的 decisionOwner=城主,天然成立)。
 *  #413:被访城必须无人持有——定都本身会产出 level 0 的 holding(setup-flow),若撞上
 *  「offeredCapitals[0] 恰是盘面第一座地产城」的种子,直写 push 会造出同 propertyId 的
 *  重复 holding,结算的 findHolding 升的是首件(都城 0→1),断言读到的也是首件(恒 1),
 *  「+1 级」永不成立。findOwner 单源引擎查询。 */
async function plantTrade(page: Page): Promise<void> {
  await quickStart(page);
  // #987 冻结闸(#943 竞速点清偿,同招贤卷轴例):排空演出→冻结,种植的
  // AwaitingTreasureOwner 停靠态不被迟到链步进覆盖。
  await waitFxIdle(page);
  await freezeClock(page);
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 1;
    const owner = e.players[0];
    // id 必须在 TREASURES 目录内(#521 起装裱卡画心按实例 id 回查目录,目录外抛错);
    // level 3 是压价虚构(真玺 level 10),价签数学只认行内 level
    owner.treasures.push({ id: "seal", name: "传国玉玺", level: 3, desc: "天命所归" });
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
  const scroll = page.getByTestId(SCROLL_TESTIDS.treasureScroll);
  await expect(scroll).toBeVisible();
  await page.getByTestId(SCROLL_TESTIDS.treasureModePremium).click();
  const pick = page.getByTestId(SCROLL_TESTIDS.treasurePick);
  await expect(pick).toBeVisible();
  await expect(pick).toContainText("坐地起价"); // 标题随口径
  const item = page.getByTestId(SCROLL_TESTIDS.treasureItem("seal"));
  await expect(item).toBeVisible();
  // 坐地价签:未选=双行「指导价+要价」,要价与引擎结算同一 premiumPriceOf
  // (种植 holding level=1,UI 与引擎同走 per-level 公式)
  const guide = guidePriceOf(3);
  const def = await engineState(page, "e.treasureVisitor.def");
  const ask = premiumPriceOf(guide, def, 1);
  await expect(item).toContainText(`指导价 ${fmtMoney(guide)}`);
  await expect(item).toContainText(`要价 ${fmtMoney(ask)}`);
  // 点选:价签转「成交 · 至 要价」,结算行给分解式「指导价 + 加价 = 入账」
  await item.click();
  await expect(item).toContainText(`成交 · 至 ${fmtMoney(ask)}`);
  await expect(pick).toContainText(
    `指导价 ${fmtMoney(guide)} + 加价 ${fmtMoney(ask - guide)} = 入账 ${fmtMoney(ask)}`,
  );
  // 返回:关层回模式选择步(本地状态回退,不发命令)
  await page.getByTestId(SCROLL_TESTIDS.treasureBack).click();
  await expect(pick).toBeHidden();
  await expect(page.getByTestId(SCROLL_TESTIDS.treasureModePremium)).toBeVisible();
});

test("珍宝交涉:点选金描边 + 二段式成交,确认提交发 resolveTreasureOwner 命令", async ({ page }) => {
  await plantTrade(page);
  const scroll = page.getByTestId(SCROLL_TESTIDS.treasureScroll);
  await expect(scroll).toBeVisible();
  await page.getByTestId(SCROLL_TESTIDS.treasureModeFair).click();
  const pick = page.getByTestId(SCROLL_TESTIDS.treasurePick);
  await expect(pick).toBeVisible();
  const item = page.getByTestId(SCROLL_TESTIDS.treasureItem("seal"));
  await expect(item).toBeVisible();
  // 价签:未选=指导价;指导价单源 core/treasures(不写第二事实源)
  await expect(item).toContainText(`指导价 ${fmtMoney(guidePriceOf(3))}`);
  const confirm = page.getByTestId(SCROLL_TESTIDS.treasureConfirm);
  await expect(confirm).toBeDisabled(); // 未预选不可成交
  // 点选=金描边上浮:aria-pressed 翻真 + 价签转「成交 · 至 N 两」
  await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item).toContainText(`成交 · 至 ${fmtMoney(guidePriceOf(3))}`);
  // 二段式:第一段=预选态点亮确认,不提交(层不关、相位不动、零命令)
  await confirm.click();
  await expect(confirm).toHaveText("确认成交");
  await expect(pick).toBeVisible();
  expect((await snap(page)).turnPhase).toBe("AwaitingTreasureOwner");
  // 留痕基线(#799):只扫「基线后追加段」——种植交涉停在人类决策点,基线到提交间
  // 无任何他线可插,切片内首条恒为本例命令线(结算路径内同步写入)。
  const logLenBefore = (await snap(page)).log.length;
  // 第二段=确认提交
  await confirm.click();
  // #1181 棒一缩:结算留痕全字段对账面(fairUpgrade/treasureFair/escrowDeliver 三行
  // =「城主入账指导价/珍宝离手入买家/城池 +1 级」结算细则)已由 test/treasure.test.ts
  // 「公道买卖」「坐地起价」等结算例钉死,删已迁断言;留 cmd 行 = 「点确认成交 →
  // 发 resolveTreasureOwner{fair,treasureId} 这条命令」的接线证据(ADR-0056 接缝
  // 判据:接线断言是壳,留)。观察走不可变审计线,不吃活状态竞速。
  await expect
    .poll(
      async () =>
        page.evaluate((base) => {
          const s = (window as any).__dafung.snapshot();
          const cmd = s.log
            .slice(base) // #799:只扫基线后追加段(见上)
            .find(
              (l: { category: string; detail: string }) =>
                l.category === "cmd" && l.detail.includes("resolveTreasureOwner"),
            );
          return cmd ? JSON.parse(cmd.detail) : null;
        }, logLenBefore),
      { timeout: 30_000, message: "确认提交 resolveTreasureOwner{fair} 命令留痕" },
    )
    .toEqual({ type: "resolveTreasureOwner", action: { type: "fair", treasureId: "seal" } });
  // 层随结算收口(DOM 契约):命令留痕已被上方钉住,层收跟拍不再吃自走竞速
  await expect(pick).toBeHidden({ timeout: 30_000 });
});

test("破产清算卷轴:债务进度/选宝弹层(二段式变卖)/售出清单刷新", async ({ page }) => {
  await quickStart(page);
  // 冻结推进再动刀(#421 冻结→种植→断言;#799):quickStart 停靠点可能残留已到点的
  // 看门狗回调,种植后到变卖提交前的 firing 会动 p0 现金/相位——「现金实涨=指导价」
  // 是活态等式断言,吃不起对局自走竞速。冻结后引擎钉死在停靠态;变卖命令链与 UI 收层
  // 不经时钟照常结算(react-jinnang-peek/react-seat-cells 冻结消漂移同款,页面随例
  // 终结,无需显式 resume)。
  await freezeClock(page);
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 0;
    const me = e.activePlayer;
    me.treasures.push({ id: "seal", name: "传国玉玺", level: 3, desc: "x" });
    me.treasures.push({ id: "hat", name: "草帽", level: 1, desc: "x" });
    me.heroes.push({ heroId: "zhouyu", skillIds: ["jixing", "huogong", "leigu"], lastFired: {} }); // 槽位行(#785)
    const tile = e.board.tiles.find((t) => t.propertyId && e.board.tiles.indexOf(t) !== me.capitalIndex);
    me.properties.push({ propertyId: tile.propertyId, level: 1, group: "a" });
    e.pendingDebt = { amount: 99999, creditor: null };
    e.turnPhase = "AwaitingBankruptcySettle";
  `,
  );
  const scroll = page.getByTestId(SCROLL_TESTIDS.bankruptcyScroll);
  await expect(scroll).toBeVisible();
  // 进度行:已凑/债务/尚欠三数同窗(#362 已凑金额口径)
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcyDebt)).toBeVisible();
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcyProgress)).toContainText("已凑");
  // 卷轴内入口开选宝弹层
  await page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasureOpen).click();
  const pick = page.getByTestId(SCROLL_TESTIDS.bankruptcyTreasurePick);
  await expect(pick).toBeVisible();
  await expect(pick).toContainText("变卖自救"); // 标题语义保留
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcyPickProgress)).toContainText("已凑");
  const item = page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasure("seal"));
  await expect(item).toBeVisible();
  await expect(item).toContainText(`至 ${fmtMoney(guidePriceOf(3))}`); // 指导价口径
  // 二段式:点选 → 确认武装 → 提交
  await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  const confirm = page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasureConfirm);
  await confirm.click();
  await expect(confirm).toHaveText("确认变卖");
  await confirm.click();
  // #1181 棒一缩:变卖入账 = 指导价的结算等式已由 test/bankruptcy.test.ts
  // 「三类变卖入账 = UI 展示价(同一纯函数)」钉死,删已迁活态等式断言;
  // 层随结算收口(pick 隐藏)即命令落账同步,售出面走下面的重开清单刷新。
  await expect(pick).toBeHidden();
  // 售出即收层;重开清单随快照刷新(已卖件消失,余件仍在)
  await page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasureOpen).click();
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcyTreasurePick)).toBeVisible();
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasure("seal"))).toHaveCount(0);
  await expect(page.getByTestId(SCROLL_TESTIDS.bankruptcySellTreasure("hat"))).toBeVisible();
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
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryScreen)).toBeVisible();
  await page.getByTestId(SCROLL_TESTIDS.victoryRestart).click();
  await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
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
    await expect(page.getByTestId(SCROLL_TESTIDS.tileDetailScroll)).toBeVisible();
  }).toPass({ timeout: 15_000 });
  // #671 列语义钉:主列恒为交易加成;第二列按城型——该格是某家都城则显「都城补给」
  // (变卖价对都城是死信息),普通城显「变卖价」
  const detailIsCapital = await page.evaluate((idx) => {
    const e = (window as any).__dafung.getEngine();
    return e.players.some((p: { capitalIndex: number | null }) => p.capitalIndex === idx);
  }, propTile);
  const detail = page.getByTestId(SCROLL_TESTIDS.tileDetailScroll);
  await expect(detail.getByText("交易加成")).toBeVisible();
  await expect(detail.getByText(detailIsCapital ? "都城补给" : "变卖价")).toBeVisible();
});

test("珍宝城购地:落格弹购地卷轴、差额行「余」、点买收卷", async ({ page }) => {
  // 定 seed(#987 处置序③:无 seed 对局下本例买城收口窗内偶发 treasure 留痕,同树
  // 红/绿复现(集成线 4 红 1 绿 vs master 1 绿),概率性不可靠;覆盖不可替代故定 seed
  // 确定性化,#1069 集流收口实测双绿。种子漂移按 how-to 种子重钓配方重钓。
  await quickStart(page, 20261105);
  await freezeClock(page); // 钉死看门狗:种植停靠态不被迟到链步进覆盖
  try {
    // 摆位到无主珍宝城邻格,直走 rollAndMove 掷定 1 步后的同一段引擎路径:
    // 途经遍历(marchTraverse)→ 落格结算(settleMarchLanding;机遇已被 fixtures 归零,
    // 珍宝城=event 城本就免掷)。落无主珍宝城 → 落格固定事件位先探宝(#825)→ 交易链:
    // 可购决策挂起(同权,ADR-0024)。
    await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      e.phase = "Playing";
      e.activeIndex = 0;
      const me = e.players[0];
      const target = e.board.tiles.find(
        (t: { event?: string; propertyId: string | null }) =>
          t.event === "treasure" && !e.findOwner(t.propertyId),
      );
      if (target == null) throw new Error("盘面无无主珍宝城(数据 bug)");
      const from = (target.index + e.board.count - 1) % e.board.count;
      me.position = from;
      const walked = e.marchTraverse(me, [target.index], 1, target.index, from, 1);
      if (walked !== "landed") throw new Error(`marchTraverse=${walked}(单格无拦检,契约违反)`);
      e.lastMove = e.board.computePath(from, 1, me.capitalIndex);
      e.settleMarchLanding(me, target.index);
      (window as any).__dafung.sync();
    });
    // 落格即弹购地卷轴(探宝先行、可购决策挂起的 UI 面)
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toBeVisible();
    // #1181 棒一缩:链序正典与收口零探宝两段引擎链序 poll 已由 test/treasure.test.ts
    // 「落无主珍宝城:落格即探宝(先于可购决策),买成收口零探宝(#825 链序)」逐条
    // 钉死,删已迁断言;留壳=落格卷轴可见 + 差额行契约 + 点买收卷。
    // 差额行符号语义(#566):买得起记「余」不记「差」;formatMoney 拒负后此行是契约面
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toContainText("余");
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).not.toContainText("差");
    // 点买 → 命令受理,卷轴收(决策收口的 UI 面;购地结算与链序归引擎单测)
    await waitFxIdle(page);
    await page.getByTestId(TESTIDS.actionButton("buy")).click();
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toBeHidden({ timeout: 15_000 });
  } finally {
    await unfreezeClock(page);
  }
});
