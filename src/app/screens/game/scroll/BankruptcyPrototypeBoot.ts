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
import type { AssetState } from "./BankruptcyPrototype";

let repaintBackdrop: (state: AssetState) => void;
export function previewBankruptcyBackdrop(state: AssetState) {
  repaintBackdrop(state);
}

export async function bootBankruptcyPrototype() {
  const response = await fetch("/maps/guanzhong.json");
  const mapData = (await response.json()) as MapData;
  const map = loadMap(mapData);
  function seedScene(state: AssetState | null) {
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
    applyPlant(engine, { kind: "setCash", seat: 0, cash: state === null ? 500 : state.cash });
    applyPlant(engine, {
      kind: "giveTreasure",
      seat: 0,
      treasures:
        state === null
          ? TREASURES.filter((t) => ["qingnang", "liangce", "hu"].includes(t.id))
          : state.treasures.map((asset) => TREASURES.find((t) => t.id === asset.id)!),
    });
    for (const h of state === null ? HEROES.slice(0, 2) : state.heroes) {
      applyPlant(engine, { kind: "armHero", seat: 0, heroId: h.id });
    }
    const capitals = engine.players.map((p) => engine.board.at(p.capitalIndex!).propertyId);
    const properties = engine.board.tiles.filter(
      (tile) => tile.propertyId !== null && !capitals.includes(tile.propertyId),
    );
    for (const asset of state === null
      ? properties.slice(0, 3).map((tile) => ({ propId: tile.propertyId!, level: 1 }))
      : state.sellableProperties) {
      applyPlant(engine, {
        kind: "grantProperty",
        seat: 0,
        propertyId: asset.propId,
        level: asset.level,
      });
    }
    applyPlant(engine, {
      kind: "armDebt",
      amount: state === null ? 1300 : state.debtAmount,
      creditor: 1,
    });
    return engine;
  }
  let engine = seedScene(null);
  repaintBackdrop = (state) => {
    engine = seedScene(state);
    setEngine(engine);
    useGameStore.getState().syncFromEngine(engine);
  };

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
