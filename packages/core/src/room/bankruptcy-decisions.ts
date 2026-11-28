import type { GameCommand, GameEngine } from "../engine/authority";
import { sellValueOf } from "../engine/economy";
import { guidePriceOf, type TreasureDef } from "../engine/treasures";

export type BankruptcyDecisionCommand = Extract<
  GameCommand,
  { type: "confirmBankruptcySettle" | "declareBankruptcy" }
>;

export function isBankruptcyDecisionCommand(cmd: {
  type?: unknown;
}): cmd is BankruptcyDecisionCommand {
  return cmd.type === "confirmBankruptcySettle" || cmd.type === "declareBankruptcy";
}

type SalePrice = {
  id: string;
  name: string;
  level: number;
  price: number;
  maxQuantity: number;
};

type TreasureSale = SalePrice & {
  kind: "treasure";
  treasure: Pick<TreasureDef, "kind" | "skillId">;
};

export type BankruptcySaleOption = TreasureSale | (SalePrice & { kind: "property" });

export interface BankruptcyDecision {
  kind: "bankruptcy";
  cash: number;
  debt: { amount: number; creditorSeat: number | null };
  assets: readonly BankruptcySaleOption[];
}

/** 只将引擎当前持有的可变卖资产及其变卖价交给欠款席。 */
export function bankruptcyDecisionOf(engine: GameEngine): BankruptcyDecision {
  const { pendingDebt } = engine;
  if (engine.turnPhase !== "AwaitingBankruptcySettle" || pendingDebt === null)
    throw new Error("清算决策点缺少权威债务");
  const player = engine.activePlayer;
  const treasures = new Map<string, TreasureSale>();
  for (const { id, name, level, kind, skillId } of player.treasures) {
    const option = treasures.get(id);
    if (option === undefined) {
      treasures.set(id, {
        kind: "treasure",
        id,
        name,
        level,
        price: guidePriceOf(level),
        maxQuantity: 1,
        treasure: { kind, skillId },
      });
    } else {
      // 技能书的同技多册共用一个 id，确认时每次引用只消费一册。
      option.maxQuantity++;
    }
  }
  const assets: BankruptcySaleOption[] = [...treasures.values()];
  for (const { propertyId, level } of player.properties) {
    const tileIndex = engine.tileIndexOfProperty(propertyId);
    if (tileIndex === player.capitalIndex) continue;
    const definition = engine.catalog.get(propertyId);
    if (definition === null) throw new Error(`清算:目录无城池 ${propertyId}`);
    assets.push({
      kind: "property",
      id: propertyId,
      name: engine.board.at(tileIndex).name,
      level,
      price: sellValueOf(definition, level),
      maxQuantity: 1,
    });
  }
  const creditorSeat =
    pendingDebt.creditor === null ? null : engine.players.indexOf(pendingDebt.creditor);
  if (creditorSeat === -1) throw new Error("清算债主不在本局");
  return {
    kind: "bankruptcy",
    cash: player.cash,
    debt: { amount: pendingDebt.amount, creditorSeat },
    assets,
  };
}
