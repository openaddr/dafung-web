import type { LogEvent } from "../engine/model";
import type { SnapshotPlayer } from "../engine/snapshot";

export type WarlordDetails = Readonly<
  Pick<
    SnapshotPlayer,
    | "id"
    | "guohao"
    | "colorIndex"
    | "cash"
    | "stamina"
    | "position"
    | "capitalIndex"
    | "isBankrupt"
    | "properties"
    | "heroes"
    | "treasures"
    | "jinnangHandCount"
  >
>;

type SeatPlayerDetails = WarlordDetails & { readonly jinnangHand: readonly string[] };

/** 从已投影的座位数据按席查阅；公开诸侯资料与本席牌面各有明确读口。 */
export function readSeatDetails(players: readonly SeatPlayerDetails[], seat: number) {
  const warlords: WarlordDetails[] = players.map(
    ({
      id,
      guohao,
      colorIndex,
      cash,
      stamina,
      position,
      capitalIndex,
      isBankrupt,
      properties,
      heroes,
      treasures,
      jinnangHandCount,
    }) => ({
      id,
      guohao,
      colorIndex,
      cash,
      stamina,
      position,
      capitalIndex,
      isBankrupt,
      properties,
      heroes,
      treasures,
      jinnangHandCount,
    }),
  );
  return { warlords, hand: players[seat].jinnangHand };
}

const WAR_CATEGORIES: ReadonlySet<LogEvent["category"]> = new Set([
  "roll",
  "buy",
  "upgrade",
  "trade",
  "supply",
  "halt",
  "setup",
  "skill",
  "system",
  "victory",
]);

export interface WarReportEntry {
  /** 该条目在已投影对局日志中的序位，与回执和日志尾段使用同一坐标。 */
  readonly offset: number;
  readonly round: number;
  readonly player: string | null;
  readonly brief: string;
}

/** 只读座位日志中的玩法条目，保留其公开行号。 */
export function readWarReport(log: readonly LogEvent[]): WarReportEntry[] {
  const entries: WarReportEntry[] = [];
  for (const [offset, { category, round, player, brief }] of log.entries()) {
    if (WAR_CATEGORIES.has(category)) entries.push({ offset, round, player, brief });
  }
  return entries;
}
