// 体力系统冒烟(#134):确定性设计——不走机遇随机抽取,直接经引擎公共入口
// (addStamina/exhaustIfDepleted)置耗竭态,验证 UI 链路:耗竭卷轴弹出 → 自选降级 →
// 体力回 100 + 跳回合标记 + 侧栏体力渲染。机遇→体力的规则正确性在引擎单测覆盖。
import { test, expect } from "./fixtures";
import { openSoloSetup, pickCapital, waitSettled, waitMyPause } from "./react-helpers";

test.describe("体力系统冒烟", () => {
  test("体力耗竭:卷轴弹出、自选降级、体力回 100、跳回合、侧栏渲染", async ({ page }) => {
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    // 等轮到人类且停稳(#188:Roll 等待态只存在 ~1s,停靠点改为非 Roll 等待态)
    await waitMyPause(page, 0);
    await waitSettled(page);

    // 前置(引擎直写):都城压到 1 级 + 添一座 2 级房产(耗竭选项 = 2,走卷轴不自动),
    // 体力压到 0。都城持仓缺失时补建(⚠ 既有引擎异常,偶发于开局选都后:钱已扣、持仓
    // 未落——master 同现,与 #188 无关,待单独立票;此处只为布场自洽)。
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
      const capPropId = e.board.tiles[p.capitalIndex].propertyId;
      let capital = p.properties.find((h: any) => h.propertyId === capPropId);
      if (!capital) {
        capital = { propertyId: capPropId, group: "a", purchasePrice: 1000, level: 0, maxLevel: 3 };
        p.properties.unshift(capital); // 耗竭选项序 = properties 序,都城恒在前
      }
      capital.level = 1;
      const skipBefore = p.skipTurns; // #188:对局自走可能已带辅路中伏等既有跳过,断言改相对值
      e.addStamina(seat, -100); // → 0
      return { seat, capitalPropId: capPropId, extraPropId: tile.propertyId, skipBefore };
    });

    // 触发耗竭入口 → 相位(直改引擎后必须走控制器 sync:快照与 interactive 派生量
    // 一起重灌,决策卷轴才按新相位弹出)
    await page.evaluate((seatNum: number) => {
      const e = (window as any).__dafung.getEngine();
      e.exhaustIfDepleted(seatNum);
      (window as any).__dafung.controller().sync();
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
    // 立即读引擎(#188 迁移):耗竭结算在命令内同步落账,而 auto-roll 重武装有 1s 窗——
    // 若先 waitSettled,对局可能自走一整轮,随机机遇可二次抽干体力触发第二次耗竭
    // (skipTurns +2、体力再次重置,断言全盘失真)。
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
    await waitSettled(page); // UI 渲染断言前等表现链走完
    expect(after.stamina).toBe(100); // 重置
    expect(after.skipTurns).toBe(seatInfo.skipBefore + 1); // 跳过下一回合(+1,相对既有值)
    expect(after.capitalLevel).toBe(0); // 1 → 0(选中降级,地板 0)
    expect(after.extraLevel).toBe(2); // 未被选中不受影响
    expect(after.owned).toBe(2); // 降级不失城

    // 侧栏渲染体力(状态卡/诸侯列表)
    await expect(page.getByText(/体力/).first()).toBeVisible();
  });
});
