// 体力系统冒烟(#134):确定性设计——不走机遇随机抽取,直接经引擎公共入口
// (addStamina/exhaustIfDepleted)置耗竭态,验证 UI 链路:耗竭卷轴弹出 → 自选降级 →
// 体力回 100 + 跳回合标记 + 侧栏体力渲染。机遇→体力的规则正确性在引擎单测覆盖。
import { test, expect } from "./fixtures";
import { openSoloSetup, pickCapital, waitSettled, expectRollEnabled } from "./react-helpers";

test.describe("体力系统冒烟", () => {
  test("体力耗竭:卷轴弹出、自选降级、体力回 100、跳回合、侧栏渲染", async ({ page }) => {
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    await expectRollEnabled(page); // 锦囊相位放行(#122):pickCapital 已放一次,此处防后续回合竞速
    await waitSettled(page);

    // 前置(引擎直写):都城压到 1 级 + 添一座 2 级房产(耗竭选项 = 2,走卷轴不自动),
    // 体力压到 0
    const seatInfo = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      const seat = e.activeIndex;
      const p = e.players[seat];
      const taken = new Set(e.players.flatMap((pl: any) => pl.properties.map((h: any) => h.propertyId)));
      const tile = e.board.tiles.find(
        (t: any) => t.type === "Property" && t.propertyId && !taken.has(t.propertyId),
      );
      const def = e.catalog.get(tile.propertyId);
      p.properties.push({
        propertyId: tile.propertyId,
        group: def?.group ?? "a",
        purchasePrice: def?.buildCost ?? 1000,
        level: 2,
        maxLevel: def?.maxLevel ?? 3,
      });
      const capital = p.properties.find((h: any) => h.propertyId === e.board.tiles[p.capitalIndex].propertyId)!;
      capital.level = 1;
      e.addStamina(seat, -100); // → 0
      return { seat, capitalPropId: capital.propertyId, extraPropId: tile.propertyId };
    });

    // 触发耗竭入口 → 相位(直改引擎后必须 sync,否则 UI 快照不更新)
    await page.evaluate((seatNum: number) => {
      const e = (window as any).__dafung.getEngine();
      e.exhaustIfDepleted(seatNum);
      (window as any).__dafung.sync();
    }, seatInfo.seat);
    try {
      await expect(page.getByTestId("scroll-exhaustion")).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      const dump = await page.evaluate(() => {
        const eng = (window as any).__dafung.getEngine();
        return JSON.stringify({
          phase: eng.turnPhase,
          pendingSeat: eng.pendingExhaustionSeat,
          decisionOwner: eng.decisionOwner,
          stamina: eng.players.map((p: any) => p.stamina),
          skip: eng.players.map((p: any) => p.skipTurns),
          logTail: eng.log.slice(-6).map((l: any) => `${l.brief} | ${l.detail}`),
        });
      });
      console.log("EXHAUST DUMP:", dump);
      throw e;
    }
    await expect(page.locator('[data-testid^="scroll-exhaustion-option-"]')).toHaveCount(2);

    // 自选:降都城(选项序 = properties 序,都城在前)
    await page.locator('[data-testid^="scroll-exhaustion-option-"]').first().click();
    await expect(page.getByTestId("scroll-exhaustion")).toBeHidden({ timeout: 15_000 });
    await waitSettled(page);

    // 结算断言:体力回 100、跳回合标记、都城降 1 级(1 → 0)、附城不受影响
    const after = await page.evaluate((info: { seat: number; capitalPropId: string; extraPropId: string }) => {
      const e = (window as any).__dafung.getEngine();
      const p = e.players[info.seat];
      const levelOf = (id: string) => p.properties.find((h: any) => h.propertyId === id)?.level;
      return {
        stamina: p.stamina,
        skipTurns: p.skipTurns,
        capitalLevel: levelOf(info.capitalPropId),
        extraLevel: levelOf(info.extraPropId),
        owned: p.properties.length,
      };
    }, seatInfo);
    expect(after.stamina).toBe(100); // 重置
    expect(after.skipTurns).toBe(1); // 跳过下一回合
    expect(after.capitalLevel).toBe(0); // 1 → 0(选中降级,地板 0)
    expect(after.extraLevel).toBe(2); // 未被选中不受影响
    expect(after.owned).toBe(2); // 降级不失城

    // 侧栏渲染体力(状态卡/诸侯列表)
    await expect(page.getByText(/体力/).first()).toBeVisible();
  });
});
