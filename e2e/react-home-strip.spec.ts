// #707 首页矮横屏收纳:地图选择器横排条带 + 形态分档断点接入。
// 矮横屏 844×390(landscape + max-height:500px,与对局屏 layout.css A 档同口径):
//   ① 选图+开局全流程零滚动零裁半(旧况:二级选图弹层裁半、document 不可滚、
//      换图开局不可达,#684 实拍 tmp/mobile-audit/home-844x390.png);
//   ② 条带左右滑可达全部地图(植自建图撑出溢出,横向滚轮 = 真实用户滚动通路),
//      选中态视觉可辨(金框,aria-pressed 语义同步);
//   ③ 桌面档不再设专项断言(#733:布局回归收窄到 844×390 移动横屏标准档,
//      原「桌面视口零回归」case 退役;条带档本就是矮横屏档形态,桌面零重排口径不变)。
// 几何断言收进 toPass:首页入场 stagger/screen-in 播动画期间量盒有瞬时位移
// (react-narrow 同法),落定后重试即稳。
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { waitForEngine } from "./react-helpers";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("矮横屏 844×390(条带档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("选图+开局全流程:零页面滚动、控件零裁半、换图起兵可达", async ({ page }) => {
    await page.route("**/config/jiyu.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, baseRates: { good: 0, neutral: 0, bad: 0 } }),
      }),
    );
    await page.goto("/?seed=42");

    // 条带档结构:内联条带在,弹层入口(选择地图钮/地图回显行)退役
    const strip = page.getByTestId(HOME_TID.mapStrip);
    await expect(strip).toBeVisible();
    await expect(page.getByTestId(HOME_TID.selectMap)).toHaveCount(0);
    await expect(page.getByTestId(SETUP_TID.currentMapName)).toHaveCount(0);
    await expect(page.getByTestId(HOME_TID.mapStripItem("huanyou"))).toBeVisible();
    await expect(page.getByTestId(HOME_TID.mapStripItem("zhongyuan"))).toBeVisible();

    // 零滚动(首页根滚动容器 + document 双断)+ 主控件零裁半(全部完整落在视口内)
    await expect(async () => {
      const scroll = await page.evaluate((sel) => {
        const root = document.querySelector(`[data-testid="${sel}"]`);
        if (!root) throw new Error("home-screen 未挂载");
        return {
          rootDx: root.scrollHeight - root.clientHeight,
          docDx: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
      }, HOME_TID.screen);
      expect(scroll.rootDx).toBeLessThanOrEqual(1);
      expect(scroll.docDx).toBeLessThanOrEqual(1);
      const vp = { w: 844, h: 390 };
      for (const tid of [HOME_TID.solo, HOME_TID.online, HOME_TID.editMap, HOME_TID.mapStrip]) {
        const b = (await page.getByTestId(tid).boundingBox())!;
        expect(b.x, tid).toBeGreaterThanOrEqual(0);
        expect(b.y, tid).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, tid).toBeLessThanOrEqual(vp.w);
        expect(b.y + b.height, tid).toBeLessThanOrEqual(vp.h);
      }
    }).toPass({ timeout: 15_000 });

    // 条带内点选即选中:金框选中态(视觉)+ aria-pressed(语义)+ localStorage 记忆
    const prev = page.getByTestId(HOME_TID.mapStripItem("huanyou"));
    const next = page.getByTestId(HOME_TID.mapStripItem("zhongyuan"));
    await next.click();
    await expect(next).toHaveAttribute("aria-pressed", "true");
    await expect(prev).toHaveAttribute("aria-pressed", "false");
    // 选中态视觉可辨(§4.6 状态表达);transition-colors 在途,poll 到稳态再比
    await expect
      .poll(async () => {
        const sel = await next.evaluate((el) => getComputedStyle(el).borderColor);
        const unsel = await prev.evaluate((el) => getComputedStyle(el).borderColor);
        return sel !== unsel;
      })
      .toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toBe("zhongyuan");

    // 换图开局全流程可达(旧况此路被裁半弹层堵死):选图 → 单机 → 起兵 → 8 城小环
    await page.getByTestId(HOME_TID.solo).click();
    await expect(page.getByTestId(SETUP_TID.screen)).toBeVisible();
    await page.getByTestId(SETUP_TID.startGame).click();
    await waitForEngine(page);
    await expect(page.locator("[data-tile]")).toHaveCount(8);
  });

  test("条带左右滑可达全部地图:溢出时末项经横向滚动可达可选中", async ({ page }) => {
    // 植 6 张自建图撑出条带溢出(内置 2 + 自建 6 = 8 项,160px 卡远超容器宽);
    // 条带只消费 tiles.length/targetNetWorth,植最小记录即可(不起兵不 loadMapData)。
    await page.addInitScript(() => {
      const mk = (i: number) => ({
        id: `custom-e2e-${i}`,
        name: `自建图${i}`,
        data: {
          tiles: Array.from({ length: 4 + i }, (_, j) => ({ pos: [j * 50, 0], name: `城${j}` })),
          targetNetWorth: 30000,
        },
        createdAt: Date.now() + i,
      });
      localStorage.setItem("dafung-custom-maps", JSON.stringify([1, 2, 3, 4, 5, 6].map(mk)));
    });
    await page.goto("/");

    const strip = page.getByTestId(HOME_TID.mapStrip);
    await expect(strip).toBeVisible();
    const last = page.getByTestId(HOME_TID.mapStripItem("custom-e2e-6"));
    await expect(page.getByTestId(HOME_TID.mapStripItem("custom-e2e-1"))).toBeVisible();

    // 溢出成立:内容宽 > 容器宽(全图可见才需要本用例;不溢出即断言失效,先钉住前提)
    const { scrollWidth, clientWidth } = await strip.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    // 末项起点在可视域右侧之外(可及性前提),横向滚轮(真实用户通路)后滚入可视域
    const stripBox = (await strip.boundingBox())!;
    expect(await isInView(page, "home-map-strip-item-custom-e2e-6", stripBox)).toBe(false);
    await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
    await page.mouse.wheel(scrollWidth, 0);
    await expect
      .poll(async () => isInView(page, "home-map-strip-item-custom-e2e-6", stripBox), {
        timeout: 5_000,
      })
      .toBe(true);

    // 可达即可选中:点末项,选中态 + 记忆落账
    await last.click();
    await expect(last).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toBe("custom-e2e-6");
  });
});

/** 条目横向是否完整落在条带可视域内(裁切状态即可达性,零容差判进/出)。 */
async function isInView(
  page: Page,
  tid: string,
  stripBox: { x: number; width: number },
): Promise<boolean> {
  const b = await page.getByTestId(tid).boundingBox();
  if (!b) return false;
  return b.x >= stripBox.x - 1 && b.x + b.width <= stripBox.x + stripBox.width + 1;
}
