// 引擎不变量 soak(#293 Q1 / #304):GameEngine 直驱多 seed 全 bot 局,逐步断言五条
// 引擎态不变量(现金非负 / 身价非负 / 位置合法 / 破产无残留 / 终局有 winner),取代已删的
// e2e「速战档全程驱动」(66.2s 全库最贵单例)——五条不变量是引擎态断言,浏览器只是昂贵的
// 驱动器;这里秒级跑几十局(2-4 人 × Simple/Normal × 机遇产品默认档),广度反超浏览器单局。
// 驱动范式:选都 aiSetupStep + 对局 botAct 循环,全 bot 局
// 决策方恒为 bot(AwaitingReaction 反应窗 bot 即席代答,相位不外显)。
// 步数 guard 打满仍未终局 → isOver 断言当场失败(零兜底:僵局就是要炸出来的 bug)。
import { describe, it, expect, afterAll } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import type { AiDifficulty } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import { netWorth } from "@core/networth";
import { ENCOUNTER_PRODUCT_DEFAULTS } from "@core/encounters";
import { loadMap } from "@core/board-loader";
import sanguoData from "../public/maps/sanguo.json";

const MAP = loadMap(sanguoData);
/** 速战目标(经济 v2):终局快但胜负判定/终局行都走真路径。 */
const TARGET = 15000;
/** 单局步数上限打满仍未终局 → 断言失败,红出来。 */
const STEP_LIMIT = 20_000;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

function makeEngine(seed: number, seatCount: number, difficulty: AiDifficulty): GameEngine {
  const seats: SeatConfig[] = Array.from({ length: seatCount }, (_, i) => ({
    name: `Bot${i + 1}`,
    isBot: true,
  }));
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: TARGET,
    difficulty,
    encounter: ENCOUNTER_PRODUCT_DEFAULTS, // 产品默认 40%:机遇抉择/银两转移路径纳入巡检
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

function driveSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 100) {
    if (e.currentSetupPlayerIndex < 0) break;
    e.aiSetupStep();
  }
}

/** 五不变量逐步断言(直接读引擎玩家态,不经 snapshot 深拷贝)。 */
function assertInvariants(e: GameEngine, tag: string): void {
  for (const p of e.players) {
    const who = `${tag} R${e.round} ${p.guohao ?? p.name}`;
    if (p.cash < 0) throw new Error(`不变量违规·现金非负:${who} cash=${p.cash}`);
    if (netWorth(p) < 0) throw new Error(`不变量违规·身价非负:${who} nw=${netWorth(p)}`);
    if (p.position < 0 || p.position >= e.board.count)
      throw new Error(`不变量违规·位置合法:${who} pos=${p.position}(board.count=${e.board.count})`);
    if (
      p.isBankrupt &&
      (p.properties.length > 0 ||
        p.treasures.length > 0 ||
        p.heroes.length > 0 ||
        p.jinnangHand.length > 0 ||
        p.capitalIndex !== -1)
    )
      throw new Error(
        `不变量违规·破产无残留:${who} 残留城${p.properties.length}/宝${p.treasures.length}/将${p.heroes.length}/囊${p.jinnangHand.length}/都城位${p.capitalIndex}`,
      );
  }
}

function driveToOver(e: GameEngine, tag: string): void {
  assertInvariants(e, tag); // 开局态也在口径内
  let guard = 0;
  while (!e.isOver) {
    if (guard++ >= STEP_LIMIT)
      throw new Error(
        `${tag}:步数打满 ${STEP_LIMIT} 仍未终局(round=${e.round} phase=${e.phase} turnPhase=${e.turnPhase})`,
      );
    botAct(e); // 全 bot 局:决策方(含城主/被询问座)恒为 bot
    assertInvariants(e, tag);
  }
}

function assertGameOver(e: GameEngine): void {
  expect(e.isOver).toBe(true);
  const winner = e.winner;
  expect(winner).not.toBeNull();
  expect(e.players.some((p) => p.id === winner!.id)).toBe(true);
  expect(["LastStanding", "TargetNetWorth"]).toContain(e.winReason);
}

// 广度台账(汇报用):跑完全部 seed 后打一行汇总,不参与断言。
const tally = { games: 0, rounds: 0, turns: 0, bankrupts: 0 };

afterAll(() => {
  console.log(
    `invariant-soak 汇总:${tally.games} 局 / ${tally.rounds} 轮 / ${tally.turns} 回合 / ${tally.bankrupts} 人破产`,
  );
});

describe("引擎不变量 soak:GameEngine 直驱多 seed 全 bot 局(#304)", () => {
  for (const seed of SEEDS) {
    const seatCount = 2 + (seed % 3); // 2/3/4 人轮转
    const difficulty: AiDifficulty = seed % 2 === 0 ? "Normal" : "Simple";
    it(`seed ${seed}(${seatCount}人 ${difficulty}):五不变量逐步成立,终局有胜者`, () => {
      const e = makeEngine(seed, seatCount, difficulty);
      driveSetup(e);
      const t0 = e.turnNumber;
      driveToOver(e, `seed=${seed}`);
      assertGameOver(e);
      tally.games++;
      tally.rounds += e.round;
      tally.turns += e.turnNumber - t0;
      tally.bankrupts += e.players.filter((p) => p.isBankrupt).length;
    });
  }
});
