// 出牌指示线(#281 P2-E,#234 spec):军师幕出牌后,棋盘出现「使用者 token → 目标
// token」水墨墨线(fx-svg-jline,BoardFxLayer 渲染进 #bv-fx;三段 CSS 动画 200ms
// 生长 → 200ms 停持 → 300ms 淡出,store 清理窗随 E2E_TIME_SCALE 缩放)。
// 指示线是条件性在场的瞬态元素:禁 locator 读(缺元素会挂到超时),全程单次
// page.evaluate 内 rAF 轮询原子采样(仓库既有口径,#272)。反应窗出牌(识破/拦停)
// 的留痕形状已由 test/reaction-window.test.ts 在引擎层钉死;联机端同款线经快照
// lastJinnangPlay.seq diff 提取(#284),由 react-reaction-online.spec.ts 覆盖。
import { test, expect } from "./fixtures";
import { force, startSolo } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 给 bot 1 挪一座 1 级非都城:火烧连营的目标守卫(demolishTargetOk)要求「有 Lv>0
 *  可降或有非都城城」,开局各座只有都城不达标——不种则目标段无候选席位。 */
async function plantBotCity(page: Page): Promise<void> {
  await force(
    page,
    `
    {
      const capitals = new Set(e.players.map((p) => p.capitalIndex));
      let idx = -1;
      for (let k = 1; k < e.board.count - 1; k++) {
        const c = (e.players[0].capitalIndex + k) % e.board.count;
        const t = e.board.at(c);
        if (t?.propertyId && !capitals.has(c) && !e.findOwner(t.propertyId)) { idx = c; break; }
      }
      if (idx < 0) throw new Error("种植失败:无可挪城池格");
      const pid = e.board.at(idx).propertyId;
      e.players[1].properties.push({
        propertyId: pid, group: e.board.at(idx).group ?? "a",
        purchasePrice: 1000, level: 1, maxLevel: 3,
      });
    }
  `,
  );
}

test.describe("出牌指示线(#281 P2-E)", () => {
  test("军师幕出牌:火烧连营指定后,棋盘出现使用者→目标墨线,端点对准双方棋子", async ({ page }) => {
    await startSolo(page);
    // 种植:人类持火烧连营 + bot 1 有一座可拆城;清他座反应牌(不开反应窗,线在宣告点即出)
    await plantBotCity(page);
    await force(
      page,
      `
      e.players[0].jinnangHand = ["火烧连营"];
      e.players[0].jinnangHandCount = 1;
      for (let i = 1; i < e.players.length; i++) {
        e.players[i].jinnangHand = e.players[i].jinnangHand.filter(
          (id) => id !== "识破诡计" && id !== "半路杀出");
        e.players[i].jinnangHandCount = e.players[i].jinnangHand.length;
      }
    `,
    );
    await expect(page.getByTestId(TESTIDS.jinnangCard("火烧连营"))).toBeEnabled();
    // 点牌选中 → 出牌进目标段 → 席位点层点候选目标(点席位即出,免二次确认)
    await page.getByTestId(TESTIDS.jinnangCard("火烧连营")).click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    const targetBtn = page.locator('[data-testid^="seat-target-"]').first();
    await expect(targetBtn).toBeVisible({ timeout: 15_000 });
    const targetTestid = await targetBtn.getAttribute("data-testid");
    const targetSeat = Number(targetTestid?.replace("seat-target-", ""));
    expect(Number.isInteger(targetSeat)).toBe(true);

    // 单次 evaluate 原子采样:rAF 轮询等指示线现身,现身即在同一样本里取端点并
    // 从引擎现算期望坐标(火烧连营不动人,出牌前后棋盘坐标一致)。15s 封顶防死等。
    const samplePromise = page.evaluate(`(async () => {
      const deadline = performance.now() + 15000;
      let el = null;
      while (performance.now() < deadline) {
        el = document.querySelector("[data-fx-jinnang-line]");
        if (el) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      const e = window.__dafung.getEngine();
      if (!el) return { found: false };
      const b = e.board;
      return {
        found: true,
        x1: Number(el.getAttribute("x1")),
        y1: Number(el.getAttribute("y1")),
        x2: Number(el.getAttribute("x2")),
        y2: Number(el.getAttribute("y2")),
        from: b.positionOf(e.players[0].position),
        to: b.positionOf(e.players[${targetSeat}].position),
      };
    })()`);
    await targetBtn.click();
    const sample = (await samplePromise) as {
      found: boolean;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    };
    expect(sample.found).toBe(true);
    // 端点对准:起点=使用者格,终点=被指定者格
    expect(sample.x1).toBe(sample.from!.x);
    expect(sample.y1).toBe(sample.from!.y);
    expect(sample.x2).toBe(sample.to!.x);
    expect(sample.y2).toBe(sample.to!.y);
    // 收尾:对局继续推进(bot 回合接棒),不留悬窗——等人类下一决策点出现即可
    await expect
      .poll(async () => page.evaluate(`window.__dafung.getEngine().turnPhase`), { timeout: 30_000 })
      .not.toBe("AwaitingJinnang");
  });
});
