// 玩法手册 e2e(#1073,spec #1069 T4):首页「手册」入口 → 五签陈列 → 详情开合。
// 全静态 UI(读 core 目录表直渲,零引擎零机遇随机),无 clock 冻结、无种植。
// 陈列数口径(spec #1069 收口期事实修正):名将/技能 = **运行时实数**——扩展包
// (extensions/hero-taishici)经 main.tsx 顶层 await 注册进 SKILLS/HEROES 单池后,
// 手册各签直读同一注册面,故卡数随目录数据走、不落死数:
//   名将 = 与 window.__dafung.heroDefs() 对账(heroDefs 单源 react-extensions 同款),
//          现 5(核心 4 + 扩展太史慈);技能 = 核心基数下限(主动 3+被动 4)
//          + 扩展技「义从」在列实证(扩展技入同池,现 9 行)。
//   锦囊 9 / 珍宝 6 / 机遇 30(好运 11+中性 8+霉运 11)= core 目录死数(spec 判据原数,
//   扩展契约只有 skills/heroes/effects,机遇/锦囊/珍宝无扩展通路)。
// 视口恒 844×390(移动横屏标准档);几何断言在入场动画/过渡在途时量盒有瞬移,
// 一律 toPass 重试到稳态(react-home-strip 同法)。
import { test, expect, type Page } from "./fixtures";
import { HOME_TID } from "../src/app/screens/home/testids";
import { MANUAL_TID } from "../src/app/screens/manual/testids";
import { TESTIDS } from "../src/app/screens/game/testids";

test.describe("玩法手册(844×390 横屏标准档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 开手册弹层(各用例独立起跑,零用例间依赖)。 */
  async function openManual(page: Page): Promise<void> {
    await page.goto("/");
    await page.getByTestId(HOME_TID.screen).waitFor();
    await page.getByTestId(HOME_TID.manual).click();
    await expect(page.getByTestId(MANUAL_TID.modal)).toBeVisible();
  }

  test("首页入口:开弹层、顶带让位 ≥44px(ADR-0049)、X 关回首页", async ({ page }) => {
    await openManual(page);
    // 顶带几何(ADR-0049 写死):弹层顶边恒让出 ≥44px 顶带(对局内回合胶囊让位区,
    // 首页虽无胶囊也照此几何);壳高钳 100dvh−64px,高顶满时顶边恰 44px。
    const modal = page.getByTestId(MANUAL_TID.modal);
    await expect(async () => {
      const box = (await modal.boundingBox())!;
      expect(box.y, "手册弹层顶边让出顶带").toBeGreaterThanOrEqual(44);
    }).toPass();
    // X 关闭:退场协议(210ms「播完再移除」)走完弹层卸载,人回首页
    await page.getByTestId(MANUAL_TID.close).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
  });

  test("五签切换:陈列数=目录实数(名将/技能运行时口径,机遇三组 11/8/11)", async ({ page }) => {
    await openManual(page);
    const cards = page.locator('[data-testid^="manual-card-"]');
    const scope = page.getByTestId(MANUAL_TID.screen);

    // 名将签(默认签):卡数与运行时目录对账(heroDefs;heroDefs 与卡墙同读
    // HEROES 单池,对账断的是「陈列数=目录数」本身),另实证扩展将太史慈在列
    const runtimeHeroes = await page.evaluate(() => (window as any).__dafung.heroDefs().length);
    expect(runtimeHeroes, "运行时名将目录含核心基数").toBeGreaterThanOrEqual(4);
    await expect(cards).toHaveCount(runtimeHeroes);
    await expect(page.getByTestId(MANUAL_TID.card("taishici"))).toBeVisible();

    // 技能签:行式直读无详情层。核心基数主动 3+被动 4(下限),扩展技「义从」
    // 与核心技同池同陈列;行数=类型章 chips 数(每行恰一枚,描述正文不产生精确同文 span)
    await page.getByTestId(MANUAL_TID.tabSkills).click();
    await expect(scope.getByText("义从", { exact: true })).toBeVisible();
    expect(await scope.locator('span:text-is("主动")').count()).toBeGreaterThanOrEqual(3);
    expect(await scope.locator('span:text-is("被动")').count()).toBeGreaterThanOrEqual(4);

    // 锦囊签:目录 9 种(牌库 18 张的种数)
    await page.getByTestId(MANUAL_TID.tabJinnang).click();
    await expect(cards).toHaveCount(9);

    // 珍宝签:目录 6 种
    await page.getByTestId(MANUAL_TID.tabTreasures).click();
    await expect(cards).toHaveCount(6);

    // 机遇签:按档三组陈列,组序=好运/中性/霉运,11/8/11(core 目录死数)
    await page.getByTestId(MANUAL_TID.tabEncounters).click();
    const sections = page.getByTestId(MANUAL_TID.body).locator("section");
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(0).locator('[data-testid^="manual-card-"]')).toHaveCount(11);
    await expect(sections.nth(1).locator('[data-testid^="manual-card-"]')).toHaveCount(8);
    await expect(sections.nth(2).locator('[data-testid^="manual-card-"]')).toHaveCount(11);
  });

  test("名将详情:点周瑜卡开技能全览只读弹层,可关回", async ({ page }) => {
    await openManual(page);
    await page.getByTestId(MANUAL_TID.card("zhouyu")).click();
    const glossary = page.getByTestId(TESTIDS.skillGlossary);
    await expect(glossary).toBeVisible();
    // 只读浏览语境:不传 onPick → 无「收为麾下」拍板钮(spec 决议⑤)
    await expect(page.getByTestId(TESTIDS.skillGlossaryPick)).toHaveCount(0);
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(glossary).toHaveCount(0);
  });

  test("锦囊详情:点卡开叠层(目录 id 参数化 detail),可关回", async ({ page }) => {
    await openManual(page);
    await page.getByTestId(MANUAL_TID.tabJinnang).click();
    // 点卡墙首卡,detail testid 由卡 testid 反推(MANUAL_TID.card/detail 同 id 工厂,
    // 不钉具体牌名——目录序重排不影响)
    const card = page.locator('[data-testid^="manual-card-"]').first();
    await card.click();
    const id = (await card.getAttribute("data-testid"))!.slice("manual-card-".length);
    const detail = page.getByTestId(MANUAL_TID.detail(id));
    await expect(detail).toBeVisible();
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(detail).toHaveCount(0);
  });

  test("机遇详情:霉运即时条注体力代价(粮道被劫),可关回", async ({ page }) => {
    await openManual(page);
    await page.getByTestId(MANUAL_TID.tabEncounters).click();
    // 粮道被劫 = 霉运即时条(无 choices):详情机读 effect.staminaDelta 注体力代价
    // (与 choices 注同形制,Q1 拍板;减号 U+2212,现值 −10)
    await page.getByTestId(MANUAL_TID.card("粮道被劫")).click();
    const detail = page.getByTestId(MANUAL_TID.detail("粮道被劫"));
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("体力 −");
    await page.getByTestId(TESTIDS.modalClose).click();
    await expect(detail).toHaveCount(0);
  });
});
