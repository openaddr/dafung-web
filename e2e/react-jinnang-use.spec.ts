// 锦囊使用回路(#122/T2;#256 军师窗态迁移):军师幕弹窗退役,出牌面上架手牌架——
// 点牌=选中放大(放大态即详情态),动作条「出牌」=确认、「不出」=今不用,目标段=
// 席位即靶(金圈呼吸+棋盘 token 呼吸,点席位即出免二次确认)。断言覆盖拍板口径:
// 出牌钮禁用/启用切换、再点同牌取消选中、数字快捷键(1=选中 / Enter=出牌,G-19 口径)、
// 灰置牌原因印条、多标签牌(缓兵之计)双章、令笺(主动技)牌面、作罢路径牌不消耗。
// seed 49=真人首动且起手免战金牌、seed 59=求贤令(真实引擎流程离线核算:含 doDraftRoll 骰流)。
// 不走 pickCapital 共享助手(其收尾会自动「不出」),本 spec 自行点城+确认以保留窗态。
// 灰置/令笺局面走 force 引擎直写(#237 无天然种子同时凑齐:同回合双标签占额+麾下带技)。
import { test, expect } from "./fixtures";
import { force, openSoloSetup, waitSettled, waitMyRollDone } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startJunshi(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变候选城/发牌序列
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-sanguo").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
  // 军师窗态:动作条(卡牌段)就位 = 停稳在开局窗态
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

test.describe("锦囊使用回路(T2,军师窗态)", () => {
  test("seed49 免战金牌:点选→出牌→盾落账→收窗;出牌钮禁用/启用与取消选中", async ({ page }) => {
    await startJunshi(page, 49);
    // 架中列出可用手牌(免战金牌,守标签);动作条两钮就位,未选中=出牌禁用
    const opt = page.getByTestId(TESTIDS.jinnangCard("免战金牌"));
    const card = opt.locator(".jinnang-card");
    await expect(opt).toBeVisible();
    await expect(card).not.toHaveClass(/off/);
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    const pass = page.getByTestId(TESTIDS.actionbarPass);
    await expect(play).toBeDisabled();
    await expect(pass).toBeEnabled();
    // G-19 口径:数字 1 = 选中第 1 个可用选项(只选中不发送)
    await page.keyboard.press("1");
    await expect(card).toHaveClass(/sel/);
    await expect(play).toBeEnabled();
    // 再点同牌 = 取消选中(选中可逆),出牌回禁用;重新点选后 Enter = 出牌确认
    await opt.click();
    await expect(card).not.toHaveClass(/sel/);
    await expect(play).toBeDisabled();
    await opt.click();
    await page.keyboard.press("Enter");
    // 引擎缝:盾立、牌入弃牌堆、标签占名额。#188:用牌收窗后引擎自动起摇,phase==="Roll"
    // 只存在 ~1s 窗口(加速后 ~250ms)不可再断言,改以「已掷骰」作收窗后续行的证据。
    // 先轮询等起摇落账再等稳定:waitSettled 的 300ms 静止窗会整个落进「起摇酝酿拍」
    // (rollAtMs 250ms + 起签 200ms),两次读数都停在掷前、假稳定返回(实测翻车)。
    await expect
      .poll(async () => page.evaluate(() => (window as any).__dafung.snapshot().lastRoll != null), { timeout: 15_000 })
      .toBe(true);
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
    // 架中手牌行清空(牌已用出;testid 契约 jinnang-hand 原值)
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toHaveCount(0);
  });

  test("seed49 不出直发:手牌保留,自动行军照常起摇(#188)", async ({ page }) => {
    await startJunshi(page, 49);
    await page.getByTestId(TESTIDS.actionbarPass).click();
    // #188 行军自动化:「不出」放行后引擎自动起摇,等这一手走完再验账
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
    expect(probe.hand).toEqual(["免战金牌"]); // 不出:牌还在手里
    expect(probe.used).toEqual([]);
    expect(probe.rolled).toBe(true); // 放行后自动起摇确实发生了(#188)
  });

  test("seed59 求贤令:点牌→出牌→招贤/折现,事件公开入战报", async ({ page }) => {
    await startJunshi(page, 59);
    const opt = page.getByTestId(TESTIDS.jinnangCard("求贤令"));
    await expect(opt).toBeVisible();
    await opt.click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeEnabled(); // 点牌只选中,出牌点亮
    await play.click();
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      const p0 = e.players[0];
      return { heroes: p0.heroes.length, cash: p0.cash, log: JSON.stringify(e.log) };
    });
    expect(probe.heroes === 1 || probe.log.includes("转得 300 两")).toBe(true);
    expect(probe.log).toContain("求贤令"); // 用牌公开
  });

  test("seed49 军情密探:出牌进目标段,候选席位金圈呼吸,点席位即出(免二次确认)", async ({ page }) => {
    await startJunshi(page, 49);
    // 先停稳在开局军师窗态再引擎直写:发牌在进 Playing 时落账,直写抢跑会被发牌覆盖
    await force(page, `e.players[0].jinnangHand = ["军情密探"];`);
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段:动作条切「选择目标/作罢」;候选席位卡金圈呼吸 + 棋盘 token 呼吸挂点
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    await expect(page.getByTestId("seat-1")).toHaveClass(/candidate/);
    await expect(page.locator(".bv-token-target-ring")).not.toHaveCount(0);
    // 点席位即出(免二次确认);出计后引擎收窗自动行军(#188)——用牌公开入战报
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
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

  test("seed49 军情密探作罢:收回此计牌——不消耗、不记冷却、回卡牌段", async ({ page }) => {
    await startJunshi(page, 49);
    await force(page, `e.players[0].jinnangHand = ["军情密探"];`);
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeVisible();
    // 作罢:目标段收回,回到卡牌段窗态
    await page.getByTestId(TESTIDS.actionbarCancel).click();
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await expect(play).toBeVisible();
    await expect(play).toBeDisabled(); // 选中已清空(进/出目标段即清空重选)
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        pending: e.pendingJinnang,
        hand: e.players[0].jinnangHand,
        discard: e.jinnangDiscard,
        used: e.jinnangUsedTags,
      };
    });
    expect(probe.pending).toBe(null);
    expect(probe.hand).toEqual(["军情密探"]); // 牌没消耗
    expect(probe.discard).not.toContain("军情密探");
    expect(probe.used).toEqual([]);
  });

  test("灰置牌印条/多标签双章/令笺:双标签占额灰置、令笺选中→出牌发技", async ({ page }) => {
    await startJunshi(page, 49);
    // 引擎直写(停稳已由 startJunshi 保证):缓兵之计(谋+攻)双标签名额已被占 →
    // 灰置带原因印条;麾下给真实主动技(张星彩·擂鼓,target=none,无冷却)→ 令笺可用可发。
    await force(page, `
      e.players[0].jinnangHand = ["缓兵之计", "免战金牌"];
      e.jinnangUsedTags = ["谋", "攻"];
      e.players[0].heroes = [{ id: "zhangxingcai", name: "张星彩", title: "", desc: "", image: "", skills: [],
        active: { id: "zhangxingcai-leigu", name: "擂鼓", cooldown: 4,
          desc: "擂鼓进军:本回合你的下一次掷骰步数 +2(签面不变)。",
          target: "none", kind: "warDrum", params: { bonus: 2 } } }];
    `);
    // 灰置牌:下沉置灰(.off)+ 双标签章竖排 + 原因印条文案可见;不可选中(浏览器禁用契约)
    const huan = page.getByTestId(TESTIDS.jinnangCard("缓兵之计"));
    await expect(huan).toBeVisible();
    await expect(huan).toBeDisabled();
    await expect(huan.locator(".jinnang-card")).toHaveClass(/off/);
    await expect(huan.locator(".seal")).toHaveCount(2); // 多标签:谋+攻 章竖排双挂
    await expect(huan.locator(".reason")).toHaveText("本回合已用过〔谋〕〔攻〕");
    // 可用牌照常
    await expect(page.getByTestId(TESTIDS.jinnangCard("免战金牌"))).toBeEnabled();
    // 令笺:技名/属主上牌面;点选=选中(.sel 挂牌面根),出牌点亮→发技(useHeroSkill)
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:zhangxingcai-leigu"));
    await expect(ji).toBeVisible();
    await expect(ji.locator(".jn-lingjian")).toContainText("擂鼓");
    await expect(ji.locator(".jn-lingjian")).toContainText("张星彩");
    await ji.click();
    await expect(ji.locator(".jn-lingjian")).toHaveClass(/sel/);
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 发技后走引擎缝断言:冷却记账落、手牌不动(技不是牌);免战金牌仍可用 → 相位留在
    // 军师窗态(settleJinnangExit 口径),令笺转灰置并亮引擎原因——冷却展示只读 choices。
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
