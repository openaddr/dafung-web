import type { GameEngine } from "./authority";
import { awardCityIncome, planCityIncome } from "./city-income";
import { STAMINA_MAX } from "./constants";
import { emitGameEvent } from "./game-events";
import { enterJinnangPhase } from "./jinnang-execution";
import { formatMoney } from "./money";
import { netWorth } from "./networth";
import { checkVictory } from "./victory";

export type TurnEndContinuation =
  | { kind: "turnEnd" }
  | { kind: "roundEnd"; checkVictoryAfterIncome: boolean }
  | {
      kind: "cityIncome";
      cities: ReturnType<typeof planCityIncome>;
      next: number;
      checkVictoryAfterIncome: boolean;
    };

export function endTurn(g: GameEngine): void {
  if (g.pendingMoment != null) throw new Error("回合结束前尚有待决时机");
  // 决策载荷已被消费，进入时机前离开原抉择相位，派发失败时仍可诊断（#649）。
  g.turnPhase = "EndTurn";
  g.dispatchMoment("TurnEnd", { subject: g.activeIndex }, { kind: "turnEnd" });
  if (g.pendingMoment == null) resumeTurnEnd(g, { kind: "turnEnd" });
}

export function resumeTurnEnd(g: GameEngine, state: TurnEndContinuation): void {
  if (state.kind === "turnEnd") {
    const count = g.players.length;
    const first = (g.activeIndex + 1) % count;
    const remaining = (g.roundAnchor - first + count) % count;
    const next = planNextTurn(g, first, remaining);
    for (const seat of next.skipped) skipTurn(g, seat);
    if (next.seat != null) {
      if (!declareVictory(g)) {
        g.activeIndex = next.seat;
        startTurn(g);
      }
      return;
    }
    if (dispatchRoundEnd(g, true)) return;
  }

  // 连整轮都无人行动时也照常走轮次时机和收入，直至能进入一个实际回合。
  let checkVictoryAfterIncome = state.kind === "turnEnd" || state.checkVictoryAfterIncome;
  let cities = state.kind === "cityIncome" ? state.cities : planCityIncome(g);
  let from = state.kind === "cityIncome" ? state.next : 0;
  for (;;) {
    for (let i = from; i < cities.length; i++) {
      awardCityIncome(g, cities[i], {
        kind: "cityIncome",
        cities,
        next: i + 1,
        checkVictoryAfterIncome,
      });
      if (g.pendingMoment != null) return;
    }

    if (g.alivePlayers().length === 0) throw new Error("回合收尾无存活诸侯");
    if (checkVictoryAfterIncome && declareVictory(g)) return;
    const next = planNextTurn(g, g.roundAnchor, g.players.length);
    if (next.seat != null) g.activeIndex = next.seat;
    g.round += 1;
    g.dispatchMoment("RoundStart", { subject: g.roundAnchor });
    for (const seat of next.skipped) skipTurn(g, seat);
    if (next.seat != null) {
      startTurn(g);
      return;
    }
    checkVictoryAfterIncome = false;
    if (dispatchRoundEnd(g, checkVictoryAfterIncome)) return;
    cities = planCityIncome(g);
    from = 0;
  }
}

function dispatchRoundEnd(g: GameEngine, checkVictoryAfterIncome: boolean): boolean {
  g.dispatchMoment(
    "RoundEnd",
    { subject: g.roundAnchor },
    { kind: "roundEnd", checkVictoryAfterIncome },
  );
  return g.pendingMoment != null;
}

/** 座位按固定首动锚点分轮，跳过或破产的玩家仍占原座位。 */
function planNextTurn(
  g: GameEngine,
  first: number,
  count: number,
): { seat: number | null; skipped: number[] } {
  const skipped: number[] = [];
  for (let offset = 0; offset < count; offset++) {
    const seat = (first + offset) % g.players.length;
    const player = g.players[seat];
    if (player.isBankrupt) continue;
    if (player.skipTurns === 0) return { seat, skipped };
    skipped.push(seat);
  }
  return { seat: null, skipped };
}

function skipTurn(g: GameEngine, seat: number): void {
  const player = g.players[seat];
  player.skipTurns -= 1;
  emitGameEvent(g, seat, { kind: "turnSkipped" });
  g.logEvent(
    "system",
    player.guohao,
    `${player.guohao} 按兵不动`,
    `skipTurn player=${player.id} remaining=${player.skipTurns}`,
  );
  if (player.skipTurns === 0 && player.resting) {
    player.resting = false;
    const before = player.stamina;
    const after = g.addStamina(seat, STAMINA_MAX - before);
    if (after !== before)
      emitGameEvent(g, seat, { kind: "staminaChanged", delta: after - before, reason: "rest" });
  }
}

function declareVictory(g: GameEngine): boolean {
  const { winner, reason } = checkVictory(g);
  if (winner == null) return false;
  g.isOver = true;
  g.winner = winner;
  g.winReason = reason;
  g.phase = "GameOver";
  g.turnPhase = "GameOver";
  g.logEvent(
    "victory",
    winner.guohao,
    `「天下归一」${winner.guohao} 称帝!身价 ${formatMoney(netWorth(winner))}`,
    `victory winner=${winner.id} reason=${reason} netWorth=${netWorth(winner)}`,
  );
  g.dispatchMoment("GameOver", { subject: g.players.indexOf(winner) });
  // 终局时机之后记录机读终态面板（ADR-0014）。
  g.logEvent(
    "final",
    winner.guohao,
    `终局:${winner.guohao} 称帝(${reason === "LastStanding" ? "群雄尽灭" : "富甲天下"}),历 ${g.round} 轮 ${g.turnNumber} 回合`,
    JSON.stringify({
      type: "final",
      round: g.round,
      turnNumber: g.turnNumber,
      winner: winner.id,
      winReason: reason,
      players: g.players.map((p) => ({
        id: p.id,
        guohao: p.guohao,
        isBot: p.isBot,
        isBankrupt: p.isBankrupt,
        cash: p.cash,
        netWorth: netWorth(p),
        position: p.position,
      })),
    }),
  );
  return true;
}

function startTurn(g: GameEngine): void {
  g.dispatchMoment("TurnStart", { subject: g.activeIndex });
  g.turnPhase = "Roll";
  g.turnNumber += 1;
  g.jinnangUsedTags = [];
  enterJinnangPhase(g);
  // 行军骰面与路径仍供当前命令的演出消费，下一次行军会覆盖它们。
  g.lastLandOutcome = null;
  g.pendingLand = null;
  g.pendingEncounter = null;
  g.pendingJinnang = null;
  g.pendingReaction = null;
  g.lastTransaction = null;
}
