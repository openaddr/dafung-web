// 目标段选自己(自选目标拷问拍板):any 域主动技(华佗·赈济)的候选含自己——#700
// 起自选目标回归席位格单点(旧仪表条「你」印候选钮随仪表条退役):自机格的点击层
// 即候选钮(GameScreen 从快照 choices 派生,与对手席同口径;候选金圈呼吸挂格、
// 选中实金停持挂按钮,testid 复用 seatTarget(seat) 族)。引擎侧 any 域放行自己已由
// test/hero-skill.test.ts 锁定;本 spec 只验交互接线,断言全走可见 UI 态(#305 口径,
// 含自疗落账=自机格体力色条/现金裸数);结算细则归 test/hero-skill.test.ts。
// 种局同 react-jinnang-use.spec.ts 口径:seed 67 × 关中图,开局出牌阶段态=稳定停靠点,
// 技/牌走 force 引擎直写;两例均在出牌阶段内收束,不推进回合、不赌自然骰。
// #1217 波4 直通形制(ADR-0058):两例真实段=目标段选自己交互链全真(候选金圈/实金
// 停持/不可选轻晃/自疗落账);前置链种局化——旅程开局(选图→起兵→选都)换 seedSolo
// 种局 stopAtOpeningHand 直达开局出牌阶段态(同 seed 同局口径,#1211 选都序对齐)。
import { test, expect } from "./fixtures";
import { force, quickStart, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startJunshi(page: Page, seed: number): Promise<void> {
  await useHalfScale(page);
  // 显式钉图(mapId 直传 seedSolo,#147 后地图是骰流变量);stopAtOpeningHand 停在
  // 开局出牌阶段态等输入(不代放行;67 在开局即停谱内,探针实测)
  await quickStart(page, seed, { mapId: "guanzhong", stopAtOpeningHand: true });
  // 出牌阶段态:动作条(卡牌段)就位 = 停稳在开局窗态(seed 67 起手求贤令恒可用)
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

// 华佗直写(槽位行 #785:skillIds=全池原序随 core/heroes.ts 华佗条目;技定义查技表):
// 体力 50(满体力自疗无可见落账)、现金 2000(≥cost,排除整技可用性疑虑)。
// force 判词(#1217 波4 审计):麾下无授将公共命令(招贤候选由落招贤城触发,
// resolveHeroPick 仅候选语境可达);体力/现金无玩家公共命令——断言面需「半体力
// 华佗+足现金」形态(满体力自疗无可见落账),直写。
const HUATUO = `
  e.players[0].heroes = [{ heroId: "huatuo", skillIds: ["qingnang", "zhenji"], lastFired: {} }];
  e.players[0].cash = 2000;
  e.players[0].stamina = 50;
`;

test.describe("目标段选自己(自机格点击层,#700)", () => {
  // 真实段(波4 #1217):点技能卡 → 「出」→ 自机格候选金圈呼吸 → 点选实金停持 →
  // (取消回禁用/三点重选)→ 确认打出的目标段完整交互链与自疗落账(体力条 50%→80%、
  // 现金裸数 2000→1900)全真。
  test("赈济(any 域):你印=候选金圈呼吸→点选实金停持→「出」打出自疗", async ({ page }) => {
    await startJunshi(page, 67);
    await force(page, HUATUO);
    // testid=选项 id 实例形状 skill:<heroId>:<skillId>(#817;布场属主华佗)
    const ji = page.getByTestId(TESTIDS.jinnangCard("skill:huatuo:zhenji"));
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
    // 打出:目标段收、技能卡转灰置(冷却);自疗落账走可见 UI——自机格体力条 50%→80%、
    // 现金裸数 2000→1900(格上无千分位省「两」;结算细则归 test/hero-skill.test.ts)
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeHidden();
    await expect(ji.locator(".hface")).toHaveClass(/off/);
    await expect(staminaFill).toHaveAttribute("style", /width:\s*80%/);
    await expect(page.getByTestId(TESTIDS.seatCash(0))).toHaveText("1900");
  });

  // 真实段(波4 #1217):one 域自机格不可选呈现(aria-disabled+reason 印条)与死区
  // 点按轻晃反馈(§4.6 位移即状态)全真——「恒在但不可选」的交互语义即被测环。
  test("军情密探(one 域):你印恒在但不可选,点按轻晃(reason 读 aria-label)", async ({ page }) => {
    await startJunshi(page, 67);
    // force 判词:手牌无「发指定牌」公共命令(发牌只发生在开局/摸牌时机);对方
    // 持宝无授宝命令——断言面需 one 域牌形+「对方有宝」目标门槛,直写。
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[0].jinnangHand = ["军情密探"];
    `,
    );
    await page.getByTestId(TESTIDS.jinnangCard("军情密探")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 恒在口径(拍板 Q3):非 any 域自己不消失,而是不可选——#751 C 批起点按不再
    // 被 disabled 吞掉(触屏无 hover 的死区),改 aria-disabled 挂点;#1097 起原
    // 「弹层放行+reason 印条」随单人格弹层退役(#1096 决议1),禁用原因读 aria-label,
    // 点按反馈=格身轻晃(§4.6 位移即状态)
    const selfBtn = page.getByTestId(TESTIDS.seatTarget(0));
    await expect(selfBtn).toBeVisible();
    // aria-disabled 计入 Playwright 禁用判定(toBeDisabled 同判),挂点直查属性
    await expect(selfBtn).toHaveAttribute("aria-disabled", "true");
    await expect(selfBtn).toHaveAttribute("aria-label", "不可指定:不能指定自己");
    await expect(page.getByTestId(TESTIDS.seatSelf)).not.toHaveClass(/candidate/);
    // 死区点按:格身轻晃类挂点(动画 ~240ms 内可见)+ 单人格弹层零残留(已退役)
    // (aria-disabled 计入 Playwright 可点性判定,真触屏无此闸——force 直点即用户点按)
    await selfBtn.click({ force: true });
    await expect(page.getByTestId(TESTIDS.seatSelf)).toHaveClass(/shake/);
    await expect(page.getByTestId("seat-pop-0")).toHaveCount(0); // testids:allow 退役 testid 零残留断言——常量已随 #1097 核销删除,无单源可引
    // 未选中(不可选席不吃 .picked,「出」确认钮保持禁用)
    await expect(selfBtn).not.toHaveClass(/picked/);
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeDisabled();
  });
});
