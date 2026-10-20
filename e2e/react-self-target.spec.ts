// 目标段选自己(自选目标拷问拍板):any 域主动技(华佗·赈济)的候选含自己,但席位栏
// 结构性不出自己卡(#253「观战与自身不出卡」)——自己的候选面=仪表条身份区「你」印
// 变身候选钮(GameScreen 从快照 choices 派生,与席位卡点击层同口径:金圈呼吸/实金停持/
// 灰置印原因,testid 复用 seatTarget(seat) 族)。引擎侧 any 域放行自己已由
// test/hero-skill.test.ts 锁定;本 spec 只验交互接线,断言全走可见 UI 态(#305 口径,
// 含自疗落账=仪表条体力刻度/现金大数);结算细则归 test/hero-skill.test.ts。
// 种局同 react-jinnang-use.spec.ts 口径:seed 63 × 环游图,开局出牌阶段态=稳定停靠点,
// 技/牌走 force 引擎直写;两例均在出牌阶段内收束,不推进回合、不赌自然骰。
import { test, expect } from "./fixtures";
import { force, openSoloSetup, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startJunshi(page: Page, seed: number): Promise<void> {
  await useHalfScale(page);
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变发牌序列
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-huanyou").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
  // 出牌阶段态:动作条(卡牌段)就位 = 停稳在开局窗态(seed 63 起手横征暴敛恒可用)
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

// 华佗直写(def 形状随 core/heroes.ts 华佗条目;image 空串即可,紧凑档卡面不消费图):
// 体力 50(满体力自疗无可见落账)、现金 2000(≥cost,排除整技可用性疑虑)。
const HUATUO = `
  e.players[0].heroes = [{ id: "huatuo", name: "华佗", title: "神医", image: "", skills: [],
    active: { id: "huatuo-zhenji", name: "赈济", cooldown: 3,
      desc: "开仓赈济:付 100 两,为任一诸侯(含自己)恢复 30 体力。",
      target: "any", kind: "relief", params: { cost: 100, stamina: 30 } } }];
  e.players[0].cash = 2000;
  e.players[0].stamina = 50;
`;

test.describe("目标段选自己(仪表条身份区候选钮)", () => {
  test("赈济(any 域):你印=候选金圈呼吸→点选实金停持→「出」打出自疗", async ({ page }) => {
    await startJunshi(page, 63);
    await force(page, HUATUO);
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:huatuo-zhenji"));
    await expect(ji).toBeVisible();
    await ji.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 打出前基准:仪表条体力刻度 50(种局直写值)
    const stamina = page.getByTestId(TESTIDS.dashStamina).locator(".hpbar em");
    await expect(stamina).toHaveText("50");
    // 目标段:自己候选钮就位(候选金圈呼吸),未选中时「选择目标」引导态禁用
    const selfBtn = page.getByTestId(TESTIDS.seatTarget(0));
    await expect(selfBtn).toBeVisible();
    await expect(selfBtn).toBeEnabled();
    await expect(selfBtn).toHaveClass(/candidate/);
    const confirm = page.getByTestId(TESTIDS.actionbarTarget);
    await expect(confirm).toBeDisabled();
    // 点自己=选中(.picked 实金停持)→「出」点亮;再点=取消→回禁用;三点重选→打出
    await selfBtn.click();
    await expect(selfBtn).toHaveClass(/picked/);
    await expect(confirm).toBeEnabled();
    await selfBtn.click();
    await expect(selfBtn).not.toHaveClass(/picked/);
    await expect(confirm).toBeDisabled();
    await selfBtn.click();
    await confirm.click();
    // 打出:目标段收、技卡转灰置(冷却);自疗落账走可见 UI——仪表条体力 50→80、
    // 现金大数 2,000→1,900(结算细则归 test/hero-skill.test.ts)
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();
    await expect(ji.locator(".hface")).toHaveClass(/off/);
    await expect(stamina).toHaveText("80");
    await expect(page.getByTestId(TESTIDS.dashCash)).toContainText("1,900");
  });

  test("军情密探(one 域):你印恒在但禁用,原因「不能指定自己」", async ({ page }) => {
    await startJunshi(page, 63);
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[0].jinnangHand = ["军情密探"];
    `,
    );
    await page.getByTestId(TESTIDS.jinnangCard("军情密探")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 恒在口径(拍板 Q3):非 any 域自己不消失,而是禁用+原因浮签——与对手席位卡
    // 灰置印原因同口径,「不能指定自己」即规则教学
    const selfBtn = page.getByTestId(TESTIDS.seatTarget(0));
    await expect(selfBtn).toBeVisible();
    await expect(selfBtn).toBeDisabled();
    await expect(selfBtn).toHaveAttribute("title", "不能指定自己");
    await expect(selfBtn).toHaveAttribute("aria-label", "不可指定:不能指定自己");
    await expect(selfBtn).not.toHaveClass(/candidate/);
  });
});
