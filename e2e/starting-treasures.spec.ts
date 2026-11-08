// 起手珍宝开局面冒烟(#1100/#1101):默认图(关中图,startingTreasures=2)开局 finishSetup
// 即按座位序每人发 2 件不同款 1 级珍宝。断言两件套:
// ① 对局日志 setup 汇总行(brief「起手珍宝:国号得 A、B;…」+ 机读 detail
//    `startingTreasures perSeat=…` 逐席两件、人内不同款,且与各席实际持有同名);
// ② 席位条珍宝计数 aria-label=「珍宝 2」(SeatRail 单源,#1112 席位格退役后形态)。
// 种植式纪律:纯开局态断言,不走真实对局随机路径——钉 seed 保确定,quickStart 停靠后
// 按冻结闸配方(#987:waitFxIdle→freezeClock)停摆对局再断言,防 bot 自走窃玉漂移。
// 配方出处:quickStart/冻结闸照抄 react-scrolls.spec;计数断言照抄 react-seat-cells.spec。
// 真实段(ADR-0058)(波5b #1218 标注):断言面全真(单机,fixtures 默认 test)——
// 开局日志汇总行+逐席计数=finishSetup 真实发放的呈现取证。
// 原 ③「访客落他人城触发珍宝交涉停靠」已删(2026-11-08 唯一守环审计):断言面零 DOM,
// 三条断言逐条有无头同款——treasure.test「落他人珍宝城:探宝先于交涉窗口」守相位链、
// game.test「AwaitingTreasureOwner = 城主座位」守 decisionOwner 投影、starting-treasures.test
// 守「城主有宝」恒真前提;浏览器侧交涉回路由 react-midgame-constructor「bot 城主代打」例守。
import { test, expect } from "./fixtures";
import { quickStart, snap, waitFxIdle, freezeClock } from "./react-helpers";
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
