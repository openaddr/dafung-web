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
// 种植配方照抄 react-reaction.spec(seed 1010 × 关中 拦检链)/react-jinnang-use.spec
// (seed 67 起手求贤令恒可用 = 开局出牌阶段稳定停靠点);选图走 #707 矮横屏横排条带
// (home-select-map 入口在本档退役)。断言全走几何与 UI 态,零固定 sleep。
import { test, expect } from "./fixtures";
import { answerMarchCounter, force, quickStart, useHalfScale } from "./react-helpers";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

test.describe("演出层矮横屏三件(#709)@667×375", () => {
  test.use({ viewport: { width: 667, height: 375 } });

  /** 矮横屏开局到停靠点(#1256 到站换装):UI 选图开局链(#707 条带)换装 quickStart
   *  stopAtOpeningHand 种局式直通——桥路与旧 UI 链同 seed 同局(registry 选都口径
   *  统一),机遇隔离由 quickStart 内建;本档 667×375 视口只作用渲染断言,到站链不
   *  点任何首页/设置控件(旧链在本档要绕 #707 条带入口的包袱随之卸下)。
   *  waitScroll 给定则复核购地卷轴在挂(首停=购地抉择停靠),否则等出牌阶段动作条
   *  (起手牌可用停 AwaitingJinnang,窗必升起)。 */
  async function startShort(page: Page, seed: number, waitScroll: boolean): Promise<void> {
    await useHalfScale(page);
    await quickStart(page, seed, { mapId: "guanzhong", stopAtOpeningHand: true });
    if (waitScroll) {
      await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
    } else {
      await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    }
  }

  /** 拦检窗种植(react-reaction.spec plantAmbush 同款精简:半路杀出 + 三 bot 落
   *  人类都城前一格,掷 ≥1 即途经开窗;duelDice=拼点骰开窗前一次种足)。
   *  force 判词:手牌无公共通路(无「发指定牌」公共命令,rack 停车坪同判词),需
   *  半路杀出特定牌形;bot 落位直写=拦检开窗前提(真实走位到都城前一格不可控,种植
   *  是确定性到达);duelDice patch rollDie=拼点骰值无公共命令(引擎无「指定点差」
   *  命令),大胜分级断言需 [6,1] 点差 5。 */
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
   *  bot 链——首个 bot 自都城前一格途经人类都城,拦检窗开(react-reaction.spec 同款)。
   *  force 判词:无「授指定将」公共命令(引擎仅机遇效果 grantHero 一途),疾行/
   *  火攻多条编排依赖周瑜在麾。
   *  放行点击短重试(波5b #1218 加网):负载下单发点击被演出锁/重挂吞掉会把整链
   *  卡死在购地卷轴(answerMarchCounter 空等,「拼点签面」负载挂签名)——toPass
   *  整块重试,吞点在拍间自愈(点击幂等:skip 只在卷轴在挂时可达,onlinePickCapitals
   *  同款口径)。 */
  async function grantZhouyuAndPass(page: Page): Promise<void> {
    await force(
      page,
      `{ const d = __dafung.heroDefs().find((h) => h.id === "zhouyu");
         e.players[0].heroes.push({ heroId: d.id, skillIds: [...d.skillPool], lastFired: {} }); }`,
    );
    await expect(async () => {
      await page.getByTestId(TESTIDS.actionButton("skip")).click({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 });
  }

  // 真实段(ADR-0058):seed67 开局链真停出牌阶段(窗必升),动作条真实渲染几何
  // (压高/不压牌面/还棋盘底行)+「不出」放行真实点击收窗即被测环——零种植零冻结。
  test("动作条压高:条高 ≤36 不压牌面,上缘 ≥195 还棋盘底行;不出放行零回归", async ({ page }) => {
    await startShort(page, 67, false);
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

  // 真实段(ADR-0058):拦检窗经真实回合交出(「不取」放行)由引擎开窗,反应横幅
  // 真实浮置几何(扁条/与席位格、回合胶囊零遮挡)+「不用」真实应答收窗即被测环。
  // force 判词见 plantAmbush/grantZhouyuAndPass 注(手牌/bot 落位/授将无公共通路)。
  test("反应横幅浮置:显示期与席位格、回合胶囊零遮挡;点不用窗收(auto-hide 不回归)", async ({
    page,
  }) => {
    test.slow(); // 拦检链:授将放行后等 bot 行军至都城前格开窗
    await startShort(page, 1026, true); // seed 1026(#1100 重钓:起手发放改写骰流,原 1010 链作废,#949 同款):首回合落汉中购地卷轴停靠点
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

  // 真实段(ADR-0058):拦检窗→真实应答(answerMarchCounter 点牌应战)→拼点演出
  // 全程真实播放,签面几何(双签并排整排入视口/印随首行)+大胜分级类接线即被测环。
  // force 判词见 plantAmbush/grantZhouyuAndPass 注(手牌/落位/授将/拼点点差无公共
  // 通路)。
  test("拼点签面入视口:双签并排整排落视口内,魏签顶/滇签底双出屏清零", async ({ page }) => {
    test.slow(); // 同拦检链 + 拼点演出全程
    await startShort(page, 1026, true); // seed 1026(#1100 重钓:起手发放改写骰流,原 1010 链作废,#949 同款):首回合落汉中购地卷轴停靠点
    await plantAmbush(page, [6, 1]);
    await grantZhouyuAndPass(page);
    // 页面内原子应答(react-helpers 单源:滤 march 窗/等 fx 排空/点牌落印防互踩)——
    // 链上更早的异种窗(p2 求贤令)由其窗种过滤自然跳过
    await answerMarchCounter(page);
    const overlay = page.getByTestId(TESTIDS.duelOverlay);
    // 波5b #1218 加网:签面幕由 fx 编排挂载,负载下演出起播拍后移——可见窗 10s→15s,
    // 几何读数 toPass 5s→10s(预算加网,断言语义与阈值不变)。
    await expect(overlay).toBeVisible({ timeout: 15_000 });
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
    }).toPass({ timeout: 10_000 }); // 波5b #1218 加网:负载预算 5s→10s,阈值语义不变
  });
});
