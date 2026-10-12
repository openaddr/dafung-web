// 离线海选 e2e 场景编排的停靠点(#476 换图重钉两棒的工具,入库防丢)。
//
// 给定 seed × 环游图 × 座位配置,复算开局链:draftOrder / 选都三候选 / 起手牌 /
// 首个行动者与首骰自然落点。e2e 的场景编排(停靠点/种植/骰队列)据此海选种子。
//
// **已知偏差(诚实口径)**:draftOrder / 首骰点数 / 人类起手牌与浏览器实测一致
// (seed 63 核对过),但**选都候选存在系统性偏差**——app 引擎路径的 rng 消耗与
// Bun 仿真不完全一致(机理未穷尽,机遇配置已排除)。故本工具用途=**种子海选**
// (相对比较开局面貌),权威停靠点以 e2e 实测为准;换图重钉的完整流程见
// docs/how-to/开发与测试.md「换图重钉」一节。
//
// 为什么需要它:自然骰跨运行时不可信——Bun 与浏览器 V8 的 sort 比较器调用数不同,
// aiChooseCapital 消耗的 rng 随之有差,依赖骰序的编排必须 marchQueue/diceQueue
// 显式钉死。
//
// 用法:bun scripts/sim-jinnang.ts [seed=63] [--seats 4]
// 口径与 e2e startSolo 一致:seat 0 人类先手视角,其余 bot;地图=环游图。
import huanyouData from "../public/maps/huanyou.json" with { type: "json" };
import { loadMap } from "../src/core/board-loader";
import { GameEngine } from "../src/core/authority";
import type { SeatConfig, EngineConfig } from "../src/core/authority";
import { createDice } from "../src/core/dice";

const seed = Number(process.argv[2] ?? 63);
const seatsIdx = process.argv.indexOf("--seats");
const seatCount = seatsIdx > 0 ? Number(process.argv[seatsIdx + 1]) : 4;
const GUOHAO = ["魏", "蜀", "吴", "燕"];

const MAP = loadMap(huanyouData);
// 口径对齐 e2e startSolo:seat 0 人类(选定国号),其余 bot「待分配」——
// 引擎开局为待分配席分配国号会消耗 rng,预分配国号会让整条骰流分叉。
const seats: SeatConfig[] = Array.from({ length: seatCount }, (_, i) => ({
  name: String.fromCharCode(65 + i),
  isBot: i !== 0,
  ...(i === 0 ? { guohao: GUOHAO[0] } : {}),
}));
const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
const e = new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);

e.doDraftRoll();
let guard = 0;
while (e.phase === "Setup" && guard++ < 50) {
  const idx = e.currentSetupPlayerIndex;
  if (idx < 0) break;
  if (e.players[idx].isBot) {
    e.aiSetupStep();
    continue;
  }
  e.pickCapital(idx, e.offeredCapitals[0]);
}

const tileName = (i: number) => `${e.board.at(i)?.name}@${i}`;
const userSeat = e.players.indexOf(e.activePlayer);
const capName = e.players.map((p) => (p.capitalIndex >= 0 ? tileName(p.capitalIndex) : "未定"));

// 自然首骰探针(复制 rng 态,不消费引擎骰流)
const probe = createDice(0);
probe.setRngState(e.dice.getRngState());
const die = probe.roll().die;
const landing = (e.activePlayer.position + die) % e.board.count;

console.log(
  JSON.stringify(
    {
      seed,
      seatCount,
      draftOrder: e.draftOrder,
      capitalCandidates: e.offeredCapitals?.map(tileName) ?? null,
      capitals: capName,
      activeSeat: userSeat,
      openingHands: e.players.map((p) => `[${p.jinnangHand.join(",")}]`),
      firstDie: die,
      firstLanding: tileName(landing),
      turnPhase: e.turnPhase,
    },
    null,
    2,
  ),
);
