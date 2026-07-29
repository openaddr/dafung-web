// 玩家构造与查询 helper。对应 C# 版 Players/Player.cs。
import type { Player, PropertyHolding } from "./types";
import { STARTING_WARRANTS } from "./constants";

export interface CreatePlayerOpts {
  id: string;
  name: string;
  guohao: string;
  colorIndex: number;
  isBot: boolean;
  startingCash: number;
}

export function createPlayer(opts: CreatePlayerOpts): Player {
  if (!opts.id.trim()) throw new Error("Player id must not be empty.");
  if (opts.startingCash < 0) throw new Error("Starting cash must be non-negative.");
  return {
    id: opts.id,
    name: opts.name,
    guohao: opts.guohao,
    colorIndex: opts.colorIndex,
    isBot: opts.isBot,
    cash: opts.startingCash,
    warrants: STARTING_WARRANTS,
    isBankrupt: false,
    position: 0,
    capitalIndex: -1,
    onBranch: null,
    skipTurns: 0,
    properties: [],
    heroes: [],
    treasures: [],
    heroLastFired: {},
  };
}

export const findHolding = (
  player: Player,
  propertyId: string,
): PropertyHolding | null =>
  player.properties.find((p) => p.propertyId === propertyId) ?? null;
