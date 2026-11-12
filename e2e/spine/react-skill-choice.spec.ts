// 地板名册(ADR-0062):层⑤定向双例(#1378)——「你可」选择闸(#1377 引擎面 +
// #1378 交付面)的真人真路与 bot 代打真路。
// 判层:两例断言面 = 窗呈现挂点 + 真命令通路(真人手点 / 驱动链代答)+ 权威留痕
// (引擎 log/skipTurns/marks 落账),零逻辑断言进浏览器层——引擎结算语义(阈值/放弃
// 保留/叠加/耗竭过滤/快照往返/bot 决策函数)归层① test/fangzhu-xingshang.test.ts,
// 呈现状态机(store→DOM 挂点)归层④ test/wiring/skill-choice-wiring.test.tsx。
// 非几何哨非真 API:真 UI 开局链真路,归 spine(ADR-0058 一环一真——窗交互=真人手点;
// 种植只布被测环之前的背景:armHero 直授 + setStamina 过阈/领跑者现金,判词单源
// planter.ts 各族头注;耗竭布景走引擎公共方法直呼 exhaustIfDepleted,#1302 callEngine
// 通道归口)。
// 呈现件:触发卡 SkillChoiceBanner(架缘横幅,反应窗同形)+ 放逐标记进度轨(.skmark,
// AC3);testid 全走 testids.ts 单源。
// 场景配方跨 spec 照抄出处:quickStart postRoll 停靠 + plant 三拍纪律 = react-jinnang-use
// 同族;actIfCan 清决策点循环 = react-midgame-constructor 驱动循环收窄(本 spec 只推到
// 本回合收口,不跨回合)。
import { expect, test } from "../fixtures";
import { actIfCan, quickStart, waitSettled } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";

/** 种子谱(漂移按 how-to「种子哨兵与重钓配方」重钓):postRoll 停靠=首掷后我方
 *  决策停(购地卷轴档;cash 种植解耦地图价格,卷轴必在)。 */
const SEED_HUMAN = 1026;
const SEED_BOT = 1026;

test.describe("「你可」选择闸真路(#1378)", () => {
  test("真人真路:挨打攒怒→触发卡→选目标发动→战报缘由+被跳+标记归零", async ({ page }) => {
    test.setTimeout(120_000);
    await quickStart(page, SEED_HUMAN); // postRoll 停靠:首掷后我方决策停
    // 布景(被测环之前):直授放逐 + 现金解耦购地价 + 挨打 70(过阈挂问在队)
    await plant(page, { kind: "setCash", seat: 0, cash: 20000 });
    await plant(page, { kind: "armHero", seat: 0, heroId: "caopi", skillIds: ["fangzhu"] });
    await plant(page, { kind: "setStamina", seat: 0, stamina: 30 });
    // AC3 呈现:放逐标记进度轨满档呼吸档(aria 数值=快照 marks)
    await expect(page.getByTestId(TESTIDS.seatSkillMark(0))).toHaveAttribute(
      "aria-label",
      "放逐 70/60",
    );
    // 清我方决策点(购地/出牌窗/招贤)直至回合收口挂窗:窗=「你可」触发卡升起
    for (let i = 0; i < 40; i++) {
      if (
        await page
          .getByTestId(TESTIDS.skillChoiceBanner)
          .isVisible()
          .catch(() => false)
      )
        break;
      if (!(await actIfCan(page))) await page.waitForTimeout(200);
    }
    const banner = page.getByTestId(TESTIDS.skillChoiceBanner);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("「放逐」可达发动条件");
    // 选人(候选笺=存活他人):点笺选中→发动点亮→确认
    await page.getByTestId(TESTIDS.skillChoiceSeat(1)).click();
    await expect(page.getByTestId(TESTIDS.skillChoiceConfirm)).toBeEnabled();
    await page.getByTestId(TESTIDS.skillChoiceConfirm).click();
    // 权威留痕:发动战报(skillChoiceFire detail + brief 缘由句)+ 目标被跳落账 +
    // 标记归零(fireResetsMarks)——全部引擎侧真值,呈现面(轨卸下/窗收)随拍收敛
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const e = (window as any).__dafung.getEngine();
          return {
            fired: e.log.some((l: { detail: string }) =>
              l.detail.includes("skillChoiceFire skill=fangzhu"),
            ),
            warBrief: e.log.some((l: { brief: string }) => l.brief.includes("发动「放逐」")),
            skipped: e.log.some((l: { detail: string }) => l.detail.includes("skipTurn player=p1")),
            marks:
              (e.players[0].heroes as { heroId: string; marks?: Record<string, number> }[]).find(
                (h) => h.heroId === "caopi",
              )?.marks?.fangzhu ?? 0,
          };
        }),
      )
      .toEqual({ fired: true, warBrief: true, skipped: true, marks: 0 });
    await expect(banner).toBeHidden(); // 窗收(应答后重入收口)
    await expect(page.getByTestId(TESTIDS.seatSkillMark(0))).toHaveCount(0); // 归零=轨卸下
    await waitSettled(page);
  });

  test("bot 代打:放逐满发打领跑者(与人同规则,不同决策者;窗对玩家零挂卡)", async ({ page }) => {
    test.setTimeout(120_000);
    await quickStart(page, SEED_BOT);
    // 布景:bot1(座 2)直授放逐 + 攒怒 70 过阈 + 领跑者=座 4(现金 60000,bot1 自身除外)。
    // 问的代答路径:我方回合收口挂窗(owner=bot1)→ 同一命令的房间驱动链按 bot 策略
    // 代答(botAct → botSkillChoiceDecision 单源;行殇同链同径,恒发语义已由层①钉住,
    // 本例不重复布耗竭)。玩家侧零挂卡(decisionOwner=bot,interactive 恒 false)。
    await plant(page, { kind: "setCash", seat: 3, cash: 60000 }); // 净值领跑者=座位 3
    await plant(page, { kind: "armHero", seat: 1, heroId: "caopi", skillIds: ["fangzhu"] });
    await plant(page, { kind: "setStamina", seat: 1, stamina: 30 }); // bot1 攒怒 70 过阈
    // 清我方决策点:回合收口挂窗 → 驱动链按 bot 策略代答(放逐打领跑者)
    for (let i = 0; i < 40; i++) {
      const pending = await page.evaluate(
        () => ((window as any).__dafung.getEngine().pendingSkillChoices as unknown[]).length,
      );
      if (pending === 0) break;
      if (!(await actIfCan(page))) await page.waitForTimeout(200);
    }
    // 权威留痕:驱动链代答发动(决策者=bot1)+ 目标=领跑者(座 4)+ 攒怒归零;
    // 窗对玩家零渲染(skill-choice-banner 全程不在场)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const e = (window as any).__dafung.getEngine();
          const fires = (e.log as { detail: string }[]).filter((l) =>
            l.detail.includes("skillChoiceFire"),
          );
          return {
            fangzhu: fires.some(
              (l) => l.detail.includes("skill=fangzhu") && l.detail.includes("target=p3"),
            ),
            marks:
              (e.players[1].heroes as { heroId: string; marks?: Record<string, number> }[]).find(
                (h) => h.heroId === "caopi",
              )?.marks?.fangzhu ?? 0,
          };
        }),
      )
      .toEqual({ fangzhu: true, marks: 0 });
    expect(await page.getByTestId(TESTIDS.skillChoiceBanner).count()).toBe(0); // bot 窗零挂卡
    await waitSettled(page);
  });
});
