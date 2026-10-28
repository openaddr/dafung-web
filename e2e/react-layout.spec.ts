// 全浮层布局冒烟(#700;前身为 react-sidebar.spec.ts→三区骨架版,仪表条退役再改写):
// 浮层件可见(顶部条/席位格列/手牌区/右下三圆钮)+ 退役核销(仪表条/战报把手/
// 静音复位钮/牌库角标等零残留)+ 席位格字段(自机入列)+ 浮签(hover/长按/贴缘翻面)
// + 签面驻手牌区左端 + 三圆钮计数角标与藏品弹层(#361 双入口接替)。
import { test, expect } from "./fixtures";
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
    // 总览钮 #702 点亮:可用,点开诸侯总览弹窗(内容与投影归 react-warlords-overview,
    // 此处只守「开得了、Esc 收得净」)
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
