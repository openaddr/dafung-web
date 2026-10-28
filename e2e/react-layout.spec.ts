// 全浮层布局冒烟(#700;前身为 react-sidebar.spec.ts→三区骨架版,仪表条退役再改写;
// #732 全 spec 迁 844×390 标准视口——移动横屏为视觉与回归的唯一标准档,桌面档不设
// 专项布局断言,ADR-0032 标准分辨率原则):
// 浮层件可见(顶部条/席位格列/手牌区/右下三圆钮)+ 退役核销(仪表条/战报把手/
// 静音复位钮/牌库角标等零残留)+ 席位格字段(自机入列)+ 浮签(hover/长按/贴缘翻面)
// + 签面驻手牌区左端 + 三圆钮计数角标与藏品弹层(#361 双入口接替)
// + 顶中知会横幅槽(#732:回合横幅入槽/等待条让位回归/同槽互斥排队/都城停条带)。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  snap,
  waitMyPause,
  waitSettled,
  dismissJinnangIfUp,
  actIfCan,
  force,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

// 844×390 标准视口(#732):本 spec 全部用例统一在标准档跑。
test.use({ viewport: { width: 844, height: 390 } });

test.describe("全浮层骨架", () => {
  test("浮层件可见,仪表条系退役零残留", async ({ page }) => {
    await quickStart(page);
    await expect(page.getByTestId(TESTIDS.topBar)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatRail)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.pileButtons)).toBeVisible();
    // 退役容器零残留(#700:仪表条本体/战报把手/旧顶栏角件;#253 迁移清单存档)
    for (const t of [
      "dashboard-bar",
      "log-tab",
      "mute-button",
      "reset-view",
      "topbar-deck",
      "topbar-target",
      "topbar-active",
      "status-bar-panel",
      "hand-panel",
      "treasury-panel",
      "others-panel",
      "sidebar-panel",
      "sidebar-collapsed",
    ]) {
      await expect(page.locator(`[data-testid="${t}"]`)).toHaveCount(0);
    }
  });

  test("顶部浮层:顶中「N 轮」chip 与快照一致;总览钮点开总览弹窗,设置钮可用", async ({ page }) => {
    await quickStart(page);
    await expect
      .poll(async () => {
        const s = await snap(page);
        return (await page.getByTestId(TESTIDS.topbarRound).textContent()) === `${s.round} 轮`;
      })
      .toBe(true);
    // 详情钮 #702 点亮(#732 正名「详情」):可用,点开诸侯详情弹窗(内容与投影归
    // react-warlords-overview,此处只守「开得了、Esc 收得净」)
    await expect(page.getByTestId(TESTIDS.topbarOverview)).toBeEnabled();
    await page.getByTestId(TESTIDS.topbarOverview).click();
    await expect(page.getByTestId(TESTIDS.warlordsOverview)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(TESTIDS.warlordsOverview)).toBeHidden();
    await expect(page.getByTestId(TESTIDS.settingsButton)).toBeEnabled();
  });

  test("席位格字段:全员一人一格(自机入列),现金/计数随快照", async ({ page }) => {
    await quickStart(page);
    await waitMyPause(page, 0);
    await waitSettled(page);
    // 自机入列(#698):座位 0 挂 seat-self,对手席挂 seat-N;全部席位同模板
    await expect(page.getByTestId(TESTIDS.seatSelf)).toBeVisible();
    await expect
      .poll(async () => {
        const s = await snap(page);
        const ok = [];
        for (let seat = 0; seat < s.players.length; seat++) {
          const p = s.players[seat];
          const cash = await page.getByTestId(`seat-cash-${seat}`).textContent();
          const stam = await page.getByTestId(`seat-stamina-${seat}`).getAttribute("aria-label");
          const warrant = await page
            .getByTestId(`seat-attr-warrant-${seat}`)
            .getAttribute("aria-label");
          ok.push(cash === String(p.cash) && stam != null && warrant === `委任状 ${p.warrants}`);
        }
        return ok.every(Boolean);
      })
      .toBe(true);
  });

  test("浮签:hover 显名词释义,离签即隐;长按 400ms 同效;贴右缘席位向左翻面", async ({ page }) => {
    // 两大户之一(#294 决议):三个 toPass 各自与「对局自走弹卷轴抢悬停」竞速,负载下
    // 60s 默认档偏紧是超时 flake 家族——标 slow 防超时,非删例。
    test.slow();
    await quickStart(page);
    const badge = page.getByTestId(TESTIDS.seatAttr(1, "warrant"));
    const tip = page.getByTestId(TESTIDS.attrTip);
    // 对局自走会随时弹决策卷轴/骰子 overlay 抢走悬停——每步动作都带「清卷轴 + 重试」
    //(断言只依赖图标浮签机制本身,不依赖数值,推进无妨)。
    const clear = async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
    };
    // hover:名词 + 一句话释义
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await expect(tip).toBeVisible();
      await expect(tip).toContainText("委任状");
    }).toPass({ timeout: 30_000 });
    await page.mouse.move(400, 400);
    await expect(tip).toBeHidden();
    // 长按(压住 ≥400ms)同效
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await page.mouse.down();
      await expect(tip).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await page.mouse.up();
    await expect(tip).toBeHidden();
    // #701 起卷轴徽章轻点=委任明细直达:长按的 down+up 落幕即成点击,明细弹层(z-50
    // 遮罩)必然在挂——Esc 收净再走贴缘翻面段,不然遮罩吞掉后续全部 hover。
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(TESTIDS.seatWarrantModal)).toBeHidden();
    // 贴右缘翻面:席位卡列在视口右缘,浮签整体翻到徽章左侧(不溢出视口)
    await expect(async () => {
      await clear();
      await badge.hover({ timeout: 3_000 });
      await expect(tip).toBeVisible();
    }).toPass({ timeout: 30_000 });
    const bb = (await badge.boundingBox())!;
    const tb = (await tip.boundingBox())!;
    expect(tb.x + tb.width).toBeLessThanOrEqual(bb.x + 4); // 浮签右缘不越过徽章左缘(留 4px 容差)
    expect(tb.x).toBeGreaterThanOrEqual(0);
  });

  test("手牌区:签面驻左端,手牌架在区内;现金归席位格零残留", async ({ page }) => {
    await quickStart(page);
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
    //(快照行只写 id,引擎 restore 按 HEROES 表回填全量 def——联机恢复同一条产线路径)
    await force(
      page,
      `
      e.players[0].treasures.push(e.treasureDeck[0], e.treasureDeck[1]);
      const s = e.snapshot();
      s.players[0].heroes.push(
        { id: "zhouyu", name: "周瑜", title: "雅量高致", desc: "", image: "" },
        { id: "huatuo", name: "华佗", title: "神医", desc: "", image: "" },
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
          return (
            dom.gem === String(s.players[0].treasures.length) &&
            dom.hero === `${s.players[0].heroes.length}/3`
          );
        },
        { message: "三圆钮朱砂角标计数与快照一致" },
      )
      .toBe(true);
    // 点「珍宝」圆钮 → 珍宝弹层:标题随入口(单次 evaluate 原子采样:DOM 与快照同拍)
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId(TESTIDS.pileTreasures).click({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 });
    const gemModal = await page.evaluate((sel) => {
      const s = (window as any).__dafung.snapshot();
      const m = document.querySelector(`[data-testid="${sel}"]`);
      return {
        treasures: s.players[0].treasures.length,
        up: m != null,
        title: m?.querySelector(".pile-title")?.textContent ?? "",
      };
    }, TESTIDS.treasureModal);
    expect(gemModal.up).toBe(true);
    expect(gemModal.title).toContain("珍宝");
    expect(gemModal.treasures).toBeGreaterThanOrEqual(2);
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

test.describe("顶中知会横幅槽(#732)", () => {
  // 时间线采样观测(零固定 sleep):标准档(0.25)单条横幅 ~475ms,采样拍 ~100-200ms
  // 必多拍命中;槽互斥/让位/回归全在同一份时间线上断言,不靠散点轮询赛跑。
  // 采样拍内随手放行人类决策(dismissJinnangIfUp/actIfCan):对局自走不停摆——
  // 半速档实锤教训:bot 产批快于实播时追帧/吸附会按 ADR-0029 ③ 丢弃待播知会,
  // 标准档播放快于产出无积压;人类决策停摆则无回合变化可观测。
  // 用例含 quickStart 全链 + 采样窗,60s 默认档偏紧,组级放宽(同族口径)。
  test.setTimeout(240_000);
  const SAMPLE_MS = 20_000;

  /** 单拍采样:槽内带件数/文本/落点 + 等待条在场(读数收进单次 evaluate)。 */
  function sampleOnce(page: Page) {
    return page.evaluate(
      ({ slot, waiting }) => {
        const slotEl = document.querySelector(`[data-testid="${slot}"]`);
        const bandEls = slotEl
          ? [...slotEl.querySelectorAll<HTMLElement>(".fx-turn-banner,.fx-halt-banner")]
          : [];
        const first = bandEls[0]?.getBoundingClientRect();
        return {
          bands: bandEls.length,
          top: first ? first.top : null,
          turn: bandEls[0]?.textContent ?? null,
          waiting: document.querySelector(`[data-testid="${waiting}"]`) != null,
        };
      },
      { slot: TESTIDS.noticeBanner, waiting: TESTIDS.waitingBar },
    );
  }

  // 排队(≥2 条依次播)与都城停条带形态(高度≤条带级)不走 e2e:#732 三遍实证
  // ADR-0029 落后即校准的吸附档在 bot 热链期系统性丢弃批末位知会,窗内计数类断言
  // 与演出治理竞速(观测性竞速,非产品回归;现象与三方案见 #734 留观票)。此二者
  // 改走机制论证(fxStore 知会槽泵=排队/互斥结构单源)+截图自证
  // (tmp/ui-shots/hengfu/2-turn-banner-in-slot.png、3-halt-band-in-slot.png)。
  test("回合横幅入槽:展示期落槽位且等待条让位,播完回归;同刻槽内仅一条", async ({ page }) => {
    test.slow();
    await quickStart(page);
    // 时间线采样:每拍先放行人类决策(保对局自走)再读槽,窗口 20s
    const t0 = Date.now();
    const samples: Awaited<ReturnType<typeof sampleOnce>>[] = [];
    while (Date.now() - t0 < SAMPLE_MS) {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      samples.push(await sampleOnce(page));
    }
    // ① 回合横幅经槽展示(读数取自槽容器内部查询 = 在槽位),落点在槽位行
    //   (844×390 槽区 top ≤ 20;旧 16% 落点 ~36+ 必挂)
    const withTurn = samples.filter((s) => s.turn?.includes("之回合"));
    expect(withTurn.length, "采样窗内未观测到回合横幅").toBeGreaterThan(0);
    for (const s of withTurn) expect(s.top!, "回合横幅未落槽位").toBeLessThanOrEqual(20);
    // ② 同槽互斥:任何采样时刻槽内至多一条带(排队语义由 fxStore 槽泵结构单源,
    //    不做窗内计数断言——见本 describe 头注)
    expect(
      samples.every((s) => s.bands <= 1),
      "同一时刻槽内出现多条带",
    ).toBe(true);
    // ③ 等待条让位与回归:横幅展示期与等待条零并存;最后一条横幅播完后等待条回归
    expect(
      samples.every((s) => !(s.turn != null && s.waiting)),
      "瞬态横幅与等待条同刻并存(让位失效)",
    ).toBe(true);
    let lastTurn = -1;
    samples.forEach((s, i) => {
      if (s.turn != null) lastTurn = i;
    });
    expect(
      samples.slice(lastTurn + 1).some((s) => s.waiting),
      "横幅播完后等待条未回归",
    ).toBe(true);
  });
});
