// 演出层矮横屏三件改(#709,#688 定案施工;#853 chip 断言迁回合胶囊口径)@667×375 矮横屏档:
// ① 反应横幅下移浮置几何——显示期横幅与右缘席位格、顶中回合胶囊零遮挡
//    (病根:#709 前横幅 abspos 收缩适配被饿成半幅,竖排字气球直探板中区;
//    修复后横幅锁架体宽度内,架体自带席位条 104px 让位 = 结构性不相侵),且
//    auto-hide 不回归(点「不用」窗收横幅即撤;超时/降噪口的权威侧回路归
//    react-reaction.spec 既有用例,本单验证跑全量演出族兜底);
// ② 拼点签面全要素入视口——双签并排(不纵叠)、整排落视口内(#709 前收缩适配
//    误触发 flex-wrap,魏签顶/滇签底双出屏);
// ③ 动作条矮横屏压高——条高 ≤36px(43.5→~30)且不压牌面决策区(下缘 ≤ 牌顶 −2),
//    上缘 ≥195 还棋盘底行可视高度;「不出」放行冒烟 = 功能零回归锚。
// 种植配方照抄 react-reaction.spec(seed 7 × huanyou 拦检链)/react-jinnang-use.spec
// (seed 63 起手横征暴敛 = 开局出牌阶段稳定停靠点);选图走 #707 矮横屏横排条带
// (home-select-map 入口在本档退役)。断言全走几何与 UI 态,零固定 sleep。
import { test, expect } from "./fixtures";
import { answerMarchCounter, force, useHalfScale } from "./react-helpers";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("演出层矮横屏三件(#709)@667×375", () => {
  test.use({ viewport: { width: 667, height: 375 } });

  /** 矮横屏选图开局(#707 条带替代二级弹层)→ 定都首候选,回停靠点:
   *  waitScroll 给定则等购地卷轴(seed 7 拦检链配方),否则等出牌阶段动作条
   *  (seed 63 起手横征暴敛恒可用,窗必升起)。 */
  async function startShort(page: Page, seed: number, waitScroll: boolean): Promise<void> {
    await useHalfScale(page);
    await page.goto(`/?seed=${seed}`);
    await page.getByTestId(HOME_TID.mapStripItem("huanyou")).click();
    await page.getByTestId(HOME_TID.solo).click();
    await page.getByTestId(SETUP_TID.screen).waitFor();
    // 机遇归零(#126 同口径):防随机机遇卷轴污染停靠点
    await page.route("**/config/jiyu.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: false, baseRates: { good: 0, neutral: 0, bad: 0 } }),
      }),
    );
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(TESTIDS.confirmCapitalOk).click();
    if (waitScroll) {
      await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
    } else {
      await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    }
  }

  /** 拦检窗种植(react-reaction.spec plantAmbush 同款精简:半路杀出 + 三 bot 落
   *  人类都城前一格,掷 ≥1 即途经开窗;duelDice=拼点骰开窗前一次种足)。 */
  async function plantAmbush(page: Page, duelDice?: [number, number]): Promise<void> {
    await force(
      page,
      `
      e.players[0].jinnangHand = ["半路杀出"];
      for (let i = 1; i < e.players.length; i++)
        e.players[i].position = (e.players[0].capitalIndex + e.board.count - 1) % e.board.count;
      ${
        duelDice
          ? `(() => {
        const o = e.dice.rollDie.bind(e.dice);
        const q = [${duelDice.join(", ")}];
        e.dice.rollDie = () => {
          const v = q.shift();
          if (q.length === 0) e.dice.rollDie = o;
          return v ?? o();
        };
      })();`
          : ""
      }
    `,
    );
  }

  /** 购地卷轴停靠点续局:授周瑜(疾行/火攻多条编排依赖)后「不取」放行,回合交
   *  bot 链——首个 bot 自都城前一格途经人类都城,拦检窗开(react-reaction.spec 同款)。 */
  async function grantZhouyuAndPass(page: Page): Promise<void> {
    await force(
      page,
      `{ const d = __dafung.heroDefs().find((h) => h.id === "zhouyu");
         e.players[0].heroes.push({ heroId: d.id, skillIds: [...d.skillPool], lastFired: {} }); }`,
    );
    await page.getByTestId(TESTIDS.actionButton("skip")).click();
  }

  test("动作条压高:条高 ≤36 不压牌面,上缘 ≥195 还棋盘底行;不出放行零回归", async ({ page }) => {
    await startShort(page, 63, false);
    const geo = await page.evaluate(
      ({ bar, cards }) => {
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          if (el == null) return null;
          const r = el.getBoundingClientRect();
          return { y: r.y, bottom: r.bottom, h: r.height, w: r.width };
        };
        return { bar: rect(bar), cards: rect(cards), vh: innerHeight };
      },
      { bar: ".actionbar", cards: ".hand-rack-hand" },
    );
    expect(geo.bar, "动作条未就位").not.toBeNull();
    expect(geo.cards).not.toBeNull();
    // 压高(#709 ③):条高 ≤36(改前 43.5);钮字未竖排(竖排气球高 >40)
    expect(geo.bar!.h).toBeLessThanOrEqual(36);
    // 不压牌面决策区:条下缘 ≤ 牌顶 −2(锚点 144 = 牌高 128+8 区底距+8 气口不动)
    expect(geo.bar!.bottom).toBeLessThanOrEqual(geo.cards!.y - 2);
    // 上缘还给棋盘:条顶 ≥195(改前 187.5;375 − 144 − 30 ≈ 201)
    expect(geo.bar!.y).toBeGreaterThanOrEqual(195);
    // 功能冒烟(#681 处置不变:动作条=相位件):「不出」放行,窗收
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeHidden();
  });

  test("反应横幅浮置:显示期与席位格、回合胶囊零遮挡;点不用窗收(auto-hide 不回归)", async ({
    page,
  }) => {
    test.slow(); // 拦检链:授将放行后等 bot 行军至都城前格开窗
    await startShort(page, 50, true); // seed 50(ADR-0034 重钉,原 7 拦检链随选都评分变更作废):定都江州、起手唯反应自动起摇落凉州购地卷轴
    await plantAmbush(page);
    await grantZhouyuAndPass(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 90_000 });
    const geo = await page.evaluate(
      ({ banner, capsule, seats }) => {
        const rect = (el: Element | null) => {
          if (el == null) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, h: r.height };
        };
        return {
          banner: rect(document.querySelector(banner)),
          capsule: rect(document.querySelector(capsule)),
          seats: [...document.querySelectorAll(seats)].map((el) => rect(el)!),
        };
      },
      {
        banner: `[data-testid="${TESTIDS.reactionBanner}"]`,
        capsule: `[data-testid="${TESTIDS.turnCapsule}"]`,
        seats: `[data-testid=${TESTIDS.seatRail}] .seat`,
      },
    );
    expect(geo.banner, "横幅在断言前已收回(窗被看门狗代发)").not.toBeNull();
    expect(geo.seats.length).toBeGreaterThanOrEqual(4);
    // 横幅是矮横屏下的扁条不是气球(改前竖排字气球 h=142)
    expect(geo.banner!.h).toBeLessThanOrEqual(64);
    // 与右缘席位格零遮挡:架体(手牌区)自带 104px 让位,横幅不出架体
    for (const seat of geo.seats) {
      expect(geo.banner!.right, "横幅右缘侵入席位格列").toBeLessThanOrEqual(seat.x + 0.5);
      const noOverlap =
        geo.banner!.right <= seat.x + 0.5 ||
        seat.right <= geo.banner!.x - 0.5 ||
        geo.banner!.bottom <= seat.y + 0.5 ||
        seat.bottom <= geo.banner!.y - 0.5;
      expect(noOverlap, "横幅与席位格矩形相交").toBe(true);
    }
    // 与回合胶囊零遮挡(#853 chip 退役,断言迁移):横幅浮置下带(架缘),几何上不可达
    expect(geo.banner!.y).toBeGreaterThanOrEqual(geo.capsule!.bottom);
    // auto-hide 不回归(#709 ①):点「不用」= 应答,窗收横幅即撤
    await banner.getByTestId(TESTIDS.reactionDecline).click();
    await expect(banner).toBeHidden({ timeout: 5_000 });
  });

  test("拼点签面入视口:双签并排整排落视口内,魏签顶/滇签底双出屏清零", async ({ page }) => {
    test.slow(); // 同拦检链 + 拼点演出全程
    await startShort(page, 50, true); // seed 50(ADR-0034 重钉,原 7 拦检链随选都评分变更作废):定都江州、起手唯反应自动起摇落凉州购地卷轴
    await plantAmbush(page, [6, 1]);
    await grantZhouyuAndPass(page);
    // 页面内原子应答(react-helpers 单源:滤 march 窗/等 fx 排空/点牌落印防互踩)——
    // 链上更早的异种窗(p2 求贤令)由其窗种过滤自然跳过
    await answerMarchCounter(page);
    const overlay = page.getByTestId(TESTIDS.duelOverlay);
    await expect(overlay).toBeVisible();
    await expect(overlay.getByTestId(TESTIDS.duelVerdict)).toHaveAttribute("data-verdict", "win", {
      timeout: 10_000,
    });
    // 大胜分级(#769):[6,1] 点差 5 ≥ blowoutMargin → overlay 挂 duel-blowout
    // (胜方点数弹跳+败方泼墨溅的 CSS 载体类;判据单源 isBlowout,此处守
    // 「事件数据→分级类」接线,弹跳/泼墨形归视觉不在此断言)。
    await expect(overlay).toHaveClass(/duel-blowout/);
    // 几何:双签并排(排高 ≤200,纵叠 would be 2×181+gap≈472)且整排落视口内;
    // 签面落定有 1.5× 钤落弹跳(toPass 吸收动画中的瞬时盒)。中缝印随首行定位
    // (#769):单行时印垂直中点=首签中点(构建拍量锚注入 top,回归守「印压两行」)。
    await expect(async () => {
      const geo = await page.evaluate(() => {
        const row = document.querySelector(".duel-signs");
        if (row == null) return null;
        const rr = row.getBoundingClientRect();
        const seal = document.querySelector(".duel-seal")?.getBoundingClientRect();
        const signs = [...document.querySelectorAll(".duel-sign")].map((el) => {
          const r = el.getBoundingClientRect();
          return { y: r.y, bottom: r.bottom, cy: r.y + r.height / 2 };
        });
        return {
          rowY: rr.y,
          rowBottom: rr.bottom,
          rowH: rr.height,
          sealCy: seal == null ? null : seal.y + seal.height / 2,
          signs,
          vh: innerHeight,
        };
      });
      expect(geo).not.toBeNull();
      expect(geo!.signs.length).toBe(2);
      expect(geo!.rowH, "双签纵叠(收缩适配误折行回归)").toBeLessThanOrEqual(200);
      expect(geo!.rowY).toBeGreaterThanOrEqual(0);
      expect(geo!.rowBottom).toBeLessThanOrEqual(geo!.vh);
      for (const s of geo!.signs) {
        expect(s.y).toBeGreaterThanOrEqual(-1);
        expect(s.bottom).toBeLessThanOrEqual(geo!.vh + 1);
      }
      // 印随首行(#769):构建拍注入 top=首签中点,单行形态印心与首签心同高(≤2px)
      expect(geo!.sealCy, "中缝印读数缺失(印未挂)").not.toBeNull();
      expect(Math.abs(geo!.sealCy! - geo!.signs[0]!.cy)).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 5_000 });
  });
});
