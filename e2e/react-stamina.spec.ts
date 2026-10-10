// 体力系统冒烟(#134):确定性设计——不走机遇随机抽取,直接经引擎公共入口
// (addStamina/exhaustIfDepleted)置耗竭态,验证 UI 链路:耗竭卷轴弹出 → 自选降级 →
// 体力回 100 + 跳回合标记 + 侧栏体力渲染。机遇→体力的规则正确性在引擎单测覆盖。
// #423 项8:改 #421 冻结手术口径(waitMyPause 停靠 → clockPause 钉死 → 种植 → 手术
// → 断言 → clockResume)——旧口径的残余抖动根因(waitMyPause 注释点名)是种植/触发
// 与自动推进的竞速:冻结后种植落在钉死的静止态,卷轴出现不再依赖「手快」。
// 点击后的断言面走结算留痕:耗竭收尾 endTurn 同步放出 bot 链(#421 诊断:冻结只钉
// 看门狗节拍、钉不住 delay=0 的链步进),活态直读属与链的竞速——降级落地改从结算
// 日志行断言(brief 携处置明细「「城名」降 1 级」、detail 携 skipTurns/stamina 结算
// 瞬间值,链上不可变);都城等级与体力两处活读链安全:demolish/耗竭两路都城可降
// 不可失、0 为地板,体力 100 夹紧免疫链上治疗——保留直读。
import { test, expect } from "./fixtures";
import {
  openSoloSetup,
  pickCapital,
  waitSettled,
  waitMyPause,
  snap,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";

test.describe("体力系统冒烟", () => {
  test("体力耗竭:卷轴弹出、自选降级、体力回 100、跳回合、侧栏渲染", async ({ page }) => {
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    // 等轮到人类且停稳(#188:Roll 等待态只存在 ~1s,停靠点改为非 Roll 等待态)
    await waitMyPause(page, 0);
    await waitSettled(page);
    await freezeClock(page); // 钉死停靠态:种植/触发/卷轴断言全程静止(#423 项8)
    try {
      // 前置(引擎直写):都城压到 1 级 + 添一座 2 级房产(耗竭选项 = 2,走卷轴不自动),
      // 体力压到 0。都城持仓直读断言(#226 已修:都城持仓恒在,无自愈兜底)。
      // 冻结期种植:无自动推进可竞速;城名一并带回(结算日志 brief 按城名对账)。
      const seatInfo = await page.evaluate(() => {
        const e = (window as any).__dafung.getEngine();
        const seat = e.activeIndex;
        const p = e.players[seat];
        const taken = new Set(
          e.players.flatMap((pl: any) => pl.properties.map((h: any) => h.propertyId)),
        );
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
        const capital = p.properties.find((h: any) => h.propertyId === capPropId);
        if (!capital) throw new Error("都城持仓缺失:开局双写不一致(#226 回归)");
        capital.level = 1; // 耗竭选项序 = properties 序,都城恒在前
        e.addStamina(seat, -100); // → 0
        const nameOf = (id: string) =>
          e.board.tiles.find((t: any) => t.propertyId === id)?.name ?? id;
        return {
          seat,
          capitalPropId: capPropId,
          capitalName: nameOf(capPropId) as string,
        };
      });

      // 触发耗竭入口 → 相位(直改引擎后必须走控制器 sync:快照与 interactive 派生量
      // 一起重灌,决策卷轴才按新相位弹出;冻结期相位无人抢,出现即真)
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

      // 日志基线在点击前取(冻结期读数稳定):点击后 slice 基线起找结算留痕
      const logLenBefore = (await snap(page)).log.length;

      // 自选:降都城(选项序 = properties 序,都城在前)
      await page.locator('[data-testid^="scroll-exhaustion-option-"]').first().click();
      await expect(page.getByTestId("scroll-exhaustion")).toBeHidden({ timeout: 15_000 });
      // 断言面走结算留痕(#423 项8):耗竭结算在命令内同步落账,收尾 endTurn 同步放出
      // bot 链(冻结钉不住 delay=0 链步进,#421 诊断)——链上他人回合可正当再拆本方城
      // (火烧连营/周瑜火攻:extraLevel/owned 属竞速读数,不作断言;降级落地与跳回合
      // 记账以结算日志行为凭:brief=「城名」降 1 级处置明细,detail=skipTurns/stamina
      // 结算瞬间值;降级算术由引擎单测钉死,e2e 不与链竞速复核)。
      const readSettle = () =>
        page.evaluate(
          (info: { logLen: number }) => {
            const e = (window as any).__dafung.getEngine();
            const line = e.log
              .slice(info.logLen)
              .find((l: any) => l.detail.includes("exhaustionSettle"));
            return line == null ? null : { brief: line.brief as string, detail: line.detail as string };
          },
          { logLen: logLenBefore },
        );
      await expect
        .poll(readSettle, { timeout: 15_000, message: "exhaustionSettle 结算留痕落账" })
        .toBeTruthy();
      const settle = (await readSettle())!;
      expect(settle.brief).toContain(`「${seatInfo.capitalName}」降 1 级`); // 选中的是都城降级
      expect(settle.detail).toContain("skipTurns=1"); // 跳过下一回合(+1,结算落账)
      expect(settle.detail).toContain("stamina=100"); // 体力重置(结算落账)

      // 链安全活读(结算已落账):都城 0 为地板、可降不可失;体力 100 夹紧免疫链上治疗
      const live = await page.evaluate(
        (info: { seat: number; capitalPropId: string }) => {
          const e = (window as any).__dafung.getEngine();
          const p = e.players[info.seat];
          return {
            stamina: p.stamina,
            capitalLevel: p.properties.find((h: any) => h.propertyId === info.capitalPropId)
              ?.level,
          };
        },
        seatInfo,
      );
      expect(live.capitalLevel).toBe(0); // 1 → 0(选中降级,地板 0)
      expect(live.stamina).toBe(100); // 重置

      await waitSettled(page); // UI 渲染断言前等表现链走完
      // 体力上仪表(#253 迁移:侧栏退役,体力血条驻留底部仪表条,数值刻在条内)
      await expect(page.getByTestId("dash-stamina")).toBeVisible();
      await expect(page.getByTestId("dash-stamina")).toHaveText("100");
    } finally {
      await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
    }
  });
});
