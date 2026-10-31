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

test("招贤卷轴:三选一,预掷明牌 chips+全览池对照,点技名先看全览不选将,选后关闭并清空候选", async ({
  page,
}) => {
  await quickStart(page);
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
  // 先看后选(#605/#606)+ 池全貌对照(#787):点候选将技名 chip=开技能全览弹框,
  // 弹框陈列池全技(未授者 .is-off 灰置),不触发选将(候选不清空、招贤层仍在);
  // 关弹框后照常点卡选将。
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
  await scroll.getByRole("button").nth(1).click();
  await expect(scroll).toBeHidden();
  // 选中的名将入手(战报或手牌区可见名字);快照候选清空
  // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
  const after = await page.evaluate(() => (window as any).__dafung.snapshot());
  expect(after.offeredHeroes).toHaveLength(0);
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

test("珍宝交涉:点选金描边 + 二段式成交,treasureId 命令与结算零放宽", async ({ page }) => {
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
  // 结算留痕基线(#799):留痕断言只扫「基线后追加段」——对局自走里 bot 间交涉(如
  // p2 售 p0 青囊)可能在种植前已入账,整局 find 首条会吃自然线(种子走位漂移的实锤
  // 红因:票上三轮实跑吃到的自然是 buyer=p0/seller=p2/qingnang-9/600);种植交涉停在
  // 人类决策点,基线到提交间无任何他线可插,切片内首条恒为本例结算线(结算路径内
  // 同步写入,也先于任何后续自然线)。
  const logLenBefore = (await snap(page)).log.length;
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
        page.evaluate((base) => {
          const s = (window as any).__dafung.snapshot();
          const lines = s.log.slice(base); // #799:只扫基线后追加段(见上)
          const line = (cat: string, key: string) =>
            lines.find(
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
        }, logLenBefore),
      { timeout: 30_000, message: "珍宝交涉结算留痕:cmd/fairUpgrade/treasureFair/escrowDeliver" },
    )
    .toEqual({
      cmd: { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "seal" } },
      upgrade: `fairUpgrade prop=${pid} owner=p0 visitor=p1 level=2`,
      trade: `treasureFair owner=p0 visitor=p1 treasure=seal level=3 price=${guidePriceOf(3)} bankrupt=false`,
      deliver: `escrowDeliver buyer=p1 seller=p0 treasure=seal price=${guidePriceOf(3)}`,
    });
  // 层随结算收口(DOM 契约):结算留痕已被上方钉住,层收跟拍不再吃自走竞速
  await expect(pick).toBeHidden({ timeout: 30_000 });
});

test("破产清算卷轴:债务进度/选宝弹层(二段式变卖)/语义结算", async ({ page }) => {
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

test("珍宝城购地:落格先探宝后交易链,买成收口零探宝(#825 链序)", async ({ page }) => {
  await quickStart(page);
  await freezeClock(page); // 钉死看门狗:强制行军/落格不与自动起摇、停摆代驾赛跑
  try {
    // 摆位到无主珍宝城邻格,直走 rollAndMove 掷定 1 步后的同一段引擎路径:
    // 途经遍历(marchTraverse)→ 落格结算(settleMarchLanding;机遇已被 fixtures 归零,
    // 珍宝城=event 城本就免掷)。落无主珍宝城 → 落格固定事件位先探宝(#825)→ 交易链:
    // 可购决策挂起(同权,ADR-0024)。
    const tc = await page.evaluate(() => {
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
      // 结算留痕基线(#799 配方):留痕断言只扫「基线后追加段」——探宝/可购两行都在
      // settleMarchLanding 内同步写入,基线取 settle 前一拍;quickStart 人类落格自走线
      // (available 行,#827 改图后停靠点漂移恒产)留在基线前,全账 findIndex 的哨兵
      // 病灶(首批 available 撞自走线)不复发。
      const logBase = e.log.length;
      e.settleMarchLanding(me, target.index);
      (window as any).__dafung.sync();
      return { index: target.index, logBase };
    });
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toBeVisible();
    // 链序正典(#825):探宝已在落格先行——gain/miss 任一留痕,且先于可购留痕(交易链)。
    await expect
      .poll(async () => {
        const lines: { detail: string }[] = (await snap(page)).log.slice(tc.logBase);
        const treasureAt = lines.findIndex(
          (l) => l.detail.includes("treasureGain") || l.detail.includes("treasureMiss"),
        );
        const availAt = lines.findIndex((l) => l.detail.includes("available"));
        return { treasure: treasureAt >= 0, order: treasureAt >= 0 && treasureAt < availAt };
      })
      .toEqual({ treasure: true, order: true });
    // 差额行符号语义(#566):买得起记「余」不记「差」;formatMoney 拒负后此行是契约面
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toContainText("余");
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).not.toContainText("差");
    const pid = await engineState(page, `e.board.at(${tc.index}).propertyId`);
    await waitFxIdle(page);
    const logLenBefore = (await snap(page)).log.length;
    await page.getByTestId(TESTIDS.actionButton("buy")).click();
    // 收口零探宝(#825 语义位移):窗口内只有买城行——探宝不再接链尾(旧链序断言反转重钉)。
    await expect
      .poll(
        async () => {
          const s = await snap(page);
          const lines: { detail: string }[] = s.log.slice(logLenBefore);
          const buyAt = lines.findIndex((l) => l.detail.includes(`buy player=p0 prop=${pid}`));
          const treasureAt = lines.findIndex(
            (l) => l.detail.includes("treasureGain") || l.detail.includes("treasureMiss"),
          );
          return { buy: buyAt >= 0, treasure: treasureAt >= 0 };
        },
        { timeout: 15_000, message: "珍宝城买城收口:链尾零探宝(#825 链序正典)" },
      )
      .toEqual({ buy: true, treasure: false });
  } finally {
    await unfreezeClock(page);
  }
});
