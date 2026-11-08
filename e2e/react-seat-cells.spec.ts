// 席位格列(#698 席位条重形:96×38 双行八项格,仪表徽章行随席位卡退役)——
// ① 满编 8 席与 4 席局:行1 现金主数(无千分位裸数)+ 行2 六图标计数与投影逐席一致;
// ② 五状态挂点:活跃金圈呼吸(.active)/目标段候选呼吸(.candidate)与选中停持
//    (.picked)/濒耗竭色条朱砂(.low)/破产降透明印灰(.bankrupt)+ 自机金样式挂点
//    (seat-self .self,无「你」字);③ 托管常驻微标(#770):开=国号印右齿轮挂点、
//    关=撤,bot 席恒无。断言走 testid 单源 + 调试钩子直写(react-layout/
//    react-jinnang-use 同款通路),几何断言收进单次 evaluate。
// 旧席位卡形态退役核销例已删(2026-11-07 菜单A,原 ③):#698 翻面已久,纯零残留
// 核销断言价值衰减,宁缺毋滥整删(原 ④ 托管微标升 ③)。
import { test, expect } from "./fixtures";
import {
  quickStart,
  waitMyPause,
  waitSettled,
  openSoloSetup,
  pickCapital,
  force,
} from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

/** 行1 现金 + 行2 五计数逐席与快照一致(单次 evaluate 原子采样:DOM 与快照同拍)。
 *  手牌计数 ≥10 格上封顶「9+」(#751 C 批,真实全数在弹层),对照随封顶口径折算。
 *  #1130 撞车必修(#1140):行2 五账式后计数与汉字标签同住 testid span
 *  (「城1」),对照面剥标签字取纯数——#1130 自注「e2e 零改」实测不成立,
 *  cellsMatchSnapshot 两个计数例在主树恒挂。 */
function cellsMatchSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const s = (window as any).__dafung.snapshot();
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
    const num = (id: string) => q(id)?.replace(/^[城牌将宝望]/, "") ?? null;
    const handShown = (n: number) => (n > 9 ? "9+" : String(n));
    return s.players.every(
      (p: any, seat: number) =>
        q(`seat-cash-${seat}`) === String(p.cash) &&
        num(`seat-attr-city-${seat}`) === String(p.properties.length) &&
        num(`seat-attr-hand-${seat}`) === handShown(p.jinnangHandCount) &&
        num(`seat-attr-hero-${seat}`) === String(p.heroes.length) &&
        num(`seat-attr-gem-${seat}`) === String(p.treasures.length) &&
        num(`seat-attr-rep-${seat}`) === String(p.reputation),
    );
  });
}

test.describe("席位格行2 计数与投影一致(#698 ①)", () => {
  // 真实段(ADR-0058):真实开局对局自走,席位格行2 计数与引擎快照逐席对账(单次
  // evaluate 原子采样)即被测环——零种植零冻结。
  test("4 席局:现金主数(裸数无千分位)+ 五图标计数逐席一致", async ({ page }) => {
    await quickStart(page);
    await expect.poll(() => cellsMatchSnapshot(page)).toBe(true);
    // 一人一格(自机入列):4 席局 = 4 张格,全部在单一 seatcol 内
    const cells = page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`);
    await expect(cells).toHaveCount(4);
    await expect(page.locator(`[data-testid=${TESTIDS.seatRail}] .seatcol .seat`)).toHaveCount(4);
  });

  // 真实段(ADR-0058):真实 8 诸侯开局全链(准备页起兵→定都→对局自走停靠)+真实
  // 视口切换重排,格高/零滚动盒模型即被测环——零种植零冻结。
  test("满编 8 席(844×390 矮横屏):计数逐席一致,格高 38、列零滚动", async ({ page }) => {
    test.slow(); // 人类首回合前最多 7 个 bot 回合,预算放宽(react-layout 8 席例同口径)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    await waitSettled(page);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(真机即此重排路径)
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => cellsMatchSnapshot(page)).toBe(true);
    await expect(page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`)).toHaveCount(8);
    // 零滚动几何:格高 clamp 到 38 上限,8×38+7×2=318 ≤ 可用高 328(390−8−54)
    const geo = await page.evaluate(() => {
      const col = document.querySelector(".seat-rail .seatcol")!;
      const cells = [...col.querySelectorAll<HTMLElement>(".seat")];
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      return {
        cellH: cells[0]!.getBoundingClientRect().height,
        lastBottom: last.bottom,
        overflow: (col as HTMLElement).scrollHeight - (col as HTMLElement).clientHeight,
        colBottomLimit: document.documentElement.clientHeight - 54,
      };
    });
    expect(Math.abs(geo.cellH - 38)).toBeLessThanOrEqual(0.5);
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.colBottomLimit + 0.5);
    expect(geo.overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("席位格五状态与自机挂点(#698 ②)", () => {
  // 真实段(ADR-0058):席位格五状态挂点对引擎状态的 CSS 响应链即被测环(.active/
  // .self/.low/.bankrupt 类随状态真渲染)。force 判词:钉行动方=挂点断言前提
  // (引擎无「钉相位」公共命令);濒耗竭已迁 setStamina 种植件(#1299,薄包
  // addStamina 唯一写口,「体力<三成」形态开局初期到不了——起手满体力,负增量无
  // 自然来源);破产态直写 isBankrupt——破产清算引擎有专属通路但需整局推演,断言面
  // 需即时破产形态。
  test("活跃金圈呼吸/濒耗竭朱砂条/破产印灰挂点,自机=金样式无文字章", async ({ page }) => {
    // 波5b #1218 preRoll 评估采用(种植例):挂点断言不依赖行军日志/回合数——落都
    // 即冻结(#1221 通路),显式 freezeClock 与随机 seed 停靠漂移一并退役。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 活跃:调试钩子把行动方钉到 bot 席(引擎无「钉相位」公共命令,钉死行动方挂点
    // 断言才有前提;preRoll 已冻,无自动推进)→ 该格 .active
    await force(page, `e.activeIndex = 1;`);
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/active/);
    // 自机格:seat-self 挂点 + .self 类;活跃已钉在 bot 席 → 自机格无 .active/.picked;
    // seat-N 族不含自机(对手席专用族不变)
    const selfCell = page.getByTestId(TESTIDS.seatSelf);
    await expect(selfCell).toBeVisible();
    await expect(selfCell).toHaveClass(/self/);
    await expect(selfCell).not.toHaveClass(/active/);
    await expect(selfCell).not.toHaveClass(/picked/);
    await expect(page.getByTestId(TESTIDS.seat(0))).toHaveCount(0);
    // 濒耗竭:体力压到 20(<三成)→ 色条挂 .low(转朱砂)。setStamina 种植件(#1299,
    // 薄包 addStamina 唯一写口,对外绝对值语义,判词单源 src/core/planter.ts)
    await plant(page, { kind: "setStamina", seat: 1, stamina: 20 });
    await expect(page.getByTestId(TESTIDS.seatStamina(1)).locator(".strack")).toHaveClass(/low/);
    // 破产:直写 isBankrupt → 整格降透明印灰挂点
    await force(page, `e.players[2].isBankrupt = true;`);
    await expect(page.getByTestId(TESTIDS.seat(2))).toHaveClass(/bankrupt/);
  });

  // 真实段(ADR-0058):真实设置弹层「托管」开关交互链(开/关往返,dispatchEvent
  // 直派穿遮罩照进真实 onClick,ADR-0028 引擎公共通路),微标随开关往返的真渲染
  // 即被测环——零种植零冻结。
  test("托管常驻微标(#770):开=自机格齿轮挂点、关=撤,对手 bot 席恒无", async ({ page }) => {
    await quickStart(page);
    // 拨开关到目标态+生效确认,整块短重试(波5b #1218 加网):aria-checked 广播回读
    // 在负载下丢拍曾挂(「托管微标」签名)。点前读态、已在目标态不点=重试幂等(防
    // 迟到广播期的重复点击翻转),广播迟到在拍间自愈(配方口径同 react-online-autopilot
    // setAutopilot:点前读态+点后生效轮询)。
    async function toggleAutopilot(on: boolean): Promise<void> {
      await page.getByTestId(TESTIDS.settingsButton).dispatchEvent("click");
      const sw = page.getByTestId(TESTIDS.settingsAutopilot);
      await expect(sw).toBeVisible({ timeout: 10_000 });
      // 点前读态(已在目标态不点)+至多一次点击;生效确认=纯轮询**不补点**——
      // 补点会在 ack 迟到窗内读到旧值再点=来回振荡(2026-11-08 集成收口实锤:
      // OFF 腿振荡卡 true 整窗)。广播迟到期 30s 纯轮询吸收,配方口径
      // (react-online-autopilot setAutopilot:点前读态+点后生效轮询)自此名副其实。
      if ((await sw.getAttribute("aria-checked")) !== String(on))
        await sw.click({ timeout: 5_000 });
      await expect(sw).toHaveAttribute("aria-checked", String(on), { timeout: 30_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(TESTIDS.settingsDialog)).toBeHidden({ timeout: 5_000 });
    }
    const badge = page.getByTestId(TESTIDS.seatHosted(0));
    await expect(badge).toHaveCount(0);
    // 开托管(#1097 通路:设置弹层「托管」开关,ADR-0028 同一引擎通路)
    await toggleAutopilot(true);
    // 常驻微标现于自机格(纯展示,开关交互唯设置弹层);对手 bot 席非托管恒无
    await expect(badge).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatHosted(1))).toHaveCount(0);
    // 关托管 → 微标撤(状态随开关往返,§4.6 无文字章)
    await toggleAutopilot(false);
    await expect(badge).toHaveCount(0);
  });

  // 真实段(ADR-0058):出牌窗内点牌→目标段候选→点选停持/再点取消的完整真实交互
  // 链即被测环(窗经 seed67 开局链真升,点击全真)。种植面:seat1 挂珍宝凑目标门槛
  // 经 giveTreasure(#1299)、手牌牌形经 giveJinnang(#1298)——判词单源
  // src/core/planter.ts(手牌无公共通路/rack 停车坪同判词;珍宝无授给公共命令)。
  test("目标段:候选格金圈呼吸(.candidate),点选实金停持(.picked)再点取消", async ({ page }) => {
    // seed67 关中图开局链停在出牌阶段态;波5b #1218 preRoll 评估采用(种植例):
    // quickStart mapId 直传钉图(#147 地图是骰流变量)+preRoll 落都即冻结(#1221
    // 通路)替代手搓选都 UI 链+显式 freezeClock——断言面=目标段挂点交互,不依赖
    // 行军日志/回合数(seed 67 起手求贤令恒可用,preRoll 停 AwaitingJinnang 窗必在)。
    await quickStart(page, 67, { mapId: "guanzhong", advance: "preRoll" });
    // 军情密探目标段同款:给 seat1 挂珍宝凑目标门槛,直写替换手牌(preRoll 已冻)。
    await plant(page, {
      kind: "giveTreasure",
      seat: 1,
      treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }],
    });
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段:候选格金圈呼吸挂点
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/candidate/);
    // 点格=选中(.picked 实金停持),再点同格=取消(#417 统一口径)
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/picked/);
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).not.toHaveClass(/picked/);
  });
});
