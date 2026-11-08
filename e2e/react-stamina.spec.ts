// 体力系统冒烟(#134):确定性设计——不走机遇随机抽取,直接经引擎公共入口
// (addStamina/exhaustIfDepleted)置耗竭态,验证 UI 链路:耗竭卷轴弹出 → 自选降级 →
// 体力回 100 + 跳回合标记 + 侧栏体力渲染。机遇→体力的规则正确性在引擎单测覆盖。
// #423 项8:改 #421 冻结手术口径(waitMyPause 停靠 → clockPause 钉死 → 种植 → 手术
// → 断言 → clockResume)——旧口径的残余抖动根因(waitMyPause 注释点名)是种植/触发
// 与自动推进的竞速:冻结后种植落在钉死的静止态,卷轴出现不再依赖「手快」。
// 点击后的断言面走结算留痕:耗竭收尾 endTurn 同步放出 bot 链(#421 诊断:冻结只钉
// 看门狗节拍、钉不住 delay=0 的链步进),活态直读属与链的竞速——以留痕在场 poll 作
// 「点选项→处置命令落账」的接线证据兼结算完成同步。#1181 棒一缩:结算字段断言
// (降 1 级/skipTurns/stamina)与都城地板/体力夹紧两处活读已由 test/stamina.test.ts
// 钉死,随删(详见例内注)。
// #1217 波4 直通形制(ADR-0058):真实段=耗竭卷轴弹出→自选降级→结算留痕→体力条
// 回满渲染全真;前置链种局化——旅程开局链(首页→设置屏→起兵→选都)换 quickStart
// 种局直达首停靠(seed 1486 开局即停谱),耗竭前置直写判词见例内。
// #1221 L1 残油包:改 quickStart({advance:"preRoll"})——耗竭布场不依赖行军日志/
// 已推进回合,落都即冻结,停靠/稳定/冻结三连(waitMyPause/waitSettled/freezeClock)
// 随通路退役(#423 项8 的「种植落在钉死静止态」由 preRoll 返回态直接给出)。
import { test, expect } from "./fixtures";
import { quickStart, waitSettled, snap, unfreezeClock, engineState } from "./react-helpers";
import { callEngine, plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

test.describe("体力系统冒烟", () => {
  // 真实段(波4 #1217):耗竭卷轴弹出 → 自选降级点击 → exhaustionSettle 留痕落账 →
  // 体力条回满渲染的 UI 链全真;耗竭入口 exhaustIfDepleted=引擎公共方法真触发。
  test("体力耗竭:卷轴弹出、自选降级、体力条回满渲染", async ({ page }) => {
    // 前置种局(#1217 波4 旅程开局链退役;#1221 L1):preRoll 落都即冻结——第 1 回合
    // 人类回合、未掷骰、时钟已冻,停靠/稳定/冻结三连随通路退役(见文件头注)
    await quickStart(page, 1486, { advance: "preRoll" });
    try {
      // 耗竭前置授产已迁 grantProperty 种植件(#1300,判词单源 src/core/planter.ts:城池
      // 等级只随建造/升级/降级结算变动,「指定格 N 级城」生产到不了;行形状单源
      // PropertyHolding,group/maxLevel 自城目录派生——旧手写 `?? "a"`/`purchasePrice
      // ?? 1000` 兜底随收编退役)。都城持仓哨兵保留(#226 回归直读断言,非种植);都城
      // 升 1 级=upsert 改等级形,耗竭选项序=properties 序,都城恒在前。冻结期种植:
      // 无自动推进可竞速。体力压 0 已迁 setStamina 种植件(#1299,薄包 addStamina
      // 唯一写口,终态语义)。
      const seat: number = await engineState(page, "e.activeIndex");
      const seedIds = await page.evaluate((seat) => {
        const e = (window as any).__dafung.getEngine();
        const taken = new Set(
          e.players.flatMap((pl: any) => pl.properties.map((h: any) => h.propertyId)),
        );
        const tile = e.board.tiles.find(
          (t: any) => t.type === "Property" && t.propertyId && !taken.has(t.propertyId),
        );
        const p = e.players[seat];
        const capPropId = e.board.tiles[p.capitalIndex].propertyId;
        if (!p.properties.some((h: any) => h.propertyId === capPropId))
          throw new Error("都城持仓缺失:开局双写不一致(#226 回归)");
        return { target: tile.propertyId as string, capPropId: capPropId as string };
      }, seat);
      await plant(page, { kind: "grantProperty", seat, propertyId: seedIds.target, level: 2 });
      await plant(page, { kind: "grantProperty", seat, propertyId: seedIds.capPropId, level: 1 });
      await plant(page, { kind: "setStamina", seat, stamina: 0 }); // → 0

      // 直呼走 callEngine(#1302:只承载引擎公共方法调用,字段直写归种植件)——
      // exhaustIfDepleted=引擎公共入口(文件头注),无引擎到不了的改写;封装的 sync
      // 重灌派生量(快照与 interactive 一起刷,决策卷轴才按新相位弹出;冻结期相位
      // 无人抢,出现即真)。
      await callEngine(page, "exhaustIfDepleted", [seat]);
      try {
        await expect(page.getByTestId(SCROLL_TESTIDS.exhaustionScroll)).toBeVisible({
          timeout: 15_000,
        });
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
      await expect(page.getByTestId(SCROLL_TESTIDS.exhaustionScroll)).toBeHidden({
        timeout: 15_000,
      });
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
            return line == null
              ? null
              : { brief: line.brief as string, detail: line.detail as string };
          },
          { logLen: logLenBefore },
        );
      // #1181 棒一缩:结算字段断言(「都城名」降 1 级/skipTurns=1/stamina=100)与
      // 活读结算面(都城地板 0、体力夹紧 100)已由 test/stamina.test.ts「惩罚结算:
      // 降 1 级 + skipTurns+1 + 体力重置 100」「都城规则:可降级、地板 0 级」钉死,
      // 删已迁断言;留痕在场 poll 保留 = 点降级选项→耗竭处置命令落账的接线证据
      //(兼结算完成同步,UI 渲染断言的前提)。
      await expect
        .poll(readSettle, { timeout: 15_000, message: "exhaustionSettle 结算留痕落账" })
        .toBeTruthy();

      await waitSettled(page); // UI 渲染断言前等表现链走完
      // 体力上仪表(#253 迁移;#700 仪表条退役,体力条在自机格:满值=色条满宽 100%)
      const staminaFill = page.getByTestId(TESTIDS.seatStamina(0)).locator(".strack i");
      await expect(staminaFill).toHaveAttribute("style", /width:\s*100%/);
    } finally {
      await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
    }
  });
});
