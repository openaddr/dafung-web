// ADR-0014 对局日志重放校验:读 jsonl → 解析局头 → loadMap + createDice(seed) + 座位
// 重建引擎 → 按序重放(人类命令来自 cmd 行;bot/接管/托管座位由 botAct/aiSetupStepFor
// 确定性重演,room 行动态调整驱动座位集)→ 与终局行(final)逐字段比对,不一致抛错/非零退出。
//
// 用法:bun scripts/replay-log.ts logs/<gameId>.jsonl [更多文件...]
// 前提:局头 mapId 必须是内置地图(public/maps 清单内);编辑器试玩等无 id 的局不可重放(显式报错)。
import { readFileSync } from "node:fs";
import { GameEngine, type EngineConfig } from "../src/core/game";
import { createDice } from "../src/core/dice";
import { botAct } from "../src/core/bot";
import { netWorth } from "../src/core/networth";
import type { GameCommand, LogEvent } from "../src/core/types";
import { loadBuiltinMapById } from "./engine-helpers";

// ── 局头/终局行的机读形状(detail JSON;与 game.ts 写入端对应) ────────────────────────────
export interface HeaderInfo {
  type: "header";
  gameId: string;
  mapId: string;
  seed: number;
  difficulty: EngineConfig["difficulty"];
  targetNetWorth: number;
  startingCash: number;
  startedAt: number;
  seats: { seat: number; guohao: string; isBot: boolean; colorIndex: number }[];
}

export interface FinalPlayerInfo {
  id: string;
  guohao: string;
  isBot: boolean;
  isBankrupt: boolean;
  cash: number;
  netWorth: number;
  position: number;
}

export interface FinalInfo {
  type: "final";
  round: number;
  turnNumber: number;
  winner: string;
  winReason: string;
  players: FinalPlayerInfo[];
}

/** room 行的机读事件(重放据此调整 bot 驱动座位集;与 room.ts/LocalController 写入端对应)。 */
type RoomEv =
  | { type: "start" | "dismiss" | "offline" }
  | { type: "takeover" | "attach"; seat: number }
  | { type: "autopilot"; seat: number; on: boolean; speed: string };

/** cmd 行的命令形状:GameCommand ∪ 选都(pickCapital 不是 GameCommand,见 game.ts)。 */
type ReplayCmd = GameCommand | { type: "pickCapital"; seat: number; tileIndex: number };

// botAct 能驱动的相位(与 room.ts INPUT_PHASES 同源;引擎内部过渡相位无需驱动)
const INPUT_PHASES = new Set([
  "Roll",
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
]);

/** 驱动服务器控制的座位直到轮到人类/终局(与 room.ts driveBots 同骨架:决策点归属 +
 *  可驱动相位;此处无 WS/直播,纯状态推进)。 */
function driveBots(e: GameEngine, takeover: Set<number>, autopilot: Set<number>): void {
  const controlled = (seat: number): boolean =>
    e.players[seat]?.isBot === true || takeover.has(seat) || autopilot.has(seat);
  let guard = 0;
  while (!e.isOver && guard++ < 100_000) {
    if (e.phase === "Setup") {
      if (e.setupPhase !== "PickCapital") break;
      const seat = e.currentSetupPlayerIndex;
      if (seat < 0 || !controlled(seat)) break;
      e.aiSetupStepFor(seat); // 服务器代选(bot/接管/托管同一口,确定性)
    } else if (e.phase === "Playing") {
      if (!INPUT_PHASES.has(e.turnPhase)) break;
      const seat = e.decisionOwner;
      if (!controlled(seat)) break;
      botAct(e);
    } else {
      break;
    }
  }
}

/** 读日志行数组重放整局,返回重放终态引擎(终局断言用 assertFinalState)。 */
export function replayGameLog(lines: LogEvent[]): GameEngine {
  const headerLine = lines.find((l) => l.category === "header");
  if (!headerLine) throw new Error("日志无局头行(category header),无法重放");
  const header = JSON.parse(headerLine.detail) as HeaderInfo;
  if (!header.mapId) throw new Error(`局头 mapId 为空(编辑器试玩等非清单地图),不可重放`);
  const map = loadBuiltinMapById(header.mapId);
  const engine = new GameEngine(map.board, map.catalog, createDice(header.seed), {
    // 座位按局头原始规格(国号可空 = doDraftRoll 分配)复刻:必须与原局构造参数一致,
    // 否则国号洗牌消耗的 rng 次数不同,整局骰流漂移(见 game.ts 局头注释)。
    seats: header.seats.map((s) => ({ name: `座 ${s.seat + 1}`, isBot: s.isBot, guohao: s.guohao || undefined })),
    targetNetWorth: header.targetNetWorth,
    startingCash: header.startingCash,
    difficulty: header.difficulty,
    mapId: header.mapId,
  } satisfies EngineConfig);
  engine.doDraftRoll(); // 原局构造后必经(单机 App.tsx / 联机 createEngine(doDraft=true))

  const takeover = new Set<number>();
  const autopilot = new Set<number>();
  for (const line of lines) {
    if (line.category === "cmd") {
      const cmd = JSON.parse(line.detail) as ReplayCmd;
      if (cmd.type === "pickCapital") engine.pickCapital(cmd.seat, cmd.tileIndex);
      else engine.submitCommand(cmd);
    } else if (line.category === "room") {
      const ev = JSON.parse(line.detail) as RoomEv;
      if (ev.type === "takeover") takeover.add(ev.seat);
      else if (ev.type === "attach") takeover.delete(ev.seat); // 重连夺回(托管不受影响,同 room.attachSeat)
      else if (ev.type === "autopilot") {
        if (ev.on) autopilot.add(ev.seat);
        else autopilot.delete(ev.seat);
      }
    }
    driveBots(engine, takeover, autopilot);
  }
  driveBots(engine, takeover, autopilot); // 尾部收尾(全 bot 局的整局都在这几次驱动里跑完)
  return engine;
}

/** 断言重放终态与终局行逐字段一致;不一致抛错(逐项列出差异)。 */
export function assertFinalState(lines: LogEvent[], engine: GameEngine): FinalInfo {
  const finalLine = lines.filter((l) => l.category === "final").pop();
  if (!finalLine) throw new Error("日志无终局行(category final):对局未跑完或日志不完整");
  const fin = JSON.parse(finalLine.detail) as FinalInfo;
  const problems: string[] = [];
  if (!engine.isOver) problems.push("重放未到终局(命令流缺失或日志截断)");
  if (engine.round !== fin.round) problems.push(`round: 日志=${fin.round} 重放=${engine.round}`);
  if (engine.turnNumber !== fin.turnNumber) problems.push(`turnNumber: 日志=${fin.turnNumber} 重放=${engine.turnNumber}`);
  if ((engine.winner?.id ?? null) !== fin.winner) problems.push(`winner: 日志=${fin.winner} 重放=${engine.winner?.id ?? null}`);
  if (engine.winReason !== fin.winReason) problems.push(`winReason: 日志=${fin.winReason} 重放=${engine.winReason}`);
  if (engine.players.length !== fin.players.length) {
    problems.push(`players 数量: 日志=${fin.players.length} 重放=${engine.players.length}`);
  } else {
    engine.players.forEach((p, i) => {
      const want = fin.players[i];
      if (p.id !== want.id) problems.push(`players[${i}].id: 日志=${want.id} 重放=${p.id}`);
      if (p.cash !== want.cash) problems.push(`${p.id}.cash: 日志=${want.cash} 重放=${p.cash}`);
      if (netWorth(p) !== want.netWorth) problems.push(`${p.id}.netWorth: 日志=${want.netWorth} 重放=${netWorth(p)}`);
      if (p.position !== want.position) problems.push(`${p.id}.position: 日志=${want.position} 重放=${p.position}`);
      if (p.isBankrupt !== want.isBankrupt) problems.push(`${p.id}.isBankrupt: 日志=${want.isBankrupt} 重放=${p.isBankrupt}`);
    });
  }
  if (problems.length > 0) throw new Error("重放校验失败(日志终局行 vs 重放终态):\n  " + problems.join("\n  "));
  return fin;
}

// ──────────────────────────── CLI 入口 ────────────────────────────
if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("用法: bun scripts/replay-log.ts logs/<gameId>.jsonl [更多文件...]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    try {
      const lines = readFileSync(file, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as LogEvent);
      const engine = replayGameLog(lines);
      const fin = assertFinalState(lines, engine);
      const winner = fin.players.find((p) => p.id === fin.winner);
      console.log(
        `[replay] ${file}: OK —— ${fin.round} 轮 ${fin.turnNumber} 回合,胜者 ${winner?.guohao ?? fin.winner}(${fin.winReason})`,
      );
    } catch (err) {
      failed++;
      console.error(`[replay] ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
