// 身价计算:仅现金(单一口径,被胜利判定/排行榜/破产裁决复用)。
import type { Player } from "./types";

/**
 * 身价 = 仅现金(珍宝、城池账面均不计入)。
 * 设计决策:迫使玩家管理现金流——购地/扩军直接降身价,只有都城补给、
 * 卖珍宝这些"现金流入"才能推高身价达终局。囤珍宝/囤城不能赢。
 */
export function netWorth(player: Player): number {
  return player.cash;
}
