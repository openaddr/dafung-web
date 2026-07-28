// AI 诸侯:回合 EV 决策(抽签/驻跸/支线/买/升级),Simple/Normal 两档。
// 对应 C# 版 Flow/BotController.cs(选都已并入 GameEngine.aiChooseCapital)。
import type { GameEngine } from "./game";
import type { Player } from "./types";
import { findHolding } from "./player";
import { supplyFor } from "./economy";

function estimateCapitalSupply(engine: GameEngine, p: Player): number {
  const tile = engine.board.at(p.capitalIndex);
  const def = engine.catalog.get(tile.propertyId);
  const h = findHolding(p, def?.id ?? "");
  const lvl = h?.level ?? 0;
  return supplyFor(def?.resupplyPerLevel, lvl);
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
      // 小路免费=纯捷径(省步),总有利 → 总走小路
      engine.selectBranch("Shortcut");
      break;
    }

    case "AwaitingDecision": {
      const outcome = engine.lastLandOutcome;
      if (outcome?.kind === "PropertyAvailable" && outcome.property) {
        const def = outcome.property;
        const want = p.warrants >= 1 && p.cash > def.purchasePrice * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
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

    case "AwaitingHeroPick": {
      // bot 招贤纳士:随机选一位
      const count = engine.offeredHeroes.length;
      if (count > 0) engine.resolveHeroPick(Math.floor(engine.dice.nextFloat() * count));
      else engine.resolveHeroPick(0);
      break;
    }

    case "AwaitingTreasureOwner": {
      // bot 城主:有珍宝 → 低级赠宝(升级),高级贸易(赚钱);Simple 随机
      const owner = engine.players[engine.treasureVisitor?.ownerIdx ?? 0];
      const treasures = owner.treasures;
      if (treasures.length === 0) { engine.resolveTreasureOwner({ type: "skip" }); break; }
      const pick = treasures[Math.floor(engine.dice.nextFloat() * treasures.length)];
      const trade = simple ? engine.dice.nextFloat() < 0.4 : pick.level >= 6;
      engine.resolveTreasureOwner({ type: trade ? "trade" : "gift", treasureId: pick.id });
      break;
    }

    case "AwaitingBankruptcySettle": {
      // bot 清算:卖资产到够(优先名士→低珍宝→城,排除都城),再 confirm
      const p = engine.activePlayer;
      const debt = engine.pendingDebt!;
      const cap = engine.board.at(p.capitalIndex)?.propertyId;
      while (p.cash < debt.amount) {
        if (p.heroes.length) { engine.cashHeroBankruptcy(p.heroes[0].id); continue; }
        if (p.treasures.length) {
          const low = [...p.treasures].sort((a, b) => a.level - b.level)[0];
          engine.sellTreasureBankruptcy(low.id); continue;
        }
        const sellable = p.properties.find((h) => h.propertyId !== cap);
        if (sellable) { engine.sellPropertyBankruptcy(sellable.propertyId); continue; }
        break;
      }
      engine.confirmBankruptcySettle();
      break;
    }

    default:
      break;
  }
}
