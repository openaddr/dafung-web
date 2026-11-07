// 手册 e2e(#1073,spec #1069 T4):首页「手册」入口 → 五签陈列 → 详情开合。
// 全静态 UI(读 core 目录表直渲,零引擎零机遇随机),无 clock 冻结、无种植。
// 陈列数口径(spec #1069 收口期事实修正):名将/技能 = **运行时实数**——扩展包
// (extensions/hero-taishici)经 main.tsx 顶层 await 注册进 SKILLS/HEROES 单池后,
// 手册各签直读同一注册面,故卡数随目录数据走、不落死数:
//   名将 = 与 window.__dafung.heroDefs() 对账(heroDefs 单源 react-extensions 同款),
//          现 6(核心 5 含卧龙 #1142 + 扩展太史慈);技能 = 核心基数下限(主动 3+被动 4)
//          + 扩展技「义从」在列实证(扩展技入同池,现 9 行)。
//   锦囊 9 / 珍宝 6 / 机遇 60(好运 21+中性 16+霉运 23)= core 目录死数(#1154 扩容后,
//   扩展契约只有 skills/heroes/effects,机遇/锦囊/珍宝无扩展通路)。
// 视口恒 844×390(移动横屏标准档);几何断言在入场动画/过渡在途时量盒有瞬移,
// 一律 toPass 重试到稳态(react-home-strip 同法)。
import { test, expect, type Page } from "./fixtures";
import { HOME_TID } from "../src/app/screens/home/testids";
import { MANUAL_TID } from "../src/app/screens/manual/testids";
import { TESTIDS } from "../src/app/screens/game/testids";

test.describe("手册(844×390 横屏标准档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 开手册弹层(各用例独立起跑,零用例间依赖)。 */
  async function openManual(page: Page): Promise<void> {
    await page.goto("/");
    await page.getByTestId(HOME_TID.screen).waitFor();
    await page.getByTestId(HOME_TID.manual).click();
    await expect(page.getByTestId(MANUAL_TID.modal)).toBeVisible();
  }

  // 真实段(ADR-0058):首页「手册」入口真实点击开弹层,顶带让位/桌面视口切换/X 关
  // 回首页的真实交互链即被测环——全静态 UI(直渲 core 目录,零引擎零机遇随机),
  // 零种植零冻结。
  test("首页入口:开弹层、顶带让位 ≥44px(ADR-0049)、X 关回首页", async ({ page }) => {
    await openManual(page);
    // 顶带几何(ADR-0049 写死):弹层顶边恒让出 ≥44px 顶带(对局内回合胶囊让位区,
    // 首页虽无胶囊也照此几何);壳高钳 100dvh−64px,高顶满时顶边恰 44px;
    // 整壳收在视口内(内滚不溢出不裁切 AC 的壳侧)
    const modal = page.getByTestId(MANUAL_TID.modal);
    await expect(async () => {
      const box = (await modal.boundingBox())!;
      expect(box.y, "手册弹层顶边让出顶带").toBeGreaterThanOrEqual(44);
      expect(box.y + box.height, "弹层底边不出视口").toBeLessThanOrEqual(390);
    }).toPass();
    // 桌面档可用(DESIGN §4.7 桌面档零重排预算):同壳换桌面视口仍整壳在场不裁切
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(async () => {
      const box = (await modal.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }).toPass();
    // X 关闭:退场协议(210ms「播完再移除」)走完弹层卸载,人回首页
    await page.getByTestId(MANUAL_TID.close).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
  });

  // 真实段(ADR-0058):五签切换真实点击,陈列数=目录实数对账(名将/技能吃运行时
  // 注册面,锦囊/珍宝/机遇 core 目录死数)+最深档内滚不溢出即被测环——零种植
  // 零冻结。
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

    // 珍宝签:目录 16 种(#1100 存量 6 + 起手扩容 10)
    await page.getByTestId(MANUAL_TID.tabTreasures).click();
    await expect(cards).toHaveCount(16);

    // 机遇签:按档三组陈列,组序=好运/中性/霉运,21/16/23(core 目录死数,#1154 扩容后)
    await page.getByTestId(MANUAL_TID.tabEncounters).click();
    const sections = page.getByTestId(MANUAL_TID.body).locator("section");
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(0).locator('[data-testid^="manual-card-"]')).toHaveCount(21);
    await expect(sections.nth(1).locator('[data-testid^="manual-card-"]')).toHaveCount(16);
    await expect(sections.nth(2).locator('[data-testid^="manual-card-"]')).toHaveCount(23);

    // 内滚不溢出(AC):最深内容档下溢出收进 body 内滚(壳头/签行钉住),壳不撑破视口
    const modal = page.getByTestId(MANUAL_TID.modal);
    const body = page.getByTestId(MANUAL_TID.body);
    await expect(async () => {
      const metrics = await body.evaluate((el) => {
        const vp = el.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? el;
        return { scroll: vp.scrollHeight, client: vp.clientHeight };
      });
      expect(metrics.scroll, "机遇签内容超壳高,溢出收进内滚").toBeGreaterThan(metrics.client);
      const box = (await modal.boundingBox())!;
      expect(box.y + box.height, "壳底边不出视口").toBeLessThanOrEqual(390);
    }).toPass();
  });

  // 真实段(ADR-0058):点周瑜卡开技能全览只读弹层+关闭的真实交互链即被测环
  // (无「收为麾下」拍板钮=只读语境契约)——零种植零冻结。
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

  // 真实段(ADR-0058):锦囊卡点开叠层(目录 id 参数化 detail)+关闭的真实交互链
  // 即被测环——零种植零冻结。
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

  // 真实段(ADR-0058):霉运卡点开详情,体力代价注记(effect.staminaDelta 与
  // choices 同形制)真实渲染+关闭即被测环——零种植零冻结。
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

  // 真实段(ADR-0058):详情开着点壳 X,叠层先卸/壳随收/零孤儿弹层的退场协议真实
  // 走查即被测环——零种植零冻结。
  test("收口净空:详情开着点壳 X,叠层随壳同卸不留孤儿(真机裸弹层复)", async ({ page }) => {
    await openManual(page);
    await page.getByTestId(MANUAL_TID.tabEncounters).click();
    await page.getByTestId(MANUAL_TID.card("义士来投")).click();
    const detail = page.getByTestId(MANUAL_TID.detail("义士来投"));
    await expect(detail).toBeVisible();
    // 壳的题名行+X 露在叠层上方,真机可点(裸弹层复的触发钮):点壳 X 而非叠层 X
    await page.getByTestId(MANUAL_TID.close).click();
    // 净空语义:叠层先于壳退场消失(closing 起手即卸载,壳 210ms 协议随后收场)
    await expect(detail).toHaveCount(0);
    await expect(page.getByTestId(MANUAL_TID.modal)).toHaveCount(0);
    // 不留孤儿:body 上无任何活弹层,人回首页
    expect(await page.locator('[data-slot="dialog-content"]').count()).toBe(0);
    await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
  });

  // 真实段(ADR-0058):关后再开真实往返点击,壳体实可见(opacity 计算样式防
  // opacity-0 残留假绿)+遮罩不挂退场类+点壳外真位置关闭的真实通路即被测环
  // ——零种植零冻结。
  test("重开手册:关后再开壳体必须实可见(#1182,真机「点手册没作用」复防)", async ({ page }) => {
    const manual = page.getByTestId(HOME_TID.manual);
    const modal = page.getByTestId(MANUAL_TID.modal);
    await openManual(page);
    await page.getByTestId(MANUAL_TID.close).click();
    await expect(modal).toHaveCount(0);
    // 同页不刷新再开:壳体不得残留收起态。收起态泄漏时壳在 DOM 里但 opacity-0
    // (且隐形壳挡住首页中部按钮)——Playwright toBeVisible 对 opacity:0 判真,
    // 必须量计算样式;入场无 opacity 过渡(首帧即终态),toPass 只兜动画余量。
    await manual.click();
    await expect(modal).toBeVisible();
    await expect(async () => {
      const opacity = await modal.evaluate((el) => getComputedStyle(el).opacity);
      expect(opacity, "重开壳体 opacity 应为 1(收起态残留=隐形弹层)").toBe("1");
    }).toPass();
    // 重开壳可正常关闭,首页按钮回归可点(泄漏态下隐形壳拦截中部点击)
    await page.getByTestId(MANUAL_TID.close).click();
    await expect(modal).toHaveCount(0);
    await manual.click();
    await expect(modal).toBeVisible();
    // 遮罩可交互直断(#1188 S3):泄漏态下重开遮罩挂 dialog-overlay-out
    // (pointer-events:none,「点外关闭」失灵)——重开遮罩不得挂退场类,且点壳外
    // 真位置(视口左下角;壳体 x≥25.5/y≤370)点外关闭通路必须可达
    const overlay = page.locator('[data-slot="dialog-overlay"]');
    await expect(overlay).not.toHaveClass(/dialog-overlay-out/);
    await page.mouse.click(6, 384);
    await expect(modal).toHaveCount(0);
  });
});
