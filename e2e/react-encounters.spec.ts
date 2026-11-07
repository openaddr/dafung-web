// 机遇系统冒烟(#126;ADR-0035 必出制):开关配置 + 声望渲染 + 机遇卷轴弹出与结算。
// 配置:开关开(#1090 配置面只剩这一个开关,三档手工基准退役;三档概率=声望 softmax
// 三元拉锯,无手工配置)→ 每次落格必遇机遇。seed=67 钉死确定性对局(#987 零容忍:
// 概率性「赌 N 秒内必见卷轴」评审必修改造)——卷轴出现时点固定,预算只是负载余量。
// 既有 spec 的机遇隔离在 openSoloSetup 内统一关开关,本 spec 开局前把开关拨回「开」。
import { test, expect } from "./fixtures";
import { actIfCan, openSoloSetup, pickCapital, waitSettled, waitMyRollDone } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

test.describe("机遇系统冒烟", () => {
  test("开关开局 + 声望渲染 + 抉择机遇卷轴弹出并结算", { tag: "@slow" }, async ({ page }) => {
    // 慢池(#1026;菜单A 2026-11-07 挪入):单例实测 40.2s>30s——快池门禁 --grep-invert @slow 跳过。
    // 真实段(ADR-0058):开关真实拨启(机遇必出制 ADR-0035 的产品默认通路)→真实
    // 对局自走,机遇卷轴真实弹出→点选项真实结算(引擎机遇结算落账+声望徽章渲染)
    // 即被测环——零种植零冻结;卷轴出现时点由 seed 67 钉死,确定性到达。
    // 内部预算 90s/120s(waitMyRollDone/抉择循环)本就超过测试级 60s 默认——
    // 全量并行负载下阶段耗时一涨就被外层掐死(#217① 同族,#240 收口实测复现),
    // 标 slow 对齐外层超时至 120s,让内部预算真正生效。
    test.slow();
    await page.goto("/?seed=67"); // 钉 seed(#987 评审必修):确定性对局,卷轴时点固定
    await openSoloSetup(page);
    await page.getByTestId(SETUP_TID.encounterEnabled).click(); // 开关打开(机遇必出)
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    // 负载下 30s 窗可爆(#217①,与 #191 同族):等人类的当前一手自动走完,预算 90s。
    // #188:轮询体内逐拍放行锦囊卷轴 + 等自动起摇推进(等 roll-button 可用的旧出口已随
    // 行军按钮移除退役)。
    await waitMyRollDone(page, 0, 90_000);
    await waitSettled(page);

    // 引擎配置 fail-fast:机遇参数没进引擎时,后续断言全是废话(#1090 起只剩布尔开关,
    // 三档基准不再入引擎——档位概率由声望 softmax 现算,单源 core/encounters.ts)
    const engCfg = await page.evaluate(() =>
      JSON.stringify((window as any).__dafung.getEngine().encounter),
    );
    expect(JSON.parse(engCfg), `引擎机遇配置=${engCfg}`).toEqual({ enabled: true });

    // 声望渲染:席位格声望徽章(#700 仪表条退役,aria 即名词+值),初值 0
    await expect(page.getByTestId(TESTIDS.seatAttr(0, "rep"))).toHaveAttribute(
      "aria-label",
      "声望 0",
    );

    const scroll = page.getByTestId(SCROLL_TESTIDS.encounterScroll);
    // 机遇必出 → 每次落格必遇机遇;档位=声望 softmax(初盘近均分,seeded 对局分布
    // 可漂移=预期),抉择型占比 29/60(#1154 扩容)。#188 行军自动化后 bot 回合/自动起摇期间
    // actIfCan 恒 false,按步计数会空转烧预算——原「while + 300ms 固定采样」换
    // expect.poll 状态轮询:每拍机遇卷轴不在场就经 actIfCan 清决策点推进,出现即收
    //(120s 时间预算不变)。
    await expect
      .poll(
        async () => {
          if (!(await scroll.isVisible().catch(() => false))) await actIfCan(page);
          return scroll.isVisible().catch(() => false);
        },
        { timeout: 120_000, message: "机遇抉择卷轴弹出(≥2 真实选项,不自动执行)" },
      )
      .toBe(true);
    // 点第一选项收卷:负载下点击可能被重挂弹层吞,「点 + 验隐」整块 toPass 重试
    //(原 toBeHidden(20s) 语义平移)。
    await expect(async () => {
      await page
        .locator('[data-testid^="scroll-encounter-option-"]')
        .first()
        .click({ timeout: 2_000 })
        .catch(() => {});
      await expect(scroll).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // 声望渲染:结算后声望可为负(无界,±不夹紧)——好运/霉运选项常带 ±声望增减,
    // 都可能被抽中并经「点第一选项收卷」落账。负号是合法终态,断言只锁「徽章渲染整数」。
    await expect(page.getByTestId(TESTIDS.seatAttr(0, "rep"))).toHaveAttribute(
      "aria-label",
      /声望 -?\d+/,
    );
  });
});
