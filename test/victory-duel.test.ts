import { expect, it } from "bun:test";
import { extractBatchEvents } from "@app/fx/event-extract";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armBankrupt, armHero, armPhase, pinDice, setCash } from "@dafung/core/engine/planter";
import { checkVictory } from "@dafung/core/engine/victory";
import rawMap from "../packages/core/maps/guanzhong.json";

const { board, catalog } = loadMap(rawMap);

function atTurnEnd(cash: number[]): GameEngine {
  const seats = ["魏", "蜀", "吴", "群"].slice(0, cash.length).map((guohao) => ({
    name: guohao,
    guohao,
    isBot: false,
  }));
  const engine = new GameEngine(board, catalog, createDice(42), {
    seats,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
  armPhase(engine, { activeIndex: 0, phase: "Playing", turnPhase: "EndTurn" });
  cash.forEach((amount, seat) => setCash(engine, seat, amount));
  return engine;
}

it("最高现金并列者拼点，只有最高同点者重掷并公开全部签面", () => {
  const engine = atTurnEnd([31000, 32000, 32000, 32000]);
  armHero(engine, 3, "zhouyu", ["yingzi"]);
  pinDice(engine, "duel", [6, 4, 6, 5, 7]);

  expect(checkVictory(engine)).toEqual({ winner: engine.players[3], reason: "TargetNetWorth" });
  const signs = extractBatchEvents(engine, engine.snapshot().events).filter(
    (event) => event.kind === "duelSigns",
  );
  expect(
    signs.map(({ sides, winnerSeat }) => ({
      sides: sides.map(({ seat, roll }) => [seat, roll]),
      winnerSeat,
    })),
  ).toEqual([
    {
      sides: [
        [1, 6],
        [2, 4],
        [3, 6],
      ],
      winnerSeat: null,
    },
    {
      sides: [
        [1, 5],
        [3, 7],
      ],
      winnerSeat: 3,
    },
  ]);
});

it("现金达标看存活诸侯，只有一人存活时优先判群雄尽灭", () => {
  const engine = atTurnEnd([40000, 30000, 31000]);
  armBankrupt(engine, 0);
  expect(checkVictory(engine)).toEqual({ winner: engine.players[2], reason: "TargetNetWorth" });

  armBankrupt(engine, 2);
  expect(checkVictory(engine)).toEqual({ winner: engine.players[1], reason: "LastStanding" });
  expect(engine.snapshot().events.some((event) => event.kind === "duelResolved")).toBe(false);
});
