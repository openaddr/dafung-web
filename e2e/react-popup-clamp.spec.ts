// 弹层族矮屏规范(#708,#687 定案施工):780×360 矮横屏实拍断口的通路守卫——
// PileShell 壳夹高(最大高=视口−64px)、行高自适应下卡面/清单行完整不切半、
// 体部内滚可达末行、头部钉住、首帧可见滚动提示(ui/scroll-area keepMounted+
// 溢出门控常显)。两族取证断口(名将=周瑜卡技能行、城池清单=第二行切半,
// 证据 tmp/mobile-audit/*-780x360.png)各一条链;视觉终证走 shot.mjs 实拍,
// 本 spec 只守几何契约(宁缺毋滥:五族共用一壳,壳规一条 + 溢出滚动一条)。
// 种植式断言(react-city-ledger 同口径):字段/行集读自引擎,选择器走 TESTIDS 单源。
// #729 追加决策卷轴哨兵:844×390 下 BannerShell 三段式(题行钉顶+正文井内滚+拍板钮
// 钉底 footer 槽)——「购地/不取」恒在视口内(Playwright 点击自动滚入视口,点击型
// 断言测不出滚出视口,须几何断言钉住)。
import { test, expect, type Page } from "./fixtures";
import { quickStart, actIfCan, freezeClock, unfreezeClock, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.use({ viewport: { width: 780, height: 360 } });

/** 弹层夹高上限(#708 规范值):视口高 − 64px(上下安全边各 32px)。 */
const CLAMP = 360 - 64;

test.describe("弹层族矮屏规范(#708)", () => {
  test("名将弹层:壳夹高视口−64,卡面行高自适应后完整不切半", async ({ page }) => {
    await quickStart(page);
    for (let i = 0; i < 10 && (await actIfCan(page)); i++);
    // 种一席名将(周瑜型单席断口,react-seat-pop 同取数口):停靠点麾下恒 0 席,
    // 不种则无卡面可断(卡面完整断言落空)。
    await page.evaluate(() => {
      const bridge = (window as any).__dafung;
      const def = bridge.heroDefs()[0];
      bridge.getEngine().players[0].heroes = [
        { id: def.id, name: def.name, title: def.title, image: def.image },
      ];
      bridge.controller().sync();
    });
    await freezeClock(page);
    try {
      await page.getByTestId(TESTIDS.pileHeroes).click();
      const modal = page.getByTestId(TESTIDS.heroModal);
      await expect(modal).toBeVisible();

      // 壳夹高:盒高 ≤ 视口−64(矮档缩内衬只会更矮,上限是硬契约)
      const box = (await modal.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(CLAMP + 0.5);

      // 卡面完整:名将卡(周瑜型单席)上下缘都落在壳盒内——实拍断口的几何化
      // (13px 基详情卡 260px 高在矮档缩 8px 基=160px,恰容于体部,不切半)
      const card = (await modal.locator(".lihui").first().boundingBox())!;
      expect(card.y).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(card.y + card.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    } finally {
      await unfreezeClock(page);
    }
  });

  test("城池清单:体部内滚可达末行、头部钉住、滚动提示首帧常显", async ({ page }) => {
    await quickStart(page);
    for (let i = 0; i < 10 && (await actIfCan(page)); i++);
    await freezeClock(page);
    try {
      // 种 6 座无主普通城(都城外,格 index 升序取前 6):行集必超体部高 → 溢出
      // 成立,内滚可达性才有断言意义(2 城基准局矮档恰容不滚,归实拍对照)。
      const lastId = await page.evaluate<string>(
        /* js */ () => {
          const e = (window as any).__dafung.getEngine();
          const me = e.players[0];
          const capTile = e.board.tiles.find(
            (t: any) => t.propertyId === e.board.at(me.capitalIndex).propertyId,
          );
          const tiles = e.board.tiles
            .filter(
              (t: any) =>
                t.type === "Property" &&
                t.propertyId &&
                t.index > capTile.index &&
                e.findOwner(t.propertyId) == null,
            )
            .slice(0, 6);
          if (tiles.length < 6) throw new Error("种植失败:无主普通城不足 6(地图/开局变了)");
          for (const t of tiles) {
            const def = e.catalog.get(t.propertyId);
            me.properties.push({
              propertyId: t.propertyId,
              level: 1,
              group: def.group,
              maxLevel: def.maxLevel,
            });
          }
          return tiles[tiles.length - 1].propertyId;
        },
      );
      await page.evaluate(() => (window as any).__dafung.controller().sync());

      await page.getByTestId(TESTIDS.seatAttr(0, "city")).click();
      const modal = page.getByTestId(TESTIDS.cityLedger);
      await expect(modal).toBeVisible();
      const box = (await modal.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(CLAMP + 0.5);

      const body = modal.getByTestId(TESTIDS.modalScrollBody);
      const viewport = body.locator('[data-slot="scroll-area-viewport"]');

      // 滚动提示首帧常显(#708 AC②):keepMounted 轨道 + 溢出门控,拇指当场可见
      await expect(body.locator('[data-slot="scroll-area-thumb"]')).toBeVisible();

      // 头部钉住:滚到底后题名行相对壳顶的位置不动(钉住=随壳不随滚;壳入场
      // 动画只整体平移,相对量免疫,实测绝对坐标会吃 1-2px 动画尾差)
      const head = modal.getByTestId(TESTIDS.modalDragHandle);
      const headRel = (await head.boundingBox())!.y - box.y;

      await viewport.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      // 等滚动事件→溢出侧状态→CSS 渐隐带收敛(React 状态属性晚滚动一拍)
      await expect
        .poll(() => body.evaluate((el) => getComputedStyle(el, "::before").opacity), {
          timeout: 5_000,
        })
        .toBe("1");
      const headAfter = (await head.boundingBox())!.y - box.y;
      expect(Math.abs(headAfter - headRel)).toBeLessThan(1);

      // 内滚可达:滚到底后末行完整落在壳盒内(行不再被壳缘切半)
      const lastRow = (await modal
        .locator(`[data-testid="${TESTIDS.cityLedgerRow(lastId)}"]`)
        .boundingBox())!;
      expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("决策卷轴拍板钮钉底(#729)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** seed 7 拦检链到购地卷轴(react-short-stage startShort 同源配方:huanyou 条带选图
   *  + 机遇归零 + 选都,人类首个落格即购地抉择)。 */
  async function startBuyScroll(page: Page): Promise<void> {
    await useHalfScale(page);
    await page.goto(`/?seed=7`);
    await page.getByTestId(HOME_TID.mapStripItem("huanyou")).click();
    await page.getByTestId(HOME_TID.solo).click();
    await page.getByTestId(SETUP_TID.screen).waitFor();
    await page.route("**/config/jiyu.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ triggerRate: 0, baseRates: { good: 0, neutral: 0, bad: 0 } }),
      }),
    );
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(TESTIDS.confirmCapitalOk).click();
    await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
  }

  test("购地卷轴:拍板两钮恒在视口内、壳高 ≤86dvh、钮盒全落壳盒内(#729)", async ({ page }) => {
    await startBuyScroll(page);
    // 入场 banner-drop 带整体位移:几何断言包 toPass 吸收动画中的瞬时盒
    // (react-short-stage 拼点签面同法);种植式断言,零固定 sleep
    await expect(async () => {
      const shell = (await page.getByTestId(SCROLL_TESTIDS.buyScroll).boundingBox())!;
      const buy = (await page.getByTestId(TESTIDS.actionButton("buy")).boundingBox())!;
      const skip = (await page.getByTestId(TESTIDS.actionButton("skip")).boundingBox())!;
      // 壳夹高:横幅系 86dvh 口径不动(390×0.86≈335.4;.5 容亚像素舍入)
      expect(shell.height).toBeLessThanOrEqual(390 * 0.86 + 0.5);
      for (const [label, box] of [
        ["购地", buy],
        ["不取", skip],
      ] as const) {
        // 拍板钮恒在视口内(#729 根因:钮原在正文井内,矮横屏随表滚出视口,
        // 点击型断言被自动滚入遮蔽,须几何断言钉住)
        expect(box.x, `${label}钮左缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label}钮上缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label}钮右缘出视口`).toBeLessThanOrEqual(844);
        expect(box.y + box.height, `${label}钮下缘出视口`).toBeLessThanOrEqual(390);
        // 钮盒完全在壳盒内:钉底段是壳的第三段,不漂出壳外
        expect(box.x, `${label}钮左缘出壳`).toBeGreaterThanOrEqual(shell.x - 0.5);
        expect(box.y, `${label}钮上缘出壳`).toBeGreaterThanOrEqual(shell.y - 0.5);
        expect(box.x + box.width, `${label}钮右缘出壳`).toBeLessThanOrEqual(
          shell.x + shell.width + 0.5,
        );
        expect(box.y + box.height, `${label}钮下缘出壳`).toBeLessThanOrEqual(
          shell.y + shell.height + 0.5,
        );
      }
    }).toPass({ timeout: 5_000 });
  });
});
