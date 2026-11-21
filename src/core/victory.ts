import type { GameEngine, VictoryReason } from "./authority";
import type { Player } from "./model";
import { netWorth } from "./networth";
import { resolveDuelRound } from "./reaction-window";

/** 判胜时点由回合收尾决定。最高现金并列时，每轮只保留本轮点数最高者。 */
export function checkVictory(g: GameEngine): { winner: Player | null; reason: VictoryReason } {
  const alive = g.players.flatMap((player, seat) =>
    player.isBankrupt ? [] : [{ seat, cash: netWorth(player) }],
  );
  if (alive.length === 0) return { winner: null, reason: "None" };
  if (alive.length === 1) return { winner: g.players[alive[0].seat], reason: "LastStanding" };

  const highestCash = Math.max(...alive.map(({ cash }) => cash));
  if (highestCash < g.targetNetWorth) return { winner: null, reason: "None" };

  let contenders = alive.filter(({ cash }) => cash === highestCash).map(({ seat }) => seat);
  while (contenders.length > 1) {
    contenders = resolveDuelRound(g, contenders, null).leadingSeats;
  }
  return { winner: g.players[contenders[0]], reason: "TargetNetWorth" };
}
