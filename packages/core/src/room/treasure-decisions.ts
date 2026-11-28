import type { GameCommand, GameEngine } from "../engine/authority";
import { canUpgrade } from "../engine/economy";
import { findHolding } from "../engine/player";
import type { TreasureRow } from "../engine/snapshot";
import { guidePriceOf, premiumPriceOf } from "../engine/treasures";

export type TreasureOwnerCommand = Extract<GameCommand, { type: "resolveTreasureOwner" }>;
export type TreasureTradeMode = TreasureOwnerCommand["action"]["type"];
export type TreasureTradeIntent =
  | { type: "chooseTreasureMode"; mode: TreasureTradeMode }
  | { type: "selectTreasure"; treasureId: string };

export interface TreasureTradeCandidate extends TreasureRow {
  guidePrice: number;
  premiumPrice: number;
}

export interface TreasureDecision {
  kind: "treasureOwner";
  tileIndex: number;
  visitorSeat: number;
  modes: readonly TreasureTradeMode[];
  fairUpgradesCity: boolean;
  candidates: readonly TreasureTradeCandidate[];
}

/** 城主的候选与报价沿用交割、升级规则。报价随选项集仅投给城主。 */
export function treasureDecisionOf(engine: GameEngine): TreasureDecision {
  const { def, ownerIdx } = engine.treasureVisitor!;
  const owner = engine.players[ownerIdx];
  const holding = findHolding(owner, def.id);
  if (holding === null) throw new Error(`珍宝交涉:城 ${def.id} 不在 ${owner.guohao} 名下`);
  return {
    kind: "treasureOwner",
    tileIndex: engine.tileIndexOfProperty(def.id),
    visitorSeat: engine.activeIndex,
    modes: ["skip", "fair", "premium"],
    fairUpgradesCity: canUpgrade(holding),
    candidates: owner.treasures.map(({ id, name, level, desc, kind, skillId }) => {
      const guidePrice = guidePriceOf(level);
      return {
        id,
        name,
        level,
        desc,
        kind,
        skillId,
        guidePrice,
        premiumPrice: premiumPriceOf(guidePrice, def, holding.level),
      };
    }),
  };
}
