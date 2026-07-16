// AI 诸侯:回合 EV 决策(掷骰/驻跸/支线/买/升级),Simple/Normal 两档。
// 对应 C# 版 Flow/BotController.cs(选都已并入 GameEngine.aiChooseCapital)。
import type { GameEngine } from "./game";
import type { Player, ShortcutDef } from "./types";
import { findHolding } from "./player";

const expectedShortcutValue = (sc: ShortcutDef): number => {
  const c = sc.consequence;
  if (c.kind === "FixedCost") return -c.amount;
  return (c.win.cashDelta + c.lose.cashDelta) / 2;
};

const worstCaseCost = (sc: ShortcutDef): number => {
  const c = sc.consequence;
  if (c.kind === "FixedCost") return c.amount;
  return Math.max(0, -c.lose.cashDelta);
};

function estimateCapitalSupply(engine: GameEngine, p: Player): number {
  const tile = engine.board.at(p.capitalIndex);
  const def = engine.catalog.get(tile.propertyId);
  const h = findHolding(p, def?.id ?? "");
  const lvl = h?.level ?? 0;
  return (def?.resupplyPerLevel ?? 0) * (lvl + 1);
}

function estimateDestValue(engine: GameEngine, p: Player, destIndex: number): number {
  const tile = engine.board.at(destIndex);
  const def = engine.catalog.get(tile.propertyId);
  if (!def) return 0;
  const owner = engine.findOwner(def.id);
  if (!owner) return def.purchasePrice / 4; // 可买
  if (owner === p) return def.upgradeCost / 4; // 可升级
  return -def.rentByLevel[1]; // 落他人地产,付租(按 Lv1 估)
}

/** 驱动当前 bot 回合的一步决策;UI 在 bot 回合轮询调用直到进入下一玩家或 GameOver。 */
export function botAct(engine: GameEngine): void {
  const p = engine.activePlayer;
  const simple = engine.difficulty === "Simple";

  switch (engine.turnPhase) {
    case "Roll":
      engine.rollAndMove();
      break;

    case "AwaitingCapitalHalt": {
      if (simple) {
        engine.haltAtCapital();
      } else {
        const supply = estimateCapitalSupply(engine, p);
        const destValue = estimateDestValue(engine, p, engine.lastMove!.landIndex);
        if (supply > destValue) engine.haltAtCapital();
        else engine.continueMove();
      }
      break;
    }

    case "AwaitingBranch": {
      const sc = engine.board.getShortcut(p.position);
      const canAfford = !sc || p.cash >= worstCaseCost(sc);
      const takeShortcut =
        !!sc &&
        canAfford &&
        (simple ? engine.dice.nextFloat() < 0.5 : expectedShortcutValue(sc) >= 0);
      engine.selectBranch(takeShortcut ? "Shortcut" : "Main");
      break;
    }

    case "AwaitingDecision": {
      const outcome = engine.lastLandOutcome;
      if (outcome?.kind === "PropertyAvailable" && outcome.property) {
        const def = outcome.property;
        const want = p.cash > def.purchasePrice * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
        if (want) engine.buyProperty();
        else engine.endDecision();
      } else if (outcome?.kind === "OwnProperty" && outcome.property) {
        const def = outcome.property;
        const want = p.cash > def.upgradeCost * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
        if (want) engine.upgradeProperty();
        else engine.endDecision();
      } else {
        engine.endDecision();
      }
      break;
    }

    default:
      break;
  }
}
