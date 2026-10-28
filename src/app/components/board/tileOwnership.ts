// 棋盘格归属/都城判定单源(#665 收编):「归属首见者得 + capitalIndex 判都城」只在本
// 文件定义一次,BoardView(棋盘逐格)与 TileThumb(名下城池清单缩略图)共用同一实现,
// 消费点不再各写一份推导、靠注释互证约定同步。
// 归属规则:players 序即座位序,同一 propertyId 取首见持有者——properties 本应全场
// 互斥,首见规则只是把「同格双主」的数据 bug 表达成确定行为。
// 都城规则:全体玩家 capitalIndex 命中本格即都城(不只看被查看的座位)。

/** 归属/都城推导所需的玩家最小结构(BoardPlayer/SnapshotPlayer 均为其结构超集,可
 *  直接透传;棋盘渲染只消费这几个字段)。 */
export interface OwnershipPlayer {
  guohao: string;
  colorIndex: number;
  capitalIndex: number;
  properties: { propertyId: string; level: number }[];
}

/** 单城持有信息(铭牌底染/旌旗/档位珠的推导源)。 */
export interface TileHolding {
  colorIndex: number;
  guohao: string;
  level: number;
}

/** 全场归属表:propertyId → 首见持有者(players 序即座位序,同格双主取首见)。 */
export function holdingsOf(players: readonly OwnershipPlayer[]): Map<string, TileHolding> {
  const m = new Map<string, TileHolding>();
  for (const p of players) {
    for (const h of p.properties) {
      if (!m.has(h.propertyId))
        m.set(h.propertyId, { colorIndex: p.colorIndex, guohao: p.guohao, level: h.level });
    }
  }
  return m;
}

/** 都城判定:全体玩家 capitalIndex 命中本格者,无则 null。 */
export function capitalHolderOf(
  players: readonly OwnershipPlayer[],
  tileIndex: number,
): OwnershipPlayer | null {
  return players.find((p) => p.capitalIndex === tileIndex) ?? null;
}
