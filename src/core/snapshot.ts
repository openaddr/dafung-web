// 引擎全状态序列化(调试 window.__dafung / 联机广播数据包 / CLI 持久化)。God view,读 engine public 字段。
// 从 game.ts 提取,集中序列化逻辑,便于联机时复用 + 单独演进。
// 联机化(CLAUDE.md 规则 5):本函数输出 = 服务器可广播给各端的完整可观测状态;
// 瞬时反馈(floaters / dice 动画状态)不在此列 —— 各端独立 spawn,避免高频小包。
import type { GameEngine } from "./game";
import { netWorth } from "./networth";

export function serializeGame(e: GameEngine) {
  return {
    phase: e.phase,
    setupPhase: e.setupPhase,
    turnPhase: e.turnPhase,
    turnNumber: e.turnNumber,
    round: e.round,
    roundAnchor: e.roundAnchor,
    activeIndex: e.activeIndex,
    targetNetWorth: e.targetNetWorth,
    startingCash: e.startingCash,
    isOver: e.isOver,
    winner: e.winner ? e.winner.id : null,
    winReason: e.winReason,
    draftOrder: e.draftOrder,
    draftRolls: e.draftRolls,
    currentDraftIndex: e.currentDraftIndex,
    currentSetupPlayerIndex: e.currentSetupPlayerIndex,
    takenCapitalIndices: [...e.takenCapitalIndices],
    // 三选一选都:当前选都玩家的候选城 + 历史候选集(恢复/联机各端保持候选一致)
    offeredCapitals: [...e.offeredCapitals],
    offeredCapitalHistory: [...e.offeredCapitalHistory],
    // 已选国号(联机 Setup 阶段同步,防止重复国号)
    usedGuohao: [...e.usedGuohao],
    // 已招名士 id(联机端据此排除已招候选,保持招贤池一致)
    recruitedHeroIds: [...e.recruitedHeroIds],
    // 剩余珍宝牌堆(联机端需复现同一抽牌序列;若不愿向各端暴露,可改为只发 length,但抽牌
    // 结果由 server nextFloat 决定,故牌堆内容对齐是必要的)
    treasureDeck: e.treasureDeck.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc })),
    treasureVisitor: e.treasureVisitor
      ? { propertyId: e.treasureVisitor.def.id, ownerIdx: e.treasureVisitor.ownerIdx }
      : null,
    pendingHaltIsOnPath: e.pendingHaltIsOnPath,
    pendingDebt: e.pendingDebt ? { amount: e.pendingDebt.amount, creditor: e.pendingDebt.creditor?.id ?? null } : null,
    // 珍宝交涉交割托管(买家付清价款前珍宝暂存;恢复后可继续清算/交割)
    escrowTreasure: e.escrowTreasure
      ? {
          treasure: { id: e.escrowTreasure.treasure.id, name: e.escrowTreasure.treasure.name, level: e.escrowTreasure.treasure.level, desc: e.escrowTreasure.treasure.desc },
          buyerIdx: e.escrowTreasure.buyerIdx,
          sellerIdx: e.escrowTreasure.sellerIdx,
          price: e.escrowTreasure.price,
        }
      : null,
    branchStartTile: e.board.branch ? e.board.branch.startNode : null,
    branchEndTile: e.board.branch ? e.board.branch.endNode : null,
    currentTileIsBranchStart: e.currentTileIsBranchStart(),
    // PRNG 状态:CLI/联机跨进程续掷(不丢 rng 连续性)
    rngState: e.dice.getRngState(),
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
      onBranch: p.onBranch,
      skipTurns: p.skipTurns,
      properties: p.properties.map((h) => ({ propertyId: h.propertyId, level: h.level, group: h.group })),
      heroes: p.heroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc, image: h.image })),
      // 名士冷却记录(跨进程恢复 cooldown 判定)
      heroLastFired: { ...p.heroLastFired },
      treasures: p.treasures.map((t) => ({ id: t.id, name: t.name, level: t.level, desc: t.desc })),
    })),
    offeredHeroes: e.offeredHeroes.map((h) => ({ id: h.id, name: h.name, title: h.title, desc: h.desc, image: h.image })),
    // 表现态字段经 presentation 视图读(Wave3 候选4:字段已私有,序列化格式不变)。
    lastRoll: e.presentation.lastRoll,
    // lastMove 全量坐标(waypoints/branchWaypoints)随行军动画坐标一并序列化:
    // 联机端收到 snapshot 时,行军动画可能尚未播放(或断线重连后需补播),需坐标才能复现路径。
    lastMove: e.presentation.lastMove
      ? {
          from: e.presentation.lastMove.from,
          landIndex: e.presentation.lastMove.landIndex,
          passedCapital: e.presentation.lastMove.passedCapital,
          capitalIndex: e.presentation.lastMove.capitalIndex,
          traversed: e.presentation.lastMove.traversed,
          waypoints: e.presentation.lastMove.waypoints,
          branchWaypoints: e.presentation.lastMove.branchWaypoints,
          landBranchStep: e.presentation.lastMove.landBranchStep,
        }
      : null,
    lastLandOutcomeKind: e.lastLandOutcome?.kind ?? null,
    lastLandOutcomeProperty: e.lastLandOutcome?.property?.id ?? null,
    // lastLandOutcome 完整量(engine 决策与 bot 消费 kind/property,战报/UI 消费金额):
    // 恢复时按 propertyId 从 catalog 重构 property 引用;owner 不序列化(bot/UI 均不消费,
    // 需要时由 property 归属查 holdings)。
    lastLandOutcome: e.lastLandOutcome
      ? {
          kind: e.lastLandOutcome.kind,
          propertyId: e.lastLandOutcome.property?.id ?? null,
          amount: e.lastLandOutcome.amount ?? null,
          resupply: e.lastLandOutcome.resupply ?? null,
          causedBankruptcy: e.lastLandOutcome.causedBankruptcy ?? null,
        }
      : null,
    logCount: e.log.length,
    // 完整战报(CLI 跨进程持久化 / 联机端断线重连看历史)。God view 包含 log,各端可截短。
    log: e.log,
    // floaters:瞬时反馈(drainFloaters 已清空),联机各端独立 spawn,不序列化。
  };
}
