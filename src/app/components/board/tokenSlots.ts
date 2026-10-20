// 棋子落格槽位(单源,#608 不变量①同源抽取):提取拍烤 keyframes 的落格偏移与
// TokenLayer 声明式定位共用同一分组公式——含/剔哪些座位(剔破产)、组内序(玩家数组
// 序)、槽位取模(TOKEN_SLOT_OFFSETS)都以本文件为准。两侧各持一份公式 = 「先落错槽
// 再被拨回」的可见抖动复发(旧 animate.ts 同款坑),故抽公共函数强制同源。
import type { BoardPos } from "@core/board";
import { TOKEN_SLOT_OFFSETS } from "@core/constants";

/** 槽位分组的玩家结构面(core Player 与 BoardView BoardPlayer 的公共子集)。 */
export interface SlotPlayer {
  id: string;
  position: number;
  isBankrupt: boolean;
}

/** 槽位键:按所在格分组(原 TokenLayer.playerSlotKey,随单源化迁入本文件)。 */
export function playerSlotKey(p: Pick<SlotPlayer, "position">): string {
  return String(p.position);
}

/** 同格分组:键=槽位键,组内序=传入数组序;破产者不入组(不占槽)。 */
export function tokenSlotGroups(players: readonly SlotPlayer[]): Map<string, string[]> {
  const byTile = new Map<string, string[]>();
  for (const p of players) {
    if (p.isBankrupt) continue;
    const key = playerSlotKey(p);
    const arr = byTile.get(key);
    if (arr) arr.push(p.id);
    else byTile.set(key, [p.id]);
  }
  return byTile;
}

/** 落格槽位偏移(提取烤制与声明式渲染唯一公式):同格组内下标取模槽位圆周;
 *  不在组内(破产/孤身)按孤身算槽 0。 */
export function tokenSlotOffset(players: readonly SlotPlayer[], self: SlotPlayer): BoardPos {
  const mates = tokenSlotGroups(players).get(playerSlotKey(self)) ?? [self.id];
  return TOKEN_SLOT_OFFSETS[Math.max(0, mates.indexOf(self.id)) % TOKEN_SLOT_OFFSETS.length];
}
