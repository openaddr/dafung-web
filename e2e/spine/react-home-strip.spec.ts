// 地板名册(ADR-0062):地板·脊柱构造器——脊柱①旅程例(条带选图→起兵→棋盘挂载),永不迁移
// #707 首页矮横屏收纳:地图选择器横排条带 + 形态分档断点接入。
// 矮横屏 844×390(landscape + max-height:500px,与对局屏 layout.css A 档同口径):
//   ① 选图+开局全流程零滚动零裁半(旧况:二级选图弹层裁半、document 不可滚、
//      换图开局不可达,#684 实拍 tmp/mobile-audit/home-844x390.png);
//   ② 条带左右滑可达全部地图、选中态视觉可辨(金框,aria-pressed 语义同步)
//      ——#947 前以「植自建图撑溢出」验滚动可达,自建图通路随编辑器退役后
//      内置清单不再溢出(全图恒可见),溢出可达性用例随之删除;
//   ③ 桌面档不再设专项断言(#733:布局回归收窄到 844×390 移动横屏标准档,
//      原「桌面视口零回归」case 退役;条带档本就是矮横屏档形态,桌面零重排口径不变)。
// 几何断言收进 toPass:首页入场 stagger/screen-in 播动画期间量盒有瞬时位移
// (react-narrow 同法),落定后重试即稳。
import { test, expect } from "../fixtures";
import { disableEncounters, waitForEngine } from "../react-helpers";
import { HOME_TID } from "../../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../../src/app/screens/setup/testids";

test.describe("矮横屏 844×390(条带档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 真实段(脊柱①全 UI 链声明,ADR-0058):「真人从首页能玩进来」前门专守——条带
  // 选图→单机→起兵→棋盘挂载全 UI 链逐环真实点击,零种植零冻结(seed 42 只钉骰序,
  // 开局链本身全真);换图起兵可达正是 #707 交付的本环。脊柱例禁新增种植化改造。
  test("选图+开局全流程:零页面滚动、控件零裁半、换图起兵可达", async ({ page }) => {
    await disableEncounters(page);
    await page.goto("/?seed=42");

    // 条带档结构:内联条带在,弹层入口(选择地图钮/地图回显行)退役
    const strip = page.getByTestId(HOME_TID.mapStrip);
    await expect(strip).toBeVisible();
    await expect(page.getByTestId(HOME_TID.selectMap)).toHaveCount(0);
    await expect(page.getByTestId(SETUP_TID.currentMapName)).toHaveCount(0);
    await expect(page.getByTestId(HOME_TID.mapStripItem("guanzhong"))).toBeVisible();
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
      for (const tid of [HOME_TID.solo, HOME_TID.online, HOME_TID.mapStrip]) {
        const b = (await page.getByTestId(tid).boundingBox())!;
        expect(b.x, tid).toBeGreaterThanOrEqual(0);
        expect(b.y, tid).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, tid).toBeLessThanOrEqual(vp.w);
        expect(b.y + b.height, tid).toBeLessThanOrEqual(vp.h);
      }
    }).toPass({ timeout: 15_000 });

    // 条带内点选即选中:金框选中态(视觉)+ aria-pressed(语义)+ localStorage 记忆
    const prev = page.getByTestId(HOME_TID.mapStripItem("guanzhong"));
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

    // 双图右缘对齐(#843/P2-1):2×168(flex 基准 160+gap 8)≤ 容器宽 → 解除 max-w,
    // 条目填满容器——末项右缘与条带容器右缘对齐(条带容器与按钮列同为
    // w-[min(600px,92vw)],填满即对齐),且零横向溢出;px-0.5 内衬 2px 入容差。
    const stripBox = (await strip.boundingBox())!;
    const lastBox = (await next.boundingBox())!;
    expect(
      stripBox.x + stripBox.width - (lastBox.x + lastBox.width),
      "末项右缘距条带容器右缘",
    ).toBeLessThanOrEqual(3);
    expect(
      await strip.evaluate((el) => el.scrollWidth - el.clientWidth),
      "条带横向溢出量",
    ).toBeLessThanOrEqual(1);

    // 换图开局全流程可达(旧况此路被裁半弹层堵死):选图 → 单机 → 起兵 → 8 城小环
    await page.getByTestId(HOME_TID.solo).click();
    await expect(page.getByTestId(SETUP_TID.screen)).toBeVisible();
    await page.getByTestId(SETUP_TID.startGame).click();
    await waitForEngine(page);
    await expect(page.locator("[data-tile]")).toHaveCount(8);
  });
});
