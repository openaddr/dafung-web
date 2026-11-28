// 棋子落格槽位(单源,#608 不变量①同源抽取):提取拍烤 keyframes 的落格偏移与
// TokenLayer 声明式定位共用同一分组公式——含/剔哪些座位(剔破产)、组内序(玩家数组
// 序)、槽位取模(TOKEN_SLOT_OFFSETS)都以本文件为准。两侧各持一份公式 = 「先落错槽
// 再被拨回」的可见抖动复发(旧 animate.ts 同款坑),故抽公共函数强制同源。
import type { Board, BoardPos } from "@dafung/core/engine/board";
import { TOKEN_SLOT_OFFSETS } from "@dafung/core/engine/constants";
import { marchPos, marchStartTile } from "@app/fx/useMarch";
import type { BoardPlayer } from "./BoardView";

/** 槽位分组的玩家结构面(core Player 与 BoardView BoardPlayer 的公共子集)。 */
interface SlotPlayer {
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

export interface TokenSlot {
  player: BoardPlayer;
  x: number;
  y: number;
  /** 1=正常,0.15=破产淡出,0=隐藏(未选都)。 */
  opacity: number;
  /** #30 行军接管中(强调态:金边拖影 + 落脚指示环)。 */
  marching: boolean;
  /** L47:本地视角自己的棋子(玩家色微光圈,氛围层渲染)。 */
  mine: boolean;
  /** #256 目标段:出牌阶段候选棋子(金虚线环呼吸,与席位格金圈同步,双锚点)。 */
  targeted: boolean;
  /** #762 当前回合方棋子(金呼吸环,氛围层渲染;同时至多一枚有环)。 */
  active: boolean;
  /** #557 同格拥挤档:同格 >4 子(旗面 scale 0.85,给 8 槽圆周让位)。 */
  crowded: boolean;
}

/** #30/#39/#58 棋子放大比例:旗/字/印玺等比 scale。屏幕净大小 = TOKEN_SCALE /
 *  TILE_SCALE(城池,单源见 city-scene.ts)。#557 曾以 2.6/2.2≈净 1.18x 提升总览可辨性;
 *  #938 城池同提 2.6 后两者同刻度(净 1.0x)——棋子绝对尺寸不变,总览可辨性由
 *  7 列图幅的 fit 增益(≈0.21→0.27)承接,槽位圆周(r=26 局部,core/constants)不动。
 *  scale 落在 mini-svg 内独立 <g transform> 属性上,与包装 div 的 CSS style.transform
 *  (声明式定位 + 行军命令式写入 translate)互不覆盖。氛围层旗/光环同用此比例
 *  (AmbientLayer,ADR-0039)。 */
export const TOKEN_SCALE = 2.6;
/** #557 同格拥挤档:同格 >4 子时旗面整体再乘 0.85,给 8 槽圆周留出彼此轮廓。 */
export const TOKEN_CROWD_SCALE = 0.85;

/** 槽位推导单源(ADR-0039 抽取):本层声明式定位与氛围层装饰落点共用的同一公式体
 *  ——分组/偏移走 tokenSlots 单源,行军接管读 marchPos 当前段坐标。 */
export function computeTokenSlots(
  board: Board,
  players: BoardPlayer[],
  o: {
    setupUnselected: boolean;
    skipTokenIds?: ReadonlySet<string>;
    mineId?: string;
    targetedIds?: ReadonlySet<string>;
    activeId?: string;
  },
): TokenSlot[] {
  const slotPlayers = players.map((p) => {
    const startTile = o.skipTokenIds?.has(p.id) ? marchStartTile(p.id) : undefined;
    return startTile === undefined ? p : { ...p, position: startTile };
  });
  const bySlot = tokenSlotGroups(slotPlayers);

  const slots: TokenSlot[] = [];
  for (const p of players) {
    const mine = p.id === o.mineId;
    const targeted = o.targetedIds?.has(p.id) ?? false;
    const active = p.id === o.activeId;
    if (o.setupUnselected && p.capitalIndex < 0) {
      slots.push({
        player: p,
        x: 0,
        y: 0,
        opacity: 0,
        marching: false,
        mine,
        targeted,
        active,
        crowded: false,
      });
      continue;
    }
    if (o.skipTokenIds?.has(p.id)) {
      // 行军接管中:不按声明式(引擎终态)定位,改用 useMarch 维护的「当前段坐标」——
      // 保证行军中任何重渲(如 bot 步进 sync)把 transform 写成当前段目标而非终点,
      // 命令式逐段动画不被 React 拽回。接管刚建立(尚无坐标)则暂不渲染(等一帧起点锚定)。
      // #30:接管中即标 marching → 金边拖影 + 落脚指示环(强调效果挂在动画路径上,
      // 动画结束 removeMarching 后 React 终态接管,强调态随之自然消退)。
      const mp = marchPos.get(p.id);
      if (!mp) continue;
      slots.push({
        player: p,
        x: mp.x,
        y: mp.y,
        opacity: 1,
        marching: true,
        mine,
        targeted,
        active,
        crowded: false, // 行军接管期的旗面独立绘制。
      });
      continue;
    }
    const pos = board.positionOf(p.position);
    const mates = bySlot.get(playerSlotKey(p)) ?? [p.id];
    const off = tokenSlotOffset(slotPlayers, p);
    slots.push({
      player: p,
      x: pos.x + off.x,
      y: pos.y + off.y,
      opacity: p.isBankrupt ? 0.15 : 1,
      marching: false,
      mine,
      targeted,
      active,
      crowded: mates.length > TOKEN_SLOT_OFFSETS.length / 2,
    });
  }
  return slots;
}
