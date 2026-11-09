// 地板名册(ADR-0062):地板·几何钉×1(满编 8 席格高 38/列零滚动=几何)
// 席位格列(#698 席位条重形:96×38 双行八项格)——满编 8 席格高 38/列零滚动几何例
// (地板·几何钉,ADR-0062 名册,永留浏览器)。
// 【#1316 批T2 迁 4 例(5→1)】「4 席计数对账(cellsMatchSnapshot 语义)」「五状态+
// 自机挂点」「托管微标开关」「目标段候选/停持」迁入接线层 test/overview-wiring
// .test.tsx「席位格接线」组(断言面=投影逐席对账/类名挂点/微标 DOM 有无/目标段
// 类名,零几何零演出泵,判词在该文件头注);本文件存例只剩满编 8 席的格高钳制与
// 零滚动盒模型几何(假 DOM 无排版引擎,不可下放)。
// 旧席位卡形态退役核销例已删(2026-11-07 菜单A,原 ③):#698 翻面已久,纯零残留
// 核销断言价值衰减,宁缺毋滥整删(原 ④ 托管微标升 ③)。
import { test, expect } from "../fixtures";
import { quickStart } from "../react-helpers";
import { TESTIDS } from "../../src/app/screens/game/testids";

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

test.describe("满编 8 席几何(844×390 矮横屏;#698 ① 几何钉)", () => {
  // 到站形制(#1328 批T5 到站轴):quickStart(…, seats:8) 席位旋钮构造器到站(preRoll
  // 落都即冻)替代「设置屏 8 席点击链+waitMyPause 等 7 bot 链」——8 席配置=桥参数化
  // (旋钮校验 2–8 整数,单源 registry.seedSolo),设置屏 8 席通路另有脊柱①旅程例守
  // (react-home-strip);桌面视口开局→切矮横屏的视口切换重排路径保留=被测环一部分。
  // 被测环不变:格高/零滚动盒模型真实重排几何——零种植(preRoll 冻结为到达手段)。
  // 计数逐席一致作挂载健康自证(几何断言的采样拍对账,非独立断言例——独立对账例
  // 已迁接线层,#1316)。
  test("满编 8 席(844×390 矮横屏):计数逐席一致,格高 38、列零滚动", async ({ page }) => {
    test.slow(); // 预算余量(8 席种局+视口重排;构造器到站后无 bot 链等待,墙钟已回落)
    await quickStart(page, undefined, { seats: 8, advance: "preRoll" });
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
