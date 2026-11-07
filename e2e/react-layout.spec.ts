// 全浮层布局冒烟(#700;前身为 react-sidebar.spec.ts→三区骨架版,仪表条退役再改写;
// #732 全 spec 迁 844×390 标准视口——移动横屏为视觉与回归的唯一标准档,桌面档不设
// 专项布局断言,ADR-0032 标准分辨率原则):
// 浮层件可见(顶部条/席位格列/手牌区/右下三圆钮)+ 席位格字段(自机入列)+
// 浮签(hover/长按/贴缘翻面)+ 签面驻手牌区左端 + 三圆钮计数角标与藏品弹层
// (#361 双入口接替)
// + 顶中知会横幅槽(#732:回合横幅入槽/等待条让位回归/同槽互斥排队/都城停条带)。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  snap,
  waitMyPause,
  dismissJinnangIfUp,
  actIfCan,
  force,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

// 844×390 标准视口(#732):本 spec 全部用例统一在标准档跑。
test.use({ viewport: { width: 844, height: 390 } });

test.describe("全浮层骨架", () => {
  test("浮层件可见", async ({ page }) => {
    await quickStart(page);
    // 停车钉我的回合(显隐回合联动后,bot 回合手牌区整区卸载):等自然停靠再钉
    // AwaitingDecision 空闲态(float-skeleton #1006 例同款配方),骨架断言才有
    // 「架亮」的钉住前提。
    await waitMyPause(page, 0, 90_000);
    await force(
      page,
      `
      e.lastLandOutcome = null;
      e.pendingLand = null;
      e.turnPhase = "AwaitingDecision";
    `,
    );
    // 停靠盖板出清(#987):招贤/购地决策面板拦点击,actIfCan 有界清点(warlords ④ 同款)
    for (let i = 0; i < 10; i++) {
      if (!(await actIfCan(page))) break;
    }
    await expect(page.getByTestId(TESTIDS.topBar)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatRail)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.pileButtons)).toBeVisible();
    // 13 项退役容器零残留段已删(2026-11-07 菜单A:#700 翻面已久,核销断言价值衰减,
    // 宁缺毋滥;骨架哨兵=上面四个可见面)。
  });

  test("顶部浮层:回合胶囊轮次与快照一致(#853 chip 退役后轮次唯一落胶囊);总览钮点开总览弹窗,设置钮可用", async ({
    page,
  }) => {
    await quickStart(page);
    await expect
      .poll(async () => {
        const s = await snap(page);
        // 胶囊内「第 N 轮」档(.tc-round,NoticeBanner 单源)与快照回合一致
        return (
          (await page.getByTestId(TESTIDS.turnCapsule).locator(".tc-round").textContent()) ===
          `第${s.round}轮`
        );
      })
      .toBe(true);
    // 决策盖板出清(#987 定性):购地/招贤横幅(banner-overlay)拦点击,actIfCan 有界
    // 清点后再点总览钮(本文件首例同款;随机 seed 下人类恰在点击窗口落进购地决策
    // 曾致 60s×2 假挂,#1093)
    for (let i = 0; i < 10; i++) {
      if (!(await actIfCan(page))) break;
    }
    // 详情钮 #702 点亮(#732 正名「详情」):可用,点开诸侯详情弹窗(内容与投影归
    // react-warlords-overview,此处只守「开得了、Esc 收得净」)
    await expect(page.getByTestId(TESTIDS.topbarOverview)).toBeEnabled();
    await page.getByTestId(TESTIDS.topbarOverview).click();
    await expect(page.getByTestId(TESTIDS.warlordsOverview)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(TESTIDS.warlordsOverview)).toBeHidden();
    await expect(page.getByTestId(TESTIDS.settingsButton)).toBeEnabled();
  });

  // 「席位格字段:全员一人一格,现金/计数随快照」例已删(#1181 棒一重筛):投影逐席
  // 一致与自机入列面归 react-seat-cells ① cellsMatchSnapshot + ② 自机挂点,重复例
  // 按宁缺毋滥直删(体力 aria-label 在场断言无独立回归价值,随例退场)。

  test("手牌区:签面驻左端,手牌架在区内;现金归席位格零残留", async ({ page }) => {
    await quickStart(page);
    // 停车钉我的回合(同上例:显隐回合联动,bot 回合手牌区整区卸载)
    await waitMyPause(page, 0, 90_000);
    await force(
      page,
      `
      e.lastLandOutcome = null;
      e.pendingLand = null;
      e.turnPhase = "AwaitingDecision";
    `,
    );
    const zone = page.getByTestId(TESTIDS.handZone);
    await expect(zone).toBeVisible();
    // 签面(testid dice-face 契约不变):文本 ∈ 签/待/一~六
    await expect(page.getByTestId(TESTIDS.diceFace)).toHaveText(/[签一二三四五六]/);
    // 手牌架挂手牌区内
    await expect(zone.getByTestId(TESTIDS.jinnangRack)).toBeVisible();
    // 现金大数/体力刻度随仪表条退役:dash 系 testid 零残留(数值归席位格)
    await expect(page.getByTestId("dash-cash")).toHaveCount(0); // testids:allow 退役 testid 零残留断言——常量已随 #700 核销删除,无单源可引
    await expect(page.getByTestId("dash-stamina")).toHaveCount(0); // testids:allow 同上(dash 系退役核销)
  });

  test("三圆钮:计数角标随快照,珍宝/名将点开藏品弹层(#361 双入口接替)", async ({ page }) => {
    test.setTimeout(120_000); // 对局自走 + 多段 toPass 轮询,60s 默认档偏紧(前例同口径)
    await quickStart(page);
    // 退役核销:牌架双入口零残留(#700 接替者=三圆钮)
    await expect(page.getByTestId("rack-treasures")).toHaveCount(0); // testids:allow 退役 testid 零残留断言——常量已随 #361/#700 核销删除,无单源可引
    await expect(page.getByTestId("rack-heroes")).toHaveCount(0); // testids:allow 同上(牌架双入口退役核销)
    // 种珍宝×2 + 名将×2:珍宝走牌库直写(真 TreasureDef);名将走快照 restore 通路
    //(快照麾下行=槽位全量(#785):heroId+已授技(全池)+冷却账,restore 原样回灌——
    //联机恢复同一条产线路径)
    await force(
      page,
      `
      e.players[0].treasures.push(e.treasureDeck[0], e.treasureDeck[1]);
      const s = e.snapshot();
      s.players[0].heroes.push(
        { heroId: "zhouyu", skillIds: ["jixing", "huogong", "leigu"], lastFired: {} },
        { heroId: "huatuo", skillIds: ["qingnang", "zhenji"], lastFired: {} },
      );
      s.recruitedHeroIds.push("zhouyu", "huatuo");
      e.restoreFromSnapshot(s);
    `,
    );
    // 三圆钮计数与实时快照一致(对局自走藏品可能继续进账,签数随拍对齐)
    await expect
      .poll(
        async () => {
          await dismissJinnangIfUp(page);
          await actIfCan(page).catch(() => false);
          const s = await snap(page);
          const dom = await page.evaluate(
            (sel) => ({
              gem: document.querySelector(`[data-testid="${sel.gem}"] .cnt`)?.textContent,
              hero: document.querySelector(`[data-testid="${sel.hero}"] .cnt`)?.textContent,
            }),
            { gem: TESTIDS.pileTreasures, hero: TESTIDS.pileHeroes },
          );
          // 零值角标隐藏(#743 G):计数 0 时 .cnt 不渲染,期望值=undefined 与 DOM 对齐
          const gem = s.players[0].treasures.length;
          const heroes = s.players[0].heroes.length;
          return (
            dom.gem === (gem > 0 ? String(gem) : undefined) &&
            dom.hero === (heroes > 0 ? `${heroes}/3` : undefined)
          );
        },
        { message: "三圆钮计数角标与快照一致(零值隐藏 #743 G)" },
      )
      .toBe(true);
    // 点「珍宝」圆钮 → 珍宝弹层:标题随入口(单次 evaluate 原子采样:DOM 与快照同拍)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId(TESTIDS.pileTreasures).click({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 });
    // 点「珍宝」圆钮 → 珍宝弹层:陈列忠实镜像同拍快照(单次 evaluate 原子采样:DOM 与
    // 快照同拍)。#799:退役「≥2 件」下限——种植件在对局自走中可被 bot 锦囊【窃玉偷香】
    // 合法窃走(stealTreasure 随机选受害方随机取件,何时发生随种子走位),锚件数=锚走位
    // 偶然;本例不变量=「点开即弹、弹层=快照」:网格件数与「已持有 · N 件」计数行逐拍
    // 对齐快照,零件空态照常可开(PileModal 业务空态)。
    await expect
      .poll(
        async () => {
          const m = await page.evaluate((sel) => {
            const s = (window as any).__dafung.snapshot();
            const el = document.querySelector(`[data-testid="${sel}"]`);
            return {
              up: el != null,
              title: el?.querySelector(".pile-title")?.textContent ?? "",
              snapCount: s.players[0].treasures.length,
              cells: el?.querySelectorAll(".pile-cell").length ?? -1,
              zone: el?.querySelector(".pile-zone")?.textContent ?? "",
            };
          }, TESTIDS.treasureModal);
          return (
            m.up &&
            m.title.includes("珍宝") &&
            m.cells === m.snapCount &&
            m.zone.includes(`已持有 · ${m.snapCount} 件`)
          );
        },
        { message: "珍宝弹层忠实镜像同拍快照(点开即弹+陈列件数/计数行随快照,#799)" },
      )
      .toBe(true);
    // 右上 X 关闭,卸载零残留
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(page.getByTestId(TESTIDS.treasureModal)).toHaveCount(0);
    // 点「名将」圆钮 → 名将弹层:HeroCardFace 详情档网格(原子采样同口径)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId(TESTIDS.pileHeroes).click({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 });
    const heroModal = await page.evaluate((sel) => {
      const m = document.querySelector(`[data-testid="${sel}"]`);
      return {
        up: m != null,
        title: m?.querySelector(".pile-title")?.textContent ?? "",
        names: [...(m?.querySelectorAll(".m-name") ?? [])].map((el) => el.textContent),
      };
    }, TESTIDS.heroModal);
    expect(heroModal.up).toBe(true);
    expect(heroModal.title).toContain("名将");
    expect(heroModal.names).toContain("周瑜");
    // Esc 关闭(Base UI 底件行为),卸载零残留
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(TESTIDS.heroModal)).toHaveCount(0);
  });
});

test.describe("顶中知会槽·常驻回合胶囊(#732/#958)", () => {
  // 时间线采样观测(零固定 sleep):胶囊常驻(开局首宣告即立),采样拍 ~100-200ms
  // 必多拍命中;回合宣告只刷胶囊(#958 全幅横幅退役),断言=胶囊随回合轮换换装+
  // 全幅件零出现。采样拍内随手放行人类决策(dismissJinnangIfUp/actIfCan):对局自走
  // 不停摆——人类决策停摆则无回合变化可观测。
  test.setTimeout(120_000);
  const SAMPLE_MS = 12_000;

  /** 单拍采样:胶囊读数/全幅件在否/等待条在场(读数收进单次 evaluate)。 */
  function sampleOnce(page: Page) {
    return page.evaluate(
      ({ slot, capsule, waiting }) => {
        const slotEl = document.querySelector(`[data-testid="${slot}"]`);
        const capsuleEl = slotEl?.querySelector(`[data-testid="${capsule}"]`);
        return {
          capsuleText: capsuleEl?.textContent ?? null,
          turnBands: slotEl ? slotEl.querySelectorAll(".fx-turn-banner").length : 0,
          waiting: document.querySelector(`[data-testid="${waiting}"]`) != null,
        };
      },
      { slot: TESTIDS.noticeBanner, capsule: TESTIDS.turnCapsule, waiting: TESTIDS.waitingBar },
    );
  }

  test("回合宣告只刷常驻胶囊:随轮换换装,全幅横幅永不出现", async ({ page }) => {
    test.slow();
    await quickStart(page);
    // 时间线采样:每拍先放行人类决策(保对局自走)再读槽,窗口 12s
    const t0 = Date.now();
    const samples: Awaited<ReturnType<typeof sampleOnce>>[] = [];
    while (Date.now() - t0 < SAMPLE_MS) {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      samples.push(await sampleOnce(page));
    }
    // ① 胶囊常驻在槽(采样窗内必命中)
    const withCapsule = samples.filter((s) => s.capsuleText != null);
    expect(withCapsule.length, "采样窗内未观测到回合胶囊").toBeGreaterThan(0);
    // ② 胶囊随回合轮换换装(不同回合方/轮次=读数变化;quickStart 局人类+bot 多回合)
    const readings = new Set(withCapsule.map((s) => s.capsuleText));
    expect(readings.size, "胶囊读数无变化(回合宣告未刷新)").toBeGreaterThan(1);
    // ③ 全幅横幅退役钉(#958):任何采样时刻零 .fx-turn-banner
    expect(
      samples.every((s) => s.turnBands === 0),
      "全幅回合横幅仍在出场",
    ).toBe(true);
  });
});
