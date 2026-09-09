// ADR-0014 重放自证:内存跑完整对局(全 bot 局 + 带 pickCapital 的人类局)→ 用引擎
// log 生成日志 → replayGameLog 重建重放 → assertFinalState 逐字段比对终态。
// 全 bot 局零 cmd 行(整局由 botAct 确定性重演);人类局的选都/玩法命令全走 cmd 流。
import { describe, it, expect } from "bun:test";
import { GameEngine, type SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import { loadMap } from "@core/board-loader";
import type { LogEvent } from "@core/types";
import { replayGameLog, assertFinalState } from "../scripts/replay-log";
import sanguoData from "../public/maps/sanguo.json";

const MAP = loadMap(sanguoData);
/** 速战目标:终局快但仍是完整对局(胜负判定/终局行都走真路径)。 */
const TARGET = 15000;

const BOT_SEATS: SeatConfig[] = [
  { name: "A", isBot: true, guohao: "魏" },
  { name: "B", isBot: true }, // 国号留空:走 doDraftRoll 随机分配路径(局头座位规格复刻的关键面)
  { name: "C", isBot: true, guohao: "吴" },
];

function makeEngine(seats: SeatConfig[], seed: number): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats,
    targetNetWorth: TARGET,
    mapId: "sanguo",
  });
}

/** 选都推进:bot 座位 aiSetupStepFor(不产生 cmd 行),人类座位公共 pickCapital(记 cmd 行)。 */
function driveSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const seat = e.currentSetupPlayerIndex;
    if (seat < 0) break;
    if (e.players[seat].isBot) e.aiSetupStepFor(seat);
    else e.pickCapital(seat, e.offeredCapitals[0]);
  }
}

/** 固定策略的「笨人类」:全部决策走 submitCommand(产生 cmd 行),选择固定无随机。 */
function dumbHumanCommand(e: GameEngine): boolean {
  switch (e.turnPhase) {
    case "Roll":
      e.submitCommand({ type: "rollAndMove" });
      return true;
    case "AwaitingBranch":
      e.submitCommand({ type: "selectBranch", kind: "Main" });
      return true;
    case "AwaitingJinnang":
      // 锦囊(#122/T2):笨人类恒「今不用」,cmd 行(useJinnang)照记照重放
      e.submitCommand({ type: "useJinnang", cardId: null });
      return true;
    case "AwaitingDecision":
      e.submitCommand({ type: "endDecision" });
      return true;
    case "AwaitingHeroPick":
      e.submitCommand({ type: "resolveHeroPick", index: 0 });
      return true;
    case "AwaitingTreasureOwner":
      e.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });
      return true;
    case "AwaitingBankruptcySettle":
      e.submitCommand({ type: "confirmBankruptcySettle" });
      return true;
    default:
      return false; // Land/EndTurn 等引擎内部过渡相位:不应停留
  }
}

/** 跑完 Playing 阶段:bot 座位 botAct,人类座位 dumbHumanCommand。 */
function drivePlaying(e: GameEngine): void {
  let guard = 0;
  while (!e.isOver && guard++ < 20_000) {
    if (e.phase !== "Playing") break;
    if (e.players[e.decisionOwner].isBot) botAct(e);
    else if (!dumbHumanCommand(e)) break;
  }
}

describe("ADR-0014 重放自证:生成日志 → 重放 → 终态逐字段一致", () => {
  it("全 bot 局:零 cmd 行,整局 botAct 确定性重演", () => {
    const e = makeEngine(BOT_SEATS, 20260826);
    driveSetup(e);
    drivePlaying(e);
    expect(e.isOver).toBe(true);
    const lines: LogEvent[] = [...e.log];
    expect(lines[0].category).toBe("header"); // 局头是首行
    expect(lines.some((l) => l.category === "cmd")).toBe(false); // bot 路径不产生命令行
    expect(lines.some((l) => l.category === "final")).toBe(true);

    const replayed = replayGameLog(lines);
    const fin = assertFinalState(lines, replayed);
    expect(fin.round).toBe(e.round);
    expect(fin.turnNumber).toBe(e.turnNumber);
  });

  it("带 pickCapital 的人类局:选都/玩法命令全走 cmd 流重放", () => {
    const seats: SeatConfig[] = [
      { name: "真人", isBot: false, guohao: "魏" },
      { name: "bot", isBot: true },
      { name: "bot2", isBot: true, guohao: "吴" },
    ];
    const e = makeEngine(seats, 42);
    driveSetup(e);
    drivePlaying(e);
    expect(e.isOver).toBe(true);
    const lines: LogEvent[] = [...e.log];
    // 命令流有货:选都 + 玩法命令都是 cmd 行
    expect(lines.some((l) => l.category === "cmd" && l.detail.includes('"pickCapital"'))).toBe(true);
    expect(lines.filter((l) => l.category === "cmd").length).toBeGreaterThan(5);

    const replayed = replayGameLog(lines);
    assertFinalState(lines, replayed);
    // 与原局引擎直接比对(终态三件套:现金/位置/破产)
    replayed.players.forEach((p, i) => {
      expect(p.cash).toBe(e.players[i].cash);
      expect(p.position).toBe(e.players[i].position);
      expect(p.isBankrupt).toBe(e.players[i].isBankrupt);
    });
  });

  it("同 seed 两局日志的机读层完全一致(除 ts/startedAt/gameId 等时间标识)", () => {
    const a = makeEngine(BOT_SEATS, 7);
    driveSetup(a);
    drivePlaying(a);
    const b = makeEngine(BOT_SEATS, 7);
    driveSetup(b);
    drivePlaying(b);
    const strip = (ls: LogEvent[]) =>
      ls.map(({ ts, ...rest }) => ({
        ...rest,
        detail: rest.detail
          .replace(/"gameId":"[^"]*"/g, '"gameId":""')
          .replace(/"startedAt":\d+/g, '"startedAt":0'),
      }));
    expect(JSON.stringify(strip(b.log))).toBe(JSON.stringify(strip(a.log)));
  });
});
