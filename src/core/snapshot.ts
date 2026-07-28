// 引擎全状态序列化(调试 window.__dafung / 联机广播数据包)。God view,读 engine public 字段。
// 从 game.ts 提取,集中序列化逻辑,便于联机时复用 + 单独演进。
import type { GameEngine } from "./game";
import { netWorth } from "./networth";

export function serializeGame(e: GameEngine) {
  return {
    phase: e.phase,
    setupPhase: e.setupPhase,
    turnPhase: e.turnPhase,
    turnNumber: e.turnNumber,
    round: e.round,
    activeIndex: e.activeIndex,
    targetNetWorth: e.targetNetWorth,
    isOver: e.isOver,
    winner: e.winner ? e.winner.id : null,
    winReason: e.winReason,
    draftOrder: e.draftOrder,
    draftRolls: e.draftRolls,
    currentSetupPlayerIndex: e.currentSetupPlayerIndex,
    takenCapitalIndices: [...e.takenCapitalIndices],
    pendingHaltIsOnPath: e.pendingHaltIsOnPath,
    pendingDebt: e.pendingDebt ? { amount: e.pendingDebt.amount, creditor: e.pendingDebt.creditor?.id ?? null } : null,
    currentBranchShortcutId: e.currentBranchShortcut()?.id ?? null,
    players: e.players.map((p) => ({
      id: p.id,
      name: p.guohao || p.name,
      guohao: p.guohao,
      colorIndex: p.colorIndex,
      isBot: p.isBot,
      cash: p.cash,
      warrants: p.warrants,
      netWorth: netWorth(p),
      isBankrupt: p.isBankrupt,
      position: p.position,
      capitalIndex: p.capitalIndex,
      pendingBranch: p.pendingBranch,
      properties: p.properties.map((h) => ({ propertyId: h.propertyId, level: h.level, group: h.group })),
      heroes: p.heroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc })),
      treasures: p.treasures.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc })),
    })),
    offeredHeroes: e.offeredHeroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc })),
    lastRoll: e.lastRoll,
    lastMove: e.lastMove
      ? {
          landIndex: e.lastMove.landIndex,
          passedCapital: e.lastMove.passedCapital,
          capitalIndex: e.lastMove.capitalIndex,
          traversed: e.lastMove.traversed,
        }
      : null,
    lastLandOutcomeKind: e.lastLandOutcome?.kind ?? null,
    lastLandOutcomeProperty: e.lastLandOutcome?.property?.id ?? null,
    logCount: e.log.length,
  };
}
