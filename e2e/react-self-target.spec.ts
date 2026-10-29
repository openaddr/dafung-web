// 目标段选自己(自选目标拷问拍板):any 域主动技(华佗·赈济)的候选含自己——#700
// 起自选目标回归席位格单点(旧仪表条「你」印候选钮随仪表条退役):自机格的点击层
// 即候选钮(GameScreen 从快照 choices 派生,与对手席同口径;候选金圈呼吸挂格、
// 选中实金停持挂按钮,testid 复用 seatTarget(seat) 族)。引擎侧 any 域放行自己已由
// test/hero-skill.test.ts 锁定;本 spec 只验交互接线,断言全走可见 UI 态(#305 口径,
// 含自疗落账=自机格体力色条/现金裸数);结算细则归 test/hero-skill.test.ts。
// 种局同 react-jinnang-use.spec.ts 口径:seed 63 × 环游图,开局出牌阶段态=稳定停靠点,
// 技/牌走 force 引擎直写;两例均在出牌阶段内收束,不推进回合、不赌自然骰。
import { test, expect } from "./fixtures";
import { force, openSoloSetup, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

async function startJunshi(page: Page, seed: number): Promise<void> {
  await useHalfScale(page);
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变发牌序列
  await page.getByTestId(HOME_TID.selectMap).click();
  await page.getByTestId(SETUP_TID.mapItem("huanyou")).click();
  await page.getByTestId(SETUP_TID.mapConfirm).click();
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.startGame).click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  // 出牌阶段态:动作条(卡牌段)就位 = 停稳在开局窗态(seed 63 起手横征暴敛恒可用)
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

// 华佗直写(def 形状随 core/heroes.ts 华佗条目;image 空串即可,紧凑档卡面不消费图):
// 体力 50(满体力自疗无可见落账)、现金 2000(≥cost,排除整技可用性疑虑)。
const HUATUO = `
  e.players[0].heroes = [{ id: "huatuo", name: "华佗", title: "神医", image: "",
    skillPool: ["qingnang", "zhenji"] }]; // 池声明(ADR-0036);技定义查技表
  e.players[0].cash = 2000;
  e.players[0].stamina = 50;
`;

test.describe("目标段选自己(自机格点击层,#700)", () => {
  test("赈济(any 域):你印=候选金圈呼吸→点选实金停持→「出」打出自疗", async ({ page }) => {
    await startJunshi(page, 63);
    await force(page, HUATUO);
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:zhenji"));
    await expect(ji).toBeVisible();
    await ji.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 打出前基准:自机格体力条宽 50%(种局直写值;#700 仪表条退役,格上体力=色条)
    const staminaFill = page.getByTestId(TESTIDS.seatStamina(0)).locator(".strack i");
    await expect(staminaFill).toHaveAttribute("style", /width:\s*50%/);
    // 目标段:自机格点击层就位(候选金圈呼吸挂格,#700 席位格形态),未选中时
    // 「选择目标」引导态禁用
    const selfBtn = page.getByTestId(TESTIDS.seatTarget(0));
    await expect(selfBtn).toBeVisible();
    await expect(selfBtn).toBeEnabled();
    await expect(page.getByTestId(TESTIDS.seatSelf)).toHaveClass(/candidate/);
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
    // 打出:目标段收、技卡转灰置(冷却);自疗落账走可见 UI——自机格体力条 50%→80%、
    // 现金裸数 2000→1900(格上无千分位省「两」;结算细则归 test/hero-skill.test.ts)
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();
    await expect(ji.locator(".hface")).toHaveClass(/off/);
    await expect(staminaFill).toHaveAttribute("style", /width:\s*80%/);
    await expect(page.getByTestId(TESTIDS.seatCash(0))).toHaveText("1900");
  });

  test("军情密探(one 域):你印恒在但不可选,点按轻晃+弹层 reason 印条「不能指定自己」", async ({
    page,
  }) => {
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
    // 恒在口径(拍板 Q3):非 any 域自己不消失,而是不可选——#751 C 批起禁用原因
    // 上屏(§4.6 文字例外):点按不再被 disabled 吞掉(触屏无 hover 的死区),
    // 改 aria-disabled 挂点,点按=格身轻晃(.shake)+单人格弹层放行,reason 印条
    // 上屏;「不能指定自己」即规则教学
    const selfBtn = page.getByTestId(TESTIDS.seatTarget(0));
    await expect(selfBtn).toBeVisible();
    // aria-disabled 计入 Playwright 禁用判定(toBeDisabled 同判),挂点直查属性
    await expect(selfBtn).toHaveAttribute("aria-disabled", "true");
    await expect(selfBtn).toHaveAttribute("aria-label", "不可指定:不能指定自己");
    await expect(page.getByTestId(TESTIDS.seatSelf)).not.toHaveClass(/candidate/);
    // 死区点按:弹层放行 + reason 印条上屏 + 格身轻晃类挂点(动画 ~240ms 内可见)
    // (aria-disabled 计入 Playwright 可点性判定,真触屏无此闸——force 直点即用户点按)
    await selfBtn.click({ force: true });
    await expect(page.getByTestId(TESTIDS.seatPop(0))).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatPopNotice(0))).toHaveText("不能指定自己");
    await expect(page.getByTestId(TESTIDS.seatSelf)).toHaveClass(/shake/);
    // 未选中(不可选席不吃 .picked,「出」确认钮保持禁用)
    await expect(selfBtn).not.toHaveClass(/picked/);
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeDisabled();
  });
});
