// 全浮层布局冒烟(#700;前身为 react-sidebar.spec.ts→三区骨架版,仪表条退役再改写;
// #732 全 spec 迁 844×390 标准视口——移动横屏为视觉与回归的唯一标准档,桌面档不设
// 专项布局断言,ADR-0032 标准分辨率原则):
// 席位格字段(自机入列)+ 浮签(hover/长按/贴缘翻面)+ 签面驻手牌区左端 +
// 三圆钮计数角标与藏品弹层(#361 双入口接替)+ 回合胶囊对账与总览/设置弹层。
// 二次清退(2026-11-08 唯一守环审计 v2)删两例:「浮层件可见」——四件挂载可见的
// 骨架哨兵面被同 spec 其余例覆盖,挂载失败任何例都响亮红;「回合宣告只刷常驻胶囊」
// ——12s 采样窗为快池最贵等待之一,#958 全幅横幅退役的复现防线归 visual-compare
// 像素对照(发布前),e2e 不再养时线哨。
import { test, expect } from "./fixtures";
import { quickStart, snap, dismissJinnangIfUp, actIfCan, force } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

// 844×390 标准视口(#732):本 spec 全部用例统一在标准档跑。
test.use({ viewport: { width: 844, height: 390 } });

test.describe("全浮层骨架", () => {
  // 真实段(ADR-0058;#1254 判词:本例守的环=回合宣告管线本身(宣告→fxStore→胶囊),
  // postRoll 已改瞬空钉档,钉档弃播宣告=胶囊失明属机理必然——故到站换非钉档的
  // stopAtOpeningHand(开局宣告正常播,胶囊在座);真实段不变:自走对账+真实点击全真。
  // ):真实对局自走中回合胶囊文本与引擎快照轮次的 poll 对账+总览/
  // 设置钮真实点击开收弹窗,交互链全真。
  test("顶部浮层:回合胶囊轮次与快照一致(#853 chip 退役后轮次唯一落胶囊);总览钮点开总览弹窗,设置钮可用", async ({
    page,
  }) => {
    await quickStart(page, undefined, { stopAtOpeningHand: true });
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

  // 真实段(ADR-0058):真实挂载渲染的手牌区结构(签面驻左端/架在区内)+退役
  // testid 零残留即被测环。force 判词:钉 AwaitingDecision 空闲态=断言前提(同
  // 首例;引擎自转无「钉相位」公共命令)。
  test("手牌区:签面驻左端,手牌架在区内;现金归席位格零残留", async ({ page }) => {
    // 波5b #1218 加网(「手牌区」负载挂签名,hand-zone 显隐沿丢拍→谓词加网):
    // 显隐沿的竞速本体是「waitMyPause 自然停靠(含 bot 回合询问期假停靠)→force 钉
    // 相位与真链赛跑→沿触发拍被丢」——preRoll 落都即冻结(#1221 通路,种植例评估
    // 采用,断言不依赖行军日志/回合数)让对局根本不跑,谓词竞速面整体归零。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 钉 AwaitingDecision 空闲态(preRoll 已冻,同上例)
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

  // 真实段(ADR-0058):三圆钮计数角标随快照的 poll 对账+点钮开藏品弹层、弹层忠实
  // 镜像同拍快照、X/Esc 真实关闭的交互链全真。force 判词:珍宝/名将无「授指定件/
  // 将」公共命令(引擎仅机遇效果 grantTreasure/grantHero 一途,core/encounters.ts,
  // 无直接授给命令)——珍宝走牌库直写,名将经快照 restoreFromSnapshot 通路回灌
  // (生产通路本体,联机恢复同一条产线路径,麾下行=槽位全量 #785)。
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
