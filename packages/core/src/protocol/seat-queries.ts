import type { TileDef } from "../engine/board";
import type { LoadedMap } from "../engine/board-loader";
import { cityIncomeOf } from "../engine/city-income";
import { fullDefenseOf } from "../engine/defense";
import { cityTradeTermsOf, sellValueOf, type PropertyDef } from "../engine/economy";
import type { GameEvent } from "../engine/game-events";
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

export type SeatBoardMap = Pick<LoadedMap, "board" | "catalog">;

export type BoardSeat = Readonly<
  Pick<
    WarlordDetails,
    "id" | "guohao" | "colorIndex" | "position" | "capitalIndex" | "isBankrupt" | "cash"
  >
>;

type CitySeat = Pick<BoardSeat, "guohao" | "colorIndex"> & { readonly seat: number };

type SeatHolding = SnapshotPlayer["properties"][number];

type CityOwner = CitySeat &
  Readonly<Pick<SeatHolding, "level" | "defense" | "burning" | "damageRanking">> & {
    readonly fullDefense: number;
    readonly sellValue: number;
    readonly trade: ReturnType<typeof cityTradeTermsOf>;
  };

export interface SeatCity {
  readonly tile: TileDef;
  readonly property: PropertyDef;
  readonly capital: CitySeat | null;
  readonly owner: CityOwner | null;
  /** 作为普通城持有时的每轮收益。都城补给单列于 property.resupply。 */
  readonly income: number;
}

export type OwnedSeatCity = SeatCity & { readonly owner: CityOwner };

export interface SeatBoard {
  readonly seats: BoardSeat[];
  /** 按行军顺序排列，索引即城格号。 */
  readonly cities: readonly SeatCity[];
}

/** 把本座已收到的公开座位状态与本局地图合成棋盘和查城资料。 */
export function readSeatBoard(
  players: readonly (BoardSeat & Pick<SnapshotPlayer, "properties">)[],
  { board, catalog }: SeatBoardMap,
): SeatBoard {
  const capitals = new Map<number, CitySeat>();
  const holdings = new Map<string, { holder: CitySeat; holding: SeatHolding }>();
  const seats = players.map(
    ({ id, guohao, colorIndex, position, capitalIndex, isBankrupt, cash, properties }, seat) => {
      const holder = { seat, guohao, colorIndex };
      if (capitalIndex >= 0) capitals.set(capitalIndex, holder);
      for (const holding of properties) {
        if (holdings.has(holding.propertyId))
          throw new Error(`城池 ${holding.propertyId} 有多个持有记录`);
        holdings.set(holding.propertyId, { holder, holding });
      }
      return { id, guohao, colorIndex, position, capitalIndex, isBankrupt, cash };
    },
  );
  const cities = board.tiles.map((tile): SeatCity => {
    const property = catalog.get(tile.propertyId);
    if (property === null) throw new Error(`棋盘城格 ${tile.index} 缺少城池定义`);
    const record = holdings.get(property.id);
    const capital = capitals.get(tile.index) ?? null;
    const income = cityIncomeOf(property);
    if (record === undefined) return { tile, property, capital, owner: null, income };
    const {
      holder,
      holding: { level, defense, burning, damageRanking },
    } = record;
    return {
      tile,
      property,
      capital,
      income,
      owner: {
        ...holder,
        level,
        defense,
        fullDefense: fullDefenseOf(level),
        burning,
        damageRanking,
        sellValue: sellValueOf(property, level),
        trade: cityTradeTermsOf(property, level),
      },
    };
  });
  return { seats, cities };
}

/** 已持有的城池沿用棋盘行军顺序。 */
export function readOwnedCities(board: SeatBoard, seat: number): OwnedSeatCity[] {
  return board.cities.filter((city): city is OwnedSeatCity => city.owner?.seat === seat);
}

type MarchRoute = Extract<GameEvent, { kind: "marchArrived" | "capitalHalt" }>;

/** 实际已走路线由公开到达事件交付，依批内出现的顺序返回。 */
export function readMarchRoutes(events: readonly GameEvent[]): readonly MarchRoute[] {
  return events.filter((event) => event.kind === "marchArrived" || event.kind === "capitalHalt");
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
