import type { GameCommand, GameEngine } from "../engine/authority";
import type { PendingLand } from "../engine/movement-flow";

const LAND_COMMANDS = {
  buy: "buyProperty",
  upgrade: "upgradeProperty",
  skip: "endDecision",
} as const satisfies Record<string, GameCommand["type"]>;

type LandCommandType = (typeof LAND_COMMANDS)[keyof typeof LAND_COMMANDS];
export type LandDecisionCommand = Extract<GameCommand, { type: LandCommandType }>;

export function isLandDecisionCommand(cmd: { type?: unknown }): cmd is LandDecisionCommand {
  return Object.values(LAND_COMMANDS).some((type) => type === cmd.type);
}

export type LandDecisionOption = {
  command: LandCommandType;
  label: string;
  cost: number;
} & ({ available: true } | { available: false; reason: string });

export interface LandDecision {
  kind: "landDecision";
  landing: PendingLand & { tileIndex: number };
  options: readonly LandDecisionOption[];
}

export function landDecisionPointOf(engine: GameEngine, revision: number): string | null {
  return engine.phase === "Playing" && engine.turnPhase === "AwaitingDecision"
    ? `${engine.gameId}/land/${engine.turnNumber}/${revision}/${engine.decisionOwner}`
    : null;
}

/** 权威处理固定事件后挂起的落格选项，同一份可用性供下行与玩家提交校验。 */
export function landDecisionOf(engine: GameEngine): LandDecision {
  const pending = engine.pendingLand;
  if (engine.turnPhase !== "AwaitingDecision" || pending === null)
    throw new Error("地产决策点缺少权威落格上下文");
  const property = engine.pendingLandDef();
  const options = engine.choicesFor().map((option): LandDecisionOption => {
    if (!Object.hasOwn(LAND_COMMANDS, option.id)) throw new Error(`未知地产选项 ${option.id}`);
    const command = LAND_COMMANDS[option.id as keyof typeof LAND_COMMANDS];
    const base = {
      command,
      label: option.label,
      cost: command === "buyProperty" ? property.purchasePrice : 0,
    };
    if (option.available) return { ...base, available: true };
    if (option.reason === undefined) throw new Error(`地产选项 ${option.id} 缺少不可用原因`);
    return { ...base, available: false, reason: option.reason };
  });
  return {
    kind: "landDecision",
    landing: { ...pending, tileIndex: engine.tileIndexOfProperty(property.id) },
    options,
  };
}
