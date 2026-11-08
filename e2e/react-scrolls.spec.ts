// React 迁移 · 阶段 7 验证门:决策卷轴全量行为测试(招贤/珍宝/破产/胜利/城池详情)。
// 相位无法靠自然游玩稳定撞出,经 window.__dafung 调试钩子强制(仅测试用,见 registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build。
// #362:交涉选宝/破产变卖走选宝弹层(装裱卡点选=金描边上浮,二段式成交),语义断言
// 以命令流(ADR-0014 cmd 行)与引擎结算为准,零放宽。
// #1217 波4 直通形制(ADR-0058 一环一真):全 7 例头注声明「守的那一环」;前置链
// 种局化——开局停走 quickStart 直达首停靠(不再付首手整走的真推回合;族种 1486 谱,
// 城池详情 1217、珍宝城购地 20261105 同谱),被测环前一拍全部经桥种植抵达。逐例复核:
// 交涉/破产/购地三类前置无真推回合(早经 force 种植,本波补齐判词 5 处,零裸 force)。
// #1221 L1 残油包:全 7 例前置改 quickStart({advance:"preRoll"})——布场均不依赖
// 行军日志/已推进回合,落都即冻结(时钟冻在自动起摇点火前,零竞速),显式
// waitFxIdle/freezeClock/unfreezeClock 随通路退役(返回即已冻)。
import { test, expect, type Page } from "./fixtures";
import { quickStart, force, snap, engineState, waitFxIdle } from "./react-helpers";
import { fmtMoney } from "./react-helpers";
import { plant } from "./helpers/drivers";
import { guidePriceOf, premiumPriceOf } from "../src/core/treasures";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

// 真实段(波4 #1217):点候选技名 chip → 技能全览弹框(池全貌/未授灰置/看将不发
// 命令)→ 关框 → 点卡开详情 → 「收为麾下」拍板 → 钤印收场、候选清空的完整交互链
// 与卷轴呈现全真。force 判词:相位/活跃座位无公共命令(由行军结算推进),招贤候选
// 悬空触发无通路(tryRecruitHero 由落招贤城结算调用,骰流不可钉)——直写钉位后调
// 公共方法真掷候选(候选行仍引擎真产物,非伪造 offeredHeroes)。
test(
  "招贤卷轴:三选一,预掷明牌 chips+全览池对照,点卡/技名开全览先看后选,弹框拍板收将",
  {
    tag: "@slow", // 慢池(#1026):单例实测 >30s(30.9s,#1026 标定)——快池门禁 --grep-invert @slow 跳过。
  },
  async ({ page }) => {
    // #1221 L1:preRoll 落都即冻结(时钟冻在自动起摇点火前)——#987/#943 冻结闸的
    // 竞速点(已到点未投递的看门狗回调覆盖种植态)随「点火前已冻」根除,显式排空/
    // 冻结两步退役。
    await quickStart(page, 1486, { advance: "preRoll" });
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
 *  「+1 级」永不成立。findOwner 单源引擎查询。
 *  数值族种植(#1299,判词单源 src/core/planter.ts):城主持宝走 giveTreasure(终态
 *  替换,保起手 2 件=读现值拼全集;id 必须在 TREASURES 目录内(#521 起装裱卡画心按
 *  实例 id 回查目录,目录外抛错),level 3 是压价虚构(真玺 level 10),价签数学只认
 *  行内 level);访客(买家)垫足现金走 setCash——防 payOrLiquidate 走清算自救支线
 *  劫持交涉结算断言。
 *  force 判词(#1217 波4 审计):城池归属由购地结算产出(行军+现金约束到不了「指定格
 *  指定级」)、treasureVisitor 仅落格结算内部挂起、相位/活跃座位无公共命令——断言面
 *  需「被访城+交涉挂起」形态,直写后走控制器 sync。 */
async function plantTrade(page: Page): Promise<void> {
  // #1221 L1:preRoll 落都即冻结(同招贤卷轴例,#987/#943 冻结闸随「点火前已冻」退役),
  // 种植的 AwaitingTreasureOwner 停靠态不被迟到链步进覆盖。
  await quickStart(page, 1486, { advance: "preRoll" });
  const planted = (await snap(page)).players;
  await plant(page, {
    kind: "giveTreasure",
    seat: 0,
    treasures: [
      ...planted[0].treasures,
      { id: "seal", name: "传国玉玺", level: 3, desc: "天命所归" },
    ],
  });
  await plant(page, { kind: "setCash", seat: 1, cash: Math.max(planted[1].cash, 5000) });
  // 授产走 grantProperty 种植件(#1300,upsert 判词单源 src/core/planter.ts);相位/
  // 珍宝窗载荷仍直写=相位族与反应载荷族,#1301 收编前暂驻(余下 force 块只含这两族语义)。
  const visitPropertyId = await page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    const tile = e.board.tiles.find((t: any) => t.propertyId && !e.findOwner(t.propertyId));
    return tile?.propertyId as string;
  });
  await plant(page, { kind: "grantProperty", seat: 0, propertyId: visitPropertyId, level: 1 });
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 1;
    e.treasureVisitor = { def: e.catalog.get(${JSON.stringify(visitPropertyId)}), ownerIdx: 0 };
    e.turnPhase = "AwaitingTreasureOwner";
  `,
  );
}

// 真实段(波4 #1217):点「坐地起价」→ 选宝层开、双行价签(指导价+要价与引擎同
// 公式)、点选转成交价签、返回回模式步(本地状态回退,不发命令)的交互链与呈现全真。
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

// 真实段(波4 #1217):点「公道买卖」→ 点选金描边(aria-pressed)→ 确认武装 →
// 二段式提交发 resolveTreasureOwner 命令(留痕对账)→ 层随结算收口的完整命令通路全真。
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

// 真实段(波4 #1217):卷轴内开选宝弹层 → 二段式变卖(点选武装→确认提交)→ 层随
// 结算收口 → 重开清单刷新(已卖件消失、余件仍在)的交互链全真。
// 数值族种植(#1299,判词单源 src/core/planter.ts):变卖清单珍宝走 giveTreasure
// (终态替换,保起手 2 件=读现值拼全集)。
// force 判词:破产态(pendingDebt)由缴支结算产生、债务数值不可钉;麾下/持仓无授给
// 公共命令——断言面需「有宝可卖+巨债挂起」形态,直写。
test("破产清算卷轴:债务进度/选宝弹层(二段式变卖)/售出清单刷新", async ({ page }) => {
  // 冻结推进再动刀(#421 冻结→种植→断言;#799):种植后到变卖提交间时钟必须静止——
  // 「现金实涨=指导价」是活态等式断言,吃不起对局自走竞速。#1221 L1:preRoll 落都即
  // 冻结,显式 freezeClock 退役;变卖命令链与 UI 收层不经时钟照常结算(react-jinnang-peek
  // /react-seat-cells 冻结消漂移同款,页面随例终结,无需显式 resume)。
  await quickStart(page, 1486, { advance: "preRoll" });
  const me0 = (await snap(page)).players[0];
  await plant(page, {
    kind: "giveTreasure",
    seat: 0,
    treasures: [
      ...me0.treasures,
      { id: "seal", name: "传国玉玺", level: 3, desc: "x" },
      { id: "hat", name: "草帽", level: 1, desc: "x" },
    ],
  });
  // 授将/授产走 armHero/grantProperty 种植件(#1300,判词单源 src/core/planter.ts);
  // 破产态(pendingDebt/turnPhase)仍直写=终局族,#1301 收编前暂驻。
  const debtPropertyId = await page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    const me = e.players[0];
    const tile = e.board.tiles.find(
      (t: any) => t.propertyId && e.board.tiles.indexOf(t) !== me.capitalIndex,
    );
    return tile?.propertyId as string;
  });
  await plant(page, {
    kind: "armHero",
    seat: 0,
    heroId: "zhouyu",
    skillIds: ["jixing", "huogong", "leigu"],
  });
  await plant(page, { kind: "grantProperty", seat: 0, propertyId: debtPropertyId, level: 1 });
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 0;
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

// 真实段(波4 #1217):GameOver 胜利屏全屏覆盖呈现 + 重开钮点击回首页的出口通路全真。
// force 判词:终局态(isOver/winner)由身价目标结算产生,无「直判胜负」公共命令
// ——断言面即终局覆盖层与出口,直写。
test("胜利屏:GameOver 全屏覆盖 + 重开", async ({ page }) => {
  await quickStart(page, 1486, { advance: "preRoll" }); // #1221 L1:布场不依赖首掷
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

// 真实段(波4 #1217):对局中真点城池格 → 详情卷轴弹出 → 列语义呈现(主列交易
// 加成恒在;第二列按城型=都城补给|变卖价)全真——点城交互与卷轴呈现即被测环。
test("城池详情卷轴:对局中点城弹出只读详情", async ({ page }) => {
  // 种局(seed 1217 钉停,#987 处置序③):无 seed 时代人类起手卷轴开着或 bot 回合 fx
  // 在途时点击会被吞(~40% 竞速挂,#217);开局窗态停靠=人类交互空闲,前置 actIfCan
  // 清卷轴随走局一并退役(它会替人类放行起手牌,破坏停靠);toPass 重试块保留作
  // 交互空闲窗兜底(轮询收紧 #294:单次尝试秒级,30s→15s 仍有十余次重试余量)。
  // #1221 L1:preRoll 落都即冻结——布场只要「人类交互空闲的静止态」,冻结态更静。
  await quickStart(page, 1217, { advance: "preRoll" });
  // 找一座地产城(0 号格是起点,非地产)
  const propTile = await page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    return e.board.tiles.findIndex((t: { propertyId?: string }) => t.propertyId);
  });
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

// 真实段(波4 #1217):落格弹购地卷轴 → 差额行「余」契约 → 点买发命令卷轴收的
// 真实决策通路全真(落格结算真走 marchTraverse→settleMarchLanding 引擎路径,非伪造挂起)。
test("珍宝城购地:落格弹购地卷轴、差额行「余」、点买收卷", async ({ page }) => {
  // 定 seed(#987 处置序③:无 seed 对局下本例买城收口窗内偶发 treasure 留痕,同树
  // 红/绿复现(集成线 4 红 1 绿 vs master 1 绿),概率性不可靠;覆盖不可替代故定 seed
  // 确定性化,#1069 集流收口实测双绿。种子漂移按 how-to 种子重钓配方重钓。波4 复核:
  // 20261105 在「开局即停」谱内(探针实测),stopAtOpeningHand 直达首停靠)。
  // #1221 L1:preRoll 落都即冻结(看门狗点火前已冻,显式 freeze/unfreeze 退役——
  // 页面随例终结,同破产清算例口径)。
  await quickStart(page, 20261105, { advance: "preRoll" });
  // force 判词:引擎无「置位」公共命令——行军由骰流驱动,position 只随行军结算
  // 改写;断言面需「落无主珍宝城」形态,直写摆位到无主珍宝城邻格,再走与
  // rollAndMove 掷定 1 步后的同一段引擎路径:途经遍历(marchTraverse)→ 落格结算
  // (settleMarchLanding;机遇已被 fixtures 归零,珍宝城=event 城本就免掷)。
  // 落无主珍宝城 → 落格固定事件位先探宝(#825)→ 交易链:可购决策挂起(同权,ADR-0024)。
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 0;
    const me = e.players[0];
    const target = e.board.tiles.find(
      (t) => t.event === "treasure" && !e.findOwner(t.propertyId),
    );
    if (target == null) throw new Error("盘面无无主珍宝城(数据 bug)");
    const from = (target.index + e.board.count - 1) % e.board.count;
    me.position = from;
    const walked = e.marchTraverse(me, [target.index], 1, target.index, from, 1);
    if (walked !== "landed") throw new Error("marchTraverse=" + walked + "(单格无拦检,契约违反)");
    e.lastMove = e.board.computePath(from, 1, me.capitalIndex);
    e.settleMarchLanding(me, target.index);
  `,
  );
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
});
