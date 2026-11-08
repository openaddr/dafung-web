// 弹层族矮屏规范(#708,#687 定案施工):780×360 矮横屏实拍断口的通路守卫——
// PileShell 壳夹高(最大高=视口−64px)、体部内滚可达末行。视觉终证走 shot.mjs 实拍。
// #987 清退(2026-11-06,#1096 收口):「名将弹层壳夹高」「城池清单内滚」两例跨轮游走
// 挂(池挂 :64/串行挂 :31,城池清单例换开局路径后复验又换例)——概率性不可靠,删例
// 不留台账;购地卷轴钉底哨兵两轮全绿保留。城池钻入通路覆盖归 react-warlords-overview。
// #729 决策卷轴哨兵:844×390 下 BannerShell 三段式(题行钉顶+正文井内滚+拍板钮
// 钉底 footer 槽)——「购地/不取」恒在视口内(Playwright 点击自动滚入视口,点击型
// 断言测不出滚出视口,须几何断言钉住)。
import { test, expect, type Page } from "./fixtures";
import { quickStart, useHalfScale, engineState, actIfCan, unfreezeClock } from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

test.describe("决策卷轴拍板钮钉底(#729)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 布场到「首停落无主普通城、购地卷轴弹起」(#1303 棒1 重构,原 #1170 路线 B
   *  现算形 patch 退役):preRoll 落都即冻结(#1221 通路,卷轴/系统族同款)→ 盘面
   *  读现值选址(无主普通城;选都已完结、三家都城已有主——bot 撞城风险不存在,
   *  `!t.event` 排特殊城防固定事件链顶掉购地决策)→ placePlayer 摆贴邻前一格 +
   *  pinDice 钉行程骰 [1] + setCash 垫足 20000(全图最高价 4800,不垫则自动不取
   *  卷轴不弹;三者判词均单源 src/core/planter.ts)→ 开局出牌段停泊则放行「不出」
   *  (actIfCan 只点 pass)→ 解冻,首掷真走 rollAndMove:落点确定性由「掷骰瞬间
   *  现算 patch dice.roll」搬到「摆位读现值拼+定值骰」——pinDice 值队列表达得了,
   *  不做函数式钉骰(force 逃生口换皮方案,#1303 缺口盘点裁决弃用)。单格行程无拦检,落格结算
   *  真实产出可购决策。 */
  async function startBuyScroll(page: Page): Promise<void> {
    await useHalfScale(page);
    await quickStart(page, 1486, { advance: "preRoll" });
    const spot: { land: number; from: number } = await engineState(
      page,
      `(() => {
        const t = e.board.tiles.find(
          (t) => t.propertyId && !t.event && e.findOwner(t.propertyId) == null,
        );
        if (t == null) throw new Error("盘面无无主普通城(数据 bug)");
        return { land: t.index, from: (t.index + e.board.count - 1) % e.board.count };
      })()`,
    );
    await plant(page, { kind: "placePlayer", seat: 0, position: spot.from });
    await plant(page, { kind: "pinDice", channel: "march", values: [1] });
    await plant(page, { kind: "setCash", seat: 0, cash: 20000 });
    // 开局出牌段(AwaitingJinnang)停泊则放行「不出」到 Roll(冻结中点击,起摇定时
    // 器仍冻);Roll 停靠则无可放。quickStart preRoll 不等沉降,actIfCan 靠可见性,
    // 先等动作条挂载。放行后未到 Roll=布场配方破坏,炸出来不静默(零兜底)。
    if ((await engineState(page, "e.turnPhase")) !== "Roll") {
      await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
      for (let i = 0; i < 5; i++) {
        if (!(await actIfCan(page))) break;
      }
      if ((await engineState(page, "e.turnPhase")) !== "Roll")
        throw new Error("布场未到 Roll 停靠:开局出牌段放行失败");
    }
    await unfreezeClock(page);
    await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
  }

  // 真实段(ADR-0058):首掷→单格行军→落格结算全真(只钉骰值与摆位,ADR-0058
  // 驱动形=钉骰+行军公共口组合),购地卷轴真实弹出的 BannerShell 三段式几何(壳夹高/
  // 拍板两钮在视口内且全落壳盒内)即被测环。布场配方见 startBuyScroll 注(判词单源
  // src/core/planter.ts)。
  test("购地卷轴:拍板两钮恒在视口内、壳高 ≤86dvh、钮盒全落壳盒内(#729)", async ({ page }) => {
    await startBuyScroll(page);
    // 入场 banner-drop 带整体位移:几何断言包 toPass 吸收动画中的瞬时盒
    // (react-short-stage 拼点签面同法);种植式断言,零固定 sleep
    await expect(async () => {
      const shell = (await page.getByTestId(SCROLL_TESTIDS.buyScroll).boundingBox())!;
      const buy = (await page.getByTestId(TESTIDS.actionButton("buy")).boundingBox())!;
      const skip = (await page.getByTestId(TESTIDS.actionButton("skip")).boundingBox())!;
      // 壳夹高:横幅系 86dvh 口径不动(390×0.86≈335.4;.5 容亚像素舍入)
      expect(shell.height).toBeLessThanOrEqual(390 * 0.86 + 0.5);
      for (const [label, box] of [
        ["购地", buy],
        ["不取", skip],
      ] as const) {
        // 拍板钮恒在视口内(#729 根因:钮原在正文井内,矮横屏随表滚出视口,
        // 点击型断言被自动滚入遮蔽,须几何断言钉住)
        expect(box.x, `${label}钮左缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label}钮上缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label}钮右缘出视口`).toBeLessThanOrEqual(844);
        expect(box.y + box.height, `${label}钮下缘出视口`).toBeLessThanOrEqual(390);
        // 钮盒完全在壳盒内:钉底段是壳的第三段,不漂出壳外
        expect(box.x, `${label}钮左缘出壳`).toBeGreaterThanOrEqual(shell.x - 0.5);
        expect(box.y, `${label}钮上缘出壳`).toBeGreaterThanOrEqual(shell.y - 0.5);
        expect(box.x + box.width, `${label}钮右缘出壳`).toBeLessThanOrEqual(
          shell.x + shell.width + 0.5,
        );
        expect(box.y + box.height, `${label}钮下缘出壳`).toBeLessThanOrEqual(
          shell.y + shell.height + 0.5,
        );
      }
    }).toPass({ timeout: 5_000 });
  });
});
