// AI 诸侯:回合 EV 决策(抽签/辅路/买/升级/抉择机遇),Simple/Normal 两档。
// 选都决策在 GameEngine.aiChooseCapital。经过都城必停由引擎 rollAndMove 直接结算,无 bot 抉择点。
import type { GameEngine } from "./game";
import type { Player } from "./types";
import type { EncounterEffect } from "./encounters";

/** 座位散列(抉择声望折算系数的性格源,#124):纯座位派生,确定性、与对局状态无关,
 *  不消耗引擎骰(重放安全)。 */
function seatHash(seat: number): number {
  let h = (seat + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 声望折银系数(#124):5 + (seatHash % 5) ∈ [5,9]——不同 bot 性格不同:重声望者愿为
 *  声望多掏银(携民渡江式的仁主),轻声望者见利即取。repDelta × 系数折成银两后与选项的
 *  立即银两影响同尺比较。exported 供单测。 */
export function repCoefficient(seat: number): number {
  return 5 + (seatHash(seat) % 5);
}

/** 抉择选项的立即银两影响(#124 bot 贪心口径):cash 直取;玩家间转移(siphon/trade/levy)
 *  按面值;grantHero/grantCity 只计 fallbackCash(得将得城的长期价值不入立即净值);
 *  grantTreasure 无现金流量计 0;无 effect(纯声望/无事)= 0。exported 供单测。 */
export function encounterCashImpact(effect: EncounterEffect | undefined): number {
  if (!effect) return 0;
  switch (effect.kind) {
    case "cash":
      return effect.delta;
    case "siphon":
    case "trade":
      return effect.amount;
    case "levy":
      return -effect.amount;
    case "grantCard":
      return 0; // #147:得的是锦囊,无现金流量
    case "grantHero":
    case "grantCity":
      return effect.fallbackCash;
    case "grantTreasure":
      return 0;
  }
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
    return (def.valueByLevel[h.level + 1] - def.valueByLevel[h.level]) / 4;
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
          if (c.kind === "treasure") branchEv += hitProb * 300; // 探宝期望(拼点成功率×指导价,粗估;经济 v2:珍宝 1-30 两)
          else if (c.kind === "event") branchEv += hitProb * 100; // 锦囊轻微正期望
          else branchEv -= hitProb * 500; // 中伏:跳一回合的机会成本
        }
      }
      // 主路:下一落点价值(起点 tile 之后约 3.5 步)
      const mainEv = estimateBranchMainEv(engine, p);
      engine.selectBranch(branchEv >= mainEv ? "Branch" : "Main");
      return;
    }

    case "AwaitingDecision": {
      // ADR-0013:先经 choicesFor 选项集注册表过滤可用项(与引擎自动执行同一口径,防第三套
      // 判断漂移),再按启发式选择。引擎已保证进入该相位时 ≥2 真实选项,此处过滤是收敛口径。
      const avail = engine.choicesFor().filter((o) => o.available);
      const def = engine.pendingLand != null ? engine.pendingLandDef() : null; // 决策上下文(spec #107 C2)
      if (avail.some((o) => o.id === "buy") && def) {
        const want = p.cash > def.purchasePrice * 1.5 && (simple ? engine.dice.nextFloat() < 0.5 : true);
        if (want) engine.buyProperty();
        else engine.endDecision();
      } else if (avail.some((o) => o.id === "upgrade")) {
        // 扩军免费:未满级即升(Simple 保留随机性情;满级已被引擎自动按兵不动)
        const want = simple ? engine.dice.nextFloat() < 0.75 : true;
        if (want) engine.upgradeProperty();
        else engine.endDecision();
      } else {
        engine.endDecision();
      }
      break;
    }

    case "AwaitingJinnang": {
      // 锦囊卷轴(#122/T2):T2 阶段 bot 恒「今不用」——托管/看门狗两上下文都保守推进,
      // 不替玩家花牌(策略表在 T6;经 choicesFor 同口径读选项,引擎方法直调不经 submitCommand)。
      engine.resolveJinnang(null);
      break;
    }

    case "AwaitingExhaustion": {
      // 体力耗竭惩罚(#130):bot 随机弃一座(确定性走引擎 dice,保重放)。
      const available = engine
        .choicesFor()
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => o.available);
      if (available.length > 0) {
        const pick = available[Math.floor(engine.dice.nextFloat() * available.length)];
        engine.resolveExhaustionChoice(pick.i);
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

    case "AwaitingEncounter": {
      // 抉择机遇(#124):立即净值贪心——score = 选项 effect 银两影响 + repDelta × 声望折银
      // 系数(repCoefficient(decisionOwner),不同 bot 性格不同)。确定性:不掷骰,同分取
      // 目录序在前者。Simple/Normal 同策略:一次性小事件不值得两档启发式。选项集先经
      // choicesFor 过滤(ADR-0013 同一口径,不可用选项不参评)。
      const enc = engine.pendingEncounter;
      if (!enc || !enc.choices) throw new Error("AwaitingEncounter 相位 pendingEncounter/choices 缺失:状态机不一致"); // 零兜底
      const choices = enc.choices; // 收窄进闭包(TS 不跨闭包保持窄化)
      const coef = repCoefficient(engine.decisionOwner);
      let bestIdx = -1;
      let bestScore = -Infinity;
      engine.choicesFor().forEach((o, i) => {
        if (!o.available) return;
        const c = choices[i];
        if (!c) throw new Error(`机遇「${enc.id}」选项 ${i} 越界:选项注册表与目录不一致`); // 零兜底
        const score = encounterCashImpact(c.effect) + c.repDelta * coef;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) engine.resolveEncounterChoice(bestIdx);
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
      // bot 清算:卖资产到够(优先名将→低珍宝→城,排除都城),再 confirm
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
