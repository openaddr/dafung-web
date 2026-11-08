// 弹层族矮屏规范(#708,#687 定案施工):780×360 矮横屏实拍断口的通路守卫——
// PileShell 壳夹高(最大高=视口−64px)、体部内滚可达末行。视觉终证走 shot.mjs 实拍。
// #987 清退(2026-11-06,#1096 收口):「名将弹层壳夹高」「城池清单内滚」两例跨轮游走
// 挂(池挂 :64/串行挂 :31,城池清单例换开局路径后复验又换例)——概率性不可靠,删例
// 不留台账;购地卷轴钉底哨兵两轮全绿保留。城池钻入通路覆盖归 react-warlords-overview。
// #729 决策卷轴哨兵:844×390 下 BannerShell 三段式(题行钉顶+正文井内滚+拍板钮
// 钉底 footer 槽)——「购地/不取」恒在视口内(Playwright 点击自动滚入视口,点击型
// 断言测不出滚出视口,须几何断言钉住)。
import { test, expect, type Page } from "./fixtures";
import { useHalfScale, force, disableEncounters } from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("决策卷轴拍板钮钉底(#729)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 首掷种植(#1170 路线 B):一次性 patch dice.roll——人类掷骰瞬间现算「当前位置起
   *  1..6 步内首个无主普通城」骰值并自还原;bot 掷骰照走种子 rng 不受扰。目标格掷时
   *  现算(读 activePlayer 与盘面归属),不赌 seed 考古;无主过滤天然排除三家都城
   *  (建城即有主,首停落他人城会触发珍宝交涉停靠永久等抉择),`!t.event` 再排特殊城
   *  (落格走固定事件链会顶掉购地决策)。1..6 步内无目标=求解前提破坏,直接抛错
   *  (零兜底)。行程骰=dice.roll 口,拼点 rollDie 另口不串队。
   *  force 判词(钉骰族现算形,#1302 归界):钉骰**值序**形已收编 pinDice 种植件
   *  (#1302,判词单源 src/core/planter.ts);本站是**现算形**——骰值按掷骰瞬间的
   *  盘面求解(选都前种不进定值:首停落点由都城位定),pinDice 值队列表达不了,亦无
   *  「走到指定格」公共命令——patch 现算确定性到达是唯一通路。现算形钉骰是否补件
   *  归 #1303 缺口盘点裁决。 */
  const marchToUnownedOnce = `
    (() => {
      const o = e.dice.roll.bind(e.dice);
      e.dice.roll = () => {
        const m = e.activePlayer;
        if (m !== e.players[0]) return o();
        e.dice.roll = o;
        for (let d = 1; d <= 6; d++) {
          const t = e.board.at((m.position + d) % e.board.count);
          if (t?.propertyId && !e.findOwner(t.propertyId) && !t.event) return { die: d };
        }
        throw new Error("首掷种植失败:当前位置 1..6 步内无无主普通城");
      };
    })();`;
  /** seed 1026 拦检链到购地卷轴(#1170 种植式停靠,#949 同源配料):844 条带选图
   *  (reaction soloAtBuyAsk 的二级弹层在 844 无确认钮不通)+ 机遇归零(先 route 后
   *  进屏;#1100 适配期曾漏挂——机遇开的骰流消耗把候选与首停全带漂,多种子重钓
   *  皆 miss,考古见票面)+ 种植现金 20000(全图最高价 4800,不种则起手净剩不足
   *  自动不取、卷轴不弹;setCash 种植件 #1299,判词单源 src/core/planter.ts)+ 首掷
   *  种植:人类第一停恒落无主普通城,购地决策确定性可达(现算形 force 判词见
   *  marchToUnownedOnce 注)。 */
  async function startBuyScroll(page: Page): Promise<void> {
    await useHalfScale(page);
    await disableEncounters(page);
    await page.goto(`/?seed=1026`);
    await page.getByTestId(HOME_TID.mapStripItem("guanzhong")).click();
    await page.getByTestId(HOME_TID.solo).click();
    await page.getByTestId(SETUP_TID.screen).waitFor();
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.waitForFunction(() => window.__dafung?.controller() != null);
    await plant(page, { kind: "setCash", seat: 0, cash: 20000 });
    await force(page, marchToUnownedOnce);
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(TESTIDS.confirmCapitalOk).click();
    await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
  }

  // 真实段(ADR-0058):真实开局链走到人类首停落无主城触发购地决策(拦检链现算骰值),
  // 购地卷轴真实弹出的 BannerShell 三段式几何(壳夹高/拍板两钮在视口内且全落壳盒内)
  // 即被测环。force 判词见 marchToUnownedOnce/startBuyScroll 注(首掷落点无公共通路
  // +卷轴弹出需现金前提)。
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
