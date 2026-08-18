// AI 诸侯:回合 EV 决策(抽签/驻跸/辅路/买/升级),Simple/Normal 两档。
// 选都决策在 GameEngine.aiChooseCapital。
import type { GameEngine } from "./game";
import type { Player } from "./types";

function estimateCapitalSupply(engine: GameEngine, p: Player): number {
  return engine.capitalSupplyOf(p).supply;
}

function estimateDestValue(engine: GameEngine, p: Player, destIndex: number): number {
  const tile = engine.board.at(destIndex);
  const def = engine.catalog.get(tile.propertyId);
  if (!def) return 0;
  const owner = engine.findOwner(def.id);
  if (!owner) return def.purchasePrice / 4; // 可买
  if (owner === p) {
    // 可免费扩军:价值 ≈ 升级后与当前等级城池价值之差 / 4(满级为 0)
    const h = p.properties.find((x) => x.propertyId === def.id);
    if (!h || h.level >= def.maxLevel) return 0;
    return (def.valueByLevel[h.level] - def.valueByLevel[h.level - 1]) / 4;
  }
  return 0; // 落他人城:无过路费(城主无珍宝=无事;有珍宝则城主择公道买卖/坐地起价,访客不可控,估中性)
}

/** 辅路入口抉择:走大路时下一落点的近似价值(平均掷骰 3.5 步后的 tile)。 */
function estimateBranchMainEv(engine: GameEngine, p: Player): number {
  const n = engine.board.count;
  const dest = (p.position + 4) % n; // 约 3-4 步后的主路落点
  return estimateDestValue(engine, p, dest);
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
        const destValue = estimateDestValue(engine, p, engine.presentation.lastMove!.landIndex);
        if (supply > destValue) engine.haltAtCapital();
        else engine.continueMove();
      }
      break;
    }

    case "AwaitingBranch": {
      // 辅路入口抉择:Simple 随机;Normal 估辅路 EV(treasure≈指导价期望 + event 轻微正 − penalty 风险)vs 主路落点价值
      if (simple) {
        engine.selectBranch(engine.dice.nextFloat() < 0.5 ? "Main" : "Branch");
        return;
      }
      const branch = engine.board.branch;
      let branchEv = 0;
      if (branch) {
        const cells = branch.cells;
        // 平均掷骰 3.5:辅路每格约 1/3.5 概率被踩中(简化估)
        const hitProb = 1 / 3.5;
        for (const c of cells) {
          if (c.kind === "treasure") branchEv += hitProb * 120; // 探宝期望(拼点成功率×指导价,粗估)
          else if (c.kind === "event") branchEv += hitProb * 30; // 锦囊轻微正期望
          else branchEv -= hitProb * 180; // 中伏:跳一回合的机会成本
        }
      }
      // 主路:下一落点价值(起点 tile 之后约 3.5 步)
      const mainEv = estimateBranchMainEv(engine, p);
      engine.selectBranch(branchEv >= mainEv ? "Branch" : "Main");
      return;
    }

    case "AwaitingDecision": {
      const outcome = engine.lastLandOutcome;
      if (outcome?.kind === "PropertyAvailable" && outcome.property) {
        const def = outcome.property;
        const want = p.warrants >= 1 && p.cash > def.purchasePrice * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
        if (want) engine.buyProperty();
        else engine.endDecision();
      } else if (outcome?.kind === "OwnProperty" && outcome.property) {
        // 扩军免费:满级才按兵不动(Simple 保留随机性情)
        const h = p.properties.find((x) => x.propertyId === outcome.property!.id);
        const maxed = h == null || h.level >= outcome.property!.maxLevel;
        const want = !maxed && (simple ? engine.dice.nextFloat() < 0.75 : true);
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
      // bot 城主:公道买卖(指导价)/坐地起价(加价)/跳过。
      //  Normal:高等级珍宝(≥6)溢价卖,低等级公道卖,偶尔(20%)跳过。
      //  Simple:随机 fair/premium/skip。
      const owner = engine.players[engine.treasureVisitor?.ownerIdx ?? 0];
      const treasures = owner.treasures;
      if (treasures.length === 0) { engine.resolveTreasureOwner({ type: "skip" }); break; }
      const pick = treasures[Math.floor(engine.dice.nextFloat() * treasures.length)];
      if (simple) {
        const r = engine.dice.nextFloat();
        if (r < 0.34) engine.resolveTreasureOwner({ type: "fair", treasureId: pick.id });
        else if (r < 0.68) engine.resolveTreasureOwner({ type: "premium", treasureId: pick.id });
        else engine.resolveTreasureOwner({ type: "skip" });
        break;
      }
      // Normal
      if (engine.dice.nextFloat() < 0.2) { engine.resolveTreasureOwner({ type: "skip" }); break; }
      const mode = pick.level >= 6 ? "premium" : "fair";
      engine.resolveTreasureOwner({ type: mode, treasureId: pick.id });
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
