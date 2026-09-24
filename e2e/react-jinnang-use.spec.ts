// 锦囊使用回路(#122/T2;#237 牌面化交互迁移):点牌=选中(放大),「落印」=确认,
// 「今不用」竖笺钮直发,目标段=点座位(交互与 testid 原样)。断言覆盖拍板口径:
// 落印钮禁用/启用切换、再点同牌取消选中、数字快捷键(1=选中 / Enter=落印,G-19 新口径)、
// 灰置牌原因印条、多标签牌(缓兵之计)双章、令笺(主动技)牌面。
// seed 49=真人首动且起手免战金牌、seed 59=求贤令(真实引擎流程离线核算:含 doDraftRoll 骰流)。
// 不走 pickCapital 共享助手(其收尾会自动「今不用」),本 spec 自行点城+确认以保留卷轴。
// 灰置/令笺局面走 force 引擎直写(#237 无天然种子同时凑齐:同回合双标签占额+麾下带技)。
import { test, expect } from "./fixtures";
import { force, openSoloSetup, waitSettled, waitMyRollDone } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startWithScroll(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变候选城/发牌序列
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-sanguo").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
}

test.describe("锦囊使用回路(T2,牌面化交互)", () => {
  test("seed49 免战金牌:点选→落印→盾落账→收卷;落印禁用/启用与取消选中", async ({ page }) => {
    await startWithScroll(page, 49);
    const scroll = page.getByTestId("scroll-jinnang");
    await expect(scroll).toBeVisible();
    // 卷轴列出手牌(免战金牌,守标签)+ 今不用竖笺钮(可用)
    const opt = page.getByTestId("scroll-jinnang-option-免战金牌");
    const card = opt.locator(".jinnang-card");
    await expect(opt).toBeVisible();
    const pass = page.getByTestId("scroll-jinnang-pass");
    await expect(pass).toBeVisible();
    await expect(pass).toBeEnabled();
    // 落印钮:未选中=禁用
    const confirmBtn = page.getByTestId("scroll-jinnang-confirm");
    await expect(confirmBtn).toBeDisabled();
    // G-19 新口径:数字 1 = 选中第 1 个可用选项(只选中不发送)
    await page.keyboard.press("1");
    await expect(card).toHaveClass(/sel/);
    await expect(confirmBtn).toBeEnabled();
    // 再点同牌 = 取消选中(选中可逆),落印回禁用;重新点选后 Enter = 落印确认
    await opt.click();
    await expect(card).not.toHaveClass(/sel/);
    await expect(confirmBtn).toBeDisabled();
    await opt.click();
    await expect(card).toHaveClass(/sel/);
    await page.keyboard.press("Enter");
    await expect(scroll).toBeHidden();
    // 引擎缝:盾立、牌入弃牌堆、标签占名额。#188:用牌收卷后引擎自动起摇,phase==="Roll"
    // 只存在 ~1s 窗口(加速后 ~250ms)不可再断言,改以「已掷骰」作收卷后续行的证据。
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        shield: e.players[0].jinnangShield,
        hand: e.players[0].jinnangHand,
        used: e.jinnangUsedTags,
        discard: e.jinnangDiscard,
        rolled: (window as any).__dafung.snapshot().lastRoll != null,
      };
    });
    expect(probe).toMatchObject({ shield: true, hand: [], used: ["守"], rolled: true });
    expect(probe.discard).toContain("免战金牌");
    // 侧栏己方手牌区清空(牌已用出)
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toHaveCount(0);
  });

  test("seed49 今不用竖钮直发:手牌保留,自动行军照常起摇(#188)", async ({ page }) => {
    await startWithScroll(page, 49);
    await page.getByTestId("scroll-jinnang-pass").click();
    await expect(page.getByTestId("scroll-jinnang")).toBeHidden();
    // #188 行军自动化:「今不用」放行后引擎自动起摇,等这一手走完再验账
    await waitMyRollDone(page, 0);
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        hand: e.players[0].jinnangHand,
        used: e.jinnangUsedTags,
        rolled: (window as any).__dafung.snapshot().lastRoll != null,
      };
    });
    expect(probe.hand).toEqual(["免战金牌"]); // 今不用:牌还在手里
    expect(probe.used).toEqual([]);
    expect(probe.rolled).toBe(true); // 放行后自动起摇确实发生了(#188)
  });

  test("seed59 求贤令:点牌→落印→招贤/折现,事件公开入战报", async ({ page }) => {
    await startWithScroll(page, 59);
    const opt = page.getByTestId("scroll-jinnang-option-求贤令");
    await expect(opt).toBeVisible();
    await opt.click();
    const confirmBtn = page.getByTestId("scroll-jinnang-confirm");
    await expect(confirmBtn).toBeEnabled(); // 点牌只选中,落印点亮
    await confirmBtn.click();
    await expect(page.getByTestId("scroll-jinnang")).toBeHidden();
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      const p0 = e.players[0];
      return { heroes: p0.heroes.length, cash: p0.cash, log: JSON.stringify(e.log) };
    });
    expect(probe.heroes === 1 || probe.log.includes("转得 300 两")).toBe(true);
    expect(probe.log).toContain("求贤令"); // 用牌公开
  });

  test("seed49 军情密探:落印后进目标段,点座位出计(目标段交互与 testid 原样)", async ({ page }) => {
    await startWithScroll(page, 49);
    // 先停稳在开局军师幕再引擎直写:发牌在进 Playing 时落账,直写抢跑会被发牌覆盖
    await expect(page.getByTestId("scroll-jinnang")).toBeVisible();
    await force(page, `e.players[0].jinnangHand = ["军情密探"];`);
    const opt = page.getByTestId("scroll-jinnang-option-军情密探");
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId("scroll-jinnang-confirm").click();
    // 目标段:候选座位行钮 + 作罢(testid 族不变),点座即出计
    await expect(page.getByTestId("scroll-jinnang-option-t1")).toBeVisible();
    await page.getByTestId("scroll-jinnang-option-t1").click();
    // 出计后引擎收卷自动行军(#188),后续回合的军师幕会带新牌重开——「卷轴隐藏」不是
    // 稳定断言,改走引擎缝:用牌公开入战报(jinnangUse card=...)、入弃牌堆、载荷清空。
    await expect
      .poll(async () => page.evaluate(() => JSON.stringify((window as any).__dafung.getEngine().log)))
      .toContain("card=军情密探");
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return { pending: e.pendingJinnang, discard: e.jinnangDiscard, hand: e.players[0].jinnangHand };
    });
    expect(probe.pending).toBe(null);
    expect(probe.discard).toContain("军情密探");
    expect(probe.hand).not.toContain("军情密探");
  });

  test("灰置牌印条/多标签双章/令笺:双标签占额灰置、令笺选中→落印发技", async ({ page }) => {
    await startWithScroll(page, 49);
    // 先停稳再引擎直写(同上,防与发牌竞速):缓兵之计(谋+攻)双标签名额已被占 →
    // 灰置带原因印条;麾下给真实主动技(张星彩·擂鼓,target=none,无冷却)→ 令笺可用可发。
    await expect(page.getByTestId("scroll-jinnang")).toBeVisible();
    await force(page, `
      e.players[0].jinnangHand = ["缓兵之计", "免战金牌"];
      e.jinnangUsedTags = ["谋", "攻"];
      e.players[0].heroes = [{ id: "zhangxingcai", name: "张星彩", title: "", desc: "", image: "", skills: [],
        active: { id: "zhangxingcai-leigu", name: "擂鼓", cooldown: 4,
          desc: "擂鼓进军:本回合你的下一次掷骰步数 +2(签面不变)。",
          target: "none", kind: "warDrum", params: { bonus: 2 } } }];
    `);
    // 灰置牌:下沉置灰(.off)+ 双标签章竖排 + 原因印条文案可见;不可选中(浏览器禁用契约)
    const huan = page.getByTestId("scroll-jinnang-option-缓兵之计");
    await expect(huan).toBeVisible();
    await expect(huan).toBeDisabled();
    await expect(huan.locator(".jinnang-card")).toHaveClass(/off/);
    await expect(huan.locator(".seal")).toHaveCount(2); // 多标签:谋+攻 章竖排双挂
    await expect(huan.locator(".reason")).toHaveText("本回合已用过〔谋〕〔攻〕");
    // 可用牌照常
    await expect(page.getByTestId("scroll-jinnang-option-免战金牌")).toBeEnabled();
    // 令笺:技名/属主上牌面;点选=选中(.sel 挂牌面根),落印点亮→发技(useHeroSkill)
    const ji = page.getByTestId("scroll-jinnang-option-skill:zhangxingcai-leigu");
    await expect(ji).toBeVisible();
    await expect(ji.locator(".jn-lingjian")).toContainText("擂鼓");
    await expect(ji.locator(".jn-lingjian")).toContainText("张星彩");
    await ji.click();
    await expect(ji.locator(".jn-lingjian")).toHaveClass(/sel/);
    await page.getByTestId("scroll-jinnang-confirm").click();
    // 发技后走引擎缝断言:冷却记账落、手牌不动(技不是牌);免战金牌仍可用 → 相位留在
    // 军师幕(settleJinnangExit 口径),令笺转灰置并亮引擎原因——冷却展示只读 choices。
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__dafung.getEngine().players[0].heroLastFired["zhangxingcai-leigu"] ?? null),
      )
      .not.toBe(null);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return { hand: e.players[0].jinnangHand, phase: e.turnPhase };
    });
    expect(probe.hand).toEqual(["缓兵之计", "免战金牌"]);
    expect(probe.phase).toBe("AwaitingJinnang");
    await expect(ji.locator(".jn-lingjian")).toHaveClass(/off/);
    await expect(ji.locator(".reason")).toHaveText("冷却中(还差 4 轮)");
  });
});
