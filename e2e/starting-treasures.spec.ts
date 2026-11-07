// 起手珍宝开局面冒烟(#1100/#1101):默认图(关中图,startingTreasures=2)开局 finishSetup
// 即按座位序每人发 2 件不同款 1 级珍宝。断言两件套:
// ① 对局日志 setup 汇总行(brief「起手珍宝:国号得 A、B;…」+ 机读 detail
//    `startingTreasures perSeat=…` 逐席两件、人内不同款,且与各席实际持有同名);
// ② 席位条珍宝计数 aria-label=「珍宝 2」(SeatRail 单源,#1112 席位格退役后形态);
// ③ 落他人城交涉(#1170 评审追加):起手珍宝使「城主有宝」开局恒真——访客落他人城
//    必触发珍宝交涉停靠(AwaitingTreasureOwner,等城主抉择),用种植式走通(下见用例注)。
// 种植式纪律:纯开局态断言,不走真实对局随机路径——钉 seed 保确定,quickStart 停靠后
// 按冻结闸配方(#987:waitFxIdle→freezeClock)停摆对局再断言,防 bot 自走窃玉漂移。
// 配方出处:quickStart/冻结闸照抄 react-scrolls.spec;计数断言照抄 react-seat-cells.spec;
// force position+行军(#1170 评审追加用例)照 react-reaction plantAmbush 的位移种植口径。
// 真实段(ADR-0058)(波5b #1218 标注):两例断言面全真(单机,fixtures 默认 test)——
// ①开局日志汇总行+逐席计数=finishSetup 真实发放的呈现取证;②交涉停靠=一次 force 内
// 钉死一场真实行军(直调 rollAndMove 走 marchTraverse→settleMarchLanding→
// resolveLanding 引擎真链),AwaitingTreasureOwner 引擎真停+decisionOwner 真投影即被测
// 环。force 判词(②):行军前提无公共命令(行军命令只归活跃座位自身回合)——访客
// 摆位/行程骰=环距直写与 patch dice.roll 是确定性到达,落格结算本体不种;清人类手牌
// 防拦检窗岔路同因。冻结闸(waitFxIdle→freezeClock)是到达手段。
import { test, expect } from "./fixtures";
import { quickStart, snap, waitFxIdle, freezeClock, force } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

test("起手珍宝:开局日志汇总行 + 逐席珍宝计数 2(默认图)", async ({ page }) => {
  await quickStart(page, 1101);
  await waitFxIdle(page);
  await freezeClock(page);
  const s = await snap(page);
  // ① 对局日志汇总行:brief 与机读 detail 同源一行(category=setup)
  const line = s.log.find(
    (e: { category: string; brief: string }) =>
      e.category === "setup" && e.brief.startsWith("起手珍宝:"),
  );
  expect(line, "开局日志含「起手珍宝:」setup 汇总行").toBeTruthy();
  const perSeat: string[][] = JSON.parse(
    (line as { detail: string }).detail.replace(/^startingTreasures perSeat=/, ""),
  );
  expect(perSeat).toHaveLength(s.players.length);
  for (const seat of perSeat) {
    expect(seat).toHaveLength(2); // 每人 2 件
    expect(new Set(seat).size).toBe(2); // 人内不同款
  }
  // 机读行与实际持有同源:逐席珍宝名 = perSeat 发放名单
  for (let seat = 0; seat < s.players.length; seat++) {
    expect(s.players[seat].treasures.map((t: { name: string }) => t.name).sort()).toEqual(
      [...perSeat[seat]!].sort(),
    );
  }
  // ② 席位条:逐席珍宝计数 aria =「珍宝 2」(开局态,全员同数)
  for (let seat = 0; seat < s.players.length; seat++) {
    await expect(page.getByTestId(TESTIDS.seatAttr(seat, "gem"))).toHaveAttribute(
      "aria-label",
      "珍宝 2",
    );
  }
});

test("起手珍宝:访客落他人城触发珍宝交涉停靠(AwaitingTreasureOwner,城主有宝恒真)", async ({
  page,
}) => {
  // 种植式走通(#1170 评审追加,force position+行军配方):quickStart 停靠开局态后冻结,
  // 一次 force 内钉死一场真实行军——访客(bot 1)挪到人类都城前一格、钉其行程骰=与都城
  // 环距(构造值=1)、置 Roll 相位后直调 e.rollAndMove() 走真实落格链(marchTraverse→
  // settleMarchLanding→resolveLanding)。落他人城 + 城主(人类)持起手珍宝 2 件 >0
  // → 引擎停 AwaitingTreasureOwner 等城主抉择。刻意不走「放行停靠点交 bot 链」:
  // 驱动链对人类回合自动起摇/体力跳过会自由推进,停靠点会漂到任意轮次、钉骰补丁会被
  // 错位掷骰者消费(#1170 探针实锤,abort 即「驱动链异常」);冻结+直调行军把落格
  // 钉死在本次 evaluate 内,零竞速。清人类手牌去半路杀出,防途经都城开拦检窗岔路。
  await quickStart(page, 1101);
  await waitFxIdle(page);
  await freezeClock(page);
  await force(
    page,
    `
    e.players[0].jinnangHand = [];
    e.activeIndex = 1;
    e.turnPhase = "Roll";
    const n = e.board.count;
    e.players[1].position = (e.players[0].capitalIndex + n - 1) % n;
    (() => {
      const o = e.dice.roll.bind(e.dice);
      e.dice.roll = () => {
        const m = e.activePlayer;
        e.dice.roll = o;
        const d = (e.players[0].capitalIndex - m.position + n) % n;
        if (d < 1 || d > 6) throw new Error("交涉种植失败:与人类都城环距越界 dist=" + d);
        return { die: d };
      };
    })();
    e.rollAndMove();
  `,
  );
  // 交涉窗升起:停相位等城主抉择(decisionOwner=城主=人类),城主持宝 ≥1(起手 2 件)。
  await expect
    .poll(async () => (await snap(page)).turnPhase, { timeout: 15_000 })
    .toBe("AwaitingTreasureOwner");
  const s = await snap(page);
  expect(s.decisionOwner, "交涉窗等城主(人类)抉择").toBe(0);
  expect(
    s.players[0].treasures.length,
    "城主侧珍宝 ≥1(起手珍宝使「城主有宝」开局恒真)",
  ).toBeGreaterThanOrEqual(1);
});
