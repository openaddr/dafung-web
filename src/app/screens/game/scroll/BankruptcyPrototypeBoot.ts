// THROWAWAY #1401 — 真实地图/组件背景，无存档、无生产控制器、无时钟推进。
import { GameEngine, type GameCommand } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap, type MapData } from "@core/board-loader";
import { applyPlant } from "@core/planter";
import { HEROES } from "@core/heroes";
import { TREASURES } from "@core/treasures";
import { GameController } from "@app/controllers/controller";
import { setController } from "@app/controllers/registry";
import { setEngine, useGameStore } from "@app/store/gameStore";

export async function bootBankruptcyPrototype() {
  const response = await fetch("/maps/guanzhong.json");
  const mapData = (await response.json()) as MapData;
  const map = loadMap(mapData);
  const engine = new GameEngine(map.board, map.catalog, createDice(1401), {
    seats: [
      { name: "曹操", guohao: "魏", isBot: false },
      { name: "刘备", guohao: "蜀", isBot: false },
    ],
    targetNetWorth: mapData.targetNetWorth,
    startingCash: mapData.startingCash,
    startingTreasures: 0,
  });
  engine.doDraftRoll();
  while (engine.phase === "Setup") {
    engine.pickCapital(engine.currentSetupPlayerIndex, Math.min(...engine.offeredCapitals));
  }
  applyPlant(engine, { kind: "armPhase", phase: "Playing", activeIndex: 0 });
  applyPlant(engine, { kind: "setCash", seat: 0, cash: 500 });
  applyPlant(engine, {
    kind: "giveTreasure",
    seat: 0,
    treasures: TREASURES.filter((t) => ["qingnang", "liangce", "hu"].includes(t.id)),
  });
  for (const h of HEROES.slice(0, 2)) {
    applyPlant(engine, { kind: "armHero", seat: 0, heroId: h.id });
  }
  const capitals = engine.players.map((p) => engine.board.at(p.capitalIndex!).propertyId);
  const properties = engine.board.tiles.filter(
    (tile) => tile.propertyId !== null && !capitals.includes(tile.propertyId),
  );
  for (const tile of properties.slice(0, 3)) {
    applyPlant(engine, { kind: "grantProperty", seat: 0, propertyId: tile.propertyId!, level: 1 });
  }
  applyPlant(engine, { kind: "armDebt", amount: 1300, creditor: 1 });

  class PrototypeBackdrop extends GameController {
    get engine() {
      return engine;
    }
    get viewSeat() {
      return 0;
    }
    protected get mySeat() {
      return 0;
    }
    protected readonly hotSeat = false;
    dispatchCommand(_command: GameCommand) {
      throw new Error("原型背景只读；变卖交互在原型内存中演示");
    }
  }
  setController(new PrototypeBackdrop(), mapData);
  setEngine(engine);
  const store = useGameStore.getState();
  store.syncFromEngine(engine);
  store.setViewSeat(0);
  store.setInteractive(true);
  store.setScreen("game");
}
