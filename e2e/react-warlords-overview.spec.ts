// 诸侯详情弹窗(#702,#732 正名,spec #697 ⑥)。存例 2(几何,永留):
//   · 声列三档概率条几何腿壳例(#1096 决议4/5,#1099):高声望好运段占优/零声望三等分,
//     概率条宽度比(getBoundingClientRect,勿钉像素);
//   · 满编 8 行 @844×390 零滚动零截断(⑤)。
// 【#1316 批T2 迁 2+切 1(4→2)】「四元素钻入单层互斥」(#1096 决议3,#1097)与「状态
// 挂点」(.self 金描边/.dead 灰化/.is-active 印金圈)两例下放接线层 test/
// overview-wiring.test.tsx「诸侯详情接线」组(全 DOM·store 语义);原①「十列数值逐字
// 对照」切腿——语义腿(行数据/城池名录/名将名/珍宝槽位/题名轮次/Esc 关闭)同迁该
// 文件「十列行数据语义腿」例,声列概率条宽度比几何腿(假 DOM 无排版引擎不可下放,
// ADR-0062 断言宪法)留本文件壳例并如实改名;钻入例的明细百分比明文腿(tierShares
// 同源现算)随语义腿同迁,明细条三段在场计数随钻入例留接线层。
// (原④「打开不暂停」例已按 #987 零容忍删除 2026-11-05:一日四挂两绿两种签名——
// 点击拦截层修通后快照推进层又挂,时序竞速族;「弹层开着对局照走」是架构事实
// (引擎不知弹层),不可靠守卫按纪律删不留台账,#1042 有案。)
// 停靠纪律:quickStart 可能在行军演出在播时归还——清卷轴必须
// 「等 fx 排空→再探→无动作」循环收敛,冻结后再补一刀;钉 seed 1010(#949 关中重钓:
// 原 49 × huanyou 停靠随换图作废,1010 实测开局停在购地决策、无招贤岔路)。总览行无浮签触发元(title 静态浮签除外),无 #704
// 残影风险;关闭走 Esc/点外/X 三路(ui/dialog 底件白拿)。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  openSoloSetup,
  pickCapital,
  waitMyPause,
  actIfCan,
  waitFxIdle,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

// 本 spec 各例都是「整局 boot + 种植 + 弹层链」重例:60s 缺省
// 超时装不下,显式放宽——放宽语句必须落在测试体首行(文件顶层调用不生效)。

/** 清决策卷轴到「演出排空且无可用动作」(等 fx 排空→再探→无动作循环收敛)。 */
async function settleForOverview(page: Page) {
  for (let i = 0; i < 10; i++) {
    await waitFxIdle(page, 45_000);
    if (!(await actIfCan(page))) break;
  }
  await waitFxIdle(page, 45_000);
}

/** 冻结停靠:清卷轴→冻结→补一刀(挡不住的挂载窗口在此排空)。 */
async function freezeForOverview(page: Page) {
  await settleForOverview(page);
  await freezeClock(page);
  await settleForOverview(page);
}

/** 开总览弹层(触发钮真点击;按钮在顶栏 z-6,无遮挡)。 */
async function openOverview(page: Page) {
  await page.getByTestId(TESTIDS.topbarOverview).click();
  const modal = page.getByTestId(TESTIDS.warlordsOverview);
  await expect(modal).toBeVisible();
  return modal;
}

/** 声列概率条三段布局宽(#1099 结构断言原料;勿钉像素,断言一律吃宽度比)。 */
function repBarWidths(page: Page, testid: string) {
  return page
    .getByTestId(testid)
    .locator(".rep-prob-bar > i")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width));
}

/** 种植声列极端形态(#1099 概率条宽度比断言的种植面):座位 1 高声望 +210(好运段
 *  结构性占优)/ 自机钉零声望(softmax 零点三段等宽)。
 *  数值族种植(#1299,判词单源 src/core/planter.ts):setReputation(概率条断言面需
 *  softmax 极端形态,薄包 addReputation 唯一写口,ReputationChanged 时机随公共口
 *  广播、战报零染)。【#1316 批T2 切腿】原名录/珍宝/城池种植随语义腿迁出(见文件
 *  头注),几何壳例只余声望两钉。 */
async function plantRepExtremes(page: Page) {
  await plant(page, { kind: "setReputation", seat: 1, reputation: 210 });
  await plant(page, { kind: "setReputation", seat: 0, reputation: 0 }); // 自机钉零:softmax 零点三段等宽断言的种植面
}

test.describe("声列概率条几何腿壳例(#1099;#1316 批T2 切腿后本例只剩几何)", () => {
  // 真实段(ADR-0058):真实开局链(seed1010 停靠)+总览真实点开,声列三档概率条的
  // 真排版几何(宽度比,勿钉像素)即被测环——语义腿(行数据/名录/明细明文/Esc 关闭)
  // 已迁接线层 test/overview-wiring.test.tsx(判词见文件头注),此处只剩几何腿。
  test("声列三档概率条:种植席好运段占优(>半条),零声望三段等宽", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 1010);
    await freezeForOverview(page);
    try {
      await plantRepExtremes(page);
      await openOverview(page);

      // 声列三档概率条(#1099):宽度比结构断言,勿钉像素——种植席 +210 好运段
      // 结构性占优(softmax 单调,>半条);自机钉零声望,softmax 零点三段等宽。
      const w1 = await repBarWidths(page, TESTIDS.warlordsRepCell(1));
      expect(w1).toHaveLength(3);
      expect(w1[0] / w1.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);
      const w0 = await repBarWidths(page, TESTIDS.warlordsRepCell(0));
      expect(w0).toHaveLength(3);
      expect(Math.abs(w0[0] - w0[1])).toBeLessThan(0.5);
      expect(Math.abs(w0[1] - w0[2])).toBeLessThan(0.5);
    } finally {
      await unfreezeClock(page);
    }
  });
});

// 「四元素钻入单层互斥」「状态挂点」两例已迁(2026-11-08,#1316 批T2):迁移落点=
// 接线层 test/overview-wiring.test.tsx「诸侯详情接线」组,判层只看断言面——钻入链
// (点击→总览先关再开目标弹层+明细 DOM 有无与文本,tierShares 明文吃同源现算)与
// 行状态挂点(.self/.dead/.is-active 类名+数值文本)全部是「操作过后渲染树/store 里
// 的语义」,零几何零演出泵;e2e 到达链(真实开局自走+冻结停靠)非断言面,随判层
// 换轨。声列明细条三段在场计数(非宽度)随钻入例留接线层,概率条宽度比几何腿留
// 本文件壳例(见上组)。

test.describe("满编 8 行零滚动零截断(#702 ⑤)", () => {
  // 真实段(ADR-0058):真实 8 诸侯开局全链(准备页起兵→定都→对局自走停靠)+总览
  // 真实点开,8 行真渲染几何(零滚动/末行不截断/不出视口)即被测环——零种植
  // (冻结为到达手段,非字段直改)。
  test("8 席 @844×390:8 行全见,容器无滚动,末行下缘不出窗", async ({ page }) => {
    test.setTimeout(240_000); // 8 人选都链路更重(react-seat-cells 满编例同因)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(react-float-skeleton 同法)
    await page.setViewportSize({ width: 844, height: 390 });
    await settleForOverview(page);
    await freezeClock(page);
    try {
      await openOverview(page);
      const geo = await page.evaluate((containerId) => {
        const dlg = document.querySelector(`[data-testid="${containerId}"]`)!;
        const rows = [...dlg.querySelectorAll(".zl-row")];
        const box = dlg.getBoundingClientRect();
        const last = (rows[rows.length - 1] as HTMLElement).getBoundingClientRect();
        return {
          count: rows.length,
          overflow: (dlg as HTMLElement).scrollHeight - (dlg as HTMLElement).clientHeight,
          lastBottom: last.bottom,
          dlgBottom: box.bottom,
          dlgW: box.width,
          vw: document.documentElement.clientWidth,
        };
      }, TESTIDS.warlordsOverview);
      expect(geo.count).toBe(8);
      expect(geo.overflow).toBeLessThanOrEqual(0); // 容器零滚动
      expect(geo.lastBottom).toBeLessThanOrEqual(geo.dlgBottom + 0.5); // 末行不截断
      expect(geo.dlgW).toBeLessThanOrEqual(geo.vw); // 近全屏不出视口
    } finally {
      await unfreezeClock(page);
    }
  });
});
