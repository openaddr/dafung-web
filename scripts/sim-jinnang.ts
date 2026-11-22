// 离线比较关中图指定种子的开局顺序、选都、起手牌与首骰落点。
// Bun 与客户端引擎路径的随机数消耗可能不同,结果仅供筛选,安卓实机为准。
// 用法:bun scripts/sim-jinnang.ts [seed=63] [--seats 4]
// seat 0 为人类,其余为 bot。
import guanzhongData from "../packages/core/maps/guanzhong.json" with { type: "json" };
import { loadMap } from "@dafung/core/engine/board-loader";
import { GameEngine } from "@dafung/core/engine/authority";
import type { SeatConfig, EngineConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";

const seed = Number(process.argv[2] ?? 63);
const seatsIdx = process.argv.indexOf("--seats");
const seatCount = seatsIdx > 0 ? Number(process.argv[seatsIdx + 1]) : 4;
const GUOHAO = ["魏", "蜀", "吴", "燕"];

const MAP = loadMap(guanzhongData);
// 仅为人类选定国号;引擎为 bot 分配国号时会消耗随机数。
const seats: SeatConfig[] = Array.from({ length: seatCount }, (_, i) => ({
  name: String.fromCharCode(65 + i),
  isBot: i !== 0,
  ...(i === 0 ? { guohao: GUOHAO[0] } : {}),
}));
const cfg: EngineConfig = {
  seats,
  targetNetWorth: MAP.targetNetWorth,
  startingCash: MAP.startingCash,
  startingTreasures: MAP.startingTreasures,
};
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
